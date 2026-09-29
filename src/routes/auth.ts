import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";

import { User } from "../models/User";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
  signAuthToken,
} from "../middleware/auth";
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  rotateRefreshToken,
} from "../models/RefreshToken";
import { authRateLimit } from "../middleware/rateLimit";

const router = Router();

const USERNAME_PATTERN = /^[a-z0-9_.-]{3,32}$/;

interface AuthPayload {
  username: string;
  password: string;
  displayName?: string;
}

function parseAuthPayload(body: unknown): AuthPayload | null {
  if (!body || typeof body !== "object") return null;
  const { username, password, displayName } = body as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") return null;
  if (displayName !== undefined && typeof displayName !== "string") return null;
  return { username, password, displayName };
}

/**
 * POST /api/auth/register
 * Body: { username, password, displayName? }
 */
router.post("/register", authRateLimit, async (request: Request, response: Response) => {
  try {
    const payload = parseAuthPayload(request.body);
    if (!payload) {
      response
        .status(400)
        .json({ error: "username and password are required strings." });
      return;
    }

    const username = payload.username.trim().toLowerCase();
    const password = payload.password;
    const displayName = payload.displayName?.trim() || username;

    if (!USERNAME_PATTERN.test(username)) {
      response.status(400).json({
        error:
          "Username must be 3-32 characters: letters, numbers, dots, dashes, or underscores.",
      });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      response.status(400).json({
        error: "Password must be between 8 and 128 characters.",
      });
      return;
    }

    const existing = await User.findOne({ username }).lean();
    if (existing) {
      response.status(409).json({ error: "That username is already taken." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash, displayName });

    const token = signAuthToken({
      id: String(user._id),
      username: user.username,
      displayName: user.displayName,
      language: user.language ?? "en",
    });
    const refreshToken = await issueRefreshToken(String(user._id));

    response.status(201).json({
      token,
      refreshToken,
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
        language: user.language ?? "en",
      },
    });
  } catch (error) {
    console.error("Registration failed.", error);
    response.status(500).json({ error: "Unable to register right now." });
  }
});

/**
 * POST /api/auth/login
 * Body: { username, password }
 */
router.post("/login", authRateLimit, async (request: Request, response: Response) => {
  try {
    const payload = parseAuthPayload(request.body);
    if (!payload) {
      response
        .status(400)
        .json({ error: "username and password are required strings." });
      return;
    }

    const username = payload.username.trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) {
      response.status(401).json({ error: "Invalid username or password." });
      return;
    }

    const passwordMatches = await bcrypt.compare(
      payload.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      response.status(401).json({ error: "Invalid username or password." });
      return;
    }

    const token = signAuthToken({
      id: String(user._id),
      username: user.username,
      displayName: user.displayName,
      language: user.language ?? "en",
    });
    const refreshToken = await issueRefreshToken(String(user._id));

    response.json({
      token,
      refreshToken,
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
        language: user.language ?? "en",
      },
    });
  } catch (error) {
    console.error("Login failed.", error);
    response.status(500).json({ error: "Unable to sign in right now." });
  }
});

/**
 * PATCH /api/auth/language
 * Body: { language: "en" | "hi" }
 *
 * Persists the teaching preference and re-issues the token. The re-issue is
 * what keeps the language in the JWT honest — without it the next reply would
 * come back in the old language until the student signed in again.
 */
router.patch("/language", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const requested = (request.body as { language?: unknown } | undefined)?.language;
    if (requested !== "en" && requested !== "hi") {
      response.status(400).json({ error: 'language must be "en" or "hi".' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      authUser.id,
      { $set: { language: requested } },
      { new: true },
    ).lean();
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    const identity = {
      id: String(user._id),
      username: user.username,
      displayName: user.displayName,
      language: user.language,
    };
    response.json({ token: signAuthToken(identity), user: identity });
  } catch (error) {
    console.error("Language change failed.", error);
    response.status(500).json({ error: "Unable to change language right now." });
  }
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 *
 * Exchanges a refresh token for a fresh access token, rotating the refresh
 * token in the process. This is what stops a student's session dying
 * mid-lesson: the client calls this the moment an access token is rejected,
 * and the student never sees a sign-in screen again while their refresh token
 * is alive.
 */
router.post("/refresh", async (request, response) => {
  try {
    const presented = (request.body as { refreshToken?: unknown } | undefined)
      ?.refreshToken;
    if (typeof presented !== "string" || !presented) {
      response.status(400).json({ error: "refreshToken is required." });
      return;
    }

    const outcome = await rotateRefreshToken(presented);
    if (!outcome.ok) {
      // A reused token means the credential leaked, so this is a security
      // event, not a typo — but the client only needs to know to sign out.
      console.warn(`Refresh rejected: ${outcome.reason}.`);
      response.status(401).json({
        error: "Your session has ended. Please sign in again.",
      });
      return;
    }

    const user = await User.findById(outcome.userId).lean();
    if (!user) {
      response.status(401).json({ error: "That account no longer exists." });
      return;
    }

    response.json({
      token: signAuthToken({
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
        language: user.language ?? "en",
      }),
      refreshToken: outcome.nextToken,
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
        language: user.language ?? "en",
      },
    });
  } catch (error) {
    console.error("Token refresh failed.", error);
    response.status(500).json({ error: "Unable to refresh your session." });
  }
});

/**
 * POST /api/auth/logout
 *
 * Revokes every refresh token for the student. A no-op success is returned
 * even when the token is already gone — signing out must always work, and
 * telling an attacker whether a token existed tells them something.
 */
router.post("/logout", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    await revokeAllRefreshTokens(authUser.id);
    response.json({ signedOut: true });
  } catch (error) {
    console.error("Logout failed.", error);
    response.status(500).json({ error: "Unable to sign out right now." });
  }
});

export default router;

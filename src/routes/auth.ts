import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";

import { User } from "../models/User";
import {
  clearAuthCookies,
  REFRESH_COOKIE,
  setAccessCookie,
  setRefreshCookie,
} from "../middleware/auth";
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
import {
  buildConsent,
  canUseAiFeatures,
  CONSENT_POLICY_VERSION,
  emptyConsent,
  PRIVACY_DISCLOSURE,
  type AgeBand,
} from "../services/consent";

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

    // The credential now travels as an httpOnly cookie rather than in the JSON
    // body. It is still returned in the body as well, because the security suite
    // and any scripted client authenticate with a bearer header and have no
    // cookie jar; the browser path simply never reads it.
    setAccessCookie(request, response, token);
    setRefreshCookie(request, response, refreshToken);

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

    setAccessCookie(request, response, token);
    setRefreshCookie(request, response, refreshToken);

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
 * GET /api/auth/me
 *
 * Who am I? With tokens in `localStorage` the client could answer this from its
 * own storage — but that only proved the browser still held a string, not that
 * the credential was still valid. Now that the session is an httpOnly cookie,
 * this endpoint is the only way to tell "signed in" from "holding a cached name
 * for someone whose session expired", so the boot path calls it.
 *
 * Returns only the display fields. The decoded token also carries `iat`/`exp`,
 * and echoing those would write JWT claims into `localStorage` on every boot —
 * harmless today, but it is the kind of thing that quietly becomes a credential
 * the day someone starts reading that object.
 */
router.get("/me", requireAuth, (request, response) => {
  const { id, username, displayName, language } =
    (request as AuthenticatedRequest).authUser as AuthUser;
  response.json({ user: { id, username, displayName, language } });
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
    // Re-issue the cookie so the new language travels in the JWT. Without this
    // the next reply would come back in the old language until the access token
    // expired — the exact staleness this re-issue exists to prevent.
    const nextToken = signAuthToken(identity);
    setAccessCookie(request, response, nextToken);
    response.json({ token: nextToken, user: identity });
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
    // The cookie is the browser's path; the body is kept for scripted clients.
    const fromCookie = (request.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    const fromBody = (request.body as { refreshToken?: unknown } | undefined)
      ?.refreshToken;
    const presented =
      typeof fromCookie === "string" && fromCookie
        ? fromCookie
        : typeof fromBody === "string" && fromBody
          ? fromBody
          : null;
    if (!presented) {
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

    const nextAccess = signAuthToken({
      id: String(user._id),
      username: user.username,
      displayName: user.displayName,
      language: user.language ?? "en",
    });
    // Rotate both cookies. The refresh cookie is the credential that mattered
    // here — leaving the old one in place after a successful rotation would
    // defeat the point of rotating.
    setAccessCookie(request, response, nextAccess);
    setRefreshCookie(request, response, outcome.nextToken);

    response.json({
      token: nextAccess,
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
    // Always clear, including on the error path below — a student who clicked
    // sign out must end up signed out locally even if the revoke call failed,
    // or they are left with a live cookie and no way to remove it.
    clearAuthCookies(request, response);
    response.json({ signedOut: true });
  } catch (error) {
    console.error("Logout failed.", error);
    clearAuthCookies(request, response);
    response.status(500).json({ error: "Unable to sign out right now." });
  }
});

/**
 * GET /api/auth/consent
 *
 * What consent state is this account in? The client asks on every boot so a
 * student whose consent is missing (or stale — see CONSENT_POLICY_VERSION) is
 * shown the notice rather than being quietly allowed through.
 */
router.get("/consent", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const user = await User.findById(authUser.id).lean();
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }
    response.json({
      policyVersion: CONSENT_POLICY_VERSION,
      ageBand: user.ageBand ?? null,
      consent: user.consent ?? emptyConsent(),
      canUseAi: canUseAiFeatures(user.ageBand ?? null, user.consent),
    });
  } catch (error) {
    console.error("Consent status read failed.", error);
    response.status(500).json({ error: "Unable to read consent status." });
  }
});

/**
 * POST /api/auth/consent
 * Body: { ageBand, acceptedTerms, guardianName?, guardianAccepted? }
 *
 * Records who agreed, to which version, and when. The rules are in
 * `services/consent.ts` and are the same ones the client hints at — this is the
 * copy that actually decides.
 */
router.post("/consent", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const body = (request.body ?? {}) as Record<string, unknown>;

    const outcome = buildConsent({
      ageBand: body.ageBand,
      acceptedTerms: body.acceptedTerms,
      guardianName: body.guardianName,
      guardianAccepted: body.guardianAccepted,
    });

    if (!outcome.ok || !outcome.record) {
      response.status(400).json({
        error: outcome.error ?? "Consent could not be recorded.",
        needsGuardian: outcome.needsGuardian ?? false,
      });
      return;
    }

    const record = outcome.record;
    await User.updateOne(
      { _id: authUser.id },
      { $set: { ageBand: body.ageBand, consent: record } },
    );

    response.json({
      ageBand: body.ageBand,
      consent: record,
      canUseAi: canUseAiFeatures(body.ageBand as AgeBand, record),
    });
  } catch (error) {
    console.error("Consent recording failed.", error);
    response.status(500).json({ error: "Unable to record consent." });
  }
});

/**
 * DELETE /api/auth/consent
 *
 * Withdrawal. Consent that cannot be taken back is not consent, and a student who
 * revokes it has to stop being able to use the AI features immediately — so the
 * record is cleared rather than flagged, and the AI routes refuse from then on.
 * The account itself survives: a student who changes their mind about the notice
 * should not lose their progress as a side effect, and deleting is a separate,
 * explicit act.
 */
router.delete("/consent", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    await User.updateOne(
      { _id: authUser.id },
      { $set: { consent: emptyConsent() } },
    );
    response.json({ consent: emptyConsent(), canUseAi: false });
  } catch (error) {
    console.error("Consent withdrawal failed.", error);
    response.status(500).json({ error: "Unable to withdraw consent." });
  }
});

/**
 * GET /api/auth/consent/policy
 *
 * The notice itself. Served by the API rather than hard-coded in the client so
 * there is exactly one copy, and so the version the student is shown is the same
 * one that gets recorded against their consent.
 */
router.get("/consent/policy", (_request, response) => {
  response.json({
    version: CONSENT_POLICY_VERSION,
    disclosure: PRIVACY_DISCLOSURE,
  });
});

export default router;

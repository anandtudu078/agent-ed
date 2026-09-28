import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";

import { User } from "../models/User";
import { signAuthToken } from "../middleware/auth";

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
router.post("/register", async (request: Request, response: Response) => {
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
    });

    response.status(201).json({
      token,
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
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
router.post("/login", async (request: Request, response: Response) => {
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
    });

    response.json({
      token,
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
      },
    });
  } catch (error) {
    console.error("Login failed.", error);
    response.status(500).json({ error: "Unable to sign in right now." });
  }
});

export default router;

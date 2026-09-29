import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "JWT_SECRET is not configured (must be at least 16 characters).",
    );
  }
  return secret;
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(user, requireJwtSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function verifyAuthToken(token: string): AuthUser {
  // Pin the algorithm: without this, a token signed with any algorithm the
  // jsonwebtoken library supports would be accepted (e.g. `none`-family
  // confusion bugs in older versions).
  return jwt.verify(token, requireJwtSecret(), {
    algorithms: ["HS256"],
  }) as AuthUser;
}

/**
 * Express middleware: requires a valid `Authorization: Bearer <token>` header
 * and attaches the decoded user to request.authUser.
 */
export function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    request.authUser = verifyAuthToken(token);
    next();
  } catch {
    response
      .status(401)
      .json({ error: "Session expired or invalid. Please sign in again." });
  }
}

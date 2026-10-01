import { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import type { AuthenticatedRequest } from "./auth";

/**
 * Budget a student, not an IP address.
 *
 * Schools put an entire classroom behind one public IP. Keying the AI-usage
 * limit on IP means thirty students throttle each other mid-lesson, and the
 * error blames whoever happened to send last. Every route using this limiter
 * sits behind requireAuth, so a stable per-user id is available and is the
 * honest unit: one student's usage is one student's usage.
 */
function keyByUser(request: Request): string {
  const authUser = (request as AuthenticatedRequest).authUser;
  if (authUser?.id) return `user:${authUser.id}`;
  // Defensive only — these routes are all authenticated. Still IPv6-safe via
  // ipKeyGenerator rather than a raw req.ip, which is an unbounded key.
  return `ip:${ipKeyGenerator(request.ip ?? "unknown")}`;
}

/**
 * Auth endpoints.
 *
 * Keyed on IP *and* the username being tried, with successful logins not
 * counted. Both parts matter for a school: a per-IP-only budget meant 30
 * students signing in one morning exhausted a shared budget and locked each
 * other out; but keying on username alone would hand a brute-forcer a fresh
 * budget per guess.
 *
 * Trade-off, stated plainly: one account is still capped at `limit` failures
 * per 15 minutes, but an attacker cycling many usernames from one IP gets more
 * attempts than they would under a pure per-IP cap. That is the correct trade
 * for a classroom product; if credential stuffing becomes a real concern, add
 * a separate coarse per-IP limiter rather than re-tightening this one.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // failed attempts per username+IP per window
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (request: Request) => {
    const body = request.body as { username?: unknown } | undefined;
    const username =
      typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const ip = ipKeyGenerator(request.ip ?? "unknown");
    return username ? `${ip}|${username}` : ip;
  },
  message: { error: "Too many attempts. Please try again in 15 minutes." },
});

/**
 * Chat and assessment endpoints: each request triggers billable AI calls
 * (Groq + Gemini), so cap usage per signed-in student.
 */
export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 12, // 12 AI calls per minute per student
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyByUser,
  message: {
    error: "You're sending messages too quickly. Please slow down a little.",
  },
});

/**
 * Socket messages: the authenticated user id when available, otherwise the
 * socket id, so one connection can't flood the AI pipeline.
 */
export function createSocketLimiter(options: {
  windowMs: number;
  max: number;
}) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function consume(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    let bucket = hits.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, bucket);
    }

    bucket.count += 1;

    // Opportunistic cleanup so the map does not grow unbounded.
    //
    // The threshold is not a limit on memory but a trigger: past it we sweep the
    // expired buckets. Entries are keyed per distinct student, so a busy school
    // accumulates one per user per minute, and the sweep is what keeps that from
    // being permanent. Entries younger than the window are kept — deleting them
    // would hand a student a fresh budget mid-window and let them exceed `max`.
    if (hits.size > 1000) {
      for (const [k, v] of hits) {
        if (now >= v.resetAt) hits.delete(k);
      }
    }

    return {
      allowed: bucket.count <= options.max,
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  };
}

export type SocketRateLimiter = ReturnType<typeof createSocketLimiter>;

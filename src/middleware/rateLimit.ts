import { Request } from "express";
import rateLimit from "express-rate-limit";

/**
 * Auth endpoints: tight window to blunt credential-stuffing and
 * username-enumeration attempts. IP-based.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 register/login attempts per window per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
});

/**
 * Chat endpoint: each request triggers billable AI calls (Groq + Gemini),
 * so cap per-IP usage even for authenticated users.
 */
export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 12, // 12 chats per minute per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
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

export function socketClientKey(request: Request & { authUser?: unknown }): string {
  const user = request.authUser as { username?: string } | undefined;
  return user?.username ?? request.ip ?? "unknown";
}

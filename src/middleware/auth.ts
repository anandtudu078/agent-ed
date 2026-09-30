import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { User } from "../models/User";

/**
 * CSRF guard.
 *
 * Moving tokens into cookies removes the XSS read but introduces the problem
 * cookies have always had: the browser attaches them to cross-site requests
 * automatically, so a page the student visits could make the API act as them.
 * `SameSite=Lax` already blocks this for POST/PATCH/DELETE, so this is the
 * second lock rather than the only one.
 *
 * A custom header is the check because a cross-origin `fetch` cannot set one
 * without a successful CORS preflight, which this server refuses for unlisted
 * origins. A simple request (form post, image, link) cannot carry it at all.
 * `XMLHttpRequest` and `fetch` from another origin are the only realistic ways to
 * attack this, and both are stopped.
 *
 * GET is exempt: it must be safe by definition, and requiring a header would
 * break a student's bookmarked dashboard link.
 */
export function requireCsrfHeader(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    next();
    return;
  }
  // The client sends this on every authenticated call. A cross-site caller
  // cannot: it is not a CORS-safelisted header, so setting it triggers a
  // preflight this origin will not approve.
  if (request.headers["x-requested-with"] === "AgentEd") {
    next();
    return;
  }
  response.status(403).json({
    error: "Blocked: request did not come from this application.",
  });
}

/**
 * Auth cookies.
 *
 * Tokens used to live in `localStorage`, which any script on the page could
 * read. That is the standard XSS exfiltration path: one injected `<script>` and
 * a student's long-lived credential is gone, with no user interaction and
 * nothing for a user to notice. httpOnly cookies are unreadable from JavaScript,
 * so the same injected script cannot get at them — it can only make requests as
 * the user, which the `SameSite` policy and the CSRF check below constrain.
 *
 * Kept in its own module because the cookie rules are the part that must not be
 * wrong, and because both the router and the socket handshake need the same
 * decisions. Two independent cookie implementations is how a deployment ends up
 * with one path setting `SameSite=None` by accident.
 */

/** Short-lived. Matches TOKEN_TTL_SECONDS in this file's sibling module. */
export const ACCESS_COOKIE = "agented_access";
/** Long-lived, rotated on every use. */
export const REFRESH_COOKIE = "agented_refresh";

/**
 * SameSite is chosen PER REQUEST, not as a constant.
 *
 * `strict` would not be sent when a student arrives from an external link — a
 * shared link to a lesson, a search result, a Slack message — and the app would
 * show them a signed-out screen for a session they legitimately have. So the
 * candidates are `lax` and `none`:
 *
 * - Same-site deployments (localhost:5173 → localhost:3000 in dev) work with
 *   `lax`, which also keeps the CSRF story tight.
 * - Cross-site deployments (Vercel frontend → Render API in production) REQUIRE
 *   `none`: browsers never attach a `lax` cookie to a cross-site fetch, so every
 *   signed-in call went out unauthenticated (401 → refresh 400 → bounced to the
 *   login screen). Found by testing the deployed login flow end to end.
 *
 * `SameSite=None` is only valid alongside `Secure`, so the decision reuses the
 * same per-request HTTPS signal as `secureCookies` below: HTTPS gets `none`,
 * plain HTTP (local dev) keeps `lax`. CSRF defense is unchanged either way —
 * it lives in the `X-Requested-With` header requirement, not in SameSite.
 */
function sameSiteFor(request: Request): "lax" | "none" {
  return secureCookies(request) ? "none" : "lax";
}

/**
 * Whether cookies may be marked `Secure`.
 *
 * Decided from the ACTUAL request, not from `NODE_ENV`. This used to be
 * `NODE_ENV === "production"`, and that was a trap: run the dev server with
 * `NODE_ENV=production` — one env var, and entirely reasonable when you are
 * "testing production mode" — and every cookie came back `Secure`. Over
 * `http://localhost:5173` the browser then *silently refuses to store them*.
 *
 * The symptom is genuinely nasty and cost real debugging time: sign-in returns
 * 200, the app opens, the student taps through the consent form, and then
 * `POST /api/auth/consent` fails with a bare "Authentication required." — because
 * the session they never actually had is not in the cookie jar. Every step looks
 * like it worked.
 *
 * Asking the connection instead cannot be misconfigured: if the request did not
 * arrive over HTTPS, a `Secure` cookie is guaranteed useless, so never send one.
 */
function secureCookies(request: Request): boolean {
  // Behind a proxy (Render, Vercel) TLS is terminated before this app sees the
  // socket, so the connection itself looks plain. The forwarded scheme is the
  // only reliable signal — and `app.set("trust proxy", 1)` is what makes reading
  // it safe, since only one hop is believed.
  const forwarded = request.headers["x-forwarded-proto"];
  const viaProxy =
    typeof forwarded === "string" ? forwarded.split(",")[0].trim().toLowerCase() : "";
  if (viaProxy) return viaProxy === "https";
  return Boolean((request.socket as { encrypted?: boolean }).encrypted);
}

/**
 * Cookie options for a session credential.
 *
 * `path: "/"` on the access cookie is required rather than cosmetic: the cookie
 * is scoped to the API's mount point, and `requireAuth` runs on routes spread
 * across `/api/auth`, `/api/dashboard` and `/api/assessment`. A narrower path
 * would silently fail to authenticate on two of them.
 */
function baseOptions(request: Request, maxAgeMs: number): {
  httpOnly: true;
  sameSite: "lax" | "none";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const secure = secureCookies(request);
  return {
    httpOnly: true,
    // `SameSite=None` is rejected by browsers unless the cookie is also
    // `Secure`, so the two must move together — sameSiteFor derives both
    // from the same signal.
    sameSite: sameSiteFor(request),
    secure,
    path: "/",
    maxAge: maxAgeMs,
  };
}

/** 30 minutes, matching the access token's own TTL. */
export function setAccessCookie(request: Request, response: Response, token: string): void {
  response.cookie(ACCESS_COOKIE, token, baseOptions(request, 30 * 60 * 1000));
}

/** 30 days, matching the refresh token's own TTL. */
export function setRefreshCookie(request: Request, response: Response, token: string): void {
  response.cookie(REFRESH_COOKIE, token, baseOptions(request, 30 * 24 * 60 * 60 * 1000));
}

/**
 * Clear both session cookies.
 *
 * The options must match the ones used to set them or the browser keeps the
 * original — a mismatch on `path` alone is enough, and the result is a "signed
 * out" user who is still authenticated.
 */
export function clearAuthCookies(request: Request, response: Response): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    // `secure` must match how the cookie was set, or the browser keeps it.
    response.clearCookie(name, { ...baseOptions(request, 0), maxAge: undefined });
  }
}

/**
 * Access tokens are deliberately short-lived.
 *
 * A 7-day token meant a student could not renew a session at all — signing out
 * of a lesson meant signing back in from scratch, mid-thought. Half an hour
 * keeps the blast radius of a stolen token small while being invisible to the
 * student, because the client refreshes transparently before it ever expires.
 */
const TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  /**
   * Teaching language carried in the token. A language change re-issues the
   * token (see PATCH /api/auth/language) so this never goes stale — which is
   * why it is safe to read on the hot chat path instead of hitting the DB on
   * every message.
   */
  language: "en" | "hi";
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
 * Express middleware: authenticates the request and attaches the decoded user.
 *
 * The cookie is the primary credential. A bearer header is still accepted as a
 * fallback because the security suite and any scripted client need a way to
 * present a token without a cookie jar — but the browser path never uses it,
 * which is the point.
 *
 * Also confirms the account still exists. A JWT stays valid for 30 minutes after
 * it is issued, so without this a student who deletes their account — or one
 * deleted for them — keeps a working session until the token expires. Deletion
 * that does not revoke access is not deletion, and "sign me out permanently" that
 * leaves the door open is worse than no such button.
 *
 * Costs one indexed `_id` lookup per authenticated request. That is the price of
 * deletion actually working, and it is cheap: a single-key read on a small
 * document.
 */
export async function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const header = request.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const fromCookie = (request.cookies as Record<string, string> | undefined)?.[
    ACCESS_COOKIE
  ];
  const token = fromCookie || bearer;

  if (!token) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  let user: AuthUser;
  try {
    user = verifyAuthToken(token);
  } catch {
    response
      .status(401)
      .json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }

  try {
    const exists = await User.exists({ _id: user.id });
    if (!exists) {
      response.status(401).json({
        error: "That account no longer exists. Please sign in again.",
      });
      return;
    }
  } catch {
    // A database blip must not read as "your account is gone" and sign the student
    // out. Fail closed on the *request* instead: refuse this call, keep the
    // session, and let the next one succeed.
    response.status(503).json({ error: "Unable to verify your session. Try again." });
    return;
  }

  request.authUser = user;
  next();
}

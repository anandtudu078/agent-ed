// Automated security checks for AgentEd's backend.
// Run: node client/scripts/security-test.mjs
//
// Default checks are passive (headers, CORS, authz) and safe to run anytime.
// Set SECURITY_TEST_RATELIMIT=1 to also burn the auth rate-limiter budget
// (10 attempts / 15 min per IP) to assert the 429 path — do NOT run that
// right before the UI suite, which needs an auth attempt.

import { chromium } from "playwright";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";

const BACKEND = "http://localhost:3000";
const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

// Mint tokens with the server's own secret so we can test *authorization*
// (cross-user 403) and craft attack tokens (alg:none, wrong secret) for the
// verification hardening checks.
const envPath = path.resolve(import.meta.dirname ?? ".", "../../.env");
const secret = (() => {
  try {
    const line = fs.readFileSync(envPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("JWT_SECRET="));
    return line.split("=").slice(1).join("=");
  } catch {
    return null;
  }
})();

const mint = (username, useSecret = secret) =>
  jwt.sign({ id: "507f1f77bcf86cd799439011", username, displayName: "Sec Test" }, useSecret, {
    expiresIn: "1h",
    algorithm: "HS256",
  });

const evilToken = mint("secvictimbob");
const goodToken = secret ? mint("seccheckalice") : "";

/**
 * Every mutating request from this suite must carry the CSRF header.
 *
 * The API rejects writes that do not (see `requireCsrfHeader`), which is the
 * point — but a test client is not a browser, so it has to opt in explicitly.
 *
 * Wrapped rather than added call-by-call: eleven mutating calls each remembering
 * to opt in is eleven chances to forget, and the failure mode is a confusing 403
 * on an unrelated check. A new check is therefore correct by default.
 */
const CSRF = { "X-Requested-With": "AgentEd" };

// Stability flags, matching the beat playback suite. This suite now opens several
// browser contexts, and on a memory-constrained machine Chromium starts dying
// mid-run with "Target page, context or browser has been closed" — which reads
// like a product failure and is not one.
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
});
try {
  // `page` shares ONE cookie jar for its whole life, so the moment any check
  // registers an account, every later call on it is authenticated. That is
  // correct server behaviour, but it makes the jar invisible to the
  // bearer-token checks below, which assume a clean slate: "refresh without a
  // token" and "unauthenticated /me" both start returning 200 as soon as an
  // earlier check left a cookie behind.
  //
  // Rather than reordering checks to avoid the interaction, the cookie-specific
  // ones get their own context and never touch `page`'s jar.
  const page = await browser.newPage();

  /** `page.request` with the CSRF header folded into every mutating call. */
  const raw = page.request;
  const r = {
    get: (url, opts) => raw.get(url, opts),
    fetch: (url, opts) => raw.fetch(url, opts),
    post: (url, opts = {}) =>
      raw.post(url, { ...opts, headers: { ...CSRF, ...(opts.headers ?? {}) } }),
    patch: (url, opts = {}) =>
      raw.patch(url, { ...opts, headers: { ...CSRF, ...(opts.headers ?? {}) } }),
    delete: (url, opts = {}) =>
      raw.delete(url, { ...opts, headers: { ...CSRF, ...(opts.headers ?? {}) } }),
  };

  // 1. Security headers (helmet)
  const health = await r.get(`${BACKEND}/health`);
  const h = async (name) =>
    (await health.headersArray()).find((x) => x.name.toLowerCase() === name)?.value ?? "";
  check("CSP header present", (await h("content-security-policy")).length > 0);
  check("nosniff header present", (await h("x-content-type-options")) === "nosniff");
  check("frameguard header present", (await h("x-frame-options")) === "SAMEORIGIN");
  check("HSTS header present", (await h("strict-transport-security")).includes("max-age"));
  check("x-powered-by not leaked", (await h("x-powered-by")) === "");

  // 2. CORS allowlist
  const evil = await r.get(`${BACKEND}/health`, { headers: { Origin: "https://evil.example" } });
  const evilAcao = (await evil.headersArray()).find((x) => x.name.toLowerCase() === "access-control-allow-origin")?.value;
  check("unknown origin gets no CORS echo", !evilAcao, evilAcao ?? "absent");
  const friend = await r.get(`${BACKEND}/health`, { headers: { Origin: "http://localhost:5173" } });
  const friendAcao = (await friend.headersArray()).find((x) => x.name.toLowerCase() === "access-control-allow-origin")?.value;
  check("allowed origin gets CORS echo", friendAcao === "http://localhost:5173", friendAcao ?? "absent");

  // 3. Authn: missing, garbage, wrong-secret, and alg:none tokens all rejected
  const noToken = await r.get(`${BACKEND}/api/dashboard/seccheckalice`);
  check("missing token rejected", noToken.status() === 401, String(noToken.status()));
  const garbage = await r.get(`${BACKEND}/api/dashboard/seccheckalice`, {
    headers: { Authorization: "Bearer aaa.bbb.ccc" },
  });
  check("garbage token rejected", garbage.status() === 401, String(garbage.status()));
  const algNone = jwt.sign({ id: "507f1f77bcf86cd799439011", username: "seccheckalice", displayName: "X" }, null, {
    algorithm: "none",
  });
  const noneRes = await r.get(`${BACKEND}/api/dashboard/seccheckalice`, {
    headers: { Authorization: `Bearer ${algNone}` },
  });
  check("alg:none token rejected (HS256 pin)", noneRes.status() === 401, String(noneRes.status()));
  if (secret) {
    const wrongSecret = await r.get(`${BACKEND}/api/dashboard/seccheckalice`, {
      headers: { Authorization: `Bearer ${mint("seccheckalice", "not-the-real-secret-123456")}` },
    });
    check("wrong-secret token rejected", wrongSecret.status() === 401, String(wrongSecret.status()));
  }

  // 4. Authz: a valid token for one real student must not read another's data.
  //
  // Uses two genuine accounts in their OWN cookie-free context. Two things bit
  // here, both worth remembering:
  //
  //   - The original check minted a token for a made-up ObjectId. It passed only
  //     because nothing verified the account existed; once `requireAuth` started
  //     doing so (so deleting an account revokes access) the same token correctly
  //     returned 401, and the check was measuring the wrong thing entirely.
  //   - Registering both accounts on a shared client leaves the second one's
  //     cookie in the jar, and a cookie outranks an Authorization header — so
  //     "owner token, shared jar" authenticated as the attacker. The gate below
  //     lives on its own client for the same reason the refresh tests do.
  if (secret) {
    const authzCtx = await browser.newContext();
    const authzPage = await authzCtx.newPage();
    const ar = authzPage.request;

    const mk = async (name) => {
      const res = await ar.post(`${BACKEND}/api/auth/register`, {
        headers: CSRF,
        data: { username: name, password: "authz-pass-12345" },
      });
      const body = await res.json();
      // Drop the cookie this registration just set, so the calls below are
      // authenticated by the bearer token alone.
      await authzCtx.clearCookies();
      return body;
    };
    const owner = await mk(`secauthz${Math.floor(Math.random() * 1e6)}`);
    const attacker = await mk(`secintr${Math.floor(Math.random() * 1e6)}`);
    check("two real accounts created for the authz checks", Boolean(owner.token && attacker.token));

    const own = await ar.get(`${BACKEND}/api/dashboard/${owner.user.username}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    check("a student can read their own dashboard", own.status() === 200, String(own.status()));

    const cross = await ar.get(`${BACKEND}/api/dashboard/${owner.user.username}`, {
      headers: { Authorization: `Bearer ${attacker.token}` },
    });
    check(
      "cross-user dashboard blocked (403)",
      cross.status() === 403,
      `${cross.status()} — an authenticated attacker reached another student's data`,
    );

    // And the same for the session transcript, which carries the student's own words.
    const crossSession = await ar.get(`${BACKEND}/api/sessions/${owner.user.username}`, {
      headers: { Authorization: `Bearer ${attacker.token}` },
    });
    check(
      "cross-user conversation blocked (403)",
      crossSession.status() === 403,
      String(crossSession.status()),
    );
    await authzCtx.close();
  } else {
    check("JWT_SECRET readable for authz checks", false, ".env not found from script cwd");
  }

  // A fresh, cookie-free client for the refresh-token tests.
  //
  // The session is a cookie now, and the refresh route prefers the cookie over an
  // explicit body token — correct for a browser, wrong for a test that is
  // deliberately replaying a *specific* token. The trap is easy to miss:
  // registering a throwaway account drops a live cookie in the jar, and from that
  // moment every `/refresh` is answered by the cookie. "Replayed refresh token
  // rejected" returned 200 for exactly this reason — the request never replayed
  // anything, it just presented a fresh session.
  //
  // So cookies are cleared immediately after registering. Everything after that
  // is driven purely by the token in the request body, which is what these
  // checks are actually about.
  const cleanClient = async () => {
    const ctx = await browser.newContext();
    // `newPage()` is async. Without the await the first `.request` on it is
    // `undefined`, which surfaces as a confusing error at the *next* context
    // creation rather than here.
    const p = await ctx.newPage();
    const client = {
      r: {
        get: (url, opts) => p.request.get(url, opts),
        /**
         * Post, then drop any cookie the response set.
         *
         * Clearing after EVERY call is the point, not just after registering: a
         * successful `/refresh` rotates and re-issues the refresh cookie, so the
         * very next call is authenticated by it and the token in the body is
         * ignored. That is what made "replayed refresh token rejected" return
         * 200 — the replay was answered by the cookie the legitimate refresh had
         * just minted, so nothing was ever replayed.
         */
        async post(url, opts = {}) {
          const res = await p.request.post(url, {
            ...opts,
            headers: { ...CSRF, ...(opts.headers ?? {}) },
          });
          await ctx.clearCookies();
          return res;
        },
      },
      async register(data) {
        return client.r.post(`${BACKEND}/api/auth/register`, { data });
      },
      close: () => ctx.close(),
    };
    return client;
  };

  // 5. Refresh tokens: rotation, reuse detection, and that the response never
  //    echoes the credential back.
  const clean = await cleanClient();
  const refreshUser = `secrefresh${Math.floor(Math.random() * 1e6)}`;
  const reg = await clean.register({
    username: refreshUser,
    password: "refresh-pass-12345",
    displayName: "Refresh",
  });
  const regBody = await reg.json();
  check("register issues a refresh token", Boolean(regBody.refreshToken));

  const first = await clean.r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: regBody.refreshToken },
  });
  const firstBody = await first.json();
  check("refresh returns a new access token", first.status() === 200 && Boolean(firstBody.token));
  check(
    "refresh rotates the refresh token",
    Boolean(firstBody.refreshToken) && firstBody.refreshToken !== regBody.refreshToken,
  );
  check("refresh response does not echo the old token", !JSON.stringify(firstBody).includes(regBody.refreshToken));

  // Replaying the spent token is the replay-attack case: the family is revoked.
  const replay = await clean.r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: regBody.refreshToken },
  });
  check("replayed refresh token rejected", replay.status() === 401, String(replay.status()));

  // ...and because reuse revoked the family, the rotated token is dead too.
  const afterBreach = await clean.r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: firstBody.refreshToken },
  });
  check(
    "reuse detection revokes the whole token family",
    afterBreach.status() === 401,
    String(afterBreach.status()),
  );

  const noRefreshToken = await clean.r.post(`${BACKEND}/api/auth/refresh`, { data: {} });
  check(
    "refresh without a token rejected",
    noRefreshToken.status() === 400,
    String(noRefreshToken.status()),
  );
  const junk = await clean.r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: "not-a-real-token" },
  });
  check("unknown refresh token rejected", junk.status() === 401, String(junk.status()));
  // The same absence, on the endpoint that decides whether a reload is signed in.
  const cleanMe = await clean.r.get(`${BACKEND}/api/auth/me`);
  check(
    "an unauthenticated /me is rejected",
    cleanMe.status() === 401,
    String(cleanMe.status()),
  );
  // A normal rotation (no reuse) must keep working, so the revocation above is
  // specific to the breach and not a blanket kill.
  //
  // Still on the clean client: `page`'s jar now holds a live refresh cookie from
  // the registration above, so a refresh here would be answered by that cookie
  // and the check would pass without ever testing the revocation.
  const reg2 = await clean.register({
    username: `secrefresh2${Math.floor(Math.random() * 1e6)}`,
    password: "refresh-pass-12345",
    displayName: "Refresh2",
  });
  const reg2Body = await reg2.json();
  const rotated = await clean.r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: reg2Body.refreshToken },
  });
  const rotatedBody = await rotated.json();
  check("a second rotation succeeds", rotated.status() === 200 && Boolean(rotatedBody.token));
  const logout = await clean.r.post(`${BACKEND}/api/auth/logout`, {
    headers: { Authorization: `Bearer ${rotatedBody.token}` },
  });
  check("logout revokes refresh tokens", logout.status() === 200);
  const afterLogout = await clean.r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: rotatedBody.refreshToken },
  });
  check("refresh token is dead after logout", afterLogout.status() === 401, String(afterLogout.status()));
  await clean.close();

  // 6. Session cookies: the properties that make the credential unreadable by a
  //    script, and the CSRF guard that replaces what SameSite alone cannot cover.
  //
  //    These assert the security *contract*, not the implementation. If someone
  //    later moves the token back into localStorage, every one of these fails —
  //    which is the only reason to write them down.
  const cookieUser = `seccookie${Math.floor(Math.random() * 1e6)}`;
  const cookieReg = await r.post(`${BACKEND}/api/auth/register`, {
    data: { username: cookieUser, password: "cookie-pass-12345", displayName: "Cookie" },
  });
  const setCookies = (cookieReg.headersArray() ?? [])
    .filter((c) => c.name.toLowerCase() === "set-cookie")
    .map((c) => c.value);
  const accessCookie = setCookies.find((c) => c.startsWith("agented_access="));
  const refreshCookie = setCookies.find((c) => c.startsWith("agented_refresh="));
  check(
    "registration sets an access cookie",
    Boolean(accessCookie),
    accessCookie ? accessCookie.split(";")[0] : "no access cookie",
  );
  check(
    "registration sets a refresh cookie",
    Boolean(refreshCookie),
    refreshCookie ? refreshCookie.split(";")[0] : "no refresh cookie",
  );
  // The whole point of the change. Without `HttpOnly` a token in localStorage is
  // exactly as exposed as it was before.
  check(
    "both session cookies are httpOnly",
    Boolean(accessCookie && refreshCookie) &&
      /httponly/i.test(accessCookie) &&
      /httponly/i.test(refreshCookie),
    `access=${/httponly/i.test(accessCookie ?? "")} refresh=${/httponly/i.test(refreshCookie ?? "")}`,
  );
  // SameSite is the CSRF defence that does not depend on the app cooperating.
  check(
    "session cookies are SameSite=Lax",
    Boolean(accessCookie && refreshCookie) &&
      /samesite=lax/i.test(accessCookie) &&
      /samesite=lax/i.test(refreshCookie),
    `access=${/samesite=lax/i.test(accessCookie ?? "")} refresh=${/samesite=lax/i.test(refreshCookie ?? "")}`,
  );
  // `Secure` is only set in production, so it must NOT be set over plain HTTP in
  // dev — a cookie marked Secure on http://localhost silently vanishes, and the
  // symptom is "login is broken" with nothing in the logs.
  check(
    "cookies are not marked Secure outside production (so localhost works)",
    Boolean(accessCookie) && !/;\s*secure/i.test(accessCookie),
    accessCookie ? "not marked Secure" : "no cookie",
  );

  // A separate client so the cookie jar is scoped to this one check and cannot
  // leak into (or be leaked by) the rest of the suite.
  const jar = await browser.newContext();
  const jarPage = await jar.newPage();
  const jarRes = await jarPage.request.post(`${BACKEND}/api/auth/register`, {
    headers: CSRF,
    data: { username: `secjar${Math.floor(Math.random() * 1e6)}`, password: "jar-pass-12345" },
  });
  check("jar client registered", jarRes.status() === 201, String(jarRes.status()));

  const meWithCookie = await jarPage.request.get(`${BACKEND}/api/auth/me`);
  check(
    "the cookie alone authenticates (no bearer header)",
    meWithCookie.status() === 200,
    String(meWithCookie.status()),
  );
  const meBody = await meWithCookie.json().catch(() => ({}));
  check(
    "/me returns the user and no token",
    Boolean(meBody.user?.username) && meBody.token === undefined,
    meBody.user?.username ?? "no user",
  );

  // CSRF: a cross-site caller can attach the cookie automatically but cannot set
  // the custom header, because doing so needs a CORS preflight this server
  // refuses. This is that attack, asserted.
  const csrfAttempt = await jarPage.request.patch(`${BACKEND}/api/auth/language`, {
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    data: { language: "hi" },
  });
  check(
    "a cross-site write without the app header is blocked (CSRF)",
    csrfAttempt.status() === 403,
    String(csrfAttempt.status()),
  );

  const legitWrite = await jarPage.request.patch(`${BACKEND}/api/auth/language`, {
    headers: { ...CSRF, "Content-Type": "application/json" },
    data: { language: "hi" },
  });
  check(
    "the same write from the app succeeds (guard is not blanket-blocking)",
    legitWrite.status() === 200,
    String(legitWrite.status()),
  );

  // Signing out must leave nothing behind that could sign the student back in.
  // The deletions have to be read from the LOGOUT response — a later GET carries
  // no Set-Cookie at all, so asserting on it would pass even if logout cleared
  // nothing. That was the first version, and it was checking the wrong response.
  const jarLogout = await jarPage.request.post(`${BACKEND}/api/auth/logout`, { headers: CSRF });
  const meAfterLogout = await jarPage.request.get(`${BACKEND}/api/auth/me`);
  check(
    "signing out clears the cookie (no silent sign-in on reload)",
    meAfterLogout.status() === 401,
    String(meAfterLogout.status()),
  );
  const clearCookies = (jarLogout.headersArray() ?? [])
    .filter((c) => c.name.toLowerCase() === "set-cookie")
    .map((c) => c.value);
  check(
    "logout sends Set-Cookie deletions for both credentials",
    clearCookies.some((c) => /agented_access=;/.test(c)) &&
      clearCookies.some((c) => /agented_refresh=;/.test(c)),
    clearCookies.length ? `${clearCookies.length} cleared: ${clearCookies.join(" | ")}` : "none cleared",
  );
  await jar.close();

  // 7. Consent enforcement — the promise the privacy notice makes.
  //
  // This is the whole point of the flow, and it has to be tested as an attacker
  // rather than as a well-behaved client: a fresh account with a valid session
  // that tries to send a question to a provider without agreeing to anything.
  const gate = await browser.newContext();
  const gatePage = await gate.newPage();
  const g = gatePage.request;
  const gateUser = `secgate${Math.floor(Math.random() * 1e6)}`;
  const gateReg = await g.post(`${BACKEND}/api/auth/register`, {
    headers: CSRF,
    data: { username: gateUser, password: "gate-pass-12345" },
  });
  const gateRegBody = await gateReg.json();
  check("gate client registered", gateReg.status() === 201, String(gateReg.status()));

  const gChat = (msg) =>
    g.post(`${BACKEND}/api/chat`, {
      headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
      data: {
        studentId: gateUser,
        activeTopic: "machine learning",
        studentMessage: msg,
        mode: "socratic",
      },
    });

  const blocked = await gChat("what is machine learning?");
  const blockedBody = await blocked.json().catch(() => ({}));
  check(
    "a question without consent never reaches the AI provider",
    blocked.status() === 403 && blockedBody.code === "CONSENT_REQUIRED",
    `${blocked.status()} ${blockedBody.code ?? ""}`,
  );
  check(
    "the refusal explains itself rather than saying 'try again'",
    typeof blockedBody.error === "string" && /adult|guardian/i.test(blockedBody.error),
    String(blockedBody.error ?? "").slice(0, 60),
  );

  const blockedTest = await g.post(`${BACKEND}/api/assessment/start`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
    data: {},
  });
  check("assessments are gated the same way", blockedTest.status() === 403, String(blockedTest.status()));

  // A minor agreeing for themselves must not be enough. This is the exact
  // loophole the whole flow exists to close.
  const solo = await g.post(`${BACKEND}/api/auth/consent`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
    data: { ageBand: "13-17", acceptedTerms: true },
  });
  const soloBody = await solo.json().catch(() => ({}));
  check("a minor cannot consent alone", solo.status() === 400, String(solo.status()));
  check("and the refusal names the guardian requirement", soloBody.needsGuardian === true);
  check("the gated question is still blocked after that attempt", (await gChat("try again")).status() === 403);

  // With an adult's agreement it opens — which also proves the gate is a real
  // check rather than a blanket refusal.
  const ok = await g.post(`${BACKEND}/api/auth/consent`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
    data: { ageBand: "13-17", acceptedTerms: true, guardianName: "Mrs Sharma", guardianAccepted: true },
  });
  const okBody = await ok.json().catch(() => ({}));
  check("guardian consent opens the gate", ok.status() === 200 && okBody.canUseAi === true, String(ok.status()));
  check("the adult's name is recorded", okBody.consent?.by === "Mrs Sharma", String(okBody.consent?.by));

  // Withdrawal has to bite immediately, not whenever the 30-minute token expires.
  await g.delete(`${BACKEND}/api/auth/consent`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
  });
  check(
    "withdrawing consent blocks the AI again immediately",
    (await gChat("and now?")).status() === 403,
  );

  // Everything that does NOT involve a provider stays available. Refusing a
  // minor their own account would be a worse outcome than not teaching them.
  const dashboard = await g.get(`${BACKEND}/api/dashboard/${gateUser}`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
  });
  check("the dashboard still works without consent", dashboard.status() === 200, String(dashboard.status()));

  // Export must work regardless — the right to see your data cannot depend on
  // having agreed to anything.
  const exported = await g.get(`${BACKEND}/api/account/export`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
  });
  check("a student can export their data without consenting", exported.status() === 200, String(exported.status()));

  // Erasure, and the session it must revoke.
  const erased = await g.delete(`${BACKEND}/api/account`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
  });
  check("the account can be deleted", erased.status() === 200, String(erased.status()));
  const afterErase = await g.get(`${BACKEND}/api/auth/me`, {
    headers: { ...CSRF, Authorization: `Bearer ${gateRegBody.token}` },
  });
  check(
    "deleting the account revokes its live session",
    afterErase.status() === 401,
    `${afterErase.status()} — a deleted account was still authenticated`,
  );
  await gate.close();

  // 6. Optional: assert the auth limiter's 429 path (burns 10+ auth attempts).
  if (process.env.SECURITY_TEST_RATELIMIT === "1") {
    let sawThrottle = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await r.post(`${BACKEND}/api/auth/login`, {
        data: { username: `secrat${i}`, password: "wrong-password-1" },
      });
      if (res.status() === 429) {
        sawThrottle = true;
        break;
      }
    }
    check("auth rate limiter returns 429 (optional run)", sawThrottle);
  }
} catch (error) {
  check("unexpected failure", false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} security checks passed`);
process.exit(failed.length ? 1 : 0);

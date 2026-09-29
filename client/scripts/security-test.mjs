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

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const r = await page.request;

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

  // 4. Authz: a valid token for another student must not read their data
  if (secret) {
    const cross = await r.get(`${BACKEND}/api/dashboard/seccheckalice`, {
      headers: { Authorization: `Bearer ${evilToken}` },
    });
    check("cross-user dashboard blocked (403)", cross.status() === 403, String(cross.status()));
  } else {
    check("JWT_SECRET readable for authz checks", false, ".env not found from script cwd");
  }

  // 5. Refresh tokens: rotation, reuse detection, and that the response never
  //    echoes the credential back.
  const refreshUser = `secrefresh${Math.floor(Math.random() * 1e6)}`;
  const reg = await r.post(`${BACKEND}/api/auth/register`, {
    data: { username: refreshUser, password: "refresh-pass-12345", displayName: "Refresh" },
  });
  const regBody = await reg.json();
  check("register issues a refresh token", Boolean(regBody.refreshToken));

  const first = await r.post(`${BACKEND}/api/auth/refresh`, {
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
  const replay = await r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: regBody.refreshToken },
  });
  check("replayed refresh token rejected", replay.status() === 401, String(replay.status()));

  // ...and because reuse revoked the family, the rotated token is dead too.
  const afterBreach = await r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: firstBody.refreshToken },
  });
  check(
    "reuse detection revokes the whole token family",
    afterBreach.status() === 401,
    String(afterBreach.status()),
  );

  const noRefreshToken = await r.post(`${BACKEND}/api/auth/refresh`, { data: {} });
  check(
    "refresh without a token rejected",
    noRefreshToken.status() === 400,
    String(noRefreshToken.status()),
  );
  const junk = await r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: "not-a-real-token" },
  });
  check("unknown refresh token rejected", junk.status() === 401, String(junk.status()));

  // A normal rotation (no reuse) must keep working, so the revocation above is
  // specific to the breach and not a blanket kill.
  const reg2 = await r.post(`${BACKEND}/api/auth/register`, {
    data: {
      username: `secrefresh2${Math.floor(Math.random() * 1e6)}`,
      password: "refresh-pass-12345",
      displayName: "Refresh2",
    },
  });
  const reg2Body = await reg2.json();
  const rotated = await r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: reg2Body.refreshToken },
  });
  const rotatedBody = await rotated.json();
  check("a second rotation succeeds", rotated.status() === 200 && Boolean(rotatedBody.token));
  const logout = await r.post(`${BACKEND}/api/auth/logout`, {
    headers: { Authorization: `Bearer ${rotatedBody.token}` },
  });
  check("logout revokes refresh tokens", logout.status() === 200);
  const afterLogout = await r.post(`${BACKEND}/api/auth/refresh`, {
    data: { refreshToken: rotatedBody.refreshToken },
  });
  check("refresh token is dead after logout", afterLogout.status() === 401, String(afterLogout.status()));

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

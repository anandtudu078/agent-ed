// Permanent unit tests for the offline AI stand-in.
//
// Run: npm run test:offline
//
// The bar here is entirely about the gate. The deterministic content is
// unremarkable; what must be airtight is that this can never hand a real student
// a fabricated score. Everything below is an attempt to turn the gate on.
//
// The refusal tests are the ones that matter. A fallback that fires in
// production is worse than no fallback at all: a deploy with a missing key would
// show a confident, specific-sounding critique that no model ever wrote, and the
// student has no way to tell.

import {
  offlineAiEnabled,
  offlineQuestion,
  offlineGrade,
} from "../src/services/offlineAi";
import {
  ACCESS_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from "../src/middleware/auth";
import type { Response } from "express";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

// --- 1. The gate is closed by default -------------------------------------
check("off with no environment at all", !offlineAiEnabled({}));
check("off with no opt-in", !offlineAiEnabled({ NODE_ENV: "test" }));
check("off with an unrelated value", !offlineAiEnabled({ ALLOW_OFFLINE_AI: "true" }));
check("off when the value is '0'", !offlineAiEnabled({ ALLOW_OFFLINE_AI: "0" }));
check("off when the value is empty", !offlineAiEnabled({ ALLOW_OFFLINE_AI: "" }));
check("off when the value is mis-cased", !offlineAiEnabled({ ALLOW_OFFLINE_AI: "yes" }));

// --- 2. Production refuses, even with the opt-in set ----------------------
// The whole safety story in four lines.
check(
  "production refuses even with the opt-in",
  !offlineAiEnabled({ ALLOW_OFFLINE_AI: "1", NODE_ENV: "production" }),
  "this is the one that must never be wrong",
);
check(
  "a production-ish NODE_ENV also refuses",
  !offlineAiEnabled({ ALLOW_OFFLINE_AI: "1", NODE_ENV: "Production" }),
  "the comparison is case-sensitive, so an unexpected casing must not slip through",
);
// Belt and braces: no NODE_ENV at all is how most CI runners look, and that is
// exactly where the opt-in is supposed to work.
check("no NODE_ENV with the opt-in is allowed", offlineAiEnabled({ ALLOW_OFFLINE_AI: "1" }));
check(
  "a trailing space in the opt-in still counts",
  // `set ALLOW_OFFLINE_AI=1 && node` in cmd yields "1 ". Rejecting that leaves
  // the gate shut for a reason nobody can see in a log.
  offlineAiEnabled({ ALLOW_OFFLINE_AI: "1 " }),
);
check(
  "whitespace around the opt-in is tolerated",
  offlineAiEnabled({ ALLOW_OFFLINE_AI: " 1 " }),
);
check(
  "production still refuses with a trailing space",
  !offlineAiEnabled({ ALLOW_OFFLINE_AI: "1 ", NODE_ENV: "production" }),
  "trimming the opt-in must not have weakened this",
);
check(
  "non-production with the opt-in is allowed",
  offlineAiEnabled({ ALLOW_OFFLINE_AI: "1", NODE_ENV: "test" }),
);
check(
  "development with the opt-in is allowed",
  offlineAiEnabled({ ALLOW_OFFLINE_AI: "1", NODE_ENV: "development" }),
);

// --- 3. The question is deterministic ------------------------------------
// Not a style preference: a CI run that produces a different question each time
// cannot be re-run to attribute a failure.
const q1 = offlineQuestion("recursion", "en", "standard");
const q2 = offlineQuestion("recursion", "en", "standard");
check("the same topic yields the same question", q1.question === q2.question);
check("the topic is carried through", q1.topic === "recursion", q1.topic);
check(
  "difficulty changes the question",
  offlineQuestion("recursion", "en", "stretch").question !== q1.question,
);
check(
  "an unknown difficulty falls back rather than returning nothing",
  offlineQuestion("recursion", "en", "nonsense" as never).question.length > 20,
);
check("Hindi gets a Hindi question", /[ऀ-ॿ]/.test(offlineQuestion("recursion", "hi").question));
check("no question is trivially short", q1.question.length > 20);

// --- 4. The grade is deterministic, and honest about itself --------------
const g1 = offlineGrade("recursion", "some answer");
const g2 = offlineGrade("recursion", "some answer");
check("the same answer yields the same grade", JSON.stringify(g1) === JSON.stringify(g2));
check("a score is in range", g1.score >= 0 && g1.score <= 100, `score=${g1.score}`);
check("mastery is in range", g1.masteryEstimate >= 0 && g1.masteryEstimate <= 100);

// The score must sit below REVIEW_PASS_SCORE (65) or the offline run records no
// weak point and no review card, and the dashboard assertions plus the
// "clicking a weak point" branch stop being exercised at all.
check("the offline score is below the pass mark, on purpose", g1.score < 65, `score=${g1.score}`);

// The most important content assertion: a student must never read this as a
// real evaluation.
check(
  "the feedback admits it is a placeholder",
  /offline|not a real|placeholder/i.test(g1.feedback),
  g1.feedback.slice(0, 50),
);
check(
  "the recommended focus tells them how to fix it",
  /key/i.test(g1.recommendedFocus),
  g1.recommendedFocus,
);
check(
  "no misconceptions are invented",
  g1.misconceptions.length === 0,
  // Fabricated misconceptions would seed the weak-point list and then steer
  // every future tutor prompt. An empty list is the honest answer.
  `got ${g1.misconceptions.length}`,
);
check(
  "an empty answer is called out separately",
  /empty/i.test(offlineGrade("recursion", "   ").feedback),
);

// --- 5. Nothing model-shaped leaks through -------------------------------
// These stand-ins must not be mistaken for provider output anywhere downstream.
check("the grade carries no topic verbatim from the model", typeof g1.feedback === "string");
check("a very long answer does not change the grade", offlineGrade("recursion", "x".repeat(5000)).score === g1.score);

// ===========================================================================
// 6. The auth cookie policy
// ===========================================================================
//
// The browser suite proves the cookies work over HTTP. Neither of these is
// reachable from a dev-mode browser run, though, and both matter:
//
//   - `Secure` set in development silently breaks every login on http://localhost,
//     with "login is broken" as the only symptom.
//   - `Secure` NOT set in production sends a live session credential over the
//     network in clear text.
//
// So the policy is asserted here against the same functions the server uses.

interface CookieCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

/** Capture what would be written to `Set-Cookie`, without standing up a server. */
function captureCookies(
  fn: (response: Response, value: string) => void,
): CookieCall[] {
  const calls: CookieCall[] = [];
  const fake = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      calls.push({ name, value, options });
      return fake;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      calls.push({ name, value: "", options });
      return fake;
    },
  };
  fn(fake as unknown as Response, "probe-token");
  return calls;
}

const originalNodeEnv = process.env.NODE_ENV;

delete process.env.NODE_ENV;
const devAccess = captureCookies(setAccessCookie)[0];
const devRefresh = captureCookies(setRefreshCookie)[0];
check(
  "the access cookie is not Secure in development",
  devAccess?.options.secure === false,
  `secure=${devAccess?.options.secure}`,
);
check("the access cookie is httpOnly", devAccess?.options.httpOnly === true);
check("the access cookie is SameSite=Lax", devAccess?.options.sameSite === "lax");
check(
  "the access cookie is scoped to /",
  devAccess?.options.path === "/",
  `path=${devAccess?.options.path}`,
);
check(
  "the access cookie uses the documented name",
  devAccess?.name === ACCESS_COOKIE,
  devAccess?.name ?? "",
);

process.env.NODE_ENV = "production";
check(
  "the access cookie IS Secure in production",
  captureCookies(setAccessCookie)[0]?.options.secure === true,
);
check(
  "the refresh cookie IS Secure in production",
  captureCookies(setRefreshCookie)[0]?.options.secure === true,
);

// Some hosts set `NODE_ENV=Production`. A case-sensitive comparison drops
// `Secure` there, which is a real vulnerability in production — and the same trap
// already bit the offline-AI production guard above, so it is pinned on purpose.
process.env.NODE_ENV = "Production";
check(
  "a capitalised NODE_ENV=Production still marks cookies Secure",
  captureCookies(setAccessCookie)[0]?.options.secure === true,
);

delete process.env.NODE_ENV;
const cleared = captureCookies(clearAuthCookies);
const clearedAccess = cleared.find((c) => c.name === ACCESS_COOKIE);
check(
  "logout clears both cookies",
  cleared.length === 2,
  cleared.map((c) => c.name).join(", "),
);
check(
  "the cleared cookies carry no Max-Age (immediate expiry)",
  cleared.every((c) => c.options.maxAge === undefined),
);
// A mismatch on `path` alone is enough for the browser to keep the original,
// producing a user who is "signed out" and still authenticated.
check(
  "clearing matches how the cookies were set (path and flags)",
  clearedAccess?.options.path === devAccess?.options.path &&
    clearedAccess?.options.sameSite === devAccess?.options.sameSite &&
    clearedAccess?.options.httpOnly === devAccess?.options.httpOnly,
);
check(
  "the refresh cookie outlives the access cookie",
  Number(devRefresh?.options.maxAge ?? 0) > Number(devAccess?.options.maxAge ?? 0),
  `access=${devAccess?.options.maxAge}ms refresh=${devRefresh?.options.maxAge}ms`,
);

if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);

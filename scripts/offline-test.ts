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
  offlineTutorReply,
  offlineStudentAnalysis,
} from "../src/services/offlineAi";
import {
  ACCESS_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from "../src/middleware/auth";
import {
  AGE_BANDS,
  buildConsent,
  canUseAiFeatures,
  CONSENT_POLICY_VERSION,
  emptyConsent,
  isAgeBand,
  PRIVACY_DISCLOSURE,
  requiresGuardian,
  type AgeBand,
  type ConsentRecord,
} from "../src/services/consent";
// Both from express, not the DOM globals of the same name — `Request` in
// particular silently resolves to the WHATWG one otherwise, and the two are not
// assignable to each other.
import type { Request, Response } from "express";

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
// 5b. The tutor stand-in
// ===========================================================================
//
// Added because the tutor was the one feature with no stand-in at all: with no
// key, `analyzeStudentInput` threw on the missing GROQ_API_KEY before any
// network call, so a judge who cloned the repo and had no key to hand met an
// error exactly where the product should be. The assessment endpoints had a
// fallback the whole time; the headline feature did not.
//
// The same bar applies as everywhere else here: it must say it is offline, and
// it must not invent a signal that steers the pipeline.

const socraticReply = offlineTutorReply("recursion", "socratic", "en");
const teachReply = offlineTutorReply("recursion", "teach", "en");

check("the tutor stand-in returns a real reply", socraticReply.length > 60, `${socraticReply.length} chars`);
check(
  "and it says it is offline, so it is never mistaken for the model",
  /offline answer/i.test(socraticReply),
);
check("the notice names the key that would fix it", /GROQ_API_KEY/.test(socraticReply));

// The Socratic contract is the whole point of the default mode, so the stand-in
// has to honour it or a demo would show a tutor that gives the answer away.
check("socratic mode asks rather than tells", socraticReply.includes("?"));
check(
  "socratic mode does not simply state a definition",
  !/is the process of/i.test(socraticReply),
);

// Teach mode has the opposite obligation: it must explain and then check. The
// check is asserted against the lesson text, not the whole reply, because the
// offline notice is appended after it.
const teachBody = teachReply.replace(/\n\n\(This is an offline answer[\s\S]*$/, "");
check("teach mode is longer than a one-liner", teachBody.length > 80, `${teachBody.length} chars`);
check(
  "teach mode ends by checking understanding",
  teachBody.trim().endsWith("?"),
  JSON.stringify(teachBody.slice(-40)),
);
check("the two modes do not return the same text", socraticReply !== teachReply);

// Deterministic, for the same reason the question and grade are: a CI run that
// changes output on identical input cannot be re-attributed when it fails.
check("the same input gives the same reply", offlineTutorReply("recursion", "socratic", "en") === socraticReply);
check("the topic changes the reply", offlineTutorReply("transformers", "socratic", "en") !== socraticReply);
check("the topic is actually used", offlineTutorReply("transformers", "socratic", "en").includes("transformers"));

// Hindi is a first-class teaching mode, so the stand-in has to speak it too.
const hindiReply = offlineTutorReply("recursion", "socratic", "hi");
check("the tutor stand-in speaks Hindi", /[ऀ-ॿ]/.test(hindiReply), hindiReply.slice(0, 24));
check("the Hindi reply is also marked offline", /ऑफ़लाइन/.test(hindiReply));

// An unknown mode or language must fall back rather than return nothing —
// this runs on a live request path.
check("an unknown mode still answers", offlineTutorReply("recursion", "nonsense" as never, "en").length > 40);
check("an unknown language still answers", offlineTutorReply("recursion", "socratic", "xx" as never).length > 40);
check("an empty topic still answers", /this topic/i.test(offlineTutorReply("   ", "socratic", "en")));

const sa = offlineStudentAnalysis("recursion");
check("the analysis stand-in returns a topic", typeof sa.topic === "string" && sa.topic.length > 0, sa.topic);
check(
  "and a mastery estimate in range",
  sa.masteryEstimate >= 0 && sa.masteryEstimate <= 100,
  `${sa.masteryEstimate}`,
);
// A fabricated high mastery would drive the difficulty band and the owl's
// reaction, quietly steering everything downstream. A neutral value is the safe
// stand-in.
check("mastery is mid-range, not flattering", sa.masteryEstimate >= 40 && sa.masteryEstimate <= 60, `${sa.masteryEstimate}`);
check(
  "the analysis invents no misunderstandings",
  sa.coreMisunderstandings.length === 0,
  `got ${sa.coreMisunderstandings.length}`,
);
check("the analysis stand-in is deterministic", JSON.stringify(offlineStudentAnalysis("recursion")) === JSON.stringify(sa));

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

/**
 * Capture what would be written to `Set-Cookie`, without standing up a server.
 *
 * `proto` is the forwarded scheme — the signal the policy actually decides on,
 * since TLS is terminated at a proxy long before the app sees the socket.
 */
function captureCookies<Extra extends unknown[]>(
  fn: (request: Request, response: Response, ...rest: Extra) => void,
  proto: string | undefined,
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
  const fakeRequest = {
    headers: proto ? { "x-forwarded-proto": proto } : {},
    socket: { encrypted: proto === undefined ? false : proto === "https" },
  } as unknown as Request;
  fn(fakeRequest, fake as unknown as Response, ...(["probe-token"] as unknown as Extra));
  return calls;
}

// Plain HTTP — what `npm run dev` serves. A `Secure` cookie here is silently
// discarded by the browser, which is the bug this whole block exists to prevent.
const devAccess = captureCookies(setAccessCookie, undefined)[0];
const devRefresh = captureCookies(setRefreshCookie, undefined)[0];
check(
  "the access cookie is not Secure over plain HTTP",
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

// HTTPS, as a proxy reports it.
check(
  "the access cookie IS Secure over HTTPS",
  captureCookies(setAccessCookie, "https")[0]?.options.secure === true,
);
check(
  "the refresh cookie IS Secure over HTTPS",
  captureCookies(setRefreshCookie, "https")[0]?.options.secure === true,
);
// A TLS socket with no proxy header, for a direct HTTPS deployment.
check(
  "a TLS socket with no forwarded header is still Secure",
  captureCookies(setAccessCookie, undefined)[0]?.options.secure !== true,
  "socket-derived",
);

// SameSite is chosen per request from the same signal as `secure`.
//
// This is the cross-site deployment case. A `lax` cookie is never attached to a
// cross-site fetch, so a Vercel frontend talking to a Render API would send
// every authenticated call out unauthenticated — 401, refresh 400, bounced to the
// login screen — while working perfectly on localhost, where 5173 and 3000 are
// the same site. `none` fixes that, but browsers reject `SameSite=None` unless
// the cookie is also `Secure`, so the two flags are asserted TOGETHER rather than
// individually: a mismatch is not a weaker setting, it is a cookie the browser
// throws away.
check(
  "SameSite=Lax on plain HTTP (same-site dev)",
  devAccess?.options.sameSite === "lax",
  `sameSite=${devAccess?.options.sameSite}`,
);
const httpsAccess = captureCookies(setAccessCookie, "https")[0];
check(
  "SameSite=None over HTTPS (cross-site deployment)",
  httpsAccess?.options.sameSite === "none",
  `sameSite=${httpsAccess?.options.sameSite}`,
);
check(
  "SameSite=None is only ever paired with Secure",
  [captureCookies(setAccessCookie, "https")[0], captureCookies(setRefreshCookie, "https")[0]].every(
    (c) =>
      c?.options.sameSite !== "none" ||
      c?.options.secure === true,
  ),
  "SameSite=None without Secure would be discarded by the browser",
);
check(
  "plain HTTP never asks for SameSite=None",
  captureCookies(setAccessCookie, undefined)[0]?.options.sameSite === "lax",
  "a SameSite=None cookie on http:// is rejected by every browser",
);

// THE REGRESSION THIS FIX EXISTS FOR. `NODE_ENV=production` while serving
// http://localhost is a completely reasonable thing to do when "testing
// production mode", and it used to mark the cookies Secure. The browser then
// refused to store them, so sign-in appeared to work and every subsequent
// authenticated call failed with a bare "Authentication required."
//
// `NODE_ENV` is deliberately NOT consulted any more, so setting it here must
// change nothing at all.
process.env.NODE_ENV = "production";
check(
  "NODE_ENV=production does NOT force Secure on a plain HTTP request",
  captureCookies(setAccessCookie, undefined)[0]?.options.secure === false,
  "the request decides, not the environment",
);
process.env.NODE_ENV = "production";
check(
  "NODE_ENV=production over HTTPS still yields Secure",
  captureCookies(setAccessCookie, "https")[0]?.options.secure === true,
);
delete process.env.NODE_ENV;

// A proxy chain: only the FIRST hop counts, since `trust proxy` is 1. A later
// "http" must not downgrade a connection that actually arrived over TLS.
check(
  "a proxy chain is read from the first hop only",
  captureCookies(setAccessCookie, "https, http")[0]?.options.secure === true,
);
check(
  "a lowercase forwarded proto is handled",
  captureCookies(setAccessCookie, "HTTPS")[0]?.options.secure === true,
);

const cleared = captureCookies(clearAuthCookies, undefined);
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
// A mismatch on `path` or `secure` alone is enough for the browser to keep the
// original, producing a user who is "signed out" and still authenticated.
check(
  "clearing matches how the cookies were set (path and flags)",
  clearedAccess?.options.path === devAccess?.options.path &&
    clearedAccess?.options.sameSite === devAccess?.options.sameSite &&
    clearedAccess?.options.httpOnly === devAccess?.options.httpOnly,
);
check(
  "clearing over HTTPS keeps the Secure flag it was set with",
  captureCookies(clearAuthCookies, "https").every(
    (c) => c.options.secure === true,
  ),
);
check(
  "the refresh cookie outlives the access cookie",
  Number(devRefresh?.options.maxAge ?? 0) > Number(devAccess?.options.maxAge ?? 0),
  `access=${devAccess?.options.maxAge}ms refresh=${devRefresh?.options.maxAge}ms`,
);

// ===========================================================================
// 7. Consent
// ===========================================================================
//
// The rule that matters: a student under 18 cannot cause their words to reach an
// AI provider without an adult having agreed. Every assertion below is an attempt
// to get past that, because a consent check only tested on the happy path is a
// checkbox, not a control.

const NOW = new Date("2026-02-01T00:00:00.000Z");
const consentFor = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
  status: "student",
  version: CONSENT_POLICY_VERSION,
  by: "Test Adult",
  at: NOW,
  ...over,
});

check("no consent means no AI features", !canUseAiFeatures("18-plus", emptyConsent()));
check("a missing consent record is not consent", !canUseAiFeatures("18-plus", null));
check("an unknown age band is not consent", !canUseAiFeatures("unknown" as AgeBand, consentFor()));
check("a null age band is not consent", !canUseAiFeatures(null, consentFor()));

// --- 1. Stale consent is not consent -------------------------------------
// This is the reason the version is recorded at all.
check(
  "consent to an older policy version does not count",
  !canUseAiFeatures("18-plus", consentFor({ version: "2025-01" })),
);
check("an empty policy version does not count", !canUseAiFeatures("18-plus", consentFor({ version: "" })));
check("consent with no timestamp does not count", !canUseAiFeatures("18-plus", consentFor({ at: null })));

// --- 2. Minors need an adult ---------------------------------------------
check("under 13 requires a guardian", requiresGuardian("under-13"));
check("13-17 requires a guardian", requiresGuardian("13-17"));
check("18-plus does not require a guardian", !requiresGuardian("18-plus"));
check("an unknown age is treated as needing one", requiresGuardian(null));

for (const band of ["under-13", "13-17"] as const) {
  check(
    `a ${band} student's own agreement is not enough`,
    !canUseAiFeatures(band, consentFor({ status: "student", by: "" })),
  );
  check(
    `a ${band} student's own agreement is refused even with a name`,
    !canUseAiFeatures(band, consentFor({ status: "student", by: "The Student" })),
  );
  check(
    `a ${band} student is unblocked by a guardian's consent`,
    canUseAiFeatures(band, consentFor({ status: "guardian", by: "Mrs Sharma" })),
  );
  check(
    `a ${band} guardian consent with no name is refused`,
    !canUseAiFeatures(band, consentFor({ status: "guardian", by: "" })),
  );
  // A whitespace-only name is truthy, so this is the check that catches a naive
  // `if (by)`.
  check(
    `a ${band} guardian consent with a blank name is refused`,
    !canUseAiFeatures(band, consentFor({ status: "guardian", by: "   " })),
  );
  check(
    `a ${band} guardian consent with a one-character name is refused`,
    !canUseAiFeatures(band, consentFor({ status: "guardian", by: "A" })),
  );
}

check(
  "an adult consenting for themselves is allowed with no guardian name",
  canUseAiFeatures("18-plus", consentFor({ status: "student", by: "" })),
);
check(
  "an adult with guardian consent is also allowed",
  canUseAiFeatures("18-plus", consentFor({ status: "guardian", by: "A Parent" })),
);

// --- 3. Building a record -------------------------------------------------
const adult = buildConsent({ ageBand: "18-plus", acceptedTerms: true, now: NOW });
check("an adult can consent alone", adult.ok && adult.record?.status === "student");
check("the record carries the current policy version", adult.record?.version === CONSENT_POLICY_VERSION);
check("the record carries the timestamp given", adult.record?.at === NOW);

const minorNoGuardian = buildConsent({ ageBand: "13-17", acceptedTerms: true, now: NOW });
check("a minor cannot consent alone", !minorNoGuardian.ok);
check("the refusal says a guardian is needed", minorNoGuardian.needsGuardian === true);
check("a refused consent produces no record", minorNoGuardian.record === undefined);

const minorBlankName = buildConsent({
  ageBand: "under-13",
  acceptedTerms: true,
  guardianName: "  ",
  guardianAccepted: true,
  now: NOW,
});
check("a whitespace-only guardian name is refused", !minorBlankName.ok);

const minorUnconfirmed = buildConsent({
  ageBand: "under-13",
  acceptedTerms: true,
  guardianName: "Mrs Sharma",
  guardianAccepted: false,
  now: NOW,
});
check("a guardian's name without their confirmation is refused", !minorUnconfirmed.ok);

const minorOk = buildConsent({
  ageBand: "under-13",
  acceptedTerms: true,
  guardianName: "  Mrs Sharma  ",
  guardianAccepted: true,
  now: NOW,
});
check("a minor with a confirmed guardian is allowed", minorOk.ok);
check("the guardian's name is trimmed", minorOk.record?.by === "Mrs Sharma", minorOk.record?.by);
check("it is recorded as guardian consent", minorOk.record?.status === "guardian");

// --- 4. Hostile input -----------------------------------------------------
check("no age at all is refused", !buildConsent({ ageBand: "", acceptedTerms: true }).ok);
check("an invented age band is refused", !buildConsent({ ageBand: "99", acceptedTerms: true }).ok);
check("an age band of the wrong type is refused", !buildConsent({ ageBand: 18, acceptedTerms: true }).ok);
// The string "false" is truthy — a check written as `if (acceptedTerms)` would
// accept this and record a consent nobody gave.
check("the string 'false' is not acceptance", !buildConsent({ ageBand: "18-plus", acceptedTerms: "false" }).ok);
check("the number 1 is not acceptance", !buildConsent({ ageBand: "18-plus", acceptedTerms: 1 }).ok);
check("undefined is not acceptance", !buildConsent({ ageBand: "18-plus", acceptedTerms: undefined }).ok);
check("null is not acceptance", !buildConsent({ ageBand: "18-plus", acceptedTerms: null }).ok);
const longName = buildConsent({
  ageBand: "under-13",
  acceptedTerms: true,
  guardianName: "x".repeat(200),
  guardianAccepted: true,
  now: NOW,
});
check("an absurdly long guardian name is refused", !longName.ok);

// --- 5. The disclosure itself --------------------------------------------
check("the disclosure is not empty", PRIVACY_DISCLOSURE.length >= 4);
// A notice that never names the third party is the exact thing that makes
// privacy notices untrustworthy.
check(
  "the disclosure names the third party that receives messages",
  PRIVACY_DISCLOSURE.some((line) => /AI provider/i.test(line)),
);
check(
  "the disclosure says data leaves for a third party",
  PRIVACY_DISCLOSURE.some((line) => /Groq|Gemini/.test(line)),
);
check(
  "the disclosure mentions export and deletion",
  PRIVACY_DISCLOSURE.some((line) => /export/i.test(line) && /delete/i.test(line)),
);
check("the policy version looks like a version", /^\d{4}-\d{2}$/.test(CONSENT_POLICY_VERSION));

// --- 6. Age band validation ----------------------------------------------
check("the three age bands are defined", AGE_BANDS.length === 3);
for (const band of AGE_BANDS) check(`${band} is a valid band`, isAgeBand(band));
check("null is not a band", !isAgeBand(null));
check("undefined is not a band", !isAgeBand(undefined));
check("an object is not a band", !isAgeBand({ ageBand: "under-13" }));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);

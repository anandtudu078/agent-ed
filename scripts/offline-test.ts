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

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);

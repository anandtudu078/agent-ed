// Permanent unit tests for the learner profile — the object that finally gets
// the collected telemetry in front of the model.
//
// Run: npm run test:profile
//
// Before this existed, everything the app recorded (weak points, review cards,
// misconceptions) shaped the dashboard and nothing else: the tutor prompt took
// twelve messages and a topic, so it taught a student who scored 20% exactly as
// it taught one who scored 95%. These tests pin the behaviour of the thing that
// closes that gap.

import {
  buildLearnerProfile,
  renderLearnerBriefing,
} from "../src/services/progressService";
import type { TestEvaluation, WeakPoint } from "../src/models/Progress";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const T0 = new Date("2026-03-01T09:00:00Z");

const weakPoint = (topic: string, strength: number): WeakPoint => ({ topic, strength });
const evaluation = (
  topic: string,
  score: number,
  misconceptions: string[] = [],
): TestEvaluation => ({
  topic,
  score,
  feedback: "",
  recommendedFocus: "",
  misconceptions,
  evaluatedAt: T0,
});

// --- 1. No data means no profile, and an empty briefing --------------------
const empty = buildLearnerProfile(null);
check("a missing progress record yields an empty profile", empty.weakTopics.length === 0);
check("a missing progress record has no signal", !empty.hasAssessmentSignal);
check("an empty briefing is returned when we know nothing", renderLearnerBriefing(empty) === "");
check(
  "an empty object is treated the same as a missing one",
  renderLearnerBriefing(buildLearnerProfile({})) === "",
);

// The important one: a brand-new student must not be told they have no gaps.
// Silence and "you're doing great" are different claims.
const oneTest = buildLearnerProfile({
  weakPoints: [weakPoint("recursion", 30)],
  testHistory: [evaluation("recursion", 30)],
});
check("one assessment is not enough to build a profile", !oneTest.hasAssessmentSignal);
check("a single test produces no briefing at all", renderLearnerBriefing(oneTest) === "");

// --- 2. Weak and strong are separated at the threshold ---------------------
const profile = buildLearnerProfile({
  weakPoints: [weakPoint("arrays", 20), weakPoint("trees", 55), weakPoint("sorting", 80)],
  testHistory: [evaluation("a", 20), evaluation("b", 60)],
});
check("weak topics are listed weakest first", profile.weakTopics[0] === "arrays", profile.weakTopics.join(","));
check("a strong topic is not also listed as weak", !profile.weakTopics.includes("sorting"));
check("strong topics are collected", profile.strongTopics.includes("sorting"), profile.strongTopics.join(","));
check("a topic at 55 is weak and at 80 is not", profile.weakTopics.includes("trees"));

// --- 3. "Struggling" needs more than one data point ----------------------
check("two weak topics across two tests reads as struggling", profile.overallStruggling);
const oneWeak = buildLearnerProfile({
  weakPoints: [weakPoint("arrays", 20)],
  testHistory: [evaluation("a", 20), evaluation("b", 90)],
});
check("one weak topic is not 'struggling'", !oneWeak.overallStruggling);
check("but the profile is still calibrated", oneWeak.hasAssessmentSignal && oneWeak.isWellCalibrated);

// --- 4. Misconceptions: repeats rank first, but one-offs still surface -----
// Deliberately *not* repeat-only. The live run showed the grader phrasing one
// underlying belief two different ways, so a strict repeat counter reported no
// misconception at all while two were on file.
const recurring = buildLearnerProfile({
  weakPoints: [weakPoint("backprop", 30)],
  testHistory: [
    evaluation("backprop", 30, ["thinks backprop is the same as gradient descent"]),
    evaluation("trees", 90, []),
    evaluation("backprop", 40, [
      "thinks backprop is the same as gradient descent",
      "one-off confusion about bias",
    ]),
  ],
});
check(
  "a repeated misconception is still surfaced",
  recurring.recurringMisconceptions.some((m) => m.includes("same as gradient descent")),
  recurring.recurringMisconceptions.join(" | "),
);
check(
  "a repeated misconception outranks a one-off",
  recurring.recurringMisconceptions[0]?.includes("same as gradient descent"),
  recurring.recurringMisconceptions[0],
);
check(
  "a one-off is surfaced too, rather than discarded",
  recurring.recurringMisconceptions.some((m) => m.includes("one-off confusion")),
);
check(
  "a misconception on a weak topic is kept",
  recurring.recurringMisconceptions.length >= 2,
  `${recurring.recurringMisconceptions.length}`,
);

check(
  "two phrasings of the same belief are both kept",
  buildLearnerProfile({
    weakPoints: [weakPoint("backprop", 30)],
    testHistory: [
      evaluation("backprop", 30, ["thinks backprop is just trial and error"]),
      evaluation("backprop", 30, ["thinks backprop is a loop trying weights"]),
    ],
  }).recurringMisconceptions.length === 2,
);

const oneOffOnly = buildLearnerProfile({
  weakPoints: [weakPoint("backprop", 30)],
  testHistory: [
    evaluation("backprop", 30, ["a totally different wrong idea"]),
    evaluation("backprop", 30, ["and another one"]),
  ],
});
check(
  "distinct one-offs on a weak topic are both surfaced",
  oneOffOnly.recurringMisconceptions.length === 2,
  oneOffOnly.recurringMisconceptions.join(" | "),
);

// A misconception on a topic with no weakness signal is the weakest evidence.
const offTopic = buildLearnerProfile({
  weakPoints: [weakPoint("backprop", 30)],
  testHistory: [
    evaluation("backprop", 30, ["a wrong idea about backprop"]),
    evaluation("unrelated-topic", 30, ["a wrong idea about something else"]),
  ],
});
check(
  "a weak-topic misconception outranks an off-topic one",
  offTopic.recurringMisconceptions[0]?.includes("backprop"),
  offTopic.recurringMisconceptions.join(" | "),
);

// --- 5. The briefing says the useful things, and not the awkward ones ------
const briefing = renderLearnerBriefing(recurring);
check("the briefing names the weak topics", briefing.includes("backprop"), briefing.slice(0, 80));
check("the briefing names the recurring misconception", briefing.includes("same as gradient descent"));
check("the briefing tells the tutor not to recite it", briefing.toLowerCase().includes("do not recite"));
check(
  "the briefing does not leak raw telemetry shape",
  !briefing.includes("[object") && !briefing.includes("undefined"),
);
check(
  "a profile with a recurring misconception changes the briefing",
  briefing !== renderLearnerBriefing(oneOffOnly),
);

// A student who is doing well should not be handed a "slow down" instruction.
const confident = buildLearnerProfile({
  weakPoints: [weakPoint("sorting", 90), weakPoint("arrays", 88)],
  testHistory: [evaluation("a", 90), evaluation("b", 95)],
});
const confidentBriefing = renderLearnerBriefing(confident);
check(
  "a strong student is not told to slow down",
  !confidentBriefing.toLowerCase().includes("slow down"),
  confidentBriefing.slice(0, 80),
);
check(
  "but is told what not to re-teach",
  confidentBriefing.toLowerCase().includes("do not re-explain"),
);

// --- 6. Lists are bounded so the prompt can't be flooded -------------------
const many = Array.from({ length: 40 }, (_, i) => weakPoint(`topic-${i}`, 10));
const bounded = buildLearnerProfile({
  weakPoints: many,
  testHistory: [evaluation("a", 10), evaluation("b", 10)],
});
check("weak topics are capped", bounded.weakTopics.length === 6, `${bounded.weakTopics.length}`);
check(
  "the capped list keeps the weakest",
  bounded.weakTopics.slice().sort()[0] === "topic-0",
  bounded.weakTopics.join(","),
);

const manyMisconceptions = buildLearnerProfile({
  testHistory: [
    evaluation("a", 10, Array.from({ length: 30 }, (_, i) => `idea ${i % 8}`)),
    evaluation("b", 10, Array.from({ length: 30 }, (_, i) => `idea ${i % 8}`)),
  ],
});
check(
  "misconceptions are capped",
  manyMisconceptions.recurringMisconceptions.length <= 5,
  `${manyMisconceptions.recurringMisconceptions.length}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} profile checks passed`);
process.exit(failed.length ? 1 : 0);


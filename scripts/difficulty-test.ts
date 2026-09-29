// Permanent unit tests for adaptive difficulty.
//
// Run: npm run test:difficulty
//
// Difficulty is the first thing that makes the tutor feel like it is teaching
// *this* student rather than a generic one. The rules here are the whole of it,
// and they are worth pinning because each one is a judgement about a person
// rather than a fact about a model.

import {
  difficultyForTopic,
  difficultyClause,
  difficultyLabel,
  WEAK_POINT_THRESHOLD,
} from "../src/services/progressService";
import type { ReviewCard, WeakPoint } from "../src/models/Progress";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const T0 = new Date("2026-03-01T09:00:00Z");

const point = (topic: string, strength: number): WeakPoint => ({ topic, strength });
const card = (
  topic: string,
  strength: number,
  reps: number,
): ReviewCard => ({
  topic,
  strength,
  lastReviewedAt: T0,
  dueAt: T0,
  intervalDays: 1,
  reps,
  lapses: 0,
});

// --- 1. No signal means standard, never remedial --------------------------
check("an empty record is standard", difficultyForTopic(null, "recursion") === "standard");
check("an empty topic is standard", difficultyForTopic({ weakPoints: [] }, "  ") === "standard");
check(
  "an unseen topic is standard, not remedial",
  difficultyForTopic({ weakPoints: [point("arrays", 30)] }, "recursion") === "standard",
  "starting a new topic easy wastes the one chance to find out what they can do",
);

// --- 2. Weak becomes remedial ---------------------------------------------
check(
  "a very weak topic is remedial",
  difficultyForTopic({ weakPoints: [point("backprop", 20)] }, "backprop") === "remedial",
);
check(
  "a weak topic with no review card is still remedial",
  difficultyForTopic({ weakPoints: [point("backprop", 35)] }, "backprop") === "remedial",
);

// --- 3. Strong only becomes stretch with a review behind it ---------------
check(
  "a strong topic with no review is standard",
  difficultyForTopic({ weakPoints: [point("arrays", 90)] }, "arrays") === "standard",
  "one good answer is not proof it held",
);
check(
  "a strong topic with a successful review is stretch",
  difficultyForTopic(
    { weakPoints: [point("arrays", 90)], reviewCards: [card("arrays", 90, 1)] },
    "arrays",
  ) === "stretch",
);
check(
  "strength with zero reps is not stretch",
  difficultyForTopic(
    { weakPoints: [point("arrays", 90)], reviewCards: [card("arrays", 90, 0)] },
    "arrays",
  ) === "standard",
);

// --- 4. Topics match regardless of case or padding ------------------------
check(
  "topic matching ignores case and padding",
  difficultyForTopic({ weakPoints: [point("BackProp", 20)] }, "  backprop ") === "remedial",
);

// --- 5. A review card alone is enough evidence ---------------------------
check(
  "a weak review card with no weak point is remedial",
  difficultyForTopic({ reviewCards: [card("trees", 15, 0)] }, "trees") === "remedial",
);

// --- 6. The clauses actually say different things -------------------------
const remedial = difficultyClause("remedial");
const standard = difficultyClause("standard");
const stretch = difficultyClause("stretch");
check("the three clauses are all distinct", remedial !== standard && standard !== stretch && remedial !== stretch);
check("remedial asks for a single step", remedial.toLowerCase().includes("single step"), remedial.slice(0, 60));
check("stretch forbids definition recall", stretch.toLowerCase().includes("do not ask them to define"), stretch.slice(0, 60));
check("stretch asks for a second step", stretch.toLowerCase().includes("second step"));
check(
  "no clause tells the student the difficulty changed",
  ![remedial, standard, stretch].some((c) =>
    /easier question|simpler question|we made this easier/i.test(c),
  ),
);
check(
  "remedial explicitly forbids mentioning the lowering",
  remedial.toLowerCase().includes("do not mention"),
  "being labelled is a verdict on the student, not a note about the question",
);

// --- 7. The band is used where it is measured -----------------------------
check(
  "the threshold matches the weak-point rule",
  WEAK_POINT_THRESHOLD === 60,
  `WEAK_POINT_THRESHOLD=${WEAK_POINT_THRESHOLD}`,
);
check(
  "a topic exactly at the weak threshold is not remedial",
  difficultyForTopic({ weakPoints: [point("x", WEAK_POINT_THRESHOLD)] }, "x") === "standard",
);

// --- 8. Labels are for humans --------------------------------------------
check("labels are distinct per band", new Set([difficultyLabel("remedial"), difficultyLabel("standard"), difficultyLabel("stretch")]).size === 3);
check("a label never leaks a number", ![difficultyLabel("stretch"), difficultyLabel("remedial")].some((l) => /\d/.test(l)));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} difficulty checks passed`);
process.exit(failed.length ? 1 : 0);

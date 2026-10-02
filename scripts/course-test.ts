// Unit tests for course progress derivation.
//
// Run: npm run test:course
//
// The central claim is that derivation is total: it has to answer for whatever
// is in the database and in the curriculum, and produce progress rather than
// throw. `topicsVisited` and module topics are both model output and authored
// data that merely claims to be strings, so "claims to be a string" is not a
// contract this function can rely on.
//
// That is not hypothetical. A single history entry with a missing `topic` made
// `normalizeTopic` call `.toLowerCase()` on undefined, which propagated out of
// `computeCourseProgress` and turned POST /api/courses/:id/enroll into a 500.
// The student clicked "Start learning" on a perfectly good course and was
// refused, with no way to recover. It reproduced only in CI, because it depends
// on which course the catalog happens to list first.

import { computeCourseProgress, normalizeTopic, topicsMatch } from "../src/services/courseService";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const T0 = new Date("2026-03-01T09:00:00Z");
const ago = (minutes: number): Date => new Date(T0.getTime() - minutes * 60_000);

/** A course is only ever asked for its `modules`; cast past the model shape. */
const course = (...topics: Array<string | undefined>) =>
  ({
    modules: topics.map((topic, i) => ({ title: `Module ${i + 1}`, topic })),
  }) as unknown as Parameters<typeof computeCourseProgress>[0];

const visits = (...topics: Array<string | undefined>) =>
  topics.map((topic, i) => ({ topic, firstSeenAt: ago(i + 1) })) as unknown as Parameters<
    typeof computeCourseProgress
  >[1];

// --- 1. Normalization -------------------------------------------------------
check("normalization lowercases", normalizeTopic("Machine Learning") === "machine learning");
check("and drops punctuation", normalizeTopic("Machine Learning!") === "machine learning");
check("and collapses whitespace", normalizeTopic("machine   learning") === "machine learning");
check("an empty topic stays empty", normalizeTopic("") === "");

// --- 2. A topic that is not a topic ----------------------------------------
// The regression. These used to throw, which is what took the enroll endpoint
// down; they must degrade to "no match" instead.
check("an undefined topic normalizes to empty", normalizeTopic(undefined) === "");
check("a null topic normalizes to empty", normalizeTopic(null) === "");
check("a number does not masquerade as a topic", normalizeTopic(42) === "");
check("an object does not either", normalizeTopic({ topic: "x" }) === "");

check("a malformed visit simply does not match", topicsMatch("Functions", undefined as unknown as string) === false);
check(
  "and the reverse direction is equally safe",
  topicsMatch(undefined as unknown as string, "Functions") === false,
);

// --- 3. Derivation survives a malformed history ------------------------------
const mixedHistory = computeCourseProgress(
  course("Functions", "Loops", "Recursion"),
  visits(undefined, "Functions", "   ", "Loops"),
);
check("a malformed history entry does not throw", Array.isArray(mixedHistory.completedModules));
check(
  "and the readable entries still count",
  mixedHistory.completedModules.length === 2,
  mixedHistory.completedModules.join(", "),
);
check("progress is still derived", mixedHistory.progressPercent === 67, `${mixedHistory.progressPercent}%`);
check(
  "and the next module is still named",
  mixedHistory.nextModule?.title === "Module 3",
  mixedHistory.nextModule?.title ?? "none",
);
check("lastTopic is a real string", typeof mixedHistory.lastTopic === "string", mixedHistory.lastTopic);

check(
  "a history of nothing but garbage credits nothing",
  computeCourseProgress(course("Functions"), visits(undefined, null as unknown as string)).progressPercent === 0,
);
const blankModule = computeCourseProgress(course(undefined, "Loops"), visits("Loops"));
check(
  "a course whose own modules are blank still answers",
  blankModule.progressPercent === 50,
  `${blankModule.progressPercent}%`,
);
check(
  "and the blank module simply can never be matched, so it stays to do",
  blankModule.nextModule?.title === "Module 1",
  blankModule.nextModule?.title ?? "none",
);
check(
  "and an empty course reports zero rather than dividing by zero",
  computeCourseProgress(course(), visits("Functions")).progressPercent === 0,
);

// --- 4. The behaviour the feature actually promises -------------------------
const partial = computeCourseProgress(
  course("Functions", "Loops", "Recursion"),
  visits("Functions"),
);
check("one covered module out of three", partial.progressPercent === 33, `${partial.progressPercent}%`);
check("resume points at the first uncovered module", partial.nextModule?.title === "Module 2", partial.nextModule?.title ?? "none");
check("the last topic covered is named", partial.lastTopic === "Functions", partial.lastTopic);

const complete = computeCourseProgress(
  course("Functions", "Loops"),
  visits("Functions", "Loops"),
);
check("finishing every module reads as 100%", complete.progressPercent === 100, `${complete.progressPercent}%`);
check("and leaves nothing to resume into", complete.nextModule === null);

check(
  "topics match case-insensitively",
  topicsMatch("Machine Learning", "machine   learning basics"),
);
check(
  "but unrelated topics do not",
  topicsMatch("Machine Learning", "HTTP caching") === false,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} course checks passed`);
process.exit(failed.length ? 1 : 0);
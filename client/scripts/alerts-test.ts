// Permanent unit tests for learning alerts and subtopic matching.
//
// Run: npm run test:alerts
//
// Two rules here are the whole point, and both are about not lying to a student:
//
//   - an alert must never claim a course is finished when it isn't (stale module
//     titles from a renamed syllabus), and must never nag about a topic the
//     student has since gone on to ace;
//   - a subtopic match must be honest about how confident it is, because a tutor
//     that silently jumps to a neighbouring topic looks broken rather than clever.
//
// Everything here is pure, so no DOM and no server are needed.

import { buildAlerts, type AlertInput } from "../src/components/alerts.ts";
import {
  matchSubtopic,
  subtopicPrompt,
  normalizeTopic,
  type ModuleLike,
} from "../src/components/subtopics.ts";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

function baseInput(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    dueReviews: [],
    weakPoints: [],
    enrolledCourses: [],
    courseSizes: {},
    testHistory: [],
    learningSpeed: 0,
    awayLabel: "",
    ...overrides,
  };
}

// --- 1. Reviews come first, and count correctly ------------------------------
const oneDue = buildAlerts(baseInput({ dueReviews: [{ topic: "recursion", strength: 40, label: "1 day" }] }));
check("one review due raises an alert", oneDue.some((a) => a.id === "reviews-due"));
check("one review is singular", oneDue[0]?.title === "1 concept ready", oneDue[0]?.title ?? "");
check("a review alert offers an action", oneDue[0]?.action.kind === "review");

const threeDue = buildAlerts(baseInput({ dueReviews: [
  { topic: "a", strength: 40, label: "1 day" },
  { topic: "b", strength: 40, label: "1 day" },
  { topic: "c", strength: 40, label: "1 day" },
] }));
check("three reviews are pluralised", threeDue[0]?.title === "3 concepts ready", threeDue[0]?.title ?? "");

// --- 2. Priority: reviews beat everything -------------------------------------
const everything = buildAlerts(baseInput({
  dueReviews: [{ topic: "recursion", strength: 40, label: "1 day" }],
  weakPoints: [{ topic: "backprop", strength: 20 }],
  enrolledCourses: [{ courseId: "c1", title: "AI Basics", progressPercent: 100, completedModules: ["a", "b"] }],
  courseSizes: { c1: 2 },
  testHistory: [{ topic: "loops", score: 10, evaluatedAt: "" }],
}));
check("reviews are the first alert when everything applies", everything[0]?.id === "reviews-due", everything[0]?.id ?? "");
check("the list is capped", everything.length <= 3, `n=${everything.length}`);

// --- 3. A weak point surfaces ------------------------------------------------
const weak = buildAlerts(baseInput({ weakPoints: [{ topic: "backprop", strength: 20 }] }));
check("a measured gap is flagged", weak.some((a) => a.id === "weak-backprop"));
check("a gap offers a test", weak.find((a) => a.id === "weak-backprop")?.action.kind === "test");

// --- 5. Course completion is judged against the real syllabus ---------------
const done = buildAlerts(baseInput({
  enrolledCourses: [{ courseId: "c1", title: "AI Basics", progressPercent: 100, completedModules: ["a", "b"] }],
  courseSizes: { c1: 2 },
}));
check("a genuinely finished course is celebrated", done.some((a) => a.id === "course-done-c1"));
// The stale-title case: two stored titles, but the course now has three modules.
const stale = buildAlerts(baseInput({
  enrolledCourses: [{ courseId: "c1", title: "AI Basics", progressPercent: 100, completedModules: ["a", "renamed"] }],
  courseSizes: { c1: 3 },
}));
check("a stale module title does not fake completion", !stale.some((a) => a.id === "course-done-c1"), JSON.stringify(stale.map((a) => a.id)));

const near = buildAlerts(baseInput({
  enrolledCourses: [{ courseId: "c2", title: "ML Basics", progressPercent: 90, completedModules: ["a"] }],
  courseSizes: { c2: 5 },
}));
check("a nearly-finished course is encouraged", near.some((a) => a.id === "course-near-c2"));
check("a half course is not called nearly done", !buildAlerts(baseInput({
  enrolledCourses: [{ courseId: "c3", title: "X", progressPercent: 50, completedModules: ["a"] }],
  courseSizes: { c3: 5 },
})).some((a) => a.id.startsWith("course-")));

// --- 6. Absence and the empty state ------------------------------------------
const away = buildAlerts(baseInput({ awayLabel: "Away 3 days" }));
check("a long absence is acknowledged", away.some((a) => a.id === "away"));
check("a short absence is not", !buildAlerts(baseInput({ awayLabel: "" })).some((a) => a.id === "away"));
// Absence must not outrank something actionable.
const awayButDue = buildAlerts(baseInput({
  awayLabel: "Away 3 days",
  dueReviews: [{ topic: "a", strength: 40, label: "1 day" }],
}));
check("absence does not displace a due review", awayButDue[0]?.id === "reviews-due", awayButDue[0]?.id ?? "");

const idle = buildAlerts(baseInput());
check("a brand-new student is given somewhere to go", idle[0]?.id === "idle");
check("the idle alert points at learning", idle[0]?.action.kind === "learn-topic");
const pacing = buildAlerts(baseInput({ learningSpeed: 4.6 }));
check("a student with pace is praised instead", pacing[0]?.id === "pace", pacing[0]?.id ?? "");
check("the pace is rounded for display", pacing[0]?.body.includes("5"), pacing[0]?.body ?? "");

// --- 7. Hindi ----------------------------------------------------------------
// The body is Devanagari; the title is Hinglish, because "1 concept ready" is how
// an Indian student actually reads a counter — and a title in two scripts at once
// is exactly what this app does everywhere else.
const hi = buildAlerts(baseInput({ dueReviews: [{ topic: "a", strength: 40, label: "1 day" }], language: "hi" }));
check("a Hindi alert keeps the count readable", /1 concept ready/.test(hi[0]?.title ?? ""), hi[0]?.title ?? "");
check("a Hindi alert body is in Devanagari", /देखने/.test(hi[0]?.body ?? ""), hi[0]?.body ?? "");
check("a Hindi alert action is in Devanagari", /शुरू/.test(hi[0]?.action.label ?? ""), hi[0]?.action.label ?? "");
// The idle state must translate too — it is the first thing a new student sees.
const hiIdle = buildAlerts(baseInput({ language: "hi" }));
check("the Hindi idle state is translated", /नहीं/.test(hiIdle[0]?.title ?? ""), hiIdle[0]?.title ?? "");

// --- 8. Degenerate input -----------------------------------------------------
const empty = buildAlerts(baseInput({ dueReviews: [], weakPoints: [], enrolledCourses: [], testHistory: [] }));

// ===========================================================================
// Subtopic matching
// ===========================================================================

const modules: ModuleLike[] = [
  { title: "Variables and types", topic: "variables and data types", subtopics: ["Naming conventions", "Numbers vs text", "Type coercion"] },
  { title: "Conditionals", topic: "if statements and conditionals", subtopics: ["if / else / elif", "Truthiness", "Nested conditionals"] },
  { title: "Backpropagation", topic: "backpropagation and gradient flow", subtopics: ["The chain rule", "Gradient descent", "Vanishing gradients"] },
];

check("an exact subtopic is an exact match", matchSubtopic("Truthiness", modules).match === "exact");
check("an exact match returns the syllabus wording", matchSubtopic("truthiness", modules).subtopic === "Truthiness");
check("a subtopic phrase matches exactly", matchSubtopic("Vanishing gradients", modules).match === "exact");

const contained = matchSubtopic("backprop", modules);
check("a prefix of a longer term matches", contained.match !== "none", contained.match);
check("the prefix match is inside the right module", contained.moduleTitle === "Backpropagation", contained.moduleTitle ?? "");

// The safety rule: a short string must not match by containment.
check("a too-short string matches nothing", matchSubtopic("if", modules).match === "none", matchSubtopic("if", modules).match);

// Stop words must not drive a match.
check("stop words alone match nothing", matchSubtopic("explain the concept to me", modules).match === "none");
check("normalisation collapses punctuation", normalizeTopic("If / else / elif!") === "if else elif", normalizeTopic("If / else / elif!"));

const wholeModule = matchSubtopic("Conditionals", modules);
check("a module name matches", wholeModule.moduleTitle === "Conditionals", wholeModule.moduleTitle ?? "");

check("an unrelated request matches nothing", matchSubtopic("quantum chromodynamics", modules).match === "none");
check("an empty request matches nothing", matchSubtopic("", modules).match === "none");
check("a course with no subtopics still matches its modules", matchSubtopic("Conditionals", [{ title: "Conditionals", topic: "if statements" }]).match === "exact");
check("empty modules match nothing", matchSubtopic("anything", []).match === "none");

// The prompt must name the subtopic and never an undefined.
const prompt = subtopicPrompt("Backpropagation", "The chain rule", "AI Basics");
check("the prompt names the subtopic", prompt.includes("The chain rule"));
check("the prompt names the module", prompt.includes("Backpropagation"));
check("the prompt names the course", prompt.includes("AI Basics"));
check("the prompt has no undefined", !/undefined|null/.test(prompt));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
check("empty input still yields one alert", empty.length === 1, `n=${empty.length}`);
check("every alert has an id, title and body", empty.every((a) => a.id && a.title && a.body));
check("every alert has something to press", empty.every((a) => Boolean(a.action.label) && a.action.kind !== "none"));
check("a mild wobble is not flagged", !buildAlerts(baseInput({ weakPoints: [{ topic: "x", strength: 60 }] })).some((a) => a.id.startsWith("weak-")));
// The weakest gap is the one named.
const twoWeak = buildAlerts(baseInput({ weakPoints: [
  { topic: "shallow", strength: 40 },
  { topic: "deep", strength: 10 },
] }));
check("the weakest gap is the one surfaced", twoWeak[0]?.body.includes("deep"), twoWeak[0]?.body ?? "");

// --- 4. A poor last result, but never a stale one ----------------------------
const poorNow = buildAlerts(baseInput({ testHistory: [{ topic: "loops", score: 20, evaluatedAt: "" }] }));
check("a poor recent score is flagged", poorNow.some((a) => a.id === "poor-loops"));
// The important one: a bad old attempt that has since been improved must not nag.
const poorThenGood = buildAlerts(baseInput({ testHistory: [
  { topic: "loops", score: 15, evaluatedAt: "" },
  { topic: "loops", score: 95, evaluatedAt: "" },
] }));
check("an old bad score is not re-raised after a good one", !poorThenGood.some((a) => a.id === "poor-loops"), JSON.stringify(poorThenGood.map((a) => a.id)));
check("a good recent score raises no poor-score alert", !buildAlerts(baseInput({ testHistory: [{ topic: "x", score: 95, evaluatedAt: "" }] })).some((a) => a.id.startsWith("poor-")));
// Two alerts about the same gap would be nagging.
const duplicated = buildAlerts(baseInput({
  weakPoints: [{ topic: "loops", strength: 20 }],
  testHistory: [{ topic: "loops", score: 20, evaluatedAt: "" }],
}));
check("one gap does not raise two alerts", !duplicated.some((a) => a.id.startsWith("poor-")), JSON.stringify(duplicated.map((a) => a.id)));
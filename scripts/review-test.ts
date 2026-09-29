// Permanent unit tests for the spaced-repetition schedule.
//
// Run: npm run test:review
//
// The scheduling maths is pure and clock-injectable, so it can be tested
// without a database and without waiting for real days to pass — which is
// exactly what matters here. A bug in an interval ladder doesn't surface for
// weeks in production, and by then nobody is looking.

import {
  scheduleReview,
  upsertReviewCard,
  dueCards,
  dueLabel,
  REVIEW_PASS_SCORE,
  MAX_REVIEW_CARDS,
} from "../src/services/progressService";
import type { ReviewCard } from "../src/models/Progress";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-03-01T09:00:00Z");
const days = (n: number): Date => new Date(T0.getTime() + n * DAY);
const gapDays = (card: ReviewCard, from: Date = T0): number =>
  Math.round((new Date(card.dueAt).getTime() - from.getTime()) / DAY);

// --- 1. A first review is scheduled, not dropped ----------------------------
const first = scheduleReview(null, "recursion", 90, T0);
check("a new card keeps the topic", first.topic === "recursion", first.topic);
check("a new card records the review time", +new Date(first.lastReviewedAt!) === +T0);
check("a new card starts at one rep", first.reps === 1, `reps=${first.reps}`);
check("a new card has no lapses", first.lapses === 0);

// --- 2. The interval grows while the student keeps answering well ----------
let card = first;
const ladder: number[] = [];
for (let i = 0; i < 5; i += 1) {
  card = scheduleReview(card, "recursion", 95, T0);
  ladder.push(gapDays(card));
}
check(
  "successive passes lengthen the interval",
  ladder[0] < ladder[1] && ladder[1] < ladder[2] && ladder[2] < ladder[3],
  ladder.join(" -> "),
);
check("reps increment on each pass", card.reps === 6, `reps=${card.reps}`);
check("the gap stays within the ceiling", card.intervalDays <= 180, `${card.intervalDays}d`);

// --- 3. A lapse collapses the interval ------------------------------------
const lapsed = scheduleReview(card, "recursion", 20, T0);
check("a fail drops back to one day", lapsed.intervalDays === 1, `${lapsed.intervalDays}d`);
check("a fail resets the rep count", lapsed.reps === 0, `reps=${lapsed.reps}`);
check("a fail after learning counts a lapse", lapsed.lapses === 1, `lapses=${lapsed.lapses}`);
check("a fail still schedules a review soon", gapDays(lapsed) === 1, `${gapDays(lapsed)}d`);

// Failing something that was never learned is not a lapse — nothing was
// forgotten, so there is nothing to have lapsed. This needs a card that has
// never passed (reps 0), not a card that succeeded once and then failed.
const neverLearned = scheduleReview(
  scheduleReview(null, "recursion", 10, T0),
  "recursion",
  5,
  T0,
);
check(
  "failing a never-learned topic is not counted as a lapse",
  neverLearned.lapses === 0,
  `lapses=${neverLearned.lapses}`,
);
check(
  "but failing a topic that was learned is",
  scheduleReview(first, "recursion", 10, T0).lapses === 1,
);

// A first-time failure is due immediately, so the student can fix it now
// rather than being told to come back tomorrow.
const firstFail = scheduleReview(null, "brand-new", 30, T0);
check("a first-time failure is due right away", gapDays(firstFail) === 0, `${gapDays(firstFail)}d`);
check("a first-time failure is therefore due today", dueCards([firstFail], T0).length === 1);
check(
  "a first-time pass is scheduled forward, not due now",
  gapDays(scheduleReview(null, "brand-new", 95, T0)) >= 1,
);

// --- 4. The pass boundary ---------------------------------------------------
check(
  "a score exactly at the threshold passes",
  scheduleReview(null, "t", REVIEW_PASS_SCORE, T0).reps === 1,
);
check(
  "a score just below the threshold fails",
  scheduleReview(null, "t", REVIEW_PASS_SCORE - 1, T0).reps === 0,
);
check(
  "a shaky pass cannot buy a long first gap",
  scheduleReview(null, "t", 66, T0).intervalDays <= 2,
  `${scheduleReview(null, "t", 66, T0).intervalDays}d`,
);

// --- 5. Nonsense scores are handled, not propagated -------------------------
// Interval 0 is legitimate (a first-time failure is due immediately), so the
// floor here is 0, not 1. What must hold is that nothing becomes NaN.
for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -50, 9999]) {
  const c = scheduleReview(null, "t", bad, T0);
  const sane =
    Number.isFinite(c.strength) &&
    c.strength >= 0 &&
    c.strength <= 100 &&
    c.intervalDays >= 0 &&
    Number.isFinite(new Date(c.dueAt).getTime());
  check(`a score of ${String(bad)} stays sane`, sane, `strength=${c.strength}`);
}

// --- 6. The queue -----------------------------------------------------------
let cards: ReviewCard[] = [];
cards = upsertReviewCard(cards, "recursion", 40, T0);
cards = upsertReviewCard(cards, "loops", 80, T0);
check("two topics make two cards", cards.length === 2, `${cards.length}`);

cards = upsertReviewCard(cards, "Recursion", 40, T0);
check(
  "topics match case-insensitively",
  cards.length === 2,
  `still ${cards.length} cards`,
);

const many: ReviewCard[] = Array.from({ length: MAX_REVIEW_CARDS + 10 }, (_, i) => ({
  topic: `t${i}`,
  strength: 80,
  lastReviewedAt: T0,
  // Furthest-out cards are the least worth keeping.
  dueAt: days(100 + i),
  intervalDays: 100 + i,
  reps: 3,
  lapses: 0,
}));
const trimmed = upsertReviewCard(many, "brand-new", 90, T0);
check("the queue is bounded", trimmed.length === MAX_REVIEW_CARDS, `${trimmed.length}`);
check(
  "trimming drops the furthest-out cards, not the shakiest",
  !trimmed.some((c) => c.topic === "t0" || c.topic === "t1"),
  `oldest kept: ${trimmed.map((c) => c.topic).slice(-1)[0]}`,
);

// --- 7. What is due ---------------------------------------------------------
const queue: ReviewCard[] = [
  { topic: "due-now", strength: 50, lastReviewedAt: T0, dueAt: T0, intervalDays: 1, reps: 1, lapses: 0 },
  { topic: "overdue", strength: 20, lastReviewedAt: T0, dueAt: days(-9), intervalDays: 1, reps: 1, lapses: 0 },
  { topic: "future", strength: 40, lastReviewedAt: T0, dueAt: days(5), intervalDays: 7, reps: 3, lapses: 0 },
];
const due = dueCards(queue, T0);
check("only due cards are returned", due.length === 2, due.map((c) => c.topic).join(","));
check(
  "the most overdue comes first",
  due[0]?.topic === "overdue",
  due.map((c) => c.topic).join(","),
);
check("a card due exactly now counts as due", due.some((c) => c.topic === "due-now"));
check("an empty queue yields nothing", dueCards([], T0).length === 0);
check("a card due in the future is not due", !dueCards(queue, T0).some((c) => c.topic === "future"));
check("a queue whose cards are all ahead is empty", dueCards([queue[2]], T0).length === 0);

// --- 8. Labels --------------------------------------------------------------
check("a card due now reads as due", dueLabel(queue[0], T0) === "due now", dueLabel(queue[0], T0));
check(
  "a card one day late is singular",
  dueLabel({ ...queue[0], dueAt: days(-1) }, T0) === "1 day overdue",
);
check(
  "a card long overdue is counted in months",
  dueLabel({ ...queue[0], dueAt: days(-75) }, T0) === "3 months overdue",
  dueLabel({ ...queue[0], dueAt: days(-75) }, T0),
);
check(
  "a card not yet due does not say 'overdue'",
  !dueLabel({ ...queue[0], dueAt: days(3) }, T0).includes("overdue"),
);
check(
  "a card with a malformed date does not produce NaN",
  !dueLabel({ ...queue[0], dueAt: new Date("nope") }, T0).includes("NaN"),
  dueLabel({ ...queue[0], dueAt: new Date("nope") }, T0),
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} review checks passed`);
process.exit(failed.length ? 1 : 0);


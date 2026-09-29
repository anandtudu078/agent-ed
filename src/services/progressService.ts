import { Progress, WeakPoint, ReviewCard } from "../models/Progress";
import { TopicVisit } from "../models/Session";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * At or below this a review counts as remembered.
 *
 * Deliberately tighter than WEAK_POINT_THRESHOLD (60) on the way out but
 * looser on the way in. To schedule a growing interval you need a bar you can
 * actually clear, and a student who scored 60 on a test has not learned the
 * concept well enough to not see it again in three weeks. The first step stays
 * short (1 day) either way, so a wrong answer still comes back fast.
 */
export const REVIEW_PASS_SCORE = 65;

/** Intervals in days for the first few successful reviews, before scaling. */
const LADDER = [1, 3, 7, 16, 35];

/** Ceiling on a single gap, so nothing drifts out of the student's lifetime. */
const MAX_INTERVAL_DAYS = 180;

/** How many cards we keep. Bounded because a student can test many topics. */
const MAX_REVIEW_CARDS = 120;

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/** Topics are matched case-insensitively; the stored casing is the first seen. */
function sameTopic(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Fold one review outcome into the schedule for that topic.
 *
 * A simplified SM-2: the interval grows along a ladder while the student keeps
 * answering well, and collapses to a single day on a lapse. Full SM-2 carries a
 * per-card easiness factor; that is more machinery than this needs, and an
 * unexplainable multiplier drifting to 2.7× is harder to justify to a student
 * than "you've got it, we'll check again in three weeks".
 *
 * Pure — exported so it can be tested without a database or a clock.
 */
export function scheduleReview(
  existing: ReviewCard | null,
  topic: string,
  score: number,
  now: Date = new Date(),
): ReviewCard {
  const passed = Number.isFinite(score) && score >= REVIEW_PASS_SCORE;
  const priorStrength = existing?.strength ?? clampMastery(score);
  // Blend rather than replace, for the same reason weak points blend: one
  // unlucky or lucky sitting shouldn't erase what we know.
  const strength = Math.round(priorStrength * 0.6 + clampMastery(score) * 0.4);

  const previousInterval = existing?.intervalDays ?? 0;
  const previousReps = existing?.reps ?? 0;

  let intervalDays: number;
  let reps: number;
  let lapses: number;

  if (passed) {
    reps = previousReps + 1;
    lapses = existing?.lapses ?? 0;
    // Clamp by strength even on a pass: a shaky answer shouldn't earn a long
    // gap, or the concept is lost for weeks precisely when it is least solid.
    const ceiling = Math.max(1, Math.round(MAX_INTERVAL_DAYS * (strength / 100)));
    const laddered = LADDER[Math.min(reps - 1, LADDER.length - 1)];
    intervalDays = Math.min(
      Math.max(laddered, previousInterval + 1),
      ceiling,
      MAX_INTERVAL_DAYS,
    );
  } else if (!existing) {
    // A topic failed the very first time it was ever tested: due immediately.
    // The student has just been told they don't have this, so telling them to
    // come back tomorrow is the wrong answer — the fix is one button away and
    // the memory is still hot. Once a card exists, a lapse goes to a day, which
    // is the normal rhythm.
    reps = 0;
    lapses = 0;
    intervalDays = 0;
  } else {
    reps = 0;
    lapses = (existing?.lapses ?? 0) + (existing.reps > 0 ? 1 : 0);
    intervalDays = 1;
  }

  return {
    topic: existing?.topic ?? topic,
    strength,
    lastReviewedAt: now,
    dueAt: addDays(now, intervalDays),
    intervalDays,
    reps,
    lapses,
  };
}

/**
 * Insert or update the card for one topic, keeping the list bounded.
 *
 * A brand-new card is due immediately — the student has just been tested on it,
 * so it is not a surprise, and it makes the queue meaningful on day one.
 */
export function upsertReviewCard(
  cards: ReviewCard[],
  topic: string,
  score: number,
  now: Date = new Date(),
): ReviewCard[] {
  const index = cards.findIndex((card) => sameTopic(card.topic, topic));
  const next = scheduleReview(index >= 0 ? cards[index] : null, topic, score, now);

  if (index >= 0) {
    const copy = [...cards];
    copy[index] = next;
    return copy;
  }
  // Trim the least useful first: the strongest cards are the ones we most want
  // to keep reviewing, so drop those due furthest out when over the cap.
  const grown = [...cards, next].sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime());
  return grown.slice(0, MAX_REVIEW_CARDS);
}

/** Cards needing attention now, weakest and most overdue first. */
export function dueCards(
  cards: ReviewCard[],
  now: Date = new Date(),
): ReviewCard[] {
  return cards
    .filter((card) => new Date(card.dueAt).getTime() <= now.getTime())
    .sort((a, b) => {
      const overdue = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (overdue !== 0) return overdue;
      return a.strength - b.strength;
    });
}

/** Short human phrasing for a card's due date, for the dashboard. */
export function dueLabel(card: ReviewCard, now: Date = new Date()): string {
  const due = new Date(card.dueAt).getTime();
  // A card can arrive from an older document or a hand-edited database with an
  // unreadable date. Rendering "NaN months overdue" is worse than saying
  // something plain, so fall back rather than show a student a maths ghost.
  if (!Number.isFinite(due)) return "ready to review";
  const days = Math.floor((now.getTime() - due) / DAY_MS);
  if (days <= 0) return "due now";
  if (days === 1) return "1 day overdue";
  if (days < 30) return `${days} days overdue`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month overdue" : `${months} months overdue`;
}

export { MAX_REVIEW_CARDS };

/**
 * At or above this the student has the hang of it, so the topic stops counting
 * as a weak point. Below it, the dashboard surfaces it.
 */
export const WEAK_POINT_THRESHOLD = 60;

/** How many weak points we keep. The dashboard only has room for so many. */
const MAX_WEAK_POINTS = 25;

/**
 * Weight given to the newest mastery estimate. A single confused turn shouldn't
 * overwrite everything we know about a student, and a single good turn
 * shouldn't erase a genuine gap — so blend rather than replace.
 */
const RECENCY_WEIGHT = 0.4;

export function clampMastery(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Concepts per week, from the distinct topics the student has reached and when
 * they first reached them.
 */
export function computeLearningSpeed(
  visits: TopicVisit[],
  now: Date = new Date(),
): number {
  const distinct = new Set(
    (visits ?? [])
      .map((visit) => (visit?.topic ?? "").trim().toLowerCase())
      .filter(Boolean),
  ).size;
  if (distinct === 0) return 0;

  const timestamps = (visits ?? [])
    .map((visit) => new Date(visit?.firstSeenAt).getTime())
    .filter((time) => Number.isFinite(time));
  if (timestamps.length === 0) return 0;

  const firstSeen = Math.min(...timestamps);
  // Floor the window at a day: a student who asks two questions in a minute
  // hasn't covered "600 concepts per week".
  const days = Math.max(1, (now.getTime() - firstSeen) / DAY_MS);
  return Math.round((distinct / (days / 7)) * 10) / 10;
}

/**
 * Fold one mastery observation into the weak-point list: blend it with the
 * existing estimate for that topic, then drop the topic if the student has
 * demonstrably got it.
 *
 * Pure — exported so it can be tested without a database.
 */
export function mergeWeakPoints(
  existing: WeakPoint[],
  topic: string,
  masteryEstimate: number,
): WeakPoint[] {
  const current = Array.isArray(existing) ? existing : [];
  const cleanTopic = topic.trim().slice(0, 60);
  const key = cleanTopic.toLowerCase();

  if (!key) {
    return [...current].sort((a, b) => a.strength - b.strength).slice(0, MAX_WEAK_POINTS);
  }

  const previous = current.find((wp) => (wp?.topic ?? "").trim().toLowerCase() === key);
  const blended = previous
    ? Math.round(previous.strength * (1 - RECENCY_WEIGHT) + masteryEstimate * RECENCY_WEIGHT)
    : masteryEstimate;

  // Drop any previous entry for this topic, then re-add it only if it's still
  // a weakness. Resolving a weak point is the progress signal worth keeping.
  const others = current.filter((wp) => (wp?.topic ?? "").trim().toLowerCase() !== key);
  const next = blended >= WEAK_POINT_THRESHOLD
    ? others
    : [...others, { topic: cleanTopic, strength: blended }];

  // Weakest first: the dashboard has limited room, so the gaps come first.
  return next.sort((a, b) => a.strength - b.strength).slice(0, MAX_WEAK_POINTS);
}

/**
 * Persist what this turn taught us about the student: their weak points and
 * their pace. Called after a tutor reply — a failure here must never take the
 * chat request down with it, so callers should treat this as best-effort.
 */
export async function recordLearningSignal(
  studentId: string,
  topic: string,
  masteryEstimate: number,
  topicsVisited: TopicVisit[],
): Promise<{ learningSpeed: number; weakPoints: WeakPoint[] }> {
  const existing = await Progress.findOne({ studentId })
    .select({ weakPoints: 1 })
    .lean();

  const weakPoints = mergeWeakPoints(
    (existing?.weakPoints ?? []) as WeakPoint[],
    topic,
    clampMastery(masteryEstimate),
  );
  const learningSpeed = computeLearningSpeed(topicsVisited);

  await Progress.findOneAndUpdate(
    { studentId },
    { $set: { weakPoints, learningSpeed } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { learningSpeed, weakPoints };
}

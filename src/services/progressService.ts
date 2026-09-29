import { Progress, WeakPoint } from "../models/Progress";
import { TopicVisit } from "../models/Session";

const DAY_MS = 24 * 60 * 60 * 1000;

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

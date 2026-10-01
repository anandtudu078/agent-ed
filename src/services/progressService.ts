import { Progress, TestEvaluation, WeakPoint, ReviewCard } from "../models/Progress";
import { TopicVisit } from "../models/Session";

/**
 * What the app believes about one student, assembled from everything it records.
 *
 * This exists because the telemetry was all being collected and none of it was
 * reaching the tutor: weak points and review cards shaped the *dashboard*, not
 * the *teaching*. The tutor prompt received twelve messages and a topic, and
 * taught everyone identically no matter what we knew.
 *
 * The profile is the seam. It is derived on read, never stored as its own
 * document — it has no state of its own to fall out of sync, and it is cheap
 * to rebuild.
 */
export interface LearnerProfile {
  /** Concepts the student has demonstrated, weakest first. */
  weakTopics: string[];
  /** Concepts covered with no recorded gap. */
  strongTopics: string[];
  /**
   * Misconceptions that have now come up more than once.
   *
   * A single wrong answer is noise — everyone misses things. The same wrong
   * idea twice is a belief, and beliefs are what you have to un-teach. Repeats
   * are counted by exact text, which is crude, but the grader is instructed to
   * phrase them consistently for a given error.
   */
  recurringMisconceptions: string[];
  /** True once the student has been assessed enough times to be confident. */
  isWellCalibrated: boolean;
  /**
   * Struggling across several topics at once.
   *
   * Deliberately requires more than one data point. "This student is
   * struggling" is a claim about a person, and one bad test is just a bad test.
   */
  overallStruggling: boolean;
  /** True once the student has been assessed at least twice. */
  hasAssessmentSignal: boolean;
  /** Concepts whose review is outstanding, most overdue first. */
  dueTopics: string[];
}

const MIN_ASSESSMENTS_FOR_PROFILE = 2;
const MAX_PROFILE_TOPICS = 6;
const MAX_MISCONCEPTIONS = 5;

/**
 * Build the profile from stored progress.
 *
 * Pure and clock-injectable, like the rest of this module, so the behaviour is
 * testable without a database — and so it is obvious that nothing here is
 * learned from raw chat text.
 */
export function buildLearnerProfile(
  progress: {
    weakPoints?: WeakPoint[];
    testHistory?: TestEvaluation[];
    reviewCards?: ReviewCard[];
  } | null | undefined,
  now: Date = new Date(),
): LearnerProfile {
  const weakPoints = progress?.weakPoints ?? [];
  const history = progress?.testHistory ?? [];
  const cards = progress?.reviewCards ?? [];

  // Only the topics we have an actual measurement for. Anything weaker than the
  // threshold is not "strong" — it is simply not a problem, and calling it
  // strong would invite the tutor to skip a concept the student has never been
  // asked about.
  const weak = weakPoints
    .filter((point) => point.strength < WEAK_POINT_THRESHOLD)
    .sort((a, b) => a.strength - b.strength)
    .map((point) => point.topic);
  const strong = weakPoints
    .filter((point) => point.strength >= WEAK_POINT_THRESHOLD)
    .map((point) => point.topic);

  // A misconception is worth telling the tutor about if we are *confident* about
  // it, not only if the student has repeated it verbatim.
  //
  // Requiring two identical strings looks rigorous and is useless in practice:
  // the grader phrased the same underlying belief two different ways in the
  // live run ("backprop is just trial and error" / "backprop is a loop that
  // tries different weights"), so a repeat counter found nothing and the tutor
  // was told the student had no known misconception at all — while we were
  // holding two of them.
  //
  // So: repeats rank first, because a belief that survives two sittings is
  // certainly real, and the most recent misconception on each weak topic
  // follows. Weak topic + a specific wrong idea is directly actionable; the
  // absence of an exact repeat is not evidence of absence.
  const counts = new Map<string, { text: string; count: number; at: number }>();
  history.forEach((evaluation, index) => {
    for (const item of evaluation.misconceptions ?? []) {
      const text = item.trim();
      if (!text) continue;
      const key = text.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        existing.text = text;
        existing.at = index;
      } else {
        counts.set(key, { text, count: 1, at: index });
      }
    }
  });

  const weakSet = new Set(weak.map((topic) => topic.toLowerCase()));
  const ranked = [...counts.values()]
    .map((entry) => ({
      entry,
      // A misconception on a topic we have measured as weak is worth more than
      // the same text on a topic we have no signal for.
      onWeakTopic: weakSet.has(history[entry.at]?.topic?.toLowerCase() ?? ""),
    }))
    .sort((a, b) => {
      if (a.entry.count !== b.entry.count) return b.entry.count - a.entry.count;
      if (a.onWeakTopic !== b.onWeakTopic) return a.onWeakTopic ? -1 : 1;
      return b.entry.at - a.entry.at;
    });

  const recurring = ranked
    .slice(0, MAX_MISCONCEPTIONS)
    .map(({ entry }) => entry.text);

  const due = dueCards(cards, now).map((card) => card.topic);
  const hasAssessmentSignal = history.length >= MIN_ASSESSMENTS_FOR_PROFILE;

  return {
    weakTopics: weak.slice(0, MAX_PROFILE_TOPICS),
    strongTopics: strong.slice(0, MAX_PROFILE_TOPICS),
    recurringMisconceptions: recurring,
    isWellCalibrated: hasAssessmentSignal,
    // "Struggling" is a claim about a person, so it needs more than one data
    // point. One bad test is a bad test.
    overallStruggling: hasAssessmentSignal && weak.length >= 2,
    hasAssessmentSignal,
    dueTopics: due.slice(0, MAX_PROFILE_TOPICS),
  };
}

/**
 * How hard the next question should be for a given topic.
 *
 * Three bands, not a 1-10 scale. A text generator cannot reliably produce a
 * graded difficulty ramp, and a score of "difficulty 7" tells the model nothing
 * it can act on. What it *can* act on is a shape: one small concrete step, a
 * normal explanatory question, or a second-step edge case.
 */
export type DifficultyBand = "remedial" | "standard" | "stretch";

/** Below this, the student is not holding this at all. */
const REMEDIAL_BELOW = 40;
/** At or above this, and with a review behind it, they can take more on. */
const STRETCH_AT = 75;

/**
 * Pick the band for a topic, from what we actually know about it.
 *
 * Defaults to "standard" when we have no signal at all. Starting a brand-new
 * student on remedial questions is the tempting choice and the wrong one: it
 * wastes the one chance to find out what they can do, and it reads as being
 * talked down to before anyone has looked.
 */
export function difficultyForTopic(
  progress: {
    weakPoints?: WeakPoint[];
    reviewCards?: ReviewCard[];
  } | null | undefined,
  topic: string,
): DifficultyBand {
  const key = topic.trim().toLowerCase();
  if (!key) return "standard";

  const point = (progress?.weakPoints ?? []).find(
    (p) => p.topic.trim().toLowerCase() === key,
  );
  const card = (progress?.reviewCards ?? []).find(
    (c) => c.topic.trim().toLowerCase() === key,
  );

  // Never seen it: no evidence either way.
  if (!point && !card) return "standard";

  const strength = point?.strength ?? card?.strength ?? 50;
  if (strength < REMEDIAL_BELOW) return "remedial";

  // Stretch needs proof, not one good answer: a solid score *and* at least one
  // successful review, so we know it held rather than landed once.
  if (strength >= STRETCH_AT && (card?.reps ?? 0) >= 1) return "stretch";

  return "standard";
}

/**
 * Turn a band into instructions the question generator can actually use.
 *
 * Note what is deliberately absent: any suggestion that the student be told
 * they received an easier question. Being handed remedial work is only useful if
 * the student believes it was a normal question — the moment it is labelled, it
 * becomes a verdict on them instead of a decision about the question.
 */
export function difficultyClause(band: DifficultyBand): string {
  switch (band) {
    case "remedial":
      return (
        "This student is struggling with this topic. Ask ONE small, concrete " +
        "question that can be answered in a single step. Build a worked example " +
        "into the question itself. Do not assume any steps they have not shown. " +
        "Keep it under 30 words. Do not mention that the question was made easier."
      );
    case "stretch":
      return (
        "This student already has this topic. Ask something that needs a second " +
        "step of reasoning: a 'what would change if', an edge case, or a situation " +
        "where the standard approach breaks down. Do NOT ask them to define the " +
        "term or recite a property. Keep it under 40 words."
      );
    default:
      return (
        "Ask a normal question that requires explaining the idea, not recalling a " +
        "definition. Keep it under 40 words."
      );
  }
}

/**
 * The first prerequisite the student hasn't got, for a topic they are stuck on.
 *
 * This is the piece that makes "weak on X" actionable. Knowing a student is bad
 * at transformers is not enough; the useful question is *why*, and usually the
 * answer is a prerequisite they never had. Sending them forward regardless is
 * how a student ends up five modules behind and doesn't know it.
 *
 * Returns null when every known prerequisite looks fine, or when the topic isn't
 * in the graph at all — an uncurated module is not a reason to block anyone.
 */
export function firstMissingPrerequisite(
  topic: string,
  graph: ReadonlyMap<string, readonly string[]>,
  weakTopics: readonly string[],
): string | null {
  const prereqs = graph.get(topic.trim().toLowerCase());
  if (!prereqs || !prereqs.length) return null;

  const weak = weakTopics.map((t) => t.trim().toLowerCase());
  // Ordered, not sorted: the first prerequisite is the one that comes first in
  // the chain, and fixing it is what unblocks the rest.
  for (const prereq of prereqs) {
    const key = prereq.trim().toLowerCase();
    if (weak.includes(key)) return prereq;
  }
  return null;
}

/**
 * Follow the chain to the root cause.
 *
 * A student weak on transformers may be weak on attention, which may be weak on
 * matrix multiplication. Recommending attention would be technically true and
 * practically useless, so this walks down while the next step down is *also*
 * known-weak, and stops at the deepest gap.
 *
 * Bounded, because a cycle in hand-written curriculum data would otherwise hang
 * the request. The curriculum is authored content and can be edited wrong.
 */
export function rootCauseTopic(
  topic: string,
  graph: ReadonlyMap<string, readonly string[]>,
  weakTopics: readonly string[],
  maxDepth = 5,
): string | null {
  const weak = weakTopics.map((t) => t.trim().toLowerCase());
  let current = topic.trim().toLowerCase();
  let result: string | null = null;
  const seen = new Set<string>([current]);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const prereqs = graph.get(current);
    if (!prereqs) break;
    const next = prereqs.find((p) => {
      const key = p.trim().toLowerCase();
      return weak.includes(key) && !seen.has(key);
    });
    if (!next) break;
    seen.add(next.trim().toLowerCase());
    current = next.trim().toLowerCase();
    result = next;
  }
  return result;
}


/** Short human label, for the dashboard. */
export function difficultyLabel(band: DifficultyBand): string {
  switch (band) {
    case "remedial":
      return "gentle start";
    case "stretch":
      return "pushing you";
    default:
      return "right level";
  }
}

/**
 * Render the profile as a short briefing for the tutor's system prompt.
 *
 * Returns "" for a student we know nothing about yet. An empty briefing is
 * genuinely different from an empty-looking one: "no data" must never be
 * mistaken for "no weak points", or the tutor will confidently tell a brand-new
 * student they're doing great.
 *
 * Plain lines rather than JSON: the model reads prose about a person far better
 * than it reads a record, and a long JSON blob of telemetry is exactly the
 * thing that gets a model to behave like a database.
 */
export function renderLearnerBriefing(
  profile: LearnerProfile,
  band: DifficultyBand = "standard",
): string {
  if (!profile.hasAssessmentSignal) return "";

  const lines: string[] = [];
  lines.push("What you already know about this student:");
  if (profile.weakTopics.length) {
    lines.push(`- Shaky so far: ${profile.weakTopics.join(", ")}.`);
  }
  if (profile.strongTopics.length) {
    lines.push(`- Solid on: ${profile.strongTopics.join(", ")}. Do not re-explain these from scratch.`);
  }
  if (profile.recurringMisconceptions.length) {
    lines.push(
      "- They have repeatedly shown this wrong thinking. Address it directly, by name: " +
        `${profile.recurringMisconceptions.join("; ")}.`,
    );
  }
  if (profile.dueTopics.length) {
    lines.push(
      `- These came up in review and are due again: ${profile.dueTopics.join(", ")}.`,
    );
  }
  if (band === "remedial") {
    lines.push(
      "- On this topic they are not holding it yet. Keep each step to one move, use a concrete example before any formula, and check the last step landed before moving on. Never say the difficulty was lowered.",
    );
  } else if (band === "stretch") {
    lines.push(
      "- They have this topic. Do not simply re-explain it: bring in an edge case, a failure mode, or a 'what would change if', and let them do the reasoning.",
    );
  }
  if (profile.overallStruggling) {
    lines.push(
      "- They are struggling across several topics. Slow down, use a concrete example before any formula, and check understanding early rather than explaining at length.",
    );
  }
  lines.push(
    "Use this to change *how* you teach them. Do not recite it back to them or mention that you are keeping notes.",
  );
  return lines.join("\n");
}

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
 * Apply a read-compute-write to `Progress` without losing a concurrent update.
 *
 * `weakPoints`, `reviewCards` and `testHistory` are arrays inside one document,
 * and both the chat path and the assessment path fold new observations into them
 * by reading the array, computing a new one, and `$set`-ting the whole thing.
 * Two writers doing that concurrently — a student submitting a graded answer
 * while their own next message is being processed — both read the same starting
 * array and the second write silently discards the first. The lost update is
 * invisible: no error, and a weak point the tutor was just told about vanishes
 * from the profile that produced the next prompt.
 *
 * Fixed by making the write conditional on the value it was computed from. The
 * filter requires the stored array to still equal what we read, so a writer that
 * raced simply matches nothing and retries against the newer value. This is
 * optimistic concurrency: no transactions, no locks, and the common case — no
 * concurrent writer — is still a single round trip.
 *
 * `mutate` must be pure with respect to `current`, because it is called again on
 * every retry with a fresh read.
 */
export async function updateProgressWithRetry<T>(
  studentId: string,
  fields: readonly string[],
  mutate: (current: Record<string, unknown>) => { set: Record<string, unknown>; result: T },
  attempts = 3,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current: Record<string, unknown> =
      (await Progress.findOne({ studentId }).lean()) ?? {};

    // Only the fields this mutation depends on participate in the guard, so an
    // unrelated concurrent write doesn't force a pointless retry.
    const guard: Record<string, unknown> = { studentId };
    for (const field of fields) {
      const value = current[field];
      guard[field] = { $eq: value ?? null };
    }

    const { set, result } = mutate(current);

    const updated = await Progress.findOneAndUpdate(
      guard,
      { $set: set },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    // A returned document means our guard still held, so nobody wrote in
    // between. Null means we lost the race and must recompute from the newer
    // value; an upsert that matched nothing also returns null, and the retry
    // creates the row.
    if (updated) {
      return result;
    }
  }

  // Every attempt was contended by a concurrent writer, so the guard never held
  // and nothing was written. Thrown rather than silently ignored: three
  // simultaneous writers to one student's progress is not a realistic race, and
  // dropping a graded result on the floor is worse than a visible error.
  throw new Error("Could not update progress after retrying.");
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
  const mastery = clampMastery(masteryEstimate);

  return updateProgressWithRetry<{ learningSpeed: number; weakPoints: WeakPoint[] }>(
    studentId,
    ["weakPoints"],
    (current) => {
      const weakPoints = mergeWeakPoints(
        (current.weakPoints ?? []) as WeakPoint[],
        topic,
        mastery,
      );
      return {
        set: { weakPoints, learningSpeed: computeLearningSpeed(topicsVisited) },
        result: { learningSpeed: computeLearningSpeed(topicsVisited), weakPoints },
      };
    },
  );
}

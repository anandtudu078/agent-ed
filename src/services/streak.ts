/**
 * Study streaks and the daily goal.
 *
 * Every other part of the learner model measures *mastery* — what a student
 * knows, how shaky it is, what is due for review. None of it measures *habit*, and
 * habit is what decides whether they come back on the tenth session, which is
 * where all the adaptive machinery starts to pay off. A student who studies four
 * days a week for a term learns more than one who does four intense hours on a
 * Sunday and then disappears for a month, and the rest of this app would score
 * them identically.
 *
 * So this module adds the missing dimension, and nothing else: a count of
 * consecutive days with activity, and whether today's goal is met.
 *
 * Three deliberate choices, all of which are about not lying to the student:
 *
 *  - **Derived on read, never stored.** A stored `streak: 7` is wrong the instant
 *    midnight passes — the same staleness bug the README calls out for `isDue`.
 *    There is no streak field anywhere; it is recomputed from timestamps that are
 *    already there.
 *  - **A streak survives "today" not being done yet.** Yesterday's activity means
 *    a current streak of 5 is still alive at 9am; it just has not been extended.
 *    Zeroing it at midnight is how habit trackers make students feel punished for
 *    opening the app, which is the opposite of what this app wants.
 *  - **Honest about missing timestamps.** `ConversationMessage.at` is optional,
 *    because messages written before it existed carry none. Those days are
 *    genuinely unknown, so they count for nothing rather than being invented.
 *
 * Pure and clock-injectable, like `checkpoints.ts` and `returnState.ts`, so the
 * rules are testable without a database or a clock.
 */

/**
 * Study turns that count as a day's activity.
 *
 * A *turn* is a student message, not a session or a topic: opening the app and
 * being greeted is not studying, and neither is the tutor talking to itself.
 */
export const DAILY_GOAL_TURNS = 5;

/**
 * Days of history to scan.
 *
 * A bound on the work done per dashboard load, and a bound on how far back a
 * "longest streak" claim can reach. Beyond a year the longest streak has stopped
 * meaning anything to a student, and `topicsVisited` is itself capped
 * (MAX_STORED_TOPIC_VISITS), so the data is bounded anyway.
 */
export const MAX_STREAK_SCAN_DAYS = 400;

export interface StreakActivity {
  /** A student message that was actually sent. */
  turns: number;
  /** A graded test sitting in the history. */
  tests: number;
}

/**
 * A day's worth of evidence, keyed by local calendar day (`YYYY-MM-DD`).
 *
 * Built by `activityByDay`, which is the only place dates are turned into keys —
 * so there is exactly one definition of "a day" in this file.
 */
export type ActivityByDay = Map<string, StreakActivity>;

export interface StreakState {
  /** Consecutive active days ending today or yesterday. 0 when the chain has broken. */
  current: number;
  /** Longest run of consecutive active days ever recorded. */
  longest: number;
  /** Days since the student was last active. Null when there is no history at all. */
  lastActiveDaysAgo: number | null;
  /** True when today already has enough activity to count as studying. */
  studiedToday: boolean;
  /** Today's turn count, including anything beyond the goal. */
  todayTurns: number;
  /** Turns still wanted today. Never negative — a day well past the goal is 0. */
  turnsToGoal: number;
  /** Whether today's turn goal is met. */
  goalMet: boolean;
  /**
   * A one-line nudge, or "" is never returned — this is always something honest
   * to say, because "one question starts today" is useful to a new student too.
   */
  message: string;
}

/**
 * A stored message, reduced to the two fields the streak cares about.
 *
 * The index signature is deliberate: callers pass real Mongoose lean documents,
 * which carry a dozen fields (`visual`, `_id`, `at` as an ObjectId…), and the
 * rule here is that *this module* only cares about `role` and `at`. Typing the
 * inputs as the exact record shapes would push a redundant restatement of every
 * unrelated field into `streakFor`'s signature, and would make every future
 * field on `ConversationMessage` a compile error here.
 */
export interface StreakMessageLike {
  role?: string;
  at?: Date | string | null;
  [key: string]: unknown;
}

export interface StreakTestLike {
  evaluatedAt?: Date | string | null;
  [key: string]: unknown;
}

export interface StreakVisitLike {
  firstSeenAt?: Date | string | null;
  [key: string]: unknown;
}

/**
 * Fold stored activity into per-day totals.
 *
 * Accepts everything we already have rather than one pre-aggregated number, so
 * the caller never has to decide what counts as studying — that decision lives
 * here, once, where it can be tested and argued about.
 *
 * `messages` are the stored conversation; only `role: "user"` messages count.
 * The tutor's own half of the thread is the app talking to itself.
 *
 * Invalid and unparseable dates are dropped rather than thrown on: this runs on
 * every dashboard load, and one malformed record must not blank the dashboard.
 * Future timestamps are dropped too, which keeps a wrong client clock from
 * inflating today's count.
 */
export function activityByDay(input: {
  messages?: Array<StreakMessageLike | null> | null;
  testHistory?: Array<StreakTestLike | null> | null;
  topicsVisited?: Array<StreakVisitLike | null> | null;
  now?: Date;
}): ActivityByDay {
  const now = input.now ?? new Date();
  const cutoff = new Date(
    startOfLocalDay(now).getTime() - MAX_STREAK_SCAN_DAYS * 86_400_000,
  );
  const byDay: ActivityByDay = new Map();

  const record = (raw: unknown, field: "turns" | "tests") => {
    if (raw === null || raw === undefined) return;
    const date =
      raw instanceof Date
        ? raw
        : typeof raw === "string" || typeof raw === "number"
          ? new Date(raw)
          : null;
    if (!date || Number.isNaN(date.getTime())) return;
    if (date < cutoff || date.getTime() > now.getTime()) return;
    const key = localDay(date);
    const entry = byDay.get(key) ?? { turns: 0, tests: 0 };
    entry[field] += 1;
    byDay.set(key, entry);
  };

  for (const message of input.messages ?? []) {
    if (!message || message.role !== "user") continue;
    record(message.at, "turns");
  }
  for (const test of input.testHistory ?? []) {
    if (!test) continue;
    record(test.evaluatedAt, "tests");
  }
  for (const visit of input.topicsVisited ?? []) {
    if (!visit) continue;
    record(visit.firstSeenAt, "turns");
  }

  return byDay;
}

/**
 * Whether a day has enough activity to count as a study day.
 *
 * A day with a graded test counts even with no messages — sitting an assessment
 * is studying, and a student who tests without chatting has not failed. A day with
 * only a topic visit does not, because reaching a topic is recorded as a side
 * effect of other activity and is weak evidence on its own.
 *
 * `goal` participates so the rule stays honest if it is ever lowered: at the real
 * goal of 5 a single bare turn keeps a chain alive, and at a goal of 1 the
 * `Math.min` makes it exactly the same rather than "5 turns or nothing".
 */
function isStudyDay(entry: StreakActivity | undefined, goal: number): boolean {
  if (!entry) return false;
  return entry.turns >= Math.min(1, goal) || entry.tests > 0;
}

/**
 * The local calendar day a timestamp falls on.
 *
 * Local rather than UTC on purpose. "Did I study today" is a question about the
 * student's own midnight, and a UTC boundary would reset an evening's streak
 * eight hours before the student experienced the day ending.
 *
 * Built by hand rather than via `toISOString().slice(0, 10)`, because that is UTC
 * and would be the opposite of the intent.
 */
export function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Midnight on `date`'s day, in local time. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight for a `YYYY-MM-DD` key, without the UTC parse trap. */
export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Whole days from `earlier`'s day to `later`'s day. */
export function daysBetween(earlier: Date, later: Date): number {
  return Math.round(
    (startOfLocalDay(later).getTime() - startOfLocalDay(earlier).getTime()) / 86_400_000,
  );
}

/** The local day before `date`'s day. */
function previousLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
}

/**
 * What to say about the streak.
 *
 * The rule that matters: **never negative.** A student whose streak has broken is
 * told what starting again looks like, because a habit tracker that says "you have
 * lost your 12-day streak" teaches a student that the app is a source of bad news
 * about them — which, for a tutor aimed at students who are already behind, is the
 * most effective way to make them not come back.
 */
function streakMessage(input: {
  current: number;
  studiedToday: boolean;
  turnsToGoal: number;
  goalMet: boolean;
  goal: number;
}): string {
  if (input.goalMet) return `Today's goal met — ${input.goal} questions with the tutor.`;
  if (input.studiedToday) {
    return `${input.turnsToGoal} more question${input.turnsToGoal === 1 ? "" : "s"} to today's goal.`;
  }
  if (input.current > 0) {
    return `${input.current}-day streak still alive — one question keeps it going.`;
  }
  return "One question starts today.";
}

/**
 * The streak, derived from per-day activity.
 *
 * The current streak is found by walking backwards, starting at today when it
 * counts and at yesterday otherwise. That single `studiedToday ?` decision is the
 * rule the whole design turns on: a chain of 5 days is still 5 days at 9am this
 * morning, not 0, so the student opening the app sees their run intact and a
 * reason to extend it rather than a number that fell to zero while they slept.
 *
 * `goal` is injectable so the "one bare turn keeps a chain alive" rule can be
 * tested at the real goal of 5 without inventing five messages, and so a future
 * per-student goal can be threaded in without touching the arithmetic.
 */
export function streakState(
  byDay: ActivityByDay,
  now: Date = new Date(),
  goal: number = DAILY_GOAL_TURNS,
): StreakState {
  const today = byDay.get(localDay(now));
  const todayTurns = today?.turns ?? 0;
  const studiedToday = isStudyDay(today, goal);

  let current = 0;
  let cursor = studiedToday ? startOfLocalDay(now) : previousLocalDay(now);
  // Bounded by the scan window as well as by a break, so no input can spin here.
  for (let i = 0; i <= MAX_STREAK_SCAN_DAYS; i += 1) {
    if (!isStudyDay(byDay.get(localDay(cursor)), goal)) break;
    current += 1;
    cursor = previousLocalDay(cursor);
  }

  // Longest run over the whole record, in one ordered pass. `run` resets to 1 on
  // a gap rather than 0 so that the day just seen is itself the first of a run.
  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of [...byDay.keys()].sort()) {
    if (!isStudyDay(byDay.get(key), goal)) {
      run = 0;
      previous = null;
      continue;
    }
    const asDate = parseDayKey(key);
    run = previous && daysBetween(previous, asDate) === 1 ? run + 1 : 1;
    previous = asDate;
    if (run > longest) longest = run;
  }

  // Most recent qualifying day, for "last seen" copy. Scans backwards rather than
  // sorting, because a day's activity out of chronological order (a backfilled
  // test) must not become the answer.
  let lastActiveDaysAgo: number | null = null;
  for (let i = 0; i <= MAX_STREAK_SCAN_DAYS; i += 1) {
    const probe = new Date(startOfLocalDay(now).getTime() - i * 86_400_000);
    if (isStudyDay(byDay.get(localDay(probe)), goal)) {
      lastActiveDaysAgo = i;
      break;
    }
  }

  const turnsToGoal = Math.max(0, goal - todayTurns);
  const goalMet = todayTurns >= goal;

  return {
    current,
    // A live streak is by definition part of the record, so it can never be
    // reported as shorter than the longest run seen.
    longest: Math.max(longest, current),
    lastActiveDaysAgo,
    studiedToday,
    todayTurns,
    turnsToGoal,
    goalMet,
    message: streakMessage({ current, studiedToday, turnsToGoal, goalMet, goal }),
  };
}

/**
 * Streak plus today's totals, straight from stored data.
 *
 * The wrapper the dashboard uses: it takes the collections already at hand and
 * returns the whole shape, so the route never has to remember the order of the
 * two steps or accidentally derive "today" from a different clock than the count.
 */
export function streakFor(input: {
  messages?: Array<StreakMessageLike | null> | null;
  testHistory?: Array<StreakTestLike | null> | null;
  topicsVisited?: Array<StreakVisitLike | null> | null;
  goal?: number;
  now?: Date;
}): StreakState {
  const now = input.now ?? new Date();
  const goal = input.goal ?? DAILY_GOAL_TURNS;
  return streakState(activityByDay({ ...input, now }), now, goal);
}
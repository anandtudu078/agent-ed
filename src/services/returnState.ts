import { dueCards } from "./progressService";
import type { ReviewCard, TestEvaluation } from "../models/Progress";
import type { ConversationMessage } from "../models/Session";

/**
 * What happened while the student was away, and what to pick up with.
 *
 * The review schedule is passive by nature: a card comes due and sits in the
 * database. Nothing brings the student back, and every piece of adaptive
 * machinery in this app only pays off from the tenth session onwards. This is
 * the one place that closes that loop, and it should be the first thing the owl
 * says — the character's whole job is to make coming back feel like something
 * rather than like opening a website.
 */
export interface ReturnState {
  /** Milliseconds since the last thing they said or did. Null if never. */
  awayMs: number | null;
  /** True when it has been long enough to be worth acknowledging. */
  isReturn: boolean;
  /** How many concepts are waiting for review. */
  dueCount: number;
  /** The topic to pick the thread back up on. */
  resumeTopic: string | null;
  /** True when they left part-way through a question. */
  leftMidQuestion: boolean;
  /**
   * The owl's opening line, or "" when there's nothing worth saying.
   *
   * Empty for a brand-new student on purpose: a welcome is a thing you say to
   * someone who has been away, and announcing yourself to someone who just
   * arrived reads as a canned message rather than a welcome back.
   */
  greeting: string;
}

const RETURN_AFTER_MINUTES = 30;
/** Not worth a greeting on its own — a short break is not a return. */
const SHORT_ABSENCE_MINUTES = 120;

function describeAway(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * Derive the return state.
 *
 * `at` is optional on stored messages, so "when was the student last here" is
 * genuinely unknown for any session written before timestamps existed. That is
 * reported as null rather than guessed: a wrong answer here would greet a
 * student as though they had been away for months.
 */
export function returnState(
  input: {
    conversation?: ConversationMessage[];
    reviewCards?: ReviewCard[];
    testHistory?: TestEvaluation[];
    activeTopic?: string | null;
  },
  now: Date = new Date(),
): ReturnState {
  const conversation = (input.conversation ?? []).filter(Boolean);
  const cards = input.reviewCards ?? [];
  const due = dueCards(cards, now);

  const timestamps = conversation
    .map((message) => (message.at ? new Date(message.at).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const lastActivity = timestamps.length
    ? new Date(Math.max(...timestamps))
    : null;
  const awayMs = lastActivity ? Math.max(0, now.getTime() - lastActivity.getTime()) : null;
  const isReturn = awayMs !== null && awayMs >= RETURN_AFTER_MINUTES * 60_000;

  // A trailing student message with no tutor answer means they left mid-flight.
  const last = conversation[conversation.length - 1];
  const leftMidQuestion = last?.role === "user";

  const resumeTopic = input.activeTopic?.trim() || null;

  if (!isReturn) {
    return { awayMs, isReturn: false, dueCount: due.length, resumeTopic, leftMidQuestion, greeting: "" };
  }

  const parts: string[] = [`Welcome back! It has been ${describeAway(awayMs!)}.`];

  if (due.length) {
    parts.push(
      due.length === 1
        ? "You have 1 concept ready to review."
        : `You have ${due.length} concepts ready to review.`,
    );
  }
  if (leftMidQuestion && resumeTopic) {
    // Naming the unfinished question is more useful than a generic "pick up
    // where you left off", and it costs nothing to be specific.
    parts.push(`We left off part-way through ${resumeTopic}.`);
  }

  return {
    awayMs,
    isReturn: true,
    dueCount: due.length,
    resumeTopic,
    leftMidQuestion,
    greeting: parts.join(" "),
  };
}

/** Is this student brand new — nothing learned, nothing asked? */
export function isFirstRun(input: {
  conversation?: ConversationMessage[];
  testHistory?: TestEvaluation[];
  reviewCards?: ReviewCard[];
}): boolean {
  const conversation = (input.conversation ?? []).filter(
    (message) => message?.role === "user" && message.content?.trim(),
  );
  return (
    conversation.length === 0 &&
    (input.testHistory ?? []).length === 0 &&
    (input.reviewCards ?? []).length === 0
  );
}

/**
 * The course a brand-new student should start on.
 *
 * Deliberately a fixed answer rather than a guess. With no history there is
 * nothing to infer from, and pretending otherwise — "based on your level" — is
 * the kind of claim that is always wrong. This starts them at the beginning of
 * the field, which is the honest recommendation for someone who has told us
 * nothing.
 */
export function recommendedStarterCourse(): { title: string; topic: string } {
  return {
    title: "What Is Artificial Intelligence?",
    topic: "history of artificial intelligence",
  };
}

/** Exposed for the dashboard, which shows the same "how long were you away". */
export function awayLabel(awayMs: number | null): string {
  if (awayMs === null) return "";
  if (awayMs < SHORT_ABSENCE_MINUTES * 60_000) return "";
  return `Away ${describeAway(awayMs)}`;
}

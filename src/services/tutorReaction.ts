/**
 * How the owl should look and feel about the turn it just had.
 *
 * The point of this module is that the owl's reaction is a *function of the
 * student's turn*, not of the owl's own task. Before this existed the client
 * received `analysis` as an opaque JSON string it never parsed, so the only
 * thing that ever moved the mascot's face was a graded test score. A student
 * could have three turns go badly in the chat and the owl looked identical to one
 * who'd just had a breakthrough — which is precisely when a companion is supposed
 * to react.
 *
 * Kept pure and server-side so the rules are unit-testable. `flowSignals` is the
 * same idea for pacing; this is the same idea for affect.
 *
 * The vocabulary is the client's `MascotMood`. These strings cross the socket, so
 * a typo here silently produces a neutral owl rather than an error — which is
 * why `isTutorReaction` validates on the way out of the client.
 */

/** Subset of `MascotMood` a tutor turn may legitimately produce. */
export type TutorReaction = "neutral" | "happy" | "excited" | "supportive";

/** Below this we assume the student is lost, not merely unconfident. */
const STRUGGLING_MASTERY = 40;
/** At or above this the turn genuinely went well. */
const STRONG_MASTERY = 75;
/** Strong, but not strong enough to celebrate without more than one turn's worth. */
const SOLID_MASTERY = 60;

export interface TutorTurnSignals {
  /** The model's read of how well the student understands the topic right now. */
  masteryEstimate: number;
  /** Specific wrong ideas the turn revealed. */
  coreMisunderstandings?: string[];
  /** True when the model is asking the student a question rather than answering. */
  isQuestion?: boolean;
}

/**
 * Decide the owl's reaction to one student turn.
 *
 * `isQuestion` is the single most useful input and the reason this is not just
 * a mastery threshold: when the tutor replies with a question, it is engaging
 * the student's idea rather than correcting it, and a warm reaction reads as
 * "I'm with you" rather than "you're doing well" — which is the honest thing to
 * convey, since a question is not evidence of understanding either way.
 *
 * Defaults to `neutral` for anything missing or malformed. A missing signal must
 * not produce enthusiasm; an owl that invents a mood is worse than a quiet one.
 */
export function tutorReaction(turn: TutorTurnSignals | null | undefined): TutorReaction {
  if (!turn) return "neutral";

  const raw = turn.masteryEstimate;
  // `Number.isFinite` rather than `isNaN`, so a non-finite value is rejected
  // outright instead of clamped. A finite out-of-range number is a model scoring
  // on the wrong scale and clamping is fair; `Infinity` is not a number, and
  // treating it as a top score would let malformed output produce the owl's
  // strongest reaction.
  const mastery = typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(100, Math.max(0, raw))
    : null;
  if (mastery === null) return "neutral";

  if (turn.isQuestion) {
    // A question keeps the student in the conversation, which is the win here.
    // Warm, but never "excited" — nothing has been demonstrated yet.
    return mastery >= SOLID_MASTERY ? "happy" : "supportive";
  }

  if (mastery < STRUGGLING_MASTERY) {
    // Genuinely behind. `supportive` rather than `neutral` on purpose: a neutral
    // face next to a struggling student reads as indifference.
    return "supportive";
  }

  if (mastery >= STRONG_MASTERY) {
    // Only celebrate a strong turn, and only when nothing was left unaddressed.
    // A turn with fresh misconceptions is not a success, however well the rest
    // of it read.
    const openGaps = (turn.coreMisunderstandings ?? []).filter(
      (item) => typeof item === "string" && item.trim().length > 0,
    ).length;
    return openGaps === 0 ? "excited" : "happy";
  }

  return "happy";
}

/** Guard for the value arriving over the socket. */
export function isTutorReaction(value: unknown): value is TutorReaction {
  return (
    value === "neutral" ||
    value === "happy" ||
    value === "excited" ||
    value === "supportive"
  );
}

/**
 * Whether a tutor reply is a question — i.e. engaging rather than lecturing.
 *
 * A trailing question mark is the signal, but not the only one: models routinely
 * end a Socratic reply with "what do you think?" or "try it and see" with no
 * punctuation at all, and treating those as statements would leave the owl cold
 * through exactly the turns it is supposed to be warmest on.
 */
export function looksLikeQuestion(reply: string): boolean {
  const text = reply.trim();
  if (!text) return false;
  if (/[?؟]\s*$/.test(text)) return true;
  return /\b(what do you (think|feel)|why do you think|how would you|can you explain|tell me|what would you)\b/i.test(
    text,
  );
}
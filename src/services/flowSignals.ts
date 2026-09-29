import type { ConversationMessage } from "../models/Session";
import { normalizeTopic } from "./courseService";

/**
 * What the transcript says about how this student is learning *right now*.
 *
 * Deliberately narrow. This detects repeated asking and unusual pacing, both of
 * which are observable facts about the messages. It does not attempt to detect
 * frustration, confusion, or giving up: those are inferences about a person's
 * emotional state, we have no ground truth for them, and a tutor that says
 * "you seem frustrated" to a student who is fine is worse than one that says
 * nothing. If those signals are ever wanted they need to be a student's own
 * report, not our guess.
 */
export interface FlowSignals {
  /**
   * How many previous messages were substantively the same question.
   *
   * "Substantively" means the same key terms, not the same string — a student
   * stuck on recursion will rephrase it three different ways, and exact
   * matching would score that as three different questions.
   */
  repeats: number;
  /** Consecutive turns on one topic with no sign of moving on. */
  sameTopicRun: number;
  /** Milliseconds between the first and last message we have times for. */
  sessionSpanMs: number | null;
  /** True when the only evidence is too thin to act on. */
  unknown: boolean;
}

const MIN_MESSAGES_FOR_SIGNAL = 4;
/**
 * Containment, not Jaccard.
 *
 * Jaccard divides by the union, so adding a word to an otherwise identical
 * question tanks the score — "recursion" and "recursion step by step please"
 * score 0.33 against each other, which is exactly the rephrasing we need to
 * catch. Containment divides by the *smaller* set, so a short question fully
 * inside a longer one counts as a match.
 */
const REPEAT_OVERLAP = 0.6;
/** "Stuck right now", not "asked about this at some point in the session". */
const FLOW_WINDOW_MINUTES = 45;
const FLOW_WINDOW_MESSAGES = 4;

/**
 * Conversational filler, and words that describe the *student's state* rather
 * than the subject.
 *
 * "I still do not get recursion at all" and "recursion is still confusing"
 * are the same question with opposite sentiment. Keeping "still", "get" and
 * "confusing" makes those two look ~30% similar when they are 100% the same
 * subject. "frustrated" would be the same class of word — which is the other
 * reason emotional state is excluded from this module entirely: it is not
 * topical signal, it is a guess about a person.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "can",
  "you", "me", "my", "i", "to", "of", "and", "or", "in", "on", "it", "its",
  "this", "that", "these", "those", "be", "been", "am", "have", "has", "had",
  "what", "which", "how", "why", "when", "where", "who",
  "explain", "tell", "about", "for", "with", "from", "as", "at", "by", "if",
  "but", "not", "no", "so", "then", "than", "we", "our", "us", "they", "them",
  "show", "give", "please", "help", "work", "works", "working", "code", "step",
  "steps", "example", "examples", "way", "ways", "thing", "things", "part",
  "use", "using", "used", "want", "need", "try", "tried", "again", "still",
  "get", "got", "understand", "understood", "confused", "confusing", "clear",
  "mean", "means", "simple", "easier", "harder", "better", "good", "much",
  "more", "less", "very", "really", "actually", "just", "also", "because",
  "morning", "evening", "afternoon", "hi", "hello", "hey", "thanks", "thank",
]);

/** Content words worth comparing; question words and filler carry no signal. */
function contentTerms(text: string): Set<string> {
  return new Set(
    normalizeTopic(text)
      .split(" ")
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
  );
}

/** Jaccard overlap of two term sets: how much two questions share. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Derive the flow signals from a conversation, up to but excluding the message
 * currently being answered.
 *
 * Pure and clock-injectable. `now` is the time of the incoming message, so the
 * span is measured to *now* rather than to the last stored message.
 */
export function flowSignals(
  conversation: ConversationMessage[],
  incoming: string,
  now: Date = new Date(),
): FlowSignals {
  const userMessages = (conversation ?? []).filter((m) => m?.role === "user");
  if (userMessages.length < MIN_MESSAGES_FOR_SIGNAL) {
    return { repeats: 0, sameTopicRun: 0, sessionSpanMs: null, unknown: true };
  }

  // The span is measured over the whole session, before any windowing, because
  // "how long have they been here" and "are they stuck right now" are different
  // questions. A student who has been working for two hours but asked their
  // last three unrelated questions is not stuck, and collapsing both into one
  // 45-minute window would report their session as having no duration at all.
  const times = [...userMessages, { at: now }]
    .map((m) => (m.at ? new Date(m.at).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  // Fewer than two real timestamps means we have no idea, not a zero-length
  // session. Reporting 0 here would make every pre-timestamp student look like
  // they had just started.
  const sessionSpanMs =
    times.length >= 2 ? Math.max(0, times[times.length - 1] - times[0]) : null;

  // Both time- and count-bounded. The time bound is the important one: a student
  // who asked about recursion this morning and is asking again this afternoon
  // is revising, not stuck, and a count-only window cannot tell them apart.
  const cutoff = now.getTime() - FLOW_WINDOW_MINUTES * 60_000;
  const recent = userMessages
    .filter((message) => {
      if (!message.at) return true; // unknown time: keep, don't invent one
      const t = new Date(message.at).getTime();
      return !Number.isFinite(t) || t >= cutoff;
    })
    .slice(-FLOW_WINDOW_MESSAGES);
  if (recent.length < MIN_MESSAGES_FOR_SIGNAL) {
    return { repeats: 0, sameTopicRun: 0, sessionSpanMs, unknown: true };
  }

  const target = contentTerms(incoming);
  const repeats = recent.filter(
    (message) => overlap(target, contentTerms(message.content)) >= REPEAT_OVERLAP,
  ).length;

  // Consecutive turns on the same topic, counted from the end.
  let sameTopicRun = 0;
  const lastTerms = contentTerms(recent[recent.length - 1]?.content ?? "");
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const terms = contentTerms(recent[i].content);
    if (overlap(terms, lastTerms) >= REPEAT_OVERLAP) sameTopicRun += 1;
    else break;
  }

  return { repeats, sameTopicRun, sessionSpanMs, unknown: false };
}

/**
 * Turn the signals into something a tutor can act on, or "" when there is
 * nothing worth saying.
 *
 * The bar for acting is high. Telling a student they are repeating themselves
 * on their second similar question is nagging; by the third or fourth they have
 * probably been stuck for a while and a different approach is warranted.
 */
export function flowGuidance(signals: FlowSignals): string {
  if (signals.unknown) return "";

  if (signals.repeats >= 2) {
    return (
      "They have now asked something very close to this several times without " +
      "getting where they want to go. Repeating the same explanation is not " +
      "working, and saying the same thing again will not help either. Change " +
      "approach: go back one step further, use a different worked example, or " +
      "reframe the question as something they can answer a piece at a time. " +
      "Do not point out that they have repeated themselves."
    );
  }

  if (signals.sameTopicRun >= 4) {
    return (
      "They have been circling one topic for several turns. Stop advancing and " +
      "check what they actually think they understand before continuing."
    );
  }

  return "";
}

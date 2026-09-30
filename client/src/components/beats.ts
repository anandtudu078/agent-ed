// Lesson beats — splitting a tutor reply into the short pieces the owl
// actually performs.
//
// The problem this solves: a tutor reply to "teach me AI" is a few hundred
// words (see TEACH_SYSTEM_PROMPT in src/services/aiService.ts, which asks for a
// definition, an analogy, a worked example, a caveat and a closing question).
// Handed to the owl as one string, that becomes one unbroken utterance and one
// overflowing speech bubble — ninety seconds of a character talking AT a
// student rather than to them.
//
// So the reply is cut into beats of one or two sentences, and the client plays
// them in sequence: speak a beat, pause, move the diagram, speak the next. This
// module is the "cut" half and is deliberately pure, so the rules that decide
// what a beat is can be tested without a browser, a speech engine, or a model.

/**
 * Why a beat exists. Drives what the owl *does*, not what it says.
 *
 * `opening` and `point` are explanations; `example` is a worked case; `check` is
 * a question the student is meant to answer. The distinction that matters is
 * `check`: a mascot that keeps bouncing while it waits for an answer teaches the
 * student to talk past it.
 */
export type BeatKind = "opening" | "point" | "example" | "check";

export interface LessonBeat {
  /** The text for this beat: shown in the bubble and spoken aloud. */
  text: string;
  /** How the owl should hold this beat. */
  kind: BeatKind;
}

/**
 * Longest a single beat may run, in words.
 *
 * Tuned against speech rate rather than reading rate: this is the longest span
 * the owl holds one pose and one diagram highlight before something changes, so
 * it wants to be closer to one breath than to one paragraph. ~32 words lands at
 * roughly eight to ten seconds of speech.
 */
export const MAX_BEAT_WORDS = 32;

/**
 * Tokens that end in a period without ending a sentence.
 *
 * Naive splitting on "." turns "e.g. a model" into two fragments and drops a
 * clause mid-thought, which is exactly the kind of seam a student notices while
 * the owl is talking.
 */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof|Fig|No|approx)\.$/i;

/**
 * Cue words that mark a beat as a worked example.
 *
 * Deliberately a cue and not a parser. The tutor's own structure is prose, and
 * this only has to be good enough to pick the pose out — a wrong guess costs a
 * slightly wrong animation, whereas the wall of text costs the whole lesson.
 */
const EXAMPLE_CUE = /\b(for example|for instance|imagine|let's say|let us say|suppose|think of)\b/i;

/** Markdown emphasis, inline code and list bullets — noise when spoken aloud. */
function stripMarkup(text: string): string {
  return text
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,!?])/g, "$1$2")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "");
}

/**
 * Split prose into sentences.
 *
 * Handles Latin `.!?` and the Devanagari danda, because Hindi teaching replies
 * use `।` as their full stop and treating it as a mid-sentence character would
 * fuse two whole sentences into one beat.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  const boundary = /([.!?।]+)(?=\s|$)/g;
  let buffer = "";
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[1].length;
    const candidate = text.slice(last, end);
    // An abbreviation is not a boundary: hold it in the buffer and let the real
    // full stop end the sentence.
    if (ABBREVIATION.test(candidate.trimEnd())) continue;
    buffer += candidate;
    const trimmed = buffer.trim();
    if (trimmed) sentences.push(trimmed);
    buffer = "";
    last = end;
  }

  buffer += text.slice(last);
  const tail = buffer.trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Break a sentence that is too long to be a beat on its own.
 *
 * Prefers clause boundaries so each piece is still a complete thought. Only runs
 * on genuinely oversized sentences; the normal path never sees it.
 */
function splitClauses(sentence: string): string[] {
  const clauses = sentence
    .split(/(?<=[,;:])\s+|\s+[—–-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (clauses.length < 2) return [sentence];

  const packed: string[] = [];
  let current = "";
  let words = 0;
  for (const clause of clauses) {
    const count = countWords(clause);
    if (current && words + count > MAX_BEAT_WORDS) {
      packed.push(current);
      current = "";
      words = 0;
    }
    current += (current ? " " : "") + clause;
    words += count;
  }
  if (current) packed.push(current);
  return packed;
}

/** Pack sentences into beats of at most MAX_BEAT_WORDS. */
function pack(sentences: string[]): string[] {
  const beats: string[] = [];
  let current = "";
  let words = 0;

  for (const sentence of sentences) {
    const count = countWords(sentence);
    if (current && words + count > MAX_BEAT_WORDS) {
      beats.push(current);
      current = "";
      words = 0;
    }
    current += (current ? " " : "") + sentence;
    words += count;
  }
  if (current) beats.push(current);
  return beats;
}

/** A beat that ends in a question mark is one the student should answer. */
function isQuestion(text: string): boolean {
  return /[?؟]\s*$/.test(text);
}

/**
 * Decide a beat's kind from where it sits and what it says.
 *
 * Order matters: a closing question outranks an example cue, because "for
 * example, what would you predict?" is a check-for-understanding question, not
 * a worked example.
 */
function classify(text: string, index: number, total: number): BeatKind {
  if (isQuestion(text)) return "check";
  if (index === 0) return "opening";
  if (EXAMPLE_CUE.test(text)) return "example";
  if (index === total - 1) return "check";
  return "point";
}

/**
 * Cut a tutor reply into ordered beats.
 *
 * Returns a single beat for a short reply, so the one-question Socratic path is
 * unchanged by this — it only starts doing something visible once the tutor
 * actually has an essay to deliver.
 */
export function splitIntoBeats(text: string): LessonBeat[] {
  const clean = stripMarkup(text).replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];

  // Every newline is a break, not just blank lines. A bulleted list arrives as
  // one block, and joining its items into a single sentence would make the owl
  // read a run-on with no pause where the structure was.
  const paragraphs = clean
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const beats: string[] = [];
  for (const paragraph of paragraphs) {
    const sentences = splitSentences(paragraph).flatMap((sentence) =>
      countWords(sentence) > MAX_BEAT_WORDS ? splitClauses(sentence) : [sentence],
    );
    beats.push(...pack(sentences));
  }

  return beats.map((beat, index) => ({
    text: beat,
    kind: classify(beat, index, beats.length),
  }));
}

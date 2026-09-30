// Permanent unit tests for lesson-beat segmentation.
//
// Run: npm run test:beats
//
// These rules decide what the owl says one piece at a time, so the bar is that
// nothing is ever lost, nothing is ever too long to hold a pose for, and a
// single-question Socratic reply comes out the other side untouched. A splitter
// that drops a clause mid-thought is worse than no splitter at all.

import { splitIntoBeats, MAX_BEAT_WORDS } from "../src/components/beats.ts";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// --- 1. A short reply is one beat, untouched --------------------------------
// The Socratic path sends one focused question. It must survive intact.
const short = splitIntoBeats("What happens to the gradient when the learning rate is too high?");
check("a one-question reply stays one beat", short.length === 1, `n=${short.length}`);
check("its text is unchanged", short[0]?.text === "What happens to the gradient when the learning rate is too high?");
check("a question is a check beat", short[0]?.kind === "check");

// --- 2. A long reply is cut, and nothing goes missing ----------------------
const essay = [
  "Machine learning is a way for computers to learn patterns from examples rather than being told every rule.",
  "Think of it like teaching a child to recognise a cat: you show them many cats, and they work out what matters.",
  "For example, to spot spam you might show a model ten thousand emails, most of them spam, labelled as such.",
  "The model adjusts its internal numbers a little each time it guesses wrong, so it gets steadily better.",
  "The caveat people miss is that the model only knows what it was shown, so new situations can fool it.",
  "What kind of email would you guess the model might wrongly call spam?",
].join(" ");

const beats = splitIntoBeats(essay);
check("an essay is cut into several beats", beats.length >= 4, `n=${beats.length}`);
check(
  "no beat is longer than the cap",
  beats.every((b) => words(b.text) <= MAX_BEAT_WORDS),
  `max=${Math.max(...beats.map((b) => words(b.text)))}`,
);
// The contract that matters most: cutting is only safe if it is lossless.
const rejoined = beats.map((b) => b.text).join(" ").toLowerCase();
const keywords = ["machine learning", "cat", "spam", "internal numbers", "caveat", "wrongly"];
check(
  "every idea survives the cut",
  keywords.every((k) => rejoined.includes(k)),
  keywords.filter((k) => !rejoined.includes(k)).join(",") || "all present",
);

// --- 3. Structure is recognised --------------------------------------------
check("the first beat opens", beats[0]?.kind === "opening");
check("the analogy beat is an example", beats.some((b) => b.kind === "example"));
check("the last beat is a check", beats[beats.length - 1]?.kind === "check");
check("the closing question keeps its text", /what kind of email/i.test(beats[beats.length - 1]?.text ?? ""));

// A question is a question even when it also contains an example cue.
const tricky = splitIntoBeats("Here is the idea.\nFor example, what would you predict?");
check("a question outranks the example cue", tricky[tricky.length - 1]?.kind === "check");

// --- 4. Sentences are not cut mid-thought ----------------------------------
const abbrev = splitIntoBeats(
  "Models learn weights, e.g. by gradient descent. The descent direction is set by the gradient itself.",
);
check("an abbreviation is not a sentence end", abbrev.length === 1, `n=${abbrev.length}`);
check("its text is intact", /gradient itself\.$/.test(abbrev[0]?.text ?? ""));

// --- 5. Markdown is stripped before it is spoken --------------------------
const md = splitIntoBeats("**Overfitting** means the model memorises noise.\n- First symptom\n- Second symptom");
check("emphasis markers are removed", !/\*/.test(md[0]?.text ?? ""), md[0]?.text ?? "");
check("the word itself is kept", /overfitting/i.test(md[0]?.text ?? ""));
check("list bullets are removed", !/^\s*[-*]\s/m.test(md.map((b) => b.text).join("\n")));
check("each list item becomes its own beat", md.length >= 3, `n=${md.length}`);

// --- 6. Hindi (Devanagari danda) is a real sentence end ---------------------
// Long enough to exceed the beat cap, so packing cannot hide a boundary that
// failed to be recognised: if the danda were treated as a mid-sentence
// character, this would arrive as one run-on and fuse two ideas into a breath
// the owl cannot hold.
const hi = splitIntoBeats(
  "Recursion एक function है जो अपne आप को call करता है। " +
    "जब function खुद को call करता है तो उसे recursion कहते हैं। " +
    "हर recursive function को एक base case चाहिए जो रुकने की स्थिति बनाए। " +
    "इसके बिना program infinite loop में चला जाएगा।",
);
check("a Hindi explanation is cut into beats", hi.length > 1, `n=${hi.length}`);
check(
  "no Hindi beat runs over the cap",
  hi.every((b) => words(b.text) <= MAX_BEAT_WORDS),
  `max=${Math.max(...hi.map((b) => words(b.text)))}`,
);
// Cutting is only safe if it is lossless, so check the words came out the far
// side rather than trusting the count.
const hiJoined = hi.map((b) => b.text).join(" ");
check("the Hindi text survives intact", /base case/.test(hiJoined) && /infinite loop/.test(hiJoined));

// --- 7. An oversized single sentence is broken at a clause ------------------
// Must genuinely exceed MAX_BEAT_WORDS — under the cap a single beat is the
// correct answer, and this test would be asserting a bug.
const long = splitIntoBeats(
  "A transformer takes a sequence of tokens, embeds each one into a vector, " +
    "adds positional information so that order is recoverable, then passes that " +
    "whole matrix through many self-attention layers, and finally uses a decoder " +
    "to generate the output one token at a time.",
);
check("an oversized sentence is still split", long.length > 1, `n=${long.length}`);
check(
  "and no piece stays over the cap",
  long.every((b) => words(b.text) <= MAX_BEAT_WORDS),
  `max=${Math.max(...long.map((b) => words(b.text)))}`,
);

// --- 8. Degenerate input ----------------------------------------------------
check("empty text yields no beats", splitIntoBeats("").length === 0);
check("whitespace yields no beats", splitIntoBeats("   \n\n  ").length === 0);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);

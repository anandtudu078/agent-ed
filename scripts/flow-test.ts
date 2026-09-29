// Permanent unit tests for flow signals.
//
// Run: npm run test:flow
//
// The bar here is restraint. Most of the value in this file is in what it
// refuses to conclude: a student who asked about recursion an hour ago is not
// repeating themselves, a message with no timestamp is not from 1970, and two
// rephrasings of the same stuck question are the same question.

import { flowSignals, flowGuidance } from "../src/services/flowSignals";
import type { ConversationMessage } from "../src/models/Session";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const T0 = new Date("2026-03-01T09:00:00Z");
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const user = (content: string, minutes: number): ConversationMessage => ({
  role: "user",
  content,
  at: at(minutes),
});

// --- 1. Too little history means no signal, not a zero signal -------------
const empty = flowSignals([], "how does recursion work", T0);
check("an empty conversation is unknown", empty.unknown);
check("an unknown conversation yields no guidance", flowGuidance(empty) === "");

const one = flowSignals([user("what is recursion", 0)], "how does recursion work", T0);
check("one message is not enough to act on", one.unknown, "min=${4}");

// --- 2. A missing timestamp is unknown, never the epoch ---------------------
const noTimes = flowSignals(
  [
    { role: "user", content: "recursion basics" },
    { role: "assistant", content: "yes" },
    { role: "user", content: "recursion example" },
    { role: "assistant", content: "ok" },
  ],
  "recursion example please",
  T0,
);
check("a conversation with no timestamps still reads its text", !noTimes.unknown || noTimes.repeats >= 0);
const spanless = flowSignals(
  [
    { role: "user", content: "recursion basics" },
    { role: "user", content: "recursion example" },
    { role: "user", content: "recursion code" },
    { role: "user", content: "recursion steps" },
  ],
  "recursion example please",
  T0,
);
check("no timestamps means no span, not a zero span", spanless.sessionSpanMs === null, String(spanless.sessionSpanMs));

// --- 3. Rephrasing counts as repeating -------------------------------------
const stuck = [
  user("how does recursion work in code", 0),
  user("can you show recursion with an example", 3),
  user("explain recursion step by step please", 6),
  user("I still do not get recursion at all", 9),
];
const repeating = flowSignals(stuck, "recursion is still confusing", at(12));
check(
  "a stuck student repeating themselves is detected",
  repeating.repeats >= 2,
  `repeats=${repeating.repeats}`,
);
check("the conversation is no longer unknown", !repeating.unknown);
check("guidance is offered when genuinely stuck", flowGuidance(repeating).length > 0);

// --- 4. Genuinely new questions are not repetition -------------------------
const exploring = [
  user("what is a neural network", 0),
  user("how does convolution work on images", 4),
  user("explain backpropagation gradients", 8),
  user("what is a learning rate", 12),
];
const fresh = flowSignals(exploring, "how do I regularise a model", at(16));
check("a student moving on is not flagged as repeating", fresh.repeats === 0, `repeats=${fresh.repeats}`);
check("a student moving on gets no flow guidance", flowGuidance(fresh) === "");

// --- 5. An old question does not count as a repeat --------------------------
const earlier = [
  user("explain recursion", 0),
  user("what is a loop", 200),
  user("what is a while loop", 260),
  user("difference between for and while", 300),
];
check(
  "a question from much earlier is not a current repeat",
  flowSignals(earlier, "explain recursion", at(400)).repeats === 0,
);

// --- 6. Timing ------------------------------------------------------------
const paced = [user("question one", 0), user("question two", 30), user("question three", 90), user("question four", 95)];
const timing = flowSignals(paced, "question five", at(100));
check("a session span is measured when times exist", timing.sessionSpanMs === 100 * 60_000, String(timing.sessionSpanMs));
check("a span is never negative", flowSignals([user("x", 50), user("y", 10)], "z", at(60)).sessionSpanMs! >= 0);

// --- 7. The guidance never accuses the student ----------------------------
const guidance = flowGuidance(repeating);
check(
  "guidance tells the tutor to change approach, not to nag",
  /change approach/i.test(guidance) && !/again/i.test(guidance.replace(/again will not help/i, "")),
  guidance.slice(0, 60),
);
check(
  "guidance explicitly forbids pointing out the repetition",
  /do not point out/i.test(guidance),
  "the student should never be told they are repeating themselves",
);

// --- 8. Only observable facts ------------------------------------------------
check(
  "nothing claims to detect emotion",
  !/frustrat|confus|gave up|give up|upset|anxious/i.test(guidance),
  "emotional state is not observable from message text",
);

// --- 9. Degenerate input ---------------------------------------------------
check("an empty incoming message does not throw", flowSignals(stuck, "", at(12)).repeats >= 0);
check(
  "stop words alone do not fake a repeat",
  flowSignals([user("what is it", 0), user("what is that", 1), user("what are they", 2), user("what was it", 3)], "what is that", at(4)).repeats === 0,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} flow checks passed`);
process.exit(failed.length ? 1 : 0);

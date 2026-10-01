// Permanent unit tests for the owl's reaction to a student turn.
//
// Run: npm run test:reaction
//
// This is the rule that makes the owl a companion rather than a widget: it must
// respond to how the student is actually doing. The failure mode worth defending
// against is not "reacts too little" — it is reacting wrongly, because an owl
// that beams at a struggling student or sulks at a correct one teaches the
// student to distrust its face entirely, which costs more than a neutral owl.

import {
  looksLikeQuestion,
  tutorReaction,
  isTutorReaction,
} from "../src/services/tutorReaction";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

// --- 1. A struggling student gets warmth, not indifference -------------------
check("a lost student reads as supportive", tutorReaction({ masteryEstimate: 20 }) === "supportive");
check("just below the threshold is still supportive", tutorReaction({ masteryEstimate: 39 }) === "supportive");
// The boundary itself: at exactly the threshold the student is no longer lost.
check("the struggling boundary is 40", tutorReaction({ masteryEstimate: 40 }) === "happy", tutorReaction({ masteryEstimate: 40 }));

// --- 2. A strong turn earns celebration --------------------------------------
check("a strong turn is excited", tutorReaction({ masteryEstimate: 85 }) === "excited");
check("the strong boundary is 75", tutorReaction({ masteryEstimate: 74 }) === "happy", tutorReaction({ masteryEstimate: 74 }));
check("a perfect score is excited", tutorReaction({ masteryEstimate: 100 }) === "excited");

// --- 3. Misconceptions stop it celebrating -----------------------------------
// The important one: a high score with an unaddressed wrong idea is not a success.
check(
  "a strong turn with open gaps is happy, not excited",
  tutorReaction({ masteryEstimate: 90, coreMisunderstandings: ["thinks backprop is gradient descent"] }) === "happy",
);
check(
  "blank misconceptions are not gaps",
  tutorReaction({ masteryEstimate: 90, coreMisunderstandings: ["", "   "] }) === "excited",
);
check(
  "non-string entries are ignored",
  // Cast, because the interface types this as string[] and the whole point of the
  // check is that untrusted input can violate that — the filter must survive it.
  tutorReaction({
    masteryEstimate: 90,
    coreMisunderstandings: [1, null, "real gap"] as unknown as string[],
  }) === "happy",
);

// --- 4. A question is warm even when mastery is low -------------------------
// The tutor asking a question is engagement, not evidence of understanding — so
// this must never read as excitement, and must never read as cold.
check("a question to a struggling student is supportive", tutorReaction({ masteryEstimate: 25, isQuestion: true }) === "supportive");
check("a question to a solid student is happy", tutorReaction({ masteryEstimate: 65, isQuestion: true }) === "happy");
check("a question to a strong student is still only happy", tutorReaction({ masteryEstimate: 95, isQuestion: true }) === "happy");

// --- 5. Missing or malformed input is quiet, never enthusiastic -------------
check("a missing turn is neutral", tutorReaction(null) === "neutral");
check("undefined is neutral", tutorReaction(undefined) === "neutral");
check("an empty object is neutral", tutorReaction({} as never) === "neutral");
check("a non-numeric estimate is neutral", tutorReaction({ masteryEstimate: "high" as never }) === "neutral");
check("NaN is neutral", tutorReaction({ masteryEstimate: Number.NaN }) === "neutral");
// Infinity is rejected rather than clamped. A finite out-of-range number like 500
// is a model that scored on the wrong scale and clamping it is reasonable; a
// non-finite one is not a number at all, and treating it as a top score would let
// malformed output produce the owl's strongest reaction — the exact failure the
// whole "never invent a mood" rule exists to prevent.
check("Infinity is rejected, not celebrated", tutorReaction({ masteryEstimate: Number.POSITIVE_INFINITY }) === "neutral", tutorReaction({ masteryEstimate: Number.POSITIVE_INFINITY }));
check("a negative infinity is rejected too", tutorReaction({ masteryEstimate: Number.NEGATIVE_INFINITY }) === "neutral");
check("a negative estimate clamps to the floor", tutorReaction({ masteryEstimate: -50 }) === "supportive");
check("an out-of-range high estimate clamps to the cap", tutorReaction({ masteryEstimate: 500 }) === "excited");

// --- 6. Question detection ---------------------------------------------------
check("a trailing question mark is a question", looksLikeQuestion("What happens when the gradient vanishes?"));
check("a Hindi question is a question", looksLikeQuestion("recursion samajh aaya?"));
check("an Arabic question mark is a question", looksLikeQuestion("لماذا يعمل هذا؟"));
check("an unpunctuated prompt is still a question", looksLikeQuestion("What do you think would happen here"));
check("a second-person prompt is a question", looksLikeQuestion("Try it and tell me what you notice"));
check("a statement is not a question", !looksLikeQuestion("A gradient is the derivative of the loss function."));
check("empty text is not a question", !looksLikeQuestion("   "));
// A question mark in the *middle* is not the tutor asking something.
check("a mid-sentence question mark is not a question", !looksLikeQuestion("It works, right? The gradient updates the weights."));

// --- 7. The socket guard -----------------------------------------------------
for (const value of ["neutral", "happy", "excited", "supportive"]) {
  check(`"${value}" is a valid reaction`, isTutorReaction(value));
}
check("an unknown mood is rejected", !isTutorReaction("elated"));
check("a mascot-only mood is rejected", !isTutorReaction("proud"));
check("null is rejected", !isTutorReaction(null));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
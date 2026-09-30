// Output-quality suite: does the tutor actually teach well?
//
// Run: npm run test:quality            (needs GROQ_API_KEY or GEMINI_API_KEY)
//
// The gap this fills. There are 554 checks in this repo and every one tests the
// app AROUND the model - parsing, scheduling, segmentation, rendering, authz.
// Not one asks whether the tutor is any good. The README says so itself:
// "Verified the reply changes, not that it always says the right thing."
//
// For a project whose whole claim is "it teaches", that is the claim most in
// need of a test. So this calls the real generateTutorResponse, with the real
// system prompts, and grades what comes back.
//
// TWO KINDS OF CHECK, DELIBERATELY SEPARATED:
//
//   1. Contract checks - deterministic, no model, these GATE. These are the
//      promises the prompts make and the code depends on: Socratic mode must not
//      hand over the answer, it must ask something, Hindi must come back in
//      Devanagari. A prompt is a request; these make some of them obligations.
//
//   2. Judged checks - one model call per case, these REPORT and never fail the
//      run. They cover what only a model can assess: factual soundness, whether
//      the Socratic withholding actually worked, whether it built on the thread.
//
// The split matters. A grader that is itself a language model can be wrong, and
// a suite that fails on a model's opinion is a flaky suite that teaches nobody
// to trust it. The subjective scores are a baseline to watch for drift, not a
// gate.
//
// NOT IN CI. It spends real provider quota and takes a few minutes. It is a
// manual gate you run before a release, not on every push.

import { generateTutorResponse, type TutorMode, type TeachLanguage } from "../src/services/aiService";
import { completeJson } from "../src/services/groqClient";
import type { ConversationMessage } from "../src/models/Session";
import type { StudentAnalysis } from "../src/services/aiService";

interface Case {
  name: string;
  mode: TutorMode;
  language: TeachLanguage;
  /** The student's message. */
  ask: string;
  /** Prior turns, so "does it build on the thread" is testable. */
  history?: ConversationMessage[];
  /** Case-specific answer leakage that would be a contract failure. */
  forbidden?: RegExp[];
  /** Socratic: an upper bound on length. Teach: a lower bound. */
  maxWords?: number;
  minWords?: number;
}

const DEVA = /[\u0900-\u097F]/;

const CASES: Case[] = [
  {
    name: "socratic: opens a topic without defining it",
    mode: "socratic",
    language: "en",
    ask: "What is machine learning?",
    // A bare definition up front is the single failure this product exists to
    // avoid, so it is checked by pattern as well as by the judge.
    forbidden: [/^\s*machine learning is (a|an|the)\b/i],
    maxWords: 260,
  },
  {
    name: "socratic: builds on the thread",
    mode: "socratic",
    language: "en",
    ask: "But how is that different from just writing the rules by hand?",
    history: [
      { role: "user", content: "What is machine learning?", at: new Date() },
      {
        role: "assistant",
        content:
          "When you hear the term machine learning, what kinds of activities or problems do you imagine it might be used for?",
        at: new Date(),
      },
    ],
    maxWords: 280,
  },
  {
    name: "socratic: holds firm under pressure",
    mode: "socratic",
    language: "en",
    ask: "Stop asking me things and just tell me what gradient descent is.",
    forbidden: [/gradient descent is (a|an|the)\b/i],
    maxWords: 280,
  },
  {
    name: "socratic: addresses a misconception",
    mode: "socratic",
    language: "en",
    ask: "Isn't backpropagation basically the same thing as gradient descent?",
    maxWords: 300,
  },
  {
    name: "teach: explains a concept properly",
    mode: "teach",
    language: "en",
    ask: "teach me how a neural network learns",
    minWords: 90,
    maxWords: 700,
  },
  {
    name: "teach: explains a computer science topic",
    mode: "teach",
    language: "en",
    ask: "Explain recursion to me",
    minWords: 90,
    maxWords: 700,
  },
  {
    name: "socratic: answers in Hindi",
    mode: "socratic",
    language: "hi",
    ask: "recursion kya hai?",
    maxWords: 300,
  },
  {
    name: "teach: explains in Hindi",
    mode: "teach",
    language: "hi",
    ask: "machine learning kya hai aur kaise kaam karta hai?",
    minWords: 70,
    maxWords: 700,
  },
];

// ---------------------------------------------------------------------------
// Contract checks - deterministic. These gate.
// ---------------------------------------------------------------------------

const contractResults: Array<{ caseName: string; rule: string; ok: boolean; detail: string }> = [];

function contract(c: Case, rule: string, ok: boolean, detail = ""): void {
  contractResults.push({ caseName: c.name, rule, ok, detail });
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function checkContract(c: Case, reply: string): void {
  const lower = reply.toLowerCase();

  contract(c, "produces a reply", reply.trim().length > 20, `${reply.trim().length} chars`);
  contract(c, "is not an error", !/something went wrong|could not|unavailable/i.test(lower), "");

  // Language. Hindi teaching must come back in Devanagari; an English reply
  // with one Hindi word mixed in is the failure mode, not the other way round.
  if (c.language === "hi") {
    const deva = (reply.match(/[\u0900-\u097F]/g) ?? []).length;
    contract(c, "replies in Devanagari", deva > 40, `${deva} Devanagari characters`);
  } else {
    contract(c, "replies in English", (reply.match(DEVA) ?? []).length < 10, "no stray Devanagari");
  }

  // Case-specific leakage.
  for (const pattern of c.forbidden ?? []) {
    contract(c, `does not hand over the answer (${pattern.source})`, !pattern.test(reply), "");
  }

  if (c.mode === "socratic") {
    // The Socratic contract: withhold, and hand the floor back.
    const questions = (reply.match(/\?/g) ?? []).length;
    contract(c, "asks the student something", questions >= 1, `${questions} question mark(s)`);
    contract(c, "asks one thing at a time", questions <= 3, `${questions} question mark(s)`);
    contract(c, "stays short enough to think about", words(reply) <= (c.maxWords ?? 300), `${words(reply)} words`);
  } else {
    // Teach mode: actually explain, and close by checking understanding.
    contract(c, "explains substantively", words(reply) >= (c.minWords ?? 80), `${words(reply)} words`);
    contract(c, "stays within a readable length", words(reply) <= (c.maxWords ?? 700), `${words(reply)} words`);
    contract(c, "ends by checking understanding", /\?/.test(reply.trim().slice(-260)), "");
  }
}

// ---------------------------------------------------------------------------
// Judged checks - one model call per case. These report, never gate.
// ---------------------------------------------------------------------------

interface Verdict {
  withholds: boolean;
  onTopic: boolean;
  buildsOnThread: boolean;
  factuallySound: boolean;
  helpsABeginner: boolean;
  reason: string;
}

const JUDGE_SYSTEM =
  "You grade a tutoring AI. You are strict and concrete. Reply with JSON only: " +
  "{\"withholds\": boolean, \"onTopic\": boolean, \"buildsOnThread\": boolean, " +
  "\"factuallySound\": boolean, \"helpsABeginner\": boolean, \"reason\": string}. " +
  "Definitions: withholds = in Socratic mode it asks rather than stating the answer outright " +
  "(ignore this if the mode is teach); onTopic = addresses what the student actually asked; " +
  "buildsOnThread = responds to the conversation so far when there is any; " +
  "factuallySound = contains no clear factual errors about the topic; " +
  "helpsABeginner = a beginner would understand it. reason = one sentence, max 25 words.";

async function judge(c: Case, reply: string): Promise<Verdict | null> {
  const prompt =
    `Mode: ${c.mode}\nLanguage: ${c.language}\n` +
    `Student asked: ${c.ask}\n` +
    (c.history?.length
      ? `Earlier conversation:\n${c.history.map((h) => `${h.role}: ${h.content}`).join("\n")}\n`
      : "") +
    `\nTutor replied:\n${reply}\n\nGrade it.`;
  try {
    return await completeJson<Verdict>(JUDGE_SYSTEM, prompt, { temperature: 0 });
  } catch (error) {
    console.log(`      (judge unavailable: ${String(error).slice(0, 80)})`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const analysisStub: StudentAnalysis = {
  intent: "learn",
  topic: "the concept under discussion",
  masteryEstimate: 50,
  coreMisunderstandings: [],
};

async function main(): Promise<void> {
  const judged: Array<{ caseName: string; verdict: Verdict | null }> = [];
  const transcripts: Array<{ name: string; reply: string }> = [];
  let providerFailed = 0;
  
  for (const c of CASES) {
    console.log(`\n--- ${c.name}`);
    let reply = "";
    try {
      reply = await generateTutorResponse(
        analysisStub,
        c.ask,
        c.history ?? [],
        c.mode,
        c.language,
      );
    } catch (error) {
      providerFailed += 1;
      contract(c, "provider returned a reply", false, String(error).slice(0, 90));
      console.log(`FAIL  provider call failed — ${String(error).slice(0, 90)}`);
      continue;
    }
  
    const before = contractResults.length;
    checkContract(c, reply);
    for (const r of contractResults.slice(before)) {
      console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.rule}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    transcripts.push({ name: c.name, reply });
  
    const verdict = await judge(c, reply);
    judged.push({ caseName: c.name, verdict });
    if (verdict) {
      const marks = [
        ["withholds", verdict.withholds],
        ["onTopic", verdict.onTopic],
        ["buildsOnThread", verdict.buildsOnThread],
        ["factuallySound", verdict.factuallySound],
        ["helpsABeginner", verdict.helpsABeginner],
      ] as const;
      console.log(
        `  JUDGE  ${marks.map(([k, v]) => `${k}=${v ? "y" : "n"}`).join("  ")}  — ${verdict.reason}`,
      );
    }
  }
  
  // --- Scorecard -------------------------------------------------------------
  
  const failedContracts = contractResults.filter((r) => !r.ok);
// Score only the dimensions that APPLY to the case. Counting "withholds=n" as
  // a failure on a teach-mode case would be wrong - explaining IS the job there -
  // and "buildsOnThread" is meaningless when the case has no prior turn. A
  // baseline that punishes correct behaviour is worse than no baseline.
  const scored = judged.filter((j) => j.verdict);
  const applies: Record<string, (c: Case) => boolean> = {
    withholds: (c) => c.mode === "socratic",
    onTopic: () => true,
    buildsOnThread: (c) => Boolean(c.history?.length),
    factuallySound: () => true,
    helpsABeginner: () => true,
  };
  const dimensions = ["withholds", "onTopic", "buildsOnThread", "factuallySound", "helpsABeginner"] as const;
  
  console.log("\n=========================================================");
  console.log("CONTRACT (deterministic - this is the gate)");
  console.log("=========================================================");
  console.log(`${contractResults.length - failedContracts.length}/${contractResults.length} passed`);
  for (const f of failedContracts) console.log(`  FAIL  ${f.caseName} :: ${f.rule}${f.detail ? ` (${f.detail})` : ""}`);
  
  console.log("\n=========================================================");
  console.log("JUDGED (a model's opinion - a baseline, not a gate)");
  console.log("=========================================================");
  if (!scored.length) {
    console.log("no verdicts - the judge was unavailable");
  } else {
    for (const dim of dimensions) {
      const relevant = scored.filter((j) => applies[dim]!(CASES.find((c) => c.name === j.caseName)!));
      if (!relevant.length) {
        console.log(`  ${dim.padEnd(16)} n/a`);
        continue;
      }
      const good = relevant.filter((j) => j.verdict?.[dim]).length;
      const pct = Math.round((good / relevant.length) * 100);
      console.log(`  ${dim.padEnd(16)} ${good}/${relevant.length}  (${pct}%)`);
    }
  }
  
  if (process.env.QUALITY_SHOW_REPLIES === "1") {
    console.log("\n--- replies ---");
    for (const t of transcripts) console.log(`\n[${t.name}]\n${t.reply}`);
  }
  
  console.log("");
  if (providerFailed > 0 && providerFailed === CASES.length) {
    console.log("RESULT: no provider calls succeeded. Check GROQ_API_KEY / GEMINI_API_KEY.");
    process.exit(2);
  }
  console.log(
    failedContracts.length === 0
      ? `RESULT: all ${contractResults.length} contract checks passed.`
      : `RESULT: ${failedContracts.length} contract check(s) failed.`,
  );
  process.exit(failedContracts.length === 0 ? 0 : 1);
  
}

main().catch((error) => {
  console.error("quality suite crashed:", error);
  process.exit(2);
});

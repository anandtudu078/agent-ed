import Groq from "groq-sdk";

import { ConversationMessage } from "../models/Session";
import { completeText, GROQ_TEXT_MODELS } from "./groqClient";

/** Structured read of the student's turn, returned by the analysis call. */
export interface StudentAnalysis {
  intent: string;
  /** Short 2–5 word concept the turn is about, inferred by the model. */
  topic: string;
  /** 0–100 estimate of how well the student understands `topic` right now. */
  masteryEstimate: number;
  coreMisunderstandings: string[];
}

/**
 * How many earlier messages are replayed into each prompt. The tutor needs a
 * thread to be a tutor, but replaying an entire session would blow the token
 * budget and the latency budget with it. Tune here, not at the call sites.
 */
export const MAX_PROMPT_HISTORY_MESSAGES = 12;

/** The most recent slice of the conversation to show the model. */
export function selectHistoryWindow(
  priorMessages: ConversationMessage[],
): ConversationMessage[] {
  return priorMessages.slice(-MAX_PROMPT_HISTORY_MESSAGES);
}

function renderTranscript(turns: ConversationMessage[]): string {
  if (!turns.length) {
    return "(none — this is the student's first message in this session)";
  }
  return turns
    .map((turn) => {
      const who = turn.role === "user" ? "Student" : "Tutor";
      return `${who}: ${turn.content}`;
    })
    .join("\n");
}

export async function analyzeStudentInput(
  studentMessage: string,
  priorMessages: ConversationMessage[] = [],
): Promise<StudentAnalysis> {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    // Use Node's native fetch: the SDK's bundled node-fetch@2 fails with
    // "Premature close" on modern Node when reading response bodies.
    fetch: globalThis.fetch as unknown as NonNullable<
      ConstructorParameters<typeof Groq>[0]
    >["fetch"],
  });

  const history = selectHistoryWindow(priorMessages);
  const userContent = history.length
    ? `Earlier conversation:\n${renderTranscript(history)}\n\nNew message:\n${studentMessage}`
    : studentMessage;

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Analyze the student's message for a Socratic tutor. Use the earlier " +
          "conversation to resolve references and to judge whether the student is " +
          "repeating a misconception. Return only JSON with: " +
          '"intent" (string), ' +
          '"topic" (a short 2-5 word name for the concept being discussed), ' +
          '"masteryEstimate" (integer 0-100, how well the student understands ' +
          "that topic right now, judged across the whole conversation), and " +
          '"coreMisunderstandings" (array of concise strings). ' +
          "Do not solve the student's problem.",
      },
      { role: "user", content: userContent },
    ],
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("Groq returned an empty student analysis.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error("Groq returned invalid JSON for student analysis.", {
      cause: error,
    });
  }

  // Validate outside the parse try/catch: a *malformed* response is a different
  // failure from *invalid JSON*, and squashing the two hides which one happened.
  const candidate = parsed as Partial<StudentAnalysis>;
  if (
    !candidate ||
    typeof candidate.intent !== "string" ||
    typeof candidate.topic !== "string" ||
    typeof candidate.masteryEstimate !== "number" ||
    !Number.isFinite(candidate.masteryEstimate) ||
    !Array.isArray(candidate.coreMisunderstandings) ||
    !candidate.coreMisunderstandings.every(
      (item): item is string => typeof item === "string",
    )
  ) {
    throw new Error("Groq returned an invalid analysis shape.");
  }

  return {
    intent: candidate.intent,
    topic: candidate.topic.trim().slice(0, 60),
    // Clamp: the model occasionally returns 0-1 or 0-10 scales.
    masteryEstimate: Math.min(100, Math.max(0, Math.round(candidate.masteryEstimate))),
    coreMisunderstandings: candidate.coreMisunderstandings
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10),
  };
}

// Flash models tried in order — each has its own free-tier quota, and
// availability/503 throttling varies per model, so falling back keeps the
// tutor usable when one model is exhausted or overloaded.
// Extend with GEMINI_EXTRA_KEYS="key1,key2" to rotate through additional
// API keys (e.g. a second Google Cloud project) once per-model quotas die.
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
] as const;

interface GeminiCredential {
  label: string;
  apiKey: string;
}

/**
 * Circuit breaker for Gemini.
 *
 * Without this, every request pays the full retry ladder — three models times
 * each configured key, each honouring its own backoff — before reaching the
 * fallback. Measured at 8s and 40s on consecutive requests while the quota was
 * exhausted, which is long enough that the student has given up.
 *
 * So: count consecutive total failures, and once there have been enough, stop
 * trying for a cooldown window and go straight to the fallback. A success
 * closes the breaker immediately, so a restored quota is picked up again
 * without waiting out the cooldown.
 */
const GEMINI_FAILURE_THRESHOLD = 3;
const GEMINI_COOLDOWN_MS = 10 * 60 * 1000;

let geminiConsecutiveFailures = 0;
let geminiDisabledUntil = 0;

function isGeminiSuppressed(now = Date.now()): boolean {
  return now < geminiDisabledUntil;
}

function recordGeminiSuccess(): void {
  geminiConsecutiveFailures = 0;
  geminiDisabledUntil = 0;
}

function recordGeminiFailure(now = Date.now()): void {
  geminiConsecutiveFailures += 1;
  if (geminiConsecutiveFailures >= GEMINI_FAILURE_THRESHOLD) {
    geminiDisabledUntil = now + GEMINI_COOLDOWN_MS;
    console.warn(
      `Gemini failed ${geminiConsecutiveFailures} times in a row; skipping it for ` +
        `${GEMINI_COOLDOWN_MS / 1000}s and using the Groq fallback directly.`,
    );
  }
}

/** Test seam: force the breaker closed. */
export function __resetGeminiBreaker(): void {
  geminiConsecutiveFailures = 0;
  geminiDisabledUntil = 0;
}

function loadGeminiCredentials(): GeminiCredential[] {
  const credentials: GeminiCredential[] = [];
  const primary = process.env.GEMINI_API_KEY;
  if (primary) credentials.push({ label: "primary", apiKey: primary });

  const extra = (process.env.GEMINI_EXTRA_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  extra.forEach((apiKey, index) => {
    credentials.push({ label: `extra-${index + 1}`, apiKey });
  });

  return credentials;
}

/**
 * How the tutor should answer.
 *
 * `socratic` is the original mode and the product's default: ask, never tell.
 * `teach` is the explicit "just tell me" escape hatch — a student who asks to
 * be taught deserves a straight explanation, and withholding one forever is
 * frustrating rather than Socratic. It is opt-in, never inferred.
 */
export type TutorMode = "socratic" | "teach";

/** Language the tutor teaches in. Stored per user. */
export type TeachLanguage = "en" | "hi";

const SOCRATIC_SYSTEM_PROMPT =
  "You are AgentEd, a Socratic AI tutor. Guide the student toward understanding " +
  "with clear, encouraging questions. Never give a direct answer, complete a " +
  "solution, or reveal the final result. Ask one focused guiding question at a time. " +
  "Use the student analysis to target their misunderstanding. The earlier " +
  "conversation is your memory: build on it, never ask the same question twice, " +
  "and notice when the student is repeating a misconception.";

const TEACH_SYSTEM_PROMPT =
  "You are AgentEd, a patient expert teacher explaining a concept clearly. " +
  "The student has explicitly asked to be TOLD, so explain it directly and " +
  "concretely. Structure your reply like a good teacher speaking aloud: " +
  "open with a one-sentence plain-English definition in the student's terms; " +
  "then give a concrete everyday analogy; then walk through one small worked " +
  "example step by step; then name the one rule or caveat most people get wrong. " +
  "Keep it to a few short paragraphs and use plain words over jargon. " +
  "Write in SHORT sentences — one idea per sentence, under about twenty words — " +
  "because your reply is read aloud by an animated owl that presents it piece " +
  "by piece; long run-on sentences are much harder to follow when heard than " +
  "when read. Put each step of the explanation on its own line. " +
  "Use the student analysis to target their specific misunderstanding. " +
  "The earlier conversation is your memory: do not re-explain what they " +
  "already understand, and build on what you have already covered. " +
  "Finish with ONE quick check-for-understanding question so they can tell " +
  "whether it landed.";

/** Instructional framing for a mode. Exported so the client can label the UI. */
export const MODE_HINTS: Record<TutorMode, string> = {
  socratic: "I'll ask you questions and never give the answer.",
  teach: "Teaching mode — I'll explain it directly.",
};

/**
 * The prompt for a mode. Exported so the choice itself is unit-testable: the
 * entire behaviour of teach mode is this string, and it should be verifiable
 * without spending a Gemini call.
 */
export function systemPromptFor(mode: TutorMode): string {
  return mode === "teach" ? TEACH_SYSTEM_PROMPT : SOCRATIC_SYSTEM_PROMPT;
}

/**
 * The language clause appended to every prompt.
 *
 * The code-switching rule is the important part, and it is deliberate rather
 * than a compromise. Indian students learn a technical concept by hearing the
 * idea in Hindi while keeping the English term — "रिकर्शन एक function है जो
 * अपने आप को call करता है". Transliterating the technical vocabulary into
 * Devanagari would make it *less* recognisable, not more. It also has a
 * practical payoff: Latin script still renders, and still sounds right, on a
 * device with no Hindi support at all.
 */
export const LANGUAGE_CLAUSE: Record<TeachLanguage, string> = {
  en: "",
  hi:
    "Write your entire reply in natural Hindi (Devanagari script) mixed with " +
    "English, the way an Indian student actually learns. Keep technical " +
    "terms in English — for example write \"recursion\" or \"array\", never a " +
    "transliteration of them. Explain the idea in simple Hindi. Do NOT reply " +
    "in English throughout, and do NOT transliterate technical words.",
};

/** Full system instruction for a mode + language pair. */
export function systemInstructionFor(mode: TutorMode, language: TeachLanguage): string {
  const clause = LANGUAGE_CLAUSE[language];
  return clause ? `${systemPromptFor(mode)}\n\n${clause}` : systemPromptFor(mode);
}

export async function generateTutorResponse(
  analysis: StudentAnalysis,
  studentQuery: string,
  priorMessages: ConversationMessage[] = [],
  mode: TutorMode = "socratic",
  language: TeachLanguage = "en",
  /**
   * What we know about this student, rendered for the prompt.
   *
   * This is the parameter that makes the tutor adaptive. Without it the model
   * receives twelve messages and a topic and teaches a student who scored 20%
   * on backpropagation exactly as it teaches one who scored 95%. An empty
   * string means "we know nothing yet", which is genuinely different from
   * "they have no gaps".
   */
  learnerBriefing: string = "",
): Promise<string> {
  const history = selectHistoryWindow(priorMessages);
  const transcript = renderTranscript(history);

  const promptText =
    (learnerBriefing ? `${learnerBriefing}\n\n` : "") +
    `Student analysis:\n${JSON.stringify(analysis)}\n\n` +
    `Earlier conversation:\n${transcript}\n\n` +
    `New message:\n${studentQuery}`;

  const credentials = loadGeminiCredentials();
  if (credentials.length === 0) {
    // Not fatal: the Groq fallback below doesn't need a Gemini key at all.
    console.warn("GEMINI_API_KEY is not configured; using the Groq fallback.");
  }

  let lastError: unknown;
  // Outer loop: credentials (keys), inner loop: models. Every key gets a
  // fresh set of per-model free quotas, so rotation multiplies capacity.
  // Skipped entirely while the breaker is open — that ladder is the slow part.
  // Skipped entirely while the breaker is open — that ladder is the slow part.
  const geminiSkipped = isGeminiSuppressed() || credentials.length === 0;
  if (!geminiSkipped) {
    for (const credential of credentials) {
      const googleGenAI = new (await import("@google/genai")).GoogleGenAI({
        apiKey: credential.apiKey,
      });

      for (const model of GEMINI_MODELS) {
        try {
          const response = await googleGenAI.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [{ text: promptText }],
              },
            ],
            config: {
              systemInstruction: systemInstructionFor(mode, language),
            },
          });

          const text = response.text?.trim();
          if (text) {
            recordGeminiSuccess();
            return text;
          }
          lastError = new Error("Gemini returned an empty tutor response.");
        } catch (error) {
          lastError = error;
        }
      }
    }
    // Every key and model is exhausted — the whole ladder failed.
    recordGeminiFailure();
  } else {
    lastError = new Error(
      isGeminiSuppressed()
        ? "Gemini skipped by the circuit breaker."
        : "Gemini is not configured.",
    );
  }

  // Gemini is unusable (out of quota, or a free-tier quota stuck at zero that
  // never resets). Fall back to Groq rather than failing the student's turn: a
  // dead tutor is not merely a missing reply — this same call is what records
  // the topic visit, the weak point and the course progress, so throwing here
  // silently discards the learning loop too.
  console.warn(
    geminiSkipped
      ? "Gemini skipped (breaker open or unconfigured); using the Groq fallback."
      : "Gemini unavailable; using the Groq fallback.",
    { cause: (lastError as Error)?.message },
  );
  try {
    // Must be the same instruction the Gemini path uses. Passing the
    // mode-only prompt here silently dropped the language clause, so a Hindi
    // student got an English explanation whenever Gemini was out of quota —
    // which, given the free tier, is most of the time.
    return await completeText(systemInstructionFor(mode, language), promptText, {
      models: [...GROQ_TEXT_MODELS],
      temperature: 0.6,
      maxTokens: 900,
    });
  } catch (groqError) {
    lastError = groqError;
  }

  throw new Error(
    "All Gemini models are unavailable or out of quota, and the Groq fallback also failed. Please try again shortly.",
    { cause: lastError },
  );
}

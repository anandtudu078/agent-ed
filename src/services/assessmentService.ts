import { completeJson } from "./groqClient";
import type { TeachLanguage } from "./aiService";
import { difficultyClause, type DifficultyBand } from "./progressService";

export interface AssessmentQuestion {
  topic: string;
  question: string;
}

/**
 * Ask the question in the student's own language.
 *
 * Asking in English and then grading a Hindi answer fairly is self-defeating:
 * the question becomes a reading test wearing a maths costume.
 */
const QUESTION_LANGUAGE: Record<TeachLanguage, string> = {
  en: "",
  hi:
    " Write the question in Hindi (Devanagari) mixed with English, the way an " +
    "Indian student actually learns. Keep technical terms in English — write " +
    '"recursion" or "gradient", not a transliteration. Do not ask the student ' +
    "to read more Devanagari than they must.",
};

/**
 * The grading clause — this is the actual fix.
 *
 * The previous prompt told the model to judge understanding and not "polish or
 * grammar" but never mentioned language, so a student who explained a concept
 * correctly in Hindi was reliably marked down for their English. A bilingual
 * student was being graded on the wrong subject entirely.
 *
 * The "never reduce the score" instruction is explicit and unconditional on
 * purpose: this is precisely the kind of thing a grader silently violates when
 * left to its own judgement.
 */
const GRADING_LANGUAGE: Record<TeachLanguage, string> = {
  en: "",
  hi:
    " The student may answer in Hindi, English, or any mix of the two. Judge " +
    "ONLY their conceptual understanding of the topic. NEVER reduce the score " +
    "because the answer is written in Hindi rather than English, and never for " +
    "grammar, spelling, or transliterated technical terms. An answer that is " +
    "conceptually complete but written in Hinglish deserves full credit. " +
    'Write your "feedback" and "recommendedFocus" in the same Hindi-and-English ' +
    "mix, keeping technical terms in English.",
};

export interface AssessmentGrade {
  /** 0–100. */
  score: number;
  feedback: string;
  recommendedFocus: string;
  /** 0–100 estimate of the student's grasp, folded back into weak points. */
  masteryEstimate: number;
  misconceptions: string[];
}

function clampScore(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function asText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Ask one probing question that reveals *understanding* rather than recall.
 *
 * Deliberately not multiple choice: a student can pattern-match an MCQ without
 * understanding anything, which would make the whole weak-point pipeline built
 * on top of it worthless.
 */
export async function generateAssessmentQuestion(
  topic: string,
  misconceptions: string[] = [],
  language: TeachLanguage = "en",
  /**
   * How hard to make this one. Drives the shape of the question, not a number
   * the model has to interpret — see difficultyClause.
   */
  difficulty: DifficultyBand = "standard",
): Promise<AssessmentQuestion> {
  const focus = misconceptions.length
    ? `Target these known sticking points: ${misconceptions
        .slice(0, 5)
        .join("; ")}.`
    : "No specific misconceptions are on record for this topic yet.";

  const raw = await completeJson<Record<string, unknown>>(
    "You write short diagnostic questions for a tutoring app. The question must " +
      "reveal whether the student truly understands the concept, so avoid yes/no " +
      "questions, avoid asking them to recall a definition verbatim, and avoid " +
      "multiple choice. Ask for one thing: an explanation, a prediction, a worked " +
      "step, or a 'what would change if' scenario. " +
      // Difficulty is stated separately and last so it reads as a correction to
      // the generic brief above rather than a competing instruction.
      difficultyClause(difficulty) +
      " Return only JSON: {\"topic\": string, \"question\": string}." +
      QUESTION_LANGUAGE[language],
    `Topic: ${topic}\n${focus}\n\nWrite one diagnostic question about this topic.`,
    { temperature: 0.4 },
  );

  const question = asText(raw.question, 500);
  if (!question) {
    throw new Error("Could not generate an assessment question.");
  }

  return { topic: asText(raw.topic, 60) || topic, question };
}

/**
 * Grade a student's answer: score it, explain what landed and what didn't, and
 * name the single thing to work on next.
 */
export async function gradeAssessmentAnswer(
  topic: string,
  question: string,
  answer: string,
  misconceptions: string[] = [],
  language: TeachLanguage = "en",
): Promise<AssessmentGrade> {
  const focus = misconceptions.length
    ? `Previously observed sticking points: ${misconceptions.slice(0, 5).join("; ")}.`
    : "";

  const raw = await completeJson<Record<string, unknown>>(
    "You are a fair, encouraging tutor grading a student's explanation. Judge " +
      "conceptual understanding, not polish, grammar, or length. A correct idea " +
      "stated awkwardly still scores well. Be specific about what was missing " +
      "rather than vague. Never grade down for being a beginner. " +
      "Return only JSON with: " +
      '"score" (integer 0-100), ' +
      '"feedback" (2-3 sentences, addressed to the student, naming what they got ' +
      "right and the specific gap), " +
      '"recommendedFocus" (a short noun phrase, the one concept to study next), ' +
      '"masteryEstimate" (integer 0-100, how well they understand the topic now), ' +
      'and "misconceptions" (array of concise strings, empty if none).' +
      GRADING_LANGUAGE[language],
    `Topic: ${topic}\n${focus}\n\nQuestion asked:\n${question}\n\nStudent's answer:\n${answer}`,
  );

  const feedback = asText(raw.feedback, 1200);
  if (!feedback) {
    throw new Error("Could not grade the assessment answer.");
  }

  return {
    score: clampScore(raw.score, 50),
    feedback,
    recommendedFocus: asText(raw.recommendedFocus, 160),
    masteryEstimate: clampScore(raw.masteryEstimate, 50),
    misconceptions: asStringList(raw.misconceptions, 5),
  };
}

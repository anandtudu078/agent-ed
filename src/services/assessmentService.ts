import { completeJson } from "./groqClient";

export interface AssessmentQuestion {
  topic: string;
  question: string;
}

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
      "step, or a 'what would change if' scenario. Keep it under 40 words. " +
      "Return only JSON: {\"topic\": string, \"question\": string}.",
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
      'and "misconceptions" (array of concise strings, empty if none).',
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

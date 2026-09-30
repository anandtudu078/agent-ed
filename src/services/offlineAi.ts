/**
 * Offline (deterministic) AI stand-in, for CI and for local development without
 * a provider key.
 *
 * Why this exists rather than a stub in the browser test: the assessment
 * endpoints are not only a source of text, they are the *engine* of the progress
 * pipeline. `POST /assessment/grade` writes `topicsVisited`, `testHistory`,
 * `weakPoints`, `reviewCards` and `learningSpeed`, and the dashboard then renders
 * all of it. A client-side stub would paint a result panel while writing none of
 * that, so the review-card and weak-point checks would have to be skipped — a
 * green run bought with lost coverage. Answering here instead keeps the entire
 * pipeline under test.
 *
 * The safety rule, and the reason this file exists as a separate module: this
 * must never be reachable in production. A deploy with a missing or expired key
 * would otherwise show real students a fabricated score and invented feedback,
 * which is strictly worse than the honest 502 the routes return today. So the
 * gate requires an explicit opt-in AND refuses outright under NODE_ENV=production.
 */

import type { TeachLanguage } from "./aiService";
import type { AssessmentGrade, AssessmentQuestion } from "./assessmentService";
import type { DifficultyBand } from "./progressService";

/**
 * Is the offline stand-in allowed right now?
 *
 * Two conditions, both required. The explicit opt-in means a developer has to
 * ask for this; the production refusal means asking for it cannot get a real
 * student a fake grade. Exported and pure so the rule itself is unit-testable —
 * it is the one part of this that must not be taken on trust.
 */
export function offlineAiEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  // Trimmed because a trailing space is trivially easy to produce and hard to
  // see: `set ALLOW_OFFLINE_AI=1 && node server.js` in cmd sets the value to
  // "1 ", which a strict `!== "1"` rejects. That failure is safe but confusing —
  // the gate stays shut and CI mysteriously calls a real model. Accepting the
  // trimmed form only widens the opt-in; it does not touch the production
  // refusal below.
  if ((env.ALLOW_OFFLINE_AI ?? "").trim() !== "1") return false;
  // Case-insensitive and trimmed on purpose. An exact `=== "production"`
  // comparison let "Production" through, which would have handed real students
  // fabricated grades on any host that set it with a capital P. A guard that
  // fails open is worse than no guard, so this errs toward refusing: anything
  // that is not clearly NOT production is treated as production.
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return false;
  return true;
}

/**
 * The score the offline grader hands back.
 *
 * 60 is deliberate, not arbitrary. `REVIEW_PASS_SCORE` is 65, so landing below
 * it means the offline run still records a weak point and still schedules a
 * review card due in a day. That keeps the dashboard assertions and the
 * "clicking a weak point starts a test" branch genuinely exercised instead of
 * quietly taking the happy path through a pipeline that would otherwise never
 * run in CI.
 */
const OFFLINE_SCORE = 60;
const OFFLINE_MASTERY = 55;

const QUESTION_BY_BAND: Record<DifficultyBand, string> = {
  remedial:
    "In your own words, what problem is this trying to solve, and why does the " +
    "obvious approach not work?",
  standard:
    "Explain how you would decide whether this approach actually works, and " +
    "what you would measure.",
  stretch:
    "Suppose this approach stopped working on one kind of input. What would " +
    "you look at first to work out why?",
};

/**
 * A fixed question per difficulty band.
 *
 * Not generated, not randomised: identical input must give identical output, or
 * the CI run stops being reproducible and a failure becomes impossible to
 * re-attribute.
 */
export function offlineQuestion(
  topic: string,
  language: TeachLanguage = "en",
  difficulty: DifficultyBand = "standard",
): AssessmentQuestion {
  const english = QUESTION_BY_BAND[difficulty] ?? QUESTION_BY_BAND.standard;
  return {
    topic,
    question:
      language === "hi"
        ? `${topic} के बारे में अपने शब्दों में बताओ कि यह approach कैसे काम करता है, और तुम क्या मापेंगे कि यह सच में काम कर रहा है?`
        : english,
  };
}

/**
 * A fixed grade, phrased so the student is not misled about it.
 *
 * The feedback says plainly that this is an offline placeholder. A student on a
 * developer machine with no key should never read a confident, specific-sounding
 * critique and believe a model wrote it about their work.
 */
export function offlineGrade(
  topic: string,
  answer: string,
  language: TeachLanguage = "en",
): AssessmentGrade {
  const answered = answer.trim().length > 0;
  const englishFeedback =
    `This is an offline placeholder score, not a real evaluation — no AI ` +
    `provider was configured, so nothing has actually assessed your answer. ` +
    `Set GROQ_API_KEY (or GEMINI_API_KEY) and take the check again for a real ` +
    `grade on ${topic}.`;

  const englishFocus = "wire up a provider key and retake the check";

  return {
    score: OFFLINE_SCORE,
    feedback: answered ? englishFeedback : `${englishFeedback} Your answer was empty.`,
    recommendedFocus: answered ? englishFocus : "answer the question, then set a provider key",
    masteryEstimate: OFFLINE_MASTERY,
    // Kept empty on purpose. Inventing misconceptions here would seed the weak
    // point list with fabrications that then steer every future tutor prompt.
    misconceptions: [],
  };
}

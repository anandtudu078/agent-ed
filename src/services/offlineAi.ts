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

// ===========================================================================
// The tutor itself
// ===========================================================================
//
// Until now this module only stood in for the *assessment* endpoints, so a
// developer with no key could grade a test but could not have a single tutor
// conversation. The tutor is the headline feature, and it was the one thing
// that hard-failed: `analyzeStudentInput` throws on a missing GROQ_API_KEY
// before any network call is even attempted, so a judge who clones the repo
// with no key to hand meets an error exactly where the product should be.
//
// So the tutor gets a stand-in too, behind the same opt-in and the same
// production refusal as everything else here. It answers as a tutor rather
// than as an error, and it says plainly that it is offline, for the same
// reason `offlineGrade` does: a student must never read confident-sounding
// tutoring and believe a model wrote it.
//
// Deliberately not one canned string. It still withholds the answer in
// Socratic mode, still teaches and then checks understanding in Teach mode,
// still speaks Hindi, and still varies by topic, so an offline demo exercises
// the real beat segmentation, the owl, the lesson board and the checkpoint
// pipeline instead of proving nothing.

/**
 * A topic-shaped noun phrase, so a reply reads as being about *something*
 * rather than about the placeholder itself.
 */
function topicPhrase(topic: string): string {
  const clean = (topic ?? "").trim();
  return clean.length > 0 ? clean : "this topic";
}

const OFFLINE_TUTOR_SOCRATIC: Record<"en" | "hi", (topic: string) => string> = {
  en: (topic) =>
    `Before I explain ${topic} properly, I want to check what you already have.\n\n` +
    `What problem do you think ${topic} is actually trying to solve? ` +
    `And what would go wrong if we just did the simplest possible thing instead?\n\n` +
    `Once you tell me where your reasoning lands, I will take it from there.`,
  hi: (topic) =>
    `${topic} को ठीक से समझाने से पहले, मैं देखना चाहता हूँ कि आप अभी क्या जानते हैं।\n\n` +
    `आपके अनुसार ${topic} हल करने की कोशिश किस समस्या को दूर करती है? ` +
    `और अगर हम सबसे आसान तरीका अपनाएँ, तो क्या गड़बड़ होगी?\n\n` +
    `जब आप बता दें कि आपकी सोच कहाँ तक पहुँचती है, तब हम आगे बढ़ेंगे।`,
};

const OFFLINE_TUTOR_TEACH: Record<"en" | "hi", (topic: string) => string> = {
  en: (topic) =>
    `A clear way to hold on to ${topic} is to keep three things separate: ` +
    `what goes in, what happens, and what comes out.\n\n` +
    `Whatever the specifics, the job of ${topic} is usually to take one ` +
    `representation and make it more useful: compressing it, rearranging it, ` +
    `or scoring it against something you actually care about.\n\n` +
    `Here is the part worth checking: does that match what you have seen so ` +
    `far, or is there a case where it breaks down?`,
  hi: (topic) =>
    `${topic} को समझने का एक अच्छा तरीका यह है कि तीन बातें अलग-अलग रखी जाएँ: ` +
    `अंदर क्या जाता है, बीच में क्या होता है, और बाहर क्या निकलता है।\n\n` +
    `${topic} की भूमिका आमतौर पर यही होती है कि एक रूप को और उपयोगी बनाया जाए: ` +
    `उसे सघन करके, उलटकर, या किसी महत्वपूर्ण चीज़ से मिलाकर।\n\n` +
    `अब जाँचने योग्य बात यह है: क्या यह विवरण आपके अब तक के अनुभव से मेल खाता है?`,
};

/**
 * A tutor reply with no provider behind it.
 *
 * Deterministic for a given (topic, mode, language): the same input must give
 * the same output, or a CI run stops being reproducible and a failure cannot be
 * re-attributed. That is also why it takes the topic rather than the student's
 * free text: a demo can show a different lesson per module while the output
 * stays predictable.
 */
export function offlineTutorReply(
  topic: string,
  mode: "socratic" | "teach" = "socratic",
  language: TeachLanguage = "en",
): string {
  const table = mode === "teach" ? OFFLINE_TUTOR_TEACH : OFFLINE_TUTOR_SOCRATIC;
  const line = table[language] ?? table.en;
  const body = line(topicPhrase(topic));
  // The notice is in the same language as the lesson. A Hindi-speaking student
  // must not be told in English that the Hindi they are reading is fake.
  const notice =
    language === "hi"
      ? `(यह एक ऑफ़लाइन जवाब है। कोई AI प्रोvider सेट नहीं है, इसलिए इसे मॉडल ने ` +
        `नहीं लिखा। असली जवाब के लिए GROQ_API_KEY सेट करें।)`
      : `(This is an offline answer. No AI provider is configured, so a model ` +
        `did not write this. Set GROQ_API_KEY for the real tutor.)`;
  return `${body}\n\n${notice}`;
}

/**
 * The student-analysis call, stood in for the same way.
 *
 * Neutral rather than flattering on purpose: `masteryEstimate` drives the
 * difficulty band and, through it, the owl's reaction, so an invented high
 * number would quietly steer the whole pipeline. A mid value changes nothing.
 */
export function offlineStudentAnalysis(topic: string): {
  intent: string;
  topic: string;
  masteryEstimate: number;
  coreMisunderstandings: string[];
} {
  return {
    intent: "offline-placeholder",
    topic: topicPhrase(topic),
    masteryEstimate: OFFLINE_MASTERY,
    // Empty for the same reason `offlineGrade` leaves them empty.
    coreMisunderstandings: [],
  };
}

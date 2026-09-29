import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { Progress, TestEvaluation } from "../models/Progress";
import { Session } from "../models/Session";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
  requireJwtSecret,
} from "../middleware/auth";
import { chatRateLimit } from "../middleware/rateLimit";
import {
  gradeAssessmentAnswer,
  generateAssessmentQuestion,
} from "../services/assessmentService";
import {
  mergeWeakPoints,
  clampMastery,
  computeLearningSpeed,
} from "../services/progressService";

const router = Router();

/** A question only stays valid long enough to answer it. */
const ATTEMPT_TTL_SECONDS = 15 * 60;
const MAX_TEST_HISTORY = 20;
/** Guard rail against piping a novel into a billable grading call. */
const MAX_ANSWER_LENGTH = 4000;

interface AttemptPayload {
  studentId: string;
  topic: string;
  question: string;
  misconceptions: string[];
}

/**
 * The in-flight question travels with the client inside a short-lived signed
 * token. That keeps the endpoint stateless (no half-finished attempts to clean
 * up) while still stopping a client from swapping in its own easy question to
 * farm a high score.
 */
function signAttempt(payload: AttemptPayload): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: ATTEMPT_TTL_SECONDS });
}

function verifyAttempt(token: string): AttemptPayload {
  // Pin the algorithm, matching the auth middleware: only tokens we signed
  // with HS256 are valid attempt tickets.
  const decoded = jwt.verify(token, requireJwtSecret(), {
    algorithms: ["HS256"],
  });
  if (typeof decoded === "string" || !decoded.topic || !decoded.question) {
    throw new Error("Malformed assessment attempt.");
  }
  return decoded as unknown as AttemptPayload;
}

function parseTopic(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const topic = (body as Record<string, unknown>).topic;
  return typeof topic === "string" ? topic.trim().slice(0, 60) : "";
}

function parseAnswer(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const answer = (body as Record<string, unknown>).answer;
  return typeof answer === "string" ? answer.trim().slice(0, MAX_ANSWER_LENGTH) : "";
}

/**
 * Pick what to test: whatever the student asked for, else their weakest
 * tracked topic, else whatever they were last discussing, else a sensible
 * default so a brand-new student still gets a working button.
 */
async function chooseTopic(
  studentId: string,
  requested: string,
): Promise<{ topic: string; misconceptions: string[] }> {
  if (requested) return { topic: requested, misconceptions: [] };

  const progress = await Progress.findOne({ studentId }).select({ weakPoints: 1 }).lean();
  const weakest = progress?.weakPoints?.[0];
  if (weakest?.topic) return { topic: weakest.topic, misconceptions: [] };

  const session = await Session.findOne({ studentId }).select({ activeTopic: 1 }).lean();
  const active = session?.activeTopic?.trim();
  return { topic: active || "Critical thinking", misconceptions: [] };
}

/**
 * POST /api/assessment/start
 * Body: { topic? } — defaults to the student's weakest tracked topic.
 * Returns a diagnostic question plus a token to submit an answer with.
 */
router.post("/start", requireAuth, chatRateLimit, async (request: Request, response: Response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const { topic, misconceptions } = await chooseTopic(
      authUser.username,
      parseTopic(request.body),
    );

    const { question } = await generateAssessmentQuestion(
      topic,
      misconceptions,
      // Read from the token, never the body: a client must not be able to
      // request a Hindi question and have it graded against English criteria.
      authUser.language,
    );
    const attemptToken = signAttempt({
      studentId: authUser.username,
      topic,
      question,
      misconceptions,
    });

    response.json({ attemptToken, topic, question });
  } catch (error) {
    console.error("Failed to start assessment.", error);
    response.status(502).json({
      error: "Could not start an evaluation right now. Please try again.",
    });
  }
});

/**
 * POST /api/assessment/submit
 * Body: { attemptToken, answer }
 * Grades the answer and records it as the student's latest test result.
 */
router.post("/submit", requireAuth, chatRateLimit, async (request: Request, response: Response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const studentId = authUser.username;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const attemptToken = typeof body.attemptToken === "string" ? body.attemptToken : "";
    const answer = parseAnswer(body);

    if (!attemptToken) {
      response.status(400).json({ error: "attemptToken is required." });
      return;
    }
    if (!answer) {
      response.status(400).json({ error: "Please write an answer first." });
      return;
    }

    let attempt: AttemptPayload;
    try {
      attempt = verifyAttempt(attemptToken);
    } catch {
      response.status(401).json({
        error: "That evaluation expired. Please start a new one.",
      });
      return;
    }

    // The token is bound to whoever started it.
    if (attempt.studentId !== studentId) {
      response.status(403).json({ error: "That evaluation belongs to another student." });
      return;
    }

    const grade = await gradeAssessmentAnswer(
      attempt.topic,
      attempt.question,
      answer,
      attempt.misconceptions,
      authUser.language,
    );

    const evaluation: TestEvaluation = {
      topic: attempt.topic,
      score: grade.score,
      feedback: grade.feedback,
      recommendedFocus: grade.recommendedFocus,
      evaluatedAt: new Date(),
    };

    // Taking an evaluation is itself covering the topic, so it counts toward
    // the concepts-per-week estimate just like a chat turn does.
    const now = new Date();
    const existingSession = await Session.findOne({ studentId })
      .select({ topicsVisited: 1 })
      .lean();
    const visited = existingSession?.topicsVisited ?? [];
    const alreadyVisited = visited.some(
      (visit) => visit.topic.toLowerCase() === attempt.topic.toLowerCase(),
    );
    const topicsVisited = alreadyVisited
      ? visited
      : [...visited, { topic: attempt.topic, firstSeenAt: now }];

    if (!alreadyVisited) {
      await Session.findOneAndUpdate(
        { studentId },
        {
          $set: { activeTopic: attempt.topic },
          $push: { topicsVisited: { topic: attempt.topic, firstSeenAt: now } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    const existing = await Progress.findOne({ studentId }).lean();
    const history = [...(existing?.testHistory ?? []), evaluation]
      // Cap the history too — a student's own record shouldn't grow forever.
      .slice(-MAX_TEST_HISTORY);

    // A graded answer is a far better mastery signal than a chat turn, so it
    // drives the same rolling weak-point list.
    const weakPoints = mergeWeakPoints(
      existing?.weakPoints ?? [],
      attempt.topic,
      clampMastery(grade.masteryEstimate),
    );
    const learningSpeed = computeLearningSpeed(topicsVisited, now);

    await Progress.findOneAndUpdate(
      { studentId },
      { $set: { testHistory: history, weakPoints, learningSpeed } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    response.json({ evaluation, misconceptions: grade.misconceptions });
  } catch (error) {
    console.error("Failed to grade assessment.", error);
    response.status(502).json({
      error: "Could not grade that answer right now. Please try again.",
    });
  }
});

export default router;

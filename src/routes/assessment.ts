import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";

import {
  Progress,
  ReviewCard,
  TestEvaluation,
  WeakPoint,
  type CourseTestRecord,
} from "../models/Progress";
import { Course } from "../models/Course";
import {
  mergeCourseTest,
  checkpointStatus,
  MAX_MODULES_COVERED,
} from "../services/checkpoints";
import { topicsMatch } from "../services/courseService";
import { MAX_STORED_TOPIC_VISITS, Session } from "../models/Session";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
  requireJwtSecret,
} from "../middleware/auth";
import { chatRateLimit } from "../middleware/rateLimit";
import { requireConsent } from "../middleware/consent";
import { aiSpendLimit } from "../middleware/aiSpendLimit";
import {
  difficultyForTopic,
  updateProgressWithRetry,
  upsertReviewCard,
  type DifficultyBand,
} from "../services/progressService";
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
/** Same guard on the misconception list carried in an attempt ticket. */
const MAX_MISCONCEPTIONS = 5;
const MAX_MISCONCEPTION_LENGTH = 200;
// MAX_MODULES_COVERED now lives in services/checkpoints.ts, next to the rule that
// produces the list, so the signing bound and the interval logic cannot drift apart.

interface AttemptPayload {
  studentId: string;
  topic: string;
  question: string;
  misconceptions: string[];
  /**
   * Set only for a checkpoint test: the course it belongs to, and the modules it
   * stands in for. Signed rather than sent back by the client, so the coverage
   * recorded on submit is the coverage the server itself decided — otherwise a
   * client could mark a whole course tested by claiming it covered everything.
   */
  courseId?: string;
  modulesCovered?: string[];
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
  if (typeof decoded === "string") {
    throw new Error("Malformed assessment attempt.");
  }
  const payload = decoded as Record<string, unknown>;
  // Every field is shape-checked, not just the two the old check looked at.
  // `studentId` and `misconceptions` were blind-cast straight out of a signed
  // token into an ownership comparison and into the grading prompt. Signing stops
  // forgery, not a malformed claim — so validate everything we are about to
  // trust rather than assuming our own `sign` produced a well-formed payload.
  if (
    typeof payload.studentId !== "string" ||
    !payload.studentId ||
    typeof payload.topic !== "string" ||
    typeof payload.question !== "string" ||
    (payload.misconceptions !== undefined &&
      !Array.isArray(payload.misconceptions)) ||
    // Checkpoint fields are optional, but if present they must be the right shape.
    // They decide which course gets marked as tested, so a malformed value has to
    // fail the ticket rather than be coerced into something writable.
    (payload.courseId !== undefined && typeof payload.courseId !== "string") ||
    (payload.modulesCovered !== undefined && !Array.isArray(payload.modulesCovered))
  ) {
    throw new Error("Malformed assessment attempt.");
  }
  return {
    studentId: payload.studentId,
    topic: payload.topic,
    question: payload.question,
    // Bounded and string-only, because this array is spliced into a billable
    // grading prompt.
    misconceptions: ((payload.misconceptions as unknown[]) ?? [])
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, MAX_MISCONCEPTION_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_MISCONCEPTIONS),
    ...(typeof payload.courseId === "string" && payload.courseId
      ? { courseId: payload.courseId }
      : {}),
    ...(Array.isArray(payload.modulesCovered)
      ? {
          // Module titles are bounded for the same reason as the rest: this list
          // is written into the student's record, and a signed ticket is still not
          // proof the values are sensible.
          modulesCovered: (payload.modulesCovered as unknown[])
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().slice(0, 200))
            .filter(Boolean)
            .slice(0, MAX_MODULES_COVERED),
        }
      : {}),
  };
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
): Promise<{ topic: string; misconceptions: string[]; difficulty: DifficultyBand }> {
  // Loaded up front regardless of whether a topic was requested: the band and
  // the misconception targeting both need it, and skipping the read on the
  // "topic was specified" path is how the difficulty quietly stayed "standard"
  // for every explicit test.
  const progress = await Progress.findOne({ studentId })
    .select({ weakPoints: 1, reviewCards: 1, testHistory: 1 })
    .lean();

  let topic = requested;
  if (!topic) {
    const weakest = progress?.weakPoints?.[0];
    if (weakest?.topic) {
      topic = weakest.topic;
    } else {
      const session = await Session.findOne({ studentId }).select({ activeTopic: 1 }).lean();
      topic = session?.activeTopic?.trim() || "Critical thinking";
    }
  }

  // The misconceptions the grader already wrote for this topic, newest first.
  // They used to be discarded on the way out; now they also steer the *next*
  // question, which is where they were always most useful.
  //
  // Matched with `topicsMatch`, not `===`. These stored topics are written by a
  // grader reading free text, so they carry whatever phrasing the model chose
  // ("backprop", "backpropagation and gradient flow"), while `topic` here may
  // be the authored curriculum string or something the student typed. Exact
  // equality matched almost nothing — across the 186 authored topics, "backprop"
  // and "what is a transformer" hit zero — so the targeting silently did nothing
  // and the feature was only ever exercised when both sides happened to agree.
  const matching = (progress?.testHistory ?? []).filter((evaluation) =>
    topicsMatch(topic, evaluation.topic ?? ""),
  );
  const misconceptions = matching
    .reverse()
    .flatMap((evaluation) => evaluation.misconceptions ?? [])
    .filter(Boolean);

  return {
    topic,
    misconceptions: misconceptions.slice(0, 5),
    difficulty: difficultyForTopic(progress, topic),
  };
}

/**
 * POST /api/assessment/start
 * Body: { topic? } — defaults to the student's weakest tracked topic.
 * Returns a diagnostic question plus a token to submit an answer with.
 */
router.post(
  "/start",
  requireAuth,
  requireConsent,
  chatRateLimit,
  aiSpendLimit,
  async (request: Request, response: Response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const { topic, misconceptions, difficulty } = await chooseTopic(
      authUser.username,
      parseTopic(request.body),
    );

    const { question } = await generateAssessmentQuestion(
      topic,
      misconceptions,
      // Read from the token, never the body: a client must not be able to
      // request a Hindi question and have it graded against English criteria.
      authUser.language,
      difficulty,
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
  },
);

/**
 * POST /api/assessment/checkpoint
 * Body: { courseId }
 *
 * Starts a checkpoint test for a course — the interval test the student is owed.
 *
 * The whole point is that it decides *what* to ask from where the student actually
 * is, rather than trusting a topic from the client: the modules they have finished,
 * minus the ones a previous checkpoint already covered, determine the question. A
 * client could otherwise ask to be "tested" on a module it has never reached, and
 * be marked down for it.
 *
 * Returns the same `attemptToken` shape as `/start`, so the client reuses one test
 * panel and one submit path for both kinds of test.
 */
router.post(
  "/checkpoint",
  requireAuth,
  requireConsent,
  chatRateLimit,
  aiSpendLimit,
  async (request: Request, response: Response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const courseId =
      typeof (request.body as { courseId?: unknown })?.courseId === "string"
        ? String((request.body as { courseId: string }).courseId).trim()
        : "";
    if (!courseId) {
      response.status(400).json({ error: "courseId is required." });
      return;
    }

    const studentId = authUser.username;
    const [progress, course] = await Promise.all([
      Progress.findOne({ studentId })
        .select({ enrolledCourses: 1, courseTests: 1, weakPoints: 1, testHistory: 1 })
        .lean(),
      Course.findById(courseId).lean(),
    ]);

    if (!course) {
      response.status(404).json({ error: "That course no longer exists." });
      return;
    }
    // Owner-only, exactly as the dashboard is: a checkpoint must not be startable
    // against a course another student is enrolled in.
    const enrollment = (progress?.enrolledCourses ?? []).find(
      (item) => item.courseId === courseId,
    );
    if (!enrollment) {
      response.status(403).json({
        error: "Enrol in that course before taking its checkpoint test.",
      });
      return;
    }

    const status = checkpointStatus(
      courseId,
      course.modules ?? [],
      enrollment.completedModules ?? [],
      (progress?.courseTests ?? []).find((test) => test.courseId === courseId) ?? null,
    );

    // Refuse rather than inventing a question. A checkpoint with nothing to ask
    // about means the student has not finished enough modules yet, and inventing
    // one would produce a test whose result could never be attributed to anything.
    if (!status.due || !status.nextModule) {
      response.status(409).json({
        error: "No checkpoint test is due for that course right now.",
        modulesUntilNext: status.modulesUntilNext,
      });
      return;
    }

    // Misconceptions already recorded for this module steer the question, so the
// checkpoint asks about the gap rather than re-asking what went wrong before.
    //
    // `topicsMatch` rather than exact equality, for the same reason as `/start`:
    // the stored topics are model-written and this one is authored, so `===`
    // matched almost nothing and a checkpoint almost never carried any
    // misconception targeting at all.
    const misconceptions = (progress?.testHistory ?? [])
      .filter((evaluation) => topicsMatch(status.nextModule!.topic, evaluation.topic ?? ""))
      .flatMap((evaluation) => evaluation.misconceptions ?? [])
      .filter(Boolean)
      .slice(0, 5);

    const difficulty = difficultyForTopic(
      { weakPoints: progress?.weakPoints ?? [], reviewCards: [] },
      status.nextModule.topic,
    );

    const { question } = await generateAssessmentQuestion(
      status.nextModule.topic,
      misconceptions,
      authUser.language,
      difficulty,
    );

    // The full untested list is what this checkpoint stands in for, capped only by
    // the signing guard. It used to be `status.untestedModules`, which was itself
    // truncated to 4 — so on any course longer than that, taking the test marked
    // four modules covered and left the rest permanently untested, which kept
    // `untested.length` above CHECKPOINT_INTERVAL and re-armed the checkpoint
    // immediately. The student could never clear it.
    const modulesCovered = status.untestedModules
      .map((module) => module.title)
      .slice(0, MAX_MODULES_COVERED);

    const attemptToken = signAttempt({
      studentId,
      topic: status.nextModule.topic,
      question,
      misconceptions,
      courseId,
      modulesCovered,
    });

    response.json({
      attemptToken,
      topic: status.nextModule.topic,
      question,
      courseId,
      // Which modules this checkpoint is standing in for. Signed into the ticket
      // so the submit path can record coverage it can trust, rather than trusting
      // a list the client sends back.
      modulesCovered,
    });
  } catch (error) {
    console.error("Failed to start a checkpoint test.", error);
    response.status(502).json({
      error: "Could not start the checkpoint test right now. Please try again.",
    });
  }
  },
);

/**
 * POST /api/assessment/submit
 * Body: { attemptToken, answer }
 * Grades the answer and records it as the student's latest test result.
 */
router.post(
  "/submit",
  requireAuth,
  requireConsent,
  chatRateLimit,
  aiSpendLimit,
  async (request: Request, response: Response) => {
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
      // Persisted with the evaluation. These used to be returned to the client
      // and immediately forgotten, which threw away the only record of *what*
      // the student actually got wrong as opposed to *where*.
      misconceptions: grade.misconceptions,
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
          // `$slice` keeps the array bounded, exactly as the chat path does with
          // MAX_STORED_TOPIC_VISITS. Without it this push grows the Session
          // document without limit, and conversationHistory shares the same
          // document — so one student testing many topics could push the record
          // past MongoDB's 16 MB ceiling and silently lose the ability to chat
          // at all. `$each` + `$slice` keeps the most recent N.
          $push: {
            topicsVisited: {
              each: { topic: attempt.topic, firstSeenAt: now },
              slice: -MAX_STORED_TOPIC_VISITS,
            },
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    // Conditional on the arrays this computation read, so a chat turn landing
    // between the read and the write is not overwritten. See
    // updateProgressWithRetry for why a plain read-then-$set loses data.
    await updateProgressWithRetry(
      studentId,
      ["testHistory", "weakPoints", "reviewCards", "courseTests"],
      (current) => {
        const history = [
          ...((current.testHistory as TestEvaluation[]) ?? []),
          evaluation,
          // Cap the history too — a student's own record shouldn't grow forever.
        ].slice(-MAX_TEST_HISTORY);

        // A graded answer is a far better mastery signal than a chat turn, so it
        // drives the same rolling weak-point list.
        const weakPoints = mergeWeakPoints(
          (current.weakPoints as WeakPoint[]) ?? [],
          attempt.topic,
          clampMastery(grade.masteryEstimate),
        );
        // ...and it is the only real signal we have for *when* to bring the topic
        // back, so it also drives the review schedule.
        const reviewCards = upsertReviewCard(
          (current.reviewCards as ReviewCard[]) ?? [],
          attempt.topic,
          grade.score,
          now,
        );
        const learningSpeed = computeLearningSpeed(topicsVisited, now);

        // Record the checkpoint this attempt covered, so the next one knows where
        // to pick up. Only for a checkpoint ticket — an ordinary topic test must
        // not mark any course as tested, or a student could clear their whole
        // course's checkpoints by taking unrelated topic tests.
        const courseTests = attempt.courseId
          ? mergeCourseTest((current.courseTests as CourseTestRecord[]) ?? [], {
              courseId: attempt.courseId,
              testedModules: attempt.modulesCovered ?? [],
              score: grade.score,
              testedAt: now,
            })
          : ((current.courseTests as CourseTestRecord[]) ?? []);

        return {
          set: {
            testHistory: history,
            weakPoints,
            reviewCards,
            learningSpeed,
            courseTests,
          },
          result: undefined,
        };
      },
    );

    response.json({ evaluation, misconceptions: grade.misconceptions });
  } catch (error) {
    console.error("Failed to grade assessment.", error);
    response.status(502).json({
      error: "Could not grade that answer right now. Please try again.",
    });
  }
  },
);

export default router;

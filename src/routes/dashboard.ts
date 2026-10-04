import { Router } from "express";

import { Course } from "../models/Course";
import { Progress } from "../models/Progress";
import { Session } from "../models/Session";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
} from "../middleware/auth";
import {
  refreshEnrollments,
  PREREQUISITE_GRAPH,
} from "../services/courseService";
import { dueCards, dueLabel, rootCauseTopic } from "../services/progressService";
import CURRICULUM, { RETIRED_COURSE_TITLES } from "../data/curriculum";
import { awayLabel, returnState } from "../services/returnState";
import { dueCheckpoints } from "../services/checkpoints";
import { DAILY_GOAL_TURNS, streakFor } from "../services/streak";

const router = Router();

/**
 * Seed the catalog, and sync every starter course's content on boot.
 *
 * The sync is what makes editing the curriculum safe: without it, a renamed
 * category or an extended syllabus only ever reaches a brand-new database, and
 * existing installs silently keep serving the old version. Progress depends on
 * `modules` being present (it's the denominator for "how far through am I"),
 * so a stale syllabus isn't cosmetic — it quietly corrupts percentages.
 */
/**
 * The authored curriculum shape, as the stored shape.
 *
 * `subtopics` is optional when authored — a module we haven't written a
 * breakdown for is a normal state, not an error — but the stored module always
 * carries the key, defaulting to an empty list. Normalising here rather than
 * relying on the schema default matters because this is a `bulkWrite`: schema
 * defaults are not applied to a raw update, so without this a module authored
 * without subtopics would be persisted as a missing field and the client would
 * have to defend against both shapes forever.
 */
function toStoredModules(course: (typeof CURRICULUM)[number]) {
  return course.modules.map((module) => ({
    title: module.title,
    topic: module.topic,
    subtopics: module.subtopics ?? [],
  }));
}

/**
 * Seed the catalog once, and share the result across concurrent requests.
 *
 * The dashboard used to call `ensureStarterCourses()` inline on every request,
 * which meant a full catalog `bulkWrite` + `find` + `insertMany` + prune ran per
 * page load — on the single hottest route in the app — despite the function's
 * own doc comment describing it as happening "on boot". Worse, two requests
 * arriving together both found a course missing and both inserted it, because
 * `Course.title` carries no unique index to make the second one fail.
 *
 * Now a boot-time task with a single in-flight promise: concurrent callers await
 * the same work, and later callers reuse the settled result rather than
 * re-running it. A failure is not cached, so a transient database error on boot
 * doesn't leave the catalog permanently unseeded for the life of the process.
 */
let seedPromise: Promise<void> | null = null;

export function seedCatalogOnce(): Promise<void> {
  if (!seedPromise) {
    seedPromise = ensureStarterCourses().catch((error: unknown) => {
      // Clear the cache so the next request retries rather than inheriting a
      // failure that happened before the database was reachable.
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

async function ensureStarterCourses(): Promise<void> {
  const titles = new Set(CURRICULUM.map((course) => course.title));

  // Sync the authored content. Student-owned fields (enrolment, progress) are
  // deliberately untouched.
  await Course.bulkWrite(
    CURRICULUM.map((course) => ({
      updateOne: {
        filter: { title: course.title },
        update: {
          $set: {
            category: course.category,
            description: course.description,
            level: course.level,
            modules: toStoredModules(course),
          },
        },
      },
    })),
  );

  const existingTitles = new Set(
    (
      await Course.find({ title: { $in: [...titles] } })
        .select({ title: 1 })
        .lean()
    ).map((course) => course.title),
  );
  const toInsert = CURRICULUM.filter(
    (course) => !existingTitles.has(course.title),
  ).map((course) => ({
    title: course.title,
    category: course.category,
    description: course.description,
    level: course.level,
    modules: toStoredModules(course),
  }));
  if (toInsert.length) {
    // Upsert rather than `insertMany`. Now that `title` is uniquely indexed a
    // plain insert is safe from duplicates, but an upsert also removes the
    // read-then-insert race entirely, so two seeds running concurrently can
    // never both try to create the same course. `ordered: false` lets the rest
    // of the batch land even if one title collides.
    await Course.bulkWrite(
      toInsert.map((course) => ({
        updateOne: {
          filter: { title: course.title },
          update: {
            $setOnInsert: {
              title: course.title,
              category: course.category,
              description: course.description,
              level: course.level,
              modules: course.modules,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    console.log(`Seeded ${toInsert.length} starter course(s).`);
  }

  await pruneRetiredCourses();
}

/**
 * Remove explicitly-retired starter courses, but never one a student is
 * enrolled in.
 *
 * A student's enrolment stores the courseId inline, so deleting a course they
 * are working through would silently orphan their progress. Losing a module of
 * history is a much better failure than an enrolment pointing at nothing.
 */
async function pruneRetiredCourses(): Promise<void> {
  const retired = [...RETIRED_COURSE_TITLES];
  if (!retired.length) return;

  const doomed = await Course.find({ title: { $in: retired } })
    .select({ _id: 1, title: 1 })
    .lean();
  if (!doomed.length) return;

  const enrolledIds = new Set(
    (
      await Progress.find({
        "enrolledCourses.courseId": { $in: doomed.map((c) => String(c._id)) },
      })
        .select({ "enrolledCourses.courseId": 1 })
        .lean()
    ).flatMap((p) => (p.enrolledCourses ?? []).map((c) => c.courseId)),
  );

  const removable = doomed.filter((c) => !enrolledIds.has(String(c._id)));
  const kept = doomed.filter((c) => enrolledIds.has(String(c._id)));

  if (removable.length) {
    await Course.deleteMany({ _id: { $in: removable.map((c) => c._id) } });
    console.log(
      `Retired ${removable.length} course(s): ${removable.map((c) => c.title).join(", ")}`,
    );
  }
  if (kept.length) {
    console.log(
      `Kept retired course(s) still in use: ${kept.map((c) => c.title).join(", ")}`,
    );
  }
}

/**
 * GET /api/dashboard/:studentId
 *
 * Returns the signed-in student's learning progress (enrolled courses,
 * learning speed, weak points, AI test history) plus the course catalog.
 * Owner-only: a student can never read another student's dashboard.
 */
router.get(
  "/:studentId",
  requireAuth,
  async (request, response) => {
    try {
      const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
      const studentId = String(request.params.studentId ?? "").trim();

      if (!studentId) {
        response.status(400).json({ error: "studentId is required." });
        return;
      }
      if (authUser.username !== studentId) {
        response
          .status(403)
          .json({ error: "You can only view your own dashboard." });
        return;
      }

      // Seeding is a boot-time concern now, not a per-request one — see
      // ensureStarterCourses.
      await seedCatalogOnce();
      // Derive course progress on read rather than trusting the stored copy.
      // Chat-time updates are best-effort, so this is what guarantees the
      // dashboard is correct even after a failed background write.
      await refreshEnrollments(authUser.username);

      // First visit: atomically create the blank progress record. An
      // upsert instead of findOne-then-create, so two concurrent first
      // requests can't both try to insert and turn the unique index violation
      // into a spurious 500.
      const progress = await Progress.findOneAndUpdate(
        { studentId },
        { $setOnInsert: { studentId } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const courses = await Course.find().sort({ createdAt: 1 }).lean();

      // Derived on read rather than stored, so "due" is always true at the
      // moment the student looks. A persisted "isDue" flag would be stale the
      // instant the clock passes midnight, which is exactly the bug that makes
      // review queues quietly stop working.
      const dueReviews = dueCards(progress.reviewCards ?? []).map((card) => ({
        topic: card.topic,
        strength: card.strength,
        dueAt: card.dueAt,
        label: dueLabel(card),
      }));

      // The prerequisite that is actually holding the weakest topic up.
      //
      // Weak points alone say "you are bad at transformers", which the student
      // cannot act on. This follows the graph down to the gap underneath, so the
      // dashboard can say "start with matrix multiplication" — something they
      // can do today, and which unblocks the rest.
      const weakTopics = (progress.weakPoints ?? []).map((point) => point.topic);
      const weakestTopic = weakTopics[0];
      const focusRootCause = weakestTopic
        ? rootCauseTopic(weakestTopic, PREREQUISITE_GRAPH, weakTopics)
        : null;

      // "How long were you away", for the dashboard header. Derived from the
      // conversation's own timestamps here because the client has no access to
      // them. Empty for a short break or a brand-new student — `awayLabel`
      // returns "" in both cases rather than inventing a duration.
      const session = await Session.findOne({ studentId })
        .select({ conversationHistory: 1, topicsVisited: 1 })
        .lean();

      // Checkpoint tests the student is owed, per course. Derived on read from
      // the live syllabus and the last recorded test — nothing is scheduled ahead
      // of time and stored, so a checkpoint can't go stale or claim a test is due
      // on a module the student hasn't reached.
      const checkpoints = dueCheckpoints(
        (progress.enrolledCourses ?? []).map((enrollment) => ({
          courseId: enrollment.courseId,
          // Only what the student has actually finished counts toward a test.
          completedModules: enrollment.completedModules ?? [],
        })).map((enrollment) => ({
          ...enrollment,
          modules:
            courses.find((course) => String(course._id) === enrollment.courseId)
              ?.modules ?? [],
        })),
        progress.enrolledCourses ?? [],
        progress.courseTests ?? [],
      ).map((status) => {
        const enrollment = (progress.enrolledCourses ?? []).find(
          (item) => item.courseId === status.courseId,
        );
        return {
          ...status,
          courseTitle: enrollment?.title ?? "This course",
        };
      });

      // Study streak and today's goal.
      //
      // The one part of the learner model that measures habit rather than
      // mastery, and derived on read for the same reason as everything else
      // above: a stored streak is wrong the moment midnight passes. Nothing is
      // written, so there is no background job to fail and no state that can
      // drift from the conversation it claims to describe.
      //
      // Everything it needs is already loaded: the messages carry `at`, the
      // graded tests carry `evaluatedAt`, and `topicsVisited` is the fallback
      // for days whose messages have since rotated out of the capped history.
      const streak = streakFor({
        messages: session?.conversationHistory ?? [],
        testHistory: progress.testHistory ?? [],
        topicsVisited: session?.topicsVisited ?? [],
      });

      response.json({
        progress,
        courses,
        dueReviews,
        focusRootCause,
        checkpoints,
        // `goal` is sent rather than hard-coded in the client so the progress bar
        // is drawn to the same scale the server counted against. Two constants
        // that agree today and drift tomorrow is exactly the bug that makes a
        // goal bar lie.
        streak: { ...streak, goal: DAILY_GOAL_TURNS },
        awayLabel: awayLabel(returnState({ conversation: session?.conversationHistory }).awayMs),
      });
    } catch (error) {
      console.error("Failed to load dashboard.", error);
      response.status(500).json({ error: "Unable to load dashboard." });
    }
  },
);

export default router;

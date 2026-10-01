import { Router } from "express";

import { Course } from "../models/Course";
import { Progress } from "../models/Progress";
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
    await Course.insertMany(toInsert);
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

      await ensureStarterCourses();
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

      response.json({ progress, courses, dueReviews, focusRootCause });
    } catch (error) {
      console.error("Failed to load dashboard.", error);
      response.status(500).json({ error: "Unable to load dashboard." });
    }
  },
);

export default router;

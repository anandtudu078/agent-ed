import { Course, CourseDocument, CourseModule } from "../models/Course";
import { EnrolledCourse, Progress } from "../models/Progress";
import { Session } from "../models/Session";
import CURRICULUM from "../data/curriculum";

/**
 * topic (lowercased) -> the topics that must come first.
 *
 * Built once at module load from the authored curriculum. Modules with no
 * prerequisites are simply absent from the map, which is what makes a missing
 * entry mean "we haven't curated this" rather than "this has no prerequisites".
 */
export const PREREQUISITE_GRAPH: ReadonlyMap<string, readonly string[]> = (() => {
  const graph = new Map<string, readonly string[]>();
  for (const course of CURRICULUM) {
    for (const module of course.modules) {
      if (!module.prerequisites?.length) continue;
      graph.set(normalizeTopic(module.topic), module.prerequisites.map(normalizeTopic));
    }
  }
  return graph;
})();

/** How many modules in the catalog declare prerequisites at all. */
export function prerequisiteCoverage(): { withPrereqs: number; total: number } {
  let withPrereqs = 0;
  let total = 0;
  for (const course of CURRICULUM) {
    for (const module of course.modules) {
      total += 1;
      if (module.prerequisites?.length) withPrereqs += 1;
    }
  }
  return { withPrereqs, total };
}

/**
 * Below this length a topic is too short to safely test with `includes`:
 * "var" is a substring of "variables" and "c" matches almost anything, which
 * would silently complete modules the student never covered.
 */
const MIN_FUZZY_LENGTH = 5;

/**
 * Reduce a topic to a comparable form: lowercase, alphanumeric words only.
 * "Machine Learning!" and "machine   learning" both become "machine learning".
 *
 * Takes `unknown` on purpose. These strings are model output and stored history,
 * not hand-written constants: `topicsVisited` entries and curriculum module
 * topics both arrive from data that only claims to be a string. Calling
 * `.toLowerCase()` on a missing one threw
 * "Cannot read properties of undefined (reading 'toLowerCase')" straight out of
 * `computeCourseProgress`, which meant a single malformed history entry made the
 * whole course un-enrollable — the student got a 500 from a button that had
 * nothing wrong with it. An unusable topic normalizes to "", every caller already
 * treats "" as "no match", and a topic nobody can read is not a topic.
 */
export function normalizeTopic(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heuristic topic match. Exact-after-normalization first, then a containment
 * check in either direction so "machine learning" matches a topic the tutor
 * described as "machine learning basics".
 *
 * This is deliberately fuzzy: the topics come from a language model reading
 * free-text chat, so they will never line up character-for-character with a
 * hand-written syllabus. The trade-off is occasional false positives, which we
 * accept because over-crediting a module is far less harmful than a course
 * that never advances.
 */
export function topicsMatch(moduleTopic: string, visitedTopic: string): boolean {
  const a = normalizeTopic(moduleTopic);
  const b = normalizeTopic(visitedTopic);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < MIN_FUZZY_LENGTH || b.length < MIN_FUZZY_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

export interface CourseProgress {
  completedModules: string[];
  progressPercent: number;
  /** Most recently covered module topic, for the dashboard's subtitle. */
  lastTopic: string;
  /** First module not yet completed — where "Continue Learning" should resume. */
  nextModule: CourseModule | null;
}

/**
 * Derive how far through a course the student is, from the topics they've
 * actually covered in conversation. A module counts as done once the student
 * has discussed its topic, which reuses the memory work from the tutor loop
 * rather than inventing a second source of truth.
 */
export function computeCourseProgress(
  course: Pick<CourseDocument, "modules">,
  topicsVisited: Array<{ topic: string; firstSeenAt: Date }>,
): CourseProgress {
  const modules = course.modules ?? [];
  if (!modules.length) {
    return {
      completedModules: [],
      progressPercent: 0,
      lastTopic: "",
      nextModule: null,
    };
  }

  const completedModules: string[] = [];
  let lastTopic = "";
  let lastSeenAt = 0;

  for (const module of modules) {
    const hit = topicsVisited
      .filter((visit) => topicsMatch(module.topic, visit.topic))
      .sort(
        (a, b) =>
          new Date(b.firstSeenAt ?? 0).getTime() -
          new Date(a.firstSeenAt ?? 0).getTime(),
      )[0];

    if (!hit) continue;
    completedModules.push(module.title);
    const seenAt = new Date(hit.firstSeenAt ?? 0).getTime();
    if (seenAt >= lastSeenAt) {
      lastSeenAt = seenAt;
      lastTopic = hit.topic;
    }
  }

  const done = new Set(completedModules);
  return {
    completedModules,
    progressPercent: Math.round((completedModules.length / modules.length) * 100),
    lastTopic,
    nextModule: modules.find((module) => !done.has(module.title)) ?? null,
  };
}

interface TopicVisitLike {
  topic: string;
  firstSeenAt: Date;
}

/**
 * Stored topics are model output the app wrote on a previous run, and the cast
 * below used to assert they were strings without checking. `computeCourseProgress`
 * then called `.toLowerCase()` on them and took the whole enroll endpoint down
 * with a 500. Drop anything unusable here instead, at the one place the data
 * enters, so `hit.topic` is a real string for every caller downstream.
 */
async function loadVisitedTopics(studentId: string): Promise<TopicVisitLike[]> {
  const session = await Session.findOne({ studentId })
    .select({ topicsVisited: 1 })
    .lean();
  return ((session?.topicsVisited ?? []) as TopicVisitLike[]).filter(
    (visit) => typeof visit?.topic === "string" && visit.topic.trim() !== "",
  );
}

/** Cap so a student can't enroll in hundreds of courses and bloat the doc. */
const MAX_ENROLLMENTS = 25;

/**
 * Enroll a student, or return the existing enrollment untouched if they're
 * already in. Idempotent on purpose: the catalog shows one button that covers
 * both "Start" and "Continue", and a double-click shouldn't create a duplicate.
 */
export async function enrollInCourse(
  studentId: string,
  courseId: string,
): Promise<{ enrollment: EnrolledCourse; created: boolean }> {
  const course = await Course.findById(courseId).lean();
  if (!course) {
    throw new Error("That course no longer exists.");
  }

  const progress = await loadVisitedTopics(studentId);
  const derived = computeCourseProgress(course, progress);

  const enrollment: EnrolledCourse = {
    courseId,
    title: course.title,
    lastTopic: derived.lastTopic,
    progressPercent: derived.progressPercent,
    completedModules: derived.completedModules,
    enrolledAt: new Date(),
  };

  // One atomic conditional update rather than read-then-$push.
  //
  // Reading the array and pushing afterwards left two races the comment above
  // claims are prevented: a double-click could read "not enrolled" twice and
  // push two enrollments, and two concurrent requests could both pass the
  // MAX_ENROLLMENTS check against the same stale count and blow past the cap.
  //
  // Both guards live in the filter, so MongoDB evaluates them atomically against
  // the current document: `courseId: { $ne: courseId }` makes the push a no-op
  // when already enrolled, and `$expr` compares the live array length rather than
  // a value read earlier.
  //
  // Not upserted: an upsert would try to *insert* when the filter misses (already
  // enrolled, or at the cap) and trip the unique index on `studentId`, turning
  // both legitimate outcomes into a 500. The progress row is created on the
  // dashboard load and by the chat path, and `enrollInCourse` is never the first
  // write for a new student.
  const updated = await Progress.findOneAndUpdate(
    {
      studentId,
      "enrolledCourses.courseId": { $ne: courseId },
      $expr: {
        $lt: [{ $size: { $ifNull: ["$enrolledCourses", []] } }, MAX_ENROLLMENTS],
      },
    },
    { $push: { enrolledCourses: enrollment } },
    { new: true },
  ).lean();

  if (updated) {
    return { enrollment, created: true };
  }

  // Nothing was pushed. Either the student is already enrolled (the idempotent
  // case the dashboard's single button depends on) or the cap is reached; re-read
  // to tell those apart rather than guessing which one happened.
  const after = await Progress.findOne({ studentId })
    .select({ enrolledCourses: 1 })
    .lean();
  const alreadyNow = (after?.enrolledCourses ?? []).find(
    (item) => item.courseId === courseId,
  );
  if (alreadyNow) {
    return { enrollment: alreadyNow, created: false };
  }

  throw new Error(
    `You can be enrolled in at most ${MAX_ENROLLMENTS} courses at once.`,
  );
}

export async function unenrollFromCourse(
  studentId: string,
  courseId: string,
): Promise<boolean> {
  // Report whether anything was actually removed, not merely whether the
  // student document came back. `Boolean(result)` was true for every student
  // who had a Progress row at all, so leaving a course you were not enrolled in
  // answered "removed: true" — a client that trusted that would hide a real
  // enrollment after a pull that quietly did nothing.
  const result = await Progress.updateOne(
    { studentId, "enrolledCourses.courseId": courseId },
    { $pull: { enrolledCourses: { courseId } } },
  );
  return (result.modifiedCount ?? 0) > 0;
}

/**
 * Recompute progress for every enrolled course. Called after each tutor turn,
 * because that's the moment new topics land and a module may become complete.
 */
export async function refreshEnrollments(studentId: string): Promise<void> {
  const progress = await Progress.findOne({ studentId })
    .select({ enrolledCourses: 1 })
    .lean();
  const enrolled = progress?.enrolledCourses ?? [];
  if (!enrolled.length) return;

  const visited = await loadVisitedTopics(studentId);
  const courses = await Course.find({
    _id: { $in: enrolled.map((item) => item.courseId) },
  })
    .lean();

  for (const enrollment of enrolled) {
    const course = courses.find(
      (candidate) => String(candidate._id) === enrollment.courseId,
    );
    if (!course) continue;
    const derived = computeCourseProgress(course, visited);
    // Write only when something actually moved, so a chatty student doesn't
    // rewrite every enrollment on every message.
    if (
      derived.progressPercent === enrollment.progressPercent &&
      derived.lastTopic === (enrollment.lastTopic ?? "") &&
      derived.completedModules.length === (enrollment.completedModules ?? []).length
    ) {
      continue;
    }
    await Progress.updateOne(
      { studentId, "enrolledCourses.courseId": enrollment.courseId },
      {
        $set: {
          "enrolledCourses.$.progressPercent": derived.progressPercent,
          "enrolledCourses.$.lastTopic": derived.lastTopic,
          "enrolledCourses.$.completedModules": derived.completedModules,
        },
      },
    );
  }
}

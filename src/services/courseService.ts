import { Course, CourseDocument, CourseModule } from "../models/Course";
import { EnrolledCourse, Progress } from "../models/Progress";
import { Session } from "../models/Session";

/**
 * Below this length a topic is too short to safely test with `includes`:
 * "var" is a substring of "variables" and "c" matches almost anything, which
 * would silently complete modules the student never covered.
 */
const MIN_FUZZY_LENGTH = 5;

/**
 * Reduce a topic to a comparable form: lowercase, alphanumeric words only.
 * "Machine Learning!" and "machine   learning" both become "machine learning".
 */
export function normalizeTopic(value: string): string {
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

async function loadVisitedTopics(studentId: string): Promise<TopicVisitLike[]> {
  const session = await Session.findOne({ studentId })
    .select({ topicsVisited: 1 })
    .lean();
  return (session?.topicsVisited ?? []) as TopicVisitLike[];
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

  const existing = await Progress.findOne({ studentId })
    .select({ enrolledCourses: 1 })
    .lean();
  const already = (existing?.enrolledCourses ?? []).find(
    (item) => item.courseId === courseId,
  );
  if (already) {
    return { enrollment: already, created: false };
  }

  if ((existing?.enrolledCourses ?? []).length >= MAX_ENROLLMENTS) {
    throw new Error(
      `You can be enrolled in at most ${MAX_ENROLLMENTS} courses at once.`,
    );
  }

  const enrollment: EnrolledCourse = {
    courseId,
    title: course.title,
    lastTopic: derived.lastTopic,
    progressPercent: derived.progressPercent,
    completedModules: derived.completedModules,
    enrolledAt: new Date(),
  };

  await Progress.findOneAndUpdate(
    { studentId },
    { $push: { enrolledCourses: enrollment } },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return { enrollment, created: true };
}

export async function unenrollFromCourse(
  studentId: string,
  courseId: string,
): Promise<boolean> {
  const result = await Progress.findOneAndUpdate(
    { studentId },
    { $pull: { enrolledCourses: { courseId } } },
    { new: true },
  ).lean();
  return Boolean(result);
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

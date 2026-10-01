/**
 * Checkpoint tests: testing a *course* at intervals, not just one topic at a time.
 *
 * The gap this fills: the assessment endpoint could test any topic, and the
 * dashboard could start one â€” but nothing tied a test to *where a student is in a
 * course*. So a student halfway through a twelve-module course could take a test on
 * whatever they felt like, and a student who had finished nothing could take six
 * tests on the same first module. Neither number meant anything.
 *
 * A checkpoint is the honest middle: test what's accumulated since you last did.
 * Purely derived â€” every rule below reads the enrollment and the last recorded
 * test and decides what's due. Nothing is scheduled ahead of time and stored, so a
 * checkpoint can't go stale, can't be lost when a course is edited, and can't claim
 * a test is due on a module the student hasn't reached.
 *
 * Pure and clock-injectable, so the intervals are testable without a database.
 */

/** How many completed modules accumulate before a checkpoint becomes due. */
export const CHECKPOINT_INTERVAL = 3;

/** A course shorter than this gets a single test at the end, not intervals. */
export const MIN_MODULES_FOR_INTERVALS = 4;

/** Never claim a student owes more tests than this, however long the course. */
export const MAX_CHECKPOINTS = 4;

export interface CourseTestRecord {
  courseId: string;
  /** Module titles covered by the most recent checkpoint test. */
  testedModules: string[];
  /** 0â€“100, when there was one. */
  score?: number | null;
  testedAt?: Date | null;
}

export interface ModuleLike {
  title: string;
  topic: string;
}

export interface CheckpointStatus {
  courseId: string;
  /** Modules finished but not yet covered by a checkpoint test. */
  untestedModules: ModuleLike[];
  /**
   * True when a checkpoint test is worth taking now: enough new modules have
   * accumulated, or the course is finished with material still untested.
   */
  due: boolean;
  /** How many more completed modules before the next checkpoint comes round. */
  modulesUntilNext: number;
  /** True when every module in the course has been tested. */
  allTested: boolean;
  /** The module a checkpoint test should open on. */
  nextModule: ModuleLike | null;
}

/**
 * Decide whether a course is owed a checkpoint test.
 *
 * `modules` is the live syllabus and `enrollment.completedModules` is what the
 * student has actually finished â€” the two are compared rather than trusted, so a
 * module renamed in the curriculum drops out of both sides instead of counting
 * forever as an untested, untestable module.
 */
export function checkpointStatus(
  courseId: string,
  modules: ModuleLike[],
  completedModules: string[] = [],
  lastTest: CourseTestRecord | null = null,
): CheckpointStatus {
  const done = new Set(completedModules);
  const tested = new Set(lastTest?.testedModules ?? []);

  // Only modules the course still has AND the student has finished.
  const finished = (modules ?? []).filter((module) => done.has(module.title));
  const untested = finished.filter((module) => !tested.has(module.title));

  const allTested =
    (modules ?? []).length > 0 &&
    finished.length >= modules.length &&
    untested.length === 0;

  // A course too short for intervals still deserves one test, once it is finished.
  const intervalable = (modules?.length ?? 0) >= MIN_MODULES_FOR_INTERVALS;

  let due = false;
  let modulesUntilNext = 0;

  if (untested.length) {
    if (!intervalable) {
      // Short course: one test at the end covers it.
      due = finished.length >= modules.length;
      modulesUntilNext = Math.max(0, modules.length - finished.length);
    } else {
      // Enough new material since the last test to be worth asking about.
      due = untested.length >= CHECKPOINT_INTERVAL || allTested;
      modulesUntilNext = Math.max(0, CHECKPOINT_INTERVAL - untested.length);
    }
  } else {
    modulesUntilNext = CHECKPOINT_INTERVAL;
  }

  return {
    courseId,
    untestedModules: untested.slice(0, MAX_CHECKPOINTS),
    due,
    modulesUntilNext,
    allTested,
    // Always the oldest untested module: a checkpoint asks about what has
    // accumulated, and the earliest of that is the part most likely to have been
    // forgotten by the time enough later modules exist to trigger the test.
    nextModule: due && untested.length ? untested[0] : null,
  };
}

/**
 * Every checkpoint the student currently owes, across their courses.
 *
 * Capped per course rather than globally: one long course must not fill the list
 * and hide that a second course has a finished test waiting. The dashboard decides
 * how many of these to show; this only answers "which, and why".
 */
export function dueCheckpoints(
  courses: Array<{ courseId: string; modules: ModuleLike[] }>,
  enrollments: Array<{ courseId: string; completedModules: string[] }>,
  tests: CourseTestRecord[] = [],
): CheckpointStatus[] {
  const byCourse = new Map<string, CourseTestRecord>();
  for (const test of tests ?? []) {
    // Most recent wins: a re-taken test supersedes the earlier one for the same
    // course, and taking them out of order must not resurrect old coverage.
    const existing = byCourse.get(test.courseId);
    const existingAt = existing?.testedAt ? new Date(existing.testedAt).getTime() : 0;
    const candidateAt = test.testedAt ? new Date(test.testedAt).getTime() : 0;
    if (!existing || candidateAt >= existingAt) byCourse.set(test.courseId, test);
  }

  const statuses: CheckpointStatus[] = [];
  for (const enrollment of enrollments ?? []) {
    const course = courses?.find((item) => item.courseId === enrollment.courseId);
    if (!course) continue;
    const status = checkpointStatus(
      enrollment.courseId,
      course.modules,
      enrollment.completedModules,
      byCourse.get(enrollment.courseId) ?? null,
    );
    if (status.due) statuses.push(status);
  }
  return statuses;
}

/**
 * Fold a checkpoint result into the stored record for a course.
 *
 * Union of tested modules rather than a replacement: a checkpoint only covers the
 * modules that had accumulated, so the earlier ones must be remembered. Replacing
 * would make every checkpoint test look like the student's first.
 *
 * `score` is the latest, not the best â€” a checkpoint is a current measure, and
 * reporting a student's best-ever score would hide that they are drifting.
 */
export function mergeCourseTest(
  existing: CourseTestRecord[] = [],
  incoming: CourseTestRecord,
): CourseTestRecord[] {
  const others = (existing ?? []).filter((test) => test.courseId !== incoming.courseId);
  const previous = (existing ?? []).find((test) => test.courseId === incoming.courseId);

  const merged: CourseTestRecord = {
    courseId: incoming.courseId,
    testedModules: Array.from(
      new Set([...(previous?.testedModules ?? []), ...(incoming.testedModules ?? [])]),
    ),
    score: incoming.score ?? previous?.score ?? null,
    testedAt: incoming.testedAt ?? new Date(),
  };

  return [...others, merged];
}

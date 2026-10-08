/**
 * Checkpoint tests: testing a *course* at intervals, not just one topic at a time.
 *
 * The gap this fills: the assessment endpoint could test any topic, and the
 * dashboard could start one — but nothing tied a test to *where a student is in a
 * course*. So a student halfway through a twelve-module course could take a test on
 * whatever they felt like, and a student who had finished nothing could take six
 * tests on the same first module. Neither number meant anything.
 *
 * A checkpoint is the honest middle: test what's accumulated since you last did.
 * Purely derived — every rule below reads the enrollment and the last recorded
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

/**
 * Ceiling on how many modules one checkpoint may claim as covered.
 *
 * A guard on the ticket, not a presentation limit. `untestedModules` is
 * deliberately uncapped so a real course's coverage is recorded truthfully,
 * so the bound that matters is on what may be signed: a hand-edited or
 * forged ticket cannot make the submit path write an unbounded module list
 * into the student's record. Sized above the longest course in the catalog
 * (currently 9) so it never truncates a legitimate checkpoint.
 */
export const MAX_MODULES_COVERED = 12;

export interface CourseTestRecord {
  courseId: string;
  /** Module titles covered by the most recent checkpoint test. */
  testedModules: string[];
  /** 0—100, when there was one. */
  score?: number | null;
  testedAt?: Date | null;
}

export interface ModuleLike {
  title: string;
  topic: string;
}

export interface CheckpointStatus {
  courseId: string;
  /**
   * Modules finished but not yet covered by a checkpoint test.
   *
   * COMPLETE, never truncated. This list is what `/api/assessment/checkpoint`
   * signs into the attempt ticket as `modulesCovered`, and the submit path
   * records exactly that as the student's tested coverage — so a cap here is
   * not a display convenience, it silently decides what counts as tested.
   *
   * It used to be `untested.slice(0, MAX_CHECKPOINTS)`. On a 12-module course
   * that signed 4 titles, so the other 8 were never marked tested, `allTested`
   * could never become true, and `untested.length` stayed above
   * CHECKPOINT_INTERVAL forever — the checkpoint re-armed immediately after
   * every test, with no way for the student to ever clear it. Every course in
   * the catalog is longer than MAX_CHECKPOINTS, so this was reachable by
   * anyone who finished a course without testing midway.
   *
   * Presentation is capped where it belongs, in the dashboard, which already
   * slices to 3 for display.
   */
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
 * student has actually finished — the two are compared rather than trusted, so a
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
  let modulesUntilNext: number;

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
    untestedModules: untested,
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
 * `score` is the latest, not the best — a checkpoint is a current measure, and
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

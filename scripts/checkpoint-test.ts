// Permanent unit tests for course checkpoint tests.
//
// Run: npm run test:checkpoints
//
// The rules decide what a student is told to test and when. Two failure modes are
// worth more than the others, and both are covered explicitly below:
//
//   - asking for a test the student is not ready for, or one covering material
//     they have not reached (which would fail them for knowing less than the app
//     taught them);
//   - asking again for a test they have already passed, because the coverage
//     wasn't remembered — the failure that makes interval testing pointless.
//
// Pure, so no database is needed.

import {
  checkpointStatus,
  dueCheckpoints,
  mergeCourseTest,
  CHECKPOINT_INTERVAL,
  MIN_MODULES_FOR_INTERVALS,
  MAX_MODULES_COVERED,
  type ModuleLike,
} from "../src/services/checkpoints";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const mod = (n: number): ModuleLike => ({ title: `Module ${n}`, topic: `topic ${n}` });
// A ten-module course, comfortably long enough for intervals.
const course: ModuleLike[] = Array.from({ length: 10 }, (_, i) => mod(i + 1));
const done = (upTo: number) => course.slice(0, upTo).map((m) => m.title);

// --- 1. Nothing is due before enough has accumulated --------------------------
const one = checkpointStatus("c1", course, done(1));
check("one finished module is not yet due", !one.due);
check("the untested module is still listed", one.untestedModules.length === 1);

const two = checkpointStatus("c1", course, done(2));
check("two finished modules is still not due", !two.due, `until=${two.modulesUntilNext}`);
check("it says how many more are needed", two.modulesUntilNext === CHECKPOINT_INTERVAL - 2, `until=${two.modulesUntilNext}`);

const three = checkpointStatus("c1", course, done(3));
check(`${CHECKPOINT_INTERVAL} finished modules IS due`, three.due);
check("the untested list is exactly the finished ones", three.untestedModules.length === 3);
// The oldest first: the part most likely forgotten by the time the third arrives.
check("it opens on the oldest untested module", three.nextModule?.title === "Module 1", three.nextModule?.title ?? "");

// --- 2. A new student is never asked to test ---------------------------------
check("a brand-new student owes nothing", !checkpointStatus("c1", course, []).due);
check("a course with no modules owes nothing", !checkpointStatus("c1", [], done(3)).due);

// --- 3. Taking the test clears it --------------------------------------------
const tested = {
  courseId: "c1",
  testedModules: ["Module 1", "Module 2", "Module 3"],
  score: 80,
  testedAt: new Date(),
};
const afterTest = checkpointStatus("c1", course, done(3), tested);
check("a taken checkpoint is no longer due", !afterTest.due, JSON.stringify(afterTest));
check("nothing is left untested after a full test", afterTest.untestedModules.length === 0);
check("a partly-tested course is not reported as all tested", afterTest.allTested === false);

// Continuing past the test re-arms the interval.
const afterMore = checkpointStatus("c1", course, done(5), tested);
check("two more modules is not yet due", !afterMore.due, `until=${afterMore.modulesUntilNext}`);
check("only the new modules are untested", afterMore.untestedModules.length === 2, `n=${afterMore.untestedModules.length}`);
check("three more modules re-arms the checkpoint", checkpointStatus("c1", course, done(6), tested).due);

// --- 4. A short course gets one test at the end, not intervals ---------------
const short = [mod(1), mod(2), mod(3)];
check("a short course is not intervalable", short.length < MIN_MODULES_FOR_INTERVALS);
check("a short course is not due partway", !checkpointStatus("c1", short, done(2)).due);
check("a short course is due once finished", checkpointStatus("c1", short, done(3)).due);
// Exactly at the boundary: four modules is intervalable.
const four = [mod(1), mod(2), mod(3), mod(4)];
check("four modules is intervalable", four.length >= MIN_MODULES_FOR_INTERVALS);
check("a four-module course follows the interval", checkpointStatus("c1", four, done(3)).due);

// --- 5. Renamed modules don't become permanently untestable ------------------
// The stale-title case from the course-progress bug: the stored completion list
// names a module the syllabus no longer has. A stale title must neither be
// counted as untested nor push the course over the interval on its own —
// "Old Name" is not something a student can be examined on.
const renamed = checkpointStatus("c1", course, ["Module 1", "Module 2", "Old Name"]);
check("a stale module title is ignored", renamed.untestedModules.every((m) => m.title !== "Old Name"), renamed.untestedModules.map((m) => m.title).join(","));
check("a stale title alone does not trigger a checkpoint", !renamed.due, `untested=${renamed.untestedModules.length}`);
// With three *real* modules alongside the stale one it is still legitimately due —
// the stale title contributes nothing either way.
check("three real modules still trigger a checkpoint", checkpointStatus("c1", course, ["Module 1", "Module 2", "Module 3", "Old Name"]).due);

// --- 6. A finished course with untested material is always due --------------
check("finishing a course with untested modules is due", checkpointStatus("c1", course, done(10)).due);
check("a fully tested finished course owes nothing", !checkpointStatus("c1", course, done(10), {
  courseId: "c1",
  testedModules: course.map((m) => m.title),
}).due);

// --- 7. Coverage is never truncated ------------------------------------------
// The regression that mattered. `untestedModules` used to be sliced to
// MAX_CHECKPOINTS, and this list is what /api/assessment/checkpoint signs as
// `modulesCovered` and what /submit then records as tested. So on any course
// longer than the cap, taking the test marked only the first few modules
// covered, the rest stayed untested forever, and `untested.length` never fell
// below CHECKPOINT_INTERVAL — the checkpoint re-armed the instant the student
// finished it, with no way to clear it. Every course in the catalog is longer
// than the old cap, so this was reachable by anyone.
const longCourse = Array.from({ length: 12 }, (_, i) => mod(i + 1));
const longDone = longCourse.map((m) => m.title);
const long = checkpointStatus("c1", longCourse, longDone);
check("every finished module is listed, not just the first few", long.untestedModules.length === 12, `n=${long.untestedModules.length}`);

// The full loop, through the same calls the route makes: sign the coverage,
// record it, then ask again. The debt must clear.
const coveredAll = long.untestedModules.map((m) => m.title);
const afterFullLoop = checkpointStatus(
  "c1",
  longCourse,
  longDone,
  mergeCourseTest([], {
    courseId: "c1",
    testedModules: coveredAll,
    score: 80,
    testedAt: new Date(),
  })[0],
);
check("a finished course clears once all of it is covered", !afterFullLoop.due, `until=${afterFullLoop.modulesUntilNext}`);
check("nothing is left untested", afterFullLoop.untestedModules.length === 0, `n=${afterFullLoop.untestedModules.length}`);
check("and it reports as fully tested", afterFullLoop.allTested === true);

// The signing guard is the only bound, and it must sit above the longest real
// course (currently 9) so a legitimate checkpoint is never truncated.
const gigantic = Array.from({ length: 60 }, (_, i) => mod(i + 1));
const giganticStatus = checkpointStatus("c1", gigantic, gigantic.map((m) => m.title));
check("a 60-module course reports all of them to the caller", giganticStatus.untestedModules.length === 60, `n=${giganticStatus.untestedModules.length}`);
check("the signing bound covers the longest real course", MAX_MODULES_COVERED >= 12, `bound=${MAX_MODULES_COVERED}`);
check("and is still a real bound, not unbounded", MAX_MODULES_COVERED < 60);

// --- 8. Across several courses ----------------------------------------------
const twoCourses = dueCheckpoints(
  [
    { courseId: "c1", modules: course },
    { courseId: "c2", modules: course },
  ],
  [
    { courseId: "c1", completedModules: done(1) },
    { courseId: "c2", completedModules: done(5) },
  ],
  [],
);
check("only the course that is actually due appears", twoCourses.length === 1, `n=${twoCourses.length}`);
check("and it is the right course", twoCourses[0]?.courseId === "c2", twoCourses[0]?.courseId ?? "");

check("an unknown course in an enrollment is skipped", dueCheckpoints([], [{ courseId: "ghost", completedModules: done(5) }], []).length === 0);
check("no courses means no checkpoints", dueCheckpoints([], [], []).length === 0);

// The most recent test per course wins — otherwise an old, generous test record
// could mask a recent failure and hide a checkpoint that is genuinely owed.
const reordered = dueCheckpoints(
  [{ courseId: "c1", modules: course }],
  [{ courseId: "c1", completedModules: done(6) }],
  [
    { courseId: "c1", testedModules: course.map((m) => m.title), testedAt: new Date(2000, 0, 1) },
    { courseId: "c1", testedModules: [], testedAt: new Date(2020, 0, 1) },
  ],
);
check("the most recent test wins, not the most generous", reordered.length === 1, `n=${reordered.length}`);

// --- 9. Folding results ------------------------------------------------------
const merged = mergeCourseTest([], { courseId: "c1", testedModules: ["A", "B"], score: 70, testedAt: new Date() });
check("a first test is stored", merged.length === 1 && merged[0].testedModules.length === 2);

const mergedAgain = mergeCourseTest(merged, { courseId: "c2", testedModules: ["B", "C"], score: 85, testedAt: new Date() });
check("a different course gets its own record", mergedAgain.length === 2);

const mergedSame = mergeCourseTest(merged, { courseId: "c1", testedModules: ["B", "C"], score: 85, testedAt: new Date() });
check("a second test merges rather than replaces", mergedSame.length === 1, `n=${mergedSame.length}`);
check("coverage is the union, deduplicated", mergedSame[0].testedModules.sort().join(",") === "A,B,C", mergedSame[0].testedModules.join(","));
check("the latest score wins, not the best", mergedSame[0].score === 85, `score=${mergedSame[0].score}`);

// The full loop: taking tests clears the debt.
let tests = [] as ReturnType<typeof mergeCourseTest>;
tests = mergeCourseTest(tests, {
  courseId: "c1",
  testedModules: ["Module 1", "Module 2", "Module 3"],
  score: 80,
  testedAt: new Date(),
});
check("after the first test the checkpoint clears", dueCheckpoints(
  [{ courseId: "c1", modules: course }],
  [{ courseId: "c1", completedModules: done(3) }],
  tests,
).length === 0);

// A course with no prior record is still judged from scratch.
check("a course with no test history is judged from scratch", dueCheckpoints(
  [{ courseId: "c1", modules: course }],
  [{ courseId: "c1", completedModules: done(4) }],
  [],
).length === 1);

// Degenerate input must not throw — this runs on every dashboard load.
check("no enrollments means no checkpoints", dueCheckpoints([{ courseId: "c1", modules: course }], [], []).length === 0);
check("an empty syllabus is not due", !checkpointStatus("c1", [], ["a"]).due);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;

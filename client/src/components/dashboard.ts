// Student Learning Dashboard — the personalized learning hub. Shows the
// student's progress analytics (learning speed, weak points, AI test
// feedback/recommended focus), a quick action for starting an AI evaluation
// test, and a searchable course catalog with Continue Learning actions.

import { buildCourseNotesHtml, printCourseNotesPdf } from "./notes";
import { matchSubtopic, subtopicPrompt } from "./subtopics";
import { buildAlerts, type LearningAlert } from "./alerts";
import { celebrate } from "./celebration";

export interface CourseInfo {
  _id: string;
  title: string;
  category: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced";
  /**
   * `subtopics` is optional on purpose, even though the server always sends the
   * key. It was added after the catalog was first seeded, so a course stored
   * before it — or a payload from a server that predates it — has no such
   * field, and the detail view renders a module without one perfectly well.
   * Typing it as required would push that defence into every call site for a
   * shape we cannot guarantee across versions.
   */
  modules: Array<{ title: string; topic: string; subtopics?: string[] }>;
}

export interface TestEvaluation {
  topic: string;
  score: number;
  feedback: string;
  recommendedFocus: string;
  evaluatedAt: string;
}

export interface ProgressInfo {
  enrolledCourses: Array<{
    courseId: string;
    title: string;
    lastTopic: string;
    progressPercent: number;
    completedModules: string[];
  }>;
  learningSpeed: number; // concepts/week
  weakPoints: Array<{ topic: string; strength: number }>;
  testHistory: TestEvaluation[];
}

export interface DashboardData {
  progress: ProgressInfo;
  courses: CourseInfo[];
  /** Concepts whose review has come round. Derived server-side on read. */
  dueReviews: Array<{ topic: string; strength: number; dueAt: string; label: string }>;
  /**
   * The prerequisite underneath the student's weakest topic, if the curriculum
   * knows of one. Null when the gap isn't rooted in a known prerequisite, or
   * when there is nothing to route.
   */
  focusRootCause: string | null;
  /**
   * Checkpoint tests this student is owed, per course. Derived server-side on read
   * from the live syllabus and the last test taken, so nothing here can be stale.
   */
  checkpoints: Array<{
    courseId: string;
    courseTitle: string;
    /** Finished modules not yet covered by a checkpoint test. */
    untestedModules: Array<{ title: string; topic: string }>;
    due: boolean;
    modulesUntilNext: number;
    allTested: boolean;
    nextModule: { title: string; topic: string } | null;
  }>;
  /**
   * How long the student has been away, phrased for display ("Away 3 days").
   * Empty for a short break or when we genuinely don't know — see `awayLabel`,
   * which was written for this and previously had no caller.
   */
  awayLabel: string;
  /**
   * Study streak and today's goal, derived server-side on read.
   *
   * Optional because a payload from a server that predates the streak has no
   * such field, and the dashboard opens on a phone over a school network where
   * an older cached bundle is entirely plausible. The card renders its "nothing
   * to report yet" state rather than being absent, so a version mismatch costs
   * one missing card and not a broken dashboard.
   */
  streak?: StreakInfo;
}

/**
 * The habit side of the learner model.
 *
 * Every other number on this page is about mastery; these are about showing up.
 * `message` is written server-side because the tone rules — never scolding a
 * student who has fallen behind, never zeroing a streak at midnight — are the
 * part worth testing, and testing them in the browser would be testing a copy.
 */
export interface StreakInfo {
  /** Consecutive active days ending today or yesterday. */
  current: number;
  /** Longest run of consecutive active days ever recorded. */
  longest: number;
  /** Days since the student was last active. Null when there is no history. */
  lastActiveDaysAgo: number | null;
  studiedToday: boolean;
  todayTurns: number;
  /** Turns still wanted today; never negative. */
  turnsToGoal: number;
  goalMet: boolean;
  /** The one line to show, already phrased. */
  message: string;
  /** Turns that make a day count. Sent so the bar can be drawn to scale. */
  goal: number;
}

const LEVEL_STYLES: Record<CourseInfo["level"], string> = {
  beginner: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  intermediate: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  advanced: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:3000";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** True when the student has asked the system not to animate anything. */
function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Shimmer bars for the moment before the payload lands.
 *
 * Spans with `display:block` rather than divs, because three of these cards are
 * `<p>` elements and a `<p>` may only hold phrasing content — the browser
 * hoists an out-of-place div out of the paragraph and quietly restructures the
 * card. Same constraint, and the same solution, as the markdown renderer.
 *
 * The widths taper so the placeholder reads as the shape of the text that is
 * coming rather than as three identical grey bricks.
 */
function skeletonLines(widths: number[]): string {
  return widths
    .map(
      (width) =>
        `<span class="mb-2 block h-3 animate-pulse rounded-full bg-slate-800" style="width:${width}%"></span>`,
    )
    .join("");
}

/**
 * Fill every bar marked with `data-bar-width` on the next frame.
 *
 * The bar is authored at zero and only given its real width once it is in the
 * document, because a transition needs somewhere to start from: a width set in
 * the same tick as the insertion has no previous value to animate away from,
 * and the bar simply appears full. Under reduced motion the width is still set
 * — the information is the point, only the interpolation is skipped.
 */
function fillBars(root: HTMLElement): void {
  const bars = root.querySelectorAll<HTMLElement>("[data-bar-width]");
  if (!bars.length) return;
  const apply = (): void => {
    for (const bar of bars) {
      bar.style.width = `${bar.dataset.barWidth ?? "0"}%`;
      bar.removeAttribute("data-bar-width");
    }
  };
  if (reducedMotion()) apply();
  else requestAnimationFrame(() => requestAnimationFrame(apply));
}

/**
 * Count a score up to its final value instead of snapping to it.
 *
 * Only the number moves: the label around it is written by the caller, so a
 * student who glances away still reads the right value the instant it renders.
 * Runs once per element per value — a background refresh that lands the same
 * score re-renders it silently rather than re-running the animation under the
 * student's eyes.
 */
function countTo(el: HTMLElement, value: number, suffix: string): void {
  const previous = Number(el.dataset.counted ?? "0");
  el.dataset.counted = String(value);
  if (reducedMotion() || previous === value) {
    el.textContent = `${value}${suffix}`;
    return;
  }
  const start = performance.now();
  const duration = 700;
  const step = (now: number): void => {
    const progress = Math.min(1, (now - start) / duration);
    // ease-out cubic: fast start, gentle landing — a number that drifts into
    // place reads as a measurement, one that snaps reads as a label.
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(previous + (value - previous) * eased);
    el.textContent = `${current}${suffix}`;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function createDashboard(
  host: HTMLElement,
  studentId: string,
  onSelectCourse: (
    course: CourseInfo,
    nextModule?: CourseInfo["modules"][number] | null,
  ) => void,
  /** Sends the student back to the tutor on a topic the test just flagged. */
  onDiscussTopic?: (topic: string) => void,
  /**
   * Opens the tutor on a topic or subtopic the student deliberately chose.
   *
   * Separate from `onDiscussTopic` because the intent differs: that one follows a
   * grade ("we just found your weak area"), this one follows a request ("I want to
   * learn this"). Same destination, different framing — and the tutor prompt says
   * which, so the owl does not sound as though it is scolding someone who simply
   * asked a question.
   */
  onLearnTopic?: (topicOrCourse: string) => void,
  /**
   * Fired when an answer is graded, with the score. The owl uses this to react
   * — a character that congratulates you but never acknowledges a wrong answer
   * feels like it's not actually watching.
   */
  onGraded?: (score: number) => void,
  /**
   * The student's teaching language, read at the moment of use rather than
   * captured at construction. The toggle can fire while the dashboard is already
   * mounted, and a downloaded notes file that silently came out in the other
   * language would be a small, confusing betrayal.
   */
  getLanguage?: () => "en" | "hi",
): { refresh: () => Promise<void>; destroy: () => void } {
  let data: DashboardData | null = null;
  let loading = false;
  let refreshQueued = false;
  let destroyed = false;
  /**
   * What the daily goal looked like on the last render, so a burst can fire on
   * the *transition* into "met" and never on a refresh that simply restates it.
   * `null` means nothing has been seen yet: the first payload is a fact about
   * the past, not something the student just did.
   */
  let goalMetBefore: boolean | null = null;
  host.innerHTML = `
    <div class="h-full overflow-y-auto px-4 py-6 scroll-smooth">
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <!-- Header: plain language, no jargon box -->
        <div>
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            Your <span class="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">learning</span>
          </h1>
          <p class="dash-pace-line mt-1 text-sm text-slate-400">${skeletonLines([70, 45])}</p>
        </div>

        <!-- THE one thing to do next. Everything else is secondary. -->
        <section class="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/60 to-violet-950/40 p-5">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-indigo-300/80">What to do next</p>
          <h2 class="dash-next-headline mt-1.5 text-lg font-bold leading-snug text-slate-50">${skeletonLines(
            [85, 60],
          )}</h2>
          <p class="dash-next-detail mt-1.5 text-sm leading-relaxed text-slate-300">${skeletonLines(
            [95, 75],
          )}</p>
          <button
            type="button"
            class="dash-start-test mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >…</button>
        </section>

        <!--
          Study streak and today's goal. Above the alerts, because it answers a
          different question: not "what do I need to learn" but "am I showing up".
          Every other card on this page is derived from mastery, and a student can
          have a perfect mastery profile and still not be coming back.
        -->
        <div class="dash-streak"></div>

        <!--
          Alerts first, above the numbers. Everything below this panel is
          evidence — pace, focus areas, the review list — and an alert is the
          conclusion drawn from that evidence. Putting it after the statistics
          would mean a student scrolls past three numbers before finding out that
          something is actually due.
        -->
        <div class="dash-alerts space-y-2"></div>

        <!--
          Checkpoint tests, between the alerts and the statistics. A due test is
          time-sensitive in the same way a review is, so it belongs with the alerts
          rather than buried under "Your last check".
        -->
        <div class="dash-checkpoints space-y-2"></div>

        <!-- At a glance: three numbers, each in plain words -->
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-3">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Pace</p>
            <p class="dash-speed mt-1 text-sm font-bold leading-tight text-indigo-300">…</p>
          </div>
          <div class="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-3">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Focus areas</p>
            <p class="dash-focus-count mt-1 text-sm font-bold leading-tight text-amber-300">…</p>
          </div>
          <div class="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-3">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Last check</p>
            <p class="dash-last-score mt-1 text-sm font-bold leading-tight text-slate-200">…</p>
          </div>
        </div>

        <!-- Spaced repetition: what has come round for review today. This is
             the whole point of the schedule — a list of gaps that never comes
             back is a diagnosis, not a habit. -->
        <div class="dash-reviews rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Review today</h2>
          <p class="dash-reviews-body mt-3 text-sm text-slate-400">${skeletonLines([90, 55])}</p>
        </div>

        <!-- Focus areas: only the few that matter, in plain words -->
        <div class="dash-weakpoints rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Focus areas</h2>
          <p class="dash-weakpoints-body mt-3 text-sm text-slate-400">${skeletonLines([80, 40])}</p>
        </div>

        <!-- Latest result, condensed to what the student can act on -->
        <div class="dash-feedback rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Your last check</h2>
          <p class="dash-feedback-body mt-3 text-sm text-slate-400">${skeletonLines([85, 65])}</p>
        </div>

        <!-- AI evaluation panel (opened by the quick action above) -->
        <section
          id="dash-test-panel"
          class="animate-fadeup hidden rounded-2xl border border-slate-800 bg-slate-900 p-5"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">
                AI evaluation
              </h2>
              <p class="dash-test-topic mt-1 truncate text-xs font-medium text-indigo-300"></p>
            </div>
            <button
              type="button"
              class="dash-test-close shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
            >
              Close
            </button>
          </div>

          <p
            class="dash-test-question mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm leading-relaxed text-slate-200"
          ></p>

          <label class="sr-only" for="dash-test-answer">Your answer</label>
          <textarea
            id="dash-test-answer"
            rows="4"
            class="dash-test-answer mt-3 w-full resize-y rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            placeholder="Explain it in your own words — that's what's being assessed, not wording."
          ></textarea>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="dash-test-submit rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Submit answer
            </button>
            <button
              type="button"
              class="dash-test-skip rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
            >
              Skip
            </button>
          </div>

          <div class="dash-test-result mt-4 hidden"></div>
        </section>

        <!-- Course catalog -->
        <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">
                Your courses
              </h2>
              <p class="mt-0.5 text-xs text-slate-500">
                You're learning these. Pick up where you left off.
              </p>
            </div>
            <label class="relative block">
              <span class="sr-only">Search courses</span>
              <input
                type="search"
                class="dash-search w-48 rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2 text-sm placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Search…"
              />
            </label>
          </div>
          <div class="dash-courses mt-4 grid gap-3 sm:grid-cols-2">${Array.from(
            { length: 4 },
            () =>
              `<div class="animate-pulse rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div class="h-3.5 w-2/3 rounded-full bg-slate-800"></div>
                <div class="mt-3 h-2.5 w-full rounded-full bg-slate-800/70"></div>
                <div class="mt-2 h-2.5 w-4/5 rounded-full bg-slate-800/70"></div>
                <div class="mt-4 h-8 w-full rounded-lg bg-slate-800/60"></div>
              </div>`,
          ).join("")}</div>
        </div>

        <p class="dash-status min-h-[1.25rem] text-sm text-rose-400"></p>
      </div>
    </div>

    <!--
      Course detail. A dialog rather than a route, because the dashboard is the
      only place a course is chosen from and the student is never deep enough in
      to need a back button or a link they could share — a course has no state
      outside this session's progress, which is already on the server.

      Rendered empty and filled on open, rather than once at build time, so a
      186-module catalog costs nothing until a single course is actually looked
      at. Starts hidden via a class rather than being absent, because the element
      has to be queryable before it can be shown.
    -->
    <div
      class="course-detail fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-detail-title"
    >
      <div
        class="course-detail-panel flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div class="flex items-start justify-between gap-4 border-b border-slate-800 p-5">
          <div class="min-w-0">
            <p class="course-detail-category text-[10px] font-semibold uppercase tracking-widest text-indigo-300/80"></p>
            <h2
              id="course-detail-title"
              class="course-detail-title mt-1 text-xl font-bold leading-snug text-slate-50"
            ></h2>
          </div>
          <button
            type="button"
            class="course-detail-close shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Close course details"
          >
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        <div class="course-detail-body flex-1 overflow-y-auto p-5"></div>

        <div class="course-detail-foot space-y-2 border-t border-slate-800 p-4">
          <!--
            Notes are a secondary action, so they sit above the primary button
            rather than beside it: a student opening the dialog to start a lesson
            should not have two equally-weighted buttons to choose between. The
            download needs no enrolment and no round trip — the syllabus is
            already in the payload this dialog rendered from.

            The label names the format, because it opens a print dialog with
            "Save as PDF" rather than writing a file behind the student's back.
            A button that says PDF and then asks where to save it is a small
            surprise; a button that says exactly what will happen is not.
          -->
          <button
            type="button"
            class="course-detail-notes w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-indigo-500/50 hover:bg-slate-800 hover:text-white active:scale-[0.99]"
          >
            Download notes (PDF)
          </button>
          <button
            type="button"
            class="course-detail-start w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99]"
          >
            Start learning
          </button>
        </div>
      </div>
    </div>`;

  const alertsEl = host.querySelector<HTMLElement>(".dash-alerts")!;
  const checkpointEl = host.querySelector<HTMLElement>(".dash-checkpoints")!;
  const streakEl = host.querySelector<HTMLElement>(".dash-streak")!;

  /** Tone → colours. One place, so an alert can't look like a random badge. */
  const ALERT_TONES: Record<LearningAlert["tone"], string> = {
    due: "border-amber-500/40 bg-amber-500/10",
    warning: "border-rose-500/40 bg-rose-500/10",
    success: "border-emerald-500/40 bg-emerald-500/10",
    info: "border-indigo-500/40 bg-indigo-500/10",
  };
  const ALERT_ACCENTS: Record<LearningAlert["tone"], string> = {
    due: "text-amber-300",
    warning: "text-rose-300",
    success: "text-emerald-300",
    info: "text-indigo-300",
  };
  const ALERT_ICONS: Record<LearningAlert["tone"], string> = {
    due: "⏰",
    warning: "◎",
    success: "✓",
    info: "→",
  };

  /**
   * Render the alerts for the current data.
   *
   * `buildAlerts` already caps and orders them, so this only has to draw. The
   * button carries the action and its target as data attributes rather than via a
   * closure per alert — the list is re-rendered on every refresh, and a handler
   * bound per render is a handler that leaks per refresh.
   */
  function renderAlerts(): void {
    if (!data) return;
    const alerts = buildAlerts({
      dueReviews: data.dueReviews ?? [],
      weakPoints: data.progress.weakPoints ?? [],
      enrolledCourses: data.progress.enrolledCourses ?? [],
      // The course list is the authority on how many modules a course has. Using
      // the stored completedModules length instead would let a stale title from a
      // renamed module report a half-finished course as done.
      courseSizes: Object.fromEntries(
        (data.courses ?? []).map((course) => [course._id, (course.modules ?? []).length]),
      ),
      testHistory: data.progress.testHistory ?? [],
      learningSpeed: data.progress.learningSpeed ?? 0,
      awayLabel: data.awayLabel ?? "",
      language: getLanguage?.() ?? "en",
    });

    alertsEl.innerHTML = alerts
      .map(
        (alert, index) => `
        <div class="animate-fadeup flex items-start gap-3 rounded-2xl border p-4 ${ALERT_TONES[alert.tone]}" data-alert-id="${esc(alert.id)}" style="animation-delay:${index * 70}ms">
          <span class="mt-0.5 shrink-0 text-base ${ALERT_ACCENTS[alert.tone]}" aria-hidden="true">${ALERT_ICONS[alert.tone]}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold ${ALERT_ACCENTS[alert.tone]}">${esc(alert.title)}</p>
            <p class="mt-0.5 text-xs leading-relaxed text-slate-300">${esc(alert.body)}</p>
          </div>
          <button
            type="button"
            class="dash-alert-action shrink-0 self-center rounded-lg border border-slate-600/70 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-indigo-400 hover:text-white"
            data-alert-kind="${esc(alert.action.kind)}"
            data-alert-target="${esc(alert.action.target ?? "")}"
          >${esc(alert.action.label)}</button>
        </div>`,
      )
      .join("");
  }

  /**
   * Do what an alert's button says.
   *
   * Every branch routes into something the student already does elsewhere — the
   * review panel, the assessment panel, the course dialog, or the chat. An alert
   * that opened a dead end would be worse than no alert, because the student
   * clicked it on purpose.
   */
  function runAlertAction(
    kind: LearningAlert["action"]["kind"],
    target: string,
  ): void {
    switch (kind) {
      case "review": {
        // No visibility call: the dashboard is by definition already on screen when
        // one of its alerts is pressed, and it may not be mounted at all if the
        // student dismissed it — so don't reach for a control we don't own.
        const first = data?.dueReviews?.[0];
        if (first?.topic) void startAssessment(first.topic);
        return;
      }
      case "test": {
        if (!target) return;
        void startAssessment(target);
        return;
      }
      case "course": {
        if (!target) return;
        const course = data?.courses?.find((item) => item._id === target);
        if (!course) return;
        openCourseDetail(course, null);
        return;
      }
      case "learn-topic": {
        // No specific topic to open, so hand the choice to the student rather than
        // guessing one — an alert that starts a lesson they didn't ask for is the
        // wrong kind of eager.
        onLearnTopic?.(target || "");
        return;
      }
      default:
        return;
    }
  }

  const statusEl = host.querySelector<HTMLElement>(".dash-status")!;
  const speedEl = host.querySelector<HTMLElement>(".dash-speed")!;
  const paceLineEl = host.querySelector<HTMLElement>(".dash-pace-line")!;
  const focusCountEl = host.querySelector<HTMLElement>(".dash-focus-count")!;
  const lastScoreEl = host.querySelector<HTMLElement>(".dash-last-score")!;
  const nextHeadlineEl = host.querySelector<HTMLElement>(".dash-next-headline")!;
  const nextDetailEl = host.querySelector<HTMLElement>(".dash-next-detail")!;
  /** The current recommendation, so the button knows what it is proposing. */
  let nextStep: NextStep | null = null;
  const weakEl = host.querySelector<HTMLElement>(".dash-weakpoints-body")!;
  const reviewsEl = host.querySelector<HTMLElement>(".dash-reviews-body")!;
  const feedbackEl = host.querySelector<HTMLElement>(".dash-feedback-body")!;
  const coursesEl = host.querySelector<HTMLElement>(".dash-courses")!;
  const courseDetailEl = host.querySelector<HTMLElement>(".course-detail")!;
  const courseDetailCategoryEl = host.querySelector<HTMLElement>(
    ".course-detail-category",
  )!;
  const courseDetailTitleEl = host.querySelector<HTMLElement>(".course-detail-title")!;
  const courseDetailBodyEl = host.querySelector<HTMLElement>(".course-detail-body")!;
  const courseDetailStartBtn = host.querySelector<HTMLButtonElement>(
    ".course-detail-start",
  )!;
  const courseDetailNotesBtn = host.querySelector<HTMLButtonElement>(
    ".course-detail-notes",
  )!;
  const courseDetailCloseBtn = host.querySelector<HTMLButtonElement>(
    ".course-detail-close",
  )!;
  const searchEl = host.querySelector<HTMLInputElement>(".dash-search")!;
  const startTestBtn = host.querySelector<HTMLButtonElement>(".dash-start-test")!;
  const testPanelEl = host.querySelector<HTMLElement>("#dash-test-panel")!;
  const testTopicEl = host.querySelector<HTMLElement>(".dash-test-topic")!;
  const testQuestionEl = host.querySelector<HTMLElement>(".dash-test-question")!;
  const testAnswerEl = host.querySelector<HTMLTextAreaElement>(".dash-test-answer")!;
  const testSubmitBtn = host.querySelector<HTMLButtonElement>(".dash-test-submit")!;
  const testSkipBtn = host.querySelector<HTMLButtonElement>(".dash-test-skip")!;
  const testCloseBtn = host.querySelector<HTMLButtonElement>(".dash-test-close")!;
  const testResultEl = host.querySelector<HTMLElement>(".dash-test-result")!;

  /**
   * Drop the loading placeholders when the first fetch failed.
   *
   * Left alone, the shimmer would pulse forever and read as "still working" —
   * the one state an error must never look like. The status line below carries
   * the real reason, so the placeholders get out of its way.
   */
  function clearSkeletons(): void {
    paceLineEl.textContent = "";
    nextHeadlineEl.textContent = "";
    nextDetailEl.textContent = "";
    reviewsEl.textContent = "";
    weakEl.textContent = "";
    feedbackEl.textContent = "";
    coursesEl.innerHTML = "";
  }

  /** Token for the in-flight question; blank when no attempt is open. */
  let attemptToken = "";
  let testTopic = "";
  let testBusy = false;

  /**
   * The session lives in an httpOnly cookie, so there is no token to attach.
   * `X-Requested-With` is the CSRF header the API requires on writes; `credentials`
   * makes the browser send the cookie.
   */
  function authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Requested-With": "AgentEd",
    };
  }

  function setTestStatus(message: string): void {
    statusEl.textContent = message;
  }

  /** Single place that keeps every control's enabled state in sync. */
  function setTestBusy(busy: boolean, loadingLabel = "Loading…"): void {
    testBusy = busy;
    startTestBtn.disabled = busy;
    testSubmitBtn.disabled = busy || !attemptToken;
    // Only talk about grading once there's actually something to submit.
    testSubmitBtn.textContent =
      attemptToken && busy ? loadingLabel : "Submit answer";
    testSkipBtn.disabled = busy;
    testAnswerEl.readOnly = busy;
  }

  function scoreTone(score: number): { badge: string; bar: string } {
    if (score >= 80) {
      return { badge: "text-emerald-300 bg-emerald-500/10 border-emerald-500/40", bar: "bg-emerald-500" };
    }
    if (score >= 60) {
      return { badge: "text-amber-300 bg-amber-500/10 border-amber-500/40", bar: "bg-amber-500" };
    }
    return { badge: "text-rose-300 bg-rose-500/10 border-rose-500/40", bar: "bg-rose-500" };
  }

  function renderTestResult(evaluation: TestEvaluation): void {
    const tone = scoreTone(evaluation.score);
    const score = Math.min(100, Math.max(0, evaluation.score));
    testResultEl.innerHTML = `
      <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="rounded-full border px-2.5 py-0.5 text-xs font-bold ${tone.badge}">
            ${score}% · ${esc(evaluation.topic)}
          </span>
          ${
            evaluation.recommendedFocus
              ? `<span class="text-xs text-slate-400">Focus next: <span class="font-medium text-slate-200">${esc(evaluation.recommendedFocus)}</span></span>`
              : ""
          }
        </div>
        <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div class="h-full rounded-full transition-[width] duration-700 ${tone.bar}" style="width:0" data-bar-width="${score}"></div>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-slate-300">${esc(evaluation.feedback)}</p>
        ${
          onDiscussTopic && evaluation.recommendedFocus
            ? `<button
                 type="button"
                 data-discuss-topic="${esc(evaluation.recommendedFocus)}"
                 class="dash-test-discuss mt-4 rounded-xl border border-indigo-500/50 bg-indigo-500/10 px-4 py-2.5 text-sm font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
               >
                 Work on this with the tutor
               </button>`
            : ""
        }
      </div>`;
    testResultEl.classList.remove("hidden");
    fillBars(testResultEl);
  }


  /** Open the panel and ask the server for a diagnostic question. */
  async function startAssessment(topic?: string): Promise<void> {
    if (testBusy) return;
    testPanelEl.classList.remove("hidden");
    testResultEl.classList.add("hidden");
    testResultEl.innerHTML = "";
    testAnswerEl.value = "";
    setTestStatus("");
    setTestBusy(true);
    testTopicEl.textContent = topic ? `Topic: ${topic}` : "Finding your weakest area…";
    testQuestionEl.textContent = "";

    try {
      const res = await fetch(`${SERVER_URL}/api/assessment/start`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(topic ? { topic } : {}),
      });
      const body = (await res.json()) as {
        attemptToken?: string;
        topic?: string;
        question?: string;
        error?: string;
      };
      if (!res.ok || !body.attemptToken || !body.question) {
        throw new Error(body.error ?? "Could not start an evaluation.");
      }
      attemptToken = body.attemptToken;
      testTopic = body.topic ?? topic ?? "";
      testTopicEl.textContent = `Topic: ${testTopic}`;
      testQuestionEl.textContent = body.question;
      testAnswerEl.focus();
    } catch (error) {
      attemptToken = "";
      testPanelEl.classList.add("hidden");
      setTestStatus(
        error instanceof Error ? error.message : "Could not start an evaluation.",
      );
    } finally {
      setTestBusy(false);
    }
  }

  async function submitAssessment(): Promise<void> {
    if (testBusy || !attemptToken) return;
    const answer = testAnswerEl.value.trim();
    if (!answer) {
      setTestStatus("Please write an answer first.");
      testAnswerEl.focus();
      return;
    }

    setTestStatus("");
    setTestBusy(true, "Grading…");
    try {
      const res = await fetch(`${SERVER_URL}/api/assessment/submit`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ attemptToken, answer }),
      });
      const body = (await res.json()) as { evaluation?: TestEvaluation; error?: string };
      if (!res.ok || !body.evaluation) {
        throw new Error(body.error ?? "Could not grade that answer.");
      }
      attemptToken = "";
      renderTestResult(body.evaluation);
      onGraded?.(body.evaluation.score);
      // Pull fresh analytics so the weak-points and speed cards reflect the test.
      await refresh();
    } catch (error) {
      setTestStatus(
        error instanceof Error ? error.message : "Could not grade that answer.",
      );
    } finally {
      setTestBusy(false);
    }
  }

  /** Enroll, then hand the course (and where to resume) back to main.ts. */
  async function startCourse(course: CourseInfo): Promise<void> {
    const enrolled = data?.progress.enrolledCourses.find(
      (item) => item.courseId === course._id,
    );

    // Already enrolled: just resume the next incomplete module.
    if (enrolled) {
      const done = new Set(enrolled.completedModules ?? []);
      const nextModule =
        (course.modules ?? []).find((module) => !done.has(module.title)) ?? null;
      onSelectCourse(course, nextModule);
      return;
    }

    setTestStatus("");
    try {
      const res = await fetch(
        `${SERVER_URL}/api/courses/${encodeURIComponent(course._id)}/enroll`,
        { method: "POST", headers: authHeaders(), credentials: "include" },
      );
      const body = (await res.json()) as {
        nextModule?: CourseInfo["modules"][number] | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not enroll in that course.");
      }
      // Reload so the card flips to its enrolled state, then start the lesson.
      await refresh();
      onSelectCourse(course, body.nextModule ?? null);
    } catch (error) {
      setTestStatus(
        error instanceof Error ? error.message : "Could not enroll in that course.",
      );
    }
  }

  async function leaveCourse(courseId: string): Promise<void> {
    setTestStatus("");
    try {
      const res = await fetch(
        `${SERVER_URL}/api/courses/${encodeURIComponent(courseId)}/enroll`,
        { method: "DELETE", headers: authHeaders(), credentials: "include" },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Could not leave that course.");
      }
      await refresh();
    } catch (error) {
      setTestStatus(
        error instanceof Error ? error.message : "Could not leave that course.",
      );
    }
  }

  function closeTestPanel(): void {
    attemptToken = "";
    testPanelEl.classList.add("hidden");
    testResultEl.classList.add("hidden");
  }

  function describeSpeed(speed: number): string {
    if (!speed) return "Just starting";
    if (speed < 2) return "Steady start";
    if (speed < 5) return "Building momentum";
    return "Moving fast";
  }

  /** Turn a 0—100 strength number into words a student can act on. */
  function describeStrength(strength: number): string {
    if (strength < 40) return "Needs work";
    if (strength < 60) return "Getting there";
    return "Almost there";
  }

  type NextAction =
    | { kind: "test"; label: string }
    | { kind: "test-topic"; topic: string; label: string }
    | { kind: "course"; course: CourseInfo; label: string };

  interface NextStep {
    headline: string;
    detail: string;
    action: NextAction;
  }

  /**
   * The single most useful thing this student can do right now.
   *
   * Ordered by leverage rather than by recency: a first check is worth more
   * than any course, an unresolved weak point beats resuming a course, and a
   * course only surfaces once there is nothing more valuable to do.
   */
  function computeNextStep(): NextStep {
    const progress = data?.progress;
    const weak = progress?.weakPoints ?? [];
    const enrolled = progress?.enrolledCourses ?? [];
    const lastTest = progress?.testHistory.at(-1);

    if (!lastTest) {
      return {
        headline: "Find out what to work on",
        detail:
          "One short question shows you what you know and what to focus on next. It takes about two minutes.",
        action: { kind: "test", label: "Start my first check" },
      };
    }

    const weakest = weak[0];
    if (weakest) {
      // A prerequisite underneath this topic is the more useful thing to say —
      // and the more useful thing to test. "You are weak at transformers" is a
      // verdict the student cannot act on; "start with matrix multiplication,
      // which transformers sits on top of" is a Tuesday's work.
      const rootCause = data?.focusRootCause;
      const target = rootCause ?? weakest.topic;
      return {
        headline: rootCause ? `Start with ${rootCause}` : `Work on ${weakest.topic}`,
        detail: rootCause
          ? `You are weak at ${weakest.topic}, but it sits on top of ${rootCause}. Fixing the piece underneath tends to move both.`
          : `This is your weakest area right now — ${describeStrength(weakest.strength).toLowerCase()}. A quick check will tell you if it's improving.`,
        action: {
          kind: "test-topic",
          // The check follows the root cause, not the symptom.
          topic: target,
          label: `Practise ${target}`,
        },
      };
    }

    const inProgress = enrolled.find((item) => item.progressPercent < 100);
    const course = inProgress
      ? data?.courses.find((item) => item._id === inProgress.courseId)
      : undefined;
    if (inProgress && course) {
      const done = new Set(inProgress.completedModules ?? []);
      const nextModule = (course.modules ?? []).find(
        (module) => !done.has(module.title),
      );
      return {
        headline: `Continue ${course.title}`,
        detail: nextModule
          ? `You're partway through. Next up: ${nextModule.title}.`
          : "You're nearly finished with this one.",
        action: { kind: "course", course, label: "Continue learning" },
      };
    }

    return {
      headline: "You're on track",
      detail:
        "No weak areas right now. Take another check to be sure, or pick something new below.",
      action: { kind: "test", label: "Take another check" },
    };
  }

  function renderCourseDetail(): void {
    if (!openCourse) return;
    const course = openCourse;

    courseDetailCategoryEl.textContent = `${course.category} · ${course.level}`;
    courseDetailTitleEl.textContent = course.title;

    const enrolled = data?.progress.enrolledCourses.find(
      (item) => item.courseId === course._id,
    );
    const done = new Set(enrolled?.completedModules ?? []);
    const modules = course.modules ?? [];
    const percent = Math.min(100, Math.max(0, enrolled?.progressPercent ?? 0));
    // Finished when every module is done, so there is no sensible module to
    // resume into. The button restarts at the top rather than handing `null` to
    // the tutor and having it ask a generic "what would you like to do".
    const finished = modules.length > 0 && done.size >= modules.length;
    const target = resumeModuleFor(course);

    courseDetailBodyEl.innerHTML = `
      <p class="text-sm leading-relaxed text-slate-300">${esc(course.description)}</p>
      ${
        enrolled
          ? `<div class="mt-4">
               <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                 <div class="h-full rounded-full bg-indigo-500" style="width:${percent}%"></div>
               </div>
               <p class="mt-1.5 text-xs text-slate-400">${done.size} of ${modules.length} modules done</p>
             </div>`
          : `<p class="mt-4 text-xs text-slate-500">${modules.length} modules · not enrolled yet</p>`
      }
      <h3 class="mt-5 text-xs font-semibold uppercase tracking-widest text-slate-400">
        What you'll cover
      </h3>
      <ol class="course-detail-modules mt-2 flex flex-col gap-1.5">
        ${modules
          .map((module, index) =>
            moduleRowHtml(module, index, done.has(module.title), target?.title === module.title),
          )
          .join("")}
      </ol>`;

    // Say what will actually happen. A button labelled "Start learning" that
    // silently opens module 4 is worse than one that names it.
    courseDetailStartBtn.textContent = finished
      ? "Review this course"
      : enrolled && target
        ? `Continue with “${target.title}”`
        : "Start learning";
  }

  function openCourseDetail(course: CourseInfo, trigger: HTMLElement | null): void {
    openCourse = course;
    lastFocused = trigger;
    renderCourseDetail();
    courseDetailEl.classList.remove("hidden");
    courseDetailEl.classList.add("flex");
    // Focus Close, not Start: a dialog that focuses its own primary action
    // invites an accidental Enter to enrol the student in a course they were
    // only reading about.
    courseDetailCloseBtn.focus();
  }

  /**
   * Hand the student the open course as a PDF.
   *
   * Synchronous and entirely local: the syllabus is already in `data`, so this
   * cannot fail on a network call and there is nothing to await. The dialog stays
   * open on purpose — a download is not a navigation, and closing it would throw
   * away the module list they were reading.
   *
   * "Download" opens the print dialog with Save-as-PDF preselected rather than
   * silently writing a file. That is one extra click, and it is the right trade:
   * the student gets to see the document before it is saved, and it works on
   * every browser without shipping a PDF renderer that cannot draw Devanagari.
   * The button says which it is, so nobody is surprised by a dialog.
   */
  function downloadOpenCourseNotes(): void {
    if (!openCourse) return;
    const enrolled = data?.progress.enrolledCourses.find(
      (item) => item.courseId === openCourse?._id,
    );
    const language = getLanguage?.() ?? "en";
    try {
      const html = buildCourseNotesHtml(
        {
          title: openCourse.title,
          category: openCourse.category,
          description: openCourse.description,
          level: openCourse.level,
          modules: openCourse.modules ?? [],
        },
        enrolled?.completedModules ?? [],
        language,
      );
      printCourseNotesPdf(html);
    } catch (error) {
      // A failed download must not take the dialog down with it. This is a
      // convenience; the syllabus is still on screen and readable.
      console.error("Failed to build course notes.", error);
      statusEl.textContent =
        language === "hi"
          ? "नोट्स डाउनलोड नहीं हो सके।"
          : "Could not build the notes just now.";
    }
  }

  function closeCourseDetail(): void {
    courseDetailEl.classList.add("hidden");
    courseDetailEl.classList.remove("flex");
    openCourse = null;
    // Returning focus is what makes Escape and the close button usable from a
    // keyboard. Without it focus falls to <body> and the student has to Tab
    // back across the whole dashboard to find where they were.
    lastFocused?.focus();
    lastFocused = null;
  }

  /**
   * The course currently open in the detail dialog, or null when it is closed.
   *
   * Held as state rather than read back out of the DOM, because the Start button
   * needs the course object — not just an id — to hand to `onSelectCourse`, and
   * rebuilding it from the markup would mean serialising the whole course into
   * attributes and parsing it straight back out again.
   */
  let openCourse: CourseInfo | null = null;
  /** The element focus returns to when the dialog closes. */
  let lastFocused: HTMLElement | null = null;

  /** Which module Start will open, given where the student actually is. */
  function resumeModuleFor(course: CourseInfo): CourseInfo["modules"][number] | null {
    const enrolled = data?.progress.enrolledCourses.find(
      (item) => item.courseId === course._id,
    );
    const done = new Set(enrolled?.completedModules ?? []);
    return (course.modules ?? []).find((module) => !done.has(module.title)) ?? null;
  }

  /** One module row: title, completion state, and its subtopics when curated. */
  function moduleRowHtml(
    module: CourseInfo["modules"][number],
    index: number,
    isDone: boolean,
    isNext: boolean,
  ): string {
    const subtopics = module.subtopics ?? [];
    const marker = isDone ? "✓" : isNext ? "▸" : String(index + 1);
    const markerTone = isDone
      ? "text-emerald-400"
      : isNext
        ? "text-indigo-300"
        : "text-slate-600";
    return `
      <li class="course-detail-module rounded-lg border ${
        isNext
          ? "border-indigo-500/50 bg-indigo-950/30"
          : "border-slate-800 bg-slate-950/40"
      } px-3 py-2.5">
        <div class="flex items-start gap-2">
          <span class="mt-0.5 shrink-0 text-xs ${markerTone}">${marker}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium ${
              isDone ? "text-slate-400 line-through" : "text-slate-100"
            }">${esc(module.title)}</p>
            ${
              // A module with no curated breakdown shows its title alone. An
              // invented or padded list would be worse than none.
              subtopics.length
                ? `<ul class="course-detail-subtopics mt-1.5 flex flex-col gap-0.5">
                     ${subtopics
                       .map(
                         // Each subtopic is a button, not text: this is what makes
                         // a student able to learn one part of a module rather than
                         // only the whole of it. The bullet stays a separate span
                         // so the list still reads as a list, and the row's hover
                         // state is the affordance rather than an arrow that would
                         // compete with the module ticks above.
                         (sub) => `<li>
                           <button
                             type="button"
                             class="course-detail-subtopic flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-slate-400 transition hover:bg-slate-800/70 hover:text-indigo-300"
                             data-subtopic="${esc(sub)}"
                             data-module-title="${esc(module.title)}"
                             title="Learn just this part"
                           >
                             <span class="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-600"></span>
                             <span>${esc(sub)}</span>
                           </button>
                         </li>`,
                       )
                       .join("")}
                   </ul>`
                : ""
            }
          </div>
        </div>
      </li>`;
  }

  /** Enrolled courses first — the ones the student is actually working on. */
  function sortEnrolledFirst(list: CourseInfo[]): CourseInfo[] {
    const enrolledIds = new Set(
      (data?.progress.enrolledCourses ?? []).map((item) => item.courseId),
    );
    return [...list].sort(
      (a, b) => Number(enrolledIds.has(b._id)) - Number(enrolledIds.has(a._id)),
    );
  }

  function renderCourses(filter: string): void {
    const query = filter.trim().toLowerCase();
    const matched = (data?.courses ?? []).filter((course) => {
      if (!query) return true;
      return (
        course.title.toLowerCase().includes(query) ||
        course.category.toLowerCase().includes(query) ||
        course.description.toLowerCase().includes(query)
      );
    });
    const list = sortEnrolledFirst(matched);

    if (!list.length) {
      coursesEl.innerHTML = `<p class="col-span-full rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">No courses match “${esc(filter)}”.</p>`;
      return;
    }

    coursesEl.innerHTML = list
      .map((course, index) => {
        const enrollment = data?.progress.enrolledCourses.find(
          (c) => c.courseId === course._id,
        );
        const done = new Set(enrollment?.completedModules ?? []);
        const modules = course.modules ?? [];
        const percent = Math.min(100, Math.max(0, enrollment?.progressPercent ?? 0));
        // Resume where the student left off rather than restarting the course.
        const nextModule = modules.find((module) => !done.has(module.title));

        return `
        <div class="dash-course animate-fadeup flex flex-col gap-2 rounded-xl border ${enrollment ? "border-indigo-500/40" : "border-slate-800"} bg-slate-950/60 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-indigo-500/40 hover:shadow-lg hover:shadow-black/40" style="animation-delay:${Math.min(index, 6) * 55}ms">
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-sm font-semibold text-slate-100">${esc(course.title)}</h3>
            <span class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${LEVEL_STYLES[course.level]}">${esc(course.level)}</span>
          </div>
          <p class="text-xs leading-relaxed text-slate-400">${esc(course.description)}</p>
          ${
            enrollment
              ? `<div class="mt-1">
                   <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                     <div class="h-full rounded-full bg-indigo-500 transition-[width] duration-700" style="width:0" data-bar-width="${percent}"></div>
                   </div>
                   <p class="mt-1 text-[11px] text-slate-400">${done.size} of ${modules.length} done${
                     nextModule ? ` · next: ${esc(nextModule.title)}` : " · finished"
                   }</p>
                 </div>
                 <ul class="dash-modules flex flex-col gap-0.5 text-[11px] text-slate-500">`
              : `<ul class="dash-modules hidden">`
          }
            ${modules
              .map(
                (module) => `
              <li class="flex items-center gap-1.5">
                <span class="${done.has(module.title) ? "text-emerald-400" : "text-slate-600"}">${
                  done.has(module.title) ? "âœ“" : "â—‹"
                }</span>
                <span class="${done.has(module.title) ? "text-slate-400 line-through" : ""}">${esc(module.title)}</span>
              </li>`,
              )
              .join("")}
          </ul>
          <div class="mt-auto flex items-center gap-2 pt-1">
            <button
              type="button"
              data-course-id="${esc(course._id)}"
              class="dash-continue flex-1 rounded-lg ${enrollment ? "bg-indigo-600 text-white hover:bg-indigo-500" : "border border-slate-700 bg-slate-800/60 text-slate-200 hover:border-indigo-500/50 hover:text-white"} px-3 py-2.5 text-sm font-semibold transition active:scale-95"
            >
              ${enrollment ? "Continue" : "Start learning"}
            </button>
            <!--
              Details is a separate button rather than making the whole card
              clickable. A card-wide click handler would have to check on every
              click whether the target was the Start button or Leave, and would
              still swallow text selection — dragging to copy a course title
              would open a dialog.
            -->
            <button
              type="button"
              data-course-id="${esc(course._id)}"
              class="dash-details shrink-0 rounded-lg border border-slate-700 px-2.5 py-2.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500/50 hover:text-white"
              title="See topics and subtopics"
            >Details</button>
            ${
              enrollment
                ? `<button
                     type="button"
                     data-course-id="${esc(course._id)}"
                     class="dash-leave shrink-0 rounded-lg px-2 py-2.5 text-xs font-medium text-slate-500 transition hover:text-rose-300"
                     title="Leave this course"
                   >Leave</button>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");
    // Bars are authored at zero and take their real width only once they are in
    // the document, so the fill has somewhere to animate from.
    fillBars(coursesEl);
  }

  /**
   * Start a checkpoint test for a course.
   *
   * The server decides what to ask and refuses when nothing is due, so this only
   * has to start the panel — which is the same panel an ordinary topic test uses,
   * so the student sees no difference in how a test is taken, only in what it
   * covers.
   */
  async function startCheckpointTest(courseId: string): Promise<void> {
    if (testBusy) return;
    testPanelEl.classList.remove("hidden");
    testResultEl.classList.add("hidden");
    testResultEl.innerHTML = "";
    testAnswerEl.value = "";
    setTestStatus("");
    setTestBusy(true);
    testTopicEl.textContent = "Checkpoint test…";
    testQuestionEl.textContent = "";

    try {
      const res = await fetch(`${SERVER_URL}/api/assessment/checkpoint`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ courseId }),
      });
      const body = (await res.json()) as {
        attemptToken?: string;
        topic?: string;
        question?: string;
        error?: string;
      };
      if (!res.ok || !body.attemptToken || !body.question) {
        throw new Error(body.error ?? "Could not start the checkpoint test.");
      }
      attemptToken = body.attemptToken;
      testTopic = body.topic ?? "";
      testTopicEl.textContent = `Checkpoint: ${body.topic ?? ""}`;
      testQuestionEl.textContent = body.question;
      setTestBusy(false);
      testAnswerEl.focus();
    } catch (error) {
      setTestBusy(false);
      closeTestPanel();
      setTestStatus(
        error instanceof Error ? error.message : "Could not start the checkpoint test.",
      );
    }
  }

  /**
   * The streak and daily-goal card.
   *
   * Drawn as a 7-cell row rather than a flame-and-a-number, because the useful
   * fact is not "you have a 4-day streak" but "which of the last seven days did
   * I actually turn up" — the row makes a broken run visible and recoverable at a
   * glance, where a single number only makes it feel like a verdict.
   *
   * Renders nothing at all without a `streak` field, so a payload from a server
   * predating the feature costs one absent card rather than an empty box.
   */
  function renderStreak(): void {
    const streak = data?.streak;
    if (!streak) {
      streakEl.innerHTML = "";
      return;
    }

    // The last seven local days, oldest first. Zeroes for days with no activity,
    // which is the honest reading: "you didn't study" rather than a gap.
    // The weekday letter is the difference between "four days" and "which four" —
    // the row only earns its place over a flame-and-a-number if a broken run is
    // visible *and* locatable.
    const today = new Date();
    const cells = Array.from({ length: 7 }, (_, index) => {
      const daysAgo = 6 - index;
      const active = daysAgo < streak.current || (daysAgo === 0 && streak.studiedToday);
      const date = new Date(today);
      date.setDate(today.getDate() - daysAgo);
      const letter = date.toLocaleDateString(undefined, { weekday: "narrow" });
      return { daysAgo, active, letter };
    });

    const goal = streak.goal > 0 ? streak.goal : 1;
    // Clamped to 100: a student who did fifteen turns has met the goal several
    // times over, and a bar that overflows its track looks like a bug.
    const percent = Math.min(100, Math.round((streak.todayTurns / goal) * 100));

    streakEl.innerHTML = `
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Study streak</h2>
          <p class="text-sm font-bold text-indigo-300">
            ${
              streak.current > 0
                ? `${streak.current} day${streak.current === 1 ? "" : "s"}`
                : "—"
            }
          </p>
        </div>

        <div class="mt-3 flex gap-1.5" role="img"
             aria-label="${esc(streak.current > 0 ? `${streak.current}-day study streak` : "No active streak")}">
          ${cells
            .map(
              (cell) => `
            <span class="flex flex-1 flex-col items-center gap-1">
              <span class="h-2 w-full rounded-full ${
                cell.active
                  ? cell.daysAgo === 0
                    ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                    : "bg-indigo-400"
                  : "bg-slate-800"
              }"></span>
              <span class="text-[9px] font-medium ${
                cell.daysAgo === 0 ? "text-slate-300" : "text-slate-600"
              }">${cell.letter}</span>
            </span>`,
            )
            .join("")}
        </div>

        <div class="mt-4">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>Today's goal</span>
            <span>${streak.todayTurns} / ${goal}</span>
          </div>
          <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div class="h-full rounded-full transition-[width] duration-700 ${
              streak.goalMet ? "bg-emerald-400" : "bg-indigo-400"
            }" style="width:0" data-bar-width="${percent}"></div>
          </div>
        </div>

        <p class="mt-3 text-sm text-slate-300">${esc(streak.message)}</p>
      </div>`;
    fillBars(streakEl);

    // The goal flipping from unmet to met is a win the student caused today,
    // so it gets the screen moment. Only the transition — see goalMetBefore.
    if (goalMetBefore === false && streak.goalMet) celebrate(16);
    goalMetBefore = streak.goalMet;
  }

  /** The courses currently owed a checkpoint test, with their titles. */
  function renderCheckpoints(): void {
    if (!data) return;
    const due = (data.checkpoints ?? []).filter(
      (checkpoint) => checkpoint.due && checkpoint.nextModule,
    );
    if (!due.length) {
      checkpointEl.innerHTML = "";
      return;
    }
    checkpointEl.innerHTML = due
      .slice(0, 2)
      .map((checkpoint) => {
        const modules = checkpoint.untestedModules ?? [];
        const shown = modules.slice(0, 3).map((module) => module.title);
        const extra = modules.length - shown.length;
        return `
        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-4">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-indigo-300">Checkpoint test · ${esc(checkpoint.courseTitle)}</p>
            <p class="mt-0.5 text-xs text-slate-300">
              ${shown.map((title) => esc(title)).join(", ")}${extra > 0 ? ` +${extra} more` : ""}
            </p>
          </div>
          <button
            type="button"
            class="dash-checkpoint shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500"
            data-checkpoint-course="${esc(checkpoint.courseId)}"
          >Take it</button>
        </div>`;
      })
      .join("");
  }

  checkpointEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".dash-checkpoint",
    );
    const courseId = button?.dataset.checkpointCourse;
    if (courseId) void startCheckpointTest(courseId);
  });

  function renderData(): void {
    if (!data) return;

    // Alerts lead: they are the conclusion, everything below is the evidence.
    renderStreak();
    renderAlerts();
    renderCheckpoints();

    // --- At a glance: words, not raw numbers ---
    const pace = describeSpeed(data.progress.learningSpeed);
    speedEl.textContent = pace;
    // The server-derived "how long were you away" rides on the pace line rather
    // than taking its own row — it is context for the pace, not a separate fact.
    // Empty for a short break or a brand-new student, so it adds nothing there.
    const away = data.awayLabel?.trim() ?? "";
    paceLineEl.textContent =
      [
        data.progress.learningSpeed > 0
          ? `${pace} — you're picking up new ideas steadily.`
          : "Ask the owl a question to get started.",
        away,
      ]
        .filter(Boolean)
        .join(" · ");
    focusCountEl.textContent =
      data.progress.weakPoints.length === 0
        ? "None right now"
        : String(data.progress.weakPoints.length);
    const lastScore = data.progress.testHistory.at(-1);
    if (lastScore) countTo(lastScoreEl, lastScore.score, "%");
    else {
      delete lastScoreEl.dataset.counted;
      lastScoreEl.textContent = "Not yet";
    }

    // --- The one thing to do next ---
    const next = computeNextStep();
    nextHeadlineEl.textContent = next.headline;
    nextDetailEl.textContent = next.detail;
    startTestBtn.textContent = next.action.label;
    nextStep = next;

    // --- Review today: the schedule's reason to exist ---
    // Capped at 3 for the same reason focus areas are: the point is to start one,
    // not to feel behind. Showing twenty due concepts is how a review queue gets
    // abandoned on day two.
    const due = (data.dueReviews ?? []).slice(0, 3);
    if (due.length) {
      reviewsEl.innerHTML = `
        <p class="text-sm text-slate-400">
          ${due.length === 1 ? "1 concept is" : `${due.length} concepts are`} ready to review.
          ${(data.dueReviews?.length ?? 0) > 3 ? `<span class="text-slate-500">+${(data.dueReviews?.length ?? 0) - 3} more</span>` : ""}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          ${due
            .map(
              (card) => `
            <button
              type="button"
              class="dash-review inline-block rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:border-indigo-400/60 hover:brightness-125"
              data-test-topic="${esc(card.topic)}"
              title="${esc(card.label)} — practise ${esc(card.topic)}"
            >${esc(card.topic)} · ${esc(card.label)}</button>`,
            )
            .join("")}
        </div>`;
    } else {
      reviewsEl.textContent =
        data.progress.testHistory.length === 0
          ? "Take a check and anything you need to revisit will show up here."
          : "Nothing due. Come back when your next review is ready.";
    }

    // --- Focus areas: top 3 only, in words ---
    // Capping at 3 is the point. The model keeps up to 25, and showing 25 grey
    // pills is how you make someone stop looking at the page.
    const focus = data.progress.weakPoints.slice(0, 3);
    if (focus.length) {
      weakEl.innerHTML = `${focus
        .map(
          (wp) =>
            `<button
               type="button"
               data-test-topic="${esc(wp.topic)}"
               class="dash-weakpoint inline-block rounded-full border px-3 py-1.5 text-xs font-medium transition hover:brightness-125 ${
                 wp.strength < 40
                   ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                   : "border-amber-500/40 bg-amber-500/10 text-amber-300"
               }"
               title="Practise ${esc(wp.topic)}"
             >${esc(wp.topic)} · ${describeStrength(wp.strength)}</button>`,
        )
        .join(" ")}${
        data.progress.weakPoints.length > 3
          ? `<span class="ml-1 text-xs text-slate-500">+${data.progress.weakPoints.length - 3} more</span>`
          : ""
      }`;
    } else {
      weakEl.textContent =
        "Nothing to work on right now. Take a check to find out what to learn next.";
    }

    // --- Last check: the score, and the one thing to do about it ---
    if (lastScore) {
      feedbackEl.innerHTML = `
        <p class="text-sm text-slate-200">
          <span class="font-semibold text-indigo-300">${esc(lastScore.topic)}</span> — ${lastScore.score}%
        </p>
        <p class="mt-1 text-xs leading-relaxed text-slate-400">${esc(lastScore.feedback)}</p>
        ${
          lastScore.recommendedFocus
            ? `<p class="mt-2 text-xs text-amber-300">Practise: ${esc(lastScore.recommendedFocus)}</p>`
            : ""
        }`;
    } else {
      feedbackEl.textContent =
        "You haven't taken a check yet. The button above will show you what to focus on.";
    }

    renderCourses(searchEl.value);
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    // A refresh requested while one is already in flight must not be dropped —
    // that's how a card fails to flip back to its post-enroll state. Queue it.
    if (loading) {
      refreshQueued = true;
      return;
    }
    loading = true;
    statusEl.textContent = "";
    try {
      const res = await fetch(`${SERVER_URL}/api/dashboard/${encodeURIComponent(studentId)}`, {
        credentials: "include",
      });
      const body = (await res.json()) as DashboardData & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Unable to load dashboard.");
      }
      data = body;
      renderData();
    } catch (error) {
      statusEl.textContent =
        error instanceof Error ? error.message : "Unable to load dashboard.";
      // A first load that failed must not leave shimmer pulsing on the screen
      // forever — that reads as "still thinking" and never resolves. The error
      // line is the honest state, so the placeholders get out of its way.
      if (!data) clearSkeletons();
    } finally {
      loading = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refresh();
      }
    }
  }

  searchEl.addEventListener("input", () => renderCourses(searchEl.value));

  // Continue Learning / Start Learning â†’ enroll if needed, then jump into a
  // Socratic chat aimed at the next incomplete module.
  coursesEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!data) return;

    const leave = target.closest<HTMLButtonElement>(".dash-leave");
    if (leave?.dataset.courseId) {
      void leaveCourse(leave.dataset.courseId);
      return;
    }

    // Details → open the syllabus, and keep the card as the element to return
    // focus to. Checked before Start because a click on Details must never also
    // enroll the student in the course.
    const details = target.closest<HTMLButtonElement>(".dash-details");
    if (details?.dataset.courseId) {
      const course = data.courses.find((c) => c._id === details.dataset.courseId);
      if (course) openCourseDetail(course, details);
      return;
    }

    const button = target.closest<HTMLButtonElement>(".dash-continue");
    if (!button?.dataset.courseId) return;
    const course = data.courses.find((c) => c._id === button.dataset.courseId);
    if (course) void startCourse(course);
  });

  // The detail dialog's Start button runs the same path as the card's, so
  // enrolling, resuming and the tutor handoff stay in one place. The dialog is
  // closed first because `startCourse` re-renders the dashboard on enroll, which
  // would otherwise leave a dialog floating over a list the student can no
  // longer see the context of.
  // Alerts: one delegated listener for the whole list, rather than a handler per
  // alert. The list is re-rendered on every refresh, so per-alert handlers would
  // accumulate on every page load.
  alertsEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".dash-alert-action",
    );
    if (!button) return;
    const kind = button.dataset.alertKind as LearningAlert["action"]["kind"] | undefined;
    if (!kind) return;
    runAlertAction(kind, button.dataset.alertTarget ?? "");
  });

  /**
   * F5: open a lesson on one named subtopic.
   *
   * The request is matched against the whole course rather than only the module
   * the student clicked, so "gradient descent" finds its subtopic wherever it
   * sits. A `none` match falls back to the module's own topic — better to teach the
   * module than to refuse a request that was plainly about it.
   */
  function learnSubtopic(
    course: CourseInfo,
    module: CourseInfo["modules"][number],
    subtopic: string,
  ): void {
    const match = matchSubtopic(subtopic, course.modules ?? []);
    const chosen = match.subtopic ?? subtopic ?? module.topic;
    const moduleTitle = match.moduleTitle ?? module.title;
    const prompt = subtopicPrompt(moduleTitle, chosen, course.title);
    onLearnTopic?.(prompt);
  }

  // Subtopics in the course detail are individually learnable. Delegated, because
  // the dialog body is re-rendered on every open.
  courseDetailBodyEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".course-detail-subtopic",
    );
    if (!button || !openCourse) return;
    const subtopic = button.dataset.subtopic?.trim();
    const moduleTitle = button.dataset.moduleTitle?.trim();
    if (!subtopic || !moduleTitle) return;
    const course = openCourse;
    const module = (course.modules ?? []).find((item) => item.title === moduleTitle);
    if (!module) return;
    closeCourseDetail();
    learnSubtopic(course, module, subtopic);
  });

  courseDetailNotesBtn.addEventListener("click", downloadOpenCourseNotes);

  courseDetailStartBtn.addEventListener("click", () => {
    if (!openCourse) return;
    const course = openCourse;
    closeCourseDetail();
    void startCourse(course);
  });

  courseDetailCloseBtn.addEventListener("click", closeCourseDetail);

  // Click the backdrop to dismiss. Guarded on the target being the backdrop
  // itself, so a click inside the panel — or on the scrollable body — does not
  // close it and lose the student's place in a 186-module list.
  courseDetailEl.addEventListener("click", (event) => {
    if (event.target === courseDetailEl) closeCourseDetail();
  });

  // Escape closes, which is the one key a dialog is expected to answer without
  // the student having to find the close button. Named so `destroy` can remove
  // it — every other listener here hangs off an element that goes away with the
  // host, but this one is on `document` and would outlive the dashboard, firing
  // against a closed component on every later Escape press.
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && openCourse) closeCourseDetail();
  };
  document.addEventListener("keydown", onDocumentKeydown);

  // The primary button does whatever the dashboard currently recommends, so
  // the student never has to decide which of several buttons to press.
  startTestBtn.addEventListener("click", () => {
    const action = nextStep?.action;
    if (!action) {
      void startAssessment();
      return;
    }
    if (action.kind === "test") {
      void startAssessment();
    } else if (action.kind === "test-topic") {
      void startAssessment(action.topic);
    } else {
      void startCourse(action.course);
    }
  });

  testSubmitBtn.addEventListener("click", () => {
    void submitAssessment();
  });

  testSkipBtn.addEventListener("click", closeTestPanel);
  testCloseBtn.addEventListener("click", closeTestPanel);

  // Ctrl/Cmd+Enter submits without reaching for the mouse.
  testAnswerEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitAssessment();
    }
  });

  // Click a weak point to test exactly that topic.
  weakEl.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".dash-weakpoint",
    );
    const topic = chip?.dataset.testTopic;
    if (topic) void startAssessment(topic);
  });

  // Dev-only test hook: drive the exact client path (panel + question render)
  // when live AI providers are drained, so the suite covers the UI contract
  // without depending on provider quotas. Stripped from production builds.
  if (import.meta.env.DEV) {
    const hookHost = window as unknown as Record<string, unknown>;
    const existing =
      typeof hookHost.__agentedTest === "object" && hookHost.__agentedTest !== null
        ? (hookHost.__agentedTest as Record<string, unknown>)
        : {};
    hookHost.__agentedTest = {
      ...existing,
      showAssessmentQuestion: (questionTopic: string, question: string) => {
        testPanelEl.classList.remove("hidden");
        testTopicEl.textContent = `Topic: ${questionTopic}`;
        testQuestionEl.textContent = question;
      },
    };
  }

  // Hand the graded result back to the tutor so the loop can be closed.
  //
  // The topic passed is the one the button is *about* — `recommendedFocus`, the
  // concept the grader said to work on next — not `testTopic`, the topic that
  // was actually tested. Those differ whenever the grade identified a gap, which
  // is exactly the case the button exists for: it used to send the student back
  // to the concept they had just failed instead of the one they needed.
  testResultEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".dash-test-discuss",
    );
    if (!button || !onDiscussTopic) return;
    const topic = button.dataset.discussTopic?.trim();
    if (topic) onDiscussTopic(topic);
  });

  refresh();

  return {
    refresh,
    destroy: () => {
      destroyed = true;
      document.removeEventListener("keydown", onDocumentKeydown);
    },
  };
}

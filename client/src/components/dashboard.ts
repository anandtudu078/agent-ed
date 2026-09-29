// Student Learning Dashboard — the personalized learning hub. Shows the
// student's progress analytics (learning speed, weak points, AI test
// feedback/recommended focus), a quick action for starting an AI evaluation
// test, and a searchable course catalog with Continue Learning actions.

export interface CourseInfo {
  _id: string;
  title: string;
  category: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced";
  modules: Array<{ title: string; topic: string }>;
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
   * Fired when an answer is graded, with the score. The owl uses this to react
   * — a character that congratulates you but never acknowledges a wrong answer
   * feels like it's not actually watching.
   */
  onGraded?: (score: number) => void,
): { refresh: () => Promise<void>; destroy: () => void } {
  let data: DashboardData | null = null;
  let loading = false;
  let refreshQueued = false;
  let destroyed = false;
  host.innerHTML = `
    <div class="h-full overflow-y-auto px-4 py-6 scroll-smooth">
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <!-- Header: plain language, no jargon box -->
        <div>
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            Your <span class="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">learning</span>
          </h1>
          <p class="dash-pace-line mt-1 text-sm text-slate-400">Loading…</p>
        </div>

        <!-- THE one thing to do next. Everything else is secondary. -->
        <section class="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/60 to-violet-950/40 p-5">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-indigo-300/80">What to do next</p>
          <h2 class="dash-next-headline mt-1.5 text-lg font-bold leading-snug text-slate-50">…</h2>
          <p class="dash-next-detail mt-1.5 text-sm leading-relaxed text-slate-300"></p>
          <button
            type="button"
            class="dash-start-test mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >…</button>
        </section>

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

        <!-- Focus areas: only the few that matter, in plain words -->
        <div class="dash-weakpoints rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Focus areas</h2>
          <p class="dash-weakpoints-body mt-3 text-sm text-slate-400">Loading…</p>
        </div>

        <!-- Latest result, condensed to what the student can act on -->
        <div class="dash-feedback rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Your last check</h2>
          <p class="dash-feedback-body mt-3 text-sm text-slate-400">Loading…</p>
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
          <div class="dash-courses mt-4 grid gap-3 sm:grid-cols-2"></div>
        </div>

        <p class="dash-status min-h-[1.25rem] text-sm text-rose-400"></p>
      </div>
    </div>`;

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
  const feedbackEl = host.querySelector<HTMLElement>(".dash-feedback-body")!;
  const coursesEl = host.querySelector<HTMLElement>(".dash-courses")!;
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

  /** Token for the in-flight question; blank when no attempt is open. */
  let attemptToken = "";
  let testTopic = "";
  let testBusy = false;

  function authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("agented:token") ?? ""}`,
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
          <div class="h-full rounded-full ${tone.bar}" style="width:${score}%"></div>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-slate-300">${esc(evaluation.feedback)}</p>
        ${
          onDiscussTopic && evaluation.recommendedFocus
            ? `<button
                 type="button"
                 class="dash-test-discuss mt-4 rounded-xl border border-indigo-500/50 bg-indigo-500/10 px-4 py-2.5 text-sm font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
               >
                 Work on this with the tutor
               </button>`
            : ""
        }
      </div>`;
    testResultEl.classList.remove("hidden");
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
        { method: "POST", headers: authHeaders() },
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
        { method: "DELETE", headers: authHeaders() },
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

  /** Turn a 0–100 strength number into words a student can act on. */
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
      return {
        headline: `Work on ${weakest.topic}`,
        detail: `This is your weakest area right now — ${describeStrength(weakest.strength).toLowerCase()}. A quick check will tell you if it's improving.`,
        action: {
          kind: "test-topic",
          topic: weakest.topic,
          label: `Practise ${weakest.topic}`,
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
      .map((course) => {
        const enrollment = data?.progress.enrolledCourses.find(
          (c) => c.courseId === course._id,
        );
        const done = new Set(enrollment?.completedModules ?? []);
        const modules = course.modules ?? [];
        const percent = Math.min(100, Math.max(0, enrollment?.progressPercent ?? 0));
        // Resume where the student left off rather than restarting the course.
        const nextModule = modules.find((module) => !done.has(module.title));

        return `
        <div class="dash-course flex flex-col gap-2 rounded-xl border ${enrollment ? "border-indigo-500/40" : "border-slate-800"} bg-slate-950/60 p-4 transition hover:border-indigo-500/40">
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-sm font-semibold text-slate-100">${esc(course.title)}</h3>
            <span class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${LEVEL_STYLES[course.level]}">${esc(course.level)}</span>
          </div>
          <p class="text-xs leading-relaxed text-slate-400">${esc(course.description)}</p>
          ${
            enrollment
              ? `<div class="mt-1">
                   <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                     <div class="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style="width:${percent}%"></div>
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
                  done.has(module.title) ? "✓" : "○"
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
  }

  function renderData(): void {
    if (!data) return;

    // --- At a glance: words, not raw numbers ---
    const pace = describeSpeed(data.progress.learningSpeed);
    speedEl.textContent = pace;
    paceLineEl.textContent =
      data.progress.learningSpeed > 0
        ? `${pace} — you're picking up new ideas steadily.`
        : "Ask the owl a question to get started.";
    focusCountEl.textContent =
      data.progress.weakPoints.length === 0
        ? "None right now"
        : String(data.progress.weakPoints.length);
    const lastScore = data.progress.testHistory.at(-1);
    lastScoreEl.textContent = lastScore ? `${lastScore.score}%` : "Not yet";

    // --- The one thing to do next ---
    const next = computeNextStep();
    nextHeadlineEl.textContent = next.headline;
    nextDetailEl.textContent = next.detail;
    startTestBtn.textContent = next.action.label;
    nextStep = next;

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
        headers: { Authorization: `Bearer ${localStorage.getItem("agented:token") ?? ""}` },
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
    } finally {
      loading = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refresh();
      }
    }
  }

  searchEl.addEventListener("input", () => renderCourses(searchEl.value));

  // Continue Learning / Start Learning → enroll if needed, then jump into a
  // Socratic chat aimed at the next incomplete module.
  coursesEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!data) return;

    const leave = target.closest<HTMLButtonElement>(".dash-leave");
    if (leave?.dataset.courseId) {
      void leaveCourse(leave.dataset.courseId);
      return;
    }

    const button = target.closest<HTMLButtonElement>(".dash-continue");
    if (!button?.dataset.courseId) return;
    const course = data.courses.find((c) => c._id === button.dataset.courseId);
    if (course) void startCourse(course);
  });

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
  testResultEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".dash-test-discuss",
    );
    if (button && onDiscussTopic) onDiscussTopic(testTopic);
  });

  refresh();

  return {
    refresh,
    destroy: () => {
      destroyed = true;
    },
  };
}

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
}

export interface ProgressInfo {
  enrolledCourses: Array<{
    courseId: string;
    title: string;
    lastTopic: string;
    progressPercent: number;
  }>;
  learningSpeed: number; // concepts/week
  weakPoints: Array<{ topic: string; strength: number }>;
  testHistory: Array<{
    topic: string;
    score: number;
    feedback: string;
    recommendedFocus: string;
    evaluatedAt: string;
  }>;
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
  onSelectCourse: (course: CourseInfo) => void,
): { refresh: () => Promise<void>; destroy: () => void } {
  let data: DashboardData | null = null;
  let loading = false;
  let destroyed = false;
  host.innerHTML = `
    <div class="h-full overflow-y-auto px-4 py-6 scroll-smooth">
      <div class="mx-auto w-full max-w-4xl space-y-6">
        <!-- Header: title + dynamic learning speed -->
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
              Learning <span class="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Dashboard</span>
            </h1>
            <p class="mt-1 text-sm text-slate-400">
              Your progress, weak points, and next best steps.
            </p>
          </div>
          <div class="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-right">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Learning speed</p>
            <p class="dash-speed text-xl font-bold text-indigo-300 sm:text-2xl">…</p>
            <p class="text-[10px] text-slate-500">concepts / week</p>
          </div>
        </div>

        <!-- Analytics overview -->
        <div class="grid gap-4 sm:grid-cols-2">
          <!-- Weak points -->
          <div class="dash-weakpoints rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Weak points</h2>
            <p class="dash-weakpoints-body mt-3 text-sm text-slate-400">Loading…</p>
          </div>
          <!-- AI test feedback -->
          <div class="dash-feedback rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">AI test feedback</h2>
            <p class="dash-feedback-body mt-3 text-sm text-slate-400">Loading…</p>
          </div>
        </div>

        <!-- Quick action: start an AI evaluation test -->
        <button
          type="button"
          class="dash-start-test w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          🧪 Start AI evaluation test
        </button>

        <!-- Course catalog -->
        <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-400">Course catalog</h2>
            <label class="relative block">
              <span class="sr-only">Search courses</span>
              <input
                type="search"
                class="dash-search w-56 rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2 text-sm placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="Search courses…"
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
  const weakEl = host.querySelector<HTMLElement>(".dash-weakpoints-body")!;
  const feedbackEl = host.querySelector<HTMLElement>(".dash-feedback-body")!;
  const coursesEl = host.querySelector<HTMLElement>(".dash-courses")!;
  const searchEl = host.querySelector<HTMLInputElement>(".dash-search")!;
  const startTestBtn = host.querySelector<HTMLButtonElement>(".dash-start-test")!;

  function describeSpeed(speed: number): string {
    if (!speed) return "Just getting started";
    if (speed < 2) return "Steady start";
    if (speed < 5) return "Building momentum";
    return "Fast learner";
  }

  function renderCourses(filter: string): void {
    const query = filter.trim().toLowerCase();
    const list = (data?.courses ?? []).filter((course) => {
      if (!query) return true;
      return (
        course.title.toLowerCase().includes(query) ||
        course.category.toLowerCase().includes(query) ||
        course.description.toLowerCase().includes(query)
      );
    });

    if (!list.length) {
      coursesEl.innerHTML = `<p class="col-span-full rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">No courses match “${esc(filter)}”.</p>`;
      return;
    }

    coursesEl.innerHTML = list
      .map((course) => {
        const enrollment = data?.progress.enrolledCourses.find(
          (c) => c.courseId === course._id,
        );
        return `
        <div class="dash-course flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-indigo-500/40">
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-sm font-semibold text-slate-100">${esc(course.title)}</h3>
            <span class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${LEVEL_STYLES[course.level]}">${esc(course.level)}</span>
          </div>
          <p class="text-xs leading-relaxed text-slate-400">${esc(course.description)} <span class="text-slate-500">· ${esc(course.category)}</span></p>
          ${
            enrollment
              ? `<div class="mt-1">
                   <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                     <div class="h-full rounded-full bg-indigo-500" style="width:${Math.min(100, Math.max(0, enrollment.progressPercent))}%"></div>
                   </div>
                   <p class="mt-1 text-[10px] text-slate-500">${Math.round(enrollment.progressPercent)}% · last topic: ${esc(enrollment.lastTopic || "—")}</p>
                 </div>`
              : ""
          }
          <button
            type="button"
            data-course-id="${esc(course._id)}"
            class="dash-continue mt-auto rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 active:scale-95"
          >
            ${enrollment ? "Continue Learning" : "Start Learning"}
          </button>
        </div>`;
      })
      .join("");
  }

  function renderData(): void {
    if (!data) return;
    speedEl.textContent = `${data.progress.learningSpeed}`;
    speedEl.title = describeSpeed(data.progress.learningSpeed);

    if (data.progress.weakPoints.length) {
      weakEl.innerHTML = data.progress.weakPoints
        .map(
          (wp) =>
            `<span class="dash-weakpoint inline-block rounded-full border px-3 py-1 text-xs font-medium ${
              wp.strength < 40
                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300"
            }" title="Strength ${wp.strength}/100 — ask the tutor about this!">${esc(wp.topic)} · ${wp.strength}</span>`,
        )
        .join(" ");
    } else {
      weakEl.textContent =
        "No weak points identified yet — take an AI evaluation test to map them.";
    }

    const lastTest = data.progress.testHistory.at(-1);
    if (lastTest) {
      feedbackEl.innerHTML = `
        <p class="text-sm text-slate-200">
          <span class="font-semibold text-indigo-300">${esc(lastTest.topic)}</span> — ${lastTest.score}/100
        </p>
        <p class="mt-1 text-xs leading-relaxed text-slate-400">${esc(lastTest.feedback)}</p>
        <p class="mt-2 text-xs text-amber-300">Recommended focus: ${esc(lastTest.recommendedFocus)}</p>`;
    } else {
      feedbackEl.textContent =
        "No AI test results yet — run your first evaluation to get feedback and focus areas.";
    }

    renderCourses(searchEl.value);
  }

  async function refresh(): Promise<void> {
    if (loading || destroyed) return;
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
    }
  }

  searchEl.addEventListener("input", () => renderCourses(searchEl.value));

  // Continue Learning → jump into a Socratic chat about that course.
  coursesEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".dash-continue");
    if (!button || !data) return;
    const course = data.courses.find((c) => c._id === button.dataset.courseId);
    if (course) onSelectCourse(course);
  });

  startTestBtn.addEventListener("click", () => {
    // Handed to main.ts so the chat opens with an evaluation prompt.
    startTestBtn.dispatchEvent(new CustomEvent("dashboard:start-test", { bubbles: true }));
  });

  refresh();

  return {
    refresh,
    destroy: () => {
      destroyed = true;
    },
  };
}

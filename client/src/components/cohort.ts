/**
 * Classes — the teacher's view of a cohort, and the student's way in.
 *
 * One component renders both sides because they are two questions about the
 * same object: a teacher asks "how is my class doing?", a student asks "how do
 * I get into my class?". The `role` decides the forms and the payload
 * emphasis, never the data — the server is what decides what each role may
 * see, and this panel only draws what comes back.
 *
 * The rule this panel inherits from the server (see `routes/classes.ts`):
 * a roster shows progress, never conversation. A teacher sees percentages,
 * weak topics, latest scores and last-active — the same evidence the
 * student's own dashboard derives, never a student's words.
 *
 * Everything dynamic goes through `esc()` before it touches `innerHTML`, the
 * same as `dashboard.ts`: class names, display names and topics are all
 * user-authored strings.
 */
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:3000";

/** The header that proves a request came from this app. See `requireCsrfHeader`. */
const CSRF_HEADER = { "X-Requested-With": "AgentEd" };

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type CohortRole = "student" | "teacher";

interface TeacherClass {
  _id: string;
  name: string;
  joinCode: string;
  memberCount: number;
  createdAt: string;
}

interface EnrolledClass {
  _id: string;
  name: string;
  teacherName: string;
  memberCount: number;
}

interface RosterMember {
  username: string;
  displayName: string;
  courses: Array<{ title: string; progressPercent: number }>;
  weakPoints: Array<{ topic: string; strength: number }>;
  lastScore: { score: number; topic: string; evaluatedAt: string | null } | null;
  lastActiveAt: string | null;
  activeThisWeek: boolean;
}

interface RosterPayload {
  class: { _id: string; name: string; joinCode: string; createdAt: string };
  summary: {
    memberCount: number;
    activeThisWeek: number;
    neverActive: number;
    avgProgress: number;
    commonWeakTopics: Array<{ topic: string; students: number }>;
  };
  members: RosterMember[];
}

/** "Just now" / "4h ago" / "Yesterday" / "12d ago" — or the honest absence. */
function timeAgo(iso: string | null): string {
  if (!iso) return "No activity yet";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "No activity yet";
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (ms < hour) return "Just now";
  if (ms < day) return `${Math.floor(ms / hour)}h ago`;
  const days = Math.floor(ms / day);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

/** A student's mean across enrolled courses — null when enrolled in nothing. */
function meanProgress(courses: RosterMember["courses"]): number | null {
  if (!courses.length) return null;
  return Math.round(
    courses.reduce((sum, course) => sum + course.progressPercent, 0) /
      courses.length,
  );
}

export interface CohortPanelOptions {
  role: CohortRole;
}

export function createCohortPanel(
  host: HTMLElement,
  options: CohortPanelOptions,
): { refresh: () => Promise<void>; destroy: () => void } {
  const isTeacher = options.role === "teacher";
  let destroyed = false;
  let busy = false;

  host.innerHTML = `
    <div class="h-full overflow-y-auto px-4 py-6 scroll-smooth">
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            Your <span class="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">classes</span>
          </h1>
          <p class="cohort-sub mt-1 text-sm text-slate-400">${
            isTeacher
              ? "Create a class, share its code, and see how everyone is doing."
              : "Join your class with the code your teacher gave you."
          }</p>
        </div>

        ${
          isTeacher
            ? `
        <!-- Create: teacher only. The join code is minted server-side. -->
        <form class="cohort-create flex gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <label for="cohort-name-input" class="sr-only">Class name</label>
          <input
            id="cohort-name-input"
            type="text"
            maxlength="60"
            placeholder="Class name (e.g., Period 3 — AI Fundamentals)"
            class="cohort-name-input min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            type="submit"
            class="cohort-create-btn shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >Create</button>
        </form>`
            : `
        <!-- Join: any student. Idempotent server-side, so a re-tap is safe. -->
        <form class="cohort-join flex gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <label for="cohort-code-input" class="sr-only">Class code</label>
          <input
            id="cohort-code-input"
            type="text"
            maxlength="7"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            placeholder="Class code (7 characters)"
            class="cohort-code-input min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2.5 font-mono text-sm uppercase tracking-widest text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            type="submit"
            class="cohort-join-btn shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >Join</button>
        </form>`
        }

        <p class="cohort-status min-h-[1.25rem] text-sm text-rose-400" role="status" aria-live="polite"></p>

        <div class="cohort-list space-y-3"></div>
      </div>
    </div>`;

  const statusEl = host.querySelector<HTMLElement>(".cohort-status")!;
  const listEl = host.querySelector<HTMLElement>(".cohort-list")!;
  const createForm = host.querySelector<HTMLFormElement>(".cohort-create");
  const joinForm = host.querySelector<HTMLFormElement>(".cohort-join");
  const nameInput = host.querySelector<HTMLInputElement>(".cohort-name-input");
  const codeInput = host.querySelector<HTMLInputElement>(".cohort-code-input");

  function setStatus(message: string, tone: "error" | "ok" = "error"): void {
    statusEl.textContent = message;
    statusEl.classList.toggle("text-rose-400", tone === "error");
    statusEl.classList.toggle("text-emerald-400", tone === "ok");
  }

  /**
   * Writes carry the CSRF header and the cookie. GETs need only the cookie —
   * same two rules every other write in the client follows.
   */
  async function callApi<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; body: T }> {
    const res = await fetch(`${SERVER_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.method && init.method !== "GET" ? CSRF_HEADER : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, body };
  }

  function errorOf(body: unknown, fallback: string): string {
    if (body && typeof body === "object" && "error" in body) {
      const message = (body as { error?: unknown }).error;
      if (typeof message === "string" && message) return message;
    }
    return fallback;
  }

  // ------------------------------------------------------------------
  // Teacher side
  // ------------------------------------------------------------------

  function teacherCard(cohort: TeacherClass): string {
    return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5" data-class-id="${esc(cohort._id)}">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold text-slate-50">${esc(cohort.name)}</h2>
            <p class="mt-0.5 text-xs text-slate-400">${cohort.memberCount} student${cohort.memberCount === 1 ? "" : "s"}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 font-mono text-sm font-bold tracking-[0.2em] text-indigo-300">${esc(cohort.joinCode)}</span>
            <button
              type="button"
              class="cohort-copy rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-indigo-400 hover:text-white"
              data-code="${esc(cohort.joinCode)}"
            >Copy</button>
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="cohort-roster-btn rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-indigo-400 hover:text-white"
          >View roster</button>
          <button
            type="button"
            class="cohort-delete-btn ml-auto rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-rose-500/60 hover:text-rose-400"
            data-confirm="0"
          >Delete</button>
        </div>
        <!-- Filled on demand: a roster is a per-class read, not part of the list. -->
        <div class="cohort-roster mt-4 hidden border-t border-slate-800 pt-4"></div>
      </div>`;
  }

  async function loadTeacherClasses(): Promise<void> {
    const { ok, body } = await callApi<{ classes?: TeacherClass[]; error?: string }>(
      "/api/classes",
    );
    if (destroyed || !ok) return; // the status line already says enough on writes
    const classes = body.classes ?? [];
    listEl.innerHTML = classes.length
      ? classes.map(teacherCard).join("")
      : `<p class="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">No classes yet. Create one above and share its code.</p>`;
  }

  function rosterRow(member: RosterMember): string {
    const mean = meanProgress(member.courses);
    const courseLine =
      mean === null
        ? "No courses yet"
        : `${mean}% across ${member.courses.length} course${member.courses.length === 1 ? "" : "s"}`;
    const weak = member.weakPoints
      .map(
        (point) =>
          `<span class="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">${esc(point.topic)}</span>`,
      )
      .join("");
    const score = member.lastScore
      ? `<span class="text-slate-300">${member.lastScore.score}% · ${esc(member.lastScore.topic)}</span>`
      : `<span class="text-slate-500">No tests yet</span>`;

    return `
      <div class="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-slate-100">${esc(member.displayName)}</p>
            <p class="text-xs text-slate-500">@${esc(member.username)}</p>
          </div>
          <span class="text-xs ${member.activeThisWeek ? "text-emerald-400" : "text-slate-500"}">${esc(timeAgo(member.lastActiveAt))}</span>
        </div>
        <p class="mt-2 text-xs text-slate-400">${esc(courseLine)}</p>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          ${weak || `<span class="text-[11px] text-slate-600">No weak topics recorded</span>`}
        </div>
        <p class="mt-2 text-xs"><span class="text-slate-500">Last test: </span>${score}</p>
      </div>`;
  }

  function renderRoster(container: HTMLElement, payload: RosterPayload): void {
    const { summary } = payload;
    const header = `
      <div class="mb-3 flex flex-wrap gap-2">
        <span class="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">${summary.memberCount} student${summary.memberCount === 1 ? "" : "s"}</span>
        <span class="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">${summary.activeThisWeek} active this week</span>
        <span class="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">${summary.avgProgress}% avg progress</span>
        ${
          summary.neverActive
            ? `<span class="rounded-lg bg-rose-950/60 px-2.5 py-1 text-xs text-rose-300">${summary.neverActive} never opened</span>`
            : ""
        }
      </div>
      ${
        summary.commonWeakTopics.length
          ? `<p class="mb-3 text-xs text-slate-400">Common gaps: ${summary.commonWeakTopics
              .map(
                (gap) =>
                  `<span class="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">${esc(gap.topic)} (${gap.students})</span>`,
              )
              .join(" ")}</p>`
          : ""
      }`;

    container.innerHTML = header + payload.members.map(rosterRow).join("");
  }

  async function openRoster(card: HTMLElement, classId: string): Promise<void> {
    const container = card.querySelector<HTMLElement>(".cohort-roster")!;
    const button = card.querySelector<HTMLButtonElement>(".cohort-roster-btn")!;
    if (!container.classList.contains("hidden")) {
      container.classList.add("hidden");
      button.textContent = "View roster";
      return;
    }

    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const { ok, body } = await callApi<RosterPayload & { error?: string }>(
        `/api/classes/${encodeURIComponent(classId)}`,
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to load the roster."));
        return;
      }
      renderRoster(container, body);
      container.classList.remove("hidden");
      button.textContent = "Hide roster";
    } catch {
      if (!destroyed) setStatus("Could not reach the server.");
    } finally {
      if (!destroyed) button.disabled = false;
    }
  }

  async function deleteClass(card: HTMLElement, classId: string): Promise<void> {
    const button = card.querySelector<HTMLButtonElement>(".cohort-delete-btn")!;
    // Two deliberate presses, no native dialog: the first arms, the second
    // deletes, and arming expires with the component. Deleting a class drops
    // the roster mapping but never a student's own progress — the button's
    // label is the only thing standing between a mis-click and a lost roster.
    if (button.dataset.confirm !== "1") {
      button.dataset.confirm = "1";
      button.textContent = "Really delete?";
      button.classList.add("border-rose-500/60", "text-rose-400");
      return;
    }

    button.disabled = true;
    try {
      const { ok, body } = await callApi<{ error?: string }>(
        `/api/classes/${encodeURIComponent(classId)}`,
        { method: "DELETE" },
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to delete the class."));
        button.disabled = false;
        return;
      }
      setStatus("Class deleted.", "ok");
      await loadTeacherClasses();
    } catch {
      if (!destroyed) {
        setStatus("Could not reach the server.");
        button.disabled = false;
      }
    }
  }

  async function onCreateSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
      setStatus("Give the class a name first.");
      return;
    }

    busy = true;
    const button = createForm?.querySelector<HTMLButtonElement>(".cohort-create-btn");
    if (button) button.disabled = true;
    try {
      const { ok, body } = await callApi<{ error?: string }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to create the class."));
        return;
      }
      nameInput.value = "";
      setStatus("Class created — share its code with your students.", "ok");
      await loadTeacherClasses();
    } catch {
      if (!destroyed) setStatus("Could not reach the server.");
    } finally {
      if (!destroyed) {
        busy = false;
        if (button) button.disabled = false;
      }
    }
  }

  // ------------------------------------------------------------------
  // Student side
  // ------------------------------------------------------------------

  function studentCard(cohort: EnrolledClass): string {
    return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5" data-class-id="${esc(cohort._id)}">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold text-slate-50">${esc(cohort.name)}</h2>
            <p class="mt-0.5 text-xs text-slate-400">${esc(cohort.teacherName)} · ${cohort.memberCount} student${cohort.memberCount === 1 ? "" : "s"}</p>
          </div>
          <button
            type="button"
            class="cohort-leave-btn shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-rose-500/60 hover:text-rose-400"
            data-confirm="0"
          >Leave</button>
        </div>
      </div>`;
  }

  async function loadEnrolledClasses(): Promise<void> {
    const { ok, body } = await callApi<{ classes?: EnrolledClass[] }>(
      "/api/classes/enrolled",
    );
    if (destroyed || !ok) return;
    const classes = body.classes ?? [];
    listEl.innerHTML = classes.length
      ? classes.map(studentCard).join("")
      : `<p class="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">Not in a class yet. Ask your teacher for the code and enter it above.</p>`;
  }

  async function onJoinSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !codeInput) return;
    const joinCode = codeInput.value.trim().toUpperCase();
    if (!joinCode) {
      setStatus("Enter the code your teacher gave you.");
      return;
    }

    busy = true;
    const button = joinForm?.querySelector<HTMLButtonElement>(".cohort-join-btn");
    if (button) button.disabled = true;
    try {
      const { ok, body } = await callApi<{ error?: string; class?: { name: string } }>(
        "/api/classes/join",
        { method: "POST", body: JSON.stringify({ joinCode }) },
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to join the class."));
        return;
      }
      codeInput.value = "";
      setStatus(`Joined ${body.class?.name ?? "the class"}.`, "ok");
      await loadEnrolledClasses();
    } catch {
      if (!destroyed) setStatus("Could not reach the server.");
    } finally {
      if (!destroyed) {
        busy = false;
        if (button) button.disabled = false;
      }
    }
  }

  async function leaveClass(card: HTMLElement, classId: string): Promise<void> {
    const button = card.querySelector<HTMLButtonElement>(".cohort-leave-btn")!;
    // Same two-press arming as delete: leaving is reversible (the code still
    // works) but a surprise exit from a class the student is counting on is
    // still worth one deliberate tap.
    if (button.dataset.confirm !== "1") {
      button.dataset.confirm = "1";
      button.textContent = "Really leave?";
      button.classList.add("border-rose-500/60", "text-rose-400");
      return;
    }

    button.disabled = true;
    try {
      const { ok, body } = await callApi<{ error?: string }>(
        `/api/classes/${encodeURIComponent(classId)}/leave`,
        { method: "POST" },
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to leave the class."));
        button.disabled = false;
        return;
      }
      setStatus("You left the class.", "ok");
      await loadEnrolledClasses();
    } catch {
      if (!destroyed) {
        setStatus("Could not reach the server.");
        button.disabled = false;
      }
    }
  }

  // ------------------------------------------------------------------
  // Events (delegated — the list re-renders wholesale on every change)
  // ------------------------------------------------------------------

  createForm?.addEventListener("submit", (event) => void onCreateSubmit(event as SubmitEvent));
  joinForm?.addEventListener("submit", (event) => void onJoinSubmit(event as SubmitEvent));

  listEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-class-id]");
    if (!card) return;
    const classId = card.dataset.classId ?? "";

    if (target.closest(".cohort-copy")) {
      const button = target.closest<HTMLButtonElement>(".cohort-copy");
      const code = button?.dataset.code ?? "";
      // Clipboard API when available; the manual fallback exists because
      // `execCommand` is the only path on insecure origins the API refuses.
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(code).then(() => {
          if (button) {
            button.textContent = "Copied";
            setTimeout(() => {
              if (button.isConnected) button.textContent = "Copy";
            }, 1500);
          }
        });
      } else if (button) {
        button.textContent = code; // worst case: the code is already on screen
      }
      return;
    }
    if (target.closest(".cohort-roster-btn")) {
      void openRoster(card, classId);
      return;
    }
    if (target.closest(".cohort-delete-btn")) {
      void deleteClass(card, classId);
      return;
    }
    if (target.closest(".cohort-leave-btn")) {
      void leaveClass(card, classId);
    }
  });

  async function refresh(): Promise<void> {
    if (destroyed) return;
    try {
      if (isTeacher) await loadTeacherClasses();
      else await loadEnrolledClasses();
    } catch {
      if (!destroyed) setStatus("Could not reach the server.");
    }
  }

  void refresh();

  return {
    refresh,
    destroy: () => {
      destroyed = true;
    },
  };
}

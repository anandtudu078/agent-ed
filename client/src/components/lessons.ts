/**
 * Lessons — saved, replayable snapshots of a tutoring session.
 *
 * The live session is a rolling window: `Session.conversationHistory` is capped
 * so the document can never outgrow MongoDB's 16 MB limit, which means an
 * explanation the student wants to revisit quietly scrolls away as they keep
 * chatting. This panel is the other half of `routes/lessons.ts` — it lets a
 * student save the current lesson and come back to *re-watch* it later.
 *
 * Three decisions inherited from the server and the rest of the client:
 *
 * - Replay is **read-only**. A snapshot is a copy of what the tutor said, not a
 *   second live session; opening one never re-enters the socket or writes
 *   anything. It is a transcript, rendered through the same `renderMarkdown`
 *   boundary the chat uses, so tutor text stays inert data.
 * - Every write carries the CSRF header and the cookie, exactly like
 *   `cohort.ts` — the same two rules every other write in the client follows.
 * - Deletion is two-press armed, the same as leaving a class: reversible in
 *   spirit (a re-taken lesson can be saved again) but a surprise loss of a
 *   saved moment is worth one deliberate tap.
 */
import { renderMarkdown } from "./markdown";

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:3000";

/** The header that proves a request came from this app. See `requireCsrfHeader`. */
const CSRF_HEADER = { "X-Requested-With": "AgentEd" };

function esc(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface LessonSummary {
  _id: string;
  topic: string;
  courseId: string | null;
  moduleTitle: string | null;
  language: "en" | "hi";
  messageCount: number;
  savedAt: string;
}

interface LessonMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at?: string | null;
}

interface LessonDetail {
  _id: string;
  topic: string;
  courseId: string | null;
  moduleTitle: string | null;
  language: "en" | "hi";
  savedAt: string;
  messages: LessonMessage[];
}

/** "Just now" / "4h ago" / "Yesterday" / "12d ago" — or the honest absence. */
function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (ms < hour) return "Just now";
  if (ms < day) return `${Math.floor(ms / hour)}h ago`;
  const days = Math.floor(ms / day);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

export interface LessonsPanelOptions {
  /** Fired after any change so a caller can refresh its own view if it wants. */
  onChanged?: () => void;
}

export function createLessonsPanel(
  host: HTMLElement,
  options: LessonsPanelOptions = {},
): { refresh: () => Promise<void>; destroy: () => void } {
  let destroyed = false;
  let busy = false;

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

  host.innerHTML = `
    <div class="h-full overflow-y-auto px-4 py-6 scroll-smooth">
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
              Your <span class="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">lessons</span>
            </h1>
            <p class="lessons-sub mt-1 text-sm text-slate-400">
              Save a lesson while you're in it, then replay the whole thing later — even after it has scrolled out of your chat.
            </p>
          </div>
          <button
            type="button"
            class="lessons-save shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >Save current lesson</button>
        </div>

        <p class="lessons-status text-sm text-slate-400"></p>

        <div class="lessons-list space-y-3"></div>
      </div>
    </div>`;

  const listEl = host.querySelector<HTMLElement>(".lessons-list")!;
  const statusEl = host.querySelector<HTMLElement>(".lessons-status")!;
  const saveBtn = host.querySelector<HTMLButtonElement>(".lessons-save")!;

  function setStatus(message: string, tone: "ok" | "error" = "ok"): void {
    statusEl.textContent = message;
    statusEl.classList.toggle("text-emerald-300", tone === "ok" && Boolean(message));
    statusEl.classList.toggle("text-rose-300", tone === "error" && Boolean(message));
    statusEl.classList.toggle("text-slate-400", !message);
  }

  function setBusy(next: boolean, loadingLabel = "Saving…"): void {
    busy = next;
    saveBtn.disabled = next;
    saveBtn.textContent = next ? loadingLabel : "Save current lesson";
  }

  function lessonCard(lesson: LessonSummary): string {
    const label = lesson.moduleTitle ?? lesson.topic;
    const meta = [
      lesson.moduleTitle ? `Topic: ${lesson.topic}` : null,
      `${lesson.messageCount} message${lesson.messageCount === 1 ? "" : "s"}`,
      lesson.language === "hi" ? "Hindi" : "English",
      timeAgo(lesson.savedAt),
    ]
      .filter(Boolean)
      .join(" · ");
    return `
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5" data-lesson-id="${esc(lesson._id)}">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold text-slate-50">${esc(label)}</h2>
            <p class="mt-0.5 text-xs text-slate-400">${esc(meta)}</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="lessons-replay-btn rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-indigo-400 hover:text-white"
            >Replay</button>
            <button
              type="button"
              class="lessons-delete-btn rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-rose-500/60 hover:text-rose-400"
              data-confirm="0"
            >Delete</button>
          </div>
        </div>
        <!-- Filled on demand: the full transcript is a per-lesson read, not part of the list. -->
        <div class="lessons-transcript mt-4 hidden border-t border-slate-800 pt-4"></div>
      </div>`;
  }

  async function loadLessons(): Promise<void> {
    try {
      const { ok, body } = await callApi<{ lessons?: LessonSummary[]; error?: string }>(
        "/api/lessons",
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to load your lessons."), "error");
        listEl.innerHTML = "";
        return;
      }
      const lessons = body.lessons ?? [];
      if (lessons.length === 0) {
        listEl.innerHTML = `
          <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
            No saved lessons yet. Finish a lesson you want to keep and press
            <span class="font-medium text-slate-200">Save current lesson</span>.
          </div>`;
        setStatus("");
        return;
      }
      listEl.innerHTML = lessons.map(lessonCard).join("");
      setStatus("");
    } catch {
      if (!destroyed) setStatus("Could not reach the server.", "error");
    }
  }

  async function saveLesson(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const { ok, body } = await callApi<{ lesson?: LessonSummary; error?: string }>(
        "/api/lessons",
        { method: "POST", body: JSON.stringify({}) },
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to save this lesson."), "error");
        return;
      }
      setStatus("Saved. You can replay it any time.", "ok");
      await loadLessons();
      options.onChanged?.();
    } catch {
      if (!destroyed) setStatus("Could not reach the server.", "error");
    } finally {
      if (!destroyed) setBusy(false);
    }
  }


  function renderTranscript(detail: LessonDetail): string {
    const parts: string[] = [];
    for (const message of detail.messages ?? []) {
      const content = String(message.content ?? "").trim();
      if (!content) continue;
      if (message.role === "user") {
        parts.push(`
          <div class="mb-3 flex justify-end">
            <div class="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm leading-relaxed text-white whitespace-pre-wrap">${esc(content)}</div>
          </div>`);
      } else if (message.role === "assistant") {
        // The tutor's own words go through the same markdown boundary the chat
        // uses. This is a read-only replay of stored data, never re-sent to a
        // model, so it stays inert text — but it still must not be able to
        // inject markup, which is exactly why renderMarkdown escapes first.
        parts.push(`
          <div class="mb-3 flex justify-start">
            <div class="max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-950/60 px-4 py-2.5 text-sm leading-relaxed text-slate-200">
              <p class="m-0">${renderMarkdown(content)}</p>
            </div>
          </div>`);
      }
      // System messages are not part of the visible lesson; a replay shows the
      // exchange the student and tutor had, not the scaffolding behind it.
    }
    if (parts.length === 0) {
      return `<p class="text-sm text-slate-500">This lesson had no visible turns.</p>`;
    }
    return parts.join("");
  }

  async function openReplay(card: HTMLElement, lessonId: string): Promise<void> {
    const panel = card.querySelector<HTMLElement>(".lessons-transcript")!;
    const button = card.querySelector<HTMLButtonElement>(".lessons-replay-btn")!;
    if (!panel.classList.contains("hidden")) {
      panel.classList.add("hidden");
      button.textContent = "Replay";
      return;
    }
    button.disabled = true;
    button.textContent = "Loading…";
    try {
      const { ok, body } = await callApi<LessonDetail & { error?: string }>(
        `/api/lessons/${encodeURIComponent(lessonId)}`,
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to load this lesson."), "error");
        return;
      }
      panel.innerHTML = renderTranscript(body);
      panel.classList.remove("hidden");
      button.textContent = "Hide";
    } catch {
      if (!destroyed) setStatus("Could not reach the server.", "error");
    } finally {
      if (!destroyed) button.disabled = false;
    }
  }

  async function deleteLesson(card: HTMLElement, lessonId: string): Promise<void> {
    const button = card.querySelector<HTMLButtonElement>(".lessons-delete-btn")!;
    // Same two-press arming as leaving a class: reversible in spirit (the
    // lesson can be saved again), but a surprise loss of a saved moment is
    // worth one deliberate tap.
    if (button.dataset.confirm !== "1") {
      button.dataset.confirm = "1";
      button.textContent = "Really delete?";
      button.classList.add("border-rose-500/60", "text-rose-400");
      return;
    }
    button.disabled = true;
    try {
      const { ok, body } = await callApi<{ error?: string }>(
        `/api/lessons/${encodeURIComponent(lessonId)}`,
        { method: "DELETE" },
      );
      if (destroyed) return;
      if (!ok) {
        setStatus(errorOf(body, "Unable to delete this lesson."), "error");
        button.disabled = false;
        return;
      }
      setStatus("Lesson deleted.", "ok");
      await loadLessons();
      options.onChanged?.();
    } catch {
      if (!destroyed) {
        setStatus("Could not reach the server.", "error");
        button.disabled = false;
      }
    }
  }

  saveBtn.addEventListener("click", () => void saveLesson());

  listEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>("[data-lesson-id]");
    if (!card) return;
    const lessonId = card.dataset.lessonId ?? "";
    if (target.closest(".lessons-replay-btn")) {
      void openReplay(card, lessonId);
    } else if (target.closest(".lessons-delete-btn")) {
      void deleteLesson(card, lessonId);
    }
  });

  async function refresh(): Promise<void> {
    if (destroyed) return;
    await loadLessons();
  }

  void refresh();

  return {
    refresh,
    destroy: () => {
      destroyed = true;
    },
  };
}


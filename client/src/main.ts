import { io, type Socket } from "socket.io-client";
import { createMascot, type MascotStatus, type TutorMode, type TeachLanguage } from "./components/mascot";
import { splitIntoBeats, type LessonBeat } from "./components/beats";
import { sketchForBeat } from "./components/sketches";
import { visualStepCount, type VisualSpec } from "./components/diagrams";
import {
  createDashboard,
  type CourseInfo,
} from "./components/dashboard";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:3000";

// A production build without VITE_SERVER_URL silently talks to the developer's
// own machine — auth "works" locally and is a wall of 401s for everyone else.
// Vite bakes VITE_* vars in at build time, so this is a build-config error.
if (import.meta.env.PROD && !import.meta.env.VITE_SERVER_URL) {
  console.error(
    "[AgentEd] VITE_SERVER_URL is not set in this build — the app is calling " +
      "http://localhost:3000, which only works on the developer's machine. " +
      "Set VITE_SERVER_URL in the hosting provider's environment variables and rebuild.",
  );
}

// ---------------------------------------------------------------------------
// Auth state (persisted so reloads keep you signed in)
// ---------------------------------------------------------------------------

interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  language?: "en" | "hi";
}

interface AuthResponse {
  /**
   * Present for scripted clients. The browser deliberately ignores it: the real
   * credential is an httpOnly cookie the client cannot read, and re-implementing
   * that half-way is how a token ends up in `localStorage` again.
   */
  token?: string;
  refreshToken?: string;
  user: StoredUser;
}

/** The header that proves a request came from this app. See `requireCsrfHeader`. */
const CSRF_HEADER = { "X-Requested-With": "AgentEd" };

/**
 * Only the non-secret half of the session is persisted.
 *
 * The access and refresh tokens are httpOnly cookies now, so there is nothing
 * secret left to store — what remains is a display cache so the app can paint
 * the signed-in shell before the first `/api/auth/me` round trip returns. That
 * is a convenience, not a credential: it cannot be used to call the API.
 */
function loadStoredAuth(): { user: StoredUser } | null {
  try {
    const userJson = localStorage.getItem("agented:user");
    if (userJson) {
      return { user: JSON.parse(userJson) as StoredUser };
    }
  } catch {
    // Corrupted storage — fall through to signed-out state.
  }
  return null;
}

function storeAuth(auth: { user: StoredUser }): void {
  localStorage.setItem("agented:user", JSON.stringify(auth.user));
}

/**
 * In-flight refresh, shared by every caller that hits a 401 at once.
 *
 * Without this, a dashboard load that fires five requests in parallel would
 * send five refreshes with the same rotating token. Four would be rejected as
 * reuse and — correctly — revoke the whole family, logging the student out.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Trade the refresh token for a new access token, at most once per burst.
 *
 * Returns false when the session is genuinely over, so the caller can sign out
 * rather than looping on a dead credential.
 */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      // No body: the refresh token is an httpOnly cookie, so the browser attaches
      // it and JavaScript never sees it. `credentials: "include"` is what makes
      // that happen across origins.
      const res = await fetch(`${SERVER_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...CSRF_HEADER },
        credentials: "include",
      });
      if (!res.ok) return false;
      const body = (await res.json()) as AuthResponse;
      if (!body.user) return false;
      storeAuth(body);
      currentAuth = { user: body.user };
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * `fetch` that transparently renews an expired access token once.
 *
 * The student is mid-lesson when a 30-minute token expires; bouncing them to
 * the sign-in screen for that is the exact failure this exists to prevent.
 */
async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const send = () =>
    fetch(`${SERVER_URL}${path}`, {
      ...init,
      // Sends the httpOnly cookie. Without this the request is anonymous and
      // every authenticated call 401s — the single most important line here.
      credentials: "include",
      headers: {
        ...(init.headers ?? {}),
        ...CSRF_HEADER,
      },
    });

  const first = await send();
  if (first.status !== 401) return first;
  // Only retry once. Whether a refresh token exists is no longer knowable from
  // JavaScript — that is the point — so this always attempts it and lets the
  // server decide.
  if (!(await refreshAccessToken())) return first;
  return send();
}

function clearStoredAuth(): void {
  localStorage.removeItem("agented:user");
  localStorage.removeItem("agented:studentId");
  // The next sign-in may be a different student, so allow a fresh restore.
  historyRestoreStarted = false;
}

let currentAuth: { user: StoredUser } | null = loadStoredAuth();

// The session key is the authenticated username, resolved at send time
// (it is empty until sign-in, so computing it at module load would break
// the first registration).
const getStudentId = (): string => currentAuth?.user.username ?? "";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const authViewEl = document.querySelector<HTMLDivElement>("#auth-view")!;
const appViewEl = document.querySelector<HTMLDivElement>("#app-view")!;
const authFormEl = document.querySelector<HTMLFormElement>("#auth-form")!;
const authTitleEl = document.querySelector<HTMLHeadingElement>("#auth-title")!;
const authToggleLabelEl =
  document.querySelector<HTMLSpanElement>("#auth-toggle-label")!;
const authToggleLinkEl = document.querySelector<HTMLButtonElement>("#auth-toggle")!;
const authSubmitEl = document.querySelector<HTMLButtonElement>("#auth-submit")!;
const displayNameInputEl =
  document.querySelector<HTMLInputElement>("#display-name-input")!;
const usernameInputEl = document.querySelector<HTMLInputElement>("#username-input")!;
const usernameHintEl = document.querySelector<HTMLParagraphElement>("#username-hint")!;
const passwordInputEl = document.querySelector<HTMLInputElement>("#password-input")!;
const authErrorEl = document.querySelector<HTMLParagraphElement>("#auth-error")!;
const signOutButtonEl =
  document.querySelector<HTMLButtonElement>("#sign-out-button")!;
const newChatButtonEl =
  document.querySelector<HTMLButtonElement>("#new-chat-button")!;
const languageToggleEl =
  document.querySelector<HTMLButtonElement>("#language-toggle")!;
const userBadgeEl = document.querySelector<HTMLSpanElement>("#user-badge")!;

const messagesEl = document.querySelector<HTMLDivElement>("#messages")!;
const chatContainerEl = document.querySelector<HTMLElement>("#chat-container")!;
const formEl = document.querySelector<HTMLFormElement>("#chat-form")!;
const inputEl = document.querySelector<HTMLInputElement>("#message-input")!;
const sendButtonEl = document.querySelector<HTMLButtonElement>("#send-button")!;
const voiceToggleEl = document.querySelector<HTMLButtonElement>("#voice-toggle")!;
const speakerToggleEl = document.querySelector<HTMLButtonElement>("#speaker-toggle")!;
const voiceHintEl = document.querySelector<HTMLParagraphElement>("#voice-hint")!;
const statusDotEl = document.querySelector<HTMLSpanElement>("#status-dot")!;
const statusTextEl = document.querySelector<HTMLSpanElement>("#status-text")!;
const mascotHostEl = document.querySelector<HTMLDivElement>("#mascot-host")!;

// Consent step.
const consentViewEl = document.querySelector<HTMLFormElement>("#consent-view")!;
const consentDisclosureEl = document.querySelector<HTMLUListElement>("#consent-disclosure")!;
const consentGuardianEl = document.querySelector<HTMLDivElement>("#consent-guardian")!;
const consentGuardianNameEl =
  document.querySelector<HTMLInputElement>("#consent-guardian-name")!;
const consentGuardianCheckEl =
  document.querySelector<HTMLInputElement>("#consent-guardian-check")!;
const consentTermsEl = document.querySelector<HTMLInputElement>("#consent-terms")!;
const consentErrorEl = document.querySelector<HTMLParagraphElement>("#consent-error")!;
const consentExportEl = document.querySelector<HTMLButtonElement>("#consent-export")!;
const consentSignOutEl = document.querySelector<HTMLButtonElement>("#consent-signout")!;

// The privacy notice, readable before signup.
const aboutViewEl = document.querySelector<HTMLDivElement>("#about-view")!;
const aboutDisclosureEl = document.querySelector<HTMLUListElement>("#about-disclosure")!;
const aboutVersionEl = document.querySelector<HTMLSpanElement>("#about-version")!;
const aboutLinkEl = document.querySelector<HTMLButtonElement>("#about-link")!;
const aboutLinkConsentEl = document.querySelector<HTMLButtonElement>("#about-link-consent")!;
const aboutCloseEl = document.querySelector<HTMLButtonElement>("#about-close")!;

/**
 * Instructional mode. The owl's own display toggle owns this; main.ts just
 * forwards it with each message and uses it to label the connection notice.
 */
let tutorMode: TutorMode = "socratic";
const mascot = createMascot(mascotHostEl, (next) => {
  tutorMode = next;
});

// ---------------------------------------------------------------------------
// Additional UI elements
// ---------------------------------------------------------------------------

const authSubmitLabelEl =
  document.querySelector<HTMLSpanElement>("#auth-submit-label")!;
const authSpinnerEl = document.querySelector<HTMLSpanElement>("#auth-spinner")!;
const passwordToggleEl =
  document.querySelector<HTMLButtonElement>("#password-toggle")!;
const passwordStrengthEl =
  document.querySelector<HTMLDivElement>("#password-strength")!;
const passwordStrengthLabelEl =
  document.querySelector<HTMLParagraphElement>("#password-strength-label")!;
const strengthBars = Array.from(
  document.querySelectorAll<HTMLSpanElement>("#password-strength .strength-bar"),
);

const emptyStateEl = document.querySelector<HTMLElement>("#empty-state")!;
const typingIndicatorEl =
  document.querySelector<HTMLDivElement>("#typing-indicator")!;
const scrollBottomEl =
  document.querySelector<HTMLButtonElement>("#scroll-bottom")!;
const sendLabelEl = document.querySelector<HTMLSpanElement>("#send-label")!;
const sendSpinnerEl = document.querySelector<HTMLSpanElement>("#send-spinner")!;
const charCountEl = document.querySelector<HTMLSpanElement>("#char-count")!;
const suggestionChips = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".suggestion-chip"),
);

const MAX_MESSAGE_LENGTH = 2000;
const SCROLL_FAB_THRESHOLD = 48;

function isScrolledToBottom(): boolean {
  const { scrollTop, scrollHeight, clientHeight } = chatContainerEl;
  return scrollHeight - scrollTop - clientHeight < SCROLL_FAB_THRESHOLD;
}

function scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
  chatContainerEl.scrollTo({ top: chatContainerEl.scrollHeight, behavior });
}

/** Show the "jump to latest" button only when the user has scrolled away. */
function updateScrollButton(): void {
  const show = !isScrolledToBottom() && messagesEl.childElementCount > 0;
  scrollBottomEl.classList.toggle("hidden", !show);
  scrollBottomEl.classList.toggle("flex", show);
}

/** "The owl is thinking" indicator (lives outside #messages). */
function setTyping(visible: boolean): void {
  typingIndicatorEl.classList.toggle("hidden", !visible);
  typingIndicatorEl.classList.toggle("flex", visible);
  if (visible) scrollToBottom();
}

function setEmptyStateVisible(visible: boolean): void {
  emptyStateEl.classList.toggle("hidden", !visible);
  emptyStateEl.classList.toggle("flex", visible);
  if (!visible) updateScrollButton();
}

const CHAR_COUNT_BASE_CLASS =
  "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums transition-colors ";

function updateCharCount(): void {
  const length = inputEl.value.length;
  if (length === 0) {
    charCountEl.textContent = "";
    charCountEl.className = `${CHAR_COUNT_BASE_CLASS}text-slate-600`;
    return;
  }
  const remaining = MAX_MESSAGE_LENGTH - length;
  charCountEl.textContent = String(remaining);
  // Draw attention as the student approaches the limit.
  charCountEl.className =
    CHAR_COUNT_BASE_CLASS + (remaining <= 200 ? "text-amber-400" : "text-slate-600");
}

function setAuthLoading(loading: boolean): void {
  authSubmitEl.disabled = loading;
  authSpinnerEl.classList.toggle("hidden", !loading);
  authSubmitLabelEl.textContent = loading
    ? isRegisterMode
      ? "Creating account…"
      : "Signing in…"
    : isRegisterMode
      ? "Sign Up"
      : "Sign In";
}
const dashboardToggleEl = document.querySelector<HTMLButtonElement>("#dashboard-toggle")!;
const dashboardViewEl = document.querySelector<HTMLElement>("#dashboard-view")!;
const dashboardHostEl = document.querySelector<HTMLDivElement>("#dashboard-host")!;
const owlStageEl = document.querySelector<HTMLElement>("#owl-stage")!;
// The chat wrapper (not just #chat-container) must be hidden with the chat:
// it is a flex-1 sibling of #dashboard-view, so leaving it visible while
// empty makes it claim half the screen and the dashboard renders squashed.
const chatWrapperEl = document.querySelector<HTMLElement>("#chat-wrapper")!;
const controlBarEl = document.querySelector<HTMLElement>("#control-bar")!;

// ---------------------------------------------------------------------------
// Password affordances (reveal toggle + strength meter)
// ---------------------------------------------------------------------------

/** Rough 0–4 strength score: length, variety, and character-class mixing. */
function scorePassword(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^\w\s]/.test(password)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH_COLORS = [
  "bg-slate-700",
  "bg-rose-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-emerald-500",
];

const STRENGTH_LABELS = [
  "Use 8+ characters — mix letters, numbers and symbols.",
  "Weak — a few more characters would help.",
  "Fair — mix in numbers or symbols.",
  "Good — a little longer would be better.",
  "Strong password.",
];

function updatePasswordStrength(): void {
  // Only meaningful while registering; hide entirely in sign-in mode.
  if (!isRegisterMode) {
    passwordStrengthEl.classList.add("hidden");
    return;
  }
  passwordStrengthEl.classList.remove("hidden");

  const score = scorePassword(passwordInputEl.value);
  strengthBars.forEach((bar, index) => {
    bar.className = `strength-bar h-1 flex-1 rounded-full transition-colors ${
      index < score ? STRENGTH_COLORS[score] : "bg-slate-700"
    }`;
  });
  passwordStrengthLabelEl.textContent = STRENGTH_LABELS[score];
  passwordStrengthLabelEl.className =
    "text-[11px] " +
    (score >= 4 ? "text-emerald-400" : score >= 3 ? "text-sky-400" : "text-slate-500");
}

function initPasswordAffordances(): void {
  passwordToggleEl.addEventListener("click", () => {
    const reveal = passwordInputEl.type === "password";
    passwordInputEl.type = reveal ? "text" : "password";
    const label = reveal ? "Hide password" : "Show password";
    passwordToggleEl.title = label;
    passwordToggleEl.setAttribute("aria-label", label);
    passwordInputEl.focus();
  });
  passwordInputEl.addEventListener("input", updatePasswordStrength);
}

// ---------------------------------------------------------------------------
// AI status (drives the Wise Owl mascot)
// ---------------------------------------------------------------------------

type AiStatus = MascotStatus;
let aiStatus: AiStatus = "idle";
let speakingRevertTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Dashboard view (lazy; toggled from the header)
// ---------------------------------------------------------------------------

let dashboard: ReturnType<typeof createDashboard> | null = null;
let dashboardVisible = false;

function setDashboardVisible(visible: boolean): void {
  dashboardVisible = visible;
  dashboardViewEl.classList.toggle("hidden", !visible);
  owlStageEl.classList.toggle("hidden", visible);
  chatContainerEl.classList.toggle("hidden", visible);
  chatWrapperEl.classList.toggle("hidden", visible);
  controlBarEl.classList.toggle("hidden", visible);
  dashboardToggleEl.setAttribute("aria-pressed", String(visible));
  dashboardToggleEl.classList.toggle("border-indigo-500/60", visible);
  dashboardToggleEl.classList.toggle("text-indigo-300", visible);
  if (visible && currentAuth && !dashboard) {
    dashboard = createDashboard(
      dashboardHostEl,
      currentAuth.user.username,
      (course: CourseInfo, nextModule?: { title: string; topic: string } | null) => {
        // "Continue Learning" → jump into a Socratic chat on the module the
        // student hasn't reached yet, rather than a generic "tell me about it".
        setDashboardVisible(false);
        if (!socket?.connected) return;
        const prompt = nextModule
          ? `I'm working through ${course.title} (${course.level}). Next module is "${nextModule.title}". Can you start with a question that gets me thinking about ${nextModule.topic}?`
          : `I want to learn about ${course.title} (${course.category}). Can you start with ${course.level} level questions?`;
        appendMessage("student", prompt);
        setBusy(true);
        mascot.clearMessage();
        stopOwlSpeech();
        resumeMicAfterSpeech();
        setAiStatus("thinking");
        responseEpoch = conversationEpoch;
    socket.emit("student-message", {
          studentId: getStudentId(),
          activeTopic: (nextModule?.topic ?? course.title).slice(0, 60),
          mode: tutorMode,
          studentMessage: prompt,
        });
      },
      (topic: string) => {
        // "Work on this with the tutor" → reopen the chat on the flagged topic.
        setDashboardVisible(false);
        if (!socket?.connected) return;
        const prompt = `We just tested me on ${topic} and it was my weakest area. Can you walk me through it step by step?`;
        appendMessage("student", prompt);
        setBusy(true);
        mascot.clearMessage();
        stopOwlSpeech();
        resumeMicAfterSpeech();
        setAiStatus("thinking");
        responseEpoch = conversationEpoch;
    socket.emit("student-message", {
          studentId: getStudentId(),
          activeTopic: topic.slice(0, 60),
          mode: tutorMode,
          studentMessage: prompt,
        });
      },
      // The owl reacts to the grade. Score bands are deliberately generous at
      // the bottom: a beginner getting 40 has understood plenty, and an owl
      // that shrugs at 40 teaches them to give up.
      (score: number) => {
        const outcome =
          score >= 90 ? "great" : score >= 70 ? "correct" : score >= 40 ? "close" : "wrong";
        // Cut off any explanation still in flight. The student has just answered
        // a question, so the lesson they were mid-way through is stale, and a
        // beat loop that keeps running would talk over the reaction they are
        // about to get — and re-assert its own mood on every beat, so the
        // reaction could never settle.
        stopOwlSpeech();
        if (mascot.react(outcome)) {
          setAiStatus("speaking");
          speakOwlMessage(mascot.message() ?? "");
        }
      },
    );
  }
}

function setAiStatus(next: AiStatus): void {
  if (aiStatus === next) return;
  aiStatus = next;
  mascot.setStatus(next);

  // "speaking" is a momentary celebration: the owl calms down after 4 s, but
  // the tutor's guidance stays on its classroom display (see setMessage).
  if (next === "speaking") {
    if (speakingRevertTimer) clearTimeout(speakingRevertTimer);
    speakingRevertTimer = setTimeout(() => setAiStatus("idle"), 4000);
  }
}

let isRegisterMode = false;

// ---------------------------------------------------------------------------
// Socket connection (auth token passed in the handshake)
// ---------------------------------------------------------------------------

let socket: Socket | null = null;

function connectSocket(): void {
  if (!currentAuth) return;

  socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    // No token to send — the session cookie rides along automatically. This is
    // the socket equivalent of `credentials: "include"`, and without it the
    // handshake is rejected as unauthenticated.
    withCredentials: true,
  });

  socket.on("connect", () => {
    setConnectionStatus("connected");
    appendMessage(
      "system",
      tutorMode === "teach"
        ? "Connected to AgentEd. Teaching mode is on — name a topic and I'll explain it."
        : "Connected to AgentEd. Ask me about any concept — I'll guide you with questions instead of answers.",
    );
  });

  socket.on("disconnect", (reason) => {
    setConnectionStatus("disconnected");
    appendMessage("system", `Disconnected (${reason}). Trying to reconnect…`);
  });

  socket.on("connect_error", (error: Error) => {
    // The backend rejects the handshake when the token is missing/expired.
    //
    // Do NOT tear the session down on this alone. `signOut()` clears the auth
    // cookies, and a socket handshake can be refused for reasons that have
    // nothing to do with whether the session is alive — a CORS or proxy hiccup,
    // a dropped connection during a reconnect, the 401 racing a token refresh.
    // Signing out on those turns a recoverable blip into a dead session, and the
    // student sees "Authentication required" on whatever screen they are next
    // (most painfully, mid-consent).
    //
    // So confirm against the REST API first — `authedFetch` renews the token on
    // the way — and only sign out when the session really is gone.
    if (
      error.message.includes("Authentication required") ||
      error.message.includes("Session expired")
    ) {
      void (async () => {
        try {
          const res = await authedFetch("/api/auth/me");
          if (res.ok) {
            // The session is fine; the socket is the problem. Leave the student
            // signed in and let the automatic reconnect try again.
            setConnectionStatus("disconnected");
            appendMessage(
              "system",
              "Lost the live connection. Retrying — your work is safe.",
            );
            return;
          }
        } catch {
          // Genuinely unreachable: keep the session, same reasoning.
          setConnectionStatus("disconnected");
          return;
        }
        await signOut("Your session expired. Please sign in again.");
      })();
      return;
    }
    setConnectionStatus("error");
  });

  socket.on("socratic-response", handleSocraticResponse);

  socket.on("ai-error", (payload: { message: string }) => {
    appendMessage("system", `Something went wrong: ${payload.message}`);
    setBusy(false);
    mascot.clearMessage();
    setAiStatus("idle");
  });
}

/**
 * Bumped whenever the conversation is discarded. A reply that arrives for an
 * older epoch belongs to a thread the student already threw away, so it is
 * dropped rather than rendered.
 */
let conversationEpoch = 0;
/** The epoch a reply was requested under; mirrors the emit sites. */
let responseEpoch = 0;

/** Shared handler so tests can drive the exact same client path (DEV only). */
function handleSocraticResponse(payload: { response: string; visual?: VisualSpec | null }): void {
  // Drop a reply that was already in flight when the student started a new
  // chat: it belongs to a conversation they deliberately discarded.
  if (conversationEpoch !== responseEpoch) return;
  appendMessage("tutor", payload.response);
  setBusy(false);
  setAiStatus("speaking");
  // The owl is the visual teacher: it shows the guidance on its display…
  mascot.setMessage(payload.response);
  // …draws a diagram for the topic when the tutor sent one…
  mascot.setVisual(payload.visual ?? null);
  // …and explains it aloud. Speaking is on by default; the microphone stays
  // opt-in, because listening is a permission prompt the student should choose.
  if (speakingEnabled) {
    speakOwlMessage(payload.response, payload.visual ?? null);
  } else {
    // Still walk the diagram so the visuals read as a sequence, not a poster.
    playSilentVisualWalkthrough(payload.visual ?? null);
  }
}

function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  setConnectionStatus("disconnected");
}

// ---------------------------------------------------------------------------
// Auth UI
// ---------------------------------------------------------------------------

/**
 * Server-side transcript for the signed-in student. Roles come straight from
 * the Session model: user / assistant / system.
 */
interface StoredConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * The diagram drawn for this reply, if it had one. Stored server-side so the
   * board is not blank on reload.
   */
  visual?: VisualSpec | null;
}

const ROLE_TO_UI: Record<StoredConversationMessage["role"], "student" | "tutor" | "system"> = {
  user: "student",
  assistant: "tutor",
  system: "system",
};

let historyRestoreStarted = false;

function clearMessages(): void {
  messagesEl.replaceChildren();
}

/**
 * Replay the stored conversation into the chat.
 *
 * The server has been keeping this the whole time (capped at 200 messages) and
 * exposes an owner-checked endpoint for it, but nothing ever called it — so a
 * reload, or signing in from another device, showed an empty chat even though
 * the tutor still had full memory of the student.
 */
async function restoreSessionHistory(): Promise<void> {
  const studentId = getStudentId();
  if (!studentId || historyRestoreStarted) return;
  historyRestoreStarted = true;

  try {
    const res = await authedFetch(
      `/api/sessions/${encodeURIComponent(studentId)}`,
    );
    // 404 just means this is a brand-new student with no session yet.
    if (!res.ok) return;

    const body = (await res.json()) as {
      conversationHistory?: StoredConversationMessage[];
      returning?: {
        isFirstRun: boolean;
        isReturn: boolean;
        dueCount: number;
        resumeTopic: string | null;
        leftMidQuestion: boolean;
        greeting: string;
      };
      starterCourse?: { title: string; topic: string };
    };
    const history = body.conversationHistory ?? [];
    const returning = body.returning;

    // A student coming back should be greeted by the character, not shown a
    // replayed transcript and a silent owl. This is the one moment where all the
    // adaptive work pays off visibly, so it is the owl's opening line.
    if (returning?.isReturn && returning.greeting) {
      mascot.setLanguage(teachLanguage);
      mascot.setMessage(returning.greeting);
      mascot.setMood("happy");
      appendMessage("system", returning.greeting);
    }

    // Nothing at all yet: offer a way in instead of 27 courses and no opinion.
    if (returning?.isFirstRun && body.starterCourse) {
      showWelcome(body.starterCourse);
      return;
    }

    if (!history.length) return;

    // The student may have started a new message while this was in flight.
    // Clobbering that would lose what they just typed, so stand down.
    if (messagesEl.querySelector(".justify-end, .justify-start")) return;

    clearMessages();
    appendMessage("system", "Picking up where you left off:");
    // Put the board back to the most recent diagram in the thread. The owl's
    // display shows one diagram at a time, so replaying an old one would be
    // noise; the newest is the one the student was last looking at.
    let latestVisual: VisualSpec | null = null;
    for (const message of history) {
      appendMessage(ROLE_TO_UI[message.role] ?? "system", message.content);
      if (message.visual) latestVisual = message.visual;
    }
    if (latestVisual) {
      mascot.setVisual(latestVisual);
      // Step 0 is highlighted so the restored board reads as "in progress"
      // rather than a finished poster.
      mascot.setVisualStep(0);
    }
  } catch {
    // History is a convenience, never a reason to block the app from loading.
  }
}

/**
 * A brand-new student's first screen.
 *
 * The catalog is 27 courses and a blank chat is a wall: nothing says where to
 * begin. This offers one concrete next step, or lets them straight into asking.
 * Not a tour - a first run should be one click to useful, or one click to skip.
 */
function showWelcome(starter: { title: string; topic: string }): void {
  mascot.setLanguage(teachLanguage);
  mascot.setMood("curious");
  mascot.setMessage(
    "Hoo! I'm your AI tutor. Start wherever you like, or let me point you at the beginning.",
  );
  setEmptyStateVisible(true);
  emptyStateEl.innerHTML = `
    <div class="mx-auto w-full max-w-md space-y-3 text-center">
      <p class="text-sm text-slate-300">Not sure where to start?</p>
      <button
        type="button"
        id="begin-starter"
        class="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-500"
      >
        Start with ${escapeHtml(starter.title)}
      </button>
      <p class="text-xs text-slate-500">or just ask a question below</p>
    </div>`;
  document
    .querySelector<HTMLButtonElement>("#begin-starter")
    ?.addEventListener("click", () => {
      inputEl.value = `I want to learn about ${starter.topic}. Where should I begin?`;
      updateCharCount();
      inputEl.focus();
      formEl.requestSubmit();
    });
}

/** Escape text before it goes into innerHTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Clear the server-side thread and start a fresh conversation. */
async function startNewChat(): Promise<void> {
  // Invalidate anything already in flight before we clear, so a late reply
  // can't repopulate the thread we are about to discard.
  conversationEpoch += 1;
  // Stop the owl too. Bumping the epoch alone is not enough: it invalidates
  // incoming REPLIES, but a beat playthrough that is already running is driven
  // locally, so it carried on regardless. Clearing the thread under a running
  // lesson left the owl talking — or, once turn-taking landed, waiting for an
  // answer to a question that had just been deleted from the screen.
  stopOwlSpeech();
  const studentId = getStudentId();
  try {
    await authedFetch(`/api/sessions/${encodeURIComponent(studentId)}`, {
      method: "DELETE",
    });
  } catch {
    // Even if the reset fails, clear locally so the UI isn't stuck.
  }
  clearMessages();
  setEmptyStateVisible(true);
  appendMessage("system", "New conversation started.");
  scrollToBottom();
  inputEl.focus();
}

/**
 * Paint the signed-in shell WITHOUT touching the network.
 *
 * Split out from `showApp()` because of boot ordering. Painting from the cached
 * profile is fine, but `showApp()` also opened the socket and fetched session
 * history — and calling it before `/api/auth/me` confirmed the session meant a
 * student with a dead cookie saw `GET /api/sessions/... 401` and a refused
 * socket handshake fire *while the sign-in screen was on display*. The console
 * filled with 401s on a page that is supposed to be anonymous, and the socket
 * rejection then tripped the sign-out path on top of it.
 *
 * So: paint eagerly, authenticate, then connect. The 401s belong to the app, not
 * to the login page.
 */
function paintAppShell(): void {
  authViewEl.classList.add("hidden");
  appViewEl.classList.remove("hidden");
  if (currentAuth) {
    userBadgeEl.textContent = `👤 ${currentAuth.user.displayName}`;
    // The stored preference wins on boot, so the owl greets a returning
    // student in the language they chose rather than resetting to English.
    teachLanguage = currentAuth.user.language === "hi" ? "hi" : "en";
    mascot.setLanguage(teachLanguage);
    languageToggleEl.setAttribute("aria-pressed", String(teachLanguage === "hi"));
    languageToggleEl.textContent = teachLanguage === "hi" ? "हिंदी" : "EN";
  }
  setDashboardVisible(false);
}

/**
 * Everything that needs a confirmed session: the live socket and the saved
 * conversation. Called once the server has vouched for the session.
 */
function startSessionServices(): void {
  connectSocket();
  // Non-blocking: the app is usable while this is in flight.
  void restoreSessionHistory();
}

function showApp(): void {
  paintAppShell();
  startSessionServices();
  inputEl.focus();
}

function showAuth(): void {
  appViewEl.classList.add("hidden");
  authViewEl.classList.remove("hidden");
  authErrorEl.textContent = "";
  // The consent form belongs to the signed-out surface, so leaving it up would
  // show a student two forms at once after they sign back out.
  consentViewEl.classList.add("hidden");
  // Same reasoning for the notice: it lives inside the auth view, so a sign-out
  // mid-read would otherwise leave it sitting over the sign-in form.
  aboutViewEl.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Mirrors of the server's rules (`src/services/consent.ts`).
 *
 * These exist to explain the requirement before the student hits it, not to
 * enforce it — the server is the only thing that decides, and it re-reads the
 * record on every AI call. A client that agreed to enforce would be a client that
 * can be made to skip it, which is the opposite of the point.
 */
const MINOR_AGE_BANDS = ["under-13", "13-17"];

let consentGranted = false;

/** Render the notice and show the step. */
async function showConsentStep(): Promise<void> {
  authViewEl.classList.remove("hidden");
  appViewEl.classList.add("hidden");
  consentViewEl.classList.remove("hidden");
  authFormEl.classList.add("hidden");
  consentErrorEl.textContent = "";
  consentGuardianEl.classList.add("hidden");

  // The notice comes from the API, so the version shown is the version that gets
  // recorded. A hard-coded copy here would drift and quietly change what people
  // agreed to.
  try {
    const res = await authedFetch("/api/auth/consent/policy");
    const body = (await res.json()) as { disclosure?: string[] };
    const lines = body.disclosure ?? [];
    consentDisclosureEl.replaceChildren(
      ...lines.map((line) => {
        const li = document.createElement("li");
        li.className = "flex gap-2 text-xs leading-relaxed text-slate-300";
        const dot = document.createElement("span");
        dot.className = "text-indigo-400";
        dot.textContent = "•";
        const text = document.createElement("span");
        // textContent, never innerHTML: the disclosure is our copy today, but a
        // future editor making it configurable should not be able to introduce
        // an injection point by accident.
        text.textContent = line;
        li.append(dot, text);
        return li;
      }),
    );
  } catch {
    consentDisclosureEl.replaceChildren();
  }
}

// ---------------------------------------------------------------------------
// The privacy notice (about view)
// ---------------------------------------------------------------------------
//
// The same copy the consent step shows, fetched from the same public endpoint,
// so a person reading this before they create an account is reading exactly what
// they will be asked to agree to — and a judge comparing the two surfaces finds
// them identical because there is only one source, PRIVACY_DISCLOSURE in
// src/services/consent.ts.
//
// The endpoint is deliberately reached with a plain fetch rather than
// `authedFetch`: this screen is shown on the login page, before anyone is
// signed in, and going through the auth path would attach a refresh attempt to
// a page that is supposed to be anonymous. The route is public for that reason.

let aboutPolicyCache: { version: string; disclosure: string[] } | null = null;

function renderAboutDisclosure(
  version: string,
  lines: readonly string[],
): void {
  aboutDisclosureEl.replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement("li");
      li.className = "flex gap-2 leading-relaxed";
      const dot = document.createElement("span");
      dot.className = "text-indigo-400";
      dot.textContent = "•";
      const text = document.createElement("span");
      // textContent, not innerHTML — same reasoning as the consent step.
      text.textContent = line;
      li.append(dot, text);
      return li;
    }),
  );
  aboutVersionEl.textContent = version;
}

function showAbout(): void {
  aboutViewEl.classList.remove("hidden");
  aboutCloseEl.focus();

  // The notice is worth having even if the app is half-loaded, so this never
  // gates the dialog itself — only its contents.
  if (aboutPolicyCache) {
    renderAboutDisclosure(aboutPolicyCache.version, aboutPolicyCache.disclosure);
    return;
  }

  void (async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/auth/consent/policy`, {
        headers: { ...CSRF_HEADER },
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        version?: string;
        disclosure?: string[];
      };
      if (!Array.isArray(body.disclosure) || !body.version) throw new Error("shape");
      aboutPolicyCache = { version: body.version, disclosure: body.disclosure };
      renderAboutDisclosure(body.version, body.disclosure);
    } catch {
      // Say so rather than rendering an empty list. A privacy notice that
      // silently comes back blank is the one failure worth being loud about:
      // the student would read "no data is stored" into an empty box.
      aboutVersionEl.textContent = "unavailable";
      aboutDisclosureEl.replaceChildren();
      const li = document.createElement("li");
      li.className = "text-xs text-amber-200";
      li.textContent =
        "The disclosure could not be loaded, so it is not safe to agree to anything yet. " +
        "Reload the page, or read it in the project's README.";
      aboutDisclosureEl.append(li);
    }
  })();
}

function hideAbout(): void {
  aboutViewEl.classList.add("hidden");
}

aboutLinkEl.addEventListener("click", showAbout);
aboutLinkConsentEl.addEventListener("click", showAbout);
aboutCloseEl.addEventListener("click", hideAbout);
// Escape closes it. A dialog you cannot back out of with the keyboard is a
// dialog that traps someone using a screen reader or a switch device.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !aboutViewEl.classList.contains("hidden")) hideAbout();
});

function hideConsentStep(): void {
  consentViewEl.classList.add("hidden");
  authFormEl.classList.remove("hidden");
}

/** The guardian block appears only once an under-18 band is selected. */
for (const radio of consentViewEl.querySelectorAll<HTMLInputElement>(
  'input[name="consent-age"]',
)) {
  radio.addEventListener("change", () => {
    const isMinor = MINOR_AGE_BANDS.includes(radio.value);
    consentGuardianEl.classList.toggle("hidden", !isMinor);
    // Clear the guardian fields when switching to an adult band, so a stale name
    // cannot be submitted against an age that does not need one.
    if (!isMinor) {
      consentGuardianNameEl.value = "";
      consentGuardianCheckEl.checked = false;
    }
  });
}

consentViewEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  consentErrorEl.textContent = "";

  const ageBand =
    consentViewEl.querySelector<HTMLInputElement>('input[name="consent-age"]:checked')
      ?.value ?? "";

  try {
    const res = await authedFetch("/api/auth/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...CSRF_HEADER },
      body: JSON.stringify({
        ageBand,
        acceptedTerms: consentTermsEl.checked,
        guardianName: consentGuardianNameEl.value,
        guardianAccepted: consentGuardianCheckEl.checked,
      }),
    });
    const body = (await res.json()) as { error?: string; canUseAi?: boolean };

    // The same 401 as the GET in `ensureConsent`, and the same trap: it means the
    // session is gone, not that the answer was wrong. Showing "Authentication
    // required." in the form and leaving it up is the worst option available —
    // the notice is now unsubmittable, but the student has no reason to know
    // that, so they fill it in again and press the button again. Each attempt
    // fires another 401 + refresh 400, which is exactly the console pattern this
    // was found from. Sign out so they land on a screen they can act on.
    if (res.status === 401) {
      await signOut();
      return;
    }

    if (!res.ok || body.canUseAi !== true) {
      consentErrorEl.textContent = body.error ?? "Please complete this step.";
      return;
    }
    consentGranted = true;
    hideConsentStep();
    showApp();
  } catch {
    consentErrorEl.textContent = "Could not reach the server. Please try again.";
  }
});

consentSignOutEl.addEventListener("click", () => void signOut());

/**
 * "See what we already hold" — the export, opened in a new tab.
 *
 * Available before consent is given, which is deliberate: the right to see your
 * data does not depend on having agreed to anything.
 */
consentExportEl.addEventListener("click", () => {
  window.open(`${SERVER_URL}/api/account/export`, "_blank", "noopener");
});

/**
 * Ask the server whether this account may use the AI features.
 *
 * Every entry point calls this — sign-up, sign-in, reload — rather than assuming
 * a successful authentication means a usable account. It costs one request, and
 * it is the only way a student whose consent has gone stale finds out.
 */
async function ensureConsent(): Promise<void> {
  try {
    const res = await authedFetch("/api/auth/consent");
    const body = (await res.json()) as { canUseAi?: boolean; error?: string };

    // A 401 is "you are not signed in", NOT "you have not agreed". `authedFetch`
    // RETURNS a 401 rather than throwing, so without this branch the code fell
    // straight through to `showConsentStep()` and rendered the consent form for
    // somebody with no session at all. They fill it in, press continue, and the
    // POST is rejected with a bare "Authentication required." — a form that is
    // impossible to submit, with no explanation. Sign out properly instead, so
    // they get the sign-in screen they can actually act on.
    if (res.status === 401) {
      await signOut();
      return;
    }

    if (body.canUseAi === true) {
      consentGranted = true;
      hideConsentStep();
      return;
    }
  } catch {
    // Offline. Do not block: the server refuses the AI calls anyway if consent is
    // genuinely missing, and locking a student out of the app because their
    // network blipped is worse than showing them the app.
    return;
  }
  consentGranted = false;
  await showConsentStep();
}

function setAuthMode(register: boolean): void {
  isRegisterMode = register;
  authTitleEl.textContent = register ? "Create your account" : "Welcome back";
  // NB: write to the label span — assigning to the button's textContent would
  // wipe out the spinner element.
  authSubmitLabelEl.textContent = register ? "Sign Up" : "Sign In";
  authToggleLabelEl.textContent = register
    ? "Already have an account?"
    : "New to AgentEd?";
  authToggleLinkEl.textContent = register ? "Sign in" : "Create an account";
  displayNameInputEl.classList.toggle("hidden", !register);
  usernameHintEl.classList.toggle("hidden", !register);
  passwordInputEl.placeholder = register
    ? "Password (8+ characters)"
    : "Password";
  passwordInputEl.autocomplete = register ? "new-password" : "current-password";
  authErrorEl.textContent = "";
  updatePasswordStrength();
}

/**
 * Sign out.
 *
 * Awaits the server's logout before returning to the auth screen. That ordering
 * is the whole point: the credential is a cookie now, so "signed out" is only
 * true once the browser has actually discarded it. Showing the auth screen while
 * the logout is still in flight meant a reload could land the student straight
 * back in — the exact failure the "silently signs them back in" comment below
 * used to describe.
 *
 * The local state is cleared regardless of whether the call succeeds. A student
 * who clicks sign out must end up signed out on this device even if the network
 * is down; the server-side revoke is best effort, the cookie removal is not.
 */
async function signOut(message?: string): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/api/auth/logout`, {
      method: "POST",
      headers: { ...CSRF_HEADER },
      credentials: "include",
    });
  } catch {
    // Offline or the API is down. Continue with the local sign-out anyway.
  }
  disconnectSocket();
  clearStoredAuth();
  currentAuth = null;
  messagesEl.replaceChildren();
  setEmptyStateVisible(true);
  inputEl.value = "";
  updateCharCount();
  updateScrollButton();
  stopOwlSpeech();
  micSuspendedForSpeech = false;
  mascot.clearMessage();
  setAiStatus("idle");
  dashboard?.destroy();
  dashboard = null;
  setDashboardVisible(false);
  if (message) appendAuthError(message);
  showAuth();
}

function appendAuthError(text: string): void {
  authErrorEl.textContent = text;
}

authToggleLinkEl.addEventListener("click", () => setAuthMode(!isRegisterMode));

signOutButtonEl.addEventListener("click", () => void signOut());

newChatButtonEl.addEventListener("click", () => {
  void startNewChat();
});

// Mirror of the backend's rules (src/routes/auth.ts) so users get instant,
// friendly feedback instead of discovering them via a 400 response.
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,32}$/;

authFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  authErrorEl.textContent = "";

  const username = usernameInputEl.value.trim().toLowerCase();
  const password = passwordInputEl.value;

  if (!username || !password) {
    appendAuthError("Username and password are required.");
    return;
  }

  if (isRegisterMode) {
    if (!USERNAME_PATTERN.test(username)) {
      appendAuthError(
        "Usernames are 3–32 characters — letters, numbers, dots, dashes, or underscores (no spaces).",
      );
      return;
    }
    if (password.length < 8) {
      appendAuthError("Passwords need at least 8 characters.");
      return;
    }
  }

  const endpoint = isRegisterMode ? "/api/auth/register" : "/api/auth/login";
  const body = isRegisterMode
    ? { username, password, displayName: displayNameInputEl.value.trim() || username }
    : { username, password };

  setAuthLoading(true);
  try {
    const response = await fetch(`${SERVER_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...CSRF_HEADER },
      // Without this the `Set-Cookie` on the response is discarded and the
      // student appears to sign in and then immediately 401s on every call.
      credentials: "include",
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as AuthResponse & { error?: string };

    if (!response.ok) {
      appendAuthError(data.error ?? "Authentication failed.");
      return;
    }

    storeAuth(data);
    currentAuth = { user: data.user };
    // Consent is checked on every sign-in, not just sign-up: an account created
    // before the flow existed, or one whose consent has gone stale against the
    // current policy version, lands on the notice here.
    await ensureConsent();
    if (consentGranted) showApp();
  } catch {
    appendAuthError("Could not reach the server. Is the backend running?");
  } finally {
    setAuthLoading(false);
  }
});

// ---------------------------------------------------------------------------
// Chat UI
// ---------------------------------------------------------------------------

function setConnectionStatus(state: "connected" | "disconnected" | "error") {
  statusDotEl.className =
    "h-1.5 w-1.5 rounded-full " +
    (state === "connected"
      ? "bg-emerald-400"
      : state === "error"
        ? "bg-rose-500"
        : "bg-amber-400");
  statusTextEl.textContent =
    state === "connected" ? "Online" : state === "error" ? "Offline" : "Reconnecting…";
}

/** "14:32" — a compact, locale-aware timestamp for message bubbles. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function appendMessage(
  role: "student" | "tutor" | "system",
  text: string,
): void {
  if (!text.trim()) return;

  const wrapper = document.createElement("div");

  if (role === "system") {
    wrapper.className = "animate-fadeup mx-auto max-w-md text-center";
    const notice = document.createElement("p");
    notice.className =
      "rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-xs text-slate-400";
    notice.textContent = text;
    wrapper.appendChild(notice);
  } else {
    const isStudent = role === "student";
    // NB: the UI test asserts on `.flex.justify-end` for student bubbles —
    // keep those class names intact.
    wrapper.className = `animate-fadeup flex ${isStudent ? "justify-end" : "justify-start"}`;
    const bubble = document.createElement("div");
    bubble.className = [
      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
      isStudent
        ? "rounded-br-sm bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
        : "rounded-bl-sm bg-slate-800 text-slate-100 border border-slate-700/60",
    ].join(" ");

    const meta = document.createElement("div");
    meta.className = `mb-1 flex items-center gap-2 ${isStudent ? "justify-end" : "justify-start"}`;

    const author = document.createElement("p");
    author.className = `text-[11px] font-semibold uppercase tracking-wide ${isStudent ? "text-indigo-200" : "text-violet-300"}`;
    author.textContent = isStudent ? "You" : "AgentEd";

    const time = document.createElement("time");
    // Needs a lighter tone on the indigo student bubble to stay legible.
    time.className = `text-[10px] tabular-nums ${isStudent ? "text-indigo-200/70" : "text-slate-500"}`;
    time.textContent = formatTime(new Date());

    meta.append(author, time);
    bubble.appendChild(meta);

    const body = document.createElement("p");
    body.textContent = text;
    bubble.appendChild(body);

    wrapper.appendChild(bubble);
  }

  messagesEl.appendChild(wrapper);
  // Keep the starter prompts up until the student actually says something —
  // the "connected" system notice shouldn't dismiss them.
  if (role !== "system") setEmptyStateVisible(false);
  scrollToBottom();
  // Re-check after layout settles so the jump-to-latest button is accurate.
  requestAnimationFrame(updateScrollButton);
}

let requestInFlight = false;

function setBusy(busy: boolean): void {
  requestInFlight = busy;
  sendButtonEl.disabled = busy;
  // New chat must not be clickable mid-answer. Clearing the thread while a
  // reply is in flight lets that reply land afterwards and repopulate the
  // conversation the student just asked to discard.
  newChatButtonEl.disabled = busy;
  newChatButtonEl.classList.toggle("opacity-50", busy);
  newChatButtonEl.title = busy
    ? "Wait for the owl to finish answering"
    : "Start a new conversation";
  // Write to the label span so the spinner survives; the UI test reads the
  // button's textContent and expects it to mention "Thinking".
  sendLabelEl.textContent = busy ? "Thinking…" : "Send";
  sendSpinnerEl.classList.toggle("hidden", !busy);
  sendButtonEl.setAttribute("aria-busy", String(busy));
  setTyping(busy);
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const studentMessage = inputEl.value.trim();
  if (!studentMessage || requestInFlight || !socket?.connected) {
    if (socket && !socket.connected) {
      appendMessage("system", "Still reconnecting — try again in a moment.");
    }
    return;
  }

  appendMessage("student", studentMessage);
  inputEl.value = "";
  updateCharCount();
  setBusy(true);
  mascot.clearMessage();
  stopOwlSpeech();
  resumeMicAfterSpeech();
  setAiStatus("thinking");
  // A lesson waiting on a check beat is released here: the student has answered,
  // so the owl should stop looking expectant and carry on teaching.
  releaseLessonWaiter();
  mascot.setAwaitingReply(false);

  responseEpoch = conversationEpoch;
    socket.emit("student-message", {
    studentId: getStudentId(),
    activeTopic: studentMessage.slice(0, 60),
    mode: tutorMode,
    studentMessage,
  });
});

// ---------------------------------------------------------------------------
// Voice playback (speech synthesis) — in voice mode the owl TALKS: it reads
// its Socratic guidance aloud, pausing the microphone so it doesn't transcribe
// its own voice.
// ---------------------------------------------------------------------------

let currentUtterance: SpeechSynthesisUtterance | null = null;
let micSuspendedForSpeech = false;

/**
 * Resolves when the student sends their next message, or null if nobody is
 * waiting.
 *
 * This is what turns Teach mode from a lecture into a lesson. A monologue is
 * the defining shape of a chatbot - user asks, system emits a long block of
 * prose, user watches. Making the lesson *wait* at a check-for-understanding
 * beat is the difference between "it told me about neural networks" and "it
 * asked me something about them and waited".
 *
 * Resolved rather than polled, and released in a `finally` so a cancelled or
 * superseded playthrough cannot leave a waiter hanging.
 */
let lessonWaiter: (() => void) | null = null;

/** Called when the student sends a message: releases a waiting lesson. */
function releaseLessonWaiter(): void {
  const waiter = lessonWaiter;
  if (!waiter) return;
  lessonWaiter = null;
  waiter();
}

/**
 * How long a check beat waits for an answer before carrying on.
 *
 * Bounded, because a lesson that hangs forever on a student who has walked away
 * or is thinking is worse than one that keeps going. It is generous enough to
 * cover reading the question and typing a reply.
 */
const LESSON_WAIT_MS = 4 * 60 * 1000;

/** Stop any guidance the owl is currently reading aloud. */
function stopOwlSpeech(): void {
  currentUtterance = null;
  // Invalidate the beat playthrough. Without this, a cancellation between beats
  // (a student types mid-explanation) would let the loop wake up and carry on
  // talking over them — the utterance is already cancelled, but the timeout
  // between beats is not.
  playRun += 1;
  window.speechSynthesis?.cancel();
  // A playthrough that set the sticky `curious` mood is cancelled here, so it
  // will never reach its own `finally` cleanup. Release the mood on its behalf,
  // otherwise a cancelled lesson strands the owl wide-eyed until something else
  // happens to change it — and anything that then *does* change it (a reaction to
  // a graded answer) has to win, which it cannot if the cancelled loop later
  // resets over the top of it.
  if (moodOwnerRun !== -1) {
    mascot.setMood("neutral");
    moodOwnerRun = -1;
  }
  // The utterance's onend won't fire for a cancelled one, so close the mouth
  // here or the owl would keep chewing on nothing.
  mascot.setSpeaking(false);
  // ...and the highlight timer must die with it. A cancelled utterance used to
  // leave the walkthrough running, so the board kept stepping through a
  // diagram for a reply the student had already moved past — the owl appeared
  // to be explaining something that was no longer on screen.
  stopVisualWalk();
}

/** Restart the microphone once the owl finishes speaking (voice mode only). */
function resumeMicAfterSpeech(): void {
  if (!micSuspendedForSpeech) return;
  micSuspendedForSpeech = false;
  if (voiceEnabled && recognition) {
    try {
      recognition.start();
    } catch {
      // Already starting — harmless.
    }
  }
}

/**
 * Find a voice for the given language, if the device has one.
 *
 * This is the whole reason Hindi speech needs care. Plenty of machines — stock
 * macOS, most Linux desktops — have no hi-IN voice at all. Handing Devanagari
 * text to an English voice produces something that sounds like gibberish, which
 * is worse than staying quiet, so we detect and refuse instead of faking it.
 */
let cachedVoices: SpeechSynthesisVoice[] | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  if (cachedVoices) return Promise.resolve(cachedVoices);

  return new Promise((resolve) => {
    const existing = synth.getVoices();
    if (existing.length) {
      cachedVoices = existing;
      resolve(existing);
      return;
    }
    // Chrome populates the list asynchronously.
    const timer = window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", onChange);
      cachedVoices = synth.getVoices();
      resolve(cachedVoices);
    }, 1200);
    const onChange = () => {
      window.clearTimeout(timer);
      cachedVoices = synth.getVoices();
      resolve(cachedVoices);
    };
    synth.addEventListener("voiceschanged", onChange, { once: true });
  });
}

/** Does this device have a voice that can actually speak this language? */
async function hasVoiceFor(language: TeachLanguage): Promise<boolean> {
  const voices = await loadVoices();
  if (!voices.length) return false;
  const prefix = language === "hi" ? "hi" : "en";
  return voices.some((voice) => voice.lang?.toLowerCase().startsWith(prefix));
}

/** The Wise Owl reads its guidance aloud, walking the diagram as it goes. */
async function speakOwlMessage(text: string, visual: VisualSpec | null = null): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth) {
    voiceHintEl.textContent =
      "Speech playback isn't supported in this browser — the owl will stay quiet.";
    voiceHintEl.classList.remove("hidden");
    return;
  }
  if (!text.trim()) return;

  // Refuse rather than mangle: an English voice reading Devanagari is gibberish.
  if (teachLanguage === "hi" && !(await hasVoiceFor("hi"))) {
    voiceHintEl.textContent =
      "इस device पर Hindi voice उपलब्ध नहीं है — उत्तर पढ़ा नहीं जा रहा, पर पढ़ा जा सकता है। (No Hindi voice on this device, so the owl shows the answer instead of reading it.)";
    voiceHintEl.classList.remove("hidden");
    playSilentVisualWalkthrough(visual);
    return;
  }

  stopOwlSpeech();
  micSuspendedForSpeech = listeningEnabled && recognition !== null;
  if (micSuspendedForSpeech) {
    try {
      recognition?.stop();
    } catch {
      // Mic already stopped — ignore.
    }
  }

  // Teach mode gets the beat treatment: a long reply is played back one short
  // segment at a time so the owl is visibly working through the idea with the
  // student rather than reciting a wall of text at them. A one-line reply (the
  // Socratic path) is a single beat and plays exactly as it always did.
  //
  // Turn-taking is on for Teach mode only. A Socratic reply is already a single
  // question the student answers, so there is nothing to pause between.
  const beats = splitIntoBeats(text);
  if (beats.length > 1 && !singleUtteranceOverride) {
    await playBeats(beats, visual, tutorMode === "teach");
    return;
  }

  const total = visualStepCount(visual);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1;
  utterance.pitch = 1.05;
  utterance.onstart = () => mascot.setSpeaking(true);
  utterance.onend = () => {
    // Only resume the mic if this is still the current utterance. A cancelled
    // one (stopOwlSpeech nulls currentUtterance) must not restart the mic.
    if (currentUtterance !== utterance) return;
    currentUtterance = null;
    mascot.setSpeaking(false);
    stopVisualWalk();
    resumeMicAfterSpeech();
  };
  utterance.onerror = () => {
    if (currentUtterance !== utterance) return;
    currentUtterance = null;
    mascot.setSpeaking(false);
    stopVisualWalk();
    resumeMicAfterSpeech();
  };
  currentUtterance = utterance;

  // Drive the highlight from a timer rather than onboundary: boundary events
  // are unsupported in Safari and inconsistent elsewhere, and a uniformly paced
  // walkthrough beats no highlight at all.
  if (total > 0) startVisualWalk(total, Math.max(1400, (text.length / total) * 55));

  synth.speak(utterance);
}

// ---------------------------------------------------------------------------
// Beat playback — the owl works through a long explanation one segment at a
// time.
// ---------------------------------------------------------------------------

/**
 * Pause between beats, in ms.
 *
 * This is the single most important number in the file. A gap is what turns one
 * long utterance into a sequence of thoughts: without it the owl is still just
 * reciting, only with the diagrams stepping over. It also gives the student a
 * natural point to interrupt.
 */
const BEAT_GAP_MS = 650;

/** Gap before the owl starts moving, so the first beat isn't swallowed. */
const BEAT_LEAD_IN_MS = 120;

/** Bumped by stopOwlSpeech so an abandoned playthrough can't resume itself. */
let playRun = 0;

/**
 * True while a beat playthrough is between beats.
 *
 * Distinct from `playRun`: that counter identifies WHICH playthrough is current,
 * while this says whether one is running at all. A test needs the second to know
 * when the classroom has gone quiet.
 */
let playbackActive = false;

/** The playthrough that last claimed playback, so a cancelled one can release it. */
let playbackOwnerRun = -1;

/**
 * The playthrough that last set the owl's mood.
 *
 * `curious` is a sticky mood, so whoever sets it must also clear it. Tracking
 * the owning run lets the cleanup happen even when this playthrough was
 * cancelled: the run is still the most recent one to have touched the mood, so
 * it is still entitled to reset it. Keying this off `stillCurrent()` instead —
 * which was the first attempt — skipped the reset on exactly the interrupted
 * path where the mood was left stranded, and the UI suite caught it.
 */
let moodOwnerRun = -1;

/**
 * Dev-only escape hatch that restores the old one-utterance delivery.
 *
 * Stripped from production builds by Vite along with the rest of the test hook;
 * nothing in the app ever sets it.
 */
let singleUtteranceOverride = false;

/**
 * Play each beat in turn: show it in the bubble, speak it, move the board, pause.
 *
 * Sequential rather than one utterance because that is the whole point — the
 * student should watch the owl arrive at each idea. Awaiting each utterance's
 * end is what makes it a sequence; firing them all at once would just be the old
 * behaviour with extra steps.
 *
 * `turnTaking` makes the lesson stop and wait for the student at each check
 * beat. It is off for Socratic replies, which are already a single question the
 * student answers — pausing there would just add a pointless extra step.
 */
async function playBeats(
  beats: LessonBeat[],
  visual: VisualSpec | null,
  turnTaking = false,
): Promise<void> {
  const run = ++playRun;
  const stillCurrent = () => run === playRun;
  playbackActive = true;
  playbackOwnerRun = run;

  try {
    await new Promise((r) => window.setTimeout(r, BEAT_LEAD_IN_MS));
    if (!stillCurrent()) return;

    const totalSteps = visualStepCount(visual);

    for (let index = 0; index < beats.length; index += 1) {
      if (!stillCurrent()) return;
      const beat = beats[index];

      // The bubble shows this beat and only this beat. The full reply is still in
      // the transcript below, so nothing is lost — the bubble is the owl's line,
      // not the transcript.
      mascot.setMessage(beat.text);
      setAiStatus("speaking");

      // A check-for-understanding beat is the owl handing the floor back, so it
      // waits rather than performing: curious, not mid-celebration. A mascot that
      // keeps bouncing while it waits for an answer teaches the student to talk
      // past it.
      if (beat.kind === "check" || beat.kind === "example") {
        mascot.setMood("curious");
        moodOwnerRun = run;
      }

      // Put a picture on the board that matches THIS sentence — the cat when the
      // owl says cat, the envelope when it says spam. Returns null for a beat
      // with nothing concrete to point at, and the board keeps the diagram.
      mascot.setSketch(sketchForBeat(beat.text, beat.kind));

      // Advance the board to the step this beat is about. Beats and diagram steps
      // rarely divide evenly, so the step is spread across the beats rather than
      // indexed directly — otherwise a 4-beat lesson over a 6-step diagram would
      // stop halfway and leave half the diagram unexplained.
      if (totalSteps > 1) {
        const step = Math.min(
          totalSteps - 1,
          Math.round((index / Math.max(1, beats.length - 1)) * (totalSteps - 1)),
        );
        mascot.setVisualStep(step);
      }

      const finished = await speakOneBeat(beat.text);
      if (!stillCurrent() || !finished) return;

      // Never pause after the last beat — the student should be able to answer.
      if (index < beats.length - 1) {
        await new Promise((r) => window.setTimeout(r, BEAT_GAP_MS));
        if (!stillCurrent()) return;

        // Hand the floor back on a check beat, but only in Teach mode and only
        // when there is genuinely more to come. This is the line between a
        // lesson and a monologue: without it, Teach mode asks a question and
        // then talks straight past it, which is the chatbot shape this whole
        // loop exists to avoid.
        if (turnTaking && beat.kind === "check") {
          await waitForStudentBeat(run);
          if (!stillCurrent()) return;
        }
      }
    }
  } finally {
    // `curious` is a *sticky* mood by design: it persists until something
    // replaces it. That is right while the owl waits for an answer, but leaving
    // it set strands the owl wide-eyed forever, which reads as frozen rather
    // than attentive. This sits in `finally` because the loop returns early on
    // every interruption, and those paths would otherwise skip the reset.
    //
    // Ownership, not `stillCurrent()`, decides who resets: a cancelled run is
    // still the last one to have set the mood, so it must still clear it. If a
    // newer playthrough has since set a mood of its own, this run no longer owns
    // it and must not reset out from under that one.
    if (moodOwnerRun === run) {
      mascot.setMood("neutral");
      moodOwnerRun = -1;
    }
    // Clear the "your turn" prompt for the same reason as the mood above: every
    // interruption path returns early into this block, so a cue left up by a
    // cancelled lesson would sit there telling a student to answer a question
    // that is no longer being asked.
    mascot.setAwaitingReply(false);
    // Same rule for the board: hand it back rather than freezing on whichever
    // picture happened to be up when the lesson ended — but only if nothing
    // newer has already put its own picture up.
    if (stillCurrent()) mascot.setSketch(null);
    // Ownership, not `stillCurrent()`, for the same reason as the mood: a
    // cancelled run is still the last one that was playing, so it is the one that
    // must report the classroom as idle again.
    if (playbackOwnerRun === run) {
      playbackActive = false;
      playbackOwnerRun = -1;
    }
    resumeMicAfterSpeech();
  }
}

/**
 * Pause the lesson until the student answers, or until the wait runs out.
 *
 * Three ways out, and all three are needed:
 *   - the student sends something (the normal path)
 *   - `stopOwlSpeech` bumps `playRun` (they interrupted, or started a new chat)
 *   - `LESSON_WAIT_MS` elapses (they walked away, or are still thinking)
 *
 * The timeout is why this can't be a bare `await` on the waiter: a student who
 * closes the tab mid-lesson must not leave a promise pending forever, and one
 * who simply doesn't know what to say should get the rest of the explanation
 * rather than a frozen owl.
 */
function waitForStudentBeat(run: number): Promise<void> {
  mascot.setAwaitingReply(true);
  // The status goes to idle while waiting: the owl is not thinking or speaking,
  // it is waiting, and leaving the pill on "Teaching" would be a lie the student
  // can read. The "your turn" cue below the bubble is what replaces it.
  setAiStatus("idle");

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      if (lessonWaiter === finish) lessonWaiter = null;
      resolve();
    };
    // Registered as the waiter, so the student's next message releases it.
    lessonWaiter = finish;
    // Polled rather than pushed: `stopOwlSpeech` invalidates a run by bumping a
    // counter, and hooking that would mean threading a second callback through
    // the cancellation path. At 200ms the cost is nil and the cancellation path
    // stays exactly as it was.
    const poll = window.setInterval(() => {
      if (run !== playRun) finish();
    }, 200);
    const timeout = window.setTimeout(finish, LESSON_WAIT_MS);
  });
}

/**
 * Speak a single beat. Resolves true when it finished, false if it was
 * cancelled — so a playthrough stops rather than talking over the student.
 */
function speakOneBeat(text: string): Promise<boolean> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve(false);

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1.05;
    utterance.onstart = () => mascot.setSpeaking(true);
    utterance.onend = () => {
      if (currentUtterance !== utterance) {
        resolve(false);
        return;
      }
      currentUtterance = null;
      mascot.setSpeaking(false);
      resolve(true);
    };
    utterance.onerror = () => {
      if (currentUtterance !== utterance) return;
      currentUtterance = null;
      mascot.setSpeaking(false);
      // A failed beat is not a reason to abandon the lesson: carry on so the
      // remaining beats still reach the screen.
      resolve(true);
    };
    currentUtterance = utterance;
    synth.speak(utterance);
  });
}


let visualWalkTimer: number | null = null;
let visualWalkIndex = 0;

function startVisualWalk(total: number, intervalMs: number): void {
  stopVisualWalk();
  visualWalkIndex = 0;
  visualWalkTimer = window.setInterval(() => {
    visualWalkIndex += 1;
    if (visualWalkIndex >= total) {
      stopVisualWalk();
      return;
    }
    mascot.setVisualStep(visualWalkIndex);
  }, intervalMs);
}

/**
 * Step through a diagram without audio, so the visuals still read as a
 * sequence when the student has muted the owl.
 */
function playSilentVisualWalkthrough(visual: VisualSpec | null): void {
  const total = visualStepCount(visual);
  if (total <= 1) return;
  startVisualWalk(total, 1800);
}

function stopVisualWalk(): void {
  if (visualWalkTimer !== null) {
    window.clearInterval(visualWalkTimer);
    visualWalkTimer = null;
  }
  visualWalkIndex = 0;
  mascot.setVisualStep(-1);
}

// ---------------------------------------------------------------------------
// Voice mode (Web Speech API — speech recognition)
// ---------------------------------------------------------------------------

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

let voiceEnabled = false;
/**
 * Speaking and listening are now separate concerns.
 *
 * The owl *speaking* is the product working as intended, so it defaults on.
 * The microphone is a permission prompt and a privacy consideration, so it
 * stays opt-in behind the existing voice toggle. Bundling them meant students
 * either got silence or an unprompted mic — neither is right.
 */
let speakingEnabled = true;
let listeningEnabled = false;
/** Teaching language, mirrored from the token so the UI can render immediately. */
let teachLanguage: TeachLanguage = "en";
let recognition: SpeechRecognitionLike | null = null;

/** Persist the language and re-apply it to the owl. */
async function setTeachLanguage(next: TeachLanguage): Promise<void> {
  if (next === teachLanguage) return;
  teachLanguage = next;
  // Stop the owl mid-explanation before switching. A beat playthrough in flight
  // keeps writing its already-computed English beat into the bubble, so without
  // this the student switches to Hindi and the owl carries on talking English —
  // and the phrase toggle appears to do nothing. This is also just correct: the
  // student has asked for a different language, so the lesson in the old one has
  // stopped being what they want to hear.
  stopOwlSpeech();
  resumeMicAfterSpeech();
  mascot.clearMessage();
  setAiStatus("idle");
  mascot.setLanguage(next);
  languageToggleEl.setAttribute("aria-pressed", String(next === "hi"));
  languageToggleEl.textContent = next === "hi" ? "हिंदी" : "EN";
  try {
    const res = await authedFetch("/api/auth/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: next }),
    });
    if (!res.ok) throw new Error("Could not save the language.");
    const body = (await res.json()) as { token?: string; user?: StoredUser };
    // The server re-issues the session cookie so the new language is in the JWT,
    // and re-sends the display copy. Nothing is written to localStorage as a
    // credential — only the name and language, which cannot authorise anything.
    if (body.user) {
      storeAuth({ user: body.user });
      currentAuth = { user: body.user };
      // Reconnect so the chat socket authenticates with the NEW session cookie.
      //
      // The socket decodes the token once, at handshake, and keeps
      // `socket.data.user` for its whole life — so a socket opened in English
      // answers in English no matter how many times the preference is saved. The
      // owl's own phrases changed and the toggle looked half-broken, which is
      // exactly the symptom the `stopOwlSpeech` above was added for.
      //
      // Cheap: one reconnect on a deliberate user action, and it is the only way
      // the server ever sees the new language.
      if (socket?.connected) {
        disconnectSocket();
        connectSocket();
      }
    }
  } catch (error) {
    teachLanguage = next === "hi" ? "en" : "hi";
    mascot.setLanguage(teachLanguage);
    voiceHintEl.textContent =
      error instanceof Error ? error.message : "Could not change the language.";
    voiceHintEl.classList.remove("hidden");
  }
}

languageToggleEl.addEventListener("click", () => {
  void setTeachLanguage(teachLanguage === "hi" ? "en" : "hi");
});

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as SpeechWindow;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const instance = new Ctor();
  instance.lang = "en-US";
  instance.interimResults = false;
  instance.continuous = true;

  instance.onresult = (event) => {
    const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
    if (!transcript) return;
    if (!socket?.connected || requestInFlight) return;
    appendMessage("student", transcript);
    mascot.clearMessage();
    stopOwlSpeech();

    responseEpoch = conversationEpoch;
    socket.emit("student-message", {
      studentId: getStudentId(),
      activeTopic: transcript.slice(0, 60),
      mode: tutorMode,
      studentMessage: transcript,
    });
    setBusy(true);
    setAiStatus("thinking");
  };

  instance.onend = () => {
    // Chrome stops recognition after silence; restart while voice mode is on.
    // While the owl is speaking we keep the mic paused so it doesn't hear itself.
    if (micSuspendedForSpeech) return;
    if (voiceEnabled && recognition === instance) recognition.start();
  };

  instance.onerror = (event) => {
    if (event.error !== "no-speech") {
      voiceHintEl.textContent = `Voice recognition error: ${event.error}`;
      voiceHintEl.classList.remove("hidden");
    }
  };

  return instance;
}

/**
 * The voice toggle now controls only the MICROPHONE. The owl's own speaking
 * is on by default and independent, so a student gets the spoken explanation
 * without being pushed into a permission prompt they didn't ask for.
 */
function setVoiceMode(enabled: boolean): void {
  voiceEnabled = enabled;
  listeningEnabled = enabled;
  micSuspendedForSpeech = false;
  voiceToggleEl.setAttribute("aria-pressed", String(enabled));

  if (enabled) {
    recognition = getRecognition();
    if (!recognition) {
      voiceHintEl.textContent =
        "Voice input isn't supported in this browser (requires Chrome or Edge). The owl will still read answers aloud.";
      voiceHintEl.classList.remove("hidden");
      voiceEnabled = false;
      listeningEnabled = false;
      voiceToggleEl.setAttribute("aria-pressed", "false");
      return;
    }
    voiceToggleEl.className =
      "rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-500 active:scale-95";
    voiceToggleEl.innerHTML = '🎙️ <span>Listening…</span>';
    voiceHintEl.textContent =
      "Microphone on — speak your question. The owl will read its answer aloud.";
    voiceHintEl.classList.remove("hidden");
    try {
      recognition.start();
    } catch {
      voiceHintEl.textContent = "Voice mode is already starting. Try speaking in a moment.";
      voiceHintEl.classList.remove("hidden");
    }
  } else {
    voiceToggleEl.className =
      "rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-white active:scale-95";
    voiceToggleEl.innerHTML = '🎤 <span>Voice Mode</span>';
    voiceHintEl.classList.add("hidden");
    // Muting the mic must not mute the owl — only stop what it is saying now.
    recognition?.stop();
    recognition = null;
    micSuspendedForSpeech = false;
  }
}

voiceToggleEl.addEventListener("click", () => setVoiceMode(!voiceEnabled));

/**
 * The owl's speaker, controlled independently of the microphone.
 *
 * These were previously entangled behind one "Voice Mode" button, which meant
 * the only way to stop the owl talking was to also switch off the mic — and
 * the only way to use the mic was to accept the owl talking. A student in a
 * shared room, or with a working microphone and no working speakers, needs
 * those to be separate decisions.
 */
speakerToggleEl.addEventListener("click", () => {
  speakingEnabled = !speakingEnabled;
  speakerToggleEl.setAttribute("aria-pressed", String(speakingEnabled));
  const label = speakerToggleEl.querySelector("span");
  if (label) label.textContent = speakingEnabled ? "Read aloud" : "Muted";
  speakerToggleEl.firstChild!.textContent = speakingEnabled ? "🔊 " : "🔇 ";
  speakerToggleEl.classList.toggle("opacity-60", !speakingEnabled);
  speakerToggleEl.title = speakingEnabled
    ? "Turn the owl's voice off"
    : "Turn the owl's voice on";
  // Muting mid-sentence should stop the audio now, not at the end of it.
  if (!speakingEnabled) stopOwlSpeech();
});

dashboardToggleEl.addEventListener("click", () =>
  setDashboardVisible(!dashboardVisible),
);

// ---------------------------------------------------------------------------
// UI initialization
// ---------------------------------------------------------------------------

initPasswordAffordances();
chatContainerEl.addEventListener("scroll", updateScrollButton, { passive: true });
scrollBottomEl.addEventListener("click", () => scrollToBottom());
inputEl.addEventListener("input", updateCharCount);
updateCharCount();

// Starter prompts: drop the prompt into the composer and send it.
for (const chip of suggestionChips) {
  chip.addEventListener("click", () => {
    const prompt = chip.dataset.prompt;
    if (!prompt) return;
    inputEl.value = prompt;
    updateCharCount();
    inputEl.focus();
    formEl.requestSubmit();
  });
}

// ---------------------------------------------------------------------------
// Boot: show the right view for the stored auth state
// ---------------------------------------------------------------------------

// Dev-only hook so automated UI tests can exercise the owl teacher (speech
// bubble + TTS) without waiting for a live AI reply. Stripped from production
// builds by Vite.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__agentedTest = {
    speakOwlMessage,
    setMessage: (text: string) => mascot.setMessage(text),
    // Drives a topic diagram onto the board without depending on the tutor
    // happening to choose one, so the rendering is always covered.
    setVisual: (spec: VisualSpec | null) => mascot.setVisual(spec),
    setVisualStep: (index: number) => mascot.setVisualStep(index),
    // Drives the real socratic-response handler (used when live AI providers
    // are down so the suite still covers the client reply path).
    simulateReply: (text: string) => handleSocraticResponse({ response: text }),
    // Reproduces the pre-beats behaviour on demand (one long utterance, whole
    // essay in the bubble). Exists so the beat playback suite can assert the
    // contrast rather than trusting that its own positive assertions are
    // meaningful — a test that cannot demonstrate the bug it prevents proves
    // nothing about the fix.
    forceSingleUtterance: (on: boolean) => {
      singleUtteranceOverride = on;
    },
    // Switch the tutor between Socratic and Teach, so the turn-taking suite can
    // drive the mode it needs instead of depending on whatever mode the previous
    // test happened to leave behind.
    setTutorMode: (mode: TutorMode) => {
      tutorMode = mode;
      mascot.setMode(mode);
    },
    // Whether a lesson is currently paused waiting for the student. Polled from
    // the test rather than pushed, because the test needs to observe the state
    // at arbitrary moments and the transition is the thing under test.
    isAwaitingReply: () => lessonWaiter !== null,
    // Whether a reply is in flight or a lesson is still playing, so a test can
    // wait for the app to go quiet instead of guessing at a DOM selector and
    // racing a reply that is still landing.
    isIdleForTest: () => !requestInFlight && !playbackActive,
    // Drives the owl's reaction directly, so the expression + animation
    // behaviour is covered without depending on a graded answer landing.
    // Stops playback first, exactly as the graded-answer path in showDashboard
    // does — otherwise this hook can react *underneath* a beat playthrough that
    // is still running, which no longer reflects anything a student can do.
    react: (outcome: "correct" | "close" | "wrong" | "great") => {
      stopOwlSpeech();
      return mascot.react(outcome);
    },
  };
}

/**
 * Boot.
 *
 * The cached user in `localStorage` is a display convenience, not proof of a
 * session — a student whose cookie expired would otherwise get the signed-in
 * shell and then a screen of 401s. So the cached state paints immediately and
 * `/api/auth/me` confirms it; if the cookie is gone or expired, the local cache
 * is discarded and the auth screen takes over.
 *
 * Painting first is deliberate: the round trip is local-to-local and fast, and
 * flashing a sign-in screen at a signed-in student on every reload would be a
 * worse regression than a brief flash of the wrong screen in the rare case the
 * session really has expired. So the SHELL is painted from the cache, but nothing
 * that needs a session is started until the server has confirmed one — otherwise
 * a dead cookie fires a socket handshake and a session fetch that both 401, and
 * the login page ends up spewing 401s it should never have made.
 */
async function boot(): Promise<void> {
  if (!currentAuth) {
    showAuth();
    setAuthMode(false);
    return;
  }

  paintAppShell();

  try {
    const res = await fetch(`${SERVER_URL}/api/auth/me`, {
      credentials: "include",
      headers: { ...CSRF_HEADER },
    });
    if (!res.ok) {
      clearStoredAuth();
      currentAuth = null;
      showAuth();
      setAuthMode(false);
      return;
    }
    const body = (await res.json()) as { user?: StoredUser };
    if (body.user) {
      // Trust the server over the cache: the display name and language may have
      // changed in another tab or another device.
      storeAuth({ user: body.user });
      currentAuth = { user: body.user };
      userBadgeEl.textContent = `👤 ${body.user.displayName}`;
      mascot.setLanguage(body.user.language ?? "en");
    }
    // Confirmed. Now the socket and the saved conversation are safe to ask for.
    startSessionServices();
    inputEl.focus();
  } catch {
    // The server is unreachable. Keep the cached session rather than signing the
    // student out because their laptop briefly lost wifi — the first real request
    // will fail visibly if it matters.
  }

  // Consent is confirmed after the session is known good, so a student who has
  // already agreed is not made to re-read the notice on every reload, and one
  // who has not is not let into the app.
  await ensureConsent();
}

void boot();

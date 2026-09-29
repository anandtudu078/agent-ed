import { io, type Socket } from "socket.io-client";
import { createMascot, type MascotStatus } from "./components/mascot";
import {
  createDashboard,
  type CourseInfo,
} from "./components/dashboard";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Auth state (persisted so reloads keep you signed in)
// ---------------------------------------------------------------------------

interface StoredUser {
  id: string;
  username: string;
  displayName: string;
}

interface AuthResponse {
  token: string;
  user: StoredUser;
}

function loadStoredAuth(): { token: string; user: StoredUser } | null {
  try {
    const token = localStorage.getItem("agented:token");
    const userJson = localStorage.getItem("agented:user");
    if (token && userJson) {
      return { token, user: JSON.parse(userJson) as StoredUser };
    }
  } catch {
    // Corrupted storage — fall through to signed-out state.
  }
  return null;
}

function storeAuth(auth: { token: string; user: StoredUser }): void {
  localStorage.setItem("agented:token", auth.token);
  localStorage.setItem("agented:user", JSON.stringify(auth.user));
}

function clearStoredAuth(): void {
  localStorage.removeItem("agented:token");
  localStorage.removeItem("agented:user");
  localStorage.removeItem("agented:studentId");
}

let currentAuth: { token: string; user: StoredUser } | null = loadStoredAuth();

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
const userBadgeEl = document.querySelector<HTMLSpanElement>("#user-badge")!;

const messagesEl = document.querySelector<HTMLDivElement>("#messages")!;
const chatContainerEl = document.querySelector<HTMLElement>("#chat-container")!;
const formEl = document.querySelector<HTMLFormElement>("#chat-form")!;
const inputEl = document.querySelector<HTMLInputElement>("#message-input")!;
const sendButtonEl = document.querySelector<HTMLButtonElement>("#send-button")!;
const voiceToggleEl = document.querySelector<HTMLButtonElement>("#voice-toggle")!;
const voiceHintEl = document.querySelector<HTMLParagraphElement>("#voice-hint")!;
const statusDotEl = document.querySelector<HTMLSpanElement>("#status-dot")!;
const statusTextEl = document.querySelector<HTMLSpanElement>("#status-text")!;
const mascotHostEl = document.querySelector<HTMLDivElement>("#mascot-host")!;
const mascot = createMascot(mascotHostEl);

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
        socket.emit("student-message", {
          studentId: getStudentId(),
          activeTopic: (nextModule?.topic ?? course.title).slice(0, 60),
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
        socket.emit("student-message", {
          studentId: getStudentId(),
          activeTopic: topic.slice(0, 60),
          studentMessage: prompt,
        });
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
    auth: { token: currentAuth.token },
  });

  socket.on("connect", () => {
    setConnectionStatus("connected");
    appendMessage(
      "system",
      "Connected to AgentEd. Ask me about any concept — I'll guide you with questions instead of answers.",
    );
  });

  socket.on("disconnect", (reason) => {
    setConnectionStatus("disconnected");
    appendMessage("system", `Disconnected (${reason}). Trying to reconnect…`);
  });

  socket.on("connect_error", (error: Error) => {
    // The backend rejects the handshake when the token is missing/expired.
    if (
      error.message.includes("Authentication required") ||
      error.message.includes("Session expired")
    ) {
      signOut("Your session expired. Please sign in again.");
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

/** Shared handler so tests can drive the exact same client path (DEV only). */
function handleSocraticResponse(payload: { response: string }): void {
  appendMessage("tutor", payload.response);
  setBusy(false);
  setAiStatus("speaking");
  // The owl is the visual teacher: it shows the guidance on its display…
  mascot.setMessage(payload.response);
  // …and speaks it aloud when voice mode is on.
  if (voiceEnabled) speakOwlMessage(payload.response);
}

function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  setConnectionStatus("disconnected");
}

// ---------------------------------------------------------------------------
// Auth UI
// ---------------------------------------------------------------------------

function showApp(): void {
  authViewEl.classList.add("hidden");
  appViewEl.classList.remove("hidden");
  if (currentAuth) {
    userBadgeEl.textContent = `👤 ${currentAuth.user.displayName}`;
  }
  setDashboardVisible(false);
  connectSocket();
  inputEl.focus();
}

function showAuth(): void {
  appViewEl.classList.add("hidden");
  authViewEl.classList.remove("hidden");
  authErrorEl.textContent = "";
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

function signOut(message?: string): void {
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

signOutButtonEl.addEventListener("click", () => signOut());

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as AuthResponse & { error?: string };

    if (!response.ok) {
      appendAuthError(data.error ?? "Authentication failed.");
      return;
    }

    storeAuth(data);
    currentAuth = data;
    showApp();
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

  socket.emit("student-message", {
    studentId: getStudentId(),
    activeTopic: studentMessage.slice(0, 60),
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

/** Stop any guidance the owl is currently reading aloud. */
function stopOwlSpeech(): void {
  currentUtterance = null;
  window.speechSynthesis?.cancel();
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

/** The Wise Owl reads its guidance aloud (voice mode). */
function speakOwlMessage(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    voiceHintEl.textContent =
      "Speech playback isn't supported in this browser — the owl will stay quiet.";
    voiceHintEl.classList.remove("hidden");
    return;
  }
  if (!text.trim()) return;

  stopOwlSpeech();
  micSuspendedForSpeech = voiceEnabled && recognition !== null;
  if (micSuspendedForSpeech) {
    try {
      recognition?.stop();
    } catch {
      // Mic already stopped — ignore.
    }
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1;
  utterance.pitch = 1.05;
  utterance.onend = () => {
    // Only resume the mic if this is still the current utterance. A cancelled
    // one (stopOwlSpeech nulls currentUtterance) must not restart the mic.
    if (currentUtterance !== utterance) return;
    currentUtterance = null;
    resumeMicAfterSpeech();
  };
  utterance.onerror = () => {
    if (currentUtterance !== utterance) return;
    currentUtterance = null;
    resumeMicAfterSpeech();
  };
  currentUtterance = utterance;
  synth.speak(utterance);
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
let recognition: SpeechRecognitionLike | null = null;

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

    socket.emit("student-message", {
      studentId: getStudentId(),
      activeTopic: transcript.slice(0, 60),
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

function setVoiceMode(enabled: boolean): void {
  voiceEnabled = enabled;
  micSuspendedForSpeech = false;
  voiceToggleEl.setAttribute("aria-pressed", String(enabled));

  if (enabled) {
    recognition = getRecognition();
    if (!recognition) {
      voiceHintEl.textContent =
        "Voice mode isn't supported in this browser (requires Chrome or Edge).";
      voiceHintEl.classList.remove("hidden");
      voiceEnabled = false;
      voiceToggleEl.setAttribute("aria-pressed", "false");
      return;
    }
    voiceToggleEl.className =
      "rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-900/40 transition hover:bg-emerald-500 active:scale-95";
    voiceToggleEl.innerHTML = '🎙️ <span>Listening…</span>';
    voiceHintEl.textContent =
      "Voice mode on — speak your question, and the owl will answer out loud.";
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
    stopOwlSpeech();
    micSuspendedForSpeech = false;
    recognition?.stop();
    recognition = null;
  }
}

voiceToggleEl.addEventListener("click", () => setVoiceMode(!voiceEnabled));

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
    // Drives the real socratic-response handler (used when live AI providers
    // are down so the suite still covers the client reply path).
    simulateReply: (text: string) => handleSocraticResponse({ response: text }),
  };
}

if (currentAuth) {
  showApp();
} else {
  showAuth();
  setAuthMode(false);
}

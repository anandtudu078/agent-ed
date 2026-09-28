import { io, type Socket } from "socket.io-client";

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

// The session key is now the authenticated username.
const STUDENT_ID = currentAuth?.user.username ?? "";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const authViewEl = document.querySelector<HTMLDivElement>("#auth-view")!;
const appViewEl = document.querySelector<HTMLDivElement>("#app-view")!;
const authFormEl = document.querySelector<HTMLFormElement>("#auth-form")!;
const authTitleEl = document.querySelector<HTMLHeadingElement>("#auth-title")!;
const authToggleTextEl =
  document.querySelector<HTMLParagraphElement>("#auth-toggle-text")!;
const authToggleLinkEl = document.querySelector<HTMLButtonElement>("#auth-toggle")!;
const authSubmitEl = document.querySelector<HTMLButtonElement>("#auth-submit")!;
const displayNameInputEl =
  document.querySelector<HTMLInputElement>("#display-name-input")!;
const usernameInputEl = document.querySelector<HTMLInputElement>("#username-input")!;
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

  socket.on("socratic-response", (payload: { response: string }) => {
    appendMessage("tutor", payload.response);
    setBusy(false);
  });

  socket.on("ai-error", (payload: { message: string }) => {
    appendMessage("system", `Something went wrong: ${payload.message}`);
    setBusy(false);
  });
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
  authSubmitEl.textContent = register ? "Sign Up" : "Sign In";
  authToggleTextEl.textContent = register
    ? "Already have an account?"
    : "New to AgentEd?";
  authToggleLinkEl.textContent = register ? "Sign in" : "Create an account";
  displayNameInputEl.classList.toggle("hidden", !register);
  authErrorEl.textContent = "";
}

function signOut(message?: string): void {
  disconnectSocket();
  clearStoredAuth();
  currentAuth = null;
  messagesEl.replaceChildren();
  if (message) appendAuthError(message);
  showAuth();
}

function appendAuthError(text: string): void {
  authErrorEl.textContent = text;
}

authToggleLinkEl.addEventListener("click", () => setAuthMode(!isRegisterMode));

signOutButtonEl.addEventListener("click", () => signOut());

authFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  authErrorEl.textContent = "";

  const username = usernameInputEl.value.trim();
  const password = passwordInputEl.value;

  if (!username || !password) {
    appendAuthError("Username and password are required.");
    return;
  }

  const endpoint = isRegisterMode ? "/api/auth/register" : "/api/auth/login";
  const body = isRegisterMode
    ? { username, password, displayName: displayNameInputEl.value.trim() || username }
    : { username, password };

  authSubmitEl.disabled = true;
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
    authSubmitEl.disabled = false;
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

function appendMessage(
  role: "student" | "tutor" | "system",
  text: string,
): void {
  if (!text.trim()) return;

  const wrapper = document.createElement("div");

  if (role === "system") {
    wrapper.className = "mx-auto max-w-md text-center";
    const notice = document.createElement("p");
    notice.className =
      "rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-xs text-slate-400";
    notice.textContent = text;
    wrapper.appendChild(notice);
  } else {
    const isStudent = role === "student";
    wrapper.className = `flex ${isStudent ? "justify-end" : "justify-start"}`;
    const bubble = document.createElement("div");
    bubble.className = [
      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
      isStudent
        ? "rounded-br-sm bg-indigo-600 text-white shadow-lg shadow-indigo-900/30"
        : "rounded-bl-sm bg-slate-800 text-slate-100 border border-slate-700/60",
    ].join(" ");

    const author = document.createElement("p");
    author.className = `mb-1 text-[11px] font-semibold uppercase tracking-wide ${isStudent ? "text-indigo-200" : "text-violet-300"}`;
    author.textContent = isStudent ? "You" : "AgentEd";
    bubble.appendChild(author);

    const body = document.createElement("p");
    body.textContent = text;
    bubble.appendChild(body);

    wrapper.appendChild(bubble);
  }

  messagesEl.appendChild(wrapper);
  chatContainerEl.scrollTo({ top: chatContainerEl.scrollHeight, behavior: "smooth" });
}

let requestInFlight = false;

function setBusy(busy: boolean): void {
  requestInFlight = busy;
  sendButtonEl.disabled = busy;
  sendButtonEl.textContent = busy ? "Thinking…" : "Send";
  sendButtonEl.setAttribute("aria-busy", String(busy));
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
  setBusy(true);

  socket.emit("student-message", {
    studentId: STUDENT_ID,
    activeTopic: studentMessage.slice(0, 60),
    studentMessage,
  });
});

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

    socket.emit("student-message", {
      studentId: STUDENT_ID,
      activeTopic: transcript.slice(0, 60),
      studentMessage: transcript,
    });
    setBusy(true);
  };

  instance.onend = () => {
    // Chrome stops recognition after silence; restart while voice mode is on.
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
    voiceToggleEl.innerHTML = '🎙️ <span class="hidden sm:inline">Listening…</span>';
    voiceHintEl.textContent = "Voice mode on — speak, and your words become messages.";
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
    voiceToggleEl.innerHTML = '🎤 <span class="hidden sm:inline">Voice Mode</span>';
    voiceHintEl.classList.add("hidden");
    recognition?.stop();
    recognition = null;
  }
}

voiceToggleEl.addEventListener("click", () => setVoiceMode(!voiceEnabled));

// ---------------------------------------------------------------------------
// Boot: show the right view for the stored auth state
// ---------------------------------------------------------------------------

if (currentAuth) {
  showApp();
} else {
  showAuth();
  setAuthMode(false);
}

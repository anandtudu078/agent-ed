import { io, type Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:3000";

// Identifies this student for session persistence on the backend.
const STUDENT_ID =
  (globalThis.localStorage.getItem("agented:studentId") as string | null) ??
  (() => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `student-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    globalThis.localStorage.setItem("agented:studentId", id);
    return id;
  })();

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const messagesEl = document.querySelector<HTMLDivElement>("#messages")!;
const chatContainerEl = document.querySelector<HTMLElement>("#chat-container")!;
const formEl = document.querySelector<HTMLFormElement>("#chat-form")!;
const inputEl = document.querySelector<HTMLInputElement>("#message-input")!;
const sendButtonEl = document.querySelector<HTMLButtonElement>("#send-button")!;
const voiceToggleEl = document.querySelector<HTMLButtonElement>("#voice-toggle")!;
const voiceHintEl = document.querySelector<HTMLParagraphElement>("#voice-hint")!;
const statusDotEl = document.querySelector<HTMLSpanElement>("#status-dot")!;
const statusTextEl = document.querySelector<HTMLSpanElement>("#status-text")!;

// ---------------------------------------------------------------------------
// Socket connection
// ---------------------------------------------------------------------------

const socket: Socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
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

socket.on("connect_error", () => {
  setConnectionStatus("error");
});

// Tutor response — payload matches the backend's ChatResult shape.
socket.on(
  "socratic-response",
  (payload: { response: string; analysis: string }) => {
    appendMessage("tutor", payload.response);
  },
);

socket.on("ai-error", (payload: { message: string }) => {
  appendMessage("system", `Something went wrong: ${payload.message}`);
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
  const wrapper = document.createElement("div");

  if (role === "system") {
    wrapper.className = "mx-auto max-w-md text-center";
    wrapper.innerHTML = `
      <p class="rounded-full bg-slate-800/70 px-3 py-1 text-xs text-slate-400"></p>`;
    wrapper.firstChild!.textContent = text;
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

function setBusy(busy: boolean): void {
  sendButtonEl.disabled = busy;
  inputEl.disabled = busy;
  sendButtonEl.textContent = busy ? "Thinking…" : "Send";
}

// ---------------------------------------------------------------------------
// Sending messages
// ---------------------------------------------------------------------------

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const studentMessage = inputEl.value.trim();
  if (!studentMessage) return;

  appendMessage("student", studentMessage);
  inputEl.value = "";
  setBusy(true);

  socket.emit("student-message", {
    studentId: STUDENT_ID,
    activeTopic: studentMessage.slice(0, 60),
    studentMessage,
  });
});

socket.on("socratic-response", () => setBusy(false));
socket.on("ai-error", () => setBusy(false));

// ---------------------------------------------------------------------------
// Voice mode (Web Speech API — speech recognition + speech synthesis)
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
    if (voiceEnabled) recognition?.start();
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
    recognition.start();
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

// Focus the input on load.
inputEl.focus();

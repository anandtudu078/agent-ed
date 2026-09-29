// Wise Owl — the on-screen "visual teacher". Instead of a small header widget,
// the owl lives on a large classroom display above the conversation: a
// graduation-capped owl points at a lesson-board diagram, reacts to the AI
// lifecycle (idle / thinking / teaching), and shows the latest Socratic
// guidance in its speech bubble. (main.ts reads that guidance aloud in voice
// mode via speechSynthesis.)

export type MascotStatus = "idle" | "thinking" | "speaking";

const DEFAULT_MESSAGE: Record<MascotStatus, string> = {
  idle: "Hoo there! Ask me about any concept — I'll guide you with questions, not answers.",
  thinking: "Analyzing your question & sketching a step-by-step path…",
  speaking: "Hoo-hoo! Here is a guiding question for you!",
};

const PILL_TEXT: Record<MascotStatus, string> = {
  idle: "Idle",
  thinking: "Thinking",
  speaking: "Teaching",
};

const PILL_STYLES: Record<MascotStatus, string> = {
  idle: "border-slate-700 bg-slate-800/80 text-slate-400",
  thinking: "border-indigo-500/50 bg-indigo-500/10 text-indigo-300",
  speaking: "border-amber-500/50 bg-amber-500/10 text-amber-300",
};

/** Glow on the display screen per state. */
const SCREEN_STYLES: Record<MascotStatus, string> = {
  idle: "border-slate-800/80",
  thinking: "border-indigo-500/40 shadow-[0_0_45px_-12px_rgba(99,102,241,0.55)]",
  speaking: "border-amber-500/30 shadow-[0_0_45px_-12px_rgba(245,158,11,0.45)]",
};

const BUBBLE_STYLES: Record<MascotStatus, string> = {
  idle: "border-slate-800 bg-slate-900/90",
  thinking: "border-indigo-500/40 bg-slate-900",
  speaking: "border-amber-500/30 bg-slate-900",
};

const TAIL_STYLES: Record<MascotStatus, string> = {
  idle: "border-slate-800 bg-slate-900",
  thinking: "border-indigo-500/40 bg-slate-900",
  speaking: "border-amber-500/30 bg-slate-900",
};

const MESSAGE_STYLES: Record<MascotStatus, string> = {
  idle: "text-slate-300",
  thinking: "text-indigo-200",
  speaking: "text-amber-100",
};

/** The owl itself: gentle bob while idle, wobble while thinking, bounce while teaching. */
function owlAnimation(status: MascotStatus): string {
  switch (status) {
    case "thinking":
      return "animate-[wiggle_1.1s_ease-in-out_infinite]";
    case "speaking":
      return "animate-[mascotbounce_0.9s_ease-in-out_infinite]";
    default:
      return "animate-bob";
  }
}

/** Custom SVG: owl in a graduation cap with academic glasses; the right wing
 *  points at the lesson board while thinking/teaching (with a teacher's
 *  pointer stick while teaching). */
function owlSvg(status: MascotStatus): string {
  // Eye behaviour per state: idle = wide open, thinking = looking up at the board.
  const pupilY = status === "thinking" ? 22 : 24;
  const glasses =
    status === "thinking"
      ? "stroke-indigo-300"
      : status === "speaking"
        ? "stroke-amber-300"
        : "stroke-slate-400";

  const leftWing =
    '<path d="M14 42c2 8 7 14 12 16-6 0-11-3-13-8-1.4-3.2-1-6.4 1-8Z" fill="#4338ca" opacity="0.7"/>';
  const rightWing =
    status === "thinking"
      ? // Wing raised, gesturing up at the board.
        '<path d="M46 41c4.5-1.5 8-4.5 10.5-8.5l4 2.4c-3 5-7.5 8.5-13 10.3L46 41Z" fill="#4338ca"/>'
      : status === "speaking"
        ? // Wing extended with a teacher's pointer stick aimed at the board.
          '<path d="M47 43c4.5-.8 8.5-2.8 11.5-6l3.2 3c-3.6 4-8.4 6.4-13.7 7.4L47 43Z" fill="#4338ca"/><g class="owl-pointer"><path d="M60.5 38.5l3-7" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round"/><circle cx="63.9" cy="30" r="1.7" fill="#f59e0b"/></g>'
        : // Folded.
          '<path d="M50 42c-2 8-7 14-12 16 6 0 11-3 13-8 1.4-3.2 1-6.4-1-8Z" fill="#4338ca" opacity="0.7"/>';

  return `
<svg viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-full w-full" aria-hidden="true">
  <!-- graduation cap -->
  <g class="owl-cap">
    <path d="M32 0.5L49 7 32 13.5 15 7 32 0.5Z" fill="#334155"/>
    <path d="M15 7L32 13.5 49 7 49 9.2 32 15.7 15 9.2 15 7Z" fill="#1e293b"/>
    <path d="M24 11.5v4c0 2.2 16 2.2 16 0v-4" fill="#312e81"/>
    <path d="M49 7v7.5" stroke="#f59e0b" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="49" cy="16" r="1.8" fill="#f59e0b"/>
    <circle cx="32" cy="7" r="1.2" fill="#94a3b8"/>
  </g>
  <!-- body -->
  <path d="M32 14C20 14 12 24 12 38c0 14 9 24 20 24s20-10 20-24C52 24 44 14 32 14Z" fill="url(#owlBody)"/>
  <!-- facial disc -->
  <ellipse cx="32" cy="33" rx="17" ry="13" fill="#e0e7ff" opacity="0.95"/>
  <!-- eyes -->
  <circle cx="24" cy="24" r="6.5" fill="#fff"/>
  <circle cx="40" cy="24" r="6.5" fill="#fff"/>
  <circle cx="24" cy="${pupilY}" r="2.6" fill="#1e1b4b"/>
  <circle cx="40" cy="${pupilY}" r="2.6" fill="#1e1b4b"/>
  <!-- academic glasses -->
  <circle cx="24" cy="24" r="8" class="${glasses}" stroke-width="1.6"/>
  <circle cx="40" cy="24" r="8" class="${glasses}" stroke-width="1.6"/>
  <path d="M32 22.5v3" class="${glasses}" stroke-width="1.6"/>
  <path d="M16 24H12" class="${glasses}" stroke-width="1.6"/>
  <path d="M48 24h4" class="${glasses}" stroke-width="1.6"/>
  <!-- beak -->
  <path d="M32 31l3.5 4.5c-1 1.4-2.4 2-3.5 2s-2.5-.6-3.5-2L32 31Z" fill="#f59e0b"/>
  <!-- wings -->
  ${leftWing}
  ${rightWing}
  <defs>
    <linearGradient id="owlBody" x1="12" y1="14" x2="52" y2="62" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6366f1"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
</svg>`;
}

/** Lesson-board doodle shown next to the owl, per state. */
function boardSvg(kind: "idle" | "thinking" | "teaching"): string {
  if (kind === "thinking") {
    return `
<svg viewBox="0 0 160 100" class="h-auto w-full" aria-hidden="true">
  <text x="16" y="56" font-size="32" font-weight="700" fill="#818cf8" opacity="0.85">{ }</text>
  <circle cx="95" cy="42" r="17" fill="none" stroke="#a5b4fc" stroke-width="3"/>
  <path d="M107 54l13 13" stroke="#a5b4fc" stroke-width="4.5" stroke-linecap="round"/>
  <circle cx="95" cy="42" r="17" fill="none" stroke="#6366f1" stroke-width="1.6" stroke-dasharray="4 6" class="animate-[spin_7s_linear_infinite]"/>
  <circle cx="38" cy="78" r="3.4" fill="#818cf8" class="animate-bounce"/>
  <circle cx="54" cy="78" r="3.4" fill="#818cf8" class="animate-bounce [animation-delay:150ms]"/>
  <circle cx="70" cy="78" r="3.4" fill="#818cf8" class="animate-bounce [animation-delay:300ms]"/>
  <text x="80" y="96" text-anchor="middle" font-size="9" fill="#64748b">Connecting the ideas…</text>
</svg>`;
  }
  if (kind === "teaching") {
    return `
<svg viewBox="0 0 160 100" class="h-auto w-full" aria-hidden="true">
  <circle cx="35" cy="44" r="13" fill="none" stroke="#818cf8" stroke-width="2.5"/>
  <text x="35" y="49" text-anchor="middle" font-size="14" font-weight="700" fill="#c7d2fe">1</text>
  <path d="M51 44h16m0 0-4-3m4 3-4 3" stroke="#818cf8" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  <circle cx="80" cy="44" r="13" fill="none" stroke="#818cf8" stroke-width="2.5"/>
  <text x="80" y="49" text-anchor="middle" font-size="14" font-weight="700" fill="#c7d2fe">2</text>
  <path d="M96 44h16m0 0-4-3m4 3-4 3" stroke="#fbbf24" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  <circle cx="125" cy="44" r="13" fill="rgba(251,191,36,0.12)" stroke="#fbbf24" stroke-width="2.5" class="animate-pulse"/>
  <text x="125" y="49" text-anchor="middle" font-size="14" font-weight="700" fill="#fde68a">3</text>
  <path d="M142 16l2.2 5.6 5.6 2.2-5.6 2.2-2.2 5.6-2.2-5.6-5.6-2.2 5.6-2.2L142 16Z" fill="#fbbf24" opacity="0.8"/>
  <text x="80" y="96" text-anchor="middle" font-size="9" fill="#64748b">Let's walk through it step by step</text>
</svg>`;
  }
  return `
<svg viewBox="0 0 160 100" class="h-auto w-full" aria-hidden="true">
  <circle cx="52" cy="42" r="16" fill="none" stroke="#818cf8" stroke-width="2.5"/>
  <path d="M46 57h12M48 62h8" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M52 24v-7M68 42h7M36 42h-7M63 31l5-5M41 31l-5-5" stroke="#a5b4fc" stroke-width="2" stroke-linecap="round"/>
  <text x="103" y="58" font-size="36" font-weight="700" fill="#a78bfa">?</text>
  <circle cx="132" cy="72" r="3" fill="#6366f1" opacity="0.6"/>
  <circle cx="24" cy="76" r="2.5" fill="#6366f1" opacity="0.4"/>
  <text x="80" y="96" text-anchor="middle" font-size="9" fill="#64748b">Ready for your question</text>
</svg>`;
}

export function createMascot(host: HTMLElement): {
  setStatus: (s: MascotStatus) => void;
  setMessage: (text: string) => void;
  clearMessage: () => void;
} {
  host.innerHTML = `
    <div class="owl-display" data-state="idle">
      <div class="rounded-[1.75rem] border border-slate-700/70 bg-slate-800/40 p-1.5 shadow-2xl shadow-black/50">
        <div class="owl-screen relative overflow-hidden rounded-[1.35rem] border p-4 transition-all duration-300 sm:p-5 [background-image:radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_65%)]">
          <div class="mb-3 flex items-center gap-2">
            <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
            <span class="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500 sm:text-[10px]">AgentEd classroom display</span>
            <span class="owl-state-pill ml-auto rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors sm:text-[10px]"></span>
          </div>
          <div class="flex items-center gap-4 sm:gap-5">
            <div class="owl-visual h-28 w-28 shrink-0 sm:h-36 sm:w-36"></div>
            <div
              class="owl-board relative hidden min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 sm:flex"
              style="background-image:linear-gradient(rgba(99,102,241,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.05) 1px,transparent 1px);background-size:18px 18px;"
            >
              <span class="absolute left-3 top-2 text-[9px] font-semibold uppercase tracking-widest text-slate-600">Lesson board</span>
              <div class="owl-board-art m-auto w-full max-w-[230px] px-2 pb-1 pt-5"></div>
            </div>
          </div>
          <div class="owl-bubble relative mt-3 rounded-2xl border px-4 py-3 transition-colors duration-300">
            <span class="owl-bubble-tail absolute -top-[7px] left-14 h-3 w-3 rotate-45 rounded-[2px] border-l border-t sm:left-20"></span>
            <p class="owl-message text-sm font-medium leading-relaxed sm:text-base"></p>
          </div>
        </div>
      </div>
      <div class="mx-auto h-2.5 w-28 rounded-b-lg bg-slate-800"></div>
      <div class="mx-auto h-1.5 w-44 rounded-full bg-slate-800/60"></div>
    </div>`;

  const display = host.firstElementChild as HTMLElement;
  const screen = display.querySelector<HTMLElement>(".owl-screen")!;
  const pill = display.querySelector<HTMLElement>(".owl-state-pill")!;
  const visual = display.querySelector<HTMLElement>(".owl-visual")!;
  const boardArt = display.querySelector<HTMLElement>(".owl-board-art")!;
  const bubble = display.querySelector<HTMLElement>(".owl-bubble")!;
  const tail = display.querySelector<HTMLElement>(".owl-bubble-tail")!;
  const message = display.querySelector<HTMLElement>(".owl-message")!;

  let status: MascotStatus = "idle";
  let customMessage: string | null = null;

  function render(): void {
    // While the owl is showing the tutor's guidance it keeps its "teaching"
    // look (board diagram + amber bubble), even after the brief speaking
    // state reverts to idle.
    const vis: MascotStatus = customMessage && status !== "thinking" ? "speaking" : status;
    const boardKind = vis === "speaking" ? "teaching" : vis;

    visual.innerHTML = owlSvg(status);
    visual.className = `owl-visual h-28 w-28 shrink-0 sm:h-36 sm:w-36 ${owlAnimation(status)}`;
    boardArt.innerHTML = boardSvg(boardKind);

    // The display chrome (pill, glow, dataset state) follows the *visible*
    // state: while the tutor's guidance is on screen the owl keeps presenting
    // it ("Teaching"), even after the momentary speaking bounce has calmed.
    display.dataset.state = vis;
    screen.className = `owl-screen relative overflow-hidden rounded-[1.35rem] border p-4 transition-all duration-300 sm:p-5 [background-image:radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_65%)] ${SCREEN_STYLES[vis]}`;
    pill.textContent = PILL_TEXT[vis];
    pill.className = `owl-state-pill ml-auto rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors sm:text-[10px] ${PILL_STYLES[vis]}`;

    bubble.className = `owl-bubble relative mt-3 rounded-2xl border px-4 py-3 transition-colors duration-300 ${BUBBLE_STYLES[vis]}`;
    tail.className = `owl-bubble-tail absolute -top-[7px] left-14 h-3 w-3 rotate-45 rounded-[2px] border-l border-t sm:left-20 ${TAIL_STYLES[vis]}`;
    message.textContent = customMessage ?? DEFAULT_MESSAGE[status];
    message.title = customMessage ?? "";
    message.className = `owl-message text-sm font-medium leading-relaxed sm:text-base ${MESSAGE_STYLES[vis]}`;
  }

  function setStatus(next: MascotStatus): void {
    status = next;
    render();
  }

  /** Show the tutor's latest guidance in the owl's speech bubble. */
  function setMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    customMessage = trimmed;
    render();
  }

  /** Clear the guidance (e.g. a new question was sent, or an error arrived). */
  function clearMessage(): void {
    customMessage = null;
    render();
  }

  setStatus("idle");
  return { setStatus, setMessage, clearMessage };
}

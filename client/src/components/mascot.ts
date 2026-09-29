// Wise Owl — the on-screen "visual teacher". Instead of a small header widget,
// the owl lives on a large classroom display above the conversation: a
// graduation-capped owl points at a lesson-board diagram, reacts to the AI
// lifecycle (idle / thinking / teaching), and shows the latest Socratic
// guidance in its speech bubble. (main.ts reads that guidance aloud in voice
// mode via speechSynthesis.)
//
// On small screens the display collapses to a compact one-line bar (small owl
// + its current line + expand chevron) so it doesn't eat the chat's vertical
// space; the chevron toggles the full classroom display.

export type MascotStatus = "idle" | "thinking" | "speaking";

/**
 * Instructional mode. `socratic` asks and withholds; `teach` explains directly.
 * The owl is the on-screen teacher, so the mode is shown on its own display
 * rather than buried in a settings panel.
 */
export type TutorMode = "socratic" | "teach";

const DEFAULT_MESSAGE: Record<MascotStatus, string> = {
  idle: "Hoo there! Ask me about any concept — I'll guide you with questions, not answers.",
  thinking: "Analyzing your question & sketching a step-by-step path…",
  speaking: "Hoo-hoo! Here is a guiding question for you!",
};

/** Idle line per mode, so the owl advertises what it's about to do. */
const MODE_IDLE_LINE: Record<TutorMode, string> = {
  socratic: "Hoo there! Ask me anything — I'll guide you with questions, not answers.",
  teach: "Teaching mode on. Name a topic and I'll explain it step by step.",
};

const MODE_PILL: Record<TutorMode, string> = {
  socratic: "Socratic",
  teach: "Teach me",
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
  <!-- eyes — wrapped so the blink can squash them vertically -->
  <g class="owl-eyes owl-blink" style="transform-origin:32px 24px">
    <circle cx="24" cy="24" r="6.5" fill="#fff"/>
    <circle cx="40" cy="24" r="6.5" fill="#fff"/>
    <circle cx="24" cy="${pupilY}" r="2.6" fill="#1e1b4b"/>
    <circle cx="40" cy="${pupilY}" r="2.6" fill="#1e1b4b"/>
  </g>
  <!-- academic glasses -->
  <circle cx="24" cy="24" r="8" class="${glasses}" stroke-width="1.6"/>
  <circle cx="40" cy="24" r="8" class="${glasses}" stroke-width="1.6"/>
  <path d="M32 22.5v3" class="${glasses}" stroke-width="1.6"/>
  <path d="M16 24H12" class="${glasses}" stroke-width="1.6"/>
  <path d="M48 24h4" class="${glasses}" stroke-width="1.6"/>
  <!-- beak — origin at the top hinge so scaleY opens and closes like a jaw -->
  <g class="owl-beak" style="transform-origin:32px 31px">
    <path d="M32 31l3.5 4.5c-1 1.4-2.4 2-3.5 2s-2.5-.6-3.5-2L32 31Z" fill="#f59e0b"/>
  </g>
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
function boardSvg(kind: "idle" | "thinking" | "teaching" | "explaining"): string {
  if (kind === "explaining") {
    // Teach mode: definition -> analogy -> worked example, the shape of the
    // explanation the tutor is actually giving.
    return `
<svg viewBox="0 0 160 100" class="h-auto w-full" aria-hidden="true">
  <rect x="14" y="14" width="132" height="16" rx="5" fill="rgba(56,189,248,0.14)" stroke="#38bdf8" stroke-width="1.6"/>
  <text x="80" y="25" text-anchor="middle" font-size="8" fill="#7dd3fc">plain definition</text>
  <path d="M80 32v7m0 0-3-3m3 3-3 3" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.7"/>
  <circle cx="42" cy="52" r="13" fill="none" stroke="#a78bfa" stroke-width="2.2"/>
  <path d="M42 45v14M35 52h14" stroke="#c4b5fd" stroke-width="1.6" stroke-linecap="round"/>
  <text x="42" y="75" text-anchor="middle" font-size="7.5" fill="#a78bfa">analogy</text>
  <circle cx="80" cy="52" r="13" fill="none" stroke="#fbbf24" stroke-width="2.2" class="animate-pulse"/>
  <text x="80" y="56" text-anchor="middle" font-size="12" font-weight="700" fill="#fde68a">1</text>
  <text x="80" y="75" text-anchor="middle" font-size="7.5" fill="#fbbf24">example</text>
  <circle cx="118" cy="52" r="13" fill="none" stroke="#34d399" stroke-width="2.2" stroke-dasharray="3 3"/>
  <text x="118" y="56" text-anchor="middle" font-size="12" font-weight="700" fill="#a7f3d0">2</text>
  <text x="118" y="75" text-anchor="middle" font-size="7.5" fill="#34d399">check</text>
  <text x="80" y="95" text-anchor="middle" font-size="8" fill="#64748b">Let me walk you through it</text>
</svg>`;
  }
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

export function createMascot(
  host: HTMLElement,
  onModeChange: (mode: TutorMode) => void = () => {},
): {
  setStatus: (s: MascotStatus) => void;
  setMessage: (text: string) => void;
  clearMessage: () => void;
  setMode: (m: TutorMode) => void;
  getMode: () => TutorMode;
  setSpeaking: (on: boolean) => void;
} {
  host.innerHTML = `
    <style>
      /* Blink runs always — a still-eyed owl reads as a mascot, not a teacher. */
      .owl-blink { animation: owlblink 5.4s ease-in-out infinite; }
      /* The beak only moves while a line is being delivered, so the owl
         doesn't chew on nothing. */
      .owl-beak { transform: scaleY(1); }
      .owl-talking .owl-beak { animation: owlbeak 0.42s steps(6, end) infinite; }
      @media (prefers-reduced-motion: reduce) {
        .owl-blink, .owl-talking .owl-beak { animation: none; }
      }
    </style>
    <div class="owl-display" data-state="idle">
      <div class="rounded-[1.75rem] border border-slate-700/70 bg-slate-800/40 p-1.5 shadow-2xl shadow-black/50">
        <div class="owl-screen relative overflow-hidden rounded-[1.35rem] border p-4 transition-all duration-300 sm:p-5 [background-image:radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_65%)]">
          <div class="owl-status-row mb-3 flex items-center gap-2">
            <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
            <span class="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500 sm:text-[10px]">AgentEd classroom display</span>
            <button
              type="button"
              class="owl-mode-toggle ml-auto shrink-0 rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-300 transition hover:border-indigo-500/60 hover:text-indigo-300 sm:text-[10px]"
              title="Switch between Socratic questions and direct explanations"
            ></button>
            <span class="owl-state-pill rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors sm:text-[10px]"></span>
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
            <div class="owl-compact hidden min-w-0 flex-1 items-center gap-2 sm:hidden">
              <p class="owl-compact-message min-w-0 flex-1 truncate text-xs font-medium"></p>
            </div>
            <button
              type="button"
              class="owl-toggle ml-1 shrink-0 rounded-lg border border-slate-700/80 bg-slate-800/60 p-1.5 text-slate-400 transition hover:text-slate-200 sm:hidden"
              aria-expanded="false"
              aria-label="Expand or collapse the classroom display"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" class="owl-chevron h-4 w-4 transition-transform" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.23 8.29a.75.75 0 0 1 0-1.08Z" clip-rule="evenodd"/>
              </svg>
            </button>
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

  // NB: query explicitly rather than firstElementChild — the scoped <style>
  // above is the host's first child now, and grabbing it would silently give us
  // a detached element with no descendants.
  const display = host.querySelector<HTMLElement>(".owl-display")!;
  const screen = display.querySelector<HTMLElement>(".owl-screen")!;
  const statusRow = display.querySelector<HTMLElement>(".owl-status-row")!;
  const pill = display.querySelector<HTMLElement>(".owl-state-pill")!;
  const visual = display.querySelector<HTMLElement>(".owl-visual")!;
  const boardArt = display.querySelector<HTMLElement>(".owl-board-art")!;
  const compactRow = display.querySelector<HTMLElement>(".owl-compact")!;
  const compactMessage = display.querySelector<HTMLElement>(".owl-compact-message")!;
  const toggleButton = display.querySelector<HTMLButtonElement>(".owl-toggle")!;
  const chevron = display.querySelector<HTMLElement>(".owl-chevron")!;
  const modeButton = display.querySelector<HTMLButtonElement>(".owl-mode-toggle")!;
  const bubble = display.querySelector<HTMLElement>(".owl-bubble")!;
  const tail = display.querySelector<HTMLElement>(".owl-bubble-tail")!;
  const message = display.querySelector<HTMLElement>(".owl-message")!;

  let status: MascotStatus = "idle";
  let customMessage: string | null = null;
  let mode: TutorMode = "socratic";
  /** True while the owl is actually delivering a line (mouth moving). */
  let talking = false;
  let revealTimer: number | null = null;
  // Mobile-first: the display starts collapsed on small screens, expanded on
  // desktop (>= sm, where the toggle button is hidden anyway).
  let collapsed = window.innerWidth < 640;

  /**
   * Words per tick. Roughly speech-rate when the owl is talking aloud, and
   * faster when it is only "speaking" visually.
   */
  const REVEAL_MS = 70;

  function stopReveal(): void {
    if (revealTimer !== null) {
      window.clearInterval(revealTimer);
      revealTimer = null;
    }
  }

  /**
   * Reveal the line word by word so the owl reads like it is speaking rather
   * than a caption snapping into place. The full text stays available in the
   * title/aria-label, so assistive tech still gets the whole line.
   */
  function startReveal(text: string): void {
    stopReveal();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      message.textContent = text;
      return;
    }
    let shown = 0;
    message.textContent = "";
    revealTimer = window.setInterval(() => {
      shown += 1;
      message.textContent = words.slice(0, shown).join(" ");
      if (shown >= words.length) {
        stopReveal();
        message.textContent = text;
      }
    }, REVEAL_MS);
  }

  function render(): void {
    // While the owl is showing the tutor's guidance it keeps its "teaching"
    // look (board diagram + amber bubble), even after the brief speaking
    // state reverts to idle.
    const vis: MascotStatus = customMessage && status !== "thinking" ? "speaking" : status;
    // Teach mode gets its own board: an explanation reads differently from a
    // quiz, and reusing the "1-2-3 quiz steps" art would misrepresent it.
    const boardKind =
      vis === "speaking" ? (mode === "teach" ? "explaining" : "teaching") : vis;
    const line =
      customMessage ?? (status === "idle" ? MODE_IDLE_LINE[mode] : DEFAULT_MESSAGE[status]);

    visual.innerHTML = owlSvg(status);
    visual.className = `owl-visual shrink-0 ${collapsed ? "h-11 w-11" : "h-28 w-28 sm:h-36 sm:w-36"} ${owlAnimation(status)}`;
    boardArt.innerHTML = boardSvg(boardKind);
    display.classList.toggle("owl-talking", talking);

    // The display chrome (pill, glow, dataset state) follows the *visible*
    // state: while the tutor's guidance is on screen the owl keeps presenting
    // it ("Teaching"), even after the momentary speaking bounce has calmed.
    display.dataset.state = vis;
    screen.className = `owl-screen relative overflow-hidden rounded-[1.35rem] border transition-all duration-300 [background-image:radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_65%)] ${collapsed ? "p-2.5" : "p-4 sm:p-5"} ${SCREEN_STYLES[vis]}`;

    statusRow.className = `owl-status-row mb-3 flex items-center gap-2 ${collapsed ? "hidden" : ""}`;
    pill.textContent = PILL_TEXT[vis];
    pill.className = `owl-state-pill ml-auto rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors sm:text-[10px] ${PILL_STYLES[vis]}`;

    compactRow.className = `owl-compact min-w-0 flex-1 items-center gap-2 sm:hidden ${collapsed ? "flex" : "hidden"}`;
    compactMessage.textContent = line;
    compactMessage.title = customMessage ?? "";
    compactMessage.className = `owl-compact-message min-w-0 flex-1 truncate text-xs font-medium ${MESSAGE_STYLES[vis]}`;

    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.title = collapsed ? "Expand the classroom display" : "Collapse the display";
    // NB: chevron is an <svg> — className is read-only on SVG elements, so use classList.
    chevron.classList.toggle("rotate-180", !collapsed);

    bubble.className = `owl-bubble relative mt-3 rounded-2xl border px-4 py-3 transition-colors duration-300 ${collapsed ? "hidden" : BUBBLE_STYLES[vis]}`;
    tail.className = `owl-bubble-tail absolute -top-[7px] left-14 h-3 w-3 rotate-45 rounded-[2px] border-l border-t sm:left-20 ${TAIL_STYLES[vis]}`;
    // render() is called on every status change, including the one that fires
    // the moment a line arrives — so it must NOT rewrite the bubble text, or it
    // would wipe the word-by-word reveal that setMessage just started.
    if (revealTimer === null) {
      message.textContent = line;
    }
    message.title = customMessage ?? "";
    message.setAttribute("aria-label", line);
    message.className = `owl-message text-sm font-medium leading-relaxed sm:text-base ${MESSAGE_STYLES[vis]}`;

    modeButton.textContent = MODE_PILL[mode];
    modeButton.setAttribute("aria-pressed", String(mode === "teach"));
    modeButton.setAttribute(
      "aria-label",
      mode === "teach"
        ? "Teaching mode. Switch back to Socratic questions."
        : "Socratic mode. Switch to direct explanations.",
    );
    modeButton.className = `owl-mode-toggle ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider transition sm:text-[10px] ${
      mode === "teach"
        ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
        : "border-slate-700 text-slate-300 hover:border-indigo-500/60 hover:text-indigo-300"
    }`;
  }

  function setStatus(next: MascotStatus): void {
    status = next;
    render();
  }

  /**
   * Switch between Socratic questioning and direct explanation. Clears any
   * in-flight reveal so the new mode's line renders immediately.
   */
  function setMode(next: TutorMode): void {
    if (next === mode) return;
    mode = next;
    stopReveal();
    render();
  }

  function getMode(): TutorMode {
    return mode;
  }

  /** Drive the mouth. Called around the speech-synthesis utterance. */
  function setSpeaking(next: boolean): void {
    if (next === talking) return;
    talking = next;
    display.classList.toggle("owl-talking", next);
  }

  /** Show the tutor's latest guidance in the owl's speech bubble. */
  function setMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    customMessage = trimmed;
    talking = true;
    render();
    startReveal(trimmed);
  }

  /** Clear the guidance (e.g. a new question was sent, or an error arrived). */
  function clearMessage(): void {
    customMessage = null;
    talking = false;
    stopReveal();
    render();
  }

  modeButton.addEventListener("click", () => {
    const next: TutorMode = mode === "teach" ? "socratic" : "teach";
    setMode(next);
    onModeChange(next);
  });

  toggleButton.addEventListener("click", () => {
    collapsed = !collapsed;
    render();
  });

  setStatus("idle");
  return { setStatus, setMessage, clearMessage, setMode, getMode, setSpeaking };
}

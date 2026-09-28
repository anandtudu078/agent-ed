// Wise Owl companion — rendered in the chat header and driven by the AI's
// lifecycle: idle (waiting), thinking (Groq+Gemini working), speaking (tutor
// reply just landed).

export type MascotStatus = "idle" | "thinking" | "speaking";

const MASCOT_COPY: Record<MascotStatus, string> = {
  idle: "Wise Owl is ready for your question…",
  thinking: "Analyzing code & formulating a Socratic hint…",
  speaking: "Hoo-hoo! Here is a guiding question for you!",
};

const CARD_STYLES: Record<MascotStatus, string> = {
  idle: "border-slate-800/80 bg-slate-900/60",
  thinking: "border-indigo-500/40 bg-slate-900/80 shadow-lg shadow-indigo-950/50",
  speaking: "border-amber-500/40 bg-slate-900/80 shadow-lg shadow-amber-950/40",
};

const TEXT_STYLES: Record<MascotStatus, string> = {
  idle: "text-slate-400",
  thinking: "text-indigo-300",
  speaking: "text-amber-300",
};

/** Custom SVG: a wise owl with big attentive eyes behind academic glasses. */
function owlSvg(status: MascotStatus): string {
  // Eye behaviour per state: idle = blink-ready wide, thinking = looking up
  // (pupils raised), speaking = wide open and lively.
  const pupilY = status === "thinking" ? 15 : 17;
  const glasses =
    status === "thinking"
      ? "stroke-indigo-300"
      : status === "speaking"
        ? "stroke-amber-300"
        : "stroke-slate-400";

  return `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 shrink-0" aria-hidden="true">
  <!-- body -->
  <path d="M32 8C20 8 12 18 12 32c0 14 9 24 20 24s20-10 20-24C52 18 44 8 32 8Z" fill="url(#owlBody)"/>
  <path d="M32 8c-4 0-7 1-9 3 3 2 6 5 9 5s6-3 9-5c-2-2-5-3-9-3Z" fill="#4338ca"/>
  <!-- ear tufts -->
  <path d="M16 14c-1-4-1-7 1-9 2 2 4 4 5 7l-6 2ZM48 14c1-4 1-7-1-9-2 2-4 4-5 7l6 2Z" fill="#4f46e5"/>
  <!-- facial disc -->
  <ellipse cx="32" cy="26" rx="17" ry="13" fill="#e0e7ff" opacity="0.95"/>
  <!-- eyes -->
  <circle cx="24" cy="17" r="6.5" fill="#fff"/>
  <circle cx="40" cy="17" r="6.5" fill="#fff"/>
  <circle cx="24" cy="${pupilY}" r="2.6" fill="#1e1b4b"/>
  <circle cx="40" cy="${pupilY}" r="2.6" fill="#1e1b4b"/>
  <!-- academic glasses -->
  <circle cx="24" cy="17" r="8" class="${glasses}" stroke-width="1.6"/>
  <circle cx="40" cy="17" r="8" class="${glasses}" stroke-width="1.6"/>
  <path d="M32 15.5v3" class="${glasses}" stroke-width="1.6"/>
  <path d="M16 17H12" class="${glasses}" stroke-width="1.6"/>
  <path d="M48 17h4" class="${glasses}" stroke-width="1.6"/>
  <!-- beak -->
  <path d="M32 24l3.5 4.5c-1 1.4-2.4 2-3.5 2s-2.5-.6-3.5-2L32 24Z" fill="#f59e0b"/>
  <!-- wing accents -->
  <path d="M14 36c2 8 7 14 12 16-6 0-11-3-13-8-1.4-3.2-1-6.4 1-8ZM50 36c-2 8-7 14-12 16 6 0 11-3 13-8 1.4-3.2 1-6.4-1-8Z" fill="#4338ca" opacity="0.7"/>
  <defs>
    <linearGradient id="owlBody" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6366f1"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
</svg>`;
}

/** The owl itself: gentle bob while idle, slow wobble while thinking, bounce while speaking. */
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

/** Small status dot next to the text (extra non-verbal cue). */
function dotAnimation(status: MascotStatus): string {
  switch (status) {
    case "thinking":
      return "bg-indigo-400 animate-ping";
    case "speaking":
      return "bg-amber-400";
    default:
      return "bg-slate-600";
  }
}

export function createMascot(host: HTMLElement): { setStatus: (s: MascotStatus) => void } {
  host.innerHTML = `
    <div class="flex items-center gap-3 rounded-2xl border px-3 py-2 backdrop-blur transition-all duration-300">
      <div class="owl-visual">${owlSvg("idle")}</div>
      <div class="min-w-0">
        <p class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span class="status-dot inline-block h-1.5 w-1.5 rounded-full bg-slate-600"></span>
          Wise Owl
        </p>
        <p class="truncate text-sm font-medium">Wise Owl is ready for your question…</p>
      </div>
    </div>`;

  const card = host.firstElementChild as HTMLElement;
  const visual = card.querySelector<HTMLElement>(".owl-visual")!;
  const dot = card.querySelector<HTMLElement>(".status-dot")!;
  const text = card.querySelector("p:nth-of-type(2)") as HTMLElement;

  function setStatus(status: MascotStatus): void {
    // Rebuild the SVG so pupil position / glasses colour react to the state.
    visual.innerHTML = owlSvg(status);
    visual.className = `owl-visual ${owlAnimation(status)}`;

    dot.className = `status-dot inline-block h-1.5 w-1.5 rounded-full ${dotAnimation(status)}`;
    text.textContent = MASCOT_COPY[status];
    text.className = `truncate text-sm font-medium transition-colors ${TEXT_STYLES[status]}`;
    card.className = `flex items-center gap-3 rounded-2xl border px-3 py-2 backdrop-blur transition-all duration-300 ${CARD_STYLES[status]}`;
  }

  setStatus("idle");
  return { setStatus };
}

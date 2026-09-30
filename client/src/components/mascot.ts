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

import { renderVisual, visualStepCount, type VisualSpec } from "./diagrams";
import { renderSketch, type SketchId } from "./sketches";

export type MascotStatus = "idle" | "thinking" | "speaking";

/**
 * How the owl *feels*, independent of what it is doing.
 *
 * Kept separate from `MascotStatus` on purpose. Status is the lifecycle (idle /
 * thinking / speaking); mood is the personality. A Duolingo-style character
 * comes alive from the gap between them — an owl that is *speaking* can be
 * excited, curious, or gently supportive, and folding those into a single
 * status enum would multiply into a combinatorial mess.
 */
export type MascotMood =
  | "neutral"
  | "happy"
  | "excited"
  | "curious"
  | "supportive"
  | "proud";

/** Moods that read as a reaction to the student, not the owl's own task. */
const REACTION_MOODS: ReadonlySet<MascotMood> = new Set([
  "excited",
  "supportive",
  "proud",
]);

/**
 * The owl's own lines. Deliberately short and a little cheeky — a mascot that
 * writes a paragraph stops being a character. The Hindi versions keep the same
 * register rather than translating literally.
 */
const MESSAGES: Record<TeachLanguage, Record<MascotStatus, string>> = {
  en: {
    idle: "Hoo there! Ask me about any concept — I'll guide you with questions, not answers.",
    thinking: "Analyzing your question & sketching a step-by-step path…",
    speaking: "Hoo-hoo! Here is a guiding question for you!",
  },
  hi: {
    idle: "नमस्ते! कोई भी topic पूछो — मैं सवालों से समझने में मदद करूँगा।",
    thinking: "आपका सवाल समझ रहा हूँ और step-by-step तैयार कर रहा हूँ…",
    speaking: "यह लो, एक सवाल तुम्हें सोचने में मदद करेगा!",
  },
};

/**
 * Reaction lines, shown when the owl reacts to how the student is doing.
 * These are the lines that make it feel like a companion rather than a widget.
 */
const REACTION_LINES: Record<
  TeachLanguage,
  Partial<Record<MascotMood, string[]>>
> = {
  en: {
    excited: [
      "Yes! That's it! You just got the idea on the first try. 🎉",
      "That's the one! Hoo-good work — I'd high-five you if I had hands.",
    ],
    proud: [
      "Look at you go. That's a real answer, not a guess. 🌟",
      "Hoo! That reasoning is solid. Trust it next time too.",
    ],
    supportive: [
      "Close! Not quite, but you're one step away — let's look again. 🦉",
      "Nearly there. Wrong answers are how the brain files this away. Try once more?",
    ],
    happy: [
      "Nice! Want to push a little further?",
      "That's flowing now. Shall we go deeper?",
    ],
    curious: [
      "Ooh, good question — let me think about that one.",
      "Hmm, I like that. Give me a second…",
    ],
  },
  hi: {
    excited: [
      "बिलकुल सही! तुमने पहली बार में समझ लिया! 🎉",
      "वाह, एकदम सही! शाबाश।",
    ],
    proud: [
      "देखो कैसे सोच रहे हो — ये असली समझ है। 🌟",
      "बहुत बढ़िया! तुम्हारा तर्क मज़बूत है।",
    ],
    supportive: [
      "लगभग सही! बस एक कदम दूर — चलो फिर से देखते हैं। 🦉",
      "गलती से ही सीख बनती है। एक बार और कोशिश करो?",
    ],
    happy: [
      "बढ़िया! और गहराई में जाना है?",
      "अब तो आसान लग रहा है। आगे बढ़ें?",
    ],
    curious: [
      "अरे, बहुत अच्छा सवाल — सोचने देता हूँ।",
      "हम्म, ये अच्छा है। एक सेकंड…",
    ],
  },
};

/** Pick a reaction line, preferring the student's language. */
export function reactionLine(
  mood: MascotMood,
  language: TeachLanguage,
  index: number,
): string | null {
  const pool = REACTION_LINES[language][mood];
  if (!pool || !pool.length) return null;
  return pool[index % pool.length];
}


/**
 * Instructional mode. `socratic` asks and withholds; `teach` explains directly.
 * The owl is the on-screen teacher, so the mode is shown on its own display
 * rather than buried in a settings panel.
 */
export type TutorMode = "socratic" | "teach";

/** Teaching language. The owl's own phrases follow this too. */
export type TeachLanguage = "en" | "hi";

/** The owl's own lines, in both languages. */
const MODE_IDLE_LINE: Record<TutorMode, string> = {
  socratic: "Hoo there! Ask me anything — I'll guide you with questions, not answers.",
  teach: "Teaching mode on. Name a topic and I'll explain it step by step.",
};

const MODE_IDLE_LINE_HI: Record<TutorMode, string> = {
  socratic: "नमस्ते! कुछ भी पूछो — मैं सवालों के ज़रिए समझाऊँगा, सीधा जवाब नहीं दूँगा।",
  teach: "Teaching mode चालू है। कोई भी topic बताओ, मैं step-by-step समझाऊँगा।",
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

/**
 * Eyes, brows and blush, all driven by mood.
 *
 * The brows and the eye *shape* carry most of the expression. A mascot that
 * only changes colour reads as a status light; one that changes the actual
 * geometry of its face reads as a character.
 */
function faceSvg(status: MascotStatus, mood: MascotMood): string {
  const glasses =
    status === "thinking"
      ? "stroke-indigo-300"
      : status === "speaking"
        ? "stroke-amber-300"
        : "stroke-slate-400";

  // Closed happy arcs (^^) for celebration, wide eyes for surprise/surprise-ish
  // reaction, half-lidded for thinking, otherwise a normal round eye.
  const eyeShape = (cx: number): string => {
    if (mood === "excited" || mood === "proud" || mood === "happy") {
      return `<path d="M${cx - 6} 25.5q6-7 12 0" stroke="#1e1b4b" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
    }
    if (status === "thinking") {
      // Half-lidded, eyes drifting up toward the board.
      return `<path d="M${cx - 6} 25q6 2.4 12 0" stroke="#1e1b4b" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
    }
    const r = mood === "supportive" ? 5.6 : 6.5;
    return `<circle cx="${cx}" cy="24" r="${r}" fill="#fff"/><circle cx="${cx}" cy="24" r="2.6" fill="#1e1b4b"/><circle cx="${cx + 0.9}" cy="22.9" r="0.9" fill="#fff"/>`;
  };

  // Eyebrow angle: raised when curious, dipped when proud, flat when neutral.
  const brow = (cx: number): string => {
    const tilt =
      mood === "curious" ? -2.2 : mood === "supportive" ? 1.6 : mood === "excited" ? -1.2 : 0;
    if (mood === "excited" || mood === "proud") {
      return `<path d="M${cx - 6.5} 15.5q6.5-3.4 13 0" stroke="#312e81" stroke-width="1.9" stroke-linecap="round" fill="none"/>`;
    }
    return `<path d="M${cx - 6.5} ${17 + tilt}q6.5 ${tilt ? -2.6 : -0.6} 13 0" stroke="#312e81" stroke-width="1.9" stroke-linecap="round" fill="none"/>`;
  };

  // Blush only on the warm moods — a permanent blush would just be decoration.
  const blush =
    mood === "excited" || mood === "happy" || mood === "proud"
      ? `<ellipse cx="17.5" cy="29.5" rx="3.6" ry="2.3" fill="#fb7185" opacity="0.4"/><ellipse cx="46.5" cy="29.5" rx="3.6" ry="2.3" fill="#fb7185" opacity="0.4"/>`
      : "";

  return `
  <g class="owl-eyes owl-blink" style="transform-origin:32px 24px">
    ${eyeShape(24)}
    ${eyeShape(40)}
  </g>
  <g class="owl-brows">${brow(24)}${brow(40)}</g>
  ${blush}
  <circle cx="24" cy="24" r="8" class="${glasses}" stroke-width="1.6"/>
  <circle cx="40" cy="24" r="8" class="${glasses}" stroke-width="1.6"/>
  <path d="M32 22.5v3" class="${glasses}" stroke-width="1.6"/>
  <path d="M16 24H12" class="${glasses}" stroke-width="1.6"/>
  <path d="M48 24h4" class="${glasses}" stroke-width="1.6"/>`;
}

/** The owl itself: a graduation-capped owl whose face and posture react. */
function owlSvg(status: MascotStatus, mood: MascotMood): string {
  // The right wing points at the lesson board while teaching and flaps when
  // the owl celebrates; a supportive owl offers an open palm instead.
  const rightWing =
    status === "speaking" && mood !== "supportive"
      ? '<path d="M47 43c4.5-.8 8.5-2.8 11.5-6l3.2 3c-3.6 4-8.4 6.4-13.7 7.4L47 43Z" fill="#4338ca"/><g class="owl-pointer"><path d="M60.5 38.5l3-7" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round"/><circle cx="63.9" cy="30" r="1.7" fill="#f59e0b"/></g>'
      : mood === "excited" || mood === "proud"
        ? // Wing thrown up mid-celebration.
          '<path d="M46 41c4.5-1.5 8-4.5 10.5-8.5l4 2.4c-3 5-7.5 8.5-13 10.3L46 41Z" fill="#4338ca"/>'
        : mood === "supportive"
          ? // Open, gentle palm — "it's okay, try again".
            '<path d="M47 42c5 0 9 1.6 12.2 4.6l-2.6 3.4c-3.4-2.4-7.2-3.6-11.4-3.8L47 42Z" fill="#4338ca" opacity="0.85"/>'
          : status === "thinking"
            ? '<path d="M46 41c4.5-1.5 8-4.5 10.5-8.5l4 2.4c-3 5-7.5 8.5-13 10.3L46 41Z" fill="#4338ca"/>'
            : '<path d="M50 42c-2 8-7 14-12 16 6 0 11-3 13-8 1.4-3.2 1-6.4-1-8Z" fill="#4338ca" opacity="0.7"/>';

  const leftWing =
    '<path d="M14 42c2 8 7 14 12 16-6 0-11-3-13-8-1.4-3.2-1-6.4 1-8Z" fill="#4338ca" opacity="0.7"/>';

  // Sparkles only while celebrating — a permanent sparkle would be noise.
  const sparkles =
    mood === "excited" || mood === "proud"
      ? `<g class="owl-sparkles" fill="#fbbf24"><path d="M8 18l1.2 3 3 1.2-3 1.2L8 26.4 6.8 23.4 3.8 22.2l3-1.2L8 18Z"/><path d="M56 20l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z"/></g>`
      : "";

  return `
<svg viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-full w-full" aria-hidden="true">
  <g class="owl-cap">
    <path d="M32 0.5L49 7 32 13.5 15 7 32 0.5Z" fill="#334155"/>
    <path d="M15 7L32 13.5 49 7 49 9.2 32 15.7 15 9.2 15 7Z" fill="#1e293b"/>
    <path d="M24 11.5v4c0 2.2 16 2.2 16 0v-4" fill="#312e81"/>
    <path d="M49 7v7.5" stroke="#f59e0b" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="49" cy="16" r="1.8" fill="#f59e0b"/>
    <circle cx="32" cy="7" r="1.2" fill="#94a3b8"/>
  </g>
  <g class="owl-body-grp">
    <path d="M32 14C20 14 12 24 12 38c0 14 9 24 20 24s20-10 20-24C52 24 44 14 32 14Z" fill="url(#owlBody)"/>
    <ellipse cx="32" cy="33" rx="17" ry="13" fill="#e0e7ff" opacity="0.95"/>
    ${faceSvg(status, mood)}
    <g class="owl-beak" style="transform-origin:32px 31px">
      <path d="M32 31l3.5 4.5c-1 1.4-2.4 2-3.5 2s-2.5-.6-3.5-2L32 31Z" fill="#f59e0b"/>
    </g>
    ${leftWing}
    ${rightWing}
    ${sparkles}
  </g>
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
  /**
   * Change the owl's mood. `sticky` moods (curious, happy) stay until changed;
   * reaction moods auto-relax to neutral so the owl doesn't get stuck beaming.
   */
  setMood: (next: MascotMood, options?: { holdMs?: number }) => void;
  /** The line currently on the owl's display, for handing off to speech. */
  message: () => string;
  /**
   * React to how the student is doing, and speak a matching line.
   * Returns false when the owl had nothing to say for that outcome.
   */
  react: (outcome: "correct" | "close" | "wrong" | "great") => boolean;
  /** Show a topic diagram on the lesson board. */
  setVisual: (spec: VisualSpec | null) => void;
  /** Show the picture for the beat being spoken, or null for none. */
  setSketch: (id: SketchId | null) => void;
  /** Move the highlight, so the board tracks what the owl is saying. */
  setVisualStep: (index: number) => void;
  /** How many highlightable elements the current diagram has. */
  visualStepCount: () => number;
  /** Switch the owl's own language. */
  setLanguage: (language: TeachLanguage) => void;
} {
  host.innerHTML = `
    <style>
      /* Blink runs always — a still-eyed owl reads as a mascot, not a teacher.
         The delay is randomised per-render (see randomizeBlink) so the blink
         never falls into a metronome the student can predict. */
      .owl-blink { animation: owlblink 5.4s ease-in-out infinite; }
      /* Breathing: a very small continuous scale on the body only. Kept subtle
         on purpose — a large one makes a lesson feel seasick. */
      .owl-body-grp { animation: owlbreathe 4.2s ease-in-out infinite; transform-origin:32px 62px; }
      .owl-beak { transform: scaleY(1); }
      .owl-talking .owl-beak { animation: owlbeak 0.42s steps(6, end) infinite; }
      /* Celebration: a real hop, with the body squash-and-stretch underneath
         so the landing reads as weight rather than a slide. The mood class and
         .owl-visual sit on the SAME element, so this must be a compound
         selector - a descendant selector would never match. */
      .owl-visual.owl-mood-excited, .owl-visual.owl-mood-proud {
        animation: owlhop 0.62s cubic-bezier(0.28, 0.84, 0.42, 1) 3;
      }
      .owl-mood-excited .owl-sparkles, .owl-mood-proud .owl-sparkles {
        animation: owlsparkle 0.62s ease-out 3;
        transform-origin:32px 22px;
      }
      .owl-visual.owl-mood-supportive { animation: owlnod 2.4s ease-in-out infinite; }
      .owl-mood-curious .owl-brows { animation: owlbrowraise 2.6s ease-in-out infinite; }
      @keyframes owlbreathe { 0%,100% { transform: scale(1,1); } 50% { transform: scale(1.012,1.022); } }
      @keyframes owlhop { 0% { transform: translateY(0) scaleY(1); } 30% { transform: translateY(0) scaleY(0.9); } 55% { transform: translateY(-16px) scaleY(1.07); } 100% { transform: translateY(0) scaleY(1); } }
      @keyframes owlsparkle { 0% { opacity: 0; transform: scale(0.4) rotate(0deg); } 40% { opacity: 1; transform: scale(1.15) rotate(22deg); } 100% { opacity: 0; transform: scale(0.7) rotate(45deg); } }
      @keyframes owlnod { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(2.5deg); } }
      @keyframes owlbrowraise { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.4px); } }
      @media (prefers-reduced-motion: reduce) {
        .owl-blink, .owl-talking .owl-beak, .owl-body-grp,
        .owl-visual.owl-mood-excited, .owl-visual.owl-mood-proud,
        .owl-mood-excited .owl-sparkles, .owl-mood-proud .owl-sparkles,
        .owl-visual.owl-mood-supportive, .owl-mood-curious .owl-brows { animation: none; }
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
  /** Topic diagram for the board, when the tutor is explaining one. */
  let topicVisual: VisualSpec | null = null;
  /**
   * A picture matching the beat being spoken, when there is a good one.
   *
   * Takes priority over the diagram: a beat saying "teach a child to spot a cat"
   * should show the cat, not the six-step diagram chosen for the whole reply.
   * Null falls back to the diagram, which is the right default for a beat with
   * no concrete thing to point at.
   */
  let activeSketch: SketchId | null = null;
  /** Which element of the diagram the owl is currently on. */
  let visualStep = -1;
  /** Language for the owl's own phrases. */
  let language: TeachLanguage = "en";
  /** How the owl currently feels. Drives the face, not the lifecycle. */
  let mood: MascotMood = "neutral";
  /** Timer that relaxes a reaction mood back to neutral. */
  let moodTimer: number | null = null;
  /** Rotates through a mood's line variants so reactions don't repeat. */
  let reactionCount = 0;
  /** The line last painted onto the display; read back via message(). */
  let currentLine = "";
  // Mobile-first: the display starts collapsed on small screens, expanded on
  // desktop (>= sm, where the toggle button is hidden anyway).
  let collapsed = window.innerWidth < 640;
  // Set once the student toggles the display themselves; after that their
  // choice wins over the viewport-derived default.
  let userToggled = false;

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
      customMessage ??
      (status === "idle"
        ? language === "hi"
          ? MODE_IDLE_LINE_HI[mode]
          : MODE_IDLE_LINE[mode]
        : MESSAGES[language][status]);

    visual.innerHTML = owlSvg(status, mood);
    // Irregular blink: a fixed-delay blink reads as mechanical. A negative
    // delay lands the animation partway into its own cycle, so consecutive
    // renders blink at different phases.
    const blinkEl = visual.querySelector<SVGElement>(".owl-blink");
    if (blinkEl) {
      blinkEl.style.animationDelay = `${(-Math.random() * 5.4).toFixed(2)}s`;
    }
    // Animate the *visible* state so the owl's motion always matches the
    // chrome around it (pill, board, bubble).
    visual.className = `owl-visual owl-mood-${mood} shrink-0 ${collapsed ? "h-11 w-11" : "h-28 w-28 sm:h-36 sm:w-36"} ${owlAnimation(vis)}`;
    // A real topic diagram takes the board whenever the tutor is explaining
    // one — it's the whole point of the visual teacher. The state sketches
    // are the fallback when there's nothing specific to show.
    // A beat sketch wins over both: it is the picture for *this* sentence.
    const sketch = renderSketch(activeSketch);
    const diagram = topicVisual ? renderVisual(topicVisual, visualStep) : "";
    boardArt.innerHTML = sketch || diagram || boardSvg(boardKind);
    boardArt.classList.toggle("owl-board-visual", Boolean(sketch || diagram));
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
    currentLine = line;
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
    // The old diagram belonged to the previous topic; leaving it up would show
    // a picture of something the student is no longer asking about.
    topicVisual = null;
    activeSketch = null;
    visualStep = -1;
    stopReveal();
    render();
  }

  modeButton.addEventListener("click", () => {
    const next: TutorMode = mode === "teach" ? "socratic" : "teach";
    setMode(next);
    onModeChange(next);
  });

  /** Put a topic diagram on the board, or take it away. */
  function setVisual(spec: VisualSpec | null): void {
    // A new diagram means a new explanation, so any picture left over from the
    // previous beat belongs to a sentence the student can no longer see.
    activeSketch = null;
    topicVisual = spec;
    visualStep = -1;
    render();
  }

  /**
   * Show the picture for the beat currently being spoken.
   *
   * Separate from setVisual on purpose: the diagram is the skeleton of the whole
   * explanation and outlives any one sentence, while a sketch is borrowed for a
   * single beat. Passing null returns the board to the diagram without
   * disturbing it.
   */
  function setSketch(id: SketchId | null): void {
    if (id === activeSketch) return;
    activeSketch = id;
    render();
  }

  /** Move the highlight. Re-renders only when the step actually changes. */
  function setVisualStep(index: number): void {
    if (index === visualStep || !topicVisual) return;
    visualStep = index;
    render();
  }

  toggleButton.addEventListener("click", () => {
    collapsed = !collapsed;
    userToggled = true;
    render();
  });

  // Keep the default (collapsed on phones, expanded on desktop) in step with
  // the viewport — rotation and window resizes otherwise leave it stale.
  // Once the student has toggled it themselves, their choice wins.
  window.addEventListener("resize", () => {
    if (userToggled) return;
    const next = window.innerWidth < 640;
    if (next === collapsed) return;
    collapsed = next;
    render();
  });

  setStatus("idle");
  /** Switch the owl's own language. */
  function setLanguage(next: TeachLanguage): void {
    if (next === language) return;
    language = next;
    // Drop the old line so the new language shows immediately rather than
    // waiting for the next reply.
    customMessage = null;
    render();
  }

  /**
   * React to the student's answer.
   *
   * "close" and "wrong" are deliberately different: being nearly right is a
   * different emotional moment from missing entirely, and collapsing them into
   * one "wrong" reaction would make the owl feel like it isn't paying
   * attention. Nothing is said on a run of wrong answers beyond a gentle
   * nudge — a mascot that lectures is worse than one that's briefly warm.
   */
  function react(outcome: "correct" | "close" | "wrong" | "great"): boolean {
    const moodFor: Record<typeof outcome, MascotMood> = {
      great: "proud",
      correct: "excited",
      close: "happy",
      wrong: "supportive",
    };
    const next = moodFor[outcome];
    reactionCount += 1;
    const line = reactionLine(next, language, reactionCount);
    if (!line) return false;
    customMessage = line;
    // Deliberately does NOT touch `status`: main.ts owns the lifecycle (and
    // owns the 4s revert timer). Setting it here would leave the owl showing
    // "speaking" with nothing to ever bring it back.
    setMood(next, { holdMs: 4200 });
    render();
    return true;
  }

  function setMood(next: MascotMood, options?: { holdMs?: number }): void {
    if (moodTimer !== null) {
      window.clearTimeout(moodTimer);
      moodTimer = null;
    }
    mood = next;
    if (options?.holdMs && REACTION_MOODS.has(next)) {
      moodTimer = window.setTimeout(() => {
        mood = "neutral";
        moodTimer = null;
        // Fall back to the idle line once the celebration is over, otherwise
        // the reaction line stays on screen looking like a stuck state.
        if (customMessage && reactionLine(next, language, reactionCount) === customMessage) {
          customMessage = null;
        }
        render();
      }, options.holdMs);
    }
    render();
  }

  return {
    setStatus,
    setMessage,
    clearMessage,
    setMode,
    getMode,
    setSpeaking,
    setMood,
    message: () => currentLine,
    react,
    setVisual,
    setVisualStep,
    /** Show the picture for the beat being spoken, or null for none. */
    setSketch,
    visualStepCount: () => visualStepCount(topicVisual),
    setLanguage,
  };
}

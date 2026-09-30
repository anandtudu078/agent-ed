// Beat sketches - small hand-drawn pictures the owl puts on the lesson board to
// match what it is currently saying.
//
// The request behind this: "if it says child, show a child". A teacher in a live
// class does not only speak, they point at things, and the picture arrives with
// the sentence rather than after the whole lesson. The diagram system already
// covers *structure* (steps, cycles, comparisons), but it is chosen once per
// reply, so during a five-beat explanation the board shows one static picture
// while the owl talks about something else entirely.
//
// So each beat gets its own picture, chosen by matching what that beat says.
//
// Deliberately a closed, hand-authored set rather than generated images or an
// image model. Three reasons, in order of importance:
//   1. Latency. A picture per beat means a beat per image call. The owl would
//      stall mid-sentence, which is worse than no picture.
//   2. Trust. These are lesson visuals for students. A fixed vetted drawing is
//      reviewable; a generated one is not.
//   3. Cost. This runs on every teach turn.
//
// Every sketch here is static SVG written by hand. Nothing in this file accepts
// text from the model or the student, so it cannot be an injection surface -
// the same reasoning that governs diagrams.ts.
const INK = "#e2e8f0";
const SOFT = "#94a3b8";
const LINE = "#475569";
const ACCENT = "#818cf8";
const GOLD = "#fbbf24";
const VW = 320;
const VH = 210;

export type SketchId = "child" | "cat" | "email" | "brain" | "network" | "book" | "chart" | "gear" | "eye" | "sound" | "robot" | "bulb" | "warning" | "question" | "key" | "data";

function frame(inner: string, label: string): string {
  return `<svg viewBox="0 0 ${VW} ${VH}" class="h-auto w-full" role="img" aria-label="${label}"><title>${label}</title>${inner}</svg>`;
}

const SKETCHES: Record<SketchId, [label: string, svg: string]> = {
  child: ["A child",
    `<circle cx="160" cy="72" r="26" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M160 98v34M160 108l-20 12M160 108l20 12M138 148v-26M182 148v-26" stroke="${INK}" stroke-width="3" stroke-linecap="round" fill="none"/>` +
    `<circle cx="152" cy="68" r="2.6" fill="${INK}"/><circle cx="168" cy="68" r="2.6" fill="${INK}"/>` +
    `<path d="M152 80q8 7 16 0" stroke="${SOFT}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
    `<path d="M96 148h128" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`],
  cat: ["A cat",
    `<path d="M118 96l-6-34 30 16M202 96l6-34-30 16" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<ellipse cx="160" cy="112" rx="42" ry="34" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="146" cy="106" r="3" fill="${INK}"/><circle cx="174" cy="106" r="3" fill="${INK}"/>` +
    `<path d="M156 120h8l-4 5Z" fill="${GOLD}"/>` +
    `<path d="M112 116l-16-4M112 124l-16 4M208 116l16-4M208 124l16 4" stroke="${SOFT}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M202 140q22 6 18 26" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<path d="M104 158h112" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`],
  email: ["An email inbox",
    `<rect x="72" y="70" width="176" height="110" rx="10" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M72 78l88 58 88-58" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<circle cx="106" cy="66" r="9" fill="${GOLD}"/>` +
    `<path d="M244 96l6 14h-12Z" fill="${ACCENT}"/>` +
    `<path d="M56 180h208" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`],
  brain: ["A brain",
    `<path d="M132 74c-18 0-30 12-30 26 0 8 4 14 10 18-8 6-12 14-12 24 0 16 14 26 32 26" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M188 74c18 0 30 12 30 26 0 8-4 14-10 18 8 6 12 14 12 24 0 16-14 26-32 26" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M132 92v84M156 88v92M180 92v84" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`],
  network: ["A network of connected nodes",
    `<path d="M160 66l-58 42M160 66l58 42M102 108l-34 40M218 108l34 40M160 66v84M102 108l58 42M218 108l-58 42" stroke="${LINE}" stroke-width="2" fill="none"/>` +
    `<circle cx="160" cy="66" r="11" fill="${ACCENT}"/>` +
    `<circle cx="102" cy="108" r="9" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="218" cy="108" r="9" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="68" cy="148" r="8" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="252" cy="148" r="8" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="160" cy="150" r="10" fill="${GOLD}"/>`],
  book: ["A book",
    `<path d="M160 84c-18-12-40-14-64-12v78c24-2 46 0 64 12z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M160 84c18-12 40-14 64-12v78c-24-2-46 0-64 12z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M160 84v78" stroke="${SOFT}" stroke-width="2.5"/>`],
  chart: ["A bar chart",
    `<path d="M74 62v96h172" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<rect x="96" y="112" width="28" height="40" rx="4" fill="none" stroke="${ACCENT}" stroke-width="3"/>` +
    `<rect x="144" y="86" width="28" height="66" rx="4" fill="none" stroke="${ACCENT}" stroke-width="3"/>` +
    `<rect x="192" y="70" width="28" height="82" rx="4" fill="none" stroke="${GOLD}" stroke-width="3"/>`],
  gear: ["A gear",
    `<circle cx="160" cy="106" r="30" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="160" cy="106" r="11" fill="none" stroke="${SOFT}" stroke-width="2.5"/>` +
    `<path d="M160 60v14M160 138v14M114 106h14M192 106h14M128 74l10 10M182 128l10 10M192 74l-10 10M138 128l-10 10" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`],
  eye: ["An eye",
    `<path d="M70 106q90-64 180 0-90 64-180 0Z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<circle cx="160" cy="106" r="24" fill="none" stroke="${ACCENT}" stroke-width="3"/>` +
    `<circle cx="160" cy="106" r="8" fill="${INK}"/>` +
    `<path d="M64 158h192" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`],
  sound: ["A sound wave",
    `<path d="M120 106V78l26-16v88l-26-16z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M162 92q10 14 0 28M178 80q18 26 0 52M196 68q26 38 0 76" fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M92 162h136" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`],
  robot: ["A robot",
    `<rect x="106" y="76" width="108" height="88" rx="14" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M160 76V58" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="160" cy="52" r="7" fill="${ACCENT}"/>` +
    `<circle cx="138" cy="108" r="7" fill="${ACCENT}"/><circle cx="182" cy="108" r="7" fill="${ACCENT}"/>` +
    `<path d="M142 136h36" stroke="${SOFT}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M106 96H84M106 120H84M214 96h22M214 120h22" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`],
  bulb: ["A lightbulb",
    `<path d="M160 58a34 34 0 0 1 20 62c-4 4-6 8-6 12h-28c0-4-2-8-6-12a34 34 0 0 1 20-62Z" fill="none" stroke="${GOLD}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M148 142h24M152 152h16" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M196 66l14-14M232 82h18M124 66l-14-14" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>`],
  warning: ["A warning sign",
    `<path d="M160 56l104 100H56Z" fill="none" stroke="${GOLD}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M160 96v40" stroke="${GOLD}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="160" cy="148" r="4.5" fill="${GOLD}"/>`],
  question: ["A question",
    `<path d="M132 84a28 28 0 1 1 28 28v16" fill="none" stroke="${ACCENT}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="160" cy="150" r="5.5" fill="${ACCENT}"/>` +
    `<path d="M96 176h128" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`],
  key: ["A key",
    `<circle cx="112" cy="106" r="26" fill="none" stroke="${INK}" stroke-width="3.5"/>` +
    `<circle cx="112" cy="106" r="9" fill="none" stroke="${INK}" stroke-width="2.5"/>` +
    `<path d="M138 106h96M204 106v22M228 106v16" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`],
  data: ["Rows of data",
    `<ellipse cx="160" cy="80" rx="66" ry="18" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M94 80v52c0 10 30 18 66 18s66-8 66-18V80" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M94 106c0 10 30 18 66 18s66-8 66-18" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path d="M94 132c0 10 30 18 66 18s66-8 66-18" fill="none" stroke="${INK}" stroke-width="3"/>`],
};

const CUES: Array<{ id: SketchId; words: string[] }> = [
  { id: "email", words: ["email", "e-mail", "inbox", "spam", "mail", "ईमेल", "स्पैम"] },
  { id: "cat", words: ["cat", "kitten", "dog", "puppy", "animal", "बिल्ली", "कुत्ता", "जानवर"] },
  { id: "child", words: ["child", "children", "kid", "baby", "toddler", "student", "बच्चा", "बच्चे", "शिशु"] },
  { id: "network", words: ["neural network", "network", "layer", "node", "weights", "connected", "नेटवर्क", "तंत्रिका"] },
  { id: "brain", words: ["brain", "neuron", "memory", "understand", "दिमाग"] },
  { id: "chart", words: ["chart", "graph", "bar", "measure", "accuracy", "score", "percentage", "ग्राफ", "चार्ट"] },
  { id: "eye", words: ["image", "picture", "photo", "vision", "camera", "face", "तस्वीर", "आँख", "दृष्टि"] },
  { id: "sound", words: ["speech", "voice", "sound", "audio", "listen", "speak", "आवाज़", "बोलना", "ध्वनि"] },
  { id: "robot", words: ["robot", "agent", "autonomous", "drone"] },
  { id: "data", words: ["data", "dataset", "record", "row", "table", "database", "डेटा", "आँकड़े"] },
  { id: "book", words: ["learn", "study", "text", "document", "read", "book", "पढ़", "किताब"] },
  { id: "gear", words: ["process", "rule", "step", "algorithm", "compute", "engine", "प्रक्रिया", "नियम"] },
  { id: "key", words: ["important", "key idea", "remember", "crucial", "मुख्य", "याद रख"] },
  { id: "warning", words: ["caveat", "mistake", "wrong", "fail", "limit", "careful", "problem", "गलत", "सावधान", "सीमा"] },
];

const KIND_FALLBACK: Record<string, SketchId> = { check: "question", example: "bulb" };

/**
 * Choose a sketch for a beat, or null when nothing fits.
 *
 * Null is a legitimate and frequent answer: a beat that only says "the model
 * adjusts its numbers" matches no picture, and inventing one would be noise. The
 * board falls back to the diagram in that case.
 *
 * On a beat naming TWO concrete things ("teach a child to recognise a cat") the
 * table order decides, and CUES is ordered most-specific-first. The cat wins
 * over the child because the cat is the thing being recognised - the thing a
 * picture would actually clarify. This is a deliberate trade: a correct answer
 * would need to know which noun the sentence is *about*, and a keyword table
 * cannot. Ordering by specificity is the closest cheap approximation, and being
 * slightly off costs one sentence rather than the lesson.
 */
export function sketchForBeat(text: string, kind: string): SketchId | null {
  const hay = text.toLowerCase();
  const asking = kind === "check";
  for (const { id, words } of CUES) {
    // A question beat skips the warning triangle. The closing check usually
    // contains the word "wrong" ("what would you guess it gets wrong?"), and a
    // hazard sign next to a question reads as the owl correcting the student
    // instead of inviting an answer. Content keywords still win on a question,
    // so asking about spam still shows the inbox.
    if (asking && id === "warning") continue;
    if (words.some((w) => hay.includes(w))) return id;
  }
  return KIND_FALLBACK[kind] ?? null;
}

/** Render a sketch. Returns "" for null/unknown so callers can fall back. */
export function renderSketch(id: SketchId | null | undefined): string {
  if (!id) return "";
  const entry = SKETCHES[id];
  if (!entry) return "";
  return frame(entry[1], entry[0]);
}

export function sketchIds(): SketchId[] {
  return Object.keys(SKETCHES) as SketchId[];
}


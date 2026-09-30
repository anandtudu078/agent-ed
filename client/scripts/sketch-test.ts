// Permanent unit tests for beat sketches (client side).
//
// Run: npm run test:sketches
//
// The bar is precision, not coverage. A picture that appears on the wrong beat is
// worse than no picture, because a student reads it as the owl's point rather
// than as decoration. So the assertions that matter are the ambiguous ones — a
// beat naming two objects, a beat naming nothing — plus the guarantee that the
// matcher can never emit a sketch that does not exist.

import { sketchForBeat, renderSketch, sketchIds } from "../src/components/sketches.ts";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

// --- 1. The headline case from the request -------------------------------
// "if it says child then show a child", and likewise for the rest.
const expectations: Array<[string, string]> = [
  ["Teach it to someone who has never seen a cat before.", "cat"],
  ["Think of it like showing a young learner many cats.", "cat"],
  ["You show the model ten thousand emails to spot spam.", "email"],
  ["A neural network has layers of connected nodes.", "network"],
  ["The model learns from data in a dataset.", "data"],
  ["A robot learns to drive by itself.", "robot"],
  ["Speech recognition turns voice into text.", "sound"],
  ["Computer vision lets a camera recognise a face.", "eye"],
  ["The accuracy is shown as a bar chart.", "chart"],
  ["The caveat people miss is that it can be wrong.", "warning"],
];
for (const [text, want] of expectations) {
  const got = sketchForBeat(text, "point");
  check(`"${text.slice(0, 34)}…" → ${want}`, got === want, String(got));
}

// A beat about a person on their own still gets the person. Uses a fixture with
// no second concrete noun, since that is the case this is actually asserting.
check(
  "a beat about a child alone shows the child",
  sketchForBeat("A child learns by being shown examples.", "point") === "child",
  String(sketchForBeat("A child learns by being shown examples.", "point")),
);

// --- 2. Specificity beats breadth ---------------------------------------
// A beat naming two concrete things should show the more specific one. Spam is
// an email; a generic warning triangle would be vague and wrong.
check(
  "spam shows the envelope, not the warning",
  sketchForBeat("You show it emails so it can spot spam.", "point") === "email",
);
check(
  "a cat beat shows the cat, not the child",
  sketchForBeat("A child learns to recognise a cat.", "point") === "cat",
);

// --- 3. No keyword means no picture -------------------------------------
// The important negative. Inventing a decorative picture for a contentless beat
// would make the board flicker noise all lesson long.
check(
  "a beat with nothing concrete gets no sketch",
  sketchForBeat("The model adjusts its internal numbers a little.", "point") === null,
);
check("a plain statement never gets the question mark", sketchForBeat("That is the idea.", "point") === null);

// --- 4. Shape cues only for shape beats --------------------------------
check("a question beat gets the question mark", sketchForBeat("What would you guess?", "check") === "question");
check("an example beat gets the lightbulb", sketchForBeat("A worked case follows.", "example") === "bulb");

// --- 5. Hindi, because Hindi is a first-class teaching mode --------------
const hindi: Array<[string, string]> = [
  ["यह बिल्ली को पहचानना सिखाने जैसा है।", "cat"],
  ["बच्चे को बिल्ली पहचानना सिखाओ।", "cat"],
  ["ईमेल में स्पैम पहचानना।", "email"],
  ["डेटा से सीखना।", "data"],
];
for (const [text, want] of hindi) {
  const got = sketchForBeat(text, "point");
  check(`hindi "${text.slice(0, 18)}" → ${want}`, got === want, String(got));
}

// --- 6. The matcher can only return a sketch that exists -----------------
// A typo in the cue table would otherwise render an empty board and silently
// fall back to the diagram, which looks like "the feature just doesn't fire".
const all = new Set(sketchIds());
const probes = [
  "child", "cat", "email", "spam", "brain", "network", "layer", "chart", "graph",
  "image", "vision", "speech", "robot", "data", "learn", "algorithm", "important",
  "caveat", "wrong", "what?", "example", "बिल्ली", "बच्चा", "ईमेल", "डेटा",
];
for (const probe of probes) {
  const got = sketchForBeat(probe, "point");
  check(`"${probe}" yields a real sketch`, got === null || all.has(got), String(got));
}

// --- 7. Rendering is well-formed and safe --------------------------------
// All sketches are static hand-written SVG, so there is no text to escape. What
// must hold is that every one renders to a complete, labelled <svg>.
let rendered = 0;
for (const id of sketchIds()) {
  const svg = renderSketch(id);
  if (svg.startsWith("<svg") && svg.endsWith("</svg>") && svg.includes("aria-label")) rendered += 1;
  else check(`sketch ${id} renders a complete svg`, false, svg.slice(0, 40));
}
check("every sketch renders a complete labelled svg", rendered === sketchIds().length, `${rendered}/${sketchIds().length}`);
check("a null sketch renders nothing", renderSketch(null) === "");
check("an unknown sketch renders nothing", renderSketch("nope" as never) === "");
// The security property from the module header: no scriptable content.
const anySvg = sketchIds().map((id) => renderSketch(id)).join("");
check("no sketch contains script or event handlers", !/<script|onload=|onerror=|javascript:/i.test(anySvg));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);

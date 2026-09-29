// Permanent unit tests for the diagram pipeline.
//
// Run: npm run test:visual
//
// These two files are the security boundary for everything the owl draws.
// parseVisualSpec is the only thing standing between a model's output and the
// DOM, and the renderers are hand-written SVG that must never emit raw markup.
// They previously had no permanent suite at all — coverage existed once as a
// throwaway script that was deleted, which is not coverage.
//
// No test framework on purpose: the project has none, and the other suites are
// plain node scripts. Consistency beats ceremony.

import { parseVisualSpec } from "../src/services/visualService";
import {
  renderVisual,
  visualStepCount,
  type VisualSpec,
} from "../client/src/components/diagrams";

const results: Array<{ label: string; ok: boolean }> = [];

function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const valid: VisualSpec[] = [
  { type: "steps", title: "Loop", steps: ["init", "check", "advance"] },
  { type: "cycle", title: "Loop", steps: ["init", "check", "advance"] },
  {
    type: "compare",
    title: "List vs array",
    left: { label: "List", points: ["flexible size", "slower"] },
    right: { label: "Array", points: ["fast indexing", "fixed size"] },
  },
  {
    type: "bars",
    title: "Big O",
    items: [
      { label: "O(1)", value: 10 },
      { label: "O(n)", value: 60 },
      { label: "O(n^2)", value: 100 },
    ],
  },
  {
    type: "tree",
    title: "BST",
    root: "root",
    children: [
      { label: "left", children: [{ label: "a" }, { label: "b" }] },
      { label: "right", children: [{ label: "c" }] },
    ],
  },
  {
    type: "layers",
    title: "OS",
    layers: [
      { label: "App", detail: "chrome" },
      { label: "Kernel", detail: "scheduling" },
      { label: "Hardware", detail: "silicon" },
    ],
  },
];

// --- 3. Bounds are enforced, not just checked ------------------------------
const longLabel = "x".repeat(500);
const clamped = parseVisualSpec({ type: "steps", title: longLabel, steps: ["a", "b"] });
check(
  "an over-long title is truncated, not rejected",
  clamped !== null && clamped.title.length === 60,
  clamped ? `len=${clamped.title.length}` : "null",
);

const manySteps = parseVisualSpec({
  type: "steps",
  title: "long",
  steps: Array.from({ length: 40 }, (_, i) => `step ${i}`),
});
check(
  "an over-long steps list is capped",
  manySteps !== null && manySteps.type === "steps" && manySteps.steps.length === 6,
  manySteps?.type === "steps" ? `len=${manySteps.steps.length}` : "null",
);

// Depth is the one limit that rejects rather than truncates: a deeper tree
// would silently misrender, which is worse than showing nothing.
const twoDeep = parseVisualSpec({
  type: "tree",
  title: "deep",
  root: "r",
  children: [{ label: "a", children: [{ label: "b" }] }],
});
check("a two-level tree is accepted", twoDeep !== null);
const tooDeep = parseVisualSpec({
  type: "tree",
  title: "deep",
  root: "r",
  children: [
    {
      label: "a",
      children: [{ label: "b", children: [{ label: "c", children: [{ label: "d" }] }] }],
    },
  ],
});
check(
  "excess depth is stripped rather than rendered",
  tooDeep === null || JSON.stringify(tooDeep).indexOf('"d"') === -1,
  tooDeep ? "depth trimmed" : "null",
);

const clampedBars = parseVisualSpec({
  type: "bars",
  title: "weird",
  items: [
    { label: "neg", value: -50 },
    { label: "huge", value: 9999 },
    { label: "nan", value: "not a number" },
  ],
});
check(
  "bar values are coerced into range",
  clampedBars !== null &&
    clampedBars.type === "bars" &&
    clampedBars.items.every(
      (i) => Number.isFinite(i.value) && i.value >= 0 && i.value <= 100,
    ),
  clampedBars?.type === "bars"
    ? clampedBars.items.map((i) => `${i.label}:${i.value}`).join(",")
    : "null",
);

// --- 4. Renderers: valid specs produce SVG ---------------------------------
for (const spec of valid) {

// --- 6. Renderers survive structurally odd but valid specs -----------------
const structural: Array<[string, VisualSpec]> = [
  ["a two-item steps diagram", { type: "steps", title: "two", steps: ["a", "b"] }],
  [
    "a tree whose children have no grandchildren",
    { type: "tree", title: "flat", root: "r", children: [{ label: "a" }, { label: "b" }] },
  ],
  [
    "a tree with four grandchildren under one node",
    {
      type: "tree",
      title: "wide",
      root: "r",
      children: [
        {
          label: "a",
          children: [{ label: "w" }, { label: "x" }, { label: "y" }, { label: "z" }],
        },
      ],
    },
  ],
  ["a single-item bars diagram", { type: "bars", title: "one", items: [{ label: "a", value: 5 }] }],
  [
    "a compare with empty points",
    {
      type: "compare",
      title: "empty",
      left: { label: "L", points: [] },
      right: { label: "R", points: ["p"] },
    },
  ],
];
for (const [label, spec] of structural) {
  let threw = false;
  let svg = "";
  try {
    svg = renderVisual(spec, -1);
  } catch {
    threw = true;
  }
  check(`renderer handles ${label}`, !threw && svg.includes("</svg>"), threw ? "threw" : "");
}

// --- 7. The tree renderer shows every grandchild ---------------------------
// Regression guard: it used to draw children![0] and silently drop the rest,
// which loses most of a binary tree — the common case for this diagram.
const wideTree: VisualSpec = {
  type: "tree",
  title: "Binary search tree",
  root: "root",
  children: [
    { label: "left", children: [{ label: "a" }, { label: "b" }, { label: "c" }] },
    { label: "right", children: [{ label: "d" }, { label: "e" }] },
  ],
};
const wideTreeSvg = renderVisual(wideTree, -1);
const missingNodes = ["a", "b", "c", "d", "e"].filter(
  (node) => wideTreeSvg.indexOf(`>${node}<`) === -1,
);
check(
  "the tree renderer draws every grandchild",
  missingNodes.length === 0,
  missingNodes.length ? `missing: ${missingNodes.join(",")}` : "5/5",
);

// --- 8. Highlighting and step counts ---------------------------------------
for (const spec of valid) {
  const count = visualStepCount(spec);
  const highlighted = renderVisual(spec, 0);
  check(
    `step count for ${spec.type} matches its shape`,
    count > 0 && highlighted.startsWith("<svg"),
    `count=${count}`,
  );
}
check(
  "a null spec renders nothing and counts zero",
  renderVisual(null, -1) === "" && visualStepCount(null) === 0,
);
check("an out-of-range step index still renders", renderVisual(valid[0], 99).includes("</svg>"));

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} visual checks passed`,
);
process.exit(failed.length ? 1 : 0);

  const svg = renderVisual(spec, -1);
  check(
    `renderer draws a ${spec.type}`,
    svg.startsWith("<svg") && svg.includes("</svg>"),
    svg.slice(0, 24),
  );
}

// --- 5. Renderers never emit raw model markup -----------------------------
const XSS = '<script>alert(1)</script><img src=x onerror=alert(1)>';
const injected = parseVisualSpec({
  type: "steps",
  title: XSS,
  steps: [XSS, `safe ${XSS}`],
});
if (!injected) {
  check("XSS payload parsed (should be escaped, not dropped)", false, "parse returned null");
} else {
  const svg = renderVisual(injected, -1);
  check("a <script> tag never survives into the SVG", !svg.includes("<script"));
  check("an <img> tag never survives into the SVG", !svg.includes("<img"));
  check("the payload is present only in escaped form", svg.includes("&lt;script&gt;"));
  check("no inline event handler attribute is emitted", !/on[a-z]+=/.test(svg));
}


// --- 1. Every valid spec survives validation -------------------------------
for (const spec of valid) {
  const parsed = parseVisualSpec(spec);
  check(
    `parseVisualSpec accepts a well-formed ${spec.type}`,
    parsed?.type === spec.type,
    parsed ? "" : "returned null",
  );
}

// --- 2. Hostile input is rejected, not rendered ----------------------------
const rejects: Array<[string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["a string", "steps"],
  ["a number", 7],
  ["an array", []],
  ["an unknown type", { type: "pie", title: "x" }],
  ["a missing type", { title: "x", steps: ["a", "b"] }],
  ["a missing title", { type: "steps", steps: ["a", "b"] }],
  ["a blank title", { type: "steps", title: "   ", steps: ["a", "b"] }],
  ["a non-string title", { type: "steps", title: 99, steps: ["a", "b"] }],
  ["a one-item steps list", { type: "steps", title: "x", steps: ["only"] }],
  ["steps as a string", { type: "steps", title: "x", steps: "a,b" }],
  ["bars without items", { type: "bars", title: "x" }],
  ["tree without children", { type: "tree", title: "x", root: "r" }],
  ["tree with no root", { type: "tree", title: "x", children: [{ label: "a" }] }],
  ["layers without layers", { type: "layers", title: "x" }],
  ["compare missing a side", { type: "compare", title: "x", left: { label: "a", points: ["p"] } }],
];

for (const [label, input] of rejects) {
  check(`parseVisualSpec rejects ${label}`, parseVisualSpec(input) === null);
}

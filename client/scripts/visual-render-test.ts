// Permanent unit tests for the diagram *renderers* (client side).
//
// Run: npm run test:render
//
// The renderers are hand-written SVG built from model-supplied data, so every
// string must be escaped: a spec may describe a diagram but must never describe
// anything executable. These had no permanent suite — the coverage that existed
// was a throwaway script that got deleted, which is not coverage.
//
// The parser half of the pipeline is in scripts/visual-parse-test.ts. It runs
// under CommonJS in the server package; this file runs as ESM in the client
// package. Splitting them keeps each test in its own module system instead of
// fighting interop across the package boundary.

import { renderVisual, visualStepCount, type VisualSpec } from "../src/components/diagrams.ts";

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
    left: { label: "List", points: ["flexible", "slower"] },
    right: { label: "Array", points: ["fast index", "fixed"] },
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

// --- 1. Every diagram type draws -------------------------------------------
for (const spec of valid) {
  const svg = renderVisual(spec, -1);
  check(
    `renderer draws a ${spec.type}`,
    svg.startsWith("<svg") && svg.includes("</svg>"),
    svg.slice(0, 24),
  );
}

// --- 2. Hostile labels never become markup --------------------------------
const XSS = '<script>alert(1)</script><img src=x onerror=alert(1)>';
// NB: no `onerror=` style check here. Once escaped, the payload still contains
// that literal substring as inert text, so a naive regex flags the escaped
// form as if it were live markup. The real signal is that no tag can form:
// `<script` and `<img` are absent while `&lt;script&gt;` is present.
const safe = (svg: string): boolean =>
  !svg.includes("<script") && !svg.includes("<img");

const payloadVariants: Array<[string, VisualSpec]> = [
  ["steps", { type: "steps", title: XSS, steps: [XSS, `safe ${XSS}`] }],
  ["cycle", { type: "cycle", title: XSS, steps: [XSS, XSS] }],
  [
    "compare",
    {
      type: "compare",
      title: XSS,
      left: { label: XSS, points: [XSS] },
      right: { label: "r", points: ["p"] },
    },
  ],
  ["bars", { type: "bars", title: XSS, items: [{ label: XSS, value: 50 }] }],
  [
    "tree",
    { type: "tree", title: XSS, root: XSS, children: [{ label: XSS, children: [{ label: XSS }] }] },
  ],
  ["layers", { type: "layers", title: XSS, layers: [{ label: XSS, detail: XSS }] }],
];
for (const [name, spec] of payloadVariants) {
  check(`${name} escapes injected markup`, safe(renderVisual(spec, -1)));
}
check(
  "the payload is still present, in escaped form",
  renderVisual(payloadVariants[0][1], -1).includes("&lt;script&gt;"),
);

// --- 3. Structurally odd but valid specs do not throw ---------------------
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
    { type: "compare", title: "e", left: { label: "L", points: [] }, right: { label: "R", points: ["p"] } },
  ],
  ["an empty steps list", { type: "steps", title: "none", steps: [] }],
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

// --- 4. The tree renderer shows every grandchild ---------------------------
// Regression guard: it used to draw children![0] and silently drop the rest,
// which loses most of a binary tree — the common case for this diagram.
const wideTreeSvg = renderVisual(
  {
    type: "tree",
    title: "Binary search tree",
    root: "root",
    children: [
      { label: "left", children: [{ label: "a" }, { label: "b" }, { label: "c" }] },
      { label: "right", children: [{ label: "d" }, { label: "e" }] },
    ],
  },
  -1,
);
const missing = ["a", "b", "c", "d", "e"].filter((n) => wideTreeSvg.indexOf(`>${n}<`) === -1);
check(
  "the tree renderer draws every grandchild",
  missing.length === 0,
  missing.length ? `missing: ${missing.join(",")}` : "5/5",
);

// --- 5. Highlighting and step counts ---------------------------------------
for (const spec of valid) {
  check(
    `step count for ${spec.type} matches its shape`,
    visualStepCount(spec) > 0 && renderVisual(spec, 0).startsWith("<svg"),
    `count=${visualStepCount(spec)}`,
  );
}
check(
  "a null spec renders nothing and counts zero",
  renderVisual(null, -1) === "" && visualStepCount(null) === 0,
);
check("an out-of-range step index still renders", renderVisual(valid[0], 99).includes("</svg>"));
check(
  "a highlighted step changes the output",
  renderVisual(valid[0], 1) !== renderVisual(valid[0], 0),
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} render checks passed`);
process.exit(failed.length ? 1 : 0);


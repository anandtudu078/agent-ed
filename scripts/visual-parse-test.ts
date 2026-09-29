// Permanent unit tests for the diagram *parser* (server side).
//
// Run: npm run test:parse
//
// parseVisualSpec is the only thing standing between a model's output and the
// DOM, so it gets a suite of its own. It had none: the coverage that existed
// was a throwaway script that was later deleted, which is not coverage.
//
// Runs under CommonJS in the server package via ts-node. The renderer half of
// the pipeline is client/scripts/visual-render-test.ts, which runs as ESM —
// separate files because the two packages disagree about module system, and
// bridging that in a test would test the interop rather than the code.

import { parseVisualSpec } from "../src/services/visualService";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const valid: Array<[string, unknown]> = [
  ["steps", { type: "steps", title: "Loop", steps: ["init", "check", "advance"] }],
  ["cycle", { type: "cycle", title: "Loop", steps: ["init", "check", "advance"] }],
  [
    "compare",
    {
      type: "compare",
      title: "List vs array",
      left: { label: "List", points: ["flexible"] },
      right: { label: "Array", points: ["fast"] },
    },
  ],
  [
    "bars",
    {
      type: "bars",
      title: "Big O",
      items: [
        { label: "O(1)", value: 10 },
        { label: "O(n)", value: 50 },
      ],
    },
  ],
  [
    "tree",
    {
      type: "tree",
      title: "BST",
      root: "root",
      children: [{ label: "a", children: [{ label: "b" }] }],
    },
  ],
  [
    "layers",
    {
      type: "layers",
      title: "OS",
      layers: [
        { label: "App", detail: "chrome" },
        { label: "Kernel", detail: "scheduling" },
      ],
    },
  ],
];

// --- 1. Well-formed input survives -----------------------------------------
for (const [name, spec] of valid) {
  const parsed = parseVisualSpec(spec) as { type?: string } | null;
  check(`accepts a well-formed ${name}`, parsed?.type === name, parsed ? "" : "returned null");
}

// --- 2. Malformed input is rejected ---------------------------------------
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
  ["steps as a bare string", { type: "steps", title: "x", steps: "a,b" }],
  ["bars without items", { type: "bars", title: "x" }],
  ["bars with a missing value", { type: "bars", title: "x", items: [{ label: "a" }] }],
  ["tree without children", { type: "tree", title: "x", root: "r" }],
  ["tree with no root", { type: "tree", title: "x", children: [{ label: "a" }] }],
  ["layers without layers", { type: "layers", title: "x" }],
  ["compare missing a side", { type: "compare", title: "x", left: { label: "a", points: ["p"] } }],
  // A single bar cannot show a comparison and a single layer cannot show a
  // stack, so both are rejected rather than drawn as a meaningless graphic.
  ["a one-item bars chart", { type: "bars", title: "x", items: [{ label: "a", value: 5 }] }],
  ["a one-layer stack", { type: "layers", title: "x", layers: [{ label: "a", detail: "b" }] }],
  ["an empty bars chart", { type: "bars", title: "x", items: [] }],
  ["an empty layer stack", { type: "layers", title: "x", layers: [] }],
  ["a tree with one empty child", { type: "tree", title: "x", root: "r", children: [{}] }],
];
for (const [label, input] of rejects) {
  check(`rejects ${label}`, parseVisualSpec(input) === null);
}

// --- 3. Prototype pollution is not a vector -------------------------------
parseVisualSpec({
  type: "steps",
  title: "x",
  steps: ["a", "b"],
  // Assigned explicitly, since an object literal key would be a syntax error.
  ...(Object.defineProperty({}, "__proto__", {
    value: { polluted: true },
    enumerable: true,
  }) as Record<string, unknown>),
});
check(
  "a prototype-pollution attempt does not touch Object.prototype",
  ({} as Record<string, unknown>).polluted === undefined,
);

// --- 4. Bounds are enforced -----------------------------------------------
const clamped = parseVisualSpec({ type: "steps", title: "x".repeat(500), steps: ["a", "b"] });
check(
  "an over-long title is truncated, not rejected",
  clamped !== null && clamped.title.length === 60,
  clamped ? `len=${clamped.title.length}` : "null",
);

const manySteps = parseVisualSpec({
  type: "steps",
  title: "long",
  steps: Array.from({ length: 40 }, (_, i) => `step ${i}`),
}) as { steps?: string[] } | null;
check(
  "an over-long steps list is capped",
  manySteps !== null && Array.isArray(manySteps.steps) && manySteps.steps.length === 6,
  manySteps?.steps ? `len=${manySteps.steps.length}` : "null",
);

// Depth matters most for the tree diagram: a node at a depth the renderer does
// not implement would silently misrender, which is worse than showing nothing.
check(
  "a two-level tree is accepted",
  parseVisualSpec({
    type: "tree",
    title: "deep",
    root: "r",
    children: [{ label: "a", children: [{ label: "b" }] }],
  }) !== null,
);
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

const bars = parseVisualSpec({
  type: "bars",
  title: "weird",
  items: [
    { label: "neg", value: -50 },
    { label: "huge", value: 9999 },
    { label: "nan", value: "not a number" },
  ],
}) as { items?: Array<{ value: number }> } | null;
check(
  "bar values are coerced into range",
  bars !== null &&
    Array.isArray(bars.items) &&
    bars.items.every((i) => Number.isFinite(i.value) && i.value >= 0 && i.value <= 100),
  bars?.items ? bars.items.map((i) => String(i.value)).join(",") : "null",
);

// --- 5. Non-string entries are dropped, not coerced ------------------------
const dirty = parseVisualSpec({
  type: "steps",
  title: "dirty",
  steps: ["ok", 42, null, { nope: true }, "fine"],
}) as { steps?: string[] } | null;
check(
  "non-string step entries are dropped",
  Array.isArray(dirty?.steps) && dirty.steps.length === 2 && dirty.steps.includes("ok"),
  dirty?.steps ? JSON.stringify(dirty.steps) : "null",
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} parse checks passed`);
process.exit(failed.length ? 1 : 0);


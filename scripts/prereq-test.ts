// Permanent unit tests for the prerequisite graph.
//
// Run: npm run test:prereqs
//
// The graph is the difference between "you are weak at transformers" and
// "start with matrix multiplication". Most of what matters here is about
// absence: a module with no curated prerequisites must not block anyone, and a
// bad edge must fail towards the student being sent forward rather than being
// stuck.

import {
  firstMissingPrerequisite,
  rootCauseTopic,
} from "../src/services/progressService";
import { PREREQUISITE_GRAPH, prerequisiteCoverage } from "../src/services/courseService";
import CURRICULUM from "../src/data/curriculum";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const graph = new Map<string, readonly string[]>([
  ["transformers", ["multi head attention", "matrix multiplication for attention"]],
  ["multi head attention", ["query key and value in attention"]],
  ["query key and value in attention", ["self attention mechanism"]],
  ["self attention mechanism", ["matrix multiplication for attention"]],
  ["backpropagation", ["forward pass in a neural network"]],
  ["convolutional networks", []],
]);

// --- 1. Nothing curated means nothing blocks --------------------------------
check(
  "a topic absent from the graph is not blocked",
  firstMissingPrerequisite("clustering", graph, ["clustering"]) === null,
);
check(
  "an uncurated topic is not blocked even when it is the weakest thing",
  firstMissingPrerequisite("backpropagation", graph, ["backpropagation"]) === null,
);
check("an empty graph blocks nothing", firstMissingPrerequisite("x", new Map(), ["x"]) === null);
check("a null-ish topic does not throw", firstMissingPrerequisite("", graph, []) === null);

// --- 2. A known-weak prerequisite is found ---------------------------------
check(
  "the first weak prerequisite is returned",
  firstMissingPrerequisite("transformers", graph, ["multi head attention"]) ===
    "multi head attention",
);
check(
  "prerequisites are checked in order, not alphabetically",
  firstMissingPrerequisite(
    "transformers",
    graph,
    ["matrix multiplication for attention", "multi head attention"],
  ) === "multi head attention",
);
check(
  "a strong prerequisite does not block",
  firstMissingPrerequisite("transformers", graph, ["something else"]) === null,
);
check("matching ignores case", firstMissingPrerequisite("Backpropagation", graph, ["forward pass in a neural network"]) === "forward pass in a neural network");

// --- 3. The chain is followed to the root ---------------------------------
check(
  "a three-deep chain resolves to its root",
  rootCauseTopic("transformers", graph, [
    "multi head attention",
    "query key and value in attention",
    "self attention mechanism",
    "matrix multiplication for attention",
  ]) === "matrix multiplication for attention",
);
check(
  "a single step resolves to that step",
  rootCauseTopic("transformers", graph, ["multi head attention"]) === "multi head attention",
);
check(
  "no weak prerequisite means no root cause",
  rootCauseTopic("transformers", graph, []) === null,
);
check(
  "the root cause is not the topic itself",
  rootCauseTopic("transformers", graph, ["transformers"]) === null,
  "a topic cannot be its own prerequisite",
);

// --- 4. Cycles terminate ---------------------------------------------------
const cyclic = new Map<string, readonly string[]>([
  ["a", ["b"]],
  ["b", ["c"]],
  ["c", ["a"]],
]);
check(
  "a cycle in authored data terminates rather than hanging",
  rootCauseTopic("a", cyclic, ["b", "c"], 5) !== undefined,
  String(rootCauseTopic("a", cyclic, ["b", "c"], 5)),
);
check(
  "a two-node cycle terminates",
  rootCauseTopic("a", new Map([["a", ["b"]], ["b", ["a"]]]), ["b"]) === "b",
);

// --- 5. The authored graph is real and points at real modules -------------
const coverage = prerequisiteCoverage();
check(
  "a meaningful share of the curriculum declares prerequisites",
  coverage.withPrereqs >= 40,
  `${coverage.withPrereqs}/${coverage.total}`,
);
check("every graph key has at least one prerequisite", [...PREREQUISITE_GRAPH.values()].every((v) => v.length > 0));

// The failure this catches is subtle: a prerequisite naming a topic that does
// not exist can never match, so the edge is dead weight that looks correct.
const allTopics = new Set<string>();
for (const course of CURRICULUM) {
  for (const m of course.modules) allTopics.add(m.topic.trim().toLowerCase());
}
const dangling: string[] = [];
for (const [, prereqs] of PREREQUISITE_GRAPH) {
  for (const p of prereqs) {
    if (!allTopics.has(p)) dangling.push(p);
  }
}
check(
  "no prerequisite points at a topic that does not exist",
  dangling.length === 0,
  dangling.length ? dangling.join(", ") : `${PREREQUISITE_GRAPH.size} modules wired`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} prerequisite checks passed`);
process.exit(failed.length ? 1 : 0);

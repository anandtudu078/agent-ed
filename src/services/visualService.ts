import { completeJson } from "./groqClient";
import { VISUAL_LIMITS, type VisualSpec } from "../types/visual";

/**
 * A diagram the owl can draw on its lesson board.
 *
 * Deliberately a closed vocabulary. The model picks a *type* and fills in plain
 * data; the client renders it from vetted SVG components. Letting a model emit
 * raw SVG would mean accepting arbitrary markup — <script>, onload handlers,
 * <foreignObject> — which is an XSS hole in a student-facing app, and models
 * emit malformed SVG often enough to break the page.
 *
 * These types are chosen to cover the shapes real explanations take: something
 * repeating (cycle), something sequential (steps), a trade-off (compare),
 * measured values (bars), a hierarchy (tree), and abstraction layers (layers).
 *
 * The shape itself lives in ../types/visual so the Session model can store a
 * validated spec without depending on the AI layer.
 */
export type { VisualSpec };

const MAX_TITLE = VISUAL_LIMITS.title;
const MAX_LABEL = VISUAL_LIMITS.label;
const MAX_STEPS = VISUAL_LIMITS.steps;
const MAX_BARS = VISUAL_LIMITS.bars;
const MAX_TREE_CHILDREN = VISUAL_LIMITS.treeChildren;
const MAX_DEPTH = VISUAL_LIMITS.depth;
const MAX_LAYERS = VISUAL_LIMITS.layers;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textList(value: unknown, max: number, per = MAX_LABEL): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, per))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Validate an untrusted model response into a VisualSpec, or return null.
 *
 * Every field is checked and clamped rather than trusted. Returning null on
 * any problem is deliberate: a missing diagram is a far better outcome than a
 * half-validated one reaching the page.
 */
export function parseVisualSpec(raw: unknown): VisualSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  const title = text(candidate.title, MAX_TITLE);
  if (!title) return null;

  switch (candidate.type) {
    case "cycle":
    case "steps": {
      const steps = textList(candidate.steps, MAX_STEPS);
      // Two items is the minimum that draws anything meaningful.
      return steps.length >= 2 ? { type: candidate.type, title, steps } : null;
    }

    case "compare": {
      const side = (input: unknown) => {
        const value = (input ?? {}) as Record<string, unknown>;
        return { label: text(value.label, MAX_LABEL), points: textList(value.points, 4, 40) };
      };
      const left = side(candidate.left);
      const right = side(candidate.right);
      if (!left.label || !right.label) return null;
      if (!left.points.length && !right.points.length) return null;
      return { type: "compare", title, left, right };
    }

    case "bars": {
      if (!Array.isArray(candidate.items)) return null;
      const items = candidate.items
        .map((entry) => {
          const value = (entry ?? {}) as Record<string, unknown>;
          const label = text(value.label, MAX_LABEL);
          const raw = value.value;
          if (!label || typeof raw !== "number" || !Number.isFinite(raw)) return null;
          // Clamp negatives away and cap so one runaway value can't flatten
          // every other bar to nothing.
          return { label, value: Math.min(100, Math.max(0, Math.round(raw))) };
        })
        .filter((item): item is { label: string; value: number } => item !== null)
        .slice(0, MAX_BARS);
      return items.length >= 2 ? { type: "bars", title, items } : null;
    }

    case "tree": {
      const root = text(candidate.root, MAX_LABEL);
      if (!root || !Array.isArray(candidate.children)) return null;
      const children = candidate.children
        .map((entry) => {
          const value = (entry ?? {}) as Record<string, unknown>;
          const label = text(value.label, MAX_LABEL);
          if (!label) return null;
          const grandchildren = Array.isArray(value.children)
            ? value.children
                .map((sub) => ({ label: text((sub ?? {}).label, MAX_LABEL) }))
                .filter((sub) => sub.label)
                .slice(0, 4)
            : [];
          return { label, children: grandchildren };
        })
        .filter((item): item is { label: string; children: Array<{ label: string }> } => item !== null)
        .slice(0, MAX_TREE_CHILDREN);
      return children.length >= 1 ? { type: "tree", title, root, children } : null;
    }

    case "layers": {
      const layers = (Array.isArray(candidate.layers) ? candidate.layers : [])
        .map((entry) => {
          const value = (entry ?? {}) as Record<string, unknown>;
          return { label: text(value.label, MAX_LABEL), detail: text(value.detail, 40) };
        })
        .filter((item) => item.label)
        .slice(0, MAX_LAYERS);
      return layers.length >= 2 ? { type: "layers", title, layers } : null;
    }

    default:
      return null;
  }
}

/** Bumped to change how deep a tree diagram may nest. */
export const VISUAL_MAX_DEPTH = MAX_DEPTH;

const VISUAL_SYSTEM_PROMPT =
  "You choose ONE simple diagram that helps a student understand a concept. " +
  "Return only JSON. Pick exactly one 'type' from this list:\n" +
  '- "steps": an ordered process (algorithms, how-to sequences).\n' +
  '- "cycle": something that repeats and loops back (recursion, iteration, feedback).\n' +
  '- "compare": two options weighed against each other (trade-offs, pros vs cons).\n' +
  '- "bars": measured values compared by magnitude (costs, complexity, performance, distributions).\n' +
  '- "tree": a hierarchy (data structures, taxonomies, parent-child parts).\n' +
  '- "layers": stacked abstraction levels (architecture, abstraction layers, memory).\n' +
  "Then give a short 'title' (max 6 words) and the fields for that type:\n" +
  '- steps/cycle: "steps": 2-6 short labels, one per stage.\n' +
  '- compare: "left" and "right", each {label, points: 2-3 very short phrases}.\n' +
  '- bars: "items": 2-5 of {label, value} where value is a plain number 0-100.\n' +
  '- tree: "root": one label, "children": 2-5 of {label, children: optional {label}[]}.\n' +
  '- layers: "layers": 2-5 of {label, detail} ordered from most abstract to most concrete.\n' +
  "Labels must be 1-4 words, concrete, and immediately meaningful on their own " +
  "with no surrounding prose. If no diagram genuinely helps, return {\"type\": null}.";

const VISUAL_MODEL = "openai/gpt-oss-20b";

/** Diagram labels follow the teaching language, including the code-switch rule. */
const VISUAL_LANGUAGE_CLAUSE: Record<string, string> = {
  en: "",
  hi:
    " Write all labels in Hindi (Devanagari) mixed with English. Keep technical " +
    'terms in English — write "array", "loop", "tree", never a transliteration. ' +
    "Labels must be at most 3 words.",
};

/**
 * Ask for a diagram that suits this explanation. Returns null on any failure.
 *
 * Never throws: a missing diagram is a cosmetic gap, and failing the whole
 * tutor reply over it would be a bad trade.
 */
export async function generateVisual(
  topic: string,
  explanation: string,
  language: string = "en",
): Promise<VisualSpec | null> {
  try {
    const clause = VISUAL_LANGUAGE_CLAUSE[language] ?? "";
    const raw = await completeJson<Record<string, unknown>>(
      VISUAL_SYSTEM_PROMPT + clause,
      `Topic: ${topic}\n\nExplanation the student just read:\n${explanation.slice(0, 1200)}\n\nChoose the diagram that best helps here.`,
      { model: VISUAL_MODEL, temperature: 0.2 },
    );
    return parseVisualSpec(raw);
  } catch {
    return null;
  }
}

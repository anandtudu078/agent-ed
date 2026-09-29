/**
 * The closed set of diagrams the owl can draw, and the exact shape of each.
 *
 * This lives in its own module because two unrelated parts of the app need
 * the type — the service that validates model output, and the Session model
 * that stores a validated spec alongside the message it belongs to. Importing
 * it from the service instead would make Session depend on the AI layer, and
 * the AI layer already depends on Session.
 *
 * A spec is *data*, never markup. The client re-renders these by hand with
 * every string escaped, so a spec can describe a diagram but cannot describe
 * anything executable.
 */
export type VisualSpec =
  | { type: "cycle"; title: string; steps: string[] }
  | { type: "steps"; title: string; steps: string[] }
  | {
      type: "compare";
      title: string;
      left: { label: string; points: string[] };
      right: { label: string; points: string[] };
    }
  | { type: "bars"; title: string; items: Array<{ label: string; value: number }> }
  | {
      type: "tree";
      title: string;
      root: string;
      children: Array<{ label: string; children?: Array<{ label: string }> }>;
    }
  | { type: "layers"; title: string; layers: Array<{ label: string; detail: string }> };

/**
 * Hard bounds — a diagram the client has to squeeze onto a small board.
 *
 * Not `as const`: these are read as plain `number` values by the validators,
 * and literal types here would make a function whose parameter default is one
 * of these reject every other length.
 */
export const VISUAL_LIMITS = {
  title: 60,
  label: 28,
  steps: 6,
  bars: 5,
  treeChildren: 5,
  depth: 2,
  layers: 5,
};

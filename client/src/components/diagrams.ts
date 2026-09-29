// Topic diagrams for the owl's lesson board.
//
// Every diagram here is hand-written SVG built from validated plain data. The
// server never sends markup — it sends a typed spec (see src/services/
// visualService.ts) and this file decides what that looks like. That split is
// the whole security model: a compromised or confused model can pick a wrong
// diagram type, but it cannot inject a tag, an attribute, or a script.
//
// All text is escaped. Coordinates are derived from array indices, never from
// model-supplied numbers, so nothing here can position itself off-canvas.

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

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Shared palette, so six diagrams read as one system.
const INK = "#e2e8f0";
const MUTED = "#94a3b8";
const ACCENT = "#818cf8";
const ACCENT_SOFT = "rgba(129,140,248,0.16)";
const GOLD = "#fbbf24";
const TEAL = "#5eead4";

const W = 320;
const H = 210;

function caption(title: string): string {
  return `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${MUTED}">${esc(title)}</text>`;
}

function frame(inner: string, title: string): string {
  return `<svg viewBox="0 0 ${W} ${H}" class="h-auto w-full" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${inner}${caption(title)}</svg>`;
}

function box(x: number, y: number, w: number, h: number, label: string, active: boolean): string {
  const stroke = active ? GOLD : ACCENT;
  const fill = active ? "rgba(251,191,36,0.16)" : ACCENT_SOFT;
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="${active ? 2.2 : 1.5}"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="10" font-weight="600" fill="${active ? "#fde68a" : INK}">${esc(label)}</text>
  </g>`;
}

/** Numbered left-to-right flow. */
function stepsDiagram(spec: Extract<VisualSpec, { type: "steps" }>, active: number): string {
  const n = spec.steps.length;
  const gap = 8;
  const w = (W - 28 - gap * (n - 1)) / n;
  let inner = "";
  spec.steps.forEach((label, i) => {
    const x = 14 + i * (w + gap);
    inner += `<text x="${x + w / 2}" y="68" text-anchor="middle" font-size="9" fill="${i === active ? GOLD : "#475569"}">${i + 1}</text>`;
    inner += box(x, 78, w, 46, label, i === active);
    if (i < n - 1) {
      const ax = x + w + 1;
      inner += `<path d="M${ax} 101h${gap - 2}m0 0-3.5-3m3.5 3-3.5 3" stroke="${MUTED}" stroke-width="1.4" stroke-linecap="round" fill="none"/>`;
    }
  });
  return frame(inner, spec.title);
}

/** Nodes on a circle with a return arrow — the shape of a loop or recursion. */
function cycleDiagram(spec: Extract<VisualSpec, { type: "cycle" }>, active: number): string {
  const n = spec.steps.length;
  const cx = W / 2;
  const cy = 104;
  const radiusX = 88;
  const radiusY = 58;
  const nodeW = 56;
  const nodeH = 24;

  let inner = `<ellipse cx="${cx}" cy="${cy}" rx="${radiusX}" ry="${radiusY}" fill="none" stroke="#334155" stroke-width="1.4" stroke-dasharray="4 5"/>`;
  const pts = spec.steps.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) };
  });

  // Direction arrows sit between consecutive nodes.
  pts.forEach((p, i) => {
    const next = pts[(i + 1) % n];
    const mx = (p.x + next.x) / 2;
    const my = (p.y + next.y) / 2;
    const angle = (Math.atan2(next.y - p.y, next.x - p.x) * 180) / Math.PI;
    inner += `<path d="M0 0l-5-3.2v6.4Z" fill="${MUTED}" transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${angle.toFixed(1)})"/>`;
  });

  pts.forEach((p, i) => {
    inner += box(p.x - nodeW / 2, p.y - nodeH / 2, nodeW, nodeH, spec.steps[i], i === active);
  });

  return frame(inner, spec.title);
}

/** Two options, side by side. */
function compareDiagram(spec: Extract<VisualSpec, { type: "compare" }>, active: number): string {
  const colW = (W - 34) / 2;
  const panel = (side: { label: string; points: string[] }, x: number, on: boolean) => {
    const stroke = on ? GOLD : ACCENT;
    return `<g>
      <rect x="${x}" y="30" width="${colW}" height="146" rx="11" fill="${on ? "rgba(251,191,36,0.08)" : "rgba(15,23,42,0.5)"}" stroke="${stroke}" stroke-width="${on ? 2 : 1.3}"/>
      <text x="${x + colW / 2}" y="50" text-anchor="middle" font-size="11" font-weight="700" fill="${on ? "#fde68a" : INK}">${esc(side.label)}</text>
      ${side.points
        .map(
          (p, i) =>
            `<text x="${x + 12}" y="${74 + i * 20}" font-size="10" fill="${MUTED}">• ${esc(p)}</text>`,
        )
        .join("")}
    </g>`;
  };
  return frame(panel(spec.left, 8, active === 0) + panel(spec.right, 18 + colW, active === 1), spec.title);
}

/** Horizontal magnitude bars. */
function barsDiagram(spec: Extract<VisualSpec, { type: "bars" }>, active: number): string {
  const max = Math.max(...spec.items.map((i) => i.value), 1);
  const labelW = 74;
  const barMax = W - labelW - 44;
  const rowH = 26;
  let inner = "";
  spec.items.forEach((item, i) => {
    const y = 40 + i * rowH;
    const w = Math.max(3, (item.value / max) * barMax);
    const on = i === active;
    inner += `<text x="${labelW - 8}" y="${y + 11}" text-anchor="end" font-size="10" fill="${on ? "#fde68a" : INK}">${esc(item.label)}</text>`;
    inner += `<rect x="${labelW}" y="${y}" width="${barMax}" height="15" rx="7" fill="#1e293b"/>`;
    inner += `<rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="15" rx="7" fill="${on ? GOLD : ACCENT}" opacity="${on ? 1 : 0.8}"/>`;
    inner += `<text x="${(labelW + w + 7).toFixed(1)}" y="${y + 11}" font-size="9" fill="${MUTED}">${item.value}</text>`;
  });
  return frame(inner, spec.title);
}

/** Root with a row of children, each optionally carrying its own grandchildren. */
function treeDiagram(spec: Extract<VisualSpec, { type: "tree" }>, active: number): string {
  const n = spec.children.length;
  const gap = 8;
  const w = Math.min(96, (W - 28 - gap * (n - 1)) / n);
  const totalW = n * w + (n - 1) * gap;
  const startX = (W - totalW) / 2;

  const ROOT_Y = 26;
  const ROOT_H = 30;
  const BUS_Y = 70;
  const CHILD_Y = 80;
  const CHILD_H = 24;
  // Floor for the caption, so a deep tree never draws over its own title.
  const KID_FLOOR = H - 18;

  let inner = box(W / 2 - 52, ROOT_Y, 104, ROOT_H, spec.root, active === -1);
  inner += `<path d="M${W / 2} ${ROOT_Y + ROOT_H}v14" stroke="${MUTED}" stroke-width="1.3"/>`;
  inner += `<path d="M${startX + w / 2} ${BUS_Y}h${totalW - w}" stroke="${MUTED}" stroke-width="1.3"/>`;

  spec.children.forEach((child, i) => {
    const x = startX + i * (w + gap);
    inner += `<path d="M${x + w / 2} ${BUS_Y}v10" stroke="${MUTED}" stroke-width="1.3"/>`;
    const kids = child.children ?? [];
    const hasKids = kids.length > 0;
    const childH = hasKids ? CHILD_H : 26;
    inner += box(x, CHILD_Y, w, childH, child.label, i === active);

    if (!hasKids) return;

    // Every grandchild, not just the first. The previous version drew
    // children![0] and dropped the rest without a word, which silently lost
    // most of a binary tree — the one shape a tree diagram is usually for.
    const kidTop = CHILD_Y + childH + 8;
    const room = KID_FLOOR - kidTop;
    const kidGap = 3;
    const kidH = Math.max(12, Math.floor((room - kidGap * (kids.length - 1)) / kids.length));

    inner += `<path d="M${x + w / 2} ${CHILD_Y + childH}v8" stroke="#475569" stroke-width="1.1"/>`;
    kids.forEach((kid, k) => {
      const y = kidTop + k * (kidH + kidGap);
      // Deeper nodes are smaller and dimmer so the hierarchy stays readable
      // once there are several per branch.
      const deep = kids.length > 1;
      inner += `<g>
        <rect x="${(x + 4).toFixed(1)}" y="${y.toFixed(1)}" width="${(w - 8).toFixed(1)}" height="${kidH}" rx="6" fill="rgba(94,234,212,0.10)" stroke="#5eead4" stroke-width="1" opacity="${deep ? 0.82 : 1}"/>
        <text x="${(x + w / 2).toFixed(1)}" y="${(y + kidH / 2 + 3.5).toFixed(1)}" text-anchor="middle" font-size="${kidH <= 14 ? 8 : 9}" font-weight="600" fill="${deep ? "#99f6e4" : "#ccfbf1"}">${esc(kid.label)}</text>
      </g>`;
    });
  });
  return frame(inner, spec.title);
}

/** Stacked abstraction bands, most abstract at the top. */
function layersDiagram(spec: Extract<VisualSpec, { type: "layers" }>, active: number): string {
  const n = spec.layers.length;
  const h = 132 / n;
  let inner = "";
  spec.layers.forEach((layer, i) => {
    const y = 26 + i * h;
    const on = i === active;
    // Taper the bands so they read as a stack, not a table.
    const inset = i * 10;
    const w = W - 28 - inset * 2;
    const x = 14 + inset;
    inner += `<g>
      <rect x="${x}" y="${y.toFixed(1)}" width="${w}" height="${(h - 5).toFixed(1)}" rx="7" fill="${on ? "rgba(94,234,212,0.16)" : ACCENT_SOFT}" stroke="${on ? TEAL : ACCENT}" stroke-width="${on ? 2 : 1.2}"/>
      <text x="${W / 2}" y="${(y + h / 2 - 1).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="${on ? "#ccfbf1" : INK}">${esc(layer.label)}</text>
      <text x="${W / 2}" y="${(y + h / 2 + 11).toFixed(1)}" text-anchor="middle" font-size="9" fill="${MUTED}">${esc(layer.detail)}</text>
    </g>`;
  });
  return frame(inner, spec.title);
}

/**
 * Render a validated spec.
 *
 * `active` highlights one element, which is how the board stays in step with
 * the owl's speech. Unknown types render as nothing rather than throwing.
 */
export function renderVisual(spec: VisualSpec | null | undefined, active = -1): string {
  if (!spec) return "";
  switch (spec.type) {
    case "steps":
      return stepsDiagram(spec, active);
    case "cycle":
      return cycleDiagram(spec, active);
    case "compare":
      return compareDiagram(spec, active);
    case "bars":
      return barsDiagram(spec, active);
    case "tree":
      return treeDiagram(spec, active);
    case "layers":
      return layersDiagram(spec, active);
    default:
      return "";
  }
}

/** How many highlightable elements a diagram has. */
export function visualStepCount(spec: VisualSpec | null | undefined): number {
  if (!spec) return 0;
  switch (spec.type) {
    case "steps":
    case "cycle":
      return spec.steps.length;
    case "compare":
      return 2;
    case "bars":
      return spec.items.length;
    case "tree":
      return spec.children.length;
    case "layers":
      return spec.layers.length;
    default:
      return 0;
  }
}

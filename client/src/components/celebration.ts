/**
 * One shared celebration moment: a short, quiet burst of colour when something
 * the student did actually lands.
 *
 * The product already has a character that reacts — the owl hops, sparks and
 * nods (`mascot.ts`) — but the rest of the screen never acknowledged anything.
 * A passed checkpoint, a met daily goal or a strong grade arrived as a number
 * changing in place, which is the visual equivalent of being told "noted". The
 * moment is deliberately small: one burst, a second long, then gone.
 *
 * Three rules, taken from how the owl already behaves:
 *
 *   - **Never for free.** Nothing here fires on load, on refresh or on a timer.
 *     Every call site is a transition the student caused — a grade that just
 *     crossed into "good", a goal that just flipped from unmet to met. A burst
 *     that happens without a win teaches the student to ignore bursts.
 *   - **Reduced motion means none.** The information (a score, a goal) is
 *     already on screen in text; only the confetti is skipped.
 *   - **One at a time.** A second trigger while one is running replaces the
 *     first rather than doubling the noise — three grades in a row must not
 *     turn the screen into a party.
 */

/** Colours that already mean something elsewhere in the UI. */
const PIECE_COLORS = [
  "#818cf8", // indigo-400
  "#a78bfa", // violet-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#f472b6", // pink-400
];

/** The layer currently on screen, so a new burst can clear the last one. */
let activeLayer: HTMLElement | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Fire a brief confetti burst across the viewport.
 *
 * `count` scales the burst: a met daily goal is a small thing and gets a small
 * shower, a passed assessment gets a fuller one. Web Animations rather than a
 * stylesheet, because every value here is computed per piece and a class cannot
 * carry a random trajectory — and because `animationend` gives a guaranteed
 * cleanup instead of a timeout that might outlive the element.
 */
export function celebrate(count = 26): void {
  if (typeof document === "undefined" || prefersReducedMotion()) return;

  activeLayer?.remove();
  const layer = document.createElement("div");
  layer.className = "pointer-events-none fixed inset-0 z-[60] overflow-hidden";
  layer.setAttribute("aria-hidden", "true");
  activeLayer = layer;
  document.body.appendChild(layer);

  const width = window.innerWidth;
  const duration = 1400;

  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement("span");
    const size = 5 + Math.random() * 6;
    const round = Math.random() < 0.35;
    piece.style.position = "absolute";
    piece.style.top = "-12px";
    piece.style.left = `${Math.random() * width}px`;
    piece.style.width = `${size}px`;
    piece.style.height = round ? `${size}px` : `${size * 1.8}px`;
    piece.style.borderRadius = round ? "9999px" : "2px";
    piece.style.background = PIECE_COLORS[index % PIECE_COLORS.length];
    piece.style.opacity = "0.95";
    layer.appendChild(piece);

    const drift = (Math.random() - 0.5) * 220;
    const spin = (Math.random() - 0.5) * 720;
    const fall = window.innerHeight * (0.55 + Math.random() * 0.4);
    const animation = piece.animate(
      [
        { transform: "translate3d(0,0,0) rotate(0deg)", opacity: 1 },
        {
          transform: `translate3d(${drift}px, ${fall}px, 0) rotate(${spin}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: duration + Math.random() * 500,
        easing: "cubic-bezier(0.15, 0.6, 0.4, 1)",
        delay: Math.random() * 220,
        fill: "forwards",
      },
    );
    animation.onfinish = () => piece.remove();
  }

  window.setTimeout(() => {
    if (activeLayer === layer) activeLayer = null;
    layer.remove();
  }, duration + 900);
}

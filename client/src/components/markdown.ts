/**
 * A deliberately narrow markdown renderer for tutor replies.
 *
 * The tutor's reply used to be painted with `textContent`, so every list, every
 * bolded term and every code sample arrived as one undifferentiated paragraph.
 * Readable enough for one sentence; a wall for the four-beat explanation Teach
 * mode actually produces.
 *
 * Why this is written by hand rather than pulled from a library, and why it is
 * shaped the way it is:
 *
 *   - **This is model output going into the DOM.** `renderVisual` is the
 *     documented security boundary for what the owl draws; this is the
 *     equivalent boundary for what the tutor says. The rule is the same: the
 *     input is escaped *first* and only ever becomes text, and the renderer
 *     emits tags from a fixed allowlist with no attribute derived from input.
 *     There is no path by which a `<script>`, an `onerror`, or an `href` can
 *     reach the page — `href` is never emitted at all, because a link the
 *     student cannot see the target of is worse than no link.
 *
 *   - **The body of a tutor bubble must stay a `<p>` that is the last child of
 *     the bubble.** `#messages > .flex.justify-start > div > p:last-child` is
 *     the selector the workflow and journey suites read the tutor's words from,
 *     and an HTML parser will quietly hoist a `<ul>` out of a `<p>` and break
 *     that contract. So block-shaped output (lists, code fences, headings) is
 *     rendered as `<span class="block">` — phrasing content, legal inside a
 *     `<p>`, and visually identical to a block once styled. Valid HTML, and the
 *     tests keep reading the element they are supposed to read.
 *
 *   - **No raw newlines are relied on.** The bubble is `whitespace-pre-wrap`,
 *     so a stray newline in generated markup would render as a stray space.
 *     Output is emitted as one concatenation with no inter-tag whitespace.
 *
 * Everything here is a pure function of a string: no DOM, no globals, so the
 * whole thing can be verified without a browser.
 */

/**
 * Escape text so it can only ever be text.
 *
 * Escaping happens exactly once, up front, on every line of input. Inline
 * formatting then runs over the *escaped* string and inserts tags of its own,
 * which is what keeps the two from ever mixing.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Inline formatting: `code`, `**bold**`, `*italic*`.
 *
 * Code spans are lifted out into placeholders *before* anything else runs, so
 * `**a**` inside backticks stays literal text rather than being formatted, and
 * an asterisk inside code can never pair with one outside it. The placeholders
 * use NUL, which is stripped from the input first so model text can never
 * forge one and address a slot that isn't theirs.
 */
function inline(raw: string): string {
  const codeSpans: string[] = [];
  const tokenised = raw
    // eslint-disable-next-line no-control-regex -- NUL is this renderer's own placeholder delimiter; stripping it from input is the anti-forgery mechanism described above.
    .replace(/\u0000/g, "")
    .replace(/`([^`\n]+)`/g, (_match, code: string) => {
      codeSpans.push(code);
      return `\u0000${codeSpans.length - 1}\u0000`;
    });

  let text = esc(tokenised);
  // Bold before italic: `**x**` must not be consumed by the single-star rule.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  text = text.replace(
    // eslint-disable-next-line no-control-regex -- restoring the NUL-delimited code-span placeholders lifted out above.
    /\u0000(\d+)\u0000/g,
    (_match, index: string) =>
      `<code class="rounded bg-slate-950/70 px-1 py-0.5 font-mono text-[0.85em] text-emerald-200">${esc(
        codeSpans[Number(index)] ?? "",
      )}</code>`,
  );
  return text;
}

const BULLET = /^[ \t]*[-*+][ \t]+(.*)$/;
const ORDERED = /^[ \t]*(\d{1,3})[.)][ \t]+(.*)$/;
const HEADING = /^#{1,6}[ \t]+(.*)$/;
const QUOTE = /^[ \t]*>[ \t]?(.*)$/;
const RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const FENCE = /^[ \t]*```/;

/**
 * Render a tutor reply into HTML that is safe to assign to `innerHTML`.
 *
 * Supported — and nothing else: paragraphs, `-`/`*` bullets, `1.` lists, `#`
 * headings, `> quotes`, `---` rules, fenced code blocks, `**bold**`,
 * `*italic*` and `` `code` ``. Anything the model invents outside that set is
 * rendered as the literal characters it typed, which is the honest outcome: a
 * student should see the odd raw `~~`, not a silently dropped sentence.
 *
 * The result contains no whitespace between tags, because the bubble preserves
 * whitespace and generated spaces would show up as ragged indentation.
 */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Array<{ depth: number; text: string }> } | null = null;
  let fence: string[] | null = null;

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    out.push(`<span class="block">${paragraph.map(inline).join("<br>")}</span>`);
    paragraph = [];
  };

  const flushList = (): void => {
    const current = list;
    if (!current) return;
    const items = current.items
      .map(({ depth, text }) => {
        // The glyph is ours and the text is theirs, so the text is escaped on
        // its own and the markup is composed around it afterwards. Escaping the
        // whole line, glyph included, would print the span itself as literal
        // characters — the exact failure this module exists to avoid.
        const body = current.ordered
          ? inline(text)
          : `<span class="text-violet-400" aria-hidden="true">•</span> ${inline(text)}`;
        // Depth comes from the source indentation, capped so a tab-happy reply
        // cannot push text off the bubble. An inline style rather than a `pl-*`
        // class: the number is computed here, and a computed class name is one
        // the browser's on-demand JIT may never have seen.
        return `<span class="block" style="padding-left:${12 + depth * 14}px">${body}</span>`;
      })
      .join("");
    out.push(`<span class="block">${items}</span>`);
    list = null;
  };

  const flushText = (): void => {
    flushParagraph();
    flushList();
  };

  const flushFence = (): void => {
    if (!fence) return;
    out.push(
      `<code class="block my-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 font-mono text-[13px] leading-relaxed text-emerald-200 whitespace-pre-wrap">${esc(
        fence.join("\n"),
      )}</code>`,
    );
    fence = null;
  };

  for (const line of lines) {
    if (fence) {
      if (FENCE.test(line)) flushFence();
      else fence.push(line);
      continue;
    }

    if (FENCE.test(line)) {
      flushText();
      fence = [];
      continue;
    }

    if (!line.trim()) {
      flushText();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushText();
      out.push(
        `<span class="mt-1 block font-semibold text-slate-50">${inline(heading[1])}</span>`,
      );
      continue;
    }

    if (RULE.test(line)) {
      flushText();
      out.push(`<span class="my-2 block border-t border-slate-700" aria-hidden="true"></span>`);
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushText();
      out.push(
        `<span class="block border-l-2 border-violet-500/60 pl-3 text-slate-300 italic">${inline(
          quote[1],
        )}</span>`,
      );
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      // Depth is read off the line itself, before the marker is stripped, so an
      // indented item still knows where it sat. Ordered items keep their own
      // "1." — the source already numbered them and renumbering would be a lie
      // about what the tutor wrote.
      const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
      const depth = Math.min(Math.floor(leading.length / 2), 3);
      const text = isOrdered
        ? line.slice(leading.length)
        : ((bullet ?? ordered!)[1] as string);
      list.items.push({ depth, text });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushText();
  flushFence();
  return out.join("");
}

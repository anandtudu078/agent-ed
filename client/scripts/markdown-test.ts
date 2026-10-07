// Permanent unit tests for the tutor's markdown renderer.
//
// Run: npm run test:markdown
//
// This renderer is the second model-output → DOM boundary in the client.
// `parseVisualSpec` is the one the owl draws through; this is the one the
// tutor speaks through. So the tests that matter here are the hostile ones:
// not "does it render bold", but "is there any input that makes it emit a tag
// it did not choose, or lose the student's text".
//
// Everything is a pure function of a string — no DOM, no server.

import { renderMarkdown } from "../src/components/markdown.ts";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

/**
 * Every tag the renderer is allowed to emit. Anything else in the output is a
 * bug, and this list is deliberately so short that adding to it has to be a
 * decision rather than an accident.
 */
const ALLOWED_TAGS = new Set(["strong", "em", "code", "span", "br"]);
function tagsIn(html: string): string[] {
  return [...html.matchAll(/<([a-z][a-z0-9]*)/gi)].map((match) => match[1].toLowerCase());
}

function onlyAllowedTags(html: string): boolean {
  return tagsIn(html).every((tag) => ALLOWED_TAGS.has(tag));
}

// --- 1. Plain text survives intact -------------------------------------------
const plain = renderMarkdown("If a quantity changes from 3 to 5 over two hours, what would you call it?");
check("plain prose passes through", plain.includes("3 to 5 over two hours"));
check("plain prose produces a block", plain.startsWith("<span class=\"block\">"));
check("no inter-tag whitespace (the bubble preserves whitespace)", !/> </.test(plain));

// --- 2. Inline formatting ------------------------------------------------------
const inline = renderMarkdown("Use **gradient descent** and `lr` with *care*.");
check("bold renders", inline.includes("<strong>gradient descent</strong>"));
check("inline code renders", inline.includes("<code class=") && inline.includes(">lr</code>"));
check("italic renders", inline.includes("<em>care</em>"));
check("inline output is allowlisted", onlyAllowedTags(inline), tagsIn(inline).join(","));

const odd = renderMarkdown("**unclosed and *mixed* stars");
check("an unclosed marker stays literal text", !odd.includes("<strong>"), odd);

// --- 3. Lists ------------------------------------------------------------------
const bullets = renderMarkdown("- first\n- second");
check("bullets become blocks", (bullets.match(/padding-left:/g) ?? []).length === 2);
check("a bullet glyph is drawn, not the dash", bullets.includes("•") && !bullets.includes("- first"));
check(
  "the bullet markup is markup, not escaped text",
  bullets.includes('<span class="text-violet-400"') && !bullets.includes("&lt;span class=&quot;text-violet-400&quot;"),
);

const ordered = renderMarkdown("1. first\n2. second");
check("ordered items keep their own numbers", ordered.includes("1. first"));
check("ordered items are not bulleted", !ordered.includes("•"));

const mixed = renderMarkdown("- a\n\n1. b");
check("switching list type closes the first list", mixed.indexOf("•") < mixed.indexOf("1. b"));

const indented = renderMarkdown("- outer\n  - inner");
check("indentation is capped, not echoed", indented.includes("padding-left:26px"), indented);

// --- 4. Code fences ------------------------------------------------------------
const fenced = renderMarkdown("Before:\n```\nx = <b>1</b>\n```\nAfter.");
check("a fence renders as one block", fenced.includes("whitespace-pre-wrap"));
check("code content is escaped", fenced.includes("&lt;b&gt;1&lt;/b&gt;"));
check("code content is not re-escaped twice", !fenced.includes("&amp;lt;"));

const unclosed = renderMarkdown("```\nnever closed");
check("an unclosed fence still renders its text", unclosed.includes("never closed"));

// --- 5. Headings, quotes, rules ------------------------------------------------
check("a heading becomes a block", renderMarkdown("## Two").includes("font-semibold"));
check("a quote gets its own rule", renderMarkdown("> think first").includes("border-l-2"));
check("a rule is drawn", renderMarkdown("---").includes("border-t"));
check("a heading-ish line inside prose is not hoisted", !renderMarkdown("C# is a language").includes("font-semibold"));

// --- 6. The hostile cases ------------------------------------------------------
const script = renderMarkdown("<script>alert('xss')</script>");
check("a script tag never reaches the page", !script.includes("<script"), script);
check("the student still sees what was typed", script.includes("&lt;script&gt;"));

const img = renderMarkdown("**<img src=x onerror=alert(1)>**");
check("an injected tag inside bold stays text", !img.includes("<img"), img);
check("bold still applies around the escaped text", img.includes("<strong>"));

const fenceXss = renderMarkdown("```\n<img src=x onerror=alert(1)>\n```");
check("a hostile fence cannot escape its block", onlyAllowedTags(fenceXss), tagsIn(fenceXss).join(","));
check("the hostile fence text is escaped", fenceXss.includes("&lt;img"));

const quoteAttr = renderMarkdown('" onmouseover="alert(1)');
check(
  "an attribute-breaking quote is neutralised",
  quoteAttr.includes("&quot; onmouseover=&quot;alert(1)") && !quoteAttr.includes('onmouseover="'),
  quoteAttr,
);

const link = renderMarkdown("[click](javascript:alert(1))");
check("no href is ever emitted", !link.includes("href"), link);
check("no javascript: scheme survives as a URL", !/href\s*=/i.test(link));

const forged = renderMarkdown("try \u00000\u0000 and `code`");
check("a forged placeholder cannot address a code slot", !forged.includes("undefined"), forged);

// Every hostile input above, plus a long messy reply, must stay inside the
// allowlist. This is the invariant the whole module rests on.
const messy = [
  "# Title",
  "",
  "A paragraph with **bold**, `code` and a <b>stray</b> tag.",
  "",
  "- one",
  "- two",
  "",
  "1. a",
  "2. b",
  "",
  "> quoted",
  "",
  "---",
  "",
  "```",
  "<script>alert(1)</script>",
  "```",
].join("\n");
const rendered = renderMarkdown(messy);
check("a full reply renders", rendered.length > 50, `${rendered.length} chars`);
check("every tag in a full reply is allowlisted", onlyAllowedTags(rendered), tagsIn(rendered).join(","));
check("nothing executable is in a full reply", !/<(script|iframe|style|link|meta)/i.test(rendered));
check("the escape happens before formatting, never after", !rendered.includes("&amp;lt;"));

// --- 7. Degenerate input -------------------------------------------------------
check("empty input renders empty", renderMarkdown("") === "");
check("whitespace input does not invent a block", renderMarkdown("   \n\n  ") === "");
check("CRLF is normalised", renderMarkdown("a\r\nb").includes("a<br>b"));
check("emoji and Devanagari survive", renderMarkdown("हिंदी 🦉").includes("🦉"));

// --------------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const failure of failed) console.log(`  - ${failure.label}`);
  process.exit(1);
}

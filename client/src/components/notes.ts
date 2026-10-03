/**
 * Course notes, as a printable PDF.
 *
 * Built entirely in the browser from data the dashboard already holds, so
 * downloading notes costs no round trip, no server-side rendering and no
 * new endpoint. The syllabus is in `CourseInfo.modules` — the same list the
 * course-detail dialog walks — so the file cannot drift from what the student
 * was shown.
 *
 * PDF rather than Markdown, by way of the browser's own PDF writer: the notes
 * are laid out as a standalone A4 document and printed to an off-screen iframe,
 * so "Save as PDF" is one click away and the student gets something they can
 * print, annotate or read on a phone that has no Markdown app on it.
 *
 * A PDF library was rejected deliberately. Every one of them draws its own text,
 * which means embedding and subsetting a font — and none of the ones small
 * enough to be worth shipping carries Devanagari. Handing the page to the
 * browser gets correct Hindi shaping, correct emoji, and correct page breaks
 * from the same engine that is already rendering the dashboard, for the price
 * of one iframe.
 *
 * Progress is included because "which modules have I actually finished" is the
 * first question a student asks of their own notes, and answering it here saves
 * them cross-referencing the dashboard.
 */

export interface NotesCourse {
  title: string;
  category: string;
  description: string;
  level: string;
  modules: Array<{ title: string; topic: string; subtopics?: string[] }>;
}

/** Filename-safe slug, so a download never lands as `concepts?.pdf`. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "course"
  );
}

/**
 * Escape text for the notes document.
 *
 * Every string in here comes from a seeded course in the database, so it is
 * untrusted input that ends up inside a `<title>` and a stack of `<h1>`s.
 * This document is printed, not sandboxed, but "the course title" is the one
 * field a student can see echoed back from the catalog, and a syllabus that
 * happened to contain `<` should print as a bracket.
 */
function esc(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The page stylesheet, inlined into the notes document.
 *
 * Inlined rather than linked because the document is written into an iframe: a
 * `<link>` would be a request against a relative URL, and the point of this
 * module is that notes cost no round trip.
 *
 * The rules are deliberately flat and light — there is no dark mode here even
 * though the dashboard has one, because a student printing these notes at night
 * should not spend their ink on a black rectangle. `-webkit-print-color-adjust`
 * is not optional: without it every status pill and rule prints as white space.
 */
const NOTES_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: #fff; color: #111827;
    font-family: "Segoe UI", "Noto Sans", "Noto Sans Devanagari", "Nirmala UI",
      system-ui, -apple-system, sans-serif;
    font-size: 11pt; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .notes { max-width: 178mm; margin: 0 auto; padding: 8mm 6mm; }
  .notes-head { border-bottom: 2px solid #4f46e5; padding-bottom: 10px; }
  .notes-brand {
    margin: 0 0 6px; font-size: 9pt; letter-spacing: 0.14em;
    text-transform: uppercase; color: #4f46e5; font-weight: 600;
  }
  .notes-title { margin: 0 0 10px; font-size: 22pt; line-height: 1.2; font-weight: 700; }
  .notes-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 9.5pt; color: #4b5563; }
  .notes-meta b { color: #111827; font-weight: 600; }
  h2 {
    margin: 22px 0 8px; font-size: 13pt; font-weight: 700; color: #4f46e5;
    border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;
  }
  .notes-overview { margin: 0 0 4px; }
  .notes-empty { color: #6b7280; font-style: italic; margin: 0; }
  .notes-module {
    margin: 0 0 14px; padding: 12px 14px; border: 1px solid #e5e7eb;
    border-left: 3px solid #c7d2fe; border-radius: 8px;
    page-break-inside: avoid; break-inside: avoid;
  }
  .notes-module.is-done { border-left-color: #10b981; background: #f0fdf4; }
  .notes-module h3 {
    margin: 0 0 6px; font-size: 11.5pt; font-weight: 700;
    display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
  }
  .notes-topic { margin: 0 0 8px; font-size: 9.5pt; color: #6b7280; font-style: italic; }
  .notes-subtopics-label {
    margin: 0 0 4px; font-size: 9pt; text-transform: uppercase;
    letter-spacing: 0.08em; color: #6b7280; font-weight: 600;
  }
  .notes-subtopics { margin: 0; padding-left: 18px; }
  .notes-subtopics li { margin: 0 0 3px; }
  .notes-status {
    flex: none; font-size: 8pt; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
    border: 1px solid #d1d5db; color: #4b5563; background: #f9fafb; white-space: nowrap;
  }
  .notes-status.is-done { border-color: #6ee7b7; color: #065f46; background: #d1fae5; }
  .notes-summary {
    margin-top: 20px; padding: 12px 14px; background: #f9fafb;
    border: 1px solid #e5e7eb; border-radius: 8px;
    page-break-inside: avoid; break-inside: avoid;
  }
  .notes-summary h2 { margin-top: 0; border-bottom: 0; }
  .notes-summary ul { margin: 0; padding-left: 18px; }
  .notes-summary li { margin: 0 0 3px; }
  .notes-foot { margin-top: 16px; font-size: 8.5pt; color: #6b7280; text-align: center; }
`;

/**
 * Render a course as a standalone, print-ready HTML document.
 *
 * Pure: it touches no DOM and no globals, which is what lets the test suite
 * assert on the real output under plain Node. Everything the browser needs is
 * inline — no stylesheet link, no script, no image — so the iframe has nothing
 * left to fetch before the print dialog is safe to open.
 *
 * Deliberately plain: headings, bullets and a status pill. Anything richer
 * (tables, callouts) is harder to read on paper than in a preview.
 */
export function buildCourseNotesHtml(
  course: NotesCourse,
  completedModules: string[] = [],
  language: "en" | "hi" = "en",
): string {
  const done = new Set(completedModules);
  const copy =
    language === "hi"
      ? {
          brand: "AgentEd",
          heading: "कोर्स नोट्स",
          level: "स्तर",
          category: "श्रेणी",
          overview: "अवलोकन",
          modules: "मॉड्यूल",
          subtopics: "विषय-वस्तु",
          progress: "प्रगति",
          doneMark: "पूर्ण",
          pendingMark: "बाकी",
          exported: "निर्यात",
          summary: "सारांश",
          emptyNotes: "इस मॉड्यूल के लिए अभी विषय-वस्तु नहीं लिखी गई है।",
          footer: "यह नोट्स AgentEd से स्वतः बनाए गए हैं।",
        }
      : {
          brand: "AgentEd",
          heading: "Course Notes",
          level: "Level",
          category: "Category",
          overview: "Overview",
          modules: "Modules",
          subtopics: "Topics covered",
          progress: "Progress",
          doneMark: "Done",
          pendingMark: "Not started",
          exported: "Exported",
          summary: "Summary",
          emptyNotes: "No subtopics have been written for this module yet.",
          footer: "Generated by AgentEd.",
        };

  const modules = course.modules ?? [];
  const parts: string[] = [];

  parts.push(
    `<header class="notes-head">`,
    `<p class="notes-brand">${esc(copy.brand)}</p>`,
    // The brand line carries the translation, because the course title itself is
    // the syllabus's own wording and is deliberately left alone — translating a
    // module name the tutor will never say in Hindi would just invent a second
    // vocabulary for the same concept.
    `<h1 class="notes-title">${esc(course.title)}</h1>`,
    `<div class="notes-meta">`,
    `<span>${esc(copy.heading)}</span>`,
    `<span><b>${esc(copy.level)}:</b> ${esc(course.level)}</span>`,
    `<span><b>${esc(copy.category)}:</b> ${esc(course.category)}</span>`,
    `</div>`,
    `</header>`,
    `<section>`,
    `<h2>${esc(copy.overview)}</h2>`,
    course.description?.trim()
      ? `<p class="notes-overview">${esc(course.description)}</p>`
      : `<p class="notes-empty">—</p>`,
    `</section>`,
    `<section>`,
    `<h2>${esc(copy.modules)}</h2>`,
  );

  if (!modules.length) parts.push(`<p class="notes-empty">—</p>`);

  modules.forEach((module, index) => {
    const isDone = done.has(module.title);
    const label = isDone ? copy.doneMark : copy.pendingMark;
    const statusClass = `notes-status${isDone ? " is-done" : ""}`;

    parts.push(
      `<article class="notes-module${isDone ? " is-done" : ""}">`,
      `<h3><span>${index + 1}. ${esc(module.title)}</span>`,
      `<span class="${statusClass}">${esc(label)}</span></h3>`,
      `<p class="notes-topic">${esc(module.topic ?? "")}</p>`,
    );

    const subtopics = (module.subtopics ?? []).filter((sub) => sub?.trim());
    if (subtopics.length) {
      parts.push(
        `<p class="notes-subtopics-label">${esc(copy.subtopics)}</p>`,
        `<ul class="notes-subtopics">`,
      );
      for (const sub of subtopics) parts.push(`<li>${esc(sub.trim())}</li>`);
      parts.push(`</ul>`);
    } else {
      // A module with no topics still has to be in the file. A download that
      // silently omits half a syllabus is worse than no download at all — the
      // student trusts it as a complete record.
      parts.push(`<p class="notes-empty">${esc(copy.emptyNotes)}</p>`);
    }
    parts.push(`</article>`);
  });

  const finished = modules.filter((m) => done.has(m.title)).length;
  const percent = modules.length
    ? Math.round((finished / modules.length) * 100)
    : 0;

  parts.push(
    `</section>`,
    `<section class="notes-summary">`,
    `<h2>${esc(copy.summary)}</h2>`,
    `<ul>`,
    `<li><b>${esc(copy.progress)}:</b> ${finished}/${modules.length} modules (${percent}%)</li>`,
    `<li><b>${esc(copy.modules)}:</b> ${modules.length}</li>`,
    `<li><b>${esc(copy.exported)}:</b> ${new Date().toISOString().slice(0, 10)}</li>`,
    `</ul>`,
    `</section>`,
    `<p class="notes-foot">${esc(copy.footer)}</p>`,
  );

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<title>${esc(course.title)} — ${esc(copy.heading)}</title>
<style>${NOTES_CSS}</style>
</head>
<body>
<main class="notes">
${parts.join("\n")}
</main>
</body>
</html>`;
}

/**
 * Open the browser's print dialog on the course notes, where "Save as PDF" is
 * one option in the destination list.
 *
 * Why an iframe instead of `window.print()`: printing the dashboard would print
 * the dashboard — alerts, checkpoint cards, the catalog, in the dark theme the
 * student is currently reading. A same-origin iframe gets a clean document with
 * its own stylesheet and nothing inherited from the app.
 *
 * The frame is positioned off-screen rather than hidden with `display: none`,
 * because a `display: none` iframe has no layout, and a document with no layout
 * paginates to a single blank page. It is marked `aria-hidden` and taken out of
 * the tab order so it never becomes a stray focus stop behind the dialog.
 */
export function printCourseNotesPdf(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.append(frame);

  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    throw new Error("Notes frame could not be created.");
  }

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    // Deferred, not immediate: tearing the frame down in the same tick as the
    // dialog opening blanks the preview in some browsers. A student taking notes
    // on several courses should not accumulate dead frames either, and this
    // timeout is what guarantees they do not.
    window.setTimeout(() => frame.remove(), 1000);
  };

  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (error) {
    frame.remove();
    throw error;
  }

  // Print only once the document has laid out. Calling `print()` straight after
  // `write()` races the parser and produces a truncated file.
  const go = (): void => {
    try {
      win.focus();
      win.print();
    } catch (error) {
      console.error("Failed to open the notes print dialog.", error);
    }
    cleanup();
  };

  if (win.document.readyState === "complete") go();
  else win.addEventListener("load", go, { once: true });

  // `afterprint` is the honest signal that the student is done with the dialog,
  // but Safari does not fire it reliably, so the timeout above is the real
  // guarantee and this is only the prompt path.
  win.addEventListener("afterprint", cleanup, { once: true });
}

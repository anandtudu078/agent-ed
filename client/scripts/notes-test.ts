// Permanent unit tests for the downloadable course notes.
//
// Run: npm run test:notes
//
// The notes are generated from the same syllabus the course dialog renders, so
// the thing worth defending is that every module survives, that progress is
// reported honestly, and that a course missing data degrades to a readable file
// rather than throwing. A download that silently omits half a syllabus is worse
// than no download at all — the student trusts it as a complete record.
//
// This asserts on the HTML rather than on a printed page. A PDF is bytes from
// the browser's own writer, so there is nothing stable here to assert against;
// the document that goes into the print dialog is the part this project owns,
// and every claim in it is checkable here.

import {
  buildCourseNotesHtml,
  type NotesCourse,
} from "../src/components/notes.ts";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const course: NotesCourse = {
  title: "Machine Learning Basics",
  category: "AI Foundations",
  description: "How models learn patterns from examples.",
  level: "beginner",
  modules: [
    { title: "Variables and types", topic: "variables and data types", subtopics: ["Naming", "Numbers vs text"] },
    { title: "Conditionals", topic: "if statements and conditionals", subtopics: ["if / else / elif"] },
    { title: "Functions", topic: "functions", subtopics: [] },
  ],
};

// --- 1. Every module appears -------------------------------------------------
const notes = buildCourseNotesHtml(course);
for (const module of course.modules) {
  check(`module "${module.title}" is present`, notes.includes(module.title));
}
check("the course title heads the document", notes.includes(`>${course.title}</h1>`));
check("the description is included", notes.includes("How models learn patterns from examples."));
check("the level is included", notes.includes("beginner"));

// --- 2. Subtopics are listed, empty ones are handled -------------------------
check("a subtopic is listed", notes.includes("Naming"));
check("a module with no subtopics says so rather than vanishing", /No subtopics|not been written/i.test(notes));
check("the Functions module is still in the document", notes.includes(`3. ${"Functions"}`));

// --- 3. Progress -------------------------------------------------------------
const noProgress = buildCourseNotesHtml(course);
check("with no progress, nothing is marked done", !/notes-status is-done/.test(noProgress));
check("with no progress, percent is 0", /0%/.test(noProgress));

const halfDone = buildCourseNotesHtml(course, ["Variables and types"]);
check("a completed module is marked", /notes-status is-done/.test(halfDone));
check("a completed module counts in the summary", /1\/3 modules \(33%\)/.test(halfDone), (halfDone.match(/Progress:<\/b>[^<]*/) ?? [""])[0]);

const allDone = buildCourseNotesHtml(course, course.modules.map((m) => m.title));
check("a finished course reads 100%", /3\/3 modules \(100%\)/.test(allDone));

// A title that no longer exists in the syllabus must not inflate the count.
const stale = buildCourseNotesHtml(course, ["A module that was renamed away"]);
check("a stale completed title does not inflate progress", /0\/3 modules \(0%\)/.test(stale), (stale.match(/Progress:<\/b>[^<]*/) ?? [""])[0]);

// --- 4. Empty and malformed input --------------------------------------------
const empty = buildCourseNotesHtml({
  title: "Empty Course",
  category: "None",
  description: "",
  level: "beginner",
  modules: [],
});
check("a course with no modules still renders", empty.includes("Empty Course"));
check("a course with no modules does not divide by zero", !/NaN/.test(empty), empty.includes("NaN") ? "NaN present" : "");

const noSubtopics = buildCourseNotesHtml({
  title: "No Subtopics",
  category: "None",
  description: "d",
  level: "beginner",
  modules: [{ title: "Bare", topic: "bare" }],
});
check("an absent subtopics field is tolerated", noSubtopics.includes("1. Bare"));

const blankSubtopics = buildCourseNotesHtml({
  title: "Blank Subtopics",
  category: "None",
  description: "d",
  level: "beginner",
  modules: [{ title: "Blank", topic: "blank", subtopics: ["", "   "] }],
});
check("whitespace subtopics are dropped, not printed as empty bullets", !/<li>\s*<\/li>/.test(blankSubtopics));

// --- 5. Hindi ----------------------------------------------------------------
// The notes follow the student's language like everything else in the app.
const hi = buildCourseNotesHtml(course, ["Conditionals"], "hi");
check("Hindi notes use Hindi headings", hi.includes("कोर्स नोट्स"));
check("the course title stays as the syllabus words it", hi.includes(`>${course.title}</h1>`));
check("Hindi notes mark progress in Hindi", /पूर्ण/.test(hi));
check("Hindi notes keep the English module titles", hi.includes("Conditionals"));
check("the document declares its language for the font stack", hi.includes('<html lang="hi">'), "expected lang=hi");

// --- 6. The document is print-ready ------------------------------------------
// These are the claims that make the output a PDF rather than a web page. If the
// @page rule or the colour-adjust declaration goes, the file still "works" and
// prints wrong — white pills, no page margins — which is exactly the kind of
// defect nobody notices until a student prints it.
check("it is a complete standalone document", notes.startsWith("<!DOCTYPE html>") && notes.trimEnd().endsWith("</html>"));
check("the stylesheet is inlined, not linked", notes.includes("<style>") && !/<link\b/i.test(notes));
check("nothing is fetched at print time", !/<img\b|<script\b|src=/i.test(notes));
check("the page size and margins are declared", /@page\s*\{\s*size:\s*A4/.test(notes));
check("backgrounds and borders survive printing", /print-color-adjust:\s*exact/i.test(notes));
check("a module is never split across a page break", /break-inside:\s*avoid/i.test(notes));
check("the document declares utf-8 for the Devanagari", notes.includes('<meta charset="utf-8">'));

// --- 7. Escaping -------------------------------------------------------------
// Course text is seeded, not user-authored, but it is still data: a syllabus
// containing markup should print as text, not reshape the document around it.
const nasty = buildCourseNotesHtml({
  title: 'Intro <script>alert("x")</script>',
  category: "A & B",
  description: "Uses <b>markup</b> & ampersands",
  level: "beginner",
  modules: [{ title: "Modules <img src=x onerror=alert(1)>", topic: "<b>topic</b>", subtopics: ["<i>sub</i>"] }],
});
check("a script tag in a title cannot execute", !/<script>/i.test(nasty));
check("markup in a title is escaped, not rendered", nasty.includes("&lt;script&gt;"));
check("markup in a subtopic is escaped", nasty.includes("&lt;i&gt;sub&lt;/i&gt;"), "expected escaped subtopic");
check("an injected image tag is escaped", !/<img src=x/i.test(nasty));
check("ampersands survive as entities", nasty.includes("A &amp; B"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
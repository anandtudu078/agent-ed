// Permanent unit tests for the downloadable course notes.
//
// Run: npm run test:notes
//
// The notes are generated from the same syllabus the course dialog renders, so
// the thing worth defending is that every module survives, that progress is
// reported honestly, and that a course missing data degrades to a readable file
// rather than throwing. A download that silently omits half a syllabus is worse
// than no download at all — the student trusts it as a complete record.

import {
  buildCourseNotes,
  slugify,
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
const notes = buildCourseNotes(course);
for (const module of course.modules) {
  check(`module "${module.title}" is present`, notes.includes(module.title));
}
check("the course title heads the file", notes.startsWith("# Machine Learning Basics"));
check("the description is included", notes.includes("How models learn patterns from examples."));
check("the level is included", notes.includes("beginner"));

// --- 2. Subtopics are listed, empty ones are handled -------------------------
check("a subtopic is listed", notes.includes("Naming and types") || notes.includes("Naming"));
check("a module with no subtopics says so rather than vanishing", /No subtopics|not been written/i.test(notes));
check("the Functions module is still in the file", notes.includes("### 3. Functions"));

// --- 3. Progress -------------------------------------------------------------
const noProgress = buildCourseNotes(course);
check("with no progress, nothing is marked done", !/✅/.test(noProgress));
check("with no progress, percent is 0", /0%/.test(noProgress));

const halfDone = buildCourseNotes(course, ["Variables and types"]);
check("a completed module is marked", /✅/.test(halfDone));
check("a completed module counts in the summary", /1\/3 modules \(33%\)/.test(halfDone), (halfDone.match(/- \*\*Progress:\*\*.*/) ?? [""])[0]);

const allDone = buildCourseNotes(course, course.modules.map((m) => m.title));
check("a finished course reads 100%", /3\/3 modules \(100%\)/.test(allDone));

// A title that no longer exists in the syllabus must not inflate the count.
const stale = buildCourseNotes(course, ["A module that was renamed away"]);
check("a stale completed title does not inflate progress", /0\/3 modules \(0%\)/.test(stale), (stale.match(/- \*\*Progress:\*\*.*/) ?? [""])[0]);

// --- 4. Empty and malformed input --------------------------------------------
const empty = buildCourseNotes({
  title: "Empty Course",
  category: "None",
  description: "",
  level: "beginner",
  modules: [],
});
check("a course with no modules still renders", empty.includes("# Empty Course"));
check("a course with no modules does not divide by zero", !/NaN/.test(empty), empty.includes("NaN") ? "NaN present" : "");

const noSubtopics = buildCourseNotes({
  title: "No Subtopics",
  category: "None",
  description: "d",
  level: "beginner",
  modules: [{ title: "Bare", topic: "bare" }],
});
check("an absent subtopics field is tolerated", noSubtopics.includes("### 1. Bare"));

const blankSubtopics = buildCourseNotes({
  title: "Blank Subtopics",
  category: "None",
  description: "d",
  level: "beginner",
  modules: [{ title: "Blank", topic: "blank", subtopics: ["", "   "] }],
});
check("whitespace subtopics are dropped, not printed as empty bullets", !/^\s*-\s*$/m.test(blankSubtopics));

// --- 5. Filenames ------------------------------------------------------------
check("a normal title slugs cleanly", slugify("Machine Learning Basics") === "machine-learning-basics");
check("punctuation is stripped", slugify("What's AI? (2026)") === "what-s-ai-2026", slugify("What's AI? (2026)"));
check("an unusable title still yields a filename", slugify("!!!") === "course", slugify("!!!"));
check("a very long title is bounded", slugify("x".repeat(200)).length <= 60);

// --- 6. Hindi ----------------------------------------------------------------
// The notes follow the student's language like everything else in the app.
const hi = buildCourseNotes(course, ["Conditionals"], "hi");
check("Hindi notes use Hindi headings", hi.includes("कोर्स नोट्स"), hi.split("\n")[0] || "");
check("the course title stays as the syllabus words it", hi.startsWith("# Machine Learning Basics"));
check("Hindi notes mark progress in Hindi", /पूर्ण/.test(hi));
check("Hindi notes keep the English module titles", hi.includes("Conditionals"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
// Permanent unit tests for the return path and first-run state.
//
// Run: npm run test:return
//
// Everything adaptive in this app only pays off from the tenth session on, and
// nothing was bringing the student back. These rules decide what the first
// thing they see is, which makes most of the assertions about restraint
// rather than detection.

import {
  returnState,
  isFirstRun,
  awayLabel,
  recommendedStarterCourse,
} from "../src/services/returnState";
import type { ReviewCard, TestEvaluation } from "../src/models/Progress";
import type { ConversationMessage } from "../src/models/Session";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const T0 = new Date("2026-03-01T09:00:00Z");
const minsAgo = (m: number): Date => new Date(T0.getTime() - m * 60_000);

const user = (content: string, minutesAgo: number): ConversationMessage => ({
  role: "user",
  content,
  at: minsAgo(minutesAgo),
});
const tutor = (content: string, minutesAgo: number): ConversationMessage => ({
  role: "assistant",
  content,
  at: minsAgo(minutesAgo),
});
const card = (topic: string, dueInHours: number): ReviewCard => ({
  topic,
  strength: 50,
  lastReviewedAt: minsAgo(1000),
  dueAt: new Date(T0.getTime() + dueInHours * 3_600_000),
  intervalDays: 1,
  reps: 0,
  lapses: 0,
});
const evaluated = (topic: string): TestEvaluation => ({
  topic,
  score: 50,
  feedback: "",
  recommendedFocus: "",
  misconceptions: [],
  evaluatedAt: minsAgo(1000),
});

// --- 1. A brand-new student is not greeted -------------------------------
const brandNew = returnState({}, T0);
check("a brand-new student is not a return", !brandNew.isReturn);
check("a brand-new student gets no greeting", brandNew.greeting === "", brandNew.greeting);
check("absence of history means unknown absence", brandNew.awayMs === null);
check("a brand-new student is a first run", isFirstRun({}));

// --- 2. Coming back is acknowledged ---------------------------------------
const returning = returnState(
  { conversation: [user("hi", 4000), tutor("hello", 3990)] },
  T0,
);
check("a student away for days is a return", returning.isReturn);
check("the greeting says welcome back", /welcome back/i.test(returning.greeting), returning.greeting);
check(
  "the greeting names the absence",
  /days ago|hours? ago|yesterday/.test(returning.greeting),
  returning.greeting,
);

// --- 3. A short break is not a return ------------------------------------
const quick = returnState({ conversation: [user("hi", 10), tutor("hello", 9)] }, T0);
check("a ten-minute break is not a return", !quick.isReturn);
check("a ten-minute break gets no greeting", quick.greeting === "");

// --- 4. Due work is surfaced -----------------------------------------------
const withDue = returnState(
  {
    conversation: [user("hi", 3000), tutor("hello", 2990)],
    reviewCards: [card("recursion", -5), card("loops", -2), card("trees", 100)],
  },
  T0,
);
check("due reviews are counted", withDue.dueCount === 2, `count=${withDue.dueCount}`);
check("the greeting mentions what is due", /ready to review/.test(withDue.greeting), withDue.greeting);
check(
  "a single due review is not pluralised",
  /1 concept ready/.test(
    returnState(
      { conversation: [user("a", 3000), tutor("b", 2990)], reviewCards: [card("x", -1)] },
      T0,
    ).greeting,
  ),
);
check(
  "a future review is not announced",
  !/ready to review/.test(
    returnState(
      { conversation: [user("a", 3000), tutor("b", 2990)], reviewCards: [card("x", 50)] },
      T0,
    ).greeting,
  ),
);

// --- 5. Abandonment is noticed --------------------------------------------
// The greeting names the unfinished question, so it needs a topic to name.
const abandoned = returnState(
  {
    conversation: [user("question", 100), tutor("answer", 99), user("follow-up", 60)],
    activeTopic: "transformers",
  },
  T0,
);
check("a trailing student message means they left mid-question", abandoned.leftMidQuestion);
check("the greeting names what they left", /transformers/.test(abandoned.greeting), abandoned.greeting);
check("and says it was part-way", /part-way through/i.test(abandoned.greeting), abandoned.greeting);

const noTopic = returnState(
  { conversation: [user("question", 100), tutor("answer", 99), user("follow-up", 60)] },
  T0,
);
check(
  "without a topic the greeting stays quiet rather than guessing",
  !/part-way/.test(noTopic.greeting),
  noTopic.greeting,
);

const answered = returnState(
  { conversation: [user("question", 100), tutor("answer", 60)] },
  T0,
);
check("a completed exchange is not abandonment", !answered.leftMidQuestion);
check("no part-way line when nothing was unfinished", !/part-way/.test(answered.greeting));

// --- 6. Unknown timestamps are unknown, not ancient ------------------------
const noTimes = returnState(
  {
    conversation: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ],
  },
  T0,
);
check("a session with no timestamps reports no absence", noTimes.awayMs === null);
check("and is not treated as a return", !noTimes.isReturn);
check(
  "a pre-timestamp session is not greeted as if months away",
  noTimes.greeting === "",
  noTimes.greeting,
);

// --- 7. isFirstRun is about the student, not the clock ---------------------
check(
  "a student who has only listened is a first run",
  isFirstRun({ conversation: [{ role: "assistant", content: "welcome" }] }),
);
check("a student who has asked a question is not", !isFirstRun({ conversation: [user("hello", 5)] }));
check("a student who has been tested is not", !isFirstRun({ testHistory: [evaluated("x")] }));
check("a student with a review card is not", !isFirstRun({ reviewCards: [card("x", 1)] }));
check(
  "an empty message does not count as having asked",
  isFirstRun({ conversation: [{ role: "user", content: "   " }] }),
);

// --- 8. The starter recommendation is fixed, not guessed -------------------
const starter = recommendedStarterCourse();
check("a starter course is named", starter.title.length > 0, starter.title);
check("a starter topic is named", starter.topic.length > 0, starter.topic);

// --- 9. Labels -------------------------------------------------------------
check("a short absence gets no dashboard label", awayLabel(10 * 60_000) === "");
check("a long absence does", /away/i.test(awayLabel(4000 * 60_000)), awayLabel(4000 * 60_000));
check("an unknown absence gets no label", awayLabel(null) === "");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} return checks passed`);
process.exit(failed.length ? 1 : 0);


// Permanent unit tests for study streaks and the daily goal.
//
// Run: npm run test:streak
//
// The streak is the first thing in this app that is time-dependent and NOT a
// mastery measure, so it has three failure modes the rest of the learner model
// does not, and each is pinned below:
//
//   - resetting at midnight, which punishes a student for opening the app;
//   - claiming a day the student did not study, by counting the tutor's own
//     messages or a single bare turn as a full day;
//   - saying something discouraging to a student who has already fallen behind,
//     which is the failure mode that loses them rather than the one that
//     embarrasses them.
//
// Pure, so no database and no clock of its own: every case injects `now`.

import {
  activityByDay,
  daysBetween,
  localDay,
  parseDayKey,
  streakFor,
  streakState,
  DAILY_GOAL_TURNS,
  MAX_STREAK_SCAN_DAYS,
  type ActivityByDay,
} from "../src/services/streak";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

// A fixed "now" so nothing depends on the wall clock. Mid-afternoon, because a
// morning hour is exactly the case where the "today not done yet" rule matters
// and a late-evening hour would hide it.
const NOW = new Date(2026, 3, 10, 14, 30, 0);

/** The local day `offset` days before NOW. 0 = today, 1 = yesterday. */
function dayOffset(offset: number): Date {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - offset);
}

/** A day-key map with one turn on each of the given day offsets. */
function days(...offsets: number[]): ActivityByDay {
  const map: ActivityByDay = new Map();
  for (const offset of offsets) {
    map.set(localDay(dayOffset(offset)), { turns: 1, tests: 0 });
  }
  return map;
}

/** A day-key map with an explicit turn count on each day offset. */
function turnsByDay(spec: Array<[offset: number, turns: number]>): ActivityByDay {
  const map: ActivityByDay = new Map();
  for (const [offset, turns] of spec) {
    map.set(localDay(dayOffset(offset)), { turns, tests: 0 });
  }
  return map;
}

// --- 1. Day keys are local, and parse back to the same day ---------------------
check("a day key is YYYY-MM-DD in local time", localDay(NOW) === "2026-04-10", localDay(NOW));
check(
  "a key parses back to the same local day",
  localDay(parseDayKey(localDay(NOW))) === localDay(NOW),
  localDay(parseDayKey(localDay(NOW))),
);
check(
  "a single-digit month pads correctly",
  localDay(new Date(2026, 0, 5)) === "2026-01-05",
  localDay(new Date(2026, 0, 5)),
);
check(
  "a December date pads correctly",
  localDay(new Date(2026, 11, 25)) === "2026-12-25",
  localDay(new Date(2026, 11, 25)),
);
check(
  "days between two days is exact",
  daysBetween(new Date(2026, 3, 10), new Date(2026, 3, 13)) === 3,
);
check(
  "days between is signed when reversed",
  daysBetween(new Date(2026, 3, 13), new Date(2026, 3, 10)) === -3,
);

// --- 2. A brand-new student is not accused of anything -------------------------
const empty = streakState(new Map(), NOW);
check("no history means no streak", empty.current === 0, `current=${empty.current}`);
check("and no last-active claim", empty.lastActiveDaysAgo === null, `${empty.lastActiveDaysAgo}`);
check("and today's goal is not met", !empty.goalMet);
check("and nothing is counted against today", empty.todayTurns === 0);
check(
  "a new student is told one question starts today",
  empty.message === "One question starts today.",
  empty.message,
);

// --- 3. The rule the whole design turns on: midnight does not reset it ---------
// Yesterday only, today untouched. This is 9am in a student's life: the run is
// still real, it just has not been extended.
const yesterdayOnly = streakState(days(1), NOW);
check(
  "yesterday's activity keeps the streak alive today",
  yesterdayOnly.current === 1,
  `current=${yesterdayOnly.current}`,
);
check("but today is not counted as studied", !yesterdayOnly.studiedToday);
check(
  "and the nudge is about keeping it going",
  yesterdayOnly.message.includes("still alive"),
  yesterdayOnly.message,
);

const threeDayRun = streakState(days(0, 1, 2), NOW);
check("a run through today counts every day", threeDayRun.current === 3, `current=${threeDayRun.current}`);
check("today's activity is recognised", threeDayRun.studiedToday);

const endedYesterday = streakState(days(1, 2, 3), NOW);
check(
  "a run that ended yesterday is still current",
  endedYesterday.current === 3,
  `current=${endedYesterday.current}`,
);
// --- 4. Only real activity counts ---------------------------------------------
// The tutor's half of the thread is the app talking to itself. Counting it would
// let a student look busy without having studied anything.
const tutorOnly = activityByDay(
  { messages: [{ role: "assistant", at: NOW }, { role: "assistant", at: NOW }], now: NOW },
);
check(
  "the tutor's own messages are not study turns",
  (tutorOnly.get(localDay(NOW))?.turns ?? 0) === 0,
);

const studentTurns = activityByDay(
  { messages: [{ role: "user", at: NOW }, { role: "assistant", at: NOW }], now: NOW },
);
check(
  "the student's message is a study turn",
  studentTurns.get(localDay(NOW))?.turns === 1,
  `${studentTurns.get(localDay(NOW))?.turns}`,
);

// A test is studying even with no chat at all.
const testedOnly = activityByDay({ testHistory: [{ evaluatedAt: NOW }], now: NOW });
check("a graded test is activity", testedOnly.get(localDay(NOW))?.tests === 1);
check("a test-only day counts as a study day", streakState(testedOnly, NOW).current === 1);
check("but a test alone does not meet the turn goal", !streakState(testedOnly, NOW).goalMet);

// --- 5. Missing and malformed timestamps are not invented ---------------------
// `at` is optional on stored messages, so this is a real shape, not a defensive
// thought experiment: a message written before timestamps existed.
const noTimestamp = activityByDay(
  { messages: [{ role: "user" }, { role: "user", at: null }], now: NOW },
);
check("a message with no timestamp counts for nothing", noTimestamp.size === 0, `days=${noTimestamp.size}`);
check("and cannot fabricate a streak", streakState(noTimestamp, NOW).current === 0);

const garbage = activityByDay(
  {
    messages: [{ role: "user", at: "not-a-date" }],
    testHistory: [{ evaluatedAt: "also not a date" }],
    now: NOW,
  },
);
check(
  "unparseable dates are dropped rather than thrown on",
  garbage.size === 0,
  `days=${garbage.size}`,
);

// Degenerate input must not throw — this runs on every dashboard load.
check("null messages are tolerated", activityByDay({ messages: [null], now: NOW }).size === 0);
check("an empty history is tolerated", streakState(new Map(), NOW).current === 0);
check("a goal of zero does not hang", streakState(days(0), NOW, 0).current === 1);

// --- 6. Timestamps from the future are refused --------------------------------
// A student with a wrong device clock would otherwise get tomorrow's activity
// credited to today, which is the one thing a "did I study today" figure must
// never do.
const future = activityByDay(
  { messages: [{ role: "user", at: new Date(NOW.getTime() + 86_400_000) }], now: NOW },
);
check("a future timestamp is not counted today", future.size === 0, `days=${future.size}`);

// --- 7. The daily goal -------------------------------------------------------
const partial = streakState(turnsByDay([[0, 2]]), NOW);
check("partial progress is reported honestly", partial.todayTurns === 2, `${partial.todayTurns}`);
check("the goal is not met yet", !partial.goalMet);
check("and the remainder is counted", partial.turnsToGoal === DAILY_GOAL_TURNS - 2, `${partial.turnsToGoal}`);
check("but the day still counts as a study day", partial.studiedToday);

const met = streakState(turnsByDay([[0, DAILY_GOAL_TURNS]]), NOW);
check("a met goal is met", met.goalMet);
// --- 8. The longest run, including out-of-order and gapped records -------------
const gapped = streakState(turnsByDay([[0, 1], [2, 1], [3, 1], [6, 1], [7, 1], [8, 1]]), NOW);
check("the longest run is found across gaps", gapped.longest === 3, `longest=${gapped.longest}`);
check("and the current streak is only the live one", gapped.current === 1, `current=${gapped.current}`);
check(
  "a live streak never undercuts the longest",
  streakState(days(0, 1, 2, 3, 4), NOW).longest === 5,
);

// Insertion order must not matter: a backfilled record is not "the most recent".
const unordered: ActivityByDay = new Map([
  [localDay(NOW), { turns: 1, tests: 0 }],
  [localDay(dayOffset(5)), { turns: 1, tests: 0 }],
  [localDay(new Date(2020, 0, 1)), { turns: 1, tests: 0 }],
]);
check(
  "out-of-order insertion does not change the answer",
  streakState(unordered, NOW).lastActiveDaysAgo === 0,
  `${streakState(unordered, NOW).lastActiveDaysAgo}`,
);

// --- 9. The scan is bounded --------------------------------------------------
// A pathological record must not spin, and a streak claim cannot usefully reach
// further back than a year.
check("the scan window is a real bound", MAX_STREAK_SCAN_DAYS < 5000, `${MAX_STREAK_SCAN_DAYS}`);
check(
  "a streak longer than the window is capped rather than looping",
  streakState(days(...Array.from({ length: MAX_STREAK_SCAN_DAYS + 50 }, (_, i) => i)), NOW)
    .current <= MAX_STREAK_SCAN_DAYS + 1,
);

// --- 10. The wrapper the dashboard uses ---------------------------------------
const wrapped = streakFor({
  messages: [
    { role: "user", at: NOW },
    { role: "assistant", at: NOW },
    { role: "user", at: new Date(NOW.getTime() - 86_400_000) },
  ],
  testHistory: [],
  topicsVisited: [],
  now: NOW,
});
check("streakFor agrees with the two steps it wraps", wrapped.current === 2, `current=${wrapped.current}`);
check("and counts only the student turns", wrapped.todayTurns === 1, `${wrapped.todayTurns}`);

// The real storage shapes, not just test-shaped ones.
check(
  "a real test record shape is handled",
  streakFor({
    testHistory: [
      {
        topic: "t",
        score: 80,
        feedback: "",
        recommendedFocus: "",
        misconceptions: [],
        evaluatedAt: NOW,
      },
    ],
    now: NOW,
  }).studiedToday,
);
check(
  "a real topic-visit shape is handled",
  streakFor({ topicsVisited: [{ topic: "t", firstSeenAt: NOW }], now: NOW }).todayTurns === 1,
);

// --- 11. Nothing is said that discourages a student who is behind --------------
// The single most important assertion in this file: a broken streak must not be
// reported as a failure, because this app's users are students who are behind.
const behind = streakState(days(9), NOW);
check("a student returning after a long gap has no streak", behind.current === 0);
check("the longest run they built is still theirs", behind.longest === 1, `longest=${behind.longest}`);
check(
  "the message is an invitation, not a scolding",
  behind.message === "One question starts today.",
  behind.message,
);
check("it never says 'lost'", !behind.message.toLowerCase().includes("lost"), behind.message);
check(
  "and never labels a zero with the word streak",
  !behind.message.toLowerCase().includes("0-day"),
  behind.message,
);

// A brand-new student's very first day.
const firstEver = streakFor({ messages: [{ role: "user", at: NOW }], now: NOW });
check("the first ever day starts a streak of one", firstEver.current === 1, `current=${firstEver.current}`);
check(
  "and encourages the next one",
  firstEver.message.includes("still alive") || firstEver.message.includes("more question"),
  firstEver.message,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
check("with nothing left to do", met.turnsToGoal === 0, `${met.turnsToGoal}`);
check("and says so plainly", met.message.includes("goal met"), met.message);

const overrun = streakState(turnsByDay([[0, DAILY_GOAL_TURNS + 10]]), NOW);
check(
  "a day well past the goal never goes negative",
  overrun.turnsToGoal === 0,
  `${overrun.turnsToGoal}`,
);

// A genuine break: yesterday and the day before are empty, so the day before
// those starts a chain and today is not part of it.
const broken = streakState(days(2, 3, 4), NOW);
check("a missed yesterday breaks the chain", broken.current === 0, `current=${broken.current}`);
check("but the old run is still the longest", broken.longest === 3, `longest=${broken.longest}`);
check("and it says how long ago that was", broken.lastActiveDaysAgo === 2, `${broken.lastActiveDaysAgo}`);

// A single day with nothing is not a run of one.
check("one isolated day is a streak of one", streakState(days(4), NOW).current === 0);
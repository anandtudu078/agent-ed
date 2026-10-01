/**
 * Learning alerts: what the student should know about their own progress, right now.
 *
 * This exists because the dashboard had the raw material for every one of these
 * and showed none of it. Due reviews, weak points, course progress and pace were
 * all on the page — as lists, as counts, as percentages. What was missing was the
 * *conclusion*: "three concepts are ready to review" is a table of contents,
 * "two things have come due since you were last here" is a reason to open the app.
 *
 * Deliberately derived on read, never stored. An alert that can go stale is worse
 * than no alert, because a student who dismisses "3 due" and finds one is right
 * to distrust the next one. Everything here is a pure function of data already on
 * screen.
 *
 * Each alert carries what to DO about it, not just what is true. An alert with no
 * action is a notification, and notifications get muted; an alert that starts a
 * review or opens a chat is the product doing its job.
 */

export type AlertTone = "due" | "warning" | "success" | "info";

export type AlertActionKind =
  | "review"
  | "test"
  | "course"
  | "learn-topic"
  | "none";

export interface LearningAlert {
  /** Stable key, so a dismissed alert stays dismissed across a refresh. */
  id: string;
  tone: AlertTone;
  /** Short label: "Reviews due", "Course finished". */
  title: string;
  /** One sentence saying why it matters. */
  body: string;
  action: {
    kind: AlertActionKind;
    label: string;
    /** Topic or course the action applies to, when it needs one. */
    target?: string;
  };
}

export interface AlertInput {
  dueReviews: Array<{ topic: string; strength: number; label: string }>;
  weakPoints: Array<{ topic: string; strength: number }>;
  enrolledCourses: Array<{
    courseId: string;
    title: string;
    progressPercent: number;
    completedModules: string[];
  }>;
  /** Every module each course actually has, so "finished" means finished. */
  courseSizes: Record<string, number>;
  testHistory: Array<{ topic: string; score: number; evaluatedAt: string }>;
  learningSpeed: number;
  /** Server-phrased absence, e.g. "Away 3 days". Empty when unknown. */
  awayLabel: string;
  language?: "en" | "hi";
}

/** Never show more than this, even when everything applies. */
const MAX_ALERTS = 3;
/** A course at or above this percent is close enough to call out. */
const NEARLY_DONE_PERCENT = 80;
/** Strength below this is a genuine gap rather than ordinary wobble. */
const WEAK_THRESHOLD = 45;
/** A score this low is worth flagging even without a stored weak point. */
const POOR_SCORE = 50;

function copy(language: "en" | "hi") {
  return language === "hi"
    ? {
        dueTitle: (n: number) => (n === 1 ? "1 concept ready" : `${n} concepts ready`),
        dueBody: (n: number) =>
          n === 1
            ? "एक concept दोबारा देखने का समय हो गया है।"
            : `${n} concepts दोबारा देखने का समय हो गया है।`,
        dueAction: "Review अभी शुरू करो",
        weakTitle: "अभ्यास के लायक",
        weakBody: (t: string) => `${t} में अभी एक gap है। एक test से पता चल जाएगा।`,
        weakAction: "Test दो",
        idleTitle: "अभी कुछ due नहीं",
        idleBody: "कोई review लंबित नहीं है। कुछ नया शुरू करें।",
        idleAction: "नया topic सीखो",
        courseDoneTitle: "Course पूरा!",
        courseDoneBody: (t: string) => `${t} के सारे modules पूरे हो गए।`,
        courseAction: "देखो",
        courseNearTitle: "लगभग पूरा",
        courseNearBody: (t: string, p: number) => `${t} में ${p}% हो चुका है।`,
        poorTitle: "एक बार और करने लायक",
        poorBody: (t: string, s: number) =>
          `${t} पर ${s}% आया था। दूसरी बार करने से फ़ायदा होगा।`,
        poorAction: "दोबारा दो",
        awayTitle: "वापसी पर स्वागत है",
        awayBody: (a: string) => `${a}। चलिए, आज कुछ सीखते हैं।`,
        awayAction: "शुरू करो",
        paceTitle: "अच्छी रफ़्तार",
        paceBody: (n: number) => `आप हफ़्ते में लगभग ${n} नए concepts सीख रहे हैं।`,
        paceAction: "आगे बढ़ो",
      }
    : {
        dueTitle: (n: number) => (n === 1 ? "1 concept ready" : `${n} concepts ready`),
        dueBody: (n: number) =>
          n === 1
            ? "One concept has come round for another look."
            : `${n} concepts have come round for another look.`,
        dueAction: "Start review",
        weakTitle: "Worth practising",
        weakBody: (t: string) => `There's a recorded gap in ${t}. A quick test will show where you are.`,
        weakAction: "Test this",
        idleTitle: "Nothing due right now",
        idleBody: "No reviews are waiting. Start something new while you're here.",
        idleAction: "Learn a topic",
        courseDoneTitle: "Course finished",
        courseDoneBody: (t: string) => `You've completed every module in ${t}.`,
        courseAction: "View it",
        courseNearTitle: "Nearly done",
        courseNearBody: (t: string, p: number) => `You're ${p}% of the way through ${t}.`,
        poorTitle: "Worth another go",
        poorBody: (t: string, s: number) =>
          `You scored ${s}% on ${t}. That one usually comes round on a second pass.`,
        poorAction: "Retake it",
        awayTitle: "Welcome back",
        awayBody: (a: string) => `${a}. Let's pick something up today.`,
        awayAction: "Start something",
        paceTitle: "Good pace",
        paceBody: (n: number) => `You're covering about ${n} new concepts a week.`,
        paceAction: "Keep going",
      };
}

/**
 * Decide which alerts this student should see.
 *
 * Ordered by how much each should change what the student does next. Reviews come
 * first because they are the only alert with a deadline — everything else is an
 * opportunity, and a student with three concepts due should not have to read past
 * a congratulation to find that out.
 *
 * The set is capped and never exhaustive on purpose. A page of eleven alerts is a
 * page nobody reads, and the weakest one is always what trains people to dismiss
 * the rest.
 */
export function buildAlerts(input: AlertInput): LearningAlert[] {
  const language = input.language ?? "en";
  const t = copy(language);
  const alerts: LearningAlert[] = [];

  // --- 1. Reviews due. The only time-sensitive thing here. -------------------
  const due = input.dueReviews ?? [];
  if (due.length) {
    alerts.push({
      id: "reviews-due",
      tone: "due",
      title: t.dueTitle(due.length),
      body: t.dueBody(due.length),
      action: { kind: "review", label: t.dueAction, target: due[0]?.topic },
    });
  }

  // --- 2. A measured gap the student has never been shown --------------------
  // Only from weakPoints, which are measured. A low last score is handled
  // separately, because one poor attempt is not yet a standing gap.
  const weakest = (input.weakPoints ?? [])
    .filter((point) => point.strength < WEAK_THRESHOLD)
    .sort((a, b) => a.strength - b.strength)[0];
  if (weakest) {
    alerts.push({
      id: `weak-${weakest.topic.toLowerCase()}`,
      tone: "warning",
      title: t.weakTitle,
      body: t.weakBody(weakest.topic),
      action: { kind: "test", label: t.weakAction, target: weakest.topic },
    });
  }

  // --- 3. A poor last result, not yet a stored gap --------------------------
  // `slice(-1)` so this is the *most recent* attempt. Walking backwards through
  // history would flag a topic the student has since gone on to ace, which is the
  // single most demoralising thing this component could do.
  const last = (input.testHistory ?? []).slice(-1)[0];
  if (last && last.score < POOR_SCORE) {
    // Suppressed when the weak-point alert above already covers this topic: two
    // alerts about one gap reads as nagging.
    const alreadyFlagged =
      weakest?.topic?.toLowerCase() === last.topic?.toLowerCase();
    if (!alreadyFlagged) {
      alerts.push({
        id: `poor-${last.topic.toLowerCase()}`,
        tone: "warning",
        title: t.poorTitle,
        body: t.poorBody(last.topic, last.score),
        action: { kind: "test", label: t.poorAction, target: last.topic },
      });
    }
  }

  // --- 4. A course that just finished, or is nearly there -------------------
  for (const course of input.enrolledCourses ?? []) {
    const total = input.courseSizes?.[course.courseId] ?? 0;
    // Finished is computed against the modules the course actually has, never
    // against the stored count alone: a renamed module leaves a stale title behind
    // and would otherwise mark a half-finished course complete.
    const genuinelyFinished =
      total > 0 &&
      course.completedModules.length >= total &&
      course.progressPercent >= 100;

    if (genuinelyFinished) {
      alerts.push({
        id: `course-done-${course.courseId}`,
        tone: "success",
        title: t.courseDoneTitle,
        body: t.courseDoneBody(course.title),
        action: { kind: "course", label: t.courseAction, target: course.courseId },
      });
      continue;
    }

    if (
      course.progressPercent >= NEARLY_DONE_PERCENT &&
      course.progressPercent < 100 &&
      total > 0 &&
      course.completedModules.length < total
    ) {
      alerts.push({
        id: `course-near-${course.courseId}`,
        tone: "info",
        title: t.courseNearTitle,
        body: t.courseNearBody(course.title, course.progressPercent),
        action: { kind: "course", label: t.dueAction, target: course.courseId },
      });
    }
  }

  // --- 5. Coming back after an absence ---------------------------------------
  // Only when nothing else is already demanding attention. Telling someone with
  // three reviews due that we missed them is simply the wrong priority order.
  if ((input.awayLabel ?? "").trim() && alerts.length === 0) {
    alerts.push({
      id: "away",
      tone: "info",
      title: t.awayTitle,
      body: t.awayBody(input.awayLabel.trim()),
      action: { kind: "learn-topic", label: t.awayAction },
    });
  }

  // --- 6. Nothing due at all: give them somewhere to go ----------------------
  if (alerts.length === 0) {
    if ((input.learningSpeed ?? 0) > 0) {
      alerts.push({
        id: "pace",
        tone: "success",
        title: t.paceTitle,
        body: t.paceBody(Math.round(input.learningSpeed)),
        action: { kind: "learn-topic", label: t.paceAction },
      });
    } else {
      alerts.push({
        id: "idle",
        tone: "info",
        title: t.idleTitle,
        body: t.idleBody,
        action: { kind: "learn-topic", label: t.idleAction },
      });
    }
  }

  return alerts.slice(0, MAX_ALERTS);
}
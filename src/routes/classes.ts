/**
 * Classes: a teacher creates a class, students opt in with its join code, and
 * the teacher sees how that cohort is doing.
 *
 * The privacy line this route draws, stated once and enforced below:
 *
 * - A student appears in a roster **only after typing the class's join code**.
 *   Membership is the consent — there is no way for a teacher to pull a student
 *   in unilaterally, and leaving is one call with no approval step.
 *
 * - Teachers see **progress, never content**: course percentages, weak topics,
 *   latest score, last active. Conversation text, answers, and grader feedback
 *   are deliberately not in the payload. That distinction is the difference
 *   between a teacher who can help and a teacher who can read a student's
 *   diary — the second one would need a much heavier consent story than this
 *   app currently has.
 *
 * - Every teacher route re-reads the role from the database (`requireTeacher`),
 *   never from the token.
 *
 * All time-derived numbers are computed on read, following the rule the rest of
 * the codebase already lives by: a stored "active" flag is wrong the moment the
 * clock passes its threshold.
 */
import { randomInt } from "node:crypto";
import { Router, Request, Response } from "express";
import { isValidObjectId } from "mongoose";

import { Cohort } from "../models/Cohort";
import { Progress } from "../models/Progress";
import { Session } from "../models/Session";
import { User } from "../models/User";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
  requireTeacher,
} from "../middleware/auth";
import { classJoinRateLimit } from "../middleware/rateLimit";

const router = Router();

/**
 * Join-code alphabet: 32 unambiguous characters — no I/L/O/0/1 — because the
 * code is read aloud across a classroom and typed by students on phones.
 * Seven characters is ~10^10 combinations, which with the per-user join
 * rate limit below is not worth enumerating.
 */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 7;

/** Caps that keep a single account from bloating anyone's reads. */
const MAX_CLASSES_PER_TEACHER = 20;
const MAX_MEMBERS_PER_CLASS = 60;
const MAX_CLASSES_PER_STUDENT = 20;
/** Collision retries: 32^7 codes, so one retry should never be needed. */
const MAX_CODE_ATTEMPTS = 5;

function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

function parseClassName(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { name?: unknown }).name;
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > 60) return null;
  return name;
}

/**
 * POST /api/classes — create a class. Teacher only.
 * Body: { name }
 * Returns the class with its join code, which the client should show
 * prominently: it is the only thing a student needs to join.
 */
router.post(
  "/",
  requireAuth,
  requireTeacher,
  classJoinRateLimit,
  async (request: Request, response: Response) => {
    try {
      const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
      const name = parseClassName(request.body);
      if (!name) {
        response
          .status(400)
          .json({ error: "Class name must be 1-60 characters." });
        return;
      }

      const existing = await Cohort.countDocuments({
        teacherId: authUser.username,
      });
      if (existing >= MAX_CLASSES_PER_TEACHER) {
        response.status(409).json({
          error: `You can run at most ${MAX_CLASSES_PER_TEACHER} classes.`,
        });
        return;
      }

      // Insert with a fresh code each attempt; the unique index turns the
      // vanishingly rare collision into a retry instead of a shared code
      // (which would hand one teacher's roster to another).
      let cohort = null;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        try {
          cohort = await Cohort.create({
            name,
            teacherId: authUser.username,
            joinCode: generateJoinCode(),
            memberIds: [],
          });
          break;
        } catch (error) {
          const code = (error as { code?: number }).code;
          if (code !== 11000) throw error; // not a duplicate code — real error
        }
      }
      if (!cohort) {
        response.status(500).json({ error: "Could not mint a join code. Try again." });
        return;
      }

      response.status(201).json({
        class: {
          _id: String(cohort._id),
          name: cohort.name,
          joinCode: cohort.joinCode,
          memberCount: 0,
          createdAt: cohort.createdAt,
        },
      });
    } catch (error) {
      console.error("Class creation failed.", error);
      response.status(500).json({ error: "Unable to create the class right now." });
    }
  },
);

/**
 * GET /api/classes — the classes this teacher runs, newest first.
 * Member counts only; the roster is a separate, per-class read so opening the
 * list never drags every student's progress along with it.
 */
router.get("/", requireAuth, requireTeacher, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const cohorts = await Cohort.find({ teacherId: authUser.username })
      .sort({ createdAt: -1 })
      .lean();

    response.json({
      classes: cohorts.map((cohort) => ({
        _id: String(cohort._id),
        name: cohort.name,
        joinCode: cohort.joinCode,
        memberCount: cohort.memberIds.length,
        createdAt: cohort.createdAt,
      })),
    });
  } catch (error) {
    console.error("Class list failed.", error);
    response.status(500).json({ error: "Unable to load your classes." });
  }
});

/**
 * GET /api/classes/enrolled — the classes this student has joined.
 *
 * Registered before `/:id` on purpose: Express matches in order, and
 * `/enrolled` would otherwise be swallowed by the `:id` parameter and fail
 * ObjectId validation on a request that was never about a class id.
 *
 * Deliberately returns no roster and no peer identities — a student learns
 * which classes they are in and how big they are, never who else is in them.
 */
router.get("/enrolled", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const cohorts = await Cohort.find({ memberIds: authUser.username })
      .sort({ createdAt: -1 })
      .lean();

    // Teacher display names for the list. One query for all of them, never N.
    const teacherNames = await User.find({
      username: { $in: cohorts.map((cohort) => cohort.teacherId) },
    })
      .select({ username: 1, displayName: 1 })
      .lean();
    const nameFor = new Map(
      teacherNames.map((user) => [user.username, user.displayName]),
    );

    response.json({
      classes: cohorts.map((cohort) => ({
        _id: String(cohort._id),
        name: cohort.name,
        teacherName: nameFor.get(cohort.teacherId) ?? cohort.teacherId,
        memberCount: cohort.memberIds.length,
      })),
    });
  } catch (error) {
    console.error("Enrolled class list failed.", error);
    response.status(500).json({ error: "Unable to load your classes." });
  }
});

/**
 * POST /api/classes/join — join by code. Any signed-in student.
 * Body: { joinCode }
 *
 * Idempotent: already being in the class is a success, not an error, so a
 * double-tap or a reload never shows a student a scary message for having
 * done the right thing twice.
 */
router.post(
  "/join",
  requireAuth,
  classJoinRateLimit,
  async (request: Request, response: Response) => {
    try {
      const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
      const raw = (request.body as { joinCode?: unknown } | undefined)?.joinCode;
      if (typeof raw !== "string" || !raw.trim()) {
        response.status(400).json({ error: "Enter a class code." });
        return;
      }
      const joinCode = raw.trim().toUpperCase();

      const cohort = await Cohort.findOne({ joinCode });
      if (!cohort) {
        // One message for "no such code" whether or not the format looked
        // right — telling a guesser which part of their guess was wrong is
        // free oracle output for the next attempt.
        response.status(404).json({ error: "No class matches that code." });
        return;
      }
      if (cohort.teacherId === authUser.username) {
        response
          .status(400)
          .json({ error: "That is your own class — you already see it." });
        return;
      }
      if (cohort.memberIds.includes(authUser.username)) {
        response.json({
          joined: true,
          already: true,
          class: { _id: String(cohort._id), name: cohort.name },
        });
        return;
      }

      // Cap how many classes one student can be in, so a single account can't
      // make every roster read on the site more expensive. Counted with a
      // dedicated query rather than folded into the update below: the update
      // is per-class by `_id`, while this bound is per-student across classes.
      const joined = await Cohort.countDocuments({
        memberIds: authUser.username,
      });
      if (joined >= MAX_CLASSES_PER_STUDENT) {
        response.status(409).json({
          error: `You can be in at most ${MAX_CLASSES_PER_STUDENT} classes. Leave one first.`,
        });
        return;
      }

      // Two guarantees from two standard operators, no $expr: `$addToSet`
      // makes the join idempotent (the `$ne` filter skips a member who is
      // already in), and the size check below enforces the cap. Two students
      // racing for the last seat can both pass the filter, but whoever pushes
      // the list past the cap sees it in the returned document and is pulled
      // straight back out — the cap can be transiently overshot by a race, never
      // permanently, and the loser is told 409 rather than shown a lie.
      const updated = await Cohort.findOneAndUpdate(
        { _id: cohort._id, memberIds: { $ne: authUser.username } },
        { $addToSet: { memberIds: authUser.username } },
        { new: true },
      ).lean();

      if (!updated) {
        // Already a member: the `$ne` filter matched nothing. Re-read to say so
        // honestly rather than guessing.
        const current = await Cohort.findById(cohort._id)
          .select({ memberIds: 1, name: 1 })
          .lean();
        if (current?.memberIds.includes(authUser.username)) {
          response.json({
            joined: true,
            already: true,
            class: { _id: String(current._id), name: current.name },
          });
          return;
        }
        response.status(404).json({ error: "No class matches that code." });
        return;
      }

      if (updated.memberIds.length > MAX_MEMBERS_PER_CLASS) {
        await Cohort.updateOne(
          { _id: cohort._id },
          { $pull: { memberIds: authUser.username } },
        );
        response
          .status(409)
          .json({ error: "That class is full. Ask the teacher for another." });
        return;
      }

      response.json({
        joined: true,
        class: { _id: String(updated._id), name: updated.name },
      });
    } catch (error) {
      console.error("Class join failed.", error);
      response.status(500).json({ error: "Unable to join the class right now." });
    }
  },
);

/**
 * POST /api/classes/:id/leave — leave a class you joined. No approval step:
 * withdrawal that needs someone else's say-so is not withdrawal, which is the
 * same rule the consent flow already follows.
 */
router.post(
  "/:id/leave",
  requireAuth,
  classJoinRateLimit,
  async (request: Request, response: Response) => {
    try {
      const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
      const id = String(request.params.id ?? "");
      if (!isValidObjectId(id)) {
        response.status(404).json({ error: "Class not found." });
        return;
      }

      await Cohort.updateOne(
        { _id: id },
        { $pull: { memberIds: authUser.username } },
      );
      // Whether or not they were in it: leaving is idempotent, and reporting
      // membership back would leak it to someone probing ids.
      response.json({ left: true });
    } catch (error) {
      console.error("Class leave failed.", error);
      response.status(500).json({ error: "Unable to leave the class right now." });
    }
  },
);

/** How long before "last active" stops counting as this week. */
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/classes/:id — the roster. The owning teacher only.
 *
 * Three batched reads for the whole class — users, progress, sessions — never
 * one query per student: a 60-seat class must not become 181 round trips on
 * the one screen a teacher opens daily.
 */
router.get("/:id", requireAuth, requireTeacher, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const id = String(request.params.id ?? "");
    if (!isValidObjectId(id)) {
      response.status(404).json({ error: "Class not found." });
      return;
    }

    const cohort = await Cohort.findById(id).lean();
    if (!cohort) {
      response.status(404).json({ error: "Class not found." });
      return;
    }
    if (cohort.teacherId !== authUser.username) {
      // 403, matching the dashboard route's own ownership rule, and because an
      // ObjectId is not a secret worth building an oracle around.
      response
        .status(403)
        .json({ error: "Only the teacher who created this class can view it." });
      return;
    }

    const memberIds = cohort.memberIds;
    const [users, progresses, sessions] = await Promise.all([
      User.find({ username: { $in: memberIds } })
        .select({ username: 1, displayName: 1 })
        .lean(),
      Progress.find({ studentId: { $in: memberIds } })
        .select({
          enrolledCourses: 1,
          weakPoints: 1,
          testHistory: 1,
          updatedAt: 1,
        })
        .lean(),
      Session.find({ studentId: { $in: memberIds } })
        .select({ updatedAt: 1, studentId: 1 })
        .lean(),
    ]);

    const userByName = new Map(users.map((user) => [user.username, user]));
    const progressByName = new Map(
      progresses.map((progress) => [progress.studentId, progress]),
    );
    const sessionByName = new Map(
      sessions.map((session) => [session.studentId, session]),
    );

    const now = Date.now();
    const rows = memberIds
      // A member whose account was deleted is filtered out here even if the
      // erasure cascade missed them — a roster must not name the gone.
      .filter((username) => userByName.has(username))
      .map((username) => {
        const user = userByName.get(username)!;
        const progress = progressByName.get(username);
        const session = sessionByName.get(username);

        const courses = (progress?.enrolledCourses ?? []).map((enrollment) => ({
          title: enrollment.title,
          progressPercent: enrollment.progressPercent ?? 0,
          completedModules: (enrollment.completedModules ?? []).length,
        }));

        // Weakest first, three at most: a roster cell is a conversation
        // starter, not a transcript of every gap the student has.
        const weakPoints = [...(progress?.weakPoints ?? [])]
          .sort((a, b) => a.strength - b.strength)
          .slice(0, 3)
          .map((point) => ({ topic: point.topic, strength: point.strength }));

        // Latest graded test only. Older scores nag about topics the student
        // has since put behind them — the same rule the alerts follow.
        const lastTest = [...(progress?.testHistory ?? [])].sort(
          (a, b) =>
            new Date(b.evaluatedAt ?? 0).getTime() -
            new Date(a.evaluatedAt ?? 0).getTime(),
        )[0];

        // The later of the two records either action touched. Conversation
        // writes bump the session; grades and enrolments bump progress. A
        // dashboard open alone bumps neither unless something actually
        // changed in it.
        const candidates = [
          session ? new Date(session.updatedAt).getTime() : null,
          progress ? new Date(progress.updatedAt).getTime() : null,
        ].filter((value): value is number => value !== null);
        const lastActiveAt = candidates.length ? Math.max(...candidates) : null;

        return {
          username,
          displayName: user.displayName,
          courses,
          weakPoints,
          lastScore:
            lastTest && typeof lastTest.score === "number"
              ? {
                  score: lastTest.score,
                  topic: lastTest.topic,
                  evaluatedAt: lastTest.evaluatedAt,
                }
              : null,
          lastActiveAt: lastActiveAt ? new Date(lastActiveAt).toISOString() : null,
          activeThisWeek:
            lastActiveAt !== null && now - lastActiveAt < ACTIVE_WINDOW_MS,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Cohort-level facts, all derived here rather than stored: a class that
    // sits unopened for a month must not still claim "12 active this week".
    const activeThisWeek = rows.filter((row) => row.activeThisWeek).length;
    const neverActive = rows.filter((row) => row.lastActiveAt === null).length;
    const enrolledRows = rows.filter((row) => row.courses.length > 0);
    const meanProgress =
      enrolledRows.length === 0
        ? 0 // nobody has started a course — 0%, not NaN, not "no data"
        : Math.round(
            enrolledRows.reduce((sum, row) => {
              const mean =
                row.courses.reduce(
                  (inner, course) => inner + course.progressPercent,
                  0,
                ) / row.courses.length;
              return sum + mean;
            }, 0) / enrolledRows.length,
          );

    // Common gaps: how many *members* are weak on each topic, not how many
    // records say it — one struggling student must not outrank a real trend.
    const weaknessCount = new Map<string, number>();
    for (const row of rows) {
      for (const point of row.weakPoints) {
        weaknessCount.set(
          point.topic,
          (weaknessCount.get(point.topic) ?? 0) + 1,
        );
      }
    }
    const commonWeakTopics = [...weaknessCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic, students]) => ({ topic, students }));

    response.json({
      class: {
        _id: String(cohort._id),
        name: cohort.name,
        joinCode: cohort.joinCode,
        createdAt: cohort.createdAt,
      },
      summary: {
        memberCount: rows.length,
        activeThisWeek,
        neverActive,
        avgProgress: meanProgress,
        commonWeakTopics,
      },
      members: rows,
    });
  } catch (error) {
    console.error("Class roster failed.", error);
    response.status(500).json({ error: "Unable to load the roster." });
  }
});

/**
 * DELETE /api/classes/:id — delete a class. The owning teacher only.
 *
 * Students' own progress is untouched: a class is a view onto students, not
 * the store of anything they made. Membership simply dissolves with the class.
 */
router.delete("/:id", requireAuth, requireTeacher, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const id = String(request.params.id ?? "");
    if (!isValidObjectId(id)) {
      response.status(404).json({ error: "Class not found." });
      return;
    }

    const result = await Cohort.deleteOne({
      _id: id,
      teacherId: authUser.username,
    });
    if (result.deletedCount === 0) {
      response.status(404).json({ error: "Class not found." });
      return;
    }
    response.json({ deleted: true });
  } catch (error) {
    console.error("Class deletion failed.", error);
    response.status(500).json({ error: "Unable to delete the class." });
  }
});

export default router;

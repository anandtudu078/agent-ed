/**
 * Lessons — saved, replayable snapshots of a tutoring session.
 *
 * The live session is a rolling window (see `Session.conversationHistory`): it
 * is capped so the document can never outgrow MongoDB's 16 MB limit, which
 * means an explanation a student wants to revisit simply scrolls away. This
 * route is the one place that decides a moment is worth keeping, copies it out,
 * and hands it back verbatim later.
 *
 * Every route is scoped by the authenticated student and never trusts an id
 * from the body — a lesson is only ever read or deleted by the `studentId` that
 * owns it. That mirrors `routes/account.ts`, where the destructive path is
 * scoped the same way.
 */
import { isValidObjectId } from "mongoose";
import { Router, Request, Response } from "express";

import { Lesson } from "../models/Lesson";
import { Session } from "../models/Session";
import { User } from "../models/User";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
} from "../middleware/auth";

const router = Router();

/** Caps that keep one student from filling the collection with snapshots. */
const MAX_LESSONS_PER_STUDENT = 100;
/**
 * How much of the session a single snapshot carries.
 *
 * Mirrors the session's own `MAX_STORED_MESSAGES` cap (~100 exchange pairs).
 * It is restated here rather than imported because that constant lives in
 * `server.ts`, and a route reaching back into the entry point for a number it
 * can only describe is a coupling that buys nothing: a snapshot may hold a
 * whole lesson, but never more than the rolling window ever held — it is not a
 * way to outgrow the size the session enforces.
 */
const MAX_SNAPSHOT_MESSAGES = 200;

function authUser(request: Request): AuthUser {
  return (request as AuthenticatedRequest).authUser as AuthUser;
}

function parseOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** The stored snapshot, projected into what a list row needs — no messages. */
function toSummary(lesson: {
  _id: unknown;
  topic: string;
  courseId: string | null;
  moduleTitle: string | null;
  language: "en" | "hi";
  messages: unknown[];
  savedAt: Date;
}) {
  return {
    _id: String(lesson._id),
    topic: lesson.topic,
    courseId: lesson.courseId,
    moduleTitle: lesson.moduleTitle,
    language: lesson.language,
    messageCount: Array.isArray(lesson.messages) ? lesson.messages.length : 0,
    savedAt: lesson.savedAt,
  };
}

/**
 * POST /api/lessons — save the current session as a replayable snapshot.
 *
 * The snapshot is taken server-side from the live session rather than posted by
 * the client, so what is saved is exactly what the tutor actually said — a
 * client-supplied copy could be stale, truncated, or edited, and a snapshot
 * that doesn't match the lesson is worse than none.
 */
router.post("/", requireAuth, async (request: Request, response: Response) => {
  try {
    const user = authUser(request);
    const body = (request.body ?? {}) as Record<string, unknown>;

    const session = await Session.findOne({ studentId: user.username }).lean();
    if (!session || (session.conversationHistory ?? []).length === 0) {
      response.status(400).json({
        error: "There's nothing to save yet — chat with the tutor first.",
      });
      return;
    }

    const existing = await Lesson.countDocuments({ studentId: user.username });
    if (existing >= MAX_LESSONS_PER_STUDENT) {
      response.status(409).json({
        error: `You can save at most ${MAX_LESSONS_PER_STUDENT} lessons. Delete one to make room.`,
      });
      return;
    }

    // The student's stored teaching language is the default; the body may name
    // a different one only when it is a value we actually accept, so a snapshot
    // always records a language it can be replayed in.
    const dbUser = await User.findById(user.id).select({ language: 1 }).lean();
    const language =
      body.language === "hi" ? "hi" : dbUser?.language === "hi" ? "hi" : "en";

    const topic =
      parseOptionalString(body.topic, 120) ??
      session.activeTopic?.trim() ??
      "General";

    const lesson = await Lesson.create({
      studentId: user.username,
      courseId: parseOptionalString(body.courseId, 64),
      moduleTitle: parseOptionalString(body.moduleTitle, 120),
      topic,
      language,
      // Keep only the most recent window, exactly as the session does — a
      // snapshot must not be a way to outgrow the size the session enforces.
      messages: (session.conversationHistory ?? []).slice(-MAX_SNAPSHOT_MESSAGES),
      savedAt: new Date(),
    });

    response.status(201).json({ lesson: toSummary(lesson) });
  } catch (error) {
    console.error("Failed to save lesson snapshot.", error);
    response.status(500).json({ error: "Unable to save this lesson right now." });
  }
});

/** GET /api/lessons — the student's snapshots, newest first, without messages. */
router.get("/", requireAuth, async (request: Request, response: Response) => {
  try {
    const user = authUser(request);
    const lessons = await Lesson.find({ studentId: user.username })
      .sort({ savedAt: -1 })
      .lean();
    response.json({ lessons: lessons.map(toSummary) });
  } catch (error) {
    console.error("Failed to list lesson snapshots.", error);
    response.status(500).json({ error: "Unable to load your lessons." });
  }
});

/**
 * GET /api/lessons/:id — one snapshot in full, for replay.
 *
 * Scoped by `studentId` as well as `_id`, so a valid id belonging to another
 * student is a 404, not a leak. The messages are returned verbatim; the client
 * renders them as a read-only transcript.
 */
router.get("/:id", requireAuth, async (request: Request, response: Response) => {
  try {
    const user = authUser(request);
    const id = String(request.params.id ?? "").trim();
    if (!isValidObjectId(id)) {
      response.status(404).json({ error: "Lesson not found." });
      return;
    }
    const lesson = await Lesson.findOne({
      _id: id,
      studentId: user.username,
    }).lean();
    if (!lesson) {
      response.status(404).json({ error: "Lesson not found." });
      return;
    }
    response.json({ lesson });
  } catch (error) {
    console.error("Failed to load lesson snapshot.", error);
    response.status(500).json({ error: "Unable to load this lesson." });
  }
});

/** DELETE /api/lessons/:id — remove a snapshot. Owner only. */
router.delete("/:id", requireAuth, async (request: Request, response: Response) => {
  try {
    const user = authUser(request);
    const id = String(request.params.id ?? "").trim();
    if (!isValidObjectId(id)) {
      response.status(404).json({ error: "Lesson not found." });
      return;
    }
    const result = await Lesson.deleteOne({
      _id: id,
      studentId: user.username,
    });
    if (result.deletedCount === 0) {
      response.status(404).json({ error: "Lesson not found." });
      return;
    }
    response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete lesson snapshot.", error);
    response.status(500).json({ error: "Unable to delete this lesson." });
  }
});

export default router;


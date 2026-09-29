import { Router, Request, Response } from "express";

import { Course } from "../models/Course";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
} from "../middleware/auth";
import {
  enrollInCourse,
  unenrollFromCourse,
  computeCourseProgress,
} from "../services/courseService";
import { Session } from "../models/Session";

const router = Router();

function currentUser(request: Request): AuthUser {
  return (request as AuthenticatedRequest).authUser as AuthUser;
}

/** GET /api/courses — the catalog, with each course's module count. */
router.get("/", requireAuth, async (_request: Request, response: Response) => {
  try {
    const courses = await Course.find().sort({ createdAt: 1 }).lean();
    response.json({ courses });
  } catch (error) {
    console.error("Failed to list courses.", error);
    response.status(500).json({ error: "Unable to load the course catalog." });
  }
});

/**
 * POST /api/courses/:courseId/enroll
 *
 * Enrolls the student and immediately returns where they stand. The derived
 * progress is computed up front so the client doesn't have to wait for the
 * next dashboard load to show a bar.
 */
router.post(
  "/:courseId/enroll",
  requireAuth,
  async (request: Request, response: Response) => {
    try {
      const { username } = currentUser(request);
      const courseId = String(request.params.courseId ?? "").trim();
      if (!courseId) {
        response.status(400).json({ error: "courseId is required." });
        return;
      }

      const { enrollment, created } = await enrollInCourse(username, courseId);
      const course = await Course.findById(courseId).lean();
      const session = await Session.findOne({ studentId: username })
        .select({ topicsVisited: 1 })
        .lean();
      const derived = course
        ? computeCourseProgress(course, session?.topicsVisited ?? [])
        : null;

      response.status(created ? 201 : 200).json({
        enrollment,
        nextModule: derived?.nextModule ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("no longer exists")) {
        response.status(404).json({ error: message });
        return;
      }
      if (message.includes("at most")) {
        response.status(409).json({ error: message });
        return;
      }
      console.error("Failed to enroll in course.", error);
      response.status(500).json({ error: "Unable to enroll right now." });
    }
  },
);

/** DELETE /api/courses/:courseId/enroll — leaves the course. */
router.delete(
  "/:courseId/enroll",
  requireAuth,
  async (request: Request, response: Response) => {
    try {
      const { username } = currentUser(request);
      const courseId = String(request.params.courseId ?? "").trim();
      if (!courseId) {
        response.status(400).json({ error: "courseId is required." });
        return;
      }
      const removed = await unenrollFromCourse(username, courseId);
      response.json({ removed });
    } catch (error) {
      console.error("Failed to unenroll from course.", error);
      response.status(500).json({ error: "Unable to leave the course." });
    }
  },
);

export default router;

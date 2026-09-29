import { Router } from "express";

import { Course } from "../models/Course";
import { Progress } from "../models/Progress";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
} from "../middleware/auth";

const router = Router();

// Starter catalog seeded once so the dashboard's course list isn't empty on
// first load. Safe to run on every boot: it only inserts what's missing.
const STARTER_COURSES = [
  {
    title: "Introduction to Programming",
    category: "Programming",
    description: "Variables, loops, functions, and how code actually runs.",
    level: "beginner" as const,
  },
  {
    title: "Web Development Basics",
    category: "Web Development",
    description: "HTML, CSS, and JavaScript — build your first web page.",
    level: "beginner" as const,
  },
  {
    title: "Data Structures Fundamentals",
    category: "Computer Science",
    description: "Arrays, lists, stacks, queues, and when to reach for each.",
    level: "intermediate" as const,
  },
  {
    title: "Algorithms Step by Step",
    category: "Computer Science",
    description: "Sorting, searching, and thinking about efficiency.",
    level: "intermediate" as const,
  },
  {
    title: "Databases & MongoDB",
    category: "Databases",
    description: "How data is stored, queried, and modelled in documents.",
    level: "intermediate" as const,
  },
  {
    title: "Machine Learning Concepts",
    category: "AI & ML",
    description: "What models are, how they learn, and where AI shows up daily.",
    level: "advanced" as const,
  },
];

async function ensureStarterCourses(): Promise<void> {
  const existing = await Course.countDocuments();
  if (existing > 0) return;
  await Course.insertMany(STARTER_COURSES);
  console.log(`Seeded ${STARTER_COURSES.length} starter courses.`);
}

/**
 * GET /api/dashboard/:studentId
 *
 * Returns the signed-in student's learning progress (enrolled courses,
 * learning speed, weak points, AI test history) plus the course catalog.
 * Owner-only: a student can never read another student's dashboard.
 */
router.get(
  "/:studentId",
  requireAuth,
  async (request, response) => {
    try {
      const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
      const studentId = String(request.params.studentId ?? "").trim();

      if (!studentId) {
        response.status(400).json({ error: "studentId is required." });
        return;
      }
      if (authUser.username !== studentId) {
        response
          .status(403)
          .json({ error: "You can only view your own dashboard." });
        return;
      }

      await ensureStarterCourses();

      // First visit: create a blank progress record for this student.
      const progress =
        (await Progress.findOne({ studentId }).lean()) ??
        (await Progress.create({ studentId }).then((doc) => doc.toObject()));

      const courses = await Course.find().sort({ createdAt: 1 }).lean();

      response.json({ progress, courses });
    } catch (error) {
      console.error("Failed to load dashboard.", error);
      response.status(500).json({ error: "Unable to load dashboard." });
    }
  },
);

export default router;

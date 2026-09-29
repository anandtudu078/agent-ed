import { Router } from "express";

import { Course } from "../models/Course";
import { Progress } from "../models/Progress";
import {
  AuthenticatedRequest,
  AuthUser,
  requireAuth,
} from "../middleware/auth";
import { refreshEnrollments } from "../services/courseService";

const router = Router();

// Starter catalog seeded once so the dashboard's course list isn't empty on
// first load. Safe to run on every boot: it only inserts what's missing.
const STARTER_COURSES = [
  {
    title: "Introduction to Programming",
    category: "Programming",
    description: "Variables, loops, functions, and how code actually runs.",
    level: "beginner" as const,
    modules: [
      { title: "Variables and types", topic: "variables and data types" },
      { title: "Conditionals", topic: "if statements and conditionals" },
      { title: "Loops", topic: "loops and iteration" },
      { title: "Functions", topic: "functions and parameters" },
      { title: "Debugging", topic: "debugging and reading errors" },
    ],
  },
  {
    title: "Web Development Basics",
    category: "Web Development",
    description: "HTML, CSS, and JavaScript — build your first web page.",
    level: "beginner" as const,
    modules: [
      { title: "HTML structure", topic: "html structure and elements" },
      { title: "CSS styling", topic: "css styling and layout" },
      { title: "Responsive design", topic: "responsive web design" },
      { title: "DOM manipulation", topic: "dom manipulation" },
      { title: "Events", topic: "javascript events and handlers" },
    ],
  },
  {
    title: "Data Structures Fundamentals",
    category: "Computer Science",
    description: "Arrays, lists, stacks, queues, and when to reach for each.",
    level: "intermediate" as const,
    modules: [
      { title: "Arrays", topic: "arrays and indexing" },
      { title: "Linked lists", topic: "linked lists" },
      { title: "Stacks and queues", topic: "stacks and queues" },
      { title: "Hash tables", topic: "hash tables and dictionaries" },
      { title: "Trees", topic: "trees and binary search trees" },
    ],
  },
  {
    title: "Algorithms Step by Step",
    category: "Computer Science",
    description: "Sorting, searching, and thinking about efficiency.",
    level: "intermediate" as const,
    modules: [
      { title: "Big O notation", topic: "big o notation and time complexity" },
      { title: "Searching", topic: "searching algorithms" },
      { title: "Sorting", topic: "sorting algorithms" },
      { title: "Recursion", topic: "recursion" },
      { title: "Greedy and dynamic programming", topic: "dynamic programming" },
    ],
  },
  {
    title: "Databases & MongoDB",
    category: "Databases",
    description: "How data is stored, queried, and modelled in documents.",
    level: "intermediate" as const,
    modules: [
      { title: "Data modelling", topic: "data modelling and schemas" },
      { title: "CRUD operations", topic: "crud operations" },
      { title: "Indexing", topic: "database indexing" },
      { title: "Aggregation", topic: "aggregation pipelines" },
      { title: "Transactions", topic: "database transactions" },
    ],
  },
  {
    title: "Machine Learning Concepts",
    category: "AI & ML",
    description: "What models are, how they learn, and where AI shows up daily.",
    level: "advanced" as const,
    modules: [
      { title: "What is a model", topic: "machine learning models" },
      { title: "Training data", topic: "training data and features" },
      { title: "Overfitting", topic: "overfitting and underfitting" },
      { title: "Evaluation", topic: "model evaluation and metrics" },
      { title: "Everyday AI", topic: "everyday applications of ai" },
    ],
  },
];

/**
 * Seed the catalog, and backfill `modules` onto any course created before the
 * syllabus existed. Without the backfill an existing dev database keeps
 * module-less courses forever, and progress silently stays at 0% because
 * there's no denominator to divide by.
 */
async function ensureStarterCourses(): Promise<void> {
  const titles = new Set(STARTER_COURSES.map((course) => course.title));

  // Backfill: any starter course that exists but has no syllabus yet.
  await Course.bulkWrite(
    STARTER_COURSES.map((course) => ({
      updateOne: {
        filter: { title: course.title },
        update: { $set: { modules: course.modules } },
      },
    })),
  );

  const existingTitles = new Set(
    (
      await Course.find({ title: { $in: [...titles] } })
        .select({ title: 1 })
        .lean()
    ).map((course) => course.title),
  );
  const toInsert = STARTER_COURSES.filter(
    (course) => !existingTitles.has(course.title),
  );
  if (toInsert.length) {
    await Course.insertMany(toInsert);
    console.log(`Seeded ${toInsert.length} starter course(s).`);
  }
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
      // Derive course progress on read rather than trusting the stored copy.
      // Chat-time updates are best-effort, so this is what guarantees the
      // dashboard is correct even after a failed background write.
      await refreshEnrollments(authUser.username);

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

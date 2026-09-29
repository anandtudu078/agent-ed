import { Document, Model, Schema, model } from "mongoose";

/**
 * One concept's place in the review queue.
 *
 * A weak point says "this is shaky"; a review card says "this is shaky, and
 * here is when to look at it again". Without the second half the app collects
 * a list of gaps and then never brings the student back to close them, which is
 * the difference between a diagnostic and something that actually teaches.
 */
export interface ReviewCard {
  topic: string;
  /** 0–100, blended across attempts. Lower means shakier. */
  strength: number;
  lastReviewedAt: Date | null;
  /** When this concept next needs attention. */
  dueAt: Date;
  /** Current gap in days. Grows on success, collapses on a lapse. */
  intervalDays: number;
  /** Consecutive successful reviews. Resets to 0 on a lapse. */
  reps: number;
  /** Times this concept has been forgotten after being learned. */
  lapses: number;
}

export interface TestEvaluation {
  topic: string;
  score: number; // 0–100
  feedback: string;
  recommendedFocus: string;
  /**
   * The specific wrong ideas this answer revealed.
   *
   * The grader already works these out and was sending them to the client,
   * which then dropped them — so the most valuable signal in the whole system
   * was being discarded. "Weak on backpropagation" says where to look;
   * "thinks backprop is the same as gradient descent" says what to say.
   */
  misconceptions: string[];
  evaluatedAt: Date;
}

export interface WeakPoint {
  topic: string;
  strength: number; // 0–100, lower = weaker
}

export interface EnrolledCourse {
  courseId: string;
  title: string;
  lastTopic: string;
  progressPercent: number; // 0–100, derived from completedModules
  /** Titles of finished modules, in course order. */
  completedModules: string[];
  enrolledAt: Date;
}

export interface ProgressDocument extends Document {
  studentId: string;
  enrolledCourses: EnrolledCourse[];
  learningSpeed: number; // concepts/week estimate, surfaced on the dashboard header
  weakPoints: WeakPoint[];
  testHistory: TestEvaluation[];
  reviewCards: ReviewCard[];
  createdAt: Date;
  updatedAt: Date;
}

const reviewCardSchema = new Schema<ReviewCard>(
  {
    topic: { type: String, required: true },
    strength: { type: Number, required: true, min: 0, max: 100 },
    lastReviewedAt: { type: Date, default: null },
    dueAt: { type: Date, required: true },
    intervalDays: { type: Number, required: true, min: 0 },
    reps: { type: Number, required: true, min: 0 },
    lapses: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const enrolledCourseSchema = new Schema<EnrolledCourse>(
  {
    courseId: { type: String, required: true },
    title: { type: String, required: true },
    lastTopic: { type: String, default: "" },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    completedModules: { type: [String], default: [] },
    enrolledAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const weakPointSchema = new Schema<WeakPoint>(
  {
    topic: { type: String, required: true },
    strength: { type: Number, default: 50, min: 0, max: 100 },
  },
  { _id: false },
);

const testEvaluationSchema = new Schema<TestEvaluation>(
  {
    topic: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    feedback: { type: String, default: "" },
    recommendedFocus: { type: String, default: "" },
    /**
     * The specific wrong ideas this answer revealed.
     *
     * The grader already works these out and was sending them to the client,
     * which then dropped them — so the most valuable signal in the whole system
     * was being discarded. "Weak on backpropagation" says where to look;
     * "thinks backprop is the same as gradient descent" says what to say.
     */
    misconceptions: { type: [String], default: [] },
    evaluatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const progressSchema = new Schema<ProgressDocument>(
  {
    studentId: { type: String, required: true, index: true, unique: true },
    enrolledCourses: { type: [enrolledCourseSchema], default: [] },
    learningSpeed: { type: Number, default: 0 },
    weakPoints: { type: [weakPointSchema], default: [] },
    testHistory: { type: [testEvaluationSchema], default: [] },
    reviewCards: { type: [reviewCardSchema], default: [] },
  },
  { timestamps: true },
);

export const Progress: Model<ProgressDocument> = model<ProgressDocument>(
  "Progress",
  progressSchema,
);

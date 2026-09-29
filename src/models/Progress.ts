import { Document, Model, Schema, model } from "mongoose";

export interface TestEvaluation {
  topic: string;
  score: number; // 0–100
  feedback: string;
  recommendedFocus: string;
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
  createdAt: Date;
  updatedAt: Date;
}

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
  },
  { timestamps: true },
);

export const Progress: Model<ProgressDocument> = model<ProgressDocument>(
  "Progress",
  progressSchema,
);

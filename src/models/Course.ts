import { Document, Model, Schema, model } from "mongoose";

export interface CourseModule {
  title: string;
  /**
   * The concept this module teaches, in free text. This is the join key to a
   * student's `topicsVisited`, so it should read like something a tutor would
   * actually say out loud ("recursion"), not a slug ("module-3").
   */
  topic: string;
}

export interface CourseDocument extends Document {
  title: string;
  category: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced";
  modules: CourseModule[];
  createdAt: Date;
  updatedAt: Date;
}

const courseModuleSchema = new Schema<CourseModule>(
  {
    title: { type: String, required: true },
    topic: { type: String, required: true },
  },
  { _id: false },
);

const courseSchema = new Schema<CourseDocument>(
  {
    // Unique, because the catalog is keyed by title: `ensureStarterCourses`
    // matches on it to decide what to sync, and two concurrent seeds would both
    // insert the same course without an index to make the second one fail.
    title: { type: String, required: true, unique: true },
    category: { type: String, required: true, index: true },
    description: { type: String, required: true },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    // Ordered syllabus. A course without this can't express progress, because
    // there'd be no denominator for "how far through am I".
    modules: { type: [courseModuleSchema], default: [] },
  },
  { timestamps: true },
);

export const Course: Model<CourseDocument> = model<CourseDocument>(
  "Course",
  courseSchema,
);

import { Document, Model, Schema, model } from "mongoose";

export interface CourseDocument extends Document {
  title: string;
  category: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced";
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema = new Schema<CourseDocument>(
  {
    title: { type: String, required: true },
    category: { type: String, required: true, index: true },
    description: { type: String, required: true },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
  },
  { timestamps: true },
);

export const Course: Model<CourseDocument> = model<CourseDocument>(
  "Course",
  courseSchema,
);

import { Document, Model, Schema, model } from "mongoose";

import type { ConversationMessage } from "./Session";

/**
 * A saved, replayable snapshot of a lesson.
 *
 * The live `Session.conversationHistory` is a rolling window — capped at
 * `MAX_STORED_MESSAGES` so the document can never hit MongoDB's 16 MB ceiling,
 * which means an old lesson quietly scrolls out of existence as the student
 * keeps chatting. A diagnostic list of "what you got wrong" is only half the
 * story; being able to come back and *re-watch* the explanation that landed is
 * the other half, and it is exactly what the rolling window throws away.
 *
 * Two decisions follow the shape the rest of the app already uses:
 *
 * - `studentId` is the student's **username**, the same cross-document key
 *   `Session` and `Progress` use, so a student's snapshots join against those
 *   with no population step and erasure is one `deleteMany` alongside the rest.
 *
 * - `messages` is an independent copy, not a reference. A snapshot that pointed
 *   back at the live session would change under the student — defeating the one
 *   thing a snapshot is for. It is written once and never mutated.
 */
export interface LessonDocument extends Document {
  /** Username of the student who saved this lesson. */
  studentId: string;
  /** The course this lesson belonged to, when the student was in one. */
  courseId: string | null;
  /** Module title within that course, for a readable label. */
  moduleTitle: string | null;
  /** The concept the lesson was about — the active topic at save time. */
  topic: string;
  /** Teaching language the lesson ran in, so replay matches what was taught. */
  language: "en" | "hi";
  /** An immutable copy of the conversation at save time. */
  messages: ConversationMessage[];
  /** When the student saved it — distinct from `createdAt` in intent. */
  savedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The message shape, mirrored from `Session` rather than shared.
 *
 * `visual` is `Mixed` for the same reason the session keeps it that way: the
 * value is written only after `parseVisualSpec` has bounded and type-checked it,
 * and the client renders it through the same escaped renderers. Duplicating the
 * six diagram shapes here would be a second thing to keep in sync for no extra
 * safety. What matters is that this copy is inert data, and it is.
 */
const lessonMessageSchema = new Schema<ConversationMessage>(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: { type: String, required: true },
    // Defaulted rather than required, so a snapshot of an older session with
    // untimestamped messages stores and reads back cleanly.
    at: { type: Date, default: null },
    visual: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const lessonSchema = new Schema<LessonDocument>(
  {
    studentId: { type: String, required: true, index: true },
    courseId: { type: String, default: null },
    moduleTitle: { type: String, default: null, trim: true, maxlength: 120 },
    topic: { type: String, required: true, trim: true, maxlength: 120 },
    language: { type: String, enum: ["en", "hi"], default: "en" },
    messages: { type: [lessonMessageSchema], default: [] },
    savedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const Lesson: Model<LessonDocument> = model<LessonDocument>(
  "Lesson",
  lessonSchema,
);

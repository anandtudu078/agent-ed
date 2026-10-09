import { Document, Model, Schema, model } from "mongoose";

/**
 * A class a teacher runs and students opt into by typing a join code.
 *
 * Two decisions are load-bearing:
 *
 * - `teacherId` is the teacher's **username**, not their `_id`. Every other
 *   cross-document key in this codebase is the username (`Progress.studentId`,
 *   `Session.studentId`), and the dashboard route already treats the username
 *   as the student's identity. Using the same key here means the roster joins
 *   against those collections with no population step.
 *
 * - Membership is **opt-in and revocable**. A student appears in a teacher's
 *   roster only after they type this class's code, and disappears the moment
 *   they leave. Nothing is shared with a teacher that the student did not
 *   hand over deliberately — which is the same consent shape the rest of the
 *   app uses for data leaving the student's control.
 *
 * Deleting a `User` removes them from every cohort they belonged to and
 * deletes the cohorts they taught (see `routes/account.ts`) — a deleted
 * account that still shows up in a teacher's roster would contradict the
 * erasure the app already promises.
 */
export interface CohortDocument extends Document {
  /** Class name as the teacher typed it, e.g. "Period 3 — AI Fundamentals". */
  name: string;
  /** Username of the teacher who owns this class. */
  teacherId: string;
  /**
   * Short unambiguous code students type to join. Uniquely indexed — two
   * classes can never share a code, so joining one is never ambiguous.
   */
  joinCode: string;
  /** Usernames of the students who chose to join. */
  memberIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const cohortSchema = new Schema<CohortDocument>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    teacherId: { type: String, required: true, trim: true, lowercase: true, index: true },
    joinCode: { type: String, required: true, unique: true },
    memberIds: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },
  },
  { timestamps: true },
);

export const Cohort: Model<CohortDocument> = model<CohortDocument>(
  "Cohort",
  cohortSchema,
);

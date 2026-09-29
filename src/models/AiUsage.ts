import { Document, Model, Schema, model } from "mongoose";

/**
 * One row per student per UTC day, counting billable AI calls.
 *
 * This exists because the per-minute rate limit is the wrong instrument for
 * cost. A limit of 12/minute still permits roughly 17,000 calls a day per
 * student, which is a real bill and a single enthusiastic user could run it up
 * over a weekend without ever tripping the minute limit.
 *
 * Rows are cheap and bounded: one per active student per day, deleteable
 * wholesale, and the unique index means a race between two concurrent requests
 * can't create two rows for the same student-day.
 */
export interface AiUsageDocument extends Document {
  userId: string;
  /** UTC day as YYYY-MM-DD. */
  day: string;
  calls: number;
  createdAt: Date;
  updatedAt: Date;
}

const aiUsageSchema = new Schema<AiUsageDocument>(
  {
    userId: { type: String, required: true, index: true },
    day: { type: String, required: true },
    calls: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

aiUsageSchema.index({ userId: 1, day: 1 }, { unique: true });

export const AiUsage: Model<AiUsageDocument> = model<AiUsageDocument>(
  "AiUsage",
  aiUsageSchema,
);

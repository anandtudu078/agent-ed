import { Document, Model, Schema, model } from "mongoose";

import type { VisualSpec } from "../types/visual";

export type ConversationRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  /**
   * When the message was sent.
   *
   * Optional and defaulted, not required: messages written before this existed
   * carry no timestamp, and back-filling one would be inventing history. Every
   * reader must treat a missing `at` as "we don't know when" rather than as an
   * epoch — a message from last month and one from a moment ago would otherwise
   * look identical to any pacing calculation.
   */
  at?: Date | null;
  /**
   * The diagram the owl drew for this reply, stored so it survives a reload.
   *
   * Without it the board empties on refresh and the student loses the one part
   * of the explanation they can't reconstruct from the text. Always a spec
   * that already passed parseVisualSpec, and the client re-renders it through
   * the same escaped hand-written renderers, so it stays inert data.
   */
  visual?: VisualSpec | null;
}

/** A concept the student has worked on, and when they first reached it. */
export interface TopicVisit {
  topic: string;
  firstSeenAt: Date;
}

export interface SessionDocument extends Document {
  studentId: string;
  activeTopic: string;
  conversationHistory: ConversationMessage[];
  topicsVisited: TopicVisit[];
  createdAt: Date;
  updatedAt: Date;
}

const conversationMessageSchema = new Schema<ConversationMessage>(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: { type: String, required: true },
    // Defaulted rather than required, so old documents stay readable and only
    // genuinely unknown timestamps come back empty.
    at: { type: Date, default: Date.now },
    // Mixed rather than a second hand-written copy of the six diagram shapes:
    // the value is written only after parseVisualSpec has bounded and
    // type-checked it, and the client renders it through the same escaped
    // renderers. Duplicating the schema here would be a second thing to keep
    // in sync with no extra safety.
    visual: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const topicVisitSchema = new Schema<TopicVisit>(
  {
    topic: { type: String, required: true },
    firstSeenAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const sessionSchema = new Schema<SessionDocument>(
  {
    // Unique, and not optional: every read/write path does
    // findOne({studentId}) and findOneAndUpdate({studentId}, ..., {upsert}),
    // which silently corrupt a student's history if two rows can exist. A
    // duplicate would also make "the tutor remembers you" non-deterministic,
    // since only one of the two rows would ever be read back.
    studentId: { type: String, required: true, index: true, unique: true },
    activeTopic: { type: String, required: true },
    conversationHistory: {
      type: [conversationMessageSchema],
      default: [],
    },
    // Source data for the dashboard's "concepts per week" estimate.
    topicsVisited: { type: [topicVisitSchema], default: [] },
  },
  { timestamps: true },
);

export const Session: Model<SessionDocument> = model<SessionDocument>(
  "Session",
  sessionSchema,
);

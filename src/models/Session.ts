import { Document, Model, Schema, model } from "mongoose";

export type ConversationRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
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
    studentId: { type: String, required: true, index: true },
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

import { Document, Model, Schema, model } from "mongoose";

export type ConversationRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
}

export interface SessionDocument extends Document {
  studentId: string;
  activeTopic: string;
  conversationHistory: ConversationMessage[];
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

const sessionSchema = new Schema<SessionDocument>(
  {
    studentId: { type: String, required: true, index: true },
    activeTopic: { type: String, required: true },
    conversationHistory: {
      type: [conversationMessageSchema],
      default: [],
    },
  },
  { timestamps: true },
);

export const Session: Model<SessionDocument> = model<SessionDocument>(
  "Session",
  sessionSchema,
);

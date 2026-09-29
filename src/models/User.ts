import { Document, Model, Schema, model } from "mongoose";

export interface UserDocument extends Document {
  username: string;
  passwordHash: string;
  displayName: string;
  /**
   * Teaching language. Stored on the user rather than in localStorage so the
   * choice follows a student to another device — a language preference that
   * resets on a new browser isn't really a preference.
   */
  language: "en" | "hi";
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 32,
    },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 64 },
    language: {
      type: String,
      enum: ["en", "hi"],
      default: "en",
    },
  },
  { timestamps: true },
);

export const User: Model<UserDocument> = model<UserDocument>("User", userSchema);

import { Document, Model, Schema, model } from "mongoose";

export interface UserDocument extends Document {
  username: string;
  passwordHash: string;
  displayName: string;
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
  },
  { timestamps: true },
);

export const User: Model<UserDocument> = model<UserDocument>("User", userSchema);

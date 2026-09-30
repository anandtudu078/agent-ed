import { Document, Model, Schema, model } from "mongoose";
import type { AgeBand, ConsentRecord } from "../services/consent";

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
  /**
   * Age band self-declared at registration. Null until the student answers,
   * which is what makes the consent step reappear on the next sign-in instead of
   * silently treating silence as consent.
   */
  ageBand: AgeBand | null;
  /**
   * Consent record. See `services/consent.ts` — the rules live there, not here,
   * so they can be tested without a database.
   */
  consent: ConsentRecord;
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
    ageBand: {
      type: String,
      enum: ["under-13", "13-17", "18-plus"],
      default: null,
    },
    consent: {
      type: {
        status: {
          type: String,
          enum: ["none", "student", "guardian"],
          default: "none",
        },
        // The policy text the student (or guardian) actually agreed to. Consent
        // to an unknown version of the policy is not consent.
        version: { type: String, default: "" },
        // Who agreed: for guardian consent this is the adult's name, recorded so
        // a school or parent can point at a specific person later.
        by: { type: String, default: "" },
        at: { type: Date, default: null },
      },
      _id: false,
    },
  },
  { timestamps: true },
);

export const User: Model<UserDocument> = model<UserDocument>("User", userSchema);

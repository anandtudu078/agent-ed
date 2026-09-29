import mongoose from "mongoose";
import { ensureSessionIndexes } from "./ensureIndexes";

export async function connectDB(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured.");
  }

  await mongoose.connect(mongoUri);
  await ensureSessionIndexes();
  console.log("Connected to MongoDB.");
}

export const connectDatabase = connectDB;

import mongoose from "mongoose";
import { Session } from "../models/Session";

/**
 * Make `Session.studentId` genuinely unique.
 *
 * Declaring `unique: true` in the schema is not enough: any database created
 * before that change already has a plain non-unique index on the same key, and
 * Mongoose's autoIndex leaves the existing index alone rather than upgrading
 * it. The result is a schema that claims uniqueness the database does not
 * enforce — the exact failure this was meant to prevent.
 *
 * So do it explicitly: check for duplicates (refusing rather than silently
 * deleting a student's history), then swap the index.
 */
export async function ensureSessionIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;

  const duplicates = await Session.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$studentId", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);

  if (duplicates.length > 0) {
    // Merging would mean picking a winner between two histories, which can
    // silently lose messages. Stop and let a human decide.
    const sample = duplicates
      .slice(0, 5)
      .map((d) => `${d._id} (${d.n})`)
      .join(", ");
    throw new Error(
      `Cannot enforce unique Session.studentId: ${duplicates.length} student(s) ` +
        `have duplicate sessions, e.g. ${sample}. Merge them manually first.`,
    );
  }

  const collection = db.collection("sessions");
  // Driver's own type: `key` values may be strings (e.g. "text") as well as
  // numbers, and `name` is optional on some drivers' index descriptions.
  let indexes: Array<{
    name?: string;
    key: { [field: string]: unknown };
    unique?: boolean;
  }>;
  try {
    indexes = await collection.indexes();
  } catch {
    return; // Collection doesn't exist yet; Mongoose will create it correctly.
  }

  const existing = indexes.find(
    (index) => index.name === "studentId_1" && !index.unique,
  );
  if (!existing) return; // Either unique already, or named differently — leave it.

  await collection.dropIndex("studentId_1");
  await collection.createIndex({ studentId: 1 }, { unique: true, name: "studentId_1" });
  console.log("Migration: Session.studentId index is now unique.");
}

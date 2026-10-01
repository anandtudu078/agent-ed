import mongoose from "mongoose";
import { Session } from "../models/Session";
import { Progress } from "../models/Progress";

/**
 * Make a `studentId` index genuinely unique on a collection.
 *
 * Declaring `unique: true` in the schema is not enough: any database created
 * before that change already has a plain non-unique index on the same key, and
 * Mongoose's autoIndex leaves the existing index alone rather than upgrading
 * it. The result is a schema that claims uniqueness the database does not
 * enforce — the exact failure this was meant to prevent.
 *
 * So do it explicitly: check for duplicates (refusing rather than silently
 * deleting a student's history), then swap the index.
 *
 * `label` names the collection in the error, because this now runs for more
 * than one collection and "Cannot enforce unique studentId" is not actionable
 * without knowing which.
 */
async function enforceUniqueStudentId(
  collectionName: string,
  model: typeof Session | typeof Progress,
): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;

  const duplicates = await model.aggregate<{ _id: string; n: number }>([
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
      `Cannot enforce unique ${collectionName}.studentId: ${duplicates.length} student(s) ` +
        `have duplicate documents, e.g. ${sample}. Merge them manually first.`,
    );
  }

  const collection = db.collection(collectionName);
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
  console.log(`Migration: ${collectionName}.studentId index is now unique.`);
}

/**
 * Ensure the uniqueness both one-record-per-student collections depend on.
 *
 * `Session` is the one the history-corruption bug was found on, but `Progress`
 * has exactly the same contract — every path does `findOne({studentId})` and
 * `findOneAndUpdate({studentId}, ..., {upsert})`. Left unmigrated, a pre-existing
 * database could hold two Progress rows for one student, and a chat turn would
 * then update whichever one the upsert happened to reach.
 */
export async function ensureSessionIndexes(): Promise<void> {
  await enforceUniqueStudentId("sessions", Session);
  await enforceUniqueStudentId("progresses", Progress);
}

import { NextFunction, Request, Response } from "express";

import { AiUsage } from "../models/AiUsage";
import type { AuthenticatedRequest } from "./auth";

/**
 * Daily AI-call budget per student.
 *
 * Deliberately separate from the per-minute rate limit: that one protects
 * latency and stops runaway loops, this one protects the bill. They fail
 * differently and neither substitutes for the other.
 *
 * Read from AI_DAILY_CALL_LIMIT; a non-numeric or absent value falls back to
 * the default rather than silently disabling the cap.
 */
const DEFAULT_DAILY_CALL_LIMIT = 250;

export function dailyCallLimit(): number {
  const raw = Number.parseInt(process.env.AI_DAILY_CALL_LIMIT ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_CALL_LIMIT;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Count this call against the student's daily budget, or reject it.
 *
 * Fails *open* on a database error. The alternative — blocking every student
 * because the usage counter was briefly unreachable — would turn a bookkeeping
 * problem into a total outage, and the minute-level rate limit is still in
 * front of us either way. The failure is logged so it is visible.
 */
/**
 * Charge one call against a student's daily budget.
 *
 * Split out of the middleware so the socket chat path can meter identically —
 * `processStudentMessage` is reached from both `POST /api/chat` and the
 * `student-message` socket event, and the client uses the socket. Metering only
 * the HTTP route left the cap unenforced on the path students actually take, so
 * the bill it exists to protect was unbounded in practice.
 *
 * Fails *open* on a database error: blocking every student because a usage
 * counter was briefly unreachable turns a bookkeeping problem into an outage,
 * and the minute-level rate limit is still in front of us either way.
 *
 * Returns true when the call is within budget.
 */
export async function consumeDailyAiCall(userId: string): Promise<boolean> {
  const cap = dailyCallLimit();
  const day = utcDay();

  try {
    // Two steps, and the order matters.
    //
    // The conditional increment must NOT use upsert. Once a student is at the
    // cap the filter `calls < cap` stops matching, so an upsert tries to
    // *insert* a replacement row, the unique (userId, day) index rejects it,
    // and the resulting error — handled by the fail-open catch below — silently
    // disabled the cap entirely. That is exactly what happened the first time.
    //
    // So: make sure the row exists (idempotent), then increment only while
    // under the cap. The increment is a single atomic operation, so two
    // concurrent requests cannot both read "cap - 1" and both write "cap".
    await AiUsage.updateOne(
      { userId, day },
      { $setOnInsert: { userId, day, calls: 0 } },
      { upsert: true },
    );

    const counted = await AiUsage.findOneAndUpdate(
      { userId, day, calls: { $lt: cap } },
      { $inc: { calls: 1 } },
      { new: true },
    );
    return Boolean(counted);
  } catch (error) {
    console.error("AI spend metering failed; allowing the request.", error);
    return true;
  }
}

export async function aiSpendLimit(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authUser = request.authUser;
  if (!authUser?.id) {
    // requireAuth runs first; if it somehow didn't, don't meter anything.
    next();
    return;
  }

  if (await consumeDailyAiCall(authUser.id)) {
    next();
    return;
  }

  response.status(429).json({
    error:
      "You've used a lot of the tutor today. It resets tomorrow — come back then, or keep reviewing what you already have.",
  });
}

/** Remove usage rows older than the retention window. Called on boot. */
export async function pruneOldUsage(days = 30): Promise<void> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const result = await AiUsage.deleteMany({ day: { $lt: cutoff } });
  if (result.deletedCount) {
    console.log(`Pruned ${result.deletedCount} stale AI usage row(s).`);
  }
}

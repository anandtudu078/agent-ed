import { NextFunction, Response } from "express";

import { User } from "../models/User";
import {
  canUseAiFeatures,
  consentRequiredError,
  CONSENT_REQUIRED_MESSAGE,
} from "../services/consent";
import type { AuthenticatedRequest, AuthUser } from "./auth";

/**
 * The consent gate.
 *
 * Applied to every route that would send a student's words to an AI provider.
 * Client-side gating is not enough — the client is the thing an attacker
 * controls — so the decision is made here, on the server, from the stored
 * record.
 *
 * Deliberately re-reads the user on each request rather than trusting the JWT.
 * A token is valid for 30 minutes, so a student who withdraws consent would
 * otherwise keep sending questions to a provider for the rest of it. Withdrawal
 * that takes up to half an hour to take effect is not withdrawal.
 *
 * Everything the app does without a provider — signing in, the course catalog,
 * the dashboard, exporting your own data — stays available without consent. The
 * gate is on AI calls only, so a student who says no is not locked out of their
 * own account.
 */
export async function requireConsent(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authUser = request.authUser as AuthUser;
    const user = await User.findById(authUser.id)
      .select({ ageBand: 1, consent: 1 })
      .lean();
    if (!user || !canUseAiFeatures(user.ageBand ?? null, user.consent)) {
      response.status(403).json({
        error: CONSENT_REQUIRED_MESSAGE,
        code: "CONSENT_REQUIRED",
      });
      return;
    }
    next();
  } catch (error) {
    console.error("Consent check failed.", error);
    response.status(500).json({ error: "Unable to verify consent." });
  }
}

/** Same rule, for callers that are not routes (the socket chat path). */
export async function assertConsent(userId: string): Promise<void> {
  const user = await User.findById(userId)
    .select({ ageBand: 1, consent: 1 })
    .lean();
  if (!user || !canUseAiFeatures(user.ageBand ?? null, user.consent)) {
    throw consentRequiredError();
  }
}

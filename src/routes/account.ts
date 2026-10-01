/**
 * The student's own data: export and erasure.
 *
 * Separate from `/api/auth`, which is about proving who you are. This is about
 * what happens to the data afterwards, and keeping the two apart means the
 * destructive routes are all in one file a reviewer can read in thirty seconds.
 */
import { Router } from "express";

import { Progress } from "../models/Progress";
import { RefreshToken } from "../models/RefreshToken";
import { Session } from "../models/Session";
import { User } from "../models/User";
import {
  AuthenticatedRequest,
  AuthUser,
  clearAuthCookies,
  requireAuth,
} from "../middleware/auth";
import { CONSENT_POLICY_VERSION } from "../services/consent";

const router = Router();

/**
 * GET /api/account/export
 *
 * Everything we hold about this student, as JSON. Offered alongside the consent
 * notice because a notice that says "you can request your data" is worth nothing
 * without the means to actually get it — and because letting someone see exactly
 * what is stored is the cheapest way to make the rest of the claims believable.
 *
 * The password hash is deliberately included. It is one-way and useless to an
 * attacker, and it is the one field a student might otherwise wonder about;
 * quietly omitting it from their own export would look like concealment.
 */
router.get("/export", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const user = await User.findById(authUser.id).lean();
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }
    const [session, progress, activeSessions] = await Promise.all([
      Session.findOne({ studentId: user.username }).lean(),
      Progress.findOne({ studentId: user.username }).lean(),
      // Keyed by the user's `_id`, which is what `issueRefreshToken` stores —
      // not the username. Session and Progress are keyed by username, but
      // refresh tokens are not, and querying them the other way silently
      // matched nothing and always reported zero active sessions.
      RefreshToken.countDocuments({ userId: authUser.id, revokedAt: null }),
    ]);

    response.setHeader("Content-Disposition", 'attachment; filename="agented-data.json"');
    response.json({
      exportedAt: new Date().toISOString(),
      policyVersion: CONSENT_POLICY_VERSION,
      account: user,
      conversation: session?.conversationHistory ?? [],
      topicsVisited: session?.topicsVisited ?? [],
      learning: progress ?? null,
      // Counted, not listed: token hashes are credentials, and there is no reason
      // for a student to be holding them.
      activeSessions,
    });
  } catch (error) {
    console.error("Data export failed.", error);
    response.status(500).json({ error: "Unable to export your data." });
  }
});

/**
 * DELETE /api/account
 *
 * Erasure. Removes the account and everything attached to it.
 *
 * Scoped by the authenticated id, never by a username in the body — a deletion
 * route that takes its target from user input is a data-loss bug waiting for a
 * typo. The response is sent only after every delete resolves, so a partial
 * failure reports itself instead of leaving a half-deleted account that looks
 * deleted.
 *
 * Deliberately separate from withdrawing consent: revoking consent stops the AI
 * features and keeps the progress, while this is "erase me entirely". Students
 * who change their mind about the notice should not lose their work as a side
 * effect of doing the right thing.
 */
router.delete("/", requireAuth, async (request, response) => {
  try {
    const authUser = (request as AuthenticatedRequest).authUser as AuthUser;
    const user = await User.findById(authUser.id).lean();
    if (!user) {
      response.status(404).json({ error: "User not found." });
      return;
    }

    // Delete the account first, then everything keyed by it. Ordered rather than
    // `Promise.all`: the user row is the thing that makes the account real, so if
    // it goes first and a later delete fails we are left with orphaned rows that
    // are harmless, whereas the reverse order leaves a live account that the
    // student believes they erased. Either way the error is reported rather than
    // swallowed — `Promise.all` rejected on the first failure while the other
    // deletes were still in flight, so a partial failure returned an
    // indistinguishable 500 having done an unpredictable subset of the work.
    await User.deleteOne({ _id: authUser.id });
    await Session.deleteMany({ studentId: user.username });
    await Progress.deleteMany({ studentId: user.username });
    // Refresh tokens are keyed by `_id`, unlike the two collections above.
    await RefreshToken.deleteMany({ userId: authUser.id });
    // The account is gone, so any live session cookie must go with it — otherwise
    // the browser keeps a credential for an account that no longer exists.
    clearAuthCookies(request, response);

    response.json({ deleted: true });
  } catch (error) {
    console.error("Account deletion failed.", error);
    response.status(500).json({ error: "Unable to delete your account." });
  }
});

export default router;

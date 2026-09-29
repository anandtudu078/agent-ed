import { Document, Model, Schema, model } from "mongoose";
import crypto from "node:crypto";

/**
 * A long-lived credential used only to mint new access tokens.
 *
 * Only the SHA-256 hash is stored. The token is 32 bytes of CSPRNG output, so
 * a hash lookup is the right primitive here (not bcrypt — there is no
 * low-entropy guessing to slow down), and it keeps the lookup a single indexed
 * read on the hot refresh path.
 */
export interface RefreshTokenDocument extends Document {
  userId: string;
  tokenHash: string;
  /** Replaced-by hash, set when this token is rotated out. */
  replacedByHash?: string | null;
  expiresAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>({
  userId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  replacedByHash: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
});

// Mongo expires these on its own, but a TTL index alone doesn't make a revoked
// row unusable in the moment, so expiry is also checked in code.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken: Model<RefreshTokenDocument> =
  model<RefreshTokenDocument>("RefreshToken", refreshTokenSchema);

export const REFRESH_TOKEN_TTL_DAYS = 30;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Mint a new refresh token and store its hash. Returns the plaintext. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await RefreshToken.create({ userId, tokenHash: hashToken(token), expiresAt });
  return token;
}

export type RefreshOutcome =
  | { ok: true; userId: string; nextToken: string; expiresAt: Date }
  | { ok: false; reason: "not_found" | "expired" | "reused" };

/**
 * Redeem a refresh token, rotating it.
 *
 * Reuse detection is the point of rotation. If a token that was already
 * exchanged comes back, either a replay attack or a token was copied, and the
 * only safe response is to revoke every live token for that user — we can no
 * longer tell which of the two holders is the real one.
 */
export async function rotateRefreshToken(
  token: string,
): Promise<RefreshOutcome> {
  const hash = hashToken(token);
  const record = await RefreshToken.findOne({ tokenHash: hash });
  if (!record) return { ok: false, reason: "not_found" };

  if (record.replacedByHash) {
    await revokeAllRefreshTokens(record.userId);
    return { ok: false, reason: "reused" };
  }

  // Revocation is checked separately from rotation state on purpose. A token
  // can be revoked without ever having been spent — sign-out, or the family
  // kill that follows a reuse elsewhere — and a token that is only ever checked
  // for "was this replaced?" would sail straight through both.
  if (record.revokedAt) {
    return { ok: false, reason: "not_found" };
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const nextToken = crypto.randomBytes(32).toString("base64url");
  const nextHash = hashToken(nextToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  record.replacedByHash = nextHash;
  record.revokedAt = new Date();
  await record.save();
  await RefreshToken.create({
    userId: record.userId,
    tokenHash: nextHash,
    expiresAt,
  });

  return { ok: true, userId: record.userId, nextToken, expiresAt };
}

/** Revoke every live refresh token for a student (sign out, or reuse detected). */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

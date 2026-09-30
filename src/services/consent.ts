/**
 * Consent and age gating.
 *
 * This exists because the app is aimed at students, and a student is exactly the
 * person least able to consent meaningfully to their data being sent to a third
 * party. Every tutor prompt — the student's own words, their mistakes, their
 * progress — goes to an external AI provider.
 *
 * The rules live here as pure functions rather than inside routes or the UI,
 * for two reasons. They are the part most likely to be wrong, and a rule like
 * "a minor without guardian consent must be refused" is worth far more with 30
 * unit tests than with a paragraph in a README. And consent logic has a nasty
 * habit of being duplicated: once in the form, once in the API and once in the
 * client, they drift, and the copy that matters is the one nobody tests.
 *
 * Deliberately conservative throughout. Silence is never consent, a stale
 * consent is not consent, and an under-13 student's own agreement is not enough
 * no matter how clearly they tick the box.
 */

export type AgeBand = "under-13" | "13-17" | "18-plus";

/** Who agreed, and to which version of what. */
export interface ConsentRecord {
  status: "none" | "student" | "guardian";
  version: string;
  /** The consenting person's name. An adult's name for guardian consent. */
  by: string;
  at: Date | null;
}

/**
 * The version of the privacy notice being agreed to.
 *
 * Bump this whenever the notice changes materially. Consent recorded against an
 * older version is treated as stale and the student is asked again — which is
 * the point of recording it at all.
 */
export const CONSENT_POLICY_VERSION = "2026-02";

/** A user who has never been asked. */
export function emptyConsent(): ConsentRecord {
  return { status: "none", version: "", by: "", at: null };
}

export const AGE_BANDS: readonly AgeBand[] = ["under-13", "13-17", "18-plus"];

/** Whether the value is one of the bands we accept. */
export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === "string" && (AGE_BANDS as readonly string[]).includes(value);
}

/**
 * Everyone under 18 needs an adult to agree on their behalf.
 *
 * Fails closed: an unknown or missing age band returns `true`, because the
 * alternative is a caller asking this to decide whether a minor's data can leave
 * the server and getting "no, they don't need a guardian" because a field was
 * null. `canUseAiFeatures` refuses an unknown band outright as well — this is the
 * second lock on the same door.
 */
export function requiresGuardian(ageBand: AgeBand | null): boolean {
  return ageBand !== "18-plus";
}

/**
 * Whether a student may use the AI features.
 *
 * The single decision the whole flow exists to produce. Note what it does *not*
 * accept: no consent at all, a consent to an older policy, an under-13 student's
 * own agreement without an adult's, or a guardian agreement with no name.
 */
export function canUseAiFeatures(
  ageBand: AgeBand | null,
  consent: ConsentRecord | null | undefined,
): boolean {
  if (!isAgeBand(ageBand)) return false;
  if (!consent || consent.status === "none") return false;
  if (consent.version !== CONSENT_POLICY_VERSION) return false;
  if (!consent.at) return false;

  if (requiresGuardian(ageBand)) {
    // A minor is only ever unblocked by an adult who put their name to it. A
    // whitespace-only name is truthy, so the trim is load-bearing rather than
    // decorative.
    return consent.status === "guardian" && consent.by.trim().length >= 2;
  }

  // An adult consents for themselves, so there is no second name to collect —
  // their own account is the record. Guardian consent is also acceptable: a
  // parent registering on a child's behalf is a normal way this gets set up.
  return consent.status === "student" || consent.status === "guardian";
}

export interface ConsentOutcome {
  ok: boolean;
  error?: string;
  /** Set when the caller must ask a guardian before continuing. */
  needsGuardian?: boolean;
}

/**
 * Validate and build a consent record.
 *
 * Returns the record rather than writing it, so the route decides when to
 * persist. `now` is injected so tests do not assert on the wall clock.
 */
export function buildConsent(input: {
  ageBand: unknown;
  acceptedTerms: unknown;
  guardianName?: unknown;
  guardianAccepted?: unknown;
  now?: Date;
}): ConsentOutcome & { record?: ConsentRecord } {
  if (!isAgeBand(input.ageBand)) {
    return { ok: false, error: "Please choose an age group." };
  }
  // A checkbox arriving as the string "false" is a classic coercion bug, so this
  // insists on a real boolean rather than testing truthiness.
  if (input.acceptedTerms !== true) {
    return { ok: false, error: "The privacy notice has to be accepted to continue." };
  }

  const now = input.now ?? new Date();
  const base = { version: CONSENT_POLICY_VERSION, at: now };

  if (!requiresGuardian(input.ageBand)) {
    return { ok: true, record: { status: "student", by: "", ...base } };
  }

  const name = typeof input.guardianName === "string" ? input.guardianName.trim() : "";
  if (name.length < 2) {
    return {
      ok: false,
      needsGuardian: true,
      error:
        "A parent or guardian's name is needed before a student under 18 can use this.",
    };
  }
  if (name.length > 64) {
    return { ok: false, error: "That name is too long." };
  }
  if (input.guardianAccepted !== true) {
    return {
      ok: false,
      needsGuardian: true,
      error: "A parent or guardian has to confirm the privacy notice too.",
    };
  }

  return { ok: true, record: { status: "guardian", by: name, ...base } };
}

/**
 * The message a blocked student sees.
 *
 * Named rather than inlined so the API, the socket path and the client cannot
 * drift into three different explanations of the same refusal.
 */
export const CONSENT_REQUIRED_MESSAGE =
  "An adult needs to agree to the privacy notice before the AI tutor can be used.";

/** What we actually collect and who receives it. Shown in the consent step. */
export const PRIVACY_DISCLOSURE: readonly string[] = [
  "Your display name, username and a hashed password.",
  "What you type to the tutor, and what it replies.",
  "Your strengths, weak points and review schedule, so it can teach you properly.",
  "Your messages are sent to a third-party AI provider (Groq, or Google Gemini) to generate a reply. They are not used to train that provider's models on your account.",
  "You can export everything we hold about you, or delete it completely, at any time.",
];

/** Error carrying the code the client branches on. */
export function consentRequiredError(): Error & { code: string } {
  const error = new Error(CONSENT_REQUIRED_MESSAGE) as Error & { code: string };
  error.code = "CONSENT_REQUIRED";
  return error;
}

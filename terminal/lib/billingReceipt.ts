/**
 * The trial-start receipt contract (D7).
 *
 * `/api/billing/subscribe/complete` answers `{ status, subscription_id, trial_end }`. The Terminal
 * consumer checked `res.ok` and NOTHING else: it parsed whatever JSON arrived, took `trial_end` if
 * it happened to be a number, and called `onTrialStarted()` unconditionally. `HTTP 200 {}` was
 * therefore enough to move a user to "your trial is live" — and StepDone, handed a null date,
 * invented `now + 7 days` and printed it as the first-charge date.
 *
 * So on a money surface the product could tell a user a paid trial had started, and name a billing
 * date, on the strength of a response that said nothing at all.
 *
 * Today's authority is correct — Macro's billing tests pin status="trialing" with a real
 * subscription id and a numeric trial end — so this is a fail-closed guard rather than a live-defect
 * repair. That is precisely when it is worth adding: a malformed 2xx must be impossible to
 * misread LATER, when nobody is looking at this code.
 *
 * Validation is deliberately strict. If the gateway's success contract intentionally changes, the
 * producer and this consumer change together, with both sides' tests — which is the point of
 * freezing it here.
 */

/** A verified successful trial start. Every field is proven, so callers need no further guards. */
export type TrialReceipt = {
  status: "trialing";
  subscriptionId: string;
  /** Epoch SECONDS of the first charge. Validated as a plausible date, not merely `typeof number`. */
  trialEnd: number;
};

// Sanity window for an epoch-seconds trial end: 2020-01-01 .. 2100-01-01. This is not pedantry.
// A gateway that answered in MILLISECONDS would sail through a bare `typeof === "number"` check and
// render a first-charge date tens of thousands of years out; a 0 or a negative would render 1970.
// Both are "a number", and neither is a billing date.
const MIN_TRIAL_END = 1_577_836_800; // 2020-01-01T00:00:00Z
const MAX_TRIAL_END = 4_102_444_800; // 2100-01-01T00:00:00Z

function isPlausibleEpochSeconds(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MIN_TRIAL_END
    && value <= MAX_TRIAL_END;
}

/**
 * Parse a `subscribe/complete` body into a verified receipt, or `null`.
 *
 * `null` means "do not claim a trial started" — the caller must stay on Billing and offer a retry,
 * never advance to Done. There is deliberately no partial-credit return: a receipt missing any field
 * cannot support the sentence "your trial is live and you'll first be charged on <date>".
 */
export function parseTrialReceipt(body: unknown): TrialReceipt | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  // The successful trial state, exactly. "active", "incomplete", "past_due" and friends are real
  // Stripe states that are NOT a started trial, and must not be laundered into one.
  if (b.status !== "trialing") return null;

  const subscriptionId = typeof b.subscription_id === "string" ? b.subscription_id.trim() : "";
  if (!subscriptionId) return null;

  if (!isPlausibleEpochSeconds(b.trial_end)) return null;

  return { status: "trialing", subscriptionId, trialEnd: b.trial_end };
}

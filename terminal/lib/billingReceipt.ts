/**
 * The subscribe receipt contract (D7 + fix round 1).
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
 * D7's original fix over-corrected: it recognized ONLY `status === "trialing"` as a success, which
 * is wrong for any tier configured with no trial (macro `config/plans.yml` `essential: trial_days:
 * 0`) — Stripe answers `status: "active", trial_end: null` for a genuine, successful, no-trial
 * purchase, and the trialing-only guard refused it, telling a charged customer "you have not been
 * charged" with no way forward. This parser recognizes BOTH successful shapes and discriminates
 * them, so a caller can route each to truthful copy instead of collapsing one into "malformed".
 *
 * Validation is deliberately strict. If the gateway's success contract intentionally changes, the
 * producer and this consumer change together, with both sides' tests — which is the point of
 * freezing it here.
 */

/**
 * A verified successful subscribe outcome. Every field is proven, so callers need no further
 * guards — they only need to branch on `kind`.
 */
export type SubscribeReceipt =
  | {
      kind: "trial";
      subscriptionId: string;
      /** Epoch SECONDS of the first charge. Validated as a plausible date, not merely `typeof number`. */
      trialEnd: number;
    }
  | {
      kind: "active";
      subscriptionId: string;
    };

// Sanity window for an epoch-seconds trial end: 2020-01-01 .. 2100-01-01. This is not pedantry.
// A gateway that answered in MILLISECONDS would sail through a bare `typeof === "number"` check and
// render a first-charge date tens of thousands of years out; a 0 or a negative would render 1970.
// Both are "a number", and neither is a billing date.
const MIN_TRIAL_END = 1_577_836_800; // 2020-01-01T00:00:00Z
const MAX_TRIAL_END = 4_102_444_800; // 2100-01-01T00:00:00Z

/** Exported so every other reader of a trial-end epoch (e.g. a persisted wizard stash) applies the
 *  identical window rather than a looser ad hoc check. */
export function isPlausibleTrialEnd(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MIN_TRIAL_END
    && value <= MAX_TRIAL_END;
}

/**
 * Parse a `subscribe/complete` body into a verified receipt, or `null`.
 *
 * `null` means "do not claim anything happened" — the caller must stay on Billing and offer a
 * retry, never advance to Done. There is deliberately no partial-credit return: a receipt missing
 * any required field cannot support a user-facing claim about money.
 */
export function parseSubscribeReceipt(body: unknown): SubscribeReceipt | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const subscriptionId = typeof b.subscription_id === "string" ? b.subscription_id.trim() : "";
  if (!subscriptionId) return null;

  // The successful trial state: requires a plausible trial_end, exactly as before.
  if (b.status === "trialing") {
    if (!isPlausibleTrialEnd(b.trial_end)) return null;
    return { kind: "trial", subscriptionId, trialEnd: b.trial_end };
  }

  // The successful NO-TRIAL state (e.g. `essential`, plans.yml trial_days: 0): Stripe returns the
  // subscription's real status, "active", with trial_end: null. This is a genuine, charged
  // purchase — it must not be refused as "malformed" just because it carries no trial date.
  if (b.status === "active") {
    return { kind: "active", subscriptionId };
  }

  // Everything else — "incomplete", "past_due", "canceled", "unpaid", "paused", missing/non-string
  // status — is a real Stripe state that is NOT a successful purchase, and must not be laundered
  // into one.
  return null;
}

/**
 * Re-validate a `{trialActive, trialEnd}` pair read from a persisted client-side stash (the wizard
 * survives a client-tree remount via `sessionStorage`). The stash is a second, unguarded input into
 * the same "your trial is live" UI claim the network receipt above guards — it must be held to the
 * identical fail-closed standard: `trialActive` may only be true when `trialEnd` is a genuinely
 * plausible epoch, and the two fields are coupled so one can never survive without the other.
 */
export function sanitizeStashTrial(
  trialActive: boolean,
  trialEnd: number | null,
): { trialActive: boolean; trialEnd: number | null } {
  const plausibleEnd = trialEnd !== null && isPlausibleTrialEnd(trialEnd) ? trialEnd : null;
  return { trialActive: trialActive === true && plausibleEnd !== null, trialEnd: plausibleEnd };
}

/**
 * Round 2 review — MAJOR-1 + MINOR-1.
 *
 * `StepBilling`'s submit handler used to route TWO genuinely different situations through the same
 * "you have not been charged" copy (`obBillErrIncomplete`):
 *
 *   - a 2xx response whose body doesn't parse into either successful receipt shape (MAJOR-1) — the
 *     gateway accepted the request, so a subscription may well have been created; this consumer
 *     simply cannot prove it either way.
 *   - an exception thrown by the `subscribe/complete` fetch call itself (MINOR-1) — a network
 *     drop or timeout AFTER the request reached the network carries the identical uncertainty, and
 *     `fetch()` throwing before anything was ever sent (offline, DNS failure, a CSP/extension
 *     block) is not distinguishable from here either, so both land on the same conservative side.
 *
 * Both are the same "we don't know" class the non-2xx branch already routes to `obBillErrUnknown`
 * (fix round 1, MAJOR-2) — asserting "not charged" here would repeat the exact defect that branch
 * exists to avoid. Only a failure BEFORE any request to our own gateway is sent (the earlier Stripe
 * confirmSetup step, untouched — it runs before this function is ever called) may keep the honest
 * not-charged copy.
 *
 * `classifySubscribeAttempt` is the one place that decision is made, so it can be pinned by a unit
 * test instead of read off JSX branches.
 */
export type SubscribeAttempt =
  | { phase: "response"; status: number; ok: boolean; receipt: SubscribeReceipt | null }
  | { phase: "exception" };

export type SubscribeOutcome =
  | { kind: "already" }
  | { kind: "trial"; trialEnd: number }
  | { kind: "active" }
  | { kind: "unknown" };

export function classifySubscribeAttempt(attempt: SubscribeAttempt): SubscribeOutcome {
  if (attempt.phase === "exception") return { kind: "unknown" };
  // The explicit "already subscribed" landing (fix round 1, MAJOR-2) — the card is already
  // attached, so this gets its own no-error landing, never a generic failure message.
  if (attempt.status === 409) return { kind: "already" };
  // Any other non-2xx, OR a 2xx whose body failed to parse, OR a 2xx that parsed but matched
  // neither successful shape: none of these can support a claim about money either way.
  if (!attempt.ok) return { kind: "unknown" };
  if (!attempt.receipt) return { kind: "unknown" };
  if (attempt.receipt.kind === "trial") return { kind: "trial", trialEnd: attempt.receipt.trialEnd };
  return { kind: "active" };
}

/**
 * Round 2 review — MINOR-2.
 *
 * `StepDone`'s purchase confirmation (`obDonePlanActive`) used to be suppressed whenever
 * `confirmPending` was true, while the trial confirmation line was not — so a charged no-trial
 * purchase by a user who hadn't yet confirmed their email reached Done with NO purchase
 * confirmation at all, only the "confirm your email" line.
 *
 * `planActivated` can only ever be set true by `billingPurchaseActive()` (OnboardingSheet), which
 * only fires once `classifySubscribeAttempt` above has resolved a completed POST to `{kind:
 * "active"}` — so, unlike the generic "ready" line (which must never claim "you're all set" while
 * confirmation is outstanding), it is trustworthy regardless of `confirmPending`.
 */
export type DoneBillingLine = "trial" | "planActive" | "ready" | null;

export function selectDoneBillingLine(opts: {
  trialActive: boolean;
  planActivated?: boolean;
  confirmPending: boolean;
}): DoneBillingLine {
  if (opts.trialActive) return "trial";
  if (opts.planActivated) return "planActive";
  if (opts.confirmPending) return null;
  return "ready";
}

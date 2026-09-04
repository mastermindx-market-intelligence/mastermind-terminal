/**
 * D7 — Terminal may only tell a user a paid trial started when billing authority supplied a valid
 * successful subscription receipt.
 *
 * The consumer checked `res.ok` and nothing else. It parsed whatever JSON arrived, took `trial_end`
 * if it happened to be a number, and called `onTrialStarted()` unconditionally — so the handoff's
 * counterexample, a bare
 *
 *     HTTP 200 {}
 *
 * was enough to reach "your trial is live", and StepDone then invented `now + 7 days` and printed
 * it as the first-charge date. A money surface claiming a subscription and naming a billing date on
 * the strength of an empty body.
 *
 * Today's authority is correct (Macro pins status="trialing" with a real id and a numeric end), so
 * this is a fail-closed guard, not a live-defect repair. That is exactly when it earns its keep: the
 * malformed case must be unmisreadable LATER, when nobody is looking at this code.
 */
import { describe, it, expect } from "vitest";
import { parseTrialReceipt } from "@/lib/billingReceipt";

const VALID = {
  status: "trialing",
  subscription_id: "sub_1QabcdEFGH",
  trial_end: 1_787_000_000,   // 2026-08-26T…Z, a plausible epoch in SECONDS
};

describe("D7 — the frozen successful-trial contract is accepted", () => {
  it("a complete receipt parses, and every field is carried through exactly", () => {
    const receipt = parseTrialReceipt(VALID);
    expect(receipt).toEqual({
      status: "trialing",
      subscriptionId: "sub_1QabcdEFGH",
      trialEnd: 1_787_000_000,
    });
  });

  it("extra fields the gateway may add do not break it", () => {
    expect(parseTrialReceipt({ ...VALID, customer_id: "cus_x", latest_invoice: null })).not.toBeNull();
  });
});

describe("D7 — a malformed 2xx is a FAILURE, not a started trial", () => {
  it("the handoff's counterexample: 200 {}", () => {
    expect(parseTrialReceipt({})).toBeNull();
  });

  it('200 {status:"trialing"} — status alone proves nothing', () => {
    expect(parseTrialReceipt({ status: "trialing" })).toBeNull();
  });

  it("a receipt missing the subscription id", () => {
    expect(parseTrialReceipt({ status: "trialing", trial_end: VALID.trial_end })).toBeNull();
  });

  it("a receipt missing the trial end", () => {
    expect(parseTrialReceipt({ status: "trialing", subscription_id: "sub_x" })).toBeNull();
  });

  it("an EMPTY or whitespace subscription id is not an id", () => {
    expect(parseTrialReceipt({ ...VALID, subscription_id: "" })).toBeNull();
    expect(parseTrialReceipt({ ...VALID, subscription_id: "   " })).toBeNull();
  });

  it("non-object bodies", () => {
    for (const body of [null, undefined, "", "trialing", 0, 42, [], [VALID], true]) {
      expect(parseTrialReceipt(body)).toBeNull();
    }
  });
});

describe("D7 — states that are NOT a started trial are never laundered into one", () => {
  // These are real Stripe subscription states. Each is a legitimate gateway answer and none of them
  // means "the 7-day trial began", so none may produce a trial receipt.
  for (const status of ["active", "incomplete", "incomplete_expired", "past_due", "canceled", "unpaid", "paused"]) {
    it(`status="${status}" is refused`, () => {
      expect(parseTrialReceipt({ ...VALID, status })).toBeNull();
    });
  }

  it("a missing or non-string status is refused", () => {
    expect(parseTrialReceipt({ subscription_id: "sub_x", trial_end: VALID.trial_end })).toBeNull();
    expect(parseTrialReceipt({ ...VALID, status: 1 })).toBeNull();
  });
});

describe("D7 — trial_end must be a plausible DATE, not merely a number", () => {
  it("rejects 0 and negatives (would render 1970)", () => {
    expect(parseTrialReceipt({ ...VALID, trial_end: 0 })).toBeNull();
    expect(parseTrialReceipt({ ...VALID, trial_end: -1 })).toBeNull();
  });

  it("rejects MILLISECONDS, which a bare typeof check would have accepted", () => {
    // 1_787_000_000_000 ms is the same instant as the valid value — but read as seconds it is the
    // year 58,600. This is the failure mode that makes `typeof x === "number"` insufficient on a
    // surface whose whole job is to name a billing date.
    expect(parseTrialReceipt({ ...VALID, trial_end: 1_787_000_000_000 })).toBeNull();
  });

  it("rejects NaN, Infinity and numeric strings", () => {
    expect(parseTrialReceipt({ ...VALID, trial_end: NaN })).toBeNull();
    expect(parseTrialReceipt({ ...VALID, trial_end: Infinity })).toBeNull();
    expect(parseTrialReceipt({ ...VALID, trial_end: "1787000000" })).toBeNull();
  });

  it("accepts the plausible window's edges", () => {
    expect(parseTrialReceipt({ ...VALID, trial_end: 1_577_836_800 })).not.toBeNull();  // 2020-01-01
    expect(parseTrialReceipt({ ...VALID, trial_end: 4_102_444_800 })).not.toBeNull();  // 2100-01-01
  });
});

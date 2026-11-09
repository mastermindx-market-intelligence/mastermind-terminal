import { describe, expect, it } from "vitest";
import { comparePlanScenarios } from "../optionsPlanScenarioCompare";
import { preparePlanExpiryRequest, readPlanPayoff } from "../optionsPlanPayoff";
import { draft, response } from "./fixtures/optionsPlanPayoff";
import type { OptionsPlanDraft } from "../optionsPlanDraft";

function verified(input: OptionsPlanDraft) {
  const prepared = preparePlanExpiryRequest(input);
  if (!prepared.ok) throw Error(prepared.reason);
  const raw = response(prepared.value);
  const premium = input.legs[0].assumptions.entry!.premium_per_unit;
  raw.curve.pnl = prepared.value.spots.map(spot => Math.max(spot - 765, 0) * 100 - premium * 100);
  raw.curve.cost = premium * 100;
  raw.curve.max_loss = -premium * 100;
  raw.curve.breakevens = [765 + premium];
  const payoff = readPlanPayoff(raw, prepared.value);
  if (!payoff) throw Error("invalid fixture result");
  return { draft: input, payoff };
}
function changedEntry(amount: number) {
  const revised = draft();
  revised.legs[0].assumptions.entry!.premium_per_unit = amount;
  return revised;
}
describe("qualified in-memory Plan comparison", () => {
  it("compares the actual shared 103-price grid without interpolating or using reference marks", () => {
    const result = comparePlanScenarios(verified(draft()), verified(changedEntry(4)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spots.length).toBeGreaterThanOrEqual(101);
    expect(result.referenceAsOf).toBe("2026-10-23");
    expect(result.deltaPnl.every(n => n === -200)).toBe(true);
    expect(result.sample).toEqual({ spot: 765, baselinePnl: -200, candidatePnl: -400, deltaPnl: -200 });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].entry).toEqual({ before: 2, after: 4 });
    expect(result.changes[0].changed).toBe(true);
  });
  it("retains signed P/L and returns zero difference for the identical hypothesis", () => {
    const result = comparePlanScenarios(verified(draft()), verified(draft()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deltaPnl.every(n => n === 0)).toBe(true);
      expect(result.changes.every(c => !c.changed)).toBe(true);
      expect(result.baselinePnl.some(n => n < 0)).toBe(true);
    }
  });
  it("keeps user-authored side and contracts explicit in changed-leg disclosure", () => {
    const revised = changedEntry(4);
    revised.legs[0].assumptions.side = "sell";
    revised.legs[0].assumptions.quantity = 3;
    const result = comparePlanScenarios(verified(draft()), verified(revised));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changes[0].side).toEqual({ before: "buy", after: "sell" });
      expect(result.changes[0].quantity).toEqual({ before: 1, after: 3 });
    }
  });
  it("refuses altered exact-leg identity even when the numeric price grid happens to coincide", () => {
    const a = verified(draft()), b = verified(draft());
    b.draft.legs[0].snapshot.identity.strike = 766;
    expect(comparePlanScenarios(a, b)).toEqual({ ok: false, reason: "invalid_result" });
  });
  it("refuses a change in immutable selected-observation basis", () => {
    const a = verified(draft()), b = verified(draft());
    (b.draft.legs[0].snapshot.row as Record<string, unknown>).mid = 9;
    expect(comparePlanScenarios(a, b)).toEqual({ ok: false, reason: "contract_changed" });
  });
  it("refuses changed source reference even with matching contracts and actual spots", () => {
    const a = verified(draft()), b = verified(draft());
    b.payoff.source_boundary.reference_sha256 = "f".repeat(64);
    expect(comparePlanScenarios(a, b)).toEqual({ ok: false, reason: "reference_changed" });
  });
  it("withholds a price-axis mismatch rather than interpolating a curve", () => {
    const a = verified(draft()), b = verified(draft());
    b.payoff.curve.spots[1] += 0.001;
    expect(comparePlanScenarios(a, b)).toEqual({ ok: false, reason: "invalid_result" });
  });
  it("refuses an invalid source response rather than treating it as a comparison", () => {
    const a = verified(draft()), b = verified(draft());
    b.payoff.source_boundary.current_quote_eligible = true as false;
    expect(comparePlanScenarios(a, b)).toEqual({ ok: false, reason: "invalid_result" });
  });
  it("does not silently accept a different original observed source date", () => {
    const a = verified(draft()), b = verified(draft());
    b.payoff.source_boundary.reference_observed_at = "2026-10-23T20:15:00Z";
    expect(comparePlanScenarios(a, b)).toEqual({ ok: false, reason: "reference_changed" });
  });
  it("does not infer a save, executable price, watch or persistent scenario", () => {
    const result = comparePlanScenarios(verified(draft()), verified(changedEntry(4)));
    expect(result.ok).toBe(true);
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(["saved", "orderId", "watchId", "currentQuote"]));
  });
});

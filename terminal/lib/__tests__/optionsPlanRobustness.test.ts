import { describe, expect, it } from "vitest";
import { draft, response } from "./fixtures/optionsPlanPayoff";
import { preparePlanExpiryRequest } from "../optionsPlanPayoff";
import { capturePlanExpiryObservation, comparePlanEntryAssumptions } from "../optionsPlanRobustness";

function fixture() {
  const input = draft(), request = preparePlanExpiryRequest(input);
  if (!request.ok) throw new Error("fixture");
  return { input, raw: response(request.value) };
}
function observe(value: ReturnType<typeof fixture>) {
  const result = capturePlanExpiryObservation(value.input, value.raw);
  if (!result) throw new Error("observation");
  return result;
}
describe("entry-only owner result comparison", () => {
  it("retains explicit entries and both owner outputs without pricing differences", () => {
    const before = fixture(), after = fixture();
    after.input.legs[0].assumptions.entry!.premium_per_unit = 4;
    after.raw.known_by = "2026-10-24T13:00:00Z";
    after.raw.curve.cost = 400;
    after.raw.curve.max_loss = -400;
    const comparison = comparePlanEntryAssumptions(observe(before), observe(after));
    expect(comparison.state).toBe("ready");
    if (comparison.state !== "ready") throw new Error("comparison");
    expect(comparison.baseline.result.curve.cost).toBe(200);
    expect(comparison.current.result.curve.cost).toBe(400);
    expect(comparison.current.result.curve.pnl).toEqual(after.raw.curve.pnl);
    expect(comparison.current.result.known_by).not.toBe(comparison.baseline.result.known_by);
  });
  it("does not retain caller aliases or allow mutation of admitted observations", () => {
    const value = fixture(), observation = observe(value);
    value.input.legs[0].assumptions.quantity = 5;
    value.raw.curve.cost = 999;
    expect(observation.request.draft.legs[0].assumptions.quantity).toBe(1);
    expect(observation.result.curve.cost).toBe(200);
    expect(Object.isFrozen(observation.result.curve.pnl)).toBe(true);
    expect(() => { observation.result.curve.pnl[0] = 0; }).toThrow();
  });
  it.each(["reference_sha256", "installed_observation_sha256", "reference_observed_at"] as const)("rejects changed %s", key => {
    const first = fixture(), next = fixture();
    next.raw.source_boundary[key] = key === "reference_observed_at" ? "2026-10-23T21:00:00Z" : "c".repeat(64);
    expect(comparePlanEntryAssumptions(observe(first), observe(next))).toEqual({ state: "unavailable", reason: "source" });
  });
  it.each(["side", "quantity"] as const)("rejects changed %s assumptions", key => {
    const first = fixture(), next = fixture();
    if (key === "side") next.input.legs[0].assumptions.side = "sell";
    else next.input.legs[0].assumptions.quantity = 2;
    expect(comparePlanEntryAssumptions(observe(first), observe(next))).toEqual({ state: "unavailable", reason: "contracts" });
  });
  it("rejects partial results, wrong grids and absent entry while retaining explicit zero", () => {
    const value = fixture();
    expect(capturePlanExpiryObservation(value.input, {})).toBeNull();
    value.raw.curve.spots = [1, 2];
    expect(capturePlanExpiryObservation(value.input, value.raw)).toBeNull();
    const zero = fixture();
    zero.input.legs[0].assumptions.entry!.premium_per_unit = 0;
    expect(observe(zero).request.draft.legs[0].assumptions.entry!.premium_per_unit).toBe(0);
    zero.input.legs[0].assumptions.entry = null;
    expect(capturePlanExpiryObservation(zero.input, zero.raw)).toBeNull();
  });
  it("refuses reconstructed objects instead of implying source authorization", () => {
    const observation = observe(fixture());
    expect(comparePlanEntryAssumptions(structuredClone(observation), observation)).toEqual({ state: "unavailable", reason: "observation" });
  });
});

import { describe, expect, it } from "vitest";
import { preparePlanExpiryRequest, readPlanPayoff } from "../optionsPlanPayoff";
import { draft, response } from "./fixtures/optionsPlanPayoff";

describe("exact Plan conditional expiry consumer", () => {
  it("does not turn a dated mark into entry, prices, or source evidence", () => {
    const d = draft(), result = preparePlanExpiryRequest(d);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.draft).toEqual(d);
    expect(result.value.draft.legs[0].assumptions.entry?.premium_per_unit).toBe(2);
    expect(result.value.draft.legs[0].snapshot.row.mid).toBe(3);
    expect(result.value.spots).toContain(765);
    expect(result.value.spots).toHaveLength(101);
    expect(Object.keys(result.value).sort()).toEqual(["draft", "payoff_basis", "schema", "spots"]);
    expect(readPlanPayoff(response(result.value), result.value)).not.toBeNull();
  });
  it("requires every authored assumption and one supported expiry", () => {
    const d = draft(); d.legs[0].assumptions.entry = null;
    expect(preparePlanExpiryRequest(d)).toMatchObject({ ok: false, reason: "assumptions" });
  });
  it.each(["curve", "clock", "quote", "digest", "expiry", "spots", "partial", "fake_terms"])("withholds malformed %s success", what => {
    const built = preparePlanExpiryRequest(draft()); if (!built.ok) throw new Error();
    const raw = response(built.value);
    if (what === "curve") raw.curve.pnl[0] = NaN;
    if (what === "clock") raw.source_boundary.reference_observed_at = "2026-10-24";
    if (what === "quote") Object.assign(raw.source_boundary, { current_quote_eligible: true });
    if (what === "digest") raw.source_boundary.reference_sha256 = "forged";
    if (what === "expiry") raw.contract_expirations = ["2026-11-06"];
    if (what === "spots") raw.curve.spots = [1, 2];
    if (what === "partial") Object.assign(raw, { reasons: [{ code: "TERMS_UNQUALIFIED", leg: 0 }] });
    if (what === "fake_terms") raw.source_boundary.terms = "caller_observation";
    expect(readPlanPayoff(raw, built.value)).toBeNull();
  });
});

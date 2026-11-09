import { expect, it } from "vitest";
import { adaptResearchVolatility } from "@/components/researchlab/researchVolatility";

export const volObservation = {
  schema: "options_hub.vol/v1", root: "SPY", asof: "2026-10-05",
  smile: [{ exp: "2026-10-09", points: [{ strike: 785, call_iv: 58.2, put_iv: 0 }] }],
};
export const provenance = {
  schema: "options_hub.vol.observation/v1", root: "SPY", source_session: "2026-10-05",
  iv_unit: "percent", source_value_field: "implied_vol", source_value_unit: "ratio",
  smile_value_fields: ["call_iv", "put_iv"], smile_aggregation: "mean_by_expiry_strike_side", smile_round_decimals: 4,
};
const read = (observation_provenance: unknown) => adaptResearchVolatility({ ...volObservation, observation_provenance }, "SPY");

it("keeps legacy published IV useful without inventing a quote or fitted-model contract", () => {
  const v = adaptResearchVolatility(volObservation, "SPY");
  expect(v.diagnostics).toMatchObject({ status: "raw_only", provenance: "legacy_schema", unit: "percent", sourceSession: "2026-10-05", issues: [] });
  expect(v.diagnostics.missing).toEqual(["product", "exercise_style", "quote_timestamp", "quote_condition", "expiry_timestamp", "forward", "discount_factor", "model", "support"]);
  expect(v.rows[0].ivRatio).toBeCloseTo(.582, 12); expect(v.rows[1].ivRatio).toBe(0);
  expect(v.fit).toBeNull(); expect(v.availableAt).toBeNull();
});
it("recognizes only the actual producer's declared mean/percent/rounding facts", () => {
  const v = read(provenance);
  expect(v.diagnostics).toMatchObject({ status: "raw_only", provenance: "producer_declared", unit: "percent", sourceSession: "2026-10-05", issues: [] });
  expect(v.rows[0].ivRatio).toBeCloseTo(.582, 12); expect(v.rows[1].ivRatio).toBe(0);
  expect(v.fit).toBeNull(); expect(v.diagnostics.missing).toHaveLength(9);
});
it.each(["ratio", "bp", null, undefined])("refuses incompatible or absent declared output units: %s", iv_unit => {
  const v = read({ ...provenance, iv_unit });
  expect(v.rows).toEqual([]); expect(v.status).toBe("unavailable");
  expect(v.diagnostics.status).toBe("inconsistent"); expect(v.diagnostics.unit).toBeNull();
  expect(v.diagnostics.issues).toContain("units_mismatch");
});
it.each([
  [{ ...provenance, root: "QQQ" }, "identity_mismatch"],
  [{ ...provenance, source_session: "2026-10-02" }, "session_mismatch"],
  [{ ...provenance, source_session: "2026-10-05T20:00:00Z" }, "session_mismatch"],
  [{ ...provenance, schema: "fit/admitted" }, "invalid_provenance"],
  [{ ...provenance, source_value_unit: "percent" }, "invalid_provenance"],
  [{ ...provenance, smile_aggregation: "latest_quote" }, "invalid_provenance"],
  [{ ...provenance, smile_round_decimals: 8 }, "invalid_provenance"],
  [{ ...provenance, smile_value_fields: ["bid_iv", "ask_iv"] }, "invalid_provenance"],
] as const)("withdraws inconsistent provenance without corrupting independently valid raw IV", (p, issue) => {
  const v = read(p);
  expect(v.diagnostics.status).toBe("inconsistent"); expect(v.diagnostics.provenance).toBe("invalid");
  expect(v.diagnostics.sourceSession).toBeNull(); expect(v.diagnostics.issues).toContain(issue);
  expect(v.rows[0].ivRatio).toBeCloseTo(.582, 12); expect(v.rows[1].ivRatio).toBe(0); expect(v.fit).toBeNull();
});
it.each([null, [], "admitted"])("malformed supplied provenance cannot qualify observations: %j", p => {
  const v = read(p); expect(v.diagnostics.provenance).toBe("invalid"); expect(v.diagnostics.status).toBe("inconsistent");
  expect(v.fit).toBeNull(); expect(v.diagnostics.missing).toHaveLength(9);
});
it("ignores fabricated model, quote and authority claims rather than promoting them", () => {
  const fake = { fit: { admitted: true }, qualified: true, product: "INDEX_OPTION", exercise_style: "EUROPEAN", quote_timestamp: "2026-10-05", forward: 785, model: "SVI", support: "all", may_display: true };
  const v = adaptResearchVolatility({ ...volObservation, ...fake, spot: 785, observation_provenance: { ...provenance, ...fake } }, "SPY");
  expect(v.diagnostics.status).toBe("raw_only"); expect(v.diagnostics.missing).toHaveLength(9);
  expect(v.fit).toBeNull(); expect(v.availableAt).toBeNull();
  expect(v.diagnostics).not.toHaveProperty("forward"); expect(v.diagnostics).not.toHaveProperty("model");
});
it.each(["2026-10-05T20:00:00Z", "2026-02-30", "0000-10-05"])("does not create observation or quote clocks from a malformed session: %s", asof => {
  const v = adaptResearchVolatility({ ...volObservation, asof, observation_provenance: { ...provenance, source_session: asof } }, "SPY");
  expect(v.diagnostics.sourceSession).toBeNull(); expect(v.diagnostics.issues).toContain("session_mismatch");
  expect(v.fit).toBeNull(); expect(v.availableAt).toBeNull();
});
it.each([null, { ...volObservation, root: "QQQ", observation_provenance: provenance }, { ...volObservation, schema: "not-vol" }])("does not expose metadata from an unavailable instrument", raw => {
  const v = adaptResearchVolatility(raw, "SPY");
  expect(v.rows).toEqual([]); expect(v.diagnostics.status).toBe("unavailable");
  expect(v.diagnostics.unit).toBeNull(); expect(v.diagnostics.sourceSession).toBeNull();
});

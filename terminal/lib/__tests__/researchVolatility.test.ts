import { expect, it } from "vitest";
import { adaptResearchVolatility } from "@/components/researchlab/researchVolatility";
const source = { schema: "options_hub.vol/v1", root: "SPY", asof: "2026-10-05", smile: [
  { exp: "2026-10-09", points: [{ strike: 785, call_iv: 58.2, put_iv: 0 }, { strike: 790, call_iv: null, put_iv: -1 }] },
] };
it("normalizes percent once, preserves zero and missing, and never claims a fitted model", () => {
  const result = adaptResearchVolatility(source, "SPY");
  expect(result.status).toBe("available");
  expect(result.session).toBe("2026-10-05");
  expect(result.rows[0].ivRatio).toBeCloseTo(.582, 12);
  expect(result.rows.slice(1).map(r => r.ivRatio)).toEqual([0, null, null]);
  expect(result.excluded.invalidMetric).toBe(1);
  expect(result.fit).toBeNull();
  expect(result.availableAt).toBeNull();
});
it.each([null, { ...source, root: "QQQ" }, { ...source, schema: "v2" }])("rejects an incompatible source", raw => {
  expect(adaptResearchVolatility(raw, "SPY").rows).toEqual([]);
});
it("excludes all duplicate coordinates, bad dates, bad strikes and nonfinite IVs with counts", () => {
  const result = adaptResearchVolatility({ ...source, smile: [
    { exp: "2026-10-09", points: [{ strike: 785, call_iv: 10 }, { strike: 785, call_iv: 20 }, { strike: 790, call_iv: Infinity }, { strike: 0, call_iv: 30 }] },
    { exp: "2026-02-30", points: [{ strike: 800, call_iv: 10 }] },
  ] }, "SPY");
  expect(result.rows).toHaveLength(2);
  expect(result.excluded).toEqual({ duplicate: 2, invalidIdentity: 2, invalidMetric: 1 });
});
it("does not substitute the matrix build date or fabricate a settlement time", () => {
  const result = adaptResearchVolatility({ ...source, asof: "unknown" }, "SPY");
  expect(result.session).toBeNull();
  expect(result.rows[0]).not.toHaveProperty("settlement");
});

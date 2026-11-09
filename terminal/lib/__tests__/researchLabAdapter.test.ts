import { describe, expect, it } from "vitest";
import { adaptResearchMatrix, filterResearchRows, reconcileResearchSelection, toggleComparison, buildResearchMarks, buildResearchDomain, ivPercentToRatio } from "@/components/researchlab/researchLabAdapter";

const cell = { strike: 785, expiry: "2026-10-09", gex: -42000, call_vol: 243000, put_vol: 0, call_oi: 110000, put_oi: null, delta_oi: { call: -10, put: null } };
const doc = (cells: unknown[] = [cell]) => ({ schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-10-06T02:00:00Z", _build_meta: { asof_date: "2026-10-05" }, spot: 774.77, cells });

describe("research matrix: source coordinates are not verified instruments", () => {
  it("keeps zero, null, negative change and aggregate exposure distinct", () => {
    const result = adaptResearchMatrix(doc(), "SPY");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ side: "call", volume: 243000, openInterest: 110000, deltaOi: -10 });
    expect(result.rows[1]).toMatchObject({ side: "put", volume: 0, openInterest: null, deltaOi: null });
    expect(result.rows[0]).not.toHaveProperty("gamma");
    expect(result.exposures[0].netGexDollars).toBe(-42000);
    expect(result.oiSession).toBeNull();
    expect(result.availableAt).toBeNull();
    expect(result.session).toBe("2026-10-05");
    expect(result.builtAt).toBe("2026-10-06T02:00:00Z");
  });
  it.each([null, {}, { ...doc(), root: "QQQ" }, { ...doc(), schema: "v2" }])("rejects incompatible envelopes", raw => {
    const result = adaptResearchMatrix(raw, "SPY");
    expect(result.rows).toEqual([]);
    expect(result.status).toBe("unavailable");
  });
  it("excludes every duplicate coordinate, not arbitrarily the first", () => {
    const r = adaptResearchMatrix(doc([cell, { ...cell, call_vol: 99 }]), "SPY");
    expect(r.rows).toEqual([]);
    expect(r.excluded.duplicate).toBe(2);
  });
  it("rejects impossible dates and nonfinite strikes and discloses invalid metrics", () => {
    const r = adaptResearchMatrix(doc([{ ...cell, expiry: "2026-02-30" }, { ...cell, strike: Infinity }, { ...cell, call_vol: -5, put_vol: NaN, call_oi: Infinity }]), "SPY");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].volume).toBeNull();
    expect(r.rows[1].volume).toBeNull();
    expect(r.excluded.invalidIdentity).toBe(2);
    expect(r.excluded.invalidMetric).toBe(3);
  });
  it("does not infer source session from build time", () => {
    expect(adaptResearchMatrix({ ...doc(), _build_meta: null }, "SPY").session).toBeNull();
  });
  it.each([
    { session: "2026-10-05", _build_meta: undefined },
    { session: "2026-10-05", _build_meta: null },
    { session: "2026-10-05", _build_meta: {} },
    { session: "2026-10-05", _build_meta: { asof_date: null } },
    { session: "2026-10-05", _build_meta: { asof_date: "2026-10-05" } },
    { session: null, _build_meta: { asof_date: "2026-10-05" } },
  ])("reads source-qualified session metadata without inferring build/availability time: %j", metadata => {
    // Exercise the JSON wire boundary: undefined properties are absent on the wire.
    const result = adaptResearchMatrix(JSON.parse(JSON.stringify({ ...doc(), ...metadata })), "SPY");
    expect(result.status).toBe("available");
    expect(result.rows).toHaveLength(2);
    expect(result.session).toBe("2026-10-05");
    expect(result.builtAt).toBe("2026-10-06T02:00:00Z");
    expect(result.availableAt).toBeNull();
  });
  it.each([
    { session: "2026-10-04" },
    { session: "2026-02-30" },
    { session: "2026-10-05T20:00:00Z" },
    { session: "2026-10-05\n" },
    { session: "" },
    { session: 20261005 },
    { session: "2026-10-05", _build_meta: { asof_date: "invalid" } },
    { session: "2026-10-05", _build_meta: [] },
    { _build_meta: { asof_date: "2026-02-30" } },
  ])("refuses malformed or conflicting sessions instead of relabeling rows: %j", metadata => {
    const result = adaptResearchMatrix({ ...doc(), ...metadata }, "SPY");
    expect(result.status).toBe("unavailable");
    expect(result.rows).toEqual([]);
    expect(result.exposures).toEqual([]);
    expect(result.session).toBeNull();
  });
  it.each([
    { session: undefined, _build_meta: undefined },
    { session: null, _build_meta: null },
    { session: null, _build_meta: { asof_date: null } },
  ])("keeps undated source values readable when both clocks are genuinely absent: %j", metadata => {
    const result = adaptResearchMatrix(JSON.parse(JSON.stringify({ ...doc(), ...metadata })), "SPY");
    expect(result.status).toBe("available");
    expect(result.rows).toHaveLength(2);
    expect(result.session).toBeNull();
  });
  it("preserves a pinned row outside filters and drops it after source/root withdrawal", () => {
    const r = adaptResearchMatrix(doc(), "SPY");
    const selection = { selected: r.rows[0].key, comparisons: r.rows.map(x => x.key) };
    expect(filterResearchRows(r.rows, { side: "put", expiry: "all" })).toHaveLength(1);
    expect(reconcileResearchSelection(selection, r.rows)).toEqual(selection);
    expect(reconcileResearchSelection(selection, adaptResearchMatrix({ ...doc(), root: "QQQ" }, "QQQ").rows)).toEqual({ selected: null, comparisons: [] });
    expect(reconcileResearchSelection(selection, [])).toEqual({ selected: null, comparisons: [] });
  });
  it("caps explicit comparisons at three", () => {
    expect(toggleComparison(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleComparison(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
  it("keeps identity after reorder and zero in the table but not as positive geometry", () => {
    const r = adaptResearchMatrix(doc(), "SPY");
    const marks = buildResearchMarks([...r.rows].reverse(), "volume");
    expect(marks).toHaveLength(1);
    expect(marks[0].key).toBe(r.rows[0].key);
    expect(marks[0].value).toBe(243000);
    expect(marks[0].side).toBe("call");
    expect(buildResearchMarks(r.rows, "deltaOi")[0].value).toBe(-10);
  });
  it("does not render an all-null metric as a field of zeroes", () => {
    const r = adaptResearchMatrix(doc([{ ...cell, call_vol: null, put_vol: null }]), "SPY");
    expect(buildResearchMarks(r.rows, "volume")).toEqual([]);
  });
  it("keeps full-source magnitude and axes when a filtered comparison excludes the largest point", () => {
    const rows = adaptResearchMatrix(doc([cell, { ...cell, strike: 800, expiry: "2026-10-16", call_vol: 1000000 }]), "SPY").rows;
    const domain = buildResearchDomain(rows, "volume");
    expect(domain).toEqual({ minStrike: 785, maxStrike: 800, maxValue: 1000000, expiries: ["2026-10-09", "2026-10-16"], maxDiameter: 34 });
    const filtered = filterResearchRows(rows, { side: "call", expiry: "2026-10-09" });
    expect(buildResearchMarks(filtered, "volume")[0].value / domain.maxValue).toBe(.243);
    expect(ivPercentToRatio(58.2, "percent")).toBeCloseTo(.582, 12);
    expect(ivPercentToRatio(.582, "ratio" as never)).toBeNull();
  });
  it("bounds dense-chain pixel overdraw without removing row identities", () => {
    const rows = adaptResearchMatrix(doc(Array.from({ length: 10000 }, (_,i) => ({ ...cell, strike: i+1 }))), "SPY").rows;
    expect(rows).toHaveLength(20000);
    expect(buildResearchDomain(rows, "volume").maxDiameter).toBe(12);
    expect(buildResearchMarks(rows, "deltaOi")).toHaveLength(10000);
  });
});

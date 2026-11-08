import { describe, expect, it } from "vitest";
import { projectProphetIntelligence, projectCycleIntelligence, decodeProphetIntelligence, decodeCycleIntelligence } from "../shared-shell/intelligencePayloads";
const prophet = () => ({ schema: "prophet.index/v1", asof: "2026-11-02", source_asof: "2026-10-30", source_unknown: false,
  source_delayed: false, source_mixed_vintage: false, authority_tier: "display", gate_go: false, open_count: 1, active_count: 99,
  plans: [{ id: "OLD", asset: "OLD", closed: true, phase: "invalidated" },
    { id: "NVDA-BULL-20260917", asset: "NVDA", closed: false, phase: "triggered_pre_t1", price_basis_date: "2026-09-25", plan_asof: "2026-09-26" }] });
const cycles = () => ({ receipt: { source: "history", path: "/sectordata/sector_cycles.json", status: "ready", asOf: "2026-10-30", stale: false },
  data: { meta: { asOf: "2026-10-30", n_sectors: 1, benchmark: "SPY" }, sectors: [
    { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "Technology ZH", now: { phase: "Downturn", pos: 41, phase_v2: "Downturn", pos_v2: 96.62 }, price: new Array(5000).fill({ v: 100 }) },
  ] } });
describe("bounded intelligence projections", () => {
  it("keeps Prophet publication, source, and plan price clocks separate; never uses active_count for open plans", () => {
    const result = projectProphetIntelligence(prophet())!;
    expect(result.publishedAt).toBe("2026-11-02"); expect(result.sourceAsOf).toBe("2026-10-30");
    expect(result.openCount).toBe(1); expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({ symbol: "NVDA", priceAsOf: "2026-09-25" });
    expect(result).not.toHaveProperty("gate_go"); expect(result).not.toHaveProperty("active_count");
    expect(decodeProphetIntelligence(result)).toEqual(result);
  });
  it("preserves the owner's order, limits the preview, and never converts missing closed flags into open", () => {
    const p = prophet(); p.open_count = 10; p.plans = Array.from({ length: 10 }, (_, i) => ({ id: `P${i}`, asset: `A${i}`, closed: false, phase: "pre_trigger", price_basis_date: "2026-10-01", plan_asof: "2026-10-02" }));
    expect(projectProphetIntelligence(p)!.plans.map(p => p.id)).toEqual(["P0", "P1", "P2"]);
    const missing = { ...p, plans: [{ id: "P1", asset: "NVDA", phase: "pre_trigger" }], open_count: undefined };
    expect(projectProphetIntelligence(missing)).toBeNull();
  });
  it("does not manufacture an empty result or fresh source from malformed or unknown inputs", () => {
    expect(projectProphetIntelligence({ ...prophet(), plans: null })).toBeNull();
    expect(projectProphetIntelligence({ ...prophet(), schema: "other" })).toBeNull();
    expect(projectProphetIntelligence({ ...prophet(), plans: [], open_count: 1 })).toBeNull();
    expect(projectProphetIntelligence({ ...prophet(), plans: [], open_count: 0 })!.plans).toEqual([]);
    expect(projectProphetIntelligence({ ...prophet(), source_unknown: true })!.sourceAsOf).toBeNull();
    expect(projectProphetIntelligence({ ...prophet(), source_asof: "2026-02-30" })!.sourceAsOf).toBeNull();
    expect(projectProphetIntelligence({ ...prophet(), stale: true })!.stale).toBe(true);
  });
  it("projects canonical cycle fields without copying histories or confusing relative-strength coordinates", () => {
    const value = projectCycleIntelligence(cycles())!;
    expect(value.rows[0]).toMatchObject({ ticker: "XLK", phase: "Downturn", position: 41, model: "published" });
    expect(JSON.stringify(value).length).toBeLessThan(1600); expect(value.rows[0]).not.toHaveProperty("price");
    expect(decodeCycleIntelligence(value)).toEqual(value);
  });
  it("does not promote v2 diagnostics or backfill an absent published position, and distinguishes unavailable fields from numeric zero", () => {
    const source = cycles(); const now: Record<string, unknown> = source.data.sectors[0].now; delete now.pos;
    expect(projectCycleIntelligence(source)!.rows[0].position).toBeNull();
    now.pos = 0; expect(projectCycleIntelligence(source)!.rows[0].position).toBe(0);
    now.pos = 101; expect(projectCycleIntelligence(source)!.rows[0].position).toBeNull();
  });
  it("refuses wrong source, clock mismatch, impossible coverage and empty nonzero source", () => {
    const source = cycles();
    expect(projectCycleIntelligence({ ...source, receipt: { ...source.receipt, source: "relative_trend" } })).toBeNull();
    expect(projectCycleIntelligence({ ...source, receipt: { ...source.receipt, status: "access" } })).toBeNull();
    expect(projectCycleIntelligence({ ...source, receipt: { ...source.receipt, asOf: "2026-11-01" } })).toBeNull();
    expect(projectCycleIntelligence({ ...source, data: { ...source.data, sectors: [] } })).toBeNull();
  });
  it("decoders reject malformed summaries and arbitrary destinations", () => {
    const value = projectProphetIntelligence(prophet())!;
    expect(decodeProphetIntelligence({ ...value, plans: [{ ...value.plans[0], symbol: "javascript:alert(1)" }] })).toBeNull();
    expect(decodeCycleIntelligence({ schema: "mmx.intelligence.cycles.v1", rows: [] })).toBeNull();
  });
});
describe("intelligence summary coherence", () => {
  it("rejects a summary whose preview contradicts its published count", () => {
    const value = projectProphetIntelligence(prophet())!;
    expect(decodeProphetIntelligence({ ...value, openCount: 0 })).toBeNull();
    expect(decodeProphetIntelligence({ ...value, openCount: 4 })).toBeNull();
    expect(decodeProphetIntelligence({ ...value, openCount: 2, plans: [] })).toBeNull();
    expect(decodeProphetIntelligence({ ...value, openCount: 0, plans: [] })).not.toBeNull();
  });
  it("rejects duplicate plan identities without ranking or reordering the source", () => {
    const source = prophet();
    const plan = source.plans[1];
    source.plans = [plan, { ...plan, asset: "MSFT" }]; source.open_count = 2;
    expect(projectProphetIntelligence(source)).toBeNull();
    const value = projectProphetIntelligence(prophet())!;
    expect(decodeProphetIntelligence({ ...value, openCount: 2,
      plans: [value.plans[0], { ...value.plans[0], symbol: "MSFT" }] })).toBeNull();
  });
  it("does not accept a known source date and an unknown-date flag together", () => {
    const value = projectProphetIntelligence(prophet())!;
    expect(decodeProphetIntelligence({ ...value, sourceUnknown: true })).toBeNull();
    expect(decodeProphetIntelligence({ ...value, sourceAsOf: null })).toBeNull();
    expect(decodeProphetIntelligence({ ...value, sourceAsOf: null, sourceUnknown: true })).not.toBeNull();
  });
  it("rejects duplicate sector identities even when their ticker strings differ", () => {
    const source = cycles(); source.data.meta.n_sectors = 2;
    source.data.sectors.push({ ...source.data.sectors[0], ticker: "XLE" });
    expect(projectCycleIntelligence(source)).toBeNull();
    const value = projectCycleIntelligence(cycles())!;
    expect(decodeCycleIntelligence({ ...value, coverage: 2,
      rows: [value.rows[0], { ...value.rows[0], ticker: "XLE" }] })).toBeNull();
  });
  it.each(["../energy", "XLK", "energy space", "?sector=xlk"])("rejects sector IDs the incumbent URL reader cannot preserve: %s", id => {
    const source = cycles(); source.data.sectors[0].id = id;
    expect(projectCycleIntelligence(source)).toBeNull();
    const value = projectCycleIntelligence(cycles())!;
    expect(decodeCycleIntelligence({ ...value, rows: [{ ...value.rows[0], id }] })).toBeNull();
  });
});

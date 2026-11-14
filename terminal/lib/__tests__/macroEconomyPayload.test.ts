import { describe, expect, it } from "vitest";
import fs from "node:fs";

import path from "node:path";
import { ECONOMIC_WORKSPACES, economicSelection, economicSelectionSearch, economicSourceIds, macroEconomyPayload, type EconomicWorkspaceId } from "../shared-shell/macroEconomyPayload";

// Real producer/view shapes from synthetic collector fixtures. No production
// market observations or authenticated responses are represented by this file.
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/macro_economy_views.json"), "utf8"));
const fixture = (id: EconomicWorkspaceId = "rates_curves") => structuredClone(fixtures[id]);
const payrollFixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/macro_payroll_revisions.json"), "utf8"));

describe("native economic publication boundary", () => {
  it("keeps source bindings and full component calculations tied to the accepted publication", () => {
    const result = macroEconomyPayload(fixture("liquidity_regime"), "liquidity_regime")!;
    if (result.selected_workspace.state !== "ready") throw Error("fixture");
    const rows = result.selected_workspace.view.drivers.flatMap(group => group.rows);
    expect(rows.find(row => row.driver_id === "nfci_pctile")?.source_binding).toMatchObject({ state: "bound", input_kind: "component", source_refs: ["nfci"] });
    expect(rows.find(row => row.driver_id === "nfci_pctile")?.calculation?.weight).toBe("0.30");
    expect(rows.find(row => row.driver_id === "rates_scare_score")?.source_binding).toMatchObject({ state: "unlinked", reason: "source_mapping_absent", source_refs: [] });
  });

  it.each([
    ["crossed method", (v: any, row: any) => { row.source_binding.method_version = "other.compose.v1"; }],
    ["unknown source", (v: any, row: any) => { row.source_binding.source_refs = ["not-published"]; }],
    ["duplicate source", (v: any, row: any) => { row.source_binding.source_refs.push("nfci"); }],
    ["crossed component", (v: any, row: any) => { row.source_binding.input_id = "ofr_fsi_pctile"; }],
    ["missing input kind", (v: any, row: any) => { row.source_binding.input_kind = null; }],
    ["false unlinked state", (v: any, row: any) => { row.source_binding.state = "unlinked"; row.source_binding.reason = "source_mapping_absent"; }],
    ["crossed calculation axis", (v: any, row: any) => { row.calculation.axis_id = "other"; }],
    ["crossed calculation value", (v: any, row: any) => { row.calculation.raw = { en: "99", zh: "99" }; }],
    ["crossed component weight", (v: any, row: any) => { row.calculation.weight = "0.99"; }],
    ["duplicate component", (v: any, row: any) => { v.axes[0].components.push(structuredClone(v.axes[0].components[0])); }],
    ["component repeated across axes", (v: any, row: any) => { v.axes[1].components.push(structuredClone(v.axes[0].components[0])); }],
    ["duplicate driver", (v: any, row: any) => { v.drivers[1].rows.push(structuredClone(row)); }],
  ] as const)("rejects driver %s", (_name, mutate) => {
    const value = fixture("liquidity_regime"), view = value.selected_workspace.view;
    const row = view.drivers.flatMap((group: any) => group.rows).find((row: any) => row.driver_id === "nfci_pctile");
    mutate(view, row);
    expect(macroEconomyPayload(value, "liquidity_regime")).toBeNull();
  });

  it("reads older driver views without inventing source or calculation bindings", () => {
    const value = fixture("liquidity_regime");
    for (const group of value.selected_workspace.view.drivers) for (const row of group.rows) {
      delete row.source_binding; delete row.calculation;
    }
    expect(macroEconomyPayload(value, "liquidity_regime")).not.toBeNull();
  });

  it("refuses a driver binding crossed to another existing metric", () => {
    const value = fixture("financial_conditions"), view = value.selected_workspace.view;
    const row = view.drivers.flatMap((group: any) => group.rows).find((row: any) => row.driver_id === "hy_oas_z_credit_leg");
    row.source_binding.input_id = "nfci";
    expect(macroEconomyPayload(value, "financial_conditions")).toBeNull();
  });

  it("binds real producer payroll revision rows to their metric and cohort receipts", () => {
    const result = macroEconomyPayload(payrollFixture(), "labor_markets");
    expect(result?.selected_workspace.state).toBe("ready");
    if (result?.selected_workspace.state !== "ready") throw Error("payroll fixture");
    const revisions = result.selected_workspace.view.payroll_revisions!;
    expect(revisions.status).toBe("partial");
    expect(revisions.rows.find(row => row.period === "2025-01-01")).toMatchObject({ earliest_change: 57, selected_change: 30, net_revision: -27, earliest_vintage: "2025-02-07", selected_vintage: "2025-03-07" });
    expect(result.selected_workspace.view.metrics.find(row => row.metric_id === "payrolls_nfp_change_and_revision")?.value_raw).toBeNull();
  });

  it.each([
    ["unbound source", (v: any) => { v.evidence.sources = v.evidence.sources.filter((row: any) => !row.source_id.startsWith("revision:")); }],
    ["wrong source digest", (v: any) => { v.payroll_revisions.source_digest = "f".repeat(64); }],
    ["crossed metric", (v: any) => { v.metrics.find((row: any) => row.metric_id === "payroll_revision:2025-01-01:net_revision").value_raw = -26; }],
    ["wrong unit", (v: any) => { v.payroll_revisions.unit = "persons"; }],
    ["future vintage", (v: any) => { v.payroll_revisions.rows[0].selected_vintage = "2030-01-01"; }],
    ["future collection", (v: any) => { v.payroll_revisions.collected_at = "2030-01-01T00:00:00Z"; }],
    ["false ready state", (v: any) => { v.payroll_revisions.status = "ready"; }],
    ["false zero for missing arithmetic", (v: any) => { v.payroll_revisions.rows[0].net_revision = 0; }],
    ["missing role", (v: any) => { delete v.payroll_revisions.rows[0].metric_ids.earliest_change; }],
    ["duplicate period", (v: any) => { v.payroll_revisions.rows[1].period = v.payroll_revisions.rows[0].period; }],
    ["invalid month", (v: any) => { v.payroll_revisions.rows[0].period = "2025-02-30"; }],
    ["hidden revision view", (v: any) => { delete v.payroll_revisions; }],
  ] as const)("refuses payroll %s", (_name, mutate) => {
    const fixture = payrollFixture(); mutate(fixture.selected_workspace.view);
    expect(macroEconomyPayload(fixture, "labor_markets")).toBeNull();
  });
  it.each(Object.keys(ECONOMIC_WORKSPACES) as EconomicWorkspaceId[])("reads the actual %s producer shape", id => {
    const result = macroEconomyPayload(fixture(id), id);
    expect(result?.selected_workspace.workspace_id).toBe(id);
    expect(result?.selected_workspace.state).toBe("ready");
  });

  it("preserves the zero-axis policy model and source-owned driver impact", () => {
    const read = macroEconomyPayload(fixture("monetary_policy"), "monetary_policy")!;
    if (read.selected_workspace.state !== "ready") throw Error("fixture");
    expect(read.selected_workspace.view.axes).toHaveLength(0);
    const driver = read.selected_workspace.view.drivers[0].rows[0];
    expect(driver.impact).toBeNull();
    expect(driver.impact_sign).toBeNull();
  });

  it.each([
    ["selected workspace", (v: any) => { v.selected_workspace.workspace_id = "inflation_system"; }],
    ["view workspace", (v: any) => { v.selected_workspace.view.workspace.id = "inflation_system"; }],
    ["region", (v: any) => { v.selected_workspace.region = "CN"; }],
    ["generation", (v: any) => { v.selected_workspace.view.evidence.generation.generation_id = "other"; }],
    ["semantic digest", (v: any) => { v.selected_workspace.view.evidence.generation.content_sha256 = "f".repeat(64); }],
    ["artifact bytes", (v: any) => { v.selected_workspace.view.evidence.artifact.bytes += 1; }],
    ["artifact path", (v: any) => { v.selected_workspace.artifact.path = "../../other.json"; }],
    ["unqualified root", (v: any) => { v.source.served_root_qualified = false; }],
    ["authority", (v: any) => { v.selected_workspace.view.evidence.authority.flags[0].value = true; }],
  ] as const)("rejects crossed %s", (_name, mutate) => {
    const v = fixture(); mutate(v);
    expect(macroEconomyPayload(v, "rates_curves")).toBeNull();
  });

  it.each([
    ["NaN", (p: any[]) => { p[0].v = NaN; }],
    ["infinite value", (p: any[]) => { p[0].v = Infinity; }],
    ["formatted numeric string", (p: any[]) => { p[0].v = "3.50"; }],
    ["duplicate date", (p: any[]) => { p[1].t = p[0].t; }],
    ["invalid date", (p: any[]) => { p[0].t = "2026-02-30"; }],
    ["out-of-order date", (p: any[]) => { p.reverse(); }],
  ] as const)("rejects %s in chart coordinates", (_name, mutate) => {
    const v = fixture(); mutate(v.selected_workspace.view.series.entries[0].points);
    expect(macroEconomyPayload(v, "rates_curves")).toBeNull();
  });

  it("retains missing observations and rejects inconsistent history summaries", () => {
    const v = fixture("inflation_system"), entries = v.selected_workspace.view.series.entries;
    expect(entries.some((row: any) => row.points.some((p: any) => p.v === null))).toBe(true);
    expect(macroEconomyPayload(v, "inflation_system")).not.toBeNull();
    entries[0].count += 1;
    expect(macroEconomyPayload(v, "inflation_system")).toBeNull();
  });

  it("keeps legacy metadata-only publications useful without inventing points", () => {
    const v = fixture();
    for (const row of v.selected_workspace.view.series.entries) delete row.points;
    for (const row of v.selected_workspace.view.curve_hero.tenors) delete row.source_binding;
    const result = macroEconomyPayload(v, "rates_curves")!;
    if (result.selected_workspace.state !== "ready") throw Error("fixture");
    expect(result.selected_workspace.view.series.entries[0].points).toBeNull();
    expect(result.selected_workspace.view.metrics.length).toBeGreaterThan(0);
  });

  it.each([
    ["missing maturity slot", (c: any) => { c.tenors.pop(); }],
    ["undated current value", (c: any) => { c.tenors[0].as_of_tenor = null; }],
    ["undated comparison", (c: any) => { c.tenors[0].prior_close_as_of = null; }],
    ["non-prior date", (c: any) => { c.tenors[0].prior_close_as_of = c.tenors[0].as_of_tenor; }],
    ["short month comparison", (c: any) => { c.tenors[0].prior_month_as_of = c.tenors[0].prior_close_as_of; }],
    ["false usable status", (c: any) => { c.ok = false; }],
  ] as const)("rejects curve %s", (_name, mutate) => {
    const v = fixture(); mutate(v.selected_workspace.view.curve_hero);
    expect(macroEconomyPayload(v, "rates_curves")).toBeNull();
  });

  it("suppresses old undated comparisons while retaining dated current values", () => {
    const v = fixture();
    for (const row of v.selected_workspace.view.curve_hero.tenors) { delete row.prior_close_as_of; delete row.prior_month_as_of; delete row.source_binding; }
    const result = macroEconomyPayload(v, "rates_curves")!;
    if (result.selected_workspace.state !== "ready") throw Error("fixture");
    expect(result.selected_workspace.view.curve_hero!.tenors[0].today).not.toBeNull();
    expect(result.selected_workspace.view.curve_hero!.tenors[0].prior_close).toBeNull();
  });

  it("resolves legacy FRED references only through a unique exact source artifact", () => {
    const sources = fixture().selected_workspace.view.evidence.sources;
    expect(economicSourceIds(["FRED:DGS10"], sources)).toEqual(["dgs10"]);
    expect(economicSourceIds(["FRED:UNKNOWN"], sources)).toEqual([]);
    const dgs10 = sources.find((row: any) => row.source_id === "dgs10");
    expect(economicSourceIds(["FRED:DGS10"], [...sources, { ...dgs10, source_id: "ambiguous" }])).toEqual([]);
  });
});

describe("economic study URL", () => {
  it("round-trips exact curve, chart, observation and evidence state while keeping shell context", () => {
    const search = economicSelectionSearch("market=us&returnTo=macro", { task: "history", series: "history:fred:CPIAUCSL", window: "published", observation: "2026-09-01", display: "table", evidence: "history:fred:CPIAUCSL", tenor: "2y", comparison: "prior_month" });
    const selected = economicSelection(new URLSearchParams(search));
    expect(selected).toEqual({ task: "history", series: "history:fred:CPIAUCSL", window: "published", observation: "2026-09-01", display: "table", evidence: "history:fred:CPIAUCSL", tenor: "2y", comparison: "prior_month" });
    expect(new URLSearchParams(search).get("market")).toBe("us");
    expect(new URLSearchParams(search).get("returnTo")).toBe("macro");
    const closed = new URLSearchParams(economicSelectionSearch(search, { evidence: null }));
    expect(economicSelection(closed)).toEqual({ ...selected, evidence: null });
  });
  it.each(["study=unknown", "series=x&series=y", "observation=2026-02-30", "window=forever", "display=raw", "tenor=100y", "comparison=prior_close&comparison=prior_month", "evidence=../../secret"])("refuses invalid selection %s", value => {
    expect(economicSelection(new URLSearchParams(value))).toBeNull();
  });
});


describe("exact Treasury curve attribution", () => {
  const bound = () => {
    const value = fixture(), view = value.selected_workspace.view;
    return { value, view, row: view.curve_hero.tenors.find((row: any) => row.tenor === "10y"), series: view.series.entries.find((row: any) => row.series_id === "us10y"), source: view.evidence.sources.find((row: any) => row.source_id === "dgs10") };
  };
  it("accepts bindings regenerated by the canonical composer without changing observations", () => {
    const { value } = bound(), result = macroEconomyPayload(value, "rates_curves")!;
    expect(result).not.toBeNull();
    if (result.selected_workspace.state !== "ready") throw Error("fixture");
    expect(result.selected_workspace.view.curve_hero!.tenors.find(row => row.tenor === "10y")).toMatchObject({
      today: 3.743, as_of_tenor: "2026-11-13", prior_month: 3.677, prior_month_as_of: "2026-10-14",
      source_binding: { series_id: "us10y", source_ref: "FRED:DGS10", source_id: "dgs10" },
    });
  });
  it.each(["omitted", "null"] as const)("keeps %s provenance readable without inventing a binding", mode => {
    const { value, view } = bound();
    for (const row of view.curve_hero.tenors) { if (mode === "omitted") delete row.source_binding; else row.source_binding = null; }
    expect(macroEconomyPayload(value, "rates_curves")).not.toBeNull();
  });
  it.each([
    ["source swap", ({ row }: any) => { row.source_binding.source_id = "dgs2"; }],
    ...["all", "metric:us2y_level", "driver:us2y", "FRED:DGS2"].map(id => ["source/control collision " + id, ({ row, source }: any) => { source.source_id = id; row.source_binding.source_id = id; }] as const),
    ["unsafe precision range", ({ series }: any) => { series.points[0].v = 1e15; }],
    ["series swap", ({ row }: any) => { row.source_binding.series_id = "us2y"; }],
    ["reference swap", ({ row }: any) => { row.source_binding.source_ref = "FRED:DGS2"; }],
    ["wrong artifact", ({ source }: any) => { source.artifact_ref = "data/fred/DGS2.parquet"; }],
    ["direct-ID artifact trap", ({ row, source }: any) => { source.source_id = "FRED:DGS10"; source.artifact_ref = "data/fred/DGS2.parquet"; row.source_binding.source_id = "FRED:DGS10"; }],
    ["duplicate artifact", ({ view, source }: any) => { view.evidence.sources.push({ ...structuredClone(source), source_id: "second-disclosure" }); }],
    ["duplicate series alias", ({ view, series }: any) => { view.series.entries.push({ ...structuredClone(series), series_id: "DGS10" }); }],
    ["wrong unit", ({ series }: any) => { series.unit_token = "basis_points"; }],
    ["wrong basis", ({ series }: any) => { series.basis_token = "other"; }],
    ["unqualified method", ({ view }: any) => { view.headline.method_version = "rates_curves.compose.v2"; }],
    ["wrong latest value", ({ row }: any) => { row.today += .0001; }],
    ["wrong latest date", ({ row }: any) => { row.as_of_tenor = "2026-11-14"; }],
    ["wrong previous value", ({ row }: any) => { row.prior_close += .0001; }],
    ["same value wrong previous date", ({ row }: any) => { row.prior_close_as_of = "2026-11-11"; }],
    ["wrong month value", ({ row }: any) => { row.prior_month += .0001; }],
    ["same value wrong month date", ({ row }: any) => { row.prior_month_as_of = "2026-10-13"; }],
    ["wrong delta", ({ row }: any) => { row.delta_month += .0001; }],
    ["hidden comparison date", ({ row }: any) => { delete row.prior_close_as_of; }],
    ["missing coordinates", ({ series }: any) => { delete series.points; }],
    ["extra coordinate precision", ({ series }: any) => { series.points[0].v += .00001; }],
    ["source period mismatch", ({ source }: any) => { source.clocks.find((clock: any) => clock.key === "reference_period").value = "2026-11-12"; }],
    ["duplicate source period", ({ source }: any) => { source.clocks.push(structuredClone(source.clocks.find((clock: any) => clock.key === "reference_period"))); }],
    ["malformed binding", ({ row }: any) => { row.source_binding = "dgs10"; }],
    ["unexpected binding key", ({ row }: any) => { row.source_binding.label = "10-year"; }],
  ] as const)("rejects asserted %s", (_name, mutate) => {
    const example = bound(); mutate(example);
    expect(macroEconomyPayload(example.value, "rates_curves")).toBeNull();
  });
  it("rejects a crossed source even when another maturity has identical values and dates", () => {
    const { value, view, row, series } = bound();
    for (const tenor of view.curve_hero.tenors) if (tenor !== row) delete tenor.source_binding;
    const other = view.series.entries.find((entry: any) => entry.series_id === "us2y");
    Object.assign(other, { points: structuredClone(series.points), count: series.count, first: series.first, last: series.last });
    row.source_binding.source_id = "dgs2";
    expect(macroEconomyPayload(value, "rates_curves")).toBeNull();
  });
  it("keeps negative four-decimal coordinates and exact integer-unit differences valid", () => {
    const { value, row, series } = bound();
    for (const point of series.points) if (point.v !== null) point.v = Number((point.v - 4).toFixed(4));
    row.today = -.257; row.prior_close = -.26; row.prior_month = -.323;
    row.delta_close = .003; row.delta_month = .066;
    expect(macroEconomyPayload(value, "rates_curves")).not.toBeNull();
    row.delta_close = .00305; // No rounding of a new half-unit assertion.
    expect(macroEconomyPayload(value, "rates_curves")).toBeNull();
  });
});


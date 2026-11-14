import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ECONOMIC_WORKSPACES, economicSelection, economicSelectionSearch, economicSourceIds, macroEconomyPayload, type EconomicWorkspaceId } from "../shared-shell/macroEconomyPayload";

// Real producer/view shapes from synthetic collector fixtures. No production
// market observations or authenticated responses are represented by this file.
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/macro_economy_views.json"), "utf8"));
const fixture = (id: EconomicWorkspaceId = "rates_curves") => structuredClone(fixtures[id]);

describe("native economic publication boundary", () => {
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
    for (const row of v.selected_workspace.view.curve_hero.tenors) { delete row.prior_close_as_of; delete row.prior_month_as_of; }
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

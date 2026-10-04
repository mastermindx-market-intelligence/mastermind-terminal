// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixCompanion, type MatrixPreferences } from "@/components/options-companion/MatrixCompanion";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { matrixForExpiry, readCompanionMatrix, type OptionsChartLevel } from "@/lib/optionsCompanion";
import { buildMatrixGrid, matrixAxisDomain, matrixExactScopeStats, matrixSelectedNodeContext, type MatrixHeatCell, type StrikeExpiryDoc } from "@/components/shared/StrikeExpiryMatrix";

// Market Memory has its own transport and race tests; scope tests stay deterministic.
vi.mock("@/lib/flowClientCache", () => ({ flowGetFresh: vi.fn(async () => null) }));
const transport = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/components/options-companion/useOptionsSnapshot", () => ({ useOptionsSnapshot: () => ({ data: transport.data, loading: false, failed: false, refresh: vi.fn() }) }));
const session = "2026-09-25", later = "2026-09-28", last = "2026-10-02";
const cell = (strike: number, expiry: string, gex: number | null): MatrixHeatCell => ({ strike, expiry, gex, call_oi: 0, put_oi: 0, call_vol: 0, put_vol: 0 });
const doc = (cells: MatrixHeatCell[], extra: Partial<StrikeExpiryDoc> = {}) => ({ schema: "options_structure.matrix/v1", root: "SPY", spot: 770, asof: "2026-09-26T00:05:00Z", _build_meta: { asof_date: session }, cells, ...extra });
const read = (input: unknown) => { const r = readCompanionMatrix(input, "SPY", Date.parse("2026-09-29T12:00:00Z")); if (!r.ok) throw Error(r.reason); return r.value; };
const grid = (d: StrikeExpiryDoc, maxRows = 10_000, displayCenterStrike?: number) => buildMatrixGrid({ matrix: d, metric: "gex", maxRows, maxCols: 3, windowPct: 25, exactStrikes: true, scope: "all", withSigma: true, displayCenterStrike })!;
const partial = () => doc([cell(770, session, 8e6), cell(770, later, 2e6), cell(770, last, null), cell(771, session, -1e6), cell(771, later, 1e6), cell(771, last, 3e6)]);
const complete = () => doc([cell(770, session, 8e6), cell(770, later, -2e6), cell(771, session, 1e6), cell(771, later, 3e6)]);

let node: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-29T12:00:00Z"));
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); });
async function mount(input: unknown, lang: "en" | "zh" = "en") {
  transport.data = input;
  function Host() {
    const [prefs, setPrefs] = React.useState<MatrixPreferences>({ expiries: "3", window: 25, norm: "global" });
    const [pinned, onPin] = React.useState<OptionsChartLevel | null>(null);
    return <MatrixCompanion root="SPY" metric="gex" prefs={prefs} onPrefs={setPrefs} t={optionsT(lang)} pinned={pinned} onPin={onPin} replayActive={false} />;
  }
  await act(async () => root.render(<Host />));
}
async function click(selector: string) { const b = node.querySelector<HTMLButtonElement>(selector); expect(b).not.toBeNull(); await act(async () => b!.click()); }
async function setExpiries(value: string) {
  const el = node.querySelector<HTMLSelectElement>('[data-testid="options-scope-expiries"]')!;
  await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("partial subset arithmetic", () => {
  it("retains known row/subset amounts without complete claims", () => {
    const g = grid(read(partial()).doc), c = matrixSelectedNodeContext(g, "gex", { strike: 770, expiry: session });
    expect(c).toMatchObject({ strikeTotal: null, knownStrikeTotal: 10, strikeKnown: 2, strikeExpected: 3, ex0dteTotal: null, knownEx0dteTotal: 2, ex0dteKnown: 1, ex0dteExpected: 2 });
    expect(g.sigma.get(770)).toBeNull(); expect(g.sigma.get(771)).toBe(3);
  });
  it("keeps an independently complete exclusion when only 0DTE is absent", () => {
    const c = matrixSelectedNodeContext(grid(read(doc([cell(770, session, null), cell(770, later, 2e6), cell(770, last, -1e6)])).doc), "gex", { strike: 770, expiry: later });
    expect(c).toMatchObject({ strikeTotal: null, knownStrikeTotal: 1, ex0dteTotal: 1, ex0dteKnown: 2, ex0dteExpected: 2 });
  });
  it("distinguishes an empty exclusion from a measured numerical zero", () => {
    const c = matrixSelectedNodeContext(grid(read(doc([cell(770, session, 0)])).doc), "gex", { strike: 770, expiry: session });
    expect(c.strikeTotal).toBe(0); expect(c.ex0dteTotal).toBeNull(); expect(c.ex0dteExpected).toBe(0); expect(c.strikeSharePct).toBeNull();
  });
  it.each(["en", "zh"] as const)("discloses partial totals and known denominator in %s", async (lang) => {
    await mount(partial(), lang); await click('[data-testid="options-dominant-node"]');
    expect(node.querySelector('[data-options-total]')?.textContent).toBe("—");
    expect(node.querySelector('[data-options-total]')?.className).not.toMatch(/positive|negative/);
    expect(node.querySelector('[data-testid="options-node-partial"]')?.textContent).toMatch(lang === "en" ? /Known subtotal \+10M.*2\/3/ : /已知小计 \+10M.*2\/3/);
    expect(node.querySelector('[data-testid="options-node-ex0dte-partial"]')?.textContent).toMatch(lang === "en" ? /Known subtotal \+2M.*1\/2/ : /已知小计 \+2M.*1\/2/);
    expect(node.querySelector('[data-testid="options-node-context"]')?.textContent).toMatch(lang === "en" ? /known \|cell net\|/ : /已知 \|单元格净值\|/);
  });
});

describe("declared display domain is not a provider universe", () => {
  it("counts missing declared expiry positions without inventing zero cells", () => {
    const d = read(doc([cell(770, session, 8e6), cell(771, session, 2e6)], { strikes: [770, 771], expiries: [session, later] })).doc;
    expect(matrixExactScopeStats(d, "gex", 25, 3)).toEqual({ total: null, knownTotal: 10, missing: true, known: 2, expected: 4, domainBasis: "declared-grid" });
    expect(grid(d).exps).toEqual([session, later]); expect(grid(d).byKey.has("770|" + later)).toBe(false);
  });
  it("updates selected axes for an intentional 0DTE filter", () => {
    const d = matrixForExpiry(read(doc([cell(770, session, 0), cell(771, session, 0)], { strikes: [770, 771], expiries: [session, later] })), "0dte");
    expect(d.expiries).toEqual([session]); expect(matrixExactScopeStats(d, "gex", 25, 3)).toMatchObject({ total: 0, known: 2, expected: 2, missing: false });
  });
  it("labels legacy cell-derived scope without asserting source coverage", async () => {
    await mount(complete()); expect(node.querySelector('[data-testid="options-domain-basis"]')?.textContent).toMatch(/derived from supplied cells.*Source collection coverage unknown/);
  });
  it.each([
    { strikes: [770, 770], expiries: [session] },
    { strikes: [770], expiries: [session, "2026-02-30"] },
    { strikes: [771], expiries: [session] },
  ])("rejects malformed/contradictory declared axes %j", (axes) => {
    expect(matrixAxisDomain(doc([cell(770, session, 0)], axes)).basis).toBe("invalid");
  });
  it("does not create a 0DTE source when only a future expiry exists", () => {
    const d = matrixForExpiry(read(doc([cell(770, later, 1e6)], { strikes: [770], expiries: [later] })), "0dte");
    expect(d.cells).toEqual([]); expect(d.expiries).toEqual([]); expect(buildMatrixGrid({ matrix: d, metric: "gex", exactStrikes: true })).toBeNull();
  });
});

describe("off-screen is not excluded", () => {
  it.each(["en", "zh"] as const)("reveals the exact in-scope node without altering analysis in %s", async (lang) => {
    await mount(doc(Array.from({ length: 161 }, (_, i) => cell(160 + i * .5, session, i === 0 ? 1e9 : 1e6)), { spot: 200 }), lang);
    const originalScope = node.querySelector('[data-options-scope]')?.textContent;
    const originalTotal = node.querySelector('[data-options-total]')?.textContent;
    await click('[data-testid="options-dominant-node"]');
    expect(node.querySelector('[data-testid="options-selection-outside"]')).toBeNull();
    expect(node.querySelector('[data-testid="options-selection-offscreen"]')).not.toBeNull();
    await click('[data-testid="options-reveal-selection"]');
    const selected = node.querySelector('[data-options-grid] [data-selected="true"]');
    expect(selected?.getAttribute('aria-label')).toMatch(/^160, 2026-09-25:/);
    expect(document.activeElement).toBe(selected);
    expect(node.querySelector('[data-options-scope]')?.textContent).toBe(originalScope);
    expect(node.querySelector('[data-options-total]')?.textContent).toBe(originalTotal);
    expect(node.querySelector('[data-options-grid] tbody')?.children).toHaveLength(101);
    expect(node.querySelector('[data-testid="options-selection-offscreen"]')).toBeNull();
  });
  it("retains an actually excluded contract and restores it on scope restoration", async () => {
    await mount(complete()); await click('[data-testid="options-opposing-node"]');
    await click('[data-testid="options-scope-toggle"]'); await setExpiries("0dte"); await click('[data-testid="options-scope-apply"]');
    expect(node.querySelector('[data-testid="options-selection-outside"]')).not.toBeNull();
    expect(node.querySelector('[data-testid="options-selection-offscreen"]')).toBeNull(); expect(node.querySelector('[data-testid="options-node-context"]')).toBeNull();
    await click('[data-testid="options-scope-toggle"]'); await setExpiries("3"); await click('[data-testid="options-scope-apply"]');
    expect(node.querySelector('[data-testid="options-selection-outside"]')).toBeNull();
    expect(node.querySelector('[data-options-grid] [data-selected="true"]')?.getAttribute('aria-label')).toMatch(/^770, 2026-09-28:/);
  });
});

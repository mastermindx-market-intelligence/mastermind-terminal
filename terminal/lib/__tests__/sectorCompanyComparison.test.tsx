// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorCompanyComparison, { type SectorCompanyComparisonProps } from "@/components/sector-intelligence/SectorCompanyComparison";
import { LangProvider, applyLang, LEX } from "@/lib/i18n";
import { type SectorMember } from "@/lib/sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = (ticker: string, relative: number | null, return20d: number | null, sourceOrder: number): SectorMember => ({
  ticker, relative, return20d, sourceOrder, price: null, tier: null, ticks: null, buyable: false, state: "mixed",
});
const seed = [row("AAA", -8, 3, 0), row("BBB", 12, 23, 1), row("CCC", null, null, 2), row("DDD", 0, 0, 3),
  row("EEE", 12, 30, 4), row("FFF", 5, 7, 5), row("GGG", -4, -2, 6)];

describe("Sector company comparison — new coordinated selection workflow", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), expand = vi.fn(), table = vi.fn();
  const render = async (patch: Partial<SectorCompanyComparisonProps> = {}) => {
    const props: SectorCompanyComparisonProps = { rows: seed, selected: "", expanded: false,
      groupName: "Fixture group", asOf: "2026-09-23", onSelect: select, onExpand: expand, onOpenTable: table, ...patch };
    await act(async () => root.render(<LangProvider><SectorCompanyComparison {...props} /></LangProvider>));
  };
  const choice = (ticker: string) => host.querySelector<SVGGElement>(`[data-company-choice="${ticker}"]`)!;
  const inspector = () => host.querySelector('[data-testid="sector-company-inspector"]')!;
  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 600, height: 400, x: 0, y: 0, top: 0, bottom: 400, left: 0, right: 600, toJSON() {} });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("defaults to no implicit recommendation and a bounded six-row subset", async () => {
    await render(); expect(host.querySelectorAll('[data-company-choice]').length).toBe(6);
    expect(inspector().textContent).toContain("Select a company");
    expect(host.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
  it("clicking a plot row emits the exact ticker, without modifying the source", async () => {
    const before = JSON.stringify(seed); await render();
    await act(async () => choice("BBB").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(select).toHaveBeenCalledOnce(); expect(select).toHaveBeenCalledWith("BBB"); expect(JSON.stringify(seed)).toBe(before);
  });
  it("preserves absolute and relative values as distinct measures in the inspector", async () => {
    await render({ selected: "BBB" }); const text = inspector().textContent;
    expect(text).toContain("+23.0%"); expect(text).toContain("+12.0pp"); expect(text).toContain("2026-09-23");
    expect(choice("BBB").getAttribute("aria-pressed")).toBe("true");
    expect(inspector().querySelector('a')?.getAttribute('href')).toBe('/analysis?symbol=BBB&page=overview');
    expect(text).toContain("No"); // Source flag remains false despite a positive return.
  });
  it("keeps an exact selection outside the collapsed cohort", async () => {
    await render({ selected: "GGG" }); expect(choice("GGG")).toBeNull();
    expect(inspector().textContent).toContain("GGG"); expect(inspector().textContent).toContain("-4.0pp");
  });
  it("does not retain an inspector for a name absent from the current group", async () => {
    await render({ selected: "NOTHERE" }); expect(inspector().querySelector('a')).toBeNull();
    expect(inspector().textContent).toContain("Select a company");
  });
  it("equal relative values occupy the exact same coordinate regardless of absolute return", async () => {
    await render(); expect(choice("BBB").querySelector('circle')?.getAttribute('cx')).toBe(choice("EEE").querySelector('circle')?.getAttribute('cx'));
    expect(choice("BBB").textContent).toContain("+23.0%"); expect(choice("EEE").textContent).toContain("+30.0%");
  });
  it("missing relative values have no dot and real zero has a finite dot", async () => {
    await render(); expect(choice("CCC").querySelector('circle')).toBeNull();
    const zero = Number(choice("DDD").querySelector('circle')?.getAttribute('cx'));
    expect(Number.isFinite(zero)).toBe(true); expect(choice("DDD").textContent).toContain('0.0%');
  });
  it("supports ArrowDown, Home, End, Enter and Space without inventing extra selection effects", async () => {
    await render(); const key = async (ticker: string, value: string) => act(async () => choice(ticker).dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));
    await key('AAA','ArrowDown'); expect(select).toHaveBeenLastCalledWith('BBB');
    await key('BBB','Home'); expect(select).toHaveBeenLastCalledWith('AAA');
    await key('AAA','End'); expect(select).toHaveBeenLastCalledWith('FFF');
    await key('CCC','Enter'); expect(select).toHaveBeenLastCalledWith('CCC');
    await key('DDD',' '); expect(select).toHaveBeenLastCalledWith('DDD');
    expect(select).toHaveBeenCalledTimes(5);
  });
  it("show-all is controlled and reveals the full cohort without reordering it", async () => {
    await render(); const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Show all companies')!;
    await act(async () => button.click()); expect(expand).toHaveBeenCalledOnce();
    await render({ expanded: true }); expect([...host.querySelectorAll('[data-company-choice]')].map(n => n.getAttribute('data-company-choice'))).toEqual(seed.map(r => r.ticker));
  });
  it("opens the existing table view through the parent callback", async () => {
    await render(); const button = [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Open company table'))!;
    await act(async () => button.click()); expect(table).toHaveBeenCalledOnce();
  });
  it("keeps detailed source terms behind disclosure rather than placing them in the plot", async () => {
    await render({ selected: 'BBB' }); expect(choice('BBB').textContent).not.toContain('stock_buyable');
    const details = inspector().querySelector('details')!; expect(details.open).toBe(false);
    expect(details.textContent).toContain('stock_buyable');
  });
  it("reacts to the shared language event without mutating global LEX", async () => {
    const keys = Object.keys(LEX); await render({ selected: 'BBB' });
    await act(async () => applyLang('zh'));
    expect(host.textContent).toContain('比较公司'); expect(inspector().textContent).toContain('公司收益');
    expect(host.textContent).not.toContain('Select company'); expect(Object.keys(LEX)).toEqual(keys);
    expect(LEX.siCompareTitle).toBeUndefined();
  });
  it("renders an empty state without a selectable phantom company", async () => {
    await render({ rows: [], selected: 'AAA' }); expect(host.querySelectorAll('[data-company-choice]').length).toBe(0);
    expect(host.textContent).toContain('No comparable values'); expect(inspector().querySelector('a')).toBeNull();
  });
  it("keeps a usable finite scale when all supplied values are identical", async () => {
    await render({ rows: [row('AAA', 3, 4, 0), row('BBB', 3, 8, 1)] });
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(choice('AAA').querySelector('circle')?.getAttribute('cx')).toBe(choice('BBB').querySelector('circle')?.getAttribute('cx'));
  });
});

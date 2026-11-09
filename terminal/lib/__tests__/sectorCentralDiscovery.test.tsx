// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorCentralDiscovery, { breadthRead, discoveryRead, discoveryRows, type SectorCentralDiscoveryProps } from "@/components/sector-intelligence/SectorCentralDiscovery";
import { LangProvider, applyLang } from "../i18n";
import { DEFAULT_SECTOR_STATE, parseSectorState, writeSectorState, type Row } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rows: Row[] = [
  { id: "xlf", ticker: "XLF", name: "Finance", name_zh: "金融", heat: { heat_1M: -2, breadth_pct: 25, adv: 5, dec: 15 }, momentum: { above_200d: false } },
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技", heat: { heat_1M: 7.4, breadth_pct: 59, adv: 47, dec: 32 }, momentum: { above_200d: true } },
  { id: "xlu", ticker: "XLU", name: "Utilities", name_zh: "公用事业", heat: { heat_1M: null, breadth_pct: null, adv: null, dec: null }, momentum: {} },
  { id: "xli", ticker: "XLI", name: "Industrials", name_zh: "工业", heat: { heat_1M: 0, breadth_pct: 0, adv: 0, dec: 8 }, momentum: { above_200d: true } },
];
const companyHeatmap = { asof: "2026-09-25", size_basis: "marketcap", n_tiles: 5, tiles: [
  { t: "AAA", name: "Alpha Systems", sector: "Technology", industry: "Hardware", size: 300_000_000_000, perf: { "1D": 5 } },
  { t: "BBB", name: "Beta Devices", sector: "Technology", industry: "Hardware", size: 100_000_000_000, perf: { "1D": -2 } },
  { t: "CCC", name: "Cloud Core", sector: "Technology", industry: "Software", size: 80_000_000_000, perf: { "1D": 2 } },
  { t: "DDD", name: "Data Logic", sector: "Technology", industry: "Software", size: 20_000_000_000, perf: {} },
  { t: "JPM", name: "JPMorgan", sector: "Finance", industry: "Banks", size: 500_000_000_000, perf: { "1D": 3 } },
] };

describe("Sector Central discovery and breadth", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), open = vi.fn(), query = vi.fn(), companyQuery = vi.fn(), sort = vi.fn(), companySort = vi.fn(), mode = vi.fn(), timeframe = vi.fn();
  const clearCompanyFilters = vi.fn(), clearScope = vi.fn();
  const industry = vi.fn(), band = vi.fn(), cell = vi.fn(), inspect = vi.fn(), company = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorCentralDiscoveryProps> = {}) => {
    await act(async () => root.render(<LangProvider><SectorCentralDiscovery rows={rows} status="ready" asOf="2026-09-25"
      selected="xlk" selectedSourceName="Technology" selectedCompany="" query="" companyTableQuery="" sort="source" companyTableSort="source"
      breadthSort="strong" breadthWindow={5} onBreadthSort={vi.fn()} onBreadthWindow={vi.fn()}
      breadth={false} mode="table" heatmapData={companyHeatmap} heatmapStatus="ready"
      heatmapAsOf="2026-09-25" matrixTimeframe="1D" matrixIndustry="" matrixBand=""
      onQuery={query} onCompanyTableQuery={companyQuery} onSort={sort} onCompanyTableSort={companySort}
      onClearCompanyFilters={clearCompanyFilters} onClearScope={clearScope}
      onMode={mode} onTimeframe={timeframe} onIndustry={industry} onBand={band}
      onMatrixCell={cell} onInspectIndustry={inspect} onCompany={company} onSelect={select} onOpenResearch={open} onSources={sources} {...patch} /></LangProvider>));
  };
  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  it("refreshes a partial regular close without a click and keeps snapshots out of current ranks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T22:00:00Z"));
    const closed = (chg: number) => ({ market: "us", regularSessionDate: "2026-11-02", close: 100 + chg, prevClose: 100, regularChg: chg });
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ quotes: { BBB: closed(1) } }))
      .mockResolvedValueOnce(Response.json({ quotes: { BBB: closed(1), CCC: closed(3) } }));
    try {
      await render({ companyTableSort: "performance" });
      expect(String(request.mock.calls[0][0])).toContain("view=regular&syms=AAA%2CBBB%2CCCC%2CDDD");
      expect(host.textContent).toContain("Regular close · 1/4 quotes");
      expect(host.textContent).toContain("Roster and cap snapshot 2026-09-25");
      expect(host.textContent).toContain("BBB leads 1D performance (+1.00%)");
      expect(host.querySelector('[data-company-table-row="AAA"]')?.lastElementChild?.textContent).toBe("—");
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(host.textContent).toContain("Regular close · 2/4 quotes");
      expect(host.querySelector("[data-company-table-row]")?.getAttribute("data-company-table-row")).toBe("CCC");
      expect(host.textContent).toContain("2 of 2 observed names are up");
      await render({ mode: "matrix" });
      expect(host.textContent).toContain("Regular close · 2/4 quotes");
      expect(request).toHaveBeenCalledTimes(2);
      await render({ matrixTimeframe: "1W" });
      await act(async () => vi.advanceTimersByTimeAsync(65000));
      expect(request).toHaveBeenCalledTimes(2);
      expect(host.querySelector('[data-testid="sector-quote-coverage"]')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("discards a late pending quote after the roster loses access", async () => {
    let resolve!: (value: Response) => void;
    const request = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    await render();
    const signal = request.mock.calls[0][1]?.signal;
    await render({ heatmapStatus: "access" });
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(Response.json({ quotes: { AAA: { regularChg: 9 } } })));
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(0);
    expect(host.querySelector('[data-testid="sector-quote-coverage"]')).toBeNull();
  });
  it("retires pending Discover quotes across the same mounted Breadth transition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T22:00:00Z"));
    const closed = (chg: number) => ({ market: "us", regularSessionDate: "2026-11-02", close: 100 + chg, prevClose: 100, regularChg: chg });
    let resolvePending!: (value: Response) => void;
    const request = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolvePending = resolve; }))
      .mockResolvedValueOnce(Response.json({ quotes: { AAA: closed(4) } }));
    const originalPopulation = JSON.stringify(companyHeatmap);
    try {
      await render();
      expect(request).toHaveBeenCalledTimes(1);
      const signal = request.mock.calls[0][1]?.signal;
      await render({ breadth: true });
      expect(signal?.aborted).toBe(true);
      expect(host.textContent).toContain("positive one-month return");
      expect(host.querySelector('[data-testid="sector-quote-coverage"]')).toBeNull();
      const closingSnapshot = host.textContent;
      await act(async () => resolvePending(Response.json({ quotes: { AAA: closed(99) } })));
      await act(async () => vi.advanceTimersByTimeAsync(65000));
      expect(host.textContent).toBe(closingSnapshot);
      expect(request).toHaveBeenCalledTimes(1);
      await render({ companyTableSort: "performance" });
      expect(request).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain("Regular close · 1/4 quotes");
      expect(host.textContent).toContain("AAA leads 1D performance (+4.00%)");
      expect(host.textContent).not.toContain("+99.00%");
      await render({ breadth: true });
      expect(host.querySelector('[data-testid="sector-quote-coverage"]')).toBeNull();
      expect(JSON.stringify(companyHeatmap)).toBe(originalPopulation);
    } finally { vi.useRealTimers(); }
  });
  it("preserves source order and does not mutate the original rows", () => {
    const before = JSON.stringify(rows);
    expect(discoveryRows(rows, "", "source").map(row => row.id)).toEqual(["xlf", "xlk", "xlu", "xli"]);
    expect(discoveryRows(rows, "", "return").map(row => row.id)).toEqual(["xlk", "xli", "xlf", "xlu"]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("puts zero above negative returns and missing participation last", () => {
    expect(discoveryRows(rows, "", "participation").map(row => row.id)).toEqual(["xlk", "xlf", "xli", "xlu"]);
  });
  it.each(["tech", "XLK", "科技", " ＸＬＫ "])("matches the source identity for %s", value => {
    expect(discoveryRows(rows, value, "source").map(row => row.id)).toEqual(["xlk"]);
  });
  it("derives answer-first discovery and breadth reads from exact sector rows", () => {
    expect(discoveryRead(rows, "en")).toBe("Technology leads 1M returns (+7.40%); 1 of 3 observed sectors have majority participation.");
    expect(breadthRead(rows, "en")).toBe("Breadth is narrow; Technology is the only sector with majority participation.");
    expect(discoveryRead([{ ...rows[0], heat: {} }], "en")).toBeNull();
  });
  it("renders Summary as an answer-first representation over the same exact population", async () => {
    await render({ mode: "summary" });
    expect(host.querySelector('[data-testid="sector-industry-summary"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-summary-industry-row]")).toHaveLength(2);
    expect(host.textContent).toContain("Hardware leads cap-weighted 1D performance (+3.25% on 2/2 names observed)");
    const action = host.querySelector('[data-summary-industry-action="Hardware"]') as HTMLButtonElement;
    await act(async () => action.click());
    expect(inspect).toHaveBeenCalledWith("Hardware");
  });
  it("renders the complete selected-sector company table with the answer before mechanics", async () => {
    await render();
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(4);
    expect(host.textContent).toContain("AAA leads 1D performance (+5.00%)");
    expect(host.textContent).toContain("2026-09-25 · 4 names · 1D");
    expect(host.textContent).toContain("Alpha Systems"); expect(host.textContent).toContain("-2.00%");
    expect(select).not.toHaveBeenCalled();
  });
  it("selects an exact company in place and opens sector research only from the explicit action", async () => {
    await render(); await act(async () => (host.querySelector('[data-company-table-row="CCC"] button') as HTMLButtonElement).click());
    expect(company).toHaveBeenCalledWith("CCC"); expect(open).not.toHaveBeenCalled();
    const openButton = Array.from(host.querySelectorAll('[data-testid="company-table-selection"] button')).find(button => button.textContent?.includes("Open sector intelligence"))!;
    await act(async () => (openButton as HTMLButtonElement).click()); expect(open).toHaveBeenCalledWith("xlk");
  });
  it("ranks the legacy snapshot by the share of moving names, with its true one-month basis", async () => {
    await render({ breadth: true });
    const selected = host.querySelector('[data-sector-choice="xlk"]')!;
    expect(host.textContent).toContain("positive one-month return");
    expect(host.textContent).toContain("Comparable daily history is unavailable");
    expect(host.querySelector('[data-readout="expand"]')).toBeNull();
    expect(selected.closest("tr")?.textContent).toContain("59.5%");
    expect(selected.closest("tr")?.textContent).toContain("47 / 32");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-sector-choice]")).toBe(selected);
  });
  it("holds the ranking when two sector identities share the same ETF", async () => {
    await render({breadth:true, rows:[rows[0], {...rows[1],ticker:rows[0].ticker}]});
    expect(host.textContent).toContain("Sector records share a ticker.");
    expect(host.querySelector("[data-sector-choice]")).toBeNull();
  });
  it("waits for an in-flight daily source without briefly labeling a monthly market leader", async () => {
    await render({breadth:true, heatmapStatus:"loading"});
    expect(host.textContent).toContain("Loading closing comparisons");
    expect(host.querySelector("[data-readout]")).toBeNull();
  });
  it("leaves invalid and zero-denominator snapshots unranked", async () => {
    await render({ breadth: true, rows: [
      { ...rows[0], heat: { breadth_pct: 150, adv: -1, dec: false } },
      { ...rows[1], heat: { breadth_pct: 0, adv: 0, dec: 0 } },
    ] });
    expect(host.textContent).toContain("0/2 sectors ranked");
    expect(host.querySelector("tbody i[style]")).toBeNull();
  });
  it("distinguishes high participation from expansion, calculates velocity, and ties ranks", async () => {
    const history = { schema: "sector_breadth_close.v1", basis: "current_cohort_daily_closes",
      dates: ["2026-09-18","2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25"],
      sectors: {
        XLF: { matched: 10, eligible: 10, advancing: [3,3,3,3,3,8], declining: [4,4,4,4,4,0] },
        XLK: { matched: 10, eligible: 10, advancing: [9,9,9,9,9,8], declining: [1,1,1,1,1,2] },
        XLU: { matched: 1, eligible: 10, advancing: [1,1,1,1,1,1], declining: [0,0,0,0,0,0] } } };
    await render({breadth: true, heatmapData: {...companyHeatmap, sector_breadth_close: history}});
    const highlights = host.querySelector('[aria-label="All sectors"]')!;
    expect(highlights.querySelector('[data-readout="strong"]')?.textContent).toContain("XLF · XLK");
    expect(highlights.querySelector('[data-readout="expand"]')?.textContent).toContain("+50.0 pp");
    expect(highlights.querySelector('[data-readout="contract"]')?.textContent).toContain("-10.0 pp");
    expect(highlights.textContent).toContain("1 expanding · 1 contracting · 0 flat");
    expect(highlights.textContent).toContain("2 of 2 ranked sectors above 50% advancing");
    const compare = Array.from(host.querySelectorAll("select")).find(el => el.closest("label")?.textContent?.includes("Compare closes"))!;
    await act(async () => { compare.value = "5"; compare.dispatchEvent(new Event("change",{bubbles:true})); });
    const row = host.querySelector('[data-sector-choice="xlf"]')!.closest("tr")!;
    expect(row.textContent).toContain("+10.0 pp");
    expect(row.textContent).toContain("#2 → #1");
    expect(row.textContent).toContain("8 / 0 / 2");
    expect(host.textContent).toContain("2/4 sectors ranked");
    await render({breadth: true, heatmapData: {...companyHeatmap, sector_breadth_close: history}, heatmapStatus:"access"});
    expect(host.textContent).not.toContain("+50.0 pp");
  });
  it("switches the same exact company population across four distinct Discover representations", async () => {
    await render(); expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(4);
    expect(host.querySelectorAll('[role="group"] button')).toHaveLength(4);
    const summary = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Summary")!;
    await act(async () => summary.click()); expect(mode).toHaveBeenCalledWith("summary");
    const heatmap = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Heatmap")!;
    await act(async () => heatmap.click()); expect(mode).toHaveBeenCalledWith("heatmap");
    await render({ mode: "heatmap" });
    expect(host.querySelectorAll("[data-company-heatmap-tile]")).toHaveLength(4);
    await render();
    const matrix = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Matrix")!;
    await act(async () => matrix.click()); expect(mode).toHaveBeenCalledWith("matrix");
    await render({ mode: "matrix" });
    expect(host.querySelector('[data-testid="sector-industry-matrix"]')).not.toBeNull();
    expect(host.textContent).toContain("4 names");
  });
  it.each(["access", "loading", "invalid", "error", "unavailable"] as const)("hides retained company rows after %s", async heatmapStatus => {
    await render(); await render({ heatmapStatus });
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(0);
    expect(host.textContent).not.toContain("Alpha Systems");
  });
  it("provides an empty-search reset without changing the exact company population", async () => {
    await render({ companyTableQuery: "missing" }); expect(host.textContent).toContain("No exact companies match the current filters.");
    const reset = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Clear filters")!;
    await act(async () => reset.click());
    expect(clearCompanyFilters).toHaveBeenCalledTimes(1);
    expect(companyQuery).not.toHaveBeenCalled(); expect(industry).not.toHaveBeenCalled(); expect(band).not.toHaveBeenCalled();
  });
  it("uses the shared language provider for the same company population", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("公司表格"); expect(host.textContent).toContain("搜索公司");
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(4);
    expect(host.textContent).not.toContain("Company table");
  });
});

describe("Discovery to detail URL continuity", () => {
  it("uses answer-first Summary for a fresh Sector Central visit", () => {
    const state = parseSectorState(new URLSearchParams("tab=sectors"));
    expect(state.workspace).toBe("discover");
    expect(state.discoveryMode).toBe("summary");
  });
  it.each(["sectorView=companies", "sector=xlk&group=semiconductors", "sectorCompany=MU", "sectorView=dossier"])("keeps the old detail URL %s", value => {
    expect(parseSectorState(new URLSearchParams(value)).workspace).toBe("detail");
  });
  it.each(["summary", "table", "heatmap", "matrix"] as const)("admits %s as a durable Discover representation", discoveryMode => {
    expect(parseSectorState(new URLSearchParams(`sectorDiscoveryMode=${discoveryMode}`)).discoveryMode).toBe(discoveryMode);
  });
  it.each(["rotation", "discover", "breadth", "detail"] as const)("retains %s, representations, matrix context and the selected object", workspace => {
    const state = { ...DEFAULT_SECTOR_STATE, workspace, discoveryQuery: "Tech", discoverySort: "participation" as const,
      companyTableQuery: "ON Semiconductor", companyTableSort: "performance" as const, discoveryMode: "matrix" as const, matrixTimeframe: "1M" as const, matrixIndustry: "Semiconductors", matrixBand: "mega" as const,
      breadthSort: "contract" as const, breadthWindow: 1 as const,
      rotationMode: "list" as const, rotationQuery: "Technology", view: "companies" as const, company: "MU", query: "MU", sourcesOpen: true };
    const href = writeSectorState(new URL("https://example.test/discover?from=map"), state);
    const url = new URL(href, "https://example.test"); expect(parseSectorState(url.searchParams)).toEqual(state);
    expect(url.searchParams.get("from")).toBe("map");
  });
  it("bounds new state and refuses unknown representation, timeframe and band tokens", () => {
    const state = parseSectorState(new URLSearchParams(`sectorWorkspace=unknown&sectorDiscoverySort=score&sectorCompanyTableSort=rank&sectorCompanyTableQuery=${"q".repeat(90)}&sectorDiscoveryMode=bubbles&sectorMatrixTimeframe=2Y&sectorMatrixBand=giant&sectorMatrixIndustry=${"z".repeat(150)}&sectorDiscoveryQuery=${"x".repeat(90)}&sectorRotationMode=tiles&sectorRotationQuery=${"y".repeat(90)}`));
    expect(state.workspace).toBe("discover"); expect(state.discoverySort).toBe("source"); expect(state.companyTableSort).toBe("source"); expect(state.companyTableQuery).toHaveLength(60); expect(state.discoveryQuery).toHaveLength(60);
    expect(state.discoveryMode).toBe("summary"); expect(state.matrixTimeframe).toBe("1D"); expect(state.matrixBand).toBe(""); expect(state.matrixIndustry).toHaveLength(120);
    expect(state.rotationMode).toBe("map"); expect(state.rotationQuery).toHaveLength(60);
  });
});

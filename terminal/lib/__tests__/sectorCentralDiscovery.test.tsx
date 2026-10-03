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
  it("encodes the supplied share on a common zero-to-one-hundred bar and gives the breadth answer", async () => {
    await render({ breadth: true });
    const selected = host.querySelector('[data-sector-choice="xlk"]')!;
    expect(host.textContent).toContain("Breadth is narrow; Technology is the only sector with majority participation.");
    expect(selected.textContent).toContain("59%"); expect(selected.textContent).toContain("47 advancing · 32 declining");
    expect(selected.querySelector<HTMLElement>('span[style]')!.style.width).toBe("59%");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-sector-choice="xlu"] span[style]')).toBeNull();
    expect(host.querySelector('[data-sector-choice="xli"] span[style]')!.getAttribute("style")).toContain("0%");
  });
  it("rejects an invalid percentage instead of drawing beyond the track", async () => {
    await render({ breadth: true, rows: [{ ...rows[0], heat: { breadth_pct: 150, adv: -1, dec: false } }] });
    expect(host.querySelector('[data-sector-choice] span[style]')).toBeNull();
    expect(host.textContent).not.toContain("150%"); expect(host.textContent).not.toContain("-1 advancing");
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

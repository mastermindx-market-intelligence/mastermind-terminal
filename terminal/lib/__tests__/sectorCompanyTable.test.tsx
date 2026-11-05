// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorCompanyTable, {
  sectorCompanyTableRead,
  sectorCompanyTableRows,
  type SectorCompanyTableProps,
} from "@/components/sector-intelligence/SectorCompanyTable";
import { sectorMatrixPopulation } from "@/components/sector-intelligence/SectorIndustryMatrix";
import { LangProvider, applyLang } from "../i18n";
import type { Row } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sectors: Row[] = [
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技" },
  { id: "xlf", ticker: "XLF", name: "Financial", name_zh: "金融" },
];
const heatmap = { asof: "2026-09-25", size_basis: "marketcap", n_tiles: 6, tiles: [
  { t: "AAA", name: "Alpha Systems", sector: "Technology", industry: "Hardware", size: 300_000_000_000, perf: { "1D": 5, "1M": 8 } },
  { t: "BBB", name: "Beta Devices", sector: "Technology", industry: "Hardware", size: 100_000_000_000, perf: { "1D": -2, "1M": 4 } },
  { t: "CCC", name: "Cloud Core", sector: "Technology", industry: "Software", size: 80_000_000_000, perf: { "1D": 2, "1M": 6 } },
  { t: "DDD", name: "Data Logic", sector: "Technology", industry: "Software", size: 20_000_000_000, perf: { "1M": -1 } },
  { t: "EEE", name: "Edge Labs", sector: "Technology", industry: "Software", size: 8_000_000_000, perf: { "1D": 0 } },
  { t: "JPM", name: "JPMorgan", sector: "Financial", industry: "Banks", size: 500_000_000_000, perf: { "1D": 3 } },
] };
const technology = sectorMatrixPopulation(heatmap, "Technology").tiles;

describe("selected-sector company table projection", () => {
  it("keeps exact source order and never mutates the owner rows", () => {
    const before = JSON.stringify(technology);
    expect(sectorCompanyTableRows(technology, "1D").map(row => row.ticker)).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE"]);
    expect(JSON.stringify(technology)).toBe(before);
  });
  it("searches exact identity fields and combines owner filters", () => {
    expect(sectorCompanyTableRows(technology, "1D", "cloud").map(row => row.ticker)).toEqual(["CCC"]);
    expect(sectorCompanyTableRows(technology, "1D", "software").map(row => row.ticker)).toEqual(["CCC", "DDD", "EEE"]);
    expect(sectorCompanyTableRows(technology, "1D", "", "Software", "smaller").map(row => row.ticker)).toEqual(["EEE"]);
  });
  it("sorts performance with missing last while preserving exact zero", () => {
    expect(sectorCompanyTableRows(technology, "1D", "", "", "", "performance").map(row => row.ticker)).toEqual(["AAA", "CCC", "EEE", "BBB", "DDD"]);
    expect(sectorCompanyTableRows(technology, "1D", "", "", "", "marketcap").map(row => row.ticker)).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE"]);
    expect(sectorCompanyTableRows(technology, "1D", "", "", "", "ticker").map(row => row.ticker)).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE"]);
  });
  it("derives the answer from the visible exact population", () => {
    expect(sectorCompanyTableRead(technology, "1D", "en")).toBe("AAA leads 1D performance (+5.00%); 2 of 4 observed names are up. AAA is the largest company in scope.");
    expect(sectorCompanyTableRead(technology.filter(row => row.industry === "Software"), "1D", "en")).toBe("CCC leads 1D performance (+2.00%); 1 of 2 observed names are up. CCC is the largest company in scope.");
    expect(sectorCompanyTableRead(technology, "YTD", "en")).toBeNull();
  });
});

describe("SectorCompanyTable", () => {
  let root: Root, host: HTMLDivElement;
  const sector = vi.fn(), timeframe = vi.fn(), industry = vi.fn(), band = vi.fn(), company = vi.fn();
  const query = vi.fn(), sort = vi.fn(), clearFilters = vi.fn(), open = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorCompanyTableProps> = {}) => {
    const props: SectorCompanyTableProps = {
      data: heatmap, status: "ready", asOf: "2026-09-25", sectors,
      selectedSector: "xlk", selectedSectorName: "Technology", selectedSectorSourceName: "Technology",
      timeframe: "1D", industry: "", band: "", selectedCompany: "", query: "", sort: "source",
      onSector: sector, onTimeframe: timeframe, onIndustry: industry, onBand: band, onCompany: company,
      onQuery: query, onSort: sort, onClearFilters: clearFilters, onOpenResearch: open, onSources: sources, ...patch,
    };
    await act(async () => root.render(<LangProvider><SectorCompanyTable {...props} /></LangProvider>));
  };
  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it("renders the complete exact population, answer and missing values", async () => {
    await render();
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(5);
    expect(host.textContent).toContain("AAA leads 1D performance (+5.00%)");
    expect(host.textContent).toContain("2026-09-25 · 5 names · 1D");
    expect(host.querySelector('[data-company-table-row="DDD"]')?.textContent).toContain("—");
    expect(host.querySelector('[data-company-table-row="EEE"]')?.textContent).toContain("0.00%");
    expect(host.textContent).not.toContain("JPMorgan");
  });
  it("selects an exact company and exposes existing company and sector actions", async () => {
    await render();
    await act(async () => (host.querySelector('[data-company-table-row="CCC"] button') as HTMLButtonElement).click());
    expect(company).toHaveBeenCalledWith("CCC");
    await render({ selectedCompany: "CCC" });
    const selected = host.querySelector('[data-testid="company-table-selection"]')!;
    expect(selected.textContent).toContain("CCC · Cloud Core");
    expect(selected.querySelector('a[href="/analysis?symbol=CCC&page=overview"]')).not.toBeNull();
    const button = Array.from(selected.querySelectorAll("button")).find(item => item.textContent?.includes("Open sector intelligence"))!;
    await act(async () => button.click()); expect(open).toHaveBeenCalledWith("xlk");
  });
  it("preserves selected identity when filters temporarily hide it", async () => {
    await render({ selectedCompany: "AAA", industry: "Software" });
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(3);
    const selected = host.querySelector('[data-testid="company-table-selection"]')!;
    expect(selected.textContent).toContain("AAA · Alpha Systems");
    expect(selected.textContent).toContain("outside the current filters");
  });
  it("routes all table mechanics through incumbent state callbacks", async () => {
    await render(); const controls = host.querySelectorAll("select");
    await act(async () => { (controls[0] as HTMLSelectElement).value = "xlf"; controls[0].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(sector).toHaveBeenCalledWith("xlf");
    await act(async () => { (controls[1] as HTMLSelectElement).value = "1M"; controls[1].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(timeframe).toHaveBeenCalledWith("1M");
    await act(async () => { (controls[2] as HTMLSelectElement).value = "Software"; controls[2].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(industry).toHaveBeenCalledWith("Software");
    await act(async () => { (controls[3] as HTMLSelectElement).value = "large"; controls[3].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(band).toHaveBeenCalledWith("large");
    await act(async () => { (controls[4] as HTMLSelectElement).value = "marketcap"; controls[4].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(sort).toHaveBeenCalledWith("marketcap");
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "cloud"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(query).toHaveBeenCalledWith("cloud");
  });
  it("clears combined table filters through one atomic callback", async () => {
    await render({ query: "missing", industry: "Software", band: "mid" });
    const button = Array.from(host.querySelectorAll("button")).find(item => item.textContent === "Clear filters")!;
    await act(async () => button.click());
    expect(clearFilters).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled(); expect(industry).not.toHaveBeenCalled(); expect(band).not.toHaveBeenCalled();
  });
  it.each(["loading", "access", "invalid", "error", "unavailable"] as const)("clears retained company rows after %s", async status => {
    await render(); await render({ status });
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(0);
    expect(host.textContent).not.toContain("Alpha Systems");
  });
  it("uses Chinese presentation without changing the exact Technology population", async () => {
    await render({ selectedSectorName: "科技", selectedSectorSourceName: "Technology" });
    await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("公司表格"); expect(host.textContent).toContain("搜索公司");
    expect(host.querySelectorAll("[data-company-table-row]")).toHaveLength(5);
    expect(host.textContent).not.toContain("Company table");
  });
});

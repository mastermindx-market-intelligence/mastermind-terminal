// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorIndustryMatrix, { sectorMatrixCells, sectorMatrixPopulation, sectorMatrixRead, type SectorIndustryMatrixProps } from "@/components/sector-intelligence/SectorIndustryMatrix";
import { LangProvider, applyLang } from "../i18n";
import type { Row } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sectors: Row[] = [
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技" },
  { id: "xlf", ticker: "XLF", name: "Financial", name_zh: "金融" },
];
const heatmap = {
  asof: "2026-09-25", size_basis: "marketcap", n_tiles: 7,
  tiles: [
    { t: "AMD", name: "Advanced Micro Devices", sector: "Technology", industry: "Semiconductors", size: 300_000_000_000, perf: { "1D": 2, "1M": 8 } },
    { t: "NVDA", name: "NVIDIA", sector: "Technology", industry: "Semiconductors", size: 1_500_000_000_000, perf: { "1D": 1, "1M": 5 } },
    { t: "INTC", name: "Intel", sector: "Technology", industry: "Semiconductors", size: 40_000_000_000, perf: { "1D": -1, "1M": 7 } },
    { t: "HPE", name: "Hewlett Packard Enterprise", sector: "Technology", industry: "Computer Hardware", size: 30_000_000_000, perf: { "1D": 0, "1M": -2 } },
    { t: "IBM", name: "IBM", sector: "Technology", industry: "Information Technology Services", size: 190_000_000_000, perf: {} },
    { t: "ODD", name: "Distinct GICS row", sector: "Information Technology", industry: "Other", size: 20_000_000_000, perf: { "1D": 9 } },
    { t: "JPM", name: "JPMorgan", sector: "Financial", industry: "Banks - Diversified", size: 500_000_000_000, perf: { "1D": 3 } },
  ],
};

describe("selected-sector Industry × Cap projection", () => {
  it("uses exact sector labels and preserves the complete supplied population", () => {
    const population = sectorMatrixPopulation(heatmap, "Technology");
    expect(population).toMatchObject({ status: "ready", supplied: 5, readable: 5 });
    expect(population.tiles.map(tile => tile.ticker)).toEqual(["AMD", "NVDA", "INTC", "HPE", "IBM"]);
    expect(population.tiles.some(tile => tile.ticker === "ODD")).toBe(false);
  });
  it("classifies exact market-cap bands and keeps missing performance distinct from zero", () => {
    const population = sectorMatrixPopulation(heatmap, "Technology");
    const cells = sectorMatrixCells(population.tiles, "1D");
    expect(cells.find(cell => cell.industry === "Semiconductors" && cell.band === "mega")).toMatchObject({ total: 2, observed: 2, advancing: 2, declining: 0, unchanged: 0 });
    expect(cells.find(cell => cell.industry === "Semiconductors" && cell.band === "mid")).toMatchObject({ total: 1, observed: 1, advancing: 0, declining: 1, unchanged: 0 });
    expect(cells.find(cell => cell.industry === "Computer Hardware" && cell.band === "mid")).toMatchObject({ total: 1, observed: 1, unchanged: 1 });
    expect(cells.find(cell => cell.industry === "Information Technology Services" && cell.band === "large")).toMatchObject({ total: 1, observed: 0, advancing: 0 });
  });
  it("derives a plain read from observed participation rather than hard-coded industries", () => {
    const cells = sectorMatrixCells(sectorMatrixPopulation(heatmap, "Technology").tiles, "1D");
    expect(sectorMatrixRead(cells, "en")).toBe("Semiconductors has the broadest participation (2/3 up); Computer Hardware is weakest (0/1 up).");
    expect(sectorMatrixRead(sectorMatrixCells(sectorMatrixPopulation(heatmap, "Technology").tiles, "YTD"), "en")).toBeNull();
  });
  it("fails closed when one selected tile is malformed or duplicated", () => {
    const malformed = { ...heatmap, tiles: heatmap.tiles.map(row => row.t === "INTC" ? { ...row, size: null } : row) };
    expect(sectorMatrixPopulation(malformed, "Technology")).toMatchObject({ status: "invalid", supplied: 5, readable: 2, tiles: [] });
    const duplicate = { ...heatmap, n_tiles: 8, tiles: [...heatmap.tiles, { ...heatmap.tiles[0] }] };
    expect(sectorMatrixPopulation(duplicate, "Technology").status).toBe("invalid");
  });
  it("treats a proven absent exact sector as empty, not an inferred alias", () => {
    expect(sectorMatrixPopulation(heatmap, "Consumer Staples")).toMatchObject({ status: "empty", supplied: 0, readable: 0 });
  });
});

describe("SectorIndustryMatrix", () => {
  let root: Root, host: HTMLDivElement;
  const sector = vi.fn(), timeframe = vi.fn(), cell = vi.fn(), open = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorIndustryMatrixProps> = {}) => {
    const props: SectorIndustryMatrixProps = {
      data: heatmap, status: "ready", asOf: "2026-09-25", sectors,
      selectedSector: "xlk", selectedSectorName: "Technology", selectedSectorSourceName: "Technology", timeframe: "1D", industry: "", band: "",
      onSector: sector, onTimeframe: timeframe, onCell: cell, onOpenResearch: open, onSources: sources, ...patch,
    };
    await act(async () => root.render(<LangProvider><SectorIndustryMatrix {...props} /></LangProvider>));
  };
  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it("serves the answer, exact population and selected-cell companies", async () => {
    await render();
    expect(host.querySelector('[data-testid="matrix-answer"]')?.textContent).toContain("Semiconductors has the broadest participation");
    expect(host.textContent).toContain("2026-09-25 · 5 names · 1D");
    expect(host.querySelectorAll("[data-matrix-cell]").length).toBeGreaterThan(4);
    const inspector = host.querySelector('[data-testid="matrix-inspector"]')!;
    expect(inspector.textContent).toContain("Semiconductors"); expect(inspector.textContent).toContain("AMD"); expect(inspector.textContent).toContain("NVDA");
    expect(inspector.textContent).not.toContain("INTC"); expect(host.textContent).not.toContain("Distinct GICS row");
    expect(inspector.querySelector('a[href="/analysis?symbol=AMD&page=overview"]')).not.toBeNull();
  });
  it("selects a matrix cell, sector and timeframe through the incumbent callbacks", async () => {
    await render();
    await act(async () => (host.querySelector('[data-matrix-cell="Semiconductors::mid"]') as HTMLButtonElement).click());
    expect(cell).toHaveBeenCalledWith("Semiconductors", "mid");
    const selects = host.querySelectorAll("select");
    await act(async () => { (selects[0] as HTMLSelectElement).value = "xlf"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(sector).toHaveBeenCalledWith("xlf");
    await act(async () => { (selects[1] as HTMLSelectElement).value = "1M"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(timeframe).toHaveBeenCalledWith("1M");
  });
  it("opens the selected sector depth only from the explicit action", async () => {
    await render();
    const button = Array.from(host.querySelectorAll("button")).find(item => item.textContent?.includes("Open sector intelligence"))!;
    await act(async () => button.click()); expect(open).toHaveBeenCalledWith("xlk");
  });
  it.each(["loading", "access", "invalid", "error", "unavailable"] as const)("clears retained matrix names after %s", async status => {
    await render(); await render({ status });
    expect(host.querySelectorAll("[data-matrix-cell]")).toHaveLength(0); expect(host.textContent).not.toContain("AMD");
  });
  it("uses shared Chinese language copy without changing source identities", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("行业 × 市值"); expect(host.textContent).toContain("参与度最强"); expect(host.textContent).toContain("AMD");
    expect(host.textContent).not.toContain("Market read");
  });
});

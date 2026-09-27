// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorCompanyHeatmap, {
  sectorCapBandForSize,
  sectorHeatmapDomain,
  sectorHeatmapLayout,
  sectorHeatmapRead,
  squarifyItems,
  type SectorCompanyHeatmapProps,
} from "@/components/sector-intelligence/SectorCompanyHeatmap";
import { sectorMatrixPopulation } from "@/components/sector-intelligence/SectorIndustryMatrix";
import { LangProvider, applyLang } from "../i18n";
import type { Row } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sectors: Row[] = [
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技" },
  { id: "xlf", ticker: "XLF", name: "Financial", name_zh: "金融" },
];
const heatmap = {
  asof: "2026-09-25", size_basis: "marketcap", n_tiles: 8,
  tiles: [
    { t: "AAA", name: "Alpha Systems", sector: "Technology", industry: "Hardware", size: 300_000_000_000, perf: { "1D": 5, "1M": 8 } },
    { t: "BBB", name: "Beta Devices", sector: "Technology", industry: "Hardware", size: 100_000_000_000, perf: { "1D": -2, "1M": 4 } },
    { t: "CCC", name: "Cloud Core", sector: "Technology", industry: "Software", size: 80_000_000_000, perf: { "1D": 2, "1M": 6 } },
    { t: "DDD", name: "Data Logic", sector: "Technology", industry: "Software", size: 20_000_000_000, perf: { "1D": 1, "1M": -1 } },
    { t: "EEE", name: "Edge Labs", sector: "Technology", industry: "Software", size: 8_000_000_000, perf: {} },
    { t: "FFF", name: "Flat Solar", sector: "Technology", industry: "Solar", size: 10_000_000_000, perf: { "1D": 0, "1M": 0 } },
    { t: "ODD", name: "Distinct GICS row", sector: "Information Technology", industry: "Other", size: 50_000_000_000, perf: { "1D": 9 } },
    { t: "JPM", name: "JPMorgan", sector: "Financial", industry: "Banks - Diversified", size: 500_000_000_000, perf: { "1D": 3 } },
  ],
};

const technology = sectorMatrixPopulation(heatmap, "Technology").tiles;

describe("selected-sector company heatmap projection", () => {
  it("uses deterministic market-cap bands at the exact boundaries", () => {
    expect(sectorCapBandForSize(250_000_000_000)).toBe("mega");
    expect(sectorCapBandForSize(200_000_000_000)).toBe("mega");
    expect(sectorCapBandForSize(50_000_000_000)).toBe("large");
    expect(sectorCapBandForSize(10_000_000_000)).toBe("mid");
    expect(sectorCapBandForSize(9_999_999_999)).toBe("smaller");
  });

  it("keeps one fixed symmetric color domain over the complete sector population", () => {
    expect(sectorHeatmapDomain(technology, "1D")).toBe(5);
    const full = sectorHeatmapLayout(technology, "1D");
    const software = sectorHeatmapLayout(technology, "1D", "Software");
    const small = sectorHeatmapLayout(technology, "1D", "", "smaller");
    expect(full.domain).toBe(5); expect(software.domain).toBe(5); expect(small.domain).toBe(5);
    expect(software.visible.map(tile => tile.ticker)).toEqual(["CCC", "DDD", "EEE"]);
    expect(small.visible.map(tile => tile.ticker)).toEqual(["EEE"]);
  });

  it("lays out every exact visible company once inside the bounded canvas", () => {
    const layout = sectorHeatmapLayout(technology, "1D");
    const companyRects = layout.industries.flatMap(industry => industry.companies);
    expect(companyRects.map(rect => rect.tile.ticker).sort()).toEqual(["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]);
    expect(new Set(companyRects.map(rect => rect.tile.ticker)).size).toBe(6);
    for (const rect of companyRects) {
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.w).toBeGreaterThan(0); expect(rect.h).toBeGreaterThan(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1000.001);
      expect(rect.y + rect.h).toBeLessThanOrEqual(620.001);
    }
  });

  it("preserves a tiny exact-owner industry instead of shrinking the denominator", () => {
    const dominant = { ...technology[0], ticker: "BIG", industry: "Dominant", size: 1_000_000_000_000 };
    const tiny = { ...technology[1], ticker: "TINY", industry: "Tiny exact owner row", size: 1_000_000 };
    const layout = sectorHeatmapLayout([dominant, tiny], "1D");
    expect(layout.industries.flatMap(industry => industry.companies).map(rect => rect.tile.ticker).sort()).toEqual(["BIG", "TINY"]);
    expect(layout.industries.find(industry => industry.industry === "Tiny exact owner row")?.companies).toHaveLength(1);
  });

  it("derives the answer from market-cap weight and observed participation", () => {
    expect(sectorHeatmapRead(technology, "1D", "en")).toBe("Hardware holds 77% of market cap; Software has the broadest participation (2/2 up).");
    expect(sectorHeatmapRead(technology, "YTD", "en")).toBeNull();
  });

  it("preserves missing observations separately from exact zero", () => {
    const layout = sectorHeatmapLayout(technology, "1D");
    const values = new Map(layout.industries.flatMap(industry => industry.companies).map(rect => [rect.tile.ticker, rect.value]));
    expect(values.get("EEE")).toBeNull();
    expect(values.get("FFF")).toBe(0);
    expect(layout.observed).toBe(5);
  });

  it("has a deterministic generic squarifier independent of input order ties", () => {
    const first = squarifyItems([
      { value: 2, item: "a", order: 0 }, { value: 1, item: "b", order: 1 }, { value: 1, item: "c", order: 2 },
    ], { x: 0, y: 0, w: 100, h: 60 });
    const second = squarifyItems([
      { value: 1, item: "c", order: 2 }, { value: 2, item: "a", order: 0 }, { value: 1, item: "b", order: 1 },
    ], { x: 0, y: 0, w: 100, h: 60 });
    expect(first).toEqual(second);
  });
});

describe("SectorCompanyHeatmap", () => {
  let root: Root, host: HTMLDivElement;
  const sector = vi.fn(), timeframe = vi.fn(), industry = vi.fn(), band = vi.fn();
  const company = vi.fn(), open = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorCompanyHeatmapProps> = {}) => {
    const props: SectorCompanyHeatmapProps = {
      data: heatmap, status: "ready", asOf: "2026-09-25", sectors,
      selectedSector: "xlk", selectedSectorName: "Technology", selectedSectorSourceName: "Technology",
      timeframe: "1D", industry: "", band: "", selectedCompany: "",
      onSector: sector, onTimeframe: timeframe, onIndustry: industry, onBand: band,
      onCompany: company, onOpenResearch: open, onSources: sources, ...patch,
    };
    await act(async () => root.render(<LangProvider><SectorCompanyHeatmap {...props} /></LangProvider>));
  };

  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it("serves the answer, exact population, fixed domain and largest-company inspector", async () => {
    await render();
    expect(host.querySelector('[data-testid="heatmap-answer"]')?.textContent).toContain("Hardware holds 77% of market cap");
    expect(host.textContent).toContain("2026-09-25 · 6 names · 1D");
    expect(host.querySelectorAll("[data-company-heatmap-tile]")).toHaveLength(6);
    expect(host.querySelector('[data-testid="heatmap-map"]')?.getAttribute("data-domain")).toBe("5");
    expect(host.textContent).not.toContain("Distinct GICS row");
    const inspector = host.querySelector('[data-testid="heatmap-inspector"]')!;
    expect(inspector.textContent).toContain("AAA"); expect(inspector.textContent).toContain("Alpha Systems");
    expect(inspector.querySelector('a[href="/analysis?symbol=AAA&page=overview"]')).not.toBeNull();
  });

  it("selects an exact company and routes filter controls through incumbent state callbacks", async () => {
    await render();
    await act(async () => (host.querySelector('[data-company-heatmap-tile="CCC"]') as HTMLButtonElement).click());
    expect(company).toHaveBeenCalledWith("CCC");
    const selects = host.querySelectorAll("select");
    await act(async () => { (selects[0] as HTMLSelectElement).value = "xlf"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(sector).toHaveBeenCalledWith("xlf");
    await act(async () => { (selects[1] as HTMLSelectElement).value = "1M"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(timeframe).toHaveBeenCalledWith("1M");
    await act(async () => { (selects[2] as HTMLSelectElement).value = "Software"; selects[2].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(industry).toHaveBeenCalledWith("Software");
    await act(async () => { (selects[3] as HTMLSelectElement).value = "large"; selects[3].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(band).toHaveBeenCalledWith("large");
  });

  it("keeps the selected company inspector and opens sector depth only from the explicit action", async () => {
    await render({ selectedCompany: "CCC" });
    const inspector = host.querySelector('[data-testid="heatmap-inspector"]')!;
    expect(inspector.textContent).toContain("CCC"); expect(inspector.textContent).toContain("Cloud Core");
    const button = Array.from(inspector.querySelectorAll("button")).find(item => item.textContent?.includes("Open sector intelligence"))!;
    await act(async () => button.click()); expect(open).toHaveBeenCalledWith("xlk");
  });

  it("filters without rescaling and exposes an honest empty recovery", async () => {
    await render({ industry: "Software" });
    expect(host.querySelectorAll("[data-company-heatmap-tile]")).toHaveLength(3);
    expect(host.querySelector('[data-testid="heatmap-map"]')?.getAttribute("data-domain")).toBe("5");
    await render({ industry: "Missing industry" });
    expect(host.querySelectorAll("[data-company-heatmap-tile]")).toHaveLength(0);
    expect(host.textContent).toContain("No exact names match this scope.");
  });

  it.each(["loading", "access", "invalid", "error", "unavailable"] as const)("clears retained heatmap names after %s", async status => {
    await render(); await render({ status });
    expect(host.querySelectorAll("[data-company-heatmap-tile]")).toHaveLength(0);
    expect(host.textContent).not.toContain("Alpha Systems");
  });

  it("uses Chinese presentation without changing the canonical Technology join", async () => {
    await render({ selectedSectorName: "科技", selectedSectorSourceName: "Technology" });
    await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("公司热图"); expect(host.textContent).toContain("市值");
    expect(host.querySelectorAll("[data-company-heatmap-tile]")).toHaveLength(6);
    expect(host.textContent).not.toContain("Market read");
  });
});

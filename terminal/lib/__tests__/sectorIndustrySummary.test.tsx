// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorIndustrySummary, {
  sectorIndustrySummaryRead,
  summarizeSectorIndustries,
  type SectorIndustrySummaryProps,
} from "@/components/sector-intelligence/SectorIndustrySummary";
import { sectorMatrixPopulation } from "@/components/sector-intelligence/SectorIndustryMatrix";
import { LangProvider, applyLang } from "../i18n";
import type { Row } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sectors: Row[] = [
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技" },
  { id: "xlf", ticker: "XLF", name: "Finance", name_zh: "金融" },
];
const heatmap = { asof: "2026-09-25", size_basis: "marketcap", n_tiles: 5, tiles: [
  { t: "AAA", name: "Alpha Systems", sector: "Technology", industry: "Hardware", size: 300_000_000_000, perf: { "1D": 5 } },
  { t: "BBB", name: "Beta Devices", sector: "Technology", industry: "Hardware", size: 100_000_000_000, perf: { "1D": -2 } },
  { t: "CCC", name: "Cloud Core", sector: "Technology", industry: "Software", size: 80_000_000_000, perf: { "1D": 2 } },
  { t: "DDD", name: "Data Logic", sector: "Technology", industry: "Software", size: 20_000_000_000, perf: {} },
  { t: "JPM", name: "JPMorgan", sector: "Finance", industry: "Banks", size: 500_000_000_000, perf: { "1D": 3 } },
] };

describe("Sector Industry Summary", () => {
  let root: Root, host: HTMLDivElement;
  const sector = vi.fn(), timeframe = vi.fn(), inspect = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorIndustrySummaryProps> = {}) => {
    await act(async () => root.render(<LangProvider><SectorIndustrySummary
      data={heatmap} status="ready" asOf="2026-09-25" sectors={sectors}
      selectedSector="xlk" selectedSectorName="Technology" selectedSectorSourceName="Technology"
      timeframe="1D" onSector={sector} onTimeframe={timeframe}
      onInspectIndustry={inspect} onSources={sources} {...patch} /></LangProvider>));
  };

  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it("derives every denominator from the exact selected-sector population without mutating it", () => {
    const population = sectorMatrixPopulation(heatmap, "Technology");
    expect(population.status).toBe("ready");
    const before = JSON.stringify(population.tiles);
    const summary = summarizeSectorIndustries(population.tiles, "1D");
    expect(JSON.stringify(population.tiles)).toBe(before);
    expect(summary).toMatchObject({
      totalNames: 4,
      totalMarketCap: 500_000_000_000,
      observedNames: 3,
      observedMarketCap: 480_000_000_000,
      advancing: 2,
      declining: 1,
      unchanged: 0,
      observedIndustries: 2,
      atLeastHalfUpIndustries: 2,
    });
    expect(summary.rows.map(row => row.industry)).toEqual(["Hardware", "Software"]);
    expect(summary.rows[0]).toMatchObject({
      names: 2, totalMarketCap: 400_000_000_000, observed: 2, observedMarketCap: 400_000_000_000,
      advancing: 1, declining: 1, populationShare: 50, marketCapShare: 80,
      observedCapShare: 100, participation: 50, capWeightedPerformance: 3.25,
    });
    expect(summary.rows[1]).toMatchObject({
      names: 2, totalMarketCap: 100_000_000_000, observed: 1, observedMarketCap: 80_000_000_000,
      advancing: 1, declining: 0, populationShare: 50, marketCapShare: 20,
      observedCapShare: 80, participation: 100, capWeightedPerformance: 2,
    });
    expect(sectorIndustrySummaryRead(summary, "1D", "en")).toBe(
      "Hardware leads cap-weighted 1D performance (+3.25% on 2/2 names observed); Software has the broadest participation (1/1 up). Coverage is 3/4 names and 96% of sector market cap.",
    );
  });

  it("renders the answer before the denominator-aware industry rows", async () => {
    await render();
    expect(host.querySelector('[data-testid="industry-summary-answer"]')?.textContent).toContain("Hardware leads cap-weighted 1D performance (+3.25% on 2/2 names observed)");
    expect(host.querySelectorAll("[data-summary-industry-row]")).toHaveLength(2);
    expect(host.querySelector('[data-summary-industry-row="Hardware"]')?.textContent).toContain("2 / 4");
    expect(host.querySelector('[data-summary-industry-row="Hardware"]')?.textContent).toContain("80% of sector cap");
    expect(host.querySelector('[data-summary-industry-row="Hardware"]')?.textContent).toContain("1 / 2");
    expect(host.querySelector('[data-summary-industry-row="Software"]')?.textContent).toContain("1 / 2 names observed");
    expect(host.textContent).toContain("3 / 4");
    expect(host.textContent).toContain("96% market cap observed");
  });

  it("drills into the existing company table with one exact industry identity", async () => {
    await render();
    await act(async () => (host.querySelector('[data-summary-industry-action="Hardware"]') as HTMLButtonElement).click());
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith("Hardware");
  });

  it("keeps sector, timeframe and source actions explicit", async () => {
    await render();
    const selects = host.querySelectorAll("select");
    await act(async () => { (selects[0] as HTMLSelectElement).value = "xlf"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { (selects[1] as HTMLSelectElement).value = "1M"; selects[1].dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Review sources")) as HTMLButtonElement).click());
    expect(sector).toHaveBeenCalledWith("xlf");
    expect(timeframe).toHaveBeenCalledWith("1M");
    expect(sources).toHaveBeenCalledTimes(1);
  });

  it.each(["loading", "access", "unavailable", "invalid", "error"] as const)("fails closed after %s", async status => {
    await render({ status });
    expect(host.querySelectorAll("[data-summary-industry-row]")).toHaveLength(0);
    expect(host.textContent).not.toContain("Hardware leads");
  });

  it("uses the shared language provider without changing the population", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("行业摘要");
    expect(host.textContent).toContain("市值加权表现领先");
    expect(host.querySelectorAll("[data-summary-industry-row]")).toHaveLength(2);
    expect(host.textContent).not.toContain("Industry summary");
  });
});

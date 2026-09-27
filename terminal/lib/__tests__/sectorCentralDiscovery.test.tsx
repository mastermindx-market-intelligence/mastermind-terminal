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

describe("Sector Central discovery and breadth", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), open = vi.fn(), query = vi.fn(), sort = vi.fn(), mode = vi.fn(), timeframe = vi.fn();
  const industry = vi.fn(), band = vi.fn(), cell = vi.fn(), company = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorCentralDiscoveryProps> = {}) => {
    await act(async () => root.render(<LangProvider><SectorCentralDiscovery rows={rows} status="ready" asOf="2026-09-25"
      selected="xlk" selectedSourceName="Technology" selectedCompany="" query="" sort="source" breadth={false} mode="table" heatmapData={null} heatmapStatus="unavailable"
      heatmapAsOf={null} matrixTimeframe="1D" matrixIndustry="" matrixBand=""
      onQuery={query} onSort={sort} onMode={mode} onTimeframe={timeframe} onIndustry={industry} onBand={band}
      onMatrixCell={cell} onCompany={company} onSelect={select} onOpenResearch={open} onSources={sources} {...patch} /></LangProvider>));
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
  it("renders all sectors with the answer before mechanics", async () => {
    await render();
    expect(host.querySelectorAll("[data-sector-choice]")).toHaveLength(4);
    expect(host.textContent).toContain("Technology leads 1M returns (+7.40%)");
    expect(host.textContent).toContain("2026-09-25"); expect(host.textContent).toContain("+7.40%");
    expect(host.textContent).toContain("0.00%"); expect(select).not.toHaveBeenCalled();
  });
  it("selects in place and opens research only from the explicit action", async () => {
    await render(); await act(async () => (host.querySelector('[data-sector-choice="xlf"]') as HTMLButtonElement).click());
    expect(select).toHaveBeenCalledWith("xlf"); expect(open).not.toHaveBeenCalled();
    await act(async () => (host.querySelector('[data-testid="sector-discovery-selection"] button') as HTMLButtonElement).click());
    expect(open).toHaveBeenCalledWith("xlk");
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
  it("switches admitted Discover representations without adding another workspace", async () => {
    await render();
    const heatmap = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Heatmap")!;
    await act(async () => heatmap.click()); expect(mode).toHaveBeenCalledWith("heatmap");
    await render({ mode: "heatmap" });
    expect(host.querySelector('[data-testid="sector-company-heatmap"]')).not.toBeNull();
    expect(host.textContent).toContain("Company heatmap data is unavailable.");
    await render();
    const matrix = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Matrix")!;
    await act(async () => matrix.click()); expect(mode).toHaveBeenCalledWith("matrix");
    await render({ mode: "matrix" });
    expect(host.querySelector('[data-testid="sector-industry-matrix"]')).not.toBeNull();
    expect(host.textContent).toContain("Industry matrix data is unavailable.");
  });
  it.each(["access", "loading", "invalid", "error", "unavailable"] as const)("hides retained source rows after %s", async status => {
    await render(); await render({ status });
    expect(host.querySelectorAll("[data-sector-choice]")).toHaveLength(0);
    expect(host.textContent).not.toContain("+7.40%");
  });
  it("provides an empty-search reset without changing the source population", async () => {
    await render({ query: "missing" }); expect(host.textContent).toContain("No sectors match this search.");
    const reset = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Clear search")!;
    await act(async () => reset.click()); expect(query).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledWith("");
  });
  it("uses the shared language provider for the same component", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("科技的1个月收益领先"); expect(host.textContent).toContain("搜索板块");
    expect(host.textContent).not.toContain("Sector discovery");
  });
});

describe("Discovery to detail URL continuity", () => {
  it("uses discovery for a fresh Sector Central visit", () => {
    expect(parseSectorState(new URLSearchParams("tab=sectors")).workspace).toBe("discover");
  });
  it.each(["sectorView=companies", "sector=xlk&group=semiconductors", "sectorCompany=MU", "sectorView=dossier"])("keeps the old detail URL %s", value => {
    expect(parseSectorState(new URLSearchParams(value)).workspace).toBe("detail");
  });
  it("admits Heatmap as a durable Discover representation", () => {
    expect(parseSectorState(new URLSearchParams("sectorDiscoveryMode=heatmap")).discoveryMode).toBe("heatmap");
  });
  it.each(["rotation", "discover", "breadth", "detail"] as const)("retains %s, representations, matrix context and the selected object", workspace => {
    const state = { ...DEFAULT_SECTOR_STATE, workspace, discoveryQuery: "Tech", discoverySort: "participation" as const,
      discoveryMode: "matrix" as const, matrixTimeframe: "1M" as const, matrixIndustry: "Semiconductors", matrixBand: "mega" as const,
      rotationMode: "list" as const, rotationQuery: "Technology", view: "companies" as const, company: "MU", query: "MU", sourcesOpen: true };
    const href = writeSectorState(new URL("https://example.test/discover?from=map"), state);
    const url = new URL(href, "https://example.test"); expect(parseSectorState(url.searchParams)).toEqual(state);
    expect(url.searchParams.get("from")).toBe("map");
  });
  it("bounds new state and refuses unknown representation, timeframe and band tokens", () => {
    const state = parseSectorState(new URLSearchParams(`sectorWorkspace=unknown&sectorDiscoverySort=score&sectorDiscoveryMode=bubbles&sectorMatrixTimeframe=2Y&sectorMatrixBand=giant&sectorMatrixIndustry=${"z".repeat(150)}&sectorDiscoveryQuery=${"x".repeat(90)}&sectorRotationMode=tiles&sectorRotationQuery=${"y".repeat(90)}`));
    expect(state.workspace).toBe("discover"); expect(state.discoverySort).toBe("source"); expect(state.discoveryQuery).toHaveLength(60);
    expect(state.discoveryMode).toBe("table"); expect(state.matrixTimeframe).toBe("1D"); expect(state.matrixBand).toBe(""); expect(state.matrixIndustry).toHaveLength(120);
    expect(state.rotationMode).toBe("map"); expect(state.rotationQuery).toHaveLength(60);
  });
});

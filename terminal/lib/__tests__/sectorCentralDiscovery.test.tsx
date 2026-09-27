// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorCentralDiscovery, { discoveryRows, type SectorCentralDiscoveryProps } from "@/components/sector-intelligence/SectorCentralDiscovery";
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
  const select = vi.fn(), query = vi.fn(), sort = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorCentralDiscoveryProps> = {}) => {
    await act(async () => root.render(<LangProvider><SectorCentralDiscovery rows={rows} status="ready" asOf="2026-09-25"
      selected="xlk" query="" sort="source" breadth={false} onQuery={query} onSort={sort} onSelect={select} onSources={sources} {...patch} /></LangProvider>));
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
  it("renders all sectors and counts observed gains rather than manufacturing breadth", async () => {
    await render();
    expect(host.querySelectorAll("[data-sector-choice]")).toHaveLength(4);
    expect(host.textContent).toContain("1 / 3"); expect(host.textContent).toContain("sectors gained over 1M");
    expect(host.textContent).toContain("2026-09-25"); expect(host.textContent).toContain("+7.40%");
    expect(host.textContent).toContain("0.00%"); expect(select).not.toHaveBeenCalled();
  });
  it("selects the exact sector key without inventing a company-group mapping", async () => {
    await render(); await act(async () => (host.querySelector('[data-sector-choice="xlk"]') as HTMLButtonElement).click());
    expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith("xlk");
  });
  it("encodes the supplied share on a common zero-to-one-hundred bar", async () => {
    await render({ breadth: true });
    const selected = host.querySelector('[data-sector-choice="xlk"]')!;
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
    expect(host.textContent).toContain("科技"); expect(host.textContent).toContain("搜索板块");
    expect(host.textContent).not.toContain("Find a sector");
  });
});

describe("Discovery to detail URL continuity", () => {
  it("uses discovery for a fresh Sector Central visit", () => {
    expect(parseSectorState(new URLSearchParams("tab=sectors")).workspace).toBe("discover");
  });
  it.each(["sectorView=companies", "sector=xlk&group=semiconductors", "sectorCompany=MU", "sectorView=dossier"])("keeps the old detail URL %s", value => {
    expect(parseSectorState(new URLSearchParams(value)).workspace).toBe("detail");
  });
  it.each(["rotation", "discover", "breadth", "detail"] as const)("retains %s, query, display order and the selected object", workspace => {
    const state = { ...DEFAULT_SECTOR_STATE, workspace, discoveryQuery: "Tech", discoverySort: "participation" as const,
      rotationMode: "list" as const, rotationQuery: "Technology", view: "companies" as const, company: "MU", query: "MU", sourcesOpen: true };
    const href = writeSectorState(new URL("https://example.test/discover?from=map"), state);
    const url = new URL(href, "https://example.test"); expect(parseSectorState(url.searchParams)).toEqual(state);
    expect(url.searchParams.get("from")).toBe("map");
  });
  it("bounds new search state and refuses unknown view/sort tokens", () => {
    const state = parseSectorState(new URLSearchParams(`sectorWorkspace=unknown&sectorDiscoverySort=score&sectorDiscoveryQuery=${"x".repeat(90)}&sectorRotationMode=tiles&sectorRotationQuery=${"y".repeat(90)}`));
    expect(state.workspace).toBe("discover"); expect(state.discoverySort).toBe("source"); expect(state.discoveryQuery).toHaveLength(60);
    expect(state.rotationMode).toBe("map"); expect(state.rotationQuery).toHaveLength(60);
  });
});

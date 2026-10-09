// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorRotationMap, { filterRotationPoints, rotationDomain, rotationQuadrant, rotationReceipt, rotationSynthesis, sectorRotationPoints, type SectorRotationMapProps } from "@/components/sector-intelligence/SectorRotationMap";
import { LangProvider, applyLang } from "../i18n";
import { sectorRotationHistory, type Row } from "../sectorIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rows: Row[] = [
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技", accent: "#38bdf8", momentum: { rs_21d: 7, rs_63d: 5, rs_21d_rank: 1, rs_rank: 2, above_200d: true }, heat: { heat_1M: 8.34, breadth_pct: 62, adv: 49, dec: 30 }, rotation: { state_plain_en: "watching for entry", state_plain_zh: "关注入场" } },
  { id: "xlf", ticker: "XLF", name: "Financials", name_zh: "金融", accent: "not-a-colour", momentum: { rs_21d: 2, rs_63d: -4, rs_21d_rank: 3, rs_rank: 7, above_200d: false }, heat: { heat_1M: -5.27, breadth_pct: 8, adv: 6, dec: 67 }, rotation: {} },
  { id: "xlu", ticker: "XLU", name: "Utilities", name_zh: "公用事业", momentum: { rs_21d: -2, rs_63d: -3, above_200d: true }, heat: { heat_1M: -7.83, breadth_pct: 3, adv: 1, dec: 30 }, rotation: {} },
  { id: "xle", ticker: "XLE", name: "Energy", name_zh: "能源", momentum: { rs_21d: -1, rs_63d: 3, above_200d: true }, heat: { heat_1M: 0.63, breadth_pct: 29, adv: 6, dec: 15 }, rotation: {} },
  { id: "xli", ticker: "XLI", name: "Industrials", name_zh: "工业", momentum: { rs_21d: 0, rs_63d: 0, above_200d: null }, heat: { heat_1M: 0, breadth_pct: 0, adv: 0, dec: 8 }, rotation: {} },
  { id: "xlv", ticker: "XLV", name: "Health Care", name_zh: "医疗保健", momentum: { rs_21d: null, rs_63d: 1 }, heat: {}, rotation: {} },
];

describe("source-native sector rotation math", () => {
  it("uses exact 21-session and 63-session source fields without mutating source order", () => {
    const before = JSON.stringify(rows), points = sectorRotationPoints(rows);
    expect(points.map(point => point.id)).toEqual(["xlk", "xlf", "xlu", "xle", "xli", "xlv"]);
    expect(points[0]).toMatchObject({ rs21: 7, rs63: 5, rank21: 1, rank63: 2, quadrant: "leading", accent: "#38bdf8" });
    expect(points[1].accent).toBeNull();
    expect(JSON.stringify(rows)).toBe(before);
  });
  it.each([
    [1, 1, "leading"], [-1, 1, "improving"], [-1, -1, "lagging"], [1, -1, "weakening"], [0, 0, "leading"], [null, 1, null],
  ] as const)("classifies quarter=%s fast=%s as %s", (quarter, fast, quadrant) => {
    expect(rotationQuadrant(quarter, fast)).toBe(quadrant);
  });
  it("keeps a fixed symmetric domain over the whole source population", () => {
    expect(rotationDomain(sectorRotationPoints(rows))).toBe(8.1);
    expect(rotationDomain([])).toBe(1);
  });
  it("filters identity fields without changing coordinates or source order", () => {
    const points = sectorRotationPoints(rows);
    expect(filterRotationPoints(points, "能源").map(point => point.id)).toEqual(["xle"]);
    expect(filterRotationPoints(points, " XL ").map(point => point.id)).toEqual(points.map(point => point.id));
    expect(points[3].rs63).toBe(3);
  });
  it("derives the answer-first read from current coordinates instead of hard-coding names", () => {
    const points = sectorRotationPoints(rows).map(point => point.id === "xle" ? { ...point, rs63: 9 } : point);
    expect(rotationSynthesis(points, "en")).toBe("Technology is the only sector positive on both 21D and 63D relative strength. Energy has the strongest 63D relative strength, but its 21D trend is negative.");
    expect(rotationSynthesis(points, "zh")).toBe("科技是唯一在21日和63日相对强度均为正的板块。 能源的63日相对强度最强，但其21日趋势为负。");
    expect(rotationSynthesis(points.map(point => ({ ...point, rs21: null, rs63: null })), "en")).toBeNull();
  });
  it("renders a compact dated source receipt without using fetch time", () => {
    expect(rotationReceipt("2026-09-25", 11, "en")).toBe("Sep 25 · 11 sectors");
    expect(rotationReceipt("2026-09-25", 11, "zh")).toBe("9月25日 · 11个板块");
    expect(rotationReceipt(null, 11, "en")).toBe("11 sectors");
  });
});



const historyPayload = {
  meta: {
    asOf: "2026-09-25",
    benchmark: "SPY",
    rs_history: {
      schema: "sector_cycles.rs_history.v1",
      mode: "reconstructed_price_history",
      naturally_observed: false,
      basis: "tr",
      benchmark: "SPY",
      horizons_sessions: [21, 63],
      max_points_per_sector: 252,
    },
  },
  sectors: [
    {
      id: "xlk", ticker: "XLK", kind: "sector",
      rs_history: [
        { date: "2026-09-23", rs_21d: 2.0, rs_63d: 4.0 },
        { date: "2026-09-24", rs_21d: 4.5, rs_63d: 4.8 },
        { date: "2026-09-25", rs_21d: 7.0, rs_63d: 5.0 },
      ],
    },
    {
      id: "xlf", ticker: "XLF", kind: "sector",
      rs_history: [
        { date: "2026-09-24", rs_21d: 1.5, rs_63d: -3.0 },
        { date: "2026-09-25", rs_21d: 2.0, rs_63d: -4.0 },
      ],
    },
  ],
};

describe("sector rotation historical owner contract", () => {
  it("admits only the exact reconstructed-price history envelope without relabeling it observed", () => {
    const parsed = sectorRotationHistory(historyPayload);
    expect(parsed).not.toBeNull();
    expect(parsed?.mode).toBe("reconstructed_price_history");
    expect(parsed?.naturallyObserved).toBe(false);
    expect(parsed?.benchmark).toBe("SPY");
    expect(parsed?.series.xlk.points.at(-1)).toEqual({ date: "2026-09-25", rs21: 7, rs63: 5 });

    const malformed = structuredClone(historyPayload);
    malformed.meta.rs_history.naturally_observed = true;
    expect(sectorRotationHistory(malformed)).toBeNull();
    malformed.meta.rs_history.naturally_observed = false;
    malformed.sectors[0].rs_history[1].date = "09/24/2026";
    expect(sectorRotationHistory(malformed)).toBeNull();
  });

  it("fails the whole history population on duplicate, unordered, or nonfinite points", () => {
    const mutations: Array<(data: typeof historyPayload) => void> = [
      data => { data.sectors[0].rs_history.push({ ...data.sectors[0].rs_history[1] }); },
      data => { data.sectors[0].rs_history.reverse(); },
      data => { data.sectors[0].rs_history[0].rs_21d = Number.NaN; },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(historyPayload); mutate(candidate);
      expect(sectorRotationHistory(candidate)).toBeNull();
    }
  });
});

describe("SectorRotationMap", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), mode = vi.fn(), query = vi.fn(), research = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorRotationMapProps> = {}) => {
    const props: SectorRotationMapProps = { rows, status: "ready", asOf: "2026-09-25", selected: "xlk", mode: "map", query: "", history: sectorRotationHistory(historyPayload), historyStatus: "ready", onMode: mode, onQuery: query, onSelect: select, onOpenResearch: research, onSources: sources, ...patch };
    await act(async () => root.render(<LangProvider><SectorRotationMap {...props} /></LangProvider>));
  };
  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it("serves the current answer before controls while keeping methodology disclosed", async () => {
    await render();
    expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(5);
    expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Sep 25 · 6 sectors");
    expect(host.querySelector('[data-testid="rotation-answer"]')?.textContent).toContain("Technology is the only sector positive on both 21D and 63D relative strength.");
    const method = host.querySelector<HTMLDetailsElement>("[data-rotation-method]")!;
    expect(method.open).toBe(false); expect(method.textContent).toContain("5 / 6 coordinates available");
    expect(method.textContent).toContain("Historical trail"); expect(method.textContent).toContain("not a record of what Mastermind observed then");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("data-quadrant")).toBe("leading");
    expect(host.querySelector('[data-sector-rotation-point="xli"]')?.getAttribute("style")).toContain("left: 50%");
    expect(host.querySelector('[data-sector-rotation-point="xli"]')?.getAttribute("style")).toContain("top: 50%");
    expect(host.querySelector('[data-testid="rotation-inspector"]')?.textContent).toContain("Technology");
    expect(host.querySelector('[data-testid="rotation-inspector"]')?.textContent).toContain("Tactical statewatching for entry");
    expect(host.querySelector('[data-testid="rotation-inspector"]')?.textContent).toContain("+7.0%");
  });
  it("selects exact source ids and opens the same selected sector research", async () => {
    await render();
    await act(async () => (host.querySelector('[data-sector-rotation-point="xlf"]') as HTMLButtonElement).click());
    expect(select).toHaveBeenCalledWith("xlf");
    await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("Open sector research")) as HTMLButtonElement).click());
    expect(research).toHaveBeenCalledWith("xlk");
  });
  it("supports arrow, Home and End movement over the visible map population", async () => {
    await render();
    const first = host.querySelector('[data-sector-rotation-point="xlk"]') as HTMLButtonElement;
    first.focus();
    await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(select).toHaveBeenLastCalledWith("xlf"); expect(document.activeElement?.getAttribute("data-sector-rotation-point")).toBe("xlf");
    const second = document.activeElement as HTMLButtonElement;
    await act(async () => second.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(select).toHaveBeenLastCalledWith("xli"); expect(document.activeElement?.getAttribute("data-sector-rotation-point")).toBe("xli");
  });
  it("renders a list alternative with missing and zero values distinct", async () => {
    await render({ mode: "list" });
    expect(host.querySelectorAll("[data-sector-rotation-row]")).toHaveLength(6);
    const industrials = host.querySelector('[data-sector-rotation-row="xli"]')?.closest("tr");
    const healthcare = host.querySelector('[data-sector-rotation-row="xlv"]')?.closest("tr");
    expect(industrials?.textContent).toContain("0.0%"); expect(healthcare?.textContent).toContain("—");
  });
  it("has recoverable filtering that never removes the selected inspector", async () => {
    await render({ query: "Energy" });
    expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(1);
    expect(host.querySelector('[data-testid="rotation-inspector"]')?.textContent).toContain("Technology");
    await render({ query: "missing" }); expect(host.textContent).toContain("No sectors match this display filter.");
    await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Clear search") as HTMLButtonElement).click());
    expect(query).toHaveBeenCalledWith("");
  });
  it.each(["loading", "access", "invalid", "error", "unavailable"] as const)("clears retained source points after %s", async status => {
    await render(); await render({ status });
    expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(0);
    expect(host.textContent).not.toContain("+7.0%");
  });
  it("connects a truthful daily reconstructed history without changing current coordinates", async () => {
    await render();
    const history = host.querySelector('[data-testid="rotation-history"]');
    expect(history).not.toBeNull();
    expect(history?.textContent).toContain("Reconstructed from sector/SPY price history");
    expect(history?.textContent).toContain("not a record of what Mastermind observed then");
    expect(history?.textContent).toContain("Sep 25");
    expect(history?.textContent).toContain("+7.0%");
    expect(history?.textContent).toContain("+5.0%");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("data-quadrant")).toBe("leading");

    const slider = history?.querySelector('input[type="range"]') as HTMLInputElement;
    await act(async () => {
      slider.value = "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(history?.textContent).toContain("Sep 23");
    expect(history?.textContent).toContain("+2.0%");
    expect(history?.textContent).toContain("+4.0%");
    expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Sep 25 · 6 sectors");
  });

  it("keeps the current snapshot usable when historical owner data is unavailable", async () => {
    await render({ history: null, historyStatus: "unavailable" });
    expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(5);
    expect(host.querySelector('[data-testid="rotation-history"]')?.textContent).toContain("Historical trail unavailable");
    expect(host.textContent).not.toContain("Reconstructed from sector/SPY price history");
  });

  it("uses the shared language provider for answer, map, tactical state and method copy", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("轮动"); expect(host.textContent).toContain("科技是唯一在21日和63日相对强度均为正的板块");
    expect(host.textContent).toContain("战术状态关注入场"); expect(host.textContent).toContain("由板块/SPY历史价格重建");
    expect(host.textContent).not.toContain("Market read");
  });
});

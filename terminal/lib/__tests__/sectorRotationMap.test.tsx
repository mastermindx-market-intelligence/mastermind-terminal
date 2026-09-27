// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorRotationMap, { filterRotationPoints, rotationDomain, rotationQuadrant, sectorRotationPoints, type SectorRotationMapProps } from "@/components/sector-intelligence/SectorRotationMap";
import { LangProvider, applyLang } from "../i18n";
import type { Row } from "../sectorIntelligence";

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
});

describe("SectorRotationMap", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), mode = vi.fn(), query = vi.fn(), research = vi.fn(), sources = vi.fn();
  const render = async (patch: Partial<SectorRotationMapProps> = {}) => {
    const props: SectorRotationMapProps = { rows, status: "ready", asOf: "2026-09-25", selected: "xlk", mode: "map", query: "", onMode: mode, onQuery: query, onSelect: select, onOpenResearch: research, onSources: sources, ...patch };
    await act(async () => root.render(<LangProvider><SectorRotationMap {...props} /></LangProvider>));
  };
  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it("plots only complete coordinates while keeping the full denominator and selected record", async () => {
    await render();
    expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(5);
    expect(host.textContent).toContain("5 / 6");
    expect(host.textContent).toContain("Current source snapshot · no historical trail is inferred");
    expect(host.textContent).toContain("Historical trail is not connected");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("data-quadrant")).toBe("leading");
    expect(host.querySelector('[data-sector-rotation-point="xli"]')?.getAttribute("style")).toContain("left: 50%");
    expect(host.querySelector('[data-sector-rotation-point="xli"]')?.getAttribute("style")).toContain("top: 50%");
    expect(host.querySelector('[data-testid="rotation-inspector"]')?.textContent).toContain("Technology");
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
  it("uses the shared language provider for map, list and method copy", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("轮动图"); expect(host.textContent).toContain("科技");
    expect(host.textContent).toContain("不推断历史轨迹"); expect(host.textContent).not.toContain("Rotation map");
  });
});

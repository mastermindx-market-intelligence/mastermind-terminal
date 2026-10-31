// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorRotationMap, { filterRotationPoints, measuredCoverageReceipt, rotationDomain, rotationHistoryTrail, rotationQuadrant, rotationReceipt, rotationSynthesis, sectorRotationPoints, type SectorRotationMapProps } from "@/components/sector-intelligence/SectorRotationMap";
import { LangProvider, applyLang } from "../i18n";
import { sectorMeasuredRead, sectorRotationHistory, sectorRotationEpisodes, type MeasuredRead, type Row, type FeedPayload } from "../sectorIntelligence";
import measuredReadFixture from "./fixtures/measured_read_v1.json";
import relativeTrendFixture from "./fixtures/sector-rotation-relative-trend.v1.json";
import { sectorRotationRelativeTrend, type SectorRotationRelativeTrend } from "../rotationRelativeTrend";
import { MARKET_RISK_NOW, riskEnvelopeFixture } from "./marketRiskFixture";


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
    [1, 1, "leading"], [-1, 1, "improving"], [-1, -1, "lagging"], [1, -1, "weakening"], [0, 0, null], [0, 1, null], [1, 0, null], [null, 1, null],
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
    expect(rotationReceipt("2026-10-16", 1, "en")).toBe("Oct 16 · 1 sector");
    expect(rotationReceipt("2026-10-16", 1, "zh")).toBe("10月16日 · 1个板块");
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


const nativeEpisodePayload = {
  schema: "rotation_events.v1",
  ok: true,
  as_of: "2026-09-25",
  generated_utc: "2026-09-26 08:00 UTC",
  coldstart: false,
  authority: { tier: "display", may_rank: false, may_gate: false, may_size: false, may_escalate: false },
  active: [], created_tonight: [], closed_tonight: [],
  closed_recent: [{
    event: "closed", sector: "xlk",
    pair_id: "xlk:memory->ai_semis",
    from_leg: "memory", to_leg: "ai_semis",
    from_name_en: "Memory and storage", to_name_en: "AI semiconductors",
    from_name_zh: "存储芯片", to_name_zh: "AI半导体",
    started: "2026-09-12", closed_asof: "2026-09-20",
    ts: "2026-09-21 03:18 UTC", reason: "conditions_lapsed", day_n: 5,
  }],
};

describe("native Rotation Command closed-episode read-only boundary", () => {
  it("admits display-tier owner events with record and observation clocks without claiming natural first-seen", () => {
    const parsed = sectorRotationEpisodes(nativeEpisodePayload);
    expect(parsed?.sourceAsOf).toBe("2026-09-25");
    expect(parsed?.closedRecent).toEqual([{
      sector: "xlk", pairId: "xlk:memory->ai_semis",
      fromKey: "memory", toKey: "ai_semis",
      fromNameEn: "Memory and storage", toNameEn: "AI semiconductors",
      fromNameZh: "存储芯片", toNameZh: "AI半导体",
      started: "2026-09-12", closedAsOf: "2026-09-20",
      recordedAt: "2026-09-21 03:18 UTC", reason: "conditions_lapsed", dayN: 5,
      provenance: "RETAINED_LEDGER_UNMARKED",
    }]);
    const empty = structuredClone(nativeEpisodePayload);
    empty.closed_recent = [];
    expect(sectorRotationEpisodes(empty)?.closedRecent).toEqual([]);
  });

  it("rejects false authority at the envelope and drops forged or malformed rows one at a time", () => {
    const unsafe = structuredClone(nativeEpisodePayload);
    unsafe.authority.may_rank = true;
    expect(sectorRotationEpisodes(unsafe)).toBeNull();
    unsafe.authority.may_rank = false;
    const forged = structuredClone(nativeEpisodePayload);
    forged.closed_recent[0].pair_id = "xlk:memory->software";
    const forgedParsed = sectorRotationEpisodes(forged);
    expect(forgedParsed).not.toBeNull();
    expect(forgedParsed?.closedRecent).toEqual([]);
    expect(forgedParsed?.closedRecentTotal).toBe(1);
    expect(forgedParsed?.closedRecentExcluded).toEqual({ crossPair: 0, invalid: 1 });
    expect((forgedParsed?.closedRecent.length || 0)
      + (forgedParsed?.closedRecentExcluded.crossPair || 0)
      + (forgedParsed?.closedRecentExcluded.invalid || 0))
      .toBe(forgedParsed?.closedRecentTotal);
    const chronologicallyOff = structuredClone(nativeEpisodePayload);
    chronologicallyOff.closed_recent[0].closed_asof = "2026-09-27";
    const chronoParsed = sectorRotationEpisodes(chronologicallyOff);
    expect(chronoParsed).not.toBeNull();
    expect(chronoParsed?.closedRecent).toEqual([]);
    expect(chronoParsed?.closedRecentTotal).toBe(1);
    expect(chronoParsed?.closedRecentExcluded).toEqual({ crossPair: 0, invalid: 1 });
  });

  it("keeps valid owner rows when the source also carries cross-sector closure rows (mixed fixture)", () => {
    const mixed = structuredClone(nativeEpisodePayload);
    (mixed as unknown as { closed_recent: unknown[] }).closed_recent = [
      nativeEpisodePayload.closed_recent[0],
      {
        event: "closed", sector: "xlk",
        pair_id: "xlk:software->ai_semis",
        from_leg: "software", to_leg: "ai_semis",
        from_name_en: "Software", to_name_en: "AI semiconductors",
        from_name_zh: "软件", to_name_zh: "AI半导体",
        started: "2026-09-13", closed_asof: "2026-09-19",
        ts: "2026-09-20 03:18 UTC", reason: "conditions_lapsed", day_n: 5,
      },
      {
        ts: "2026-09-21 03:18 UTC",
        event: "closed",
        pair_id: "xlk->xlu",
        donor: "xlk",
        receiver: "xlu",
        tier: "sector",
        started: "2026-09-10",
        closed_asof: "2026-09-18",
        reason: "ttl",
        day_n: 6,
        from_name_en: "Technology",
        from_name_zh: "科技",
        to_name_en: "Utilities",
        to_name_zh: "公用事业",
      },
      { event: "closed", sector: "xlk" },
    ];
    const parsed = sectorRotationEpisodes(mixed);
    expect(parsed).not.toBeNull();
    expect(parsed?.closedRecent).toHaveLength(2);
    expect(parsed?.closedRecent.map(ep => ep.pairId))
      .toEqual(["xlk:memory->ai_semis", "xlk:software->ai_semis"]);
    expect(parsed?.closedRecentTotal).toBe(4);
    expect(parsed?.closedRecentExcluded).toEqual({ crossPair: 1, invalid: 1 });
    expect((parsed?.closedRecent.length || 0)
      + (parsed?.closedRecentExcluded.crossPair || 0)
      + (parsed?.closedRecentExcluded.invalid || 0))
      .toBe(parsed?.closedRecentTotal);
  });
});

describe("sector rotation historical owner contract", () => {
  it("renders a 21-session trailing path without looking beyond the selected observation or changing axes", () => {
    const series = Array.from({ length: 25 }, (_, i) => ({
      date: "2026-09-" + String(i + 1).padStart(2, "0"), rs21: 2, rs63: 5,
    }));
    const viewed = rotationHistoryTrail(series, 23, 10);
    expect(viewed.points).toHaveLength(21);
    expect(viewed.points[0]).toEqual({ date: "2026-09-04", x: 71.5, y: 41.4 });
    expect(viewed.points.at(-1)?.date).toBe("2026-09-24");
    expect(viewed.points.some(point => point.date === "2026-09-25")).toBe(false);
    expect(viewed.clipped).toBe(false);

    const clipped = rotationHistoryTrail([
      { date: "2026-09-23", rs21: 0, rs63: 0 },
      { date: "2026-09-24", rs21: -30, rs63: 20 },
    ], 1, 10);
    expect(clipped.points.at(-1)).toEqual({ date: "2026-09-24", x: 93, y: 93 });
    expect(clipped.clipped).toBe(true);
  });

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

  it("admits one thin sector as unavailable without discarding valid peer history", () => {
    const partiallyCovered = structuredClone(historyPayload);
    partiallyCovered.sectors[1].rs_history = [];
    const parsed = sectorRotationHistory(partiallyCovered);
    expect(parsed).not.toBeNull();
    expect(parsed?.series.xlf.points).toEqual([]);
    expect(parsed?.series.xlk.points).toHaveLength(3);
    expect(parsed?.series.xlk.points.at(-1)).toEqual({ date: "2026-09-25", rs21: 7, rs63: 5 });
  });

  it("preserves native retrospective price-cycle turn markers without calling them migration episodes", () => {
    const withTurns = {
      ...historyPayload,
      sectors: [
        {
          ...historyPayload.sectors[0],
          turns: [
            { date: "2026-09-22", k: "trough", major: false, provisional: false, mag_pct: 9.2 },
            { date: "2026-09-24", k: "peak", major: true, provisional: true, mag_pct: null },
          ],
        },
        { ...historyPayload.sectors[1], turns: [] as Array<{ date: string; k: string; major: boolean; provisional: boolean; mag_pct: number | null }> },
      ],
    };
    const parsed = sectorRotationHistory(withTurns);
    expect(parsed?.series.xlk.cycleTurns).toEqual([
      { date: "2026-09-22", kind: "trough", major: false, provisional: false, magnitudePct: 9.2 },
      { date: "2026-09-24", kind: "peak", major: true, provisional: true, magnitudePct: null },
    ]);
    expect(parsed?.series.xlf.cycleTurns).toEqual([]);

    const falseFuture = structuredClone(withTurns);
    falseFuture.sectors[0].turns[1].date = "2026-09-26";
    expect(sectorRotationHistory(falseFuture)).toBeNull();
    const backwards = structuredClone(withTurns);
    backwards.sectors[0].turns.reverse();
    expect(sectorRotationHistory(backwards)).toBeNull();
    const invalidKind = structuredClone(withTurns);
    invalidKind.sectors[0].turns[0].k = "migration";
    expect(sectorRotationHistory(invalidKind)).toBeNull();
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

  it("places an exact-zero coordinate on the boundary instead of defaulting it to Leading", async () => {
    await render();
    const xli = host.querySelector('[data-sector-rotation-point="xli"]')!;
    expect(xli.getAttribute("data-placement")).toBe("boundary");
    expect(xli.hasAttribute("data-quadrant")).toBe(false);
    expect(xli.getAttribute("aria-label")).toContain("On the boundary");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("data-placement")).toBe("placed");
    const shelf = host.querySelector('[data-testid="rotation-unplaced"]')!;
    expect(shelf.querySelector('[data-rotation-unplaced="xli"]')?.textContent).toContain("Exactly zero on an axis; drawn on the line, nearest Leading / Improving / Lagging / Weakening.");
    expect(shelf.querySelector('[data-rotation-unplaced="xlv"]')?.textContent).toContain("Not placed · missing");
    expect(shelf.querySelector('[data-rotation-unplaced="xlv"]')?.textContent).toContain("never counted as zero");
    expect(shelf.querySelector('[data-rotation-unplaced="xlk"]')).toBeNull();
    expect(host.querySelector('[data-testid="rotation-context"]')?.textContent).toBe("Relative to SPY · as of 2026-09-25 · 4 placed · 1 on a boundary · 1 not placed");
    expect(host.querySelector("[data-rotation-method]")?.textContent).toContain("5 / 6 coordinates available · 1 missing one or both relative-strength coordinates · 1 on an axis boundary.");
    await render({ mode: "list" });
    expect(host.querySelector('[data-sector-rotation-row="xli"]')?.closest("tr")?.textContent).toContain("On the boundary");
    expect(host.querySelector('[data-sector-rotation-row="xlv"]')?.closest("tr")?.textContent).toContain("Not placed · missing");
  });

  it("keeps the fixed calculation universe under a display filter", async () => {
    await render({ query: "Tech" });
    expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(1);
    expect(host.querySelector('[data-testid="rotation-shown"]')?.textContent).toBe("Showing 1 of 6 · filters never change the numbers");
    expect(host.querySelector('[data-testid="rotation-context"]')?.textContent).toContain("4 placed · 1 on a boundary · 1 not placed");
    expect(host.querySelector('[data-testid="rotation-unplaced"]')).toBeNull();
  });

  it("draws the history trail in plot pixel units without stretching the SVG", async () => {
    await render();
    const trail = host.querySelector('[data-testid="rotation-history-trail"]')!;
    expect(trail.hasAttribute("preserveAspectRatio")).toBe(false);
    expect(trail.getAttribute("viewBox")).toBe("0 0 600 560");
    expect(trail.getAttribute("width")).toBe("600");
    const coords = trail.querySelector("polyline")!.getAttribute("points")!.split(" ").map(pair => pair.split(",").map(Number));
    expect(coords).toHaveLength(3);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(600);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(560);
    }
    expect(coords.some(([x]) => x > 100)).toBe(true);
    expect(trail.querySelector("circle")?.getAttribute("r")).toBe("4");
  });

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

  it("preserves the live map while a selected thin sector has no reconstructed history", async () => {
    const partial = structuredClone(historyPayload);
    partial.sectors[1].rs_history = [];
    const parsed = sectorRotationHistory(partial);
    expect(parsed).not.toBeNull();
    await render({ selected: "xlf", history: parsed, historyStatus: "ready" });
    expect(host.querySelector('[data-testid="rotation-history"]')?.textContent).toContain("Insufficient sector price history (fewer than 210 sessions)");
    expect(host.querySelector('[data-testid="rotation-history"]')?.querySelector("input[type=range]")).toBeNull();
    expect(host.querySelector('[data-sector-rotation-point="xlf"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Sep 25 · 6 sectors");
  });

  it("invalidates selected history index on same-date owner content correction", async () => {
    const first = sectorRotationHistory(historyPayload);
    expect(first).not.toBeNull();
    await render({ history: first, historyRevision: "source-hash-before" });
    let section = host.querySelector('[data-testid="rotation-history"]')!;
    let slider = section.querySelector('input[type="range"]') as HTMLInputElement;
    await act(async () => {
      slider.value = "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(section.textContent).toContain("Sep 23");

    const corrected = structuredClone(historyPayload);
    corrected.sectors[0].rs_history.unshift({
      date: "2026-09-22", rs_21d: -1, rs_63d: 3,
    });
    const next = sectorRotationHistory(corrected);
    expect(next).not.toBeNull();
    await render({ history: next, historyRevision: "source-hash-after" });
    section = host.querySelector('[data-testid="rotation-history"]')!;
    slider = section.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.value).toBe("3");
    expect(section.textContent).toContain("Sep 25");
    expect(section.textContent).toContain("+7.0%");
    expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Sep 25 · 6 sectors");
  });

  it("shows a selected-sector price-reconstructed position trail behind unchanged live points", async () => {
    await render();
    const live = host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("style");
    const trail = host.querySelector('[data-testid="rotation-history-trail"]');
    expect(trail).not.toBeNull();
    expect(trail?.getAttribute("data-selected-date")).toBe("2026-09-25");
    expect(trail?.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(3);
    const slider = host.querySelector<HTMLInputElement>('[data-testid="rotation-history"] input[type="range"]')!;
    await act(async () => {
      slider.value = "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="rotation-history-trail"]')?.getAttribute("data-selected-date")).toBe("2026-09-23");
    expect(host.querySelector('[data-testid="rotation-history-trail"] polyline')?.getAttribute("points")?.split(" ")).toHaveLength(1);
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("style")).toBe(live);
    await render({ history: null, historyStatus: "unavailable" });
    expect(host.querySelector('[data-testid="rotation-history-trail"]')).toBeNull();
  });

  it("discloses a clipped historical path while keeping the exact readout and live axis", async () => {
    const extreme = structuredClone(historyPayload);
    extreme.sectors[0].rs_history[0].rs_63d = 500;
    const parsed = sectorRotationHistory(extreme);
    expect(parsed).not.toBeNull();
    await render({ history: parsed, historyStatus: "ready" });
    const slider = host.querySelector<HTMLInputElement>('[data-testid="rotation-history"] input[type="range"]')!;
    await act(async () => {
      slider.value = "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="rotation-history-trail"]')?.getAttribute("data-clipped")).toBe("true");
    expect(host.querySelector('[data-testid="rotation-history"]')?.textContent).toContain(
      "Historical positions outside the current map scale are clipped"
    );
    expect(host.querySelector('[data-testid="rotation-history"]')?.textContent).toContain("+500.0%");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("data-quadrant")).toBe("leading");
  });

  it("displays date-bound native cycle turns as retrospective evidence, not live migration calls", async () => {
    const withTurns = {
      ...historyPayload,
      sectors: [
        {
          ...historyPayload.sectors[0],
          turns: [
            { date: "2026-09-22", k: "trough", major: false, provisional: false, mag_pct: 9.2 },
            { date: "2026-09-24", k: "peak", major: true, provisional: true, mag_pct: null },
          ],
        },
        historyPayload.sectors[1],
      ],
    };
    await render({ history: sectorRotationHistory(withTurns) });
    const evidence = host.querySelector('[data-testid="rotation-cycle-evidence"]');
    expect(evidence?.textContent).toContain("Retrospective price-cycle turns");
    expect(evidence?.textContent).toContain("not a migration episode or a live-time confirmation");
    expect(evidence?.textContent).toContain("Sep 22");
    expect(evidence?.textContent).toContain("Sep 24");
    expect(evidence?.textContent).toContain("currently provisional");
    const live = host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("style");

    const slider = host.querySelector<HTMLInputElement>('[data-testid="rotation-history"] input[type="range"]')!;
    await act(async () => {
      slider.value = "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(evidence?.textContent).toContain("Sep 22");
    expect(evidence?.textContent).not.toContain("Sep 24");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("style")).toBe(live);
  });


  it("shows owner-native closed handoffs separately from retrospective price-cycle turns", async () => {
    const episodes = sectorRotationEpisodes(nativeEpisodePayload);
    expect(episodes).not.toBeNull();
    await render({ episodes, episodesStatus: "ready" });
    const native = host.querySelector('[data-testid="rotation-native-episodes"]');
    expect(native?.textContent).toContain("Native RC closed episodes");
    expect(native?.textContent).toContain("Sep 25");
    expect(native?.textContent).toContain("Memory and storage");
    expect(native?.textContent).toContain("AI semiconductors");
    expect(native?.textContent).toContain("Sep 20");
    expect(native?.textContent).toContain("not an as-known historical signal");
    expect(native?.textContent).toContain("not an all-clear");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("data-quadrant")).toBe("leading");

    await render({ selected: "xlf", episodes, episodesStatus: "ready" });
    expect(native?.textContent).toContain("No closed episodes for this sector");
    expect(native?.textContent).not.toContain("Memory and storage");
    await render({ episodes: null, episodesStatus: "unavailable" });
    expect(native?.textContent).toContain("Native episode source unavailable");
  });

  it("does not expose later RC closure or receipt when inspecting an earlier historical date", async () => {
    const source = structuredClone(nativeEpisodePayload);
    source.closed_recent.push({
      ...source.closed_recent[0],
      pair_id: "xlk:software->ai_semis",
      from_leg: "software",
      from_name_en: "Software",
      from_name_zh: "软件",
      started: "2026-09-23",
      closed_asof: "2026-09-24",
      ts: "2026-09-25 03:18 UTC",
    });
    source.closed_recent.push({
      ...source.closed_recent[0],
      pair_id: "xlk:memory->software",
      to_leg: "software",
      to_name_en: "Delayed receipt",
      to_name_zh: "迟到记录",
      started: "2026-09-18",
      closed_asof: "2026-09-22",
      ts: "2026-09-25 06:18 UTC",
    });
    const episodes = sectorRotationEpisodes(source);
    expect(episodes?.closedRecent).toHaveLength(3);
    await render({ episodes, episodesStatus: "ready" });
    const section = host.querySelector('[data-testid="rotation-native-episodes"]')!;
    const liveStyle = host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("style");
    expect(section.textContent).toContain("Software");
    expect(section.textContent).toContain("Delayed receipt");
    expect(section.textContent).toContain("Memory and storage");

    const slider = host.querySelector<HTMLInputElement>('[data-testid="rotation-history"] input[type="range"]')!;
    await act(async () => {
      slider.value = "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="rotation-history"] time')?.getAttribute("datetime")).toBe("2026-09-23");
    expect(section.textContent).toContain("Memory and storage");
    expect(section.textContent).not.toContain("Software");
    expect(section.textContent).not.toContain("Delayed receipt");
    expect(section.textContent).toContain("first-seen unverified");
    expect(host.querySelector('[data-sector-rotation-point="xlk"]')?.getAttribute("style")).toBe(liveStyle);

    await act(async () => {
      slider.value = "2";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(section.textContent).toContain("Software");
  });

  it("shows the full year on historical cycle and episode evidence spanning multiple years", async () => {
    const source = structuredClone(historyPayload);
    const turns = [
      { date: "2024-09-16", k: "peak", major: false, provisional: false, mag_pct: 11.2 },
      { date: "2025-05-14", k: "trough", major: false, provisional: false, mag_pct: 18.1 },
      { date: "2026-09-24", k: "peak", major: true, provisional: true, mag_pct: 23.3 },
    ];
    const withTurns = {
      ...source,
      sectors: [{ ...source.sectors[0], turns }, source.sectors[1]],
    };
    await render({
      history: sectorRotationHistory(withTurns),
      episodes: sectorRotationEpisodes(nativeEpisodePayload),
      episodesStatus: "ready",
    });
    const historical = host.querySelector('[data-testid="rotation-history"]')!;
    expect(historical.textContent).toContain("Sep 25, 2026");
    const dates = Array.from(historical.querySelectorAll('[data-testid="rotation-cycle-evidence"] li time'))
      .map(node => node.textContent);
    expect(dates).toEqual(["Sep 16, 2024", "May 14, 2025", "Sep 24, 2026"]);
    const native = host.querySelector('[data-testid="rotation-native-episodes"]')!;
    expect(native.textContent).toContain("Sep 20, 2026");
  });

  it("discloses excluded source closures with a count instead of hiding the section", async () => {
    const mixed = structuredClone(nativeEpisodePayload);
    (mixed as unknown as { closed_recent: unknown[] }).closed_recent = [
      nativeEpisodePayload.closed_recent[0],
      {
        event: "closed", sector: "xlk",
        pair_id: "xlk:software->ai_semis",
        from_leg: "software", to_leg: "ai_semis",
        from_name_en: "Software", to_name_en: "AI semiconductors",
        from_name_zh: "软件", to_name_zh: "AI半导体",
        started: "2026-09-13", closed_asof: "2026-09-19",
        ts: "2026-09-20 03:18 UTC", reason: "conditions_lapsed", day_n: 5,
      },
      {
        ts: "2026-09-21 03:18 UTC",
        event: "closed",
        pair_id: "xlk->xlu",
        donor: "xlk",
        receiver: "xlu",
        tier: "sector",
        started: "2026-09-10",
        closed_asof: "2026-09-18",
        reason: "ttl",
        day_n: 6,
        from_name_en: "Technology",
        from_name_zh: "科技",
        to_name_en: "Utilities",
        to_name_zh: "公用事业",
      },
      { event: "closed", sector: "xlk" },
    ];
    const mixedEpisodes = sectorRotationEpisodes(mixed);
    expect(mixedEpisodes).not.toBeNull();
    await render({ episodes: mixedEpisodes, episodesStatus: "ready" });
    const mixedSection = host.querySelector('[data-testid="rotation-native-episodes"]')!;
    expect(mixedSection.textContent).not.toContain("Native episode source unavailable");
    expect(mixedSection.textContent).toContain("Memory and storage");
    const excluded = host.querySelector('[data-testid="rotation-native-episodes-excluded"]') as HTMLElement;
    expect(excluded).not.toBeNull();
    expect(excluded.textContent).toContain("not shown here");
    expect(excluded.textContent?.trim().endsWith("2")).toBe(true);
    expect(excluded.getAttribute("data-excluded-cross-pair")).toBe("1");
    expect(excluded.getAttribute("data-excluded-invalid")).toBe("1");

    const plainEpisodes = sectorRotationEpisodes(nativeEpisodePayload);
    expect(plainEpisodes).not.toBeNull();
    await render({ episodes: plainEpisodes, episodesStatus: "ready" });
    expect(host.querySelector('[data-testid="rotation-native-episodes-excluded"]')).toBeNull();

    const zhEpisodes = sectorRotationEpisodes(mixed);
    expect(zhEpisodes).not.toBeNull();
    await render({ episodes: zhEpisodes, episodesStatus: "ready" });
    await act(async () => applyLang("zh"));
    const zhExcluded = host.querySelector('[data-testid="rotation-native-episodes-excluded"]') as HTMLElement;
    expect(zhExcluded).not.toBeNull();
    expect(zhExcluded.textContent).toContain("未在此显示");
    expect(zhExcluded.textContent?.trim().endsWith("2")).toBe(true);
  });

  it("keeps the current snapshot usable when historical owner data is unavailable", async () => {
    await render({ history: null, historyStatus: "unavailable" });
    expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(5);
    expect(host.querySelector('[data-testid="rotation-history"]')?.textContent).toContain("Historical trail unavailable");
    expect(host.textContent).not.toContain("Reconstructed from sector/SPY price history");
  });
  it("keeps early risk context independent of map coordinates and uses its own source date", async () => {
    vi.spyOn(Date, "now").mockReturnValue(MARKET_RISK_NOW);
    await render();
    const positions = Array.from(host.querySelectorAll("[data-sector-rotation-point]")).map(point => point.getAttribute("style"));
    const risk: FeedPayload = { data: riskEnvelopeFixture(), receipt: { source: "risk", status: "ready",
      path: "/riskdata/risk_envelope.json", asOf: "2026-10-07", observedAt: "2026-10-08T12:00:00Z", stale: false, contentHash: "fixture" } };
    await render({ risk });
    expect(host.querySelector('[data-testid="rotation-risk-context"]')?.textContent).toContain("Mixed · Early rotation: Defensive relative strength · 2026-10-07");
    expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Sep 25 · 6 sectors");
    expect(Array.from(host.querySelectorAll("[data-sector-rotation-point]")).map(point => point.getAttribute("style"))).toEqual(positions);
    expect(host.querySelector('[data-testid="rotation-risk-detail"]')?.textContent).toContain("Statistical independence is unproven");
    expect(host.querySelector('[data-testid="rotation-risk-detail"]')?.textContent).toContain("2026-09-29 → 2026-09-30");
    await act(async () => applyLang("zh"));
    expect(host.querySelector('[data-testid="rotation-risk-context"]')?.textContent).toContain("防御板块相对走强");
    expect(host.querySelector('[data-testid="rotation-risk-detail"]')?.textContent).toContain("无法给出剔除重复后的总数");
    await render({ risk: { ...risk, data: null, receipt: { ...risk.receipt, stale: true } } });
    expect(host.querySelector('[data-testid="rotation-risk-context"]')?.textContent).toContain("不可用");
    expect(host.querySelector('[data-testid="rotation-risk-detail"]')?.textContent).toContain("2026-10-07");
    expect(Array.from(host.querySelectorAll("[data-sector-rotation-point]")).map(point => point.getAttribute("style"))).toEqual(positions);
  });

  it("uses the shared language provider for answer, map, tactical state and method copy", async () => {
    await render(); await act(async () => applyLang("zh"));
    expect(host.textContent).toContain("轮动"); expect(host.textContent).toContain("科技是唯一在21日和63日相对强度均为正的板块");
    expect(host.textContent).toContain("战术状态关注入场"); expect(host.textContent).toContain("由板块/SPY历史价格重建");
    expect(host.textContent).not.toContain("Market read");
  });
});

describe("Options R1 W2A — explicit relative trend method on the rotation map", () => {
  let root: Root, host: HTMLDivElement;
  const select = vi.fn(), mode = vi.fn(), query = vi.fn(), research = vi.fn(), sources = vi.fn(), method = vi.fn();
  const trend = sectorRotationRelativeTrend(relativeTrendFixture) as SectorRotationRelativeTrend;
  const render = async (patch: Partial<SectorRotationMapProps> = {}) => {
    const props: SectorRotationMapProps = { rows, status: "ready", asOf: "2026-09-25", selected: "xlk", mode: "map", query: "", history: sectorRotationHistory(historyPayload), historyStatus: "ready", onMode: mode, onQuery: query, onSelect: select, onOpenResearch: research, onSources: sources, ...patch };
    await act(async () => root.render(<LangProvider><SectorRotationMap {...props} /></LangProvider>));
  };
  const trendProps = (patch: Partial<SectorRotationMapProps> = {}): Partial<SectorRotationMapProps> =>
    ({ method: "relative_trend_ema", relativeTrend: trend, relativeTrendStatus: "ready", onMethod: method, ...patch });
  const testId = (id: string) => host.querySelector(`[data-testid="${id}"]`);
  const point = (id: string) => host.querySelector<HTMLButtonElement>(`[data-sector-rotation-point="${id}"]`);
  const snapshot = () => ({
    points: [...host.querySelectorAll<HTMLButtonElement>("[data-sector-rotation-point]")].map(node => [node.dataset.sectorRotationPoint, node.getAttribute("aria-label"), node.getAttribute("style")]),
    receipt: testId("rotation-receipt")?.textContent, context: testId("rotation-context")?.textContent,
    shown: testId("rotation-shown")?.textContent, answer: testId("rotation-answer")?.textContent,
    inspector: testId("rotation-inspector")?.textContent, method: host.querySelector("[data-rotation-method]")?.textContent,
    scale: host.querySelector(`.${"scale"}`)?.textContent,
  });
  beforeEach(() => {
    vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it("offers an explicit method switch with the incumbent relative return as the default", async () => {
    await render({ method: "incumbent", relativeTrend: trend, relativeTrendStatus: "ready", onMethod: method });
    const group = host.querySelector('[role="group"][aria-label="Rotation method"]')!;
    const buttons = [...group.querySelectorAll("button")];
    expect(buttons.map(button => button.textContent)).toEqual(["Relative return · 63/21", "Relative trend · weekly EMA"]);
    expect(buttons.map(button => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(testId("rotation-context")?.textContent).toContain("Relative to SPY · as of 2026-09-25");
    expect(point("xlk")?.getAttribute("aria-label")).toContain("21-session RS vs SPY: +7.0%");
    await act(async () => buttons[1].click());
    expect(method).toHaveBeenCalledWith("relative_trend_ema");
  });

  it("plots the relative trend centred on 100 and reads one value and one date across chart, list, inspector and receipt", async () => {
    await render(trendProps());
    expect(testId("rotation-receipt")?.textContent).toBe("Oct 16 · 6 sectors");
    expect(testId("rotation-context")?.textContent).toBe("Relative trend vs SPY · completed weeks · as of 2026-10-16 · 4 placed · 1 on a boundary · 1 not placed");
    expect(testId("rotation-shown")?.textContent).toBe("Showing 6 of 6 · filters never change the numbers · relative trend · weekly EMA · vintage 7c1f5b2e · completed weeks only, no back-shift");
    expect(testId("rotation-answer")?.textContent).toContain("2 sectors are above 100 on both relative trend and trend momentum. Technology has the strongest relative trend, and its momentum is above 100.");
    const label = point("xlk")?.getAttribute("aria-label");
    expect(label).toBe("Technology (XLK), Leading, Trend momentum: 101.10, Relative trend: 104.00, Week ending Oct 16, 2026");
    expect(host.querySelectorAll("[data-sector-rotation-point]").length).toBe(5);
    expect(point("xle")?.dataset.placement).toBe("boundary");
    expect(point("xli")).toBeNull();
    const plot = testId("rotation-plot")!;
    expect(plot.textContent).toContain("Stronger relative trend →"); expect(plot.textContent).toContain("Momentum rising ↑");
    expect(plot.textContent).not.toContain("quarter trend");
    const scale = [...host.querySelectorAll("[data-testid='rotation-scale'] span")].map(node => node.textContent);
    expect(scale[1]).toBe("100"); expect(scale[0]).toMatch(/^9\d\.\d$/); expect(scale[2]).toMatch(/^10\d\.\d$/);
    const inspector = testId("rotation-inspector")!.textContent!;
    expect(inspector).toContain("104.00"); expect(inspector).toContain("101.10"); expect(inspector).toContain("Oct 16, 2026"); expect(inspector).toContain("Measured");
    expect(inspector).not.toContain("63-session");
    await render(trendProps({ mode: "list" }));
    const row = host.querySelector('[data-sector-rotation-row="xlk"]')!.closest("tr")!;
    expect([...row.querySelectorAll("td")].map(cell => cell.textContent)).toEqual(["101.10", "104.00", "Leading", "Oct 16, 2026"]);
    expect(host.querySelector("thead")?.textContent).toContain("Week ending");
  });

  it("draws the 12-week trail as separate runs that break at a week that could not be measured", async () => {
    await render(trendProps({ selected: "xlf" }));
    const trail = testId("rotation-trend-trail")!;
    expect(trail.getAttribute("data-runs")).toBe("2"); expect(trail.getAttribute("data-weeks")).toBe("11");
    expect(trail.querySelectorAll("polyline").length).toBe(2);
    expect(trail.querySelectorAll("circle").length).toBe(1);
    expect(testId("rotation-history")).toBeNull();
    expect(host.textContent).toContain("trailing 12 completed weeks");
  });

  it("lists non-measured weeks on the shelf with plain reasons instead of plotting them as 100", async () => {
    await render(trendProps({ relativeTrend: { ...trend, asOf: "2026-10-02" }, selected: "xlu" }));
    expect(testId("rotation-receipt")?.textContent).toBe("Oct 2 · 6 sectors");
    expect(point("xlu")).toBeNull();
    const shelf = testId("rotation-unplaced")!.textContent!;
    expect(shelf).toContain("XLU"); expect(shelf).toContain("Warming up"); expect(shelf).toContain("fewer than 120 completed weeks since 2016-01-01");
    expect(shelf).toContain("XLI"); expect(shelf).toContain("not in the relative trend feed");
    const inspector = testId("rotation-inspector")!.textContent!;
    expect(inspector).toContain("Warming up"); expect(inspector).toContain("Oct 2, 2026"); expect(inspector).not.toContain("100.00");
    expect(testId("rotation-answer")?.textContent).toContain("1 sector is still warming up.");
  });

  it("never relabels or re-plots the other method's coordinates when switching back and forth", async () => {
    await render();
    const untouched = snapshot();
    await render({ method: "incumbent", relativeTrend: trend, relativeTrendStatus: "ready", onMethod: method });
    const before = snapshot();
    expect(before).toEqual(untouched);
    await render(trendProps());
    const during = snapshot();
    expect(during.points.find(entry => entry[0] === "xlk")?.[1]).not.toBe(before.points.find(entry => entry[0] === "xlk")?.[1]);
    expect(during.points.find(entry => entry[0] === "xlk")?.[2]).not.toBe(before.points.find(entry => entry[0] === "xlk")?.[2]);
    expect(during.method).toContain("present-day"); expect(during.method).toContain("not a five-percent forecast");
    expect(during.method).toContain("completed weeks");
    await render({ method: "incumbent", relativeTrend: trend, relativeTrendStatus: "ready", onMethod: method });
    expect(snapshot()).toEqual(before);
  });

  it("keeps the switch usable and names the way back when the relative trend feed is unavailable", async () => {
    await render(trendProps({ relativeTrend: null, relativeTrendStatus: "unavailable" }));
    const block = testId("rotation-method-unavailable")!;
    expect(block.textContent).toContain("relative return method remains available");
    expect(host.querySelectorAll("[data-sector-rotation-point]").length).toBe(0);
    expect(host.querySelector('[role="group"][aria-label="Rotation method"]')).not.toBeNull();
    await act(async () => block.querySelector("button")!.click());
    expect(method).toHaveBeenCalledWith("incumbent");
    await render(trendProps({ relativeTrend: null, relativeTrendStatus: "loading" }));
    expect(testId("rotation-method-unavailable")?.textContent).toContain("loading");
  });

  it("renders the relative trend method in Chinese through the shared language provider", async () => {
    await render(trendProps());
    await act(async () => applyLang("zh"));
    expect(host.querySelector('[role="group"][aria-label="轮动方法"]')?.textContent).toBe("相对收益 · 63/21相对趋势 · 周EMA");
    expect(testId("rotation-context")?.textContent).toContain("相对 SPY 的趋势 · 已完成周 · 截至 2026-10-16");
    expect(testId("rotation-plot")?.textContent).toContain("相对趋势更强 →");
    expect(point("xlk")?.getAttribute("aria-label")).toBe("科技 (XLK), 领先, 趋势动量: 101.10, 相对趋势: 104.00, 周截至 2026年10月16日");
    expect(testId("rotation-answer")?.textContent).toContain("2个板块的相对趋势和趋势动量均高于100。");
    expect(host.textContent).not.toContain("Relative trend ·");
  });
});

describe("measured coverage receipt on the rotation view", () => {
  const read: MeasuredRead = sectorMeasuredRead({ as_of: "2026-10-09", measured_read: measuredReadFixture });
  const EN_OK = "Measured 9 of 11 sectors · not measured: Real Estate (no price data for this sector today), Utilities (not enough price history yet)";
  const ZH_OK = "已测 9 / 11 个板块 · 未测：房地产（今日缺少该板块价格数据）、公用事业（价格历史不足）";

  it("renders one plain-word coverage line with owner reasons translated, never raw codes or zero", () => {
    expect(measuredCoverageReceipt(read, "2026-10-09", "en")).toBe(EN_OK);
    expect(measuredCoverageReceipt(read, "2026-10-09", "zh")).toBe(ZH_OK);
    for (const line of [EN_OK, ZH_OK]) {
      expect(line).not.toContain("missing_input");
      expect(line).not.toContain("thin_history");
      expect(line).not.toContain("0.0");
      expect(line).not.toContain("NaN");
      expect(line).not.toContain("undefined");
    }
  });

  it("marks a stale measured read against the page date and keeps outage, invalid and absent distinct", () => {
    expect(measuredCoverageReceipt(read, "2026-10-10", "en")).toContain("measured 2026-10-09, older than this page");
    expect(measuredCoverageReceipt(read, "2026-10-09", "en")).not.toContain("older than this page");
    expect(measuredCoverageReceipt(read, "2026-10-10", "zh")).toContain("实测于 2026-10-09，早于本页");
    const outage = measuredCoverageReceipt({ ...read, state: "outage" }, "2026-10-10", "en");
    expect(outage).toBe("Measured read could not be produced today.");
    expect(measuredCoverageReceipt({ ...read, state: "outage" }, "2026-10-10", "zh")).toBe("今日未能生成实测读数。");
    expect(measuredCoverageReceipt({ ...read, state: "invalid" }, "2026-10-10", "en")).toBe("Measured read could not be checked, so it is not shown.");
    expect(measuredCoverageReceipt({ ...read, state: "invalid" }, "2026-10-10", "zh")).toBe("实测读数无法校验，因此不显示。");
    expect(measuredCoverageReceipt({ ...read, state: "absent" }, "2026-10-10", "en")).toBeNull();
    expect(measuredCoverageReceipt(null, "2026-10-10", "en")).toBeNull();
    expect(measuredCoverageReceipt(undefined, "2026-10-10", "en")).toBeNull();
  });

  describe("SectorRotationMap measured line render", () => {
    let root: Root, host: HTMLDivElement;
    const select = vi.fn(), mode = vi.fn(), query = vi.fn(), research = vi.fn(), sources = vi.fn();
    const render = async (patch: Partial<SectorRotationMapProps> = {}) => {
      const props: SectorRotationMapProps = { rows, status: "ready", asOf: "2026-10-09", selected: "xlk", mode: "map", query: "",
        history: sectorRotationHistory(historyPayload), historyStatus: "ready",
        onMode: mode, onQuery: query, onSelect: select, onOpenResearch: research, onSources: sources, ...patch };
      await act(async () => root.render(<LangProvider><SectorRotationMap {...props} /></LangProvider>));
    };
    beforeEach(() => {
      vi.clearAllMocks(); document.documentElement.setAttribute("data-lang", "en");
      host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    });
    afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

    it("shows the coverage receipt next to the rotation receipt when the measured read is ready", async () => {
      await render({ measured: read });
      expect(host.querySelector('[data-testid="rotation-measured-coverage"]')?.textContent).toBe(EN_OK);
      expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Oct 9 · 6 sectors");
      await render({ measured: null });
      expect(host.querySelector('[data-testid="rotation-measured-coverage"]')).toBeNull();
      expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Oct 9 · 6 sectors");
    });

    it.each(["error", "invalid", "unavailable"] as const)("keeps the live map clickable when the history owner is %s", async historyStatus => {
      await render({ history: null, historyStatus });
      expect(host.querySelectorAll("[data-sector-rotation-point]")).toHaveLength(5);
      expect(host.querySelector('[data-testid="rotation-receipt"]')?.textContent).toBe("Oct 9 · 6 sectors");
      await act(async () => (host.querySelector('[data-sector-rotation-point="xlf"]') as HTMLButtonElement).click());
      expect(select).toHaveBeenCalledWith("xlf");
    });
  });
});

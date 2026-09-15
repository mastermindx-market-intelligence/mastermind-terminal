import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeCandleSeries, candleVolumeRank, CANDLE_PAINTER_MODULE } from "@/lib/suites/trend/candlePainter";
import type { ModuleCtx, SuiteBar, SuiteColors } from "@/lib/indicator-canvas/types";

const bars = (): SuiteBar[] => Array.from({ length: 240 }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 11) + i * .03;
  return { t: 1700000000 + i * 86400, o: c - .7, h: c + 1, l: c - 1, c: i === 55 ? NaN : c, v: i % 49 === 0 ? 0 : 100 + ((i * 31) % 100) * 15 };
});
const colors = Object.fromEntries(["up", "down", "flowBuy", "flowSell", "warn", "brand", "text", "muted", "neutral"].map((k) => [k, k])) as unknown as SuiteColors;
const before = {
  trend: "7c229b1a51b11c35bde96817b8270d1ea343786b434147844a19a5858ad1259c",
  momentum: "b58ea122e7e92453e7b3c7e0d150a06b1dd231cb4d5098dea7ecb14bdc8e8905",
  trendVolume: "4f704a2a13028c65e3959f4fe1c5c49ffdd8e0ae547a5e4cace01b916d2da116",
  momentumVolume: "9512088d5cfe8d1d6e6d79aa0839a86803eb7f2f304400fd6af5f39fc9b819e1",
};

describe("canonical candle facts, never a second signal engine", () => {
  it.each(Object.entries(before))("preserves every paint byte from pre-refactor %s", (mode, hash) => {
    const ctx: ModuleCtx = { bars: bars(), s: { mode }, suite: {}, tf: "D", symbol: "TEST", isIntraday: false, lang: "en", colors };
    expect(createHash("sha256").update(JSON.stringify(CANDLE_PAINTER_MODULE.compute(ctx))).digest("hex")).toBe(hash);
  });
  it("is prefix invariant for every bar and every mode, including warm-up and invalid prices", () => {
    const data = bars();
    for (const mode of Object.keys(before)) {
      const all = analyzeCandleSeries(data, mode);
      for (const end of [1, 14, 15, 20, 49, 50, 55, 56, 100, 180]) {
        expect(analyzeCandleSeries(data.slice(0, end), mode)).toEqual(all.slice(0, end));
      }
    }
  });
  it("exposes missing/warming/neutral separately while paint retains its old fallback", () => {
    const data = bars(); const out = analyzeCandleSeries(data);
    expect(out[0].state).toBe("warming");
    expect(out[55].state).toBe("missing");
    expect(out[55].rsi14).toBeNull();
    const flat = data.map((bar) => ({ ...bar, o: 100, h: 100, l: 100, c: 100 }));
    expect(analyzeCandleSeries(flat)[25].state).toBe("neutral");
  });
  it("excludes the current volume and refuses zero, missing or short baselines", () => {
    const data = bars().map((bar, i) => ({ ...bar, v: i + 1 }));
    expect(candleVolumeRank(data, 19).percentile).toBeNull();
    expect(candleVolumeRank(data, 20)).toEqual({ percentile: 1, samples: 20 });
    data[20].v = 10;
    expect(candleVolumeRank(data, 20)).toEqual({ percentile: .5, samples: 20 });
    data[20].v = 0;
    expect(candleVolumeRank(data, 20).percentile).toBeNull();
    data[20].v = NaN;
    expect(candleVolumeRank(data, 20).percentile).toBeNull();
    expect(candleVolumeRank(data, 200).samples).toBe(100);
  });
  it("recomputes a historical correction instead of memoizing array identity", () => {
    const data = bars(); const original = analyzeCandleSeries(data);
    data[80].c += 10;
    const corrected = analyzeCandleSeries(data);
    expect(corrected.slice(0, 80)).toEqual(original.slice(0, 80));
    expect(corrected[81].rsi14).not.toBe(original[81].rsi14);
  });
});


import { buildVisualSeries, chartDay, participationColor, visualCalendar, visualOverlayBundle, visualReadout, visualSettings,
  VISUAL_INTELLIGENCE_DEFAULTS, EMPTY_VISUAL_CALENDAR } from "@/lib/visualIntelligence";
import { visualSynthesis, visualText } from "@/lib/visualIntelligenceCopy";
import type { Bar, Fund } from "@/lib/fund";
import { ensureSuiteRuntime, peekSuiteRuntime } from "@/lib/suites/compute";
const chartBars = (): Bar[] => bars().map(({ t, ...bar }) => ({ ...bar, time: t }));
const fundFixture = (): Fund => ({
  ticker: "TEST", asof: "2026-09-15", earnings: { next_date: "2026-10-21", q: [
    { report_date: "2023-12-03" }, { report_date: "2024-02-31" }, { report_date: null }, { report_date: "2023-12-03" },
  ] }, dividends: { events: [{ ex: "2023-12-15" }], splits: [{ date: "2024-01-05" }] },
} as unknown as Fund);

describe("explainable chart projection", () => {
  it("uses only the previous twenty price bars and does not include a breakout bar", () => {
    const data = chartBars().map((b, i) => ({ ...b, o: i + 1, c: i + 1, h: i + 2, l: i }));
    data[20] = { ...data[20], h: 10000, l: -10000 };
    const all = buildVisualSeries("TEST", "3D", data, "momentum");
    expect(all.facts[19].priorHigh20).toBeNull();
    expect(all.facts[20].priorHigh20).toBe(21);
    expect(all.facts[20].priorLow20).toBe(0);
    expect(all.facts[21].priorHigh20).toBe(10000);
    expect(buildVisualSeries("TEST", "3D", data.slice(0, 40), "momentum").facts).toEqual(all.facts.slice(0, 40));
  });
  it("copies source bars, distinguishes unknown metrics from zero and indexes exact plotted times", () => {
    const data = chartBars(); const series = buildVisualSeries("TEST", "3D", data, "momentum");
    expect(series.indexByTime.get(String(data[100].time))).toBe(100);
    expect(visualReadout(series.facts[0])["mc.rsi14"]).toBeNull();
    expect(visualReadout(series.facts[0])["mc.volumeSamples"]).toBe(0);
    data[100].c = 99999;
    expect(series.bars[100].c).not.toBe(99999);
    expect(series.facts[55].close).toBeNull();
    expect(series.facts[56].priorHigh20).toBeNull();
  });
  it("keeps zero and unknown volume unpainted and preserves the existing directional hue/alpha", () => {
    expect(participationColor("rgba(10,20,30,0.5)", 0)).toBe("rgba(10,20,30,0.175)");
    expect(participationColor("rgba(10,20,30,0.5)", 1)).toBe("rgba(10,20,30,0.5)");
    expect(participationColor("#102030", null)).toBe("#102030");
    expect(participationColor("custom-color", .1)).toBe("custom-color");
    expect(participationColor("#102030", 1)).toBe("rgba(16,32,48,1)");
  });
  it("accepts only actual boolean preferences; optional layers are off without overwriting candle mode", () => {
    expect(visualSettings({ visualContext: false, visualLevels: "true" as never })).toEqual({ ...VISUAL_INTELLIGENCE_DEFAULTS, visualContext: false });
  });
  it("never promotes a neutral, missing or divergent read into a forecast/confidence number", () => {
    const fact = buildVisualSeries("TEST", "D", chartBars(), "momentum").facts[100];
    expect(visualSynthesis({ ...fact, state: "up", trend: "down", momentum: "up" }, "en")).toContain("inside a downward trend");
    expect(visualSynthesis({ ...fact, state: "missing" }, "en")).toBe("Price unavailable");
    expect(visualSynthesis({ ...fact, state: "missing" }, "zh")).not.toMatch(/[a-zA-Z]/);
    expect(visualText("volumeBasis", "en")).toContain("earlier");
  });
});

describe("dated calendar boundaries and bounded original chart rendering", () => {
  it("validates dates, deduplicates, and keeps scheduled dates marked provisional", () => {
    const calendar = visualCalendar(fundFixture(), "TEST", false);
    expect(calendar.events).toHaveLength(4);
    expect(calendar.events.filter((e) => e.scheduled)).toEqual([{ kind: "earnings", date: "2026-10-21", scheduled: true }]);
    expect(calendar.asof).toBe("2026-09-15");
    expect(calendar.events.some((e) => e.date === "2024-02-31")).toBe(false);
  });
  it("withholds current-calendar facts in replay, and fails closed on a wrong-symbol payload", () => {
    expect(visualCalendar(fundFixture(), "TEST", true)).toEqual({ state: "withheld", asof: null, events: [] });
    expect(visualCalendar(fundFixture(), "NVDA", false)).toEqual(EMPTY_VISUAL_CALENDAR);
    expect(visualCalendar(null, "TEST", false)).toEqual(EMPTY_VISUAL_CALENDAR);
    expect(chartDay(1e30)).toBeNull();
    expect(chartDay("2024-02-31")).toBeNull();
  });
  it("draws optional layers through the existing primitive contract, with a hard cap and exact-date tips", () => {
    const series = buildVisualSeries("TEST", "D", chartBars(), "momentum");
    const settings = { ...VISUAL_INTELLIGENCE_DEFAULTS, visualRegime: true, visualLevels: true, visualEvents: true };
    const calendar = visualCalendar(fundFixture(), "TEST", false);
    const bundle = visualOverlayBundle(series, settings, colors, { i0: 0, i1: 239 }, null, calendar, false, "en");
    expect(bundle.prims.length).toBeLessThanOrEqual(144);
    expect(bundle.prims.some((p) => p.id.startsWith("visual:event:"))).toBe(true);
    expect(bundle.prims.filter((p) => p.kind === "line")).toHaveLength(2);
    expect(bundle.candlePaint).toHaveLength(0);
    expect(bundle.events).toHaveLength(0);
    expect([...bundle.tooltips.values()].some((t) => t.rows.some((r) => r.v.includes("not point-in-time")))).toBe(true);
    const replay = visualOverlayBundle(series, settings, colors, { i0: 0, i1: 239 }, null, calendar, true, "en");
    expect(replay.prims.some((p) => p.id.startsWith("visual:event:"))).toBe(false);
    const historical = visualOverlayBundle(series, settings, colors, { i0: 0, i1: 239 }, 100, calendar, false, "en");
    expect(historical.prims.some((p) => p.id.startsWith("visual:event:"))).toBe(false);
    expect(visualOverlayBundle(series, { ...settings, visualContext: false }, colors, { i0: 0, i1: 239 }, null, calendar, false, "en").prims).toEqual([]);
  });
  it("loads only the canonical free candle module before a deliberate full-suite upgrade", async () => {
    const candles = await ensureSuiteRuntime("trend", "candles");
    expect(candles?.key).toBe("trend");
    expect(candles?.modules).toEqual([CANDLE_PAINTER_MODULE]);
    expect(peekSuiteRuntime("trend", "candles")).toBe(candles);
    const full = await ensureSuiteRuntime("trend");
    expect(full?.modules.length).toBeGreaterThan(1);
    expect(full?.modules.find((m) => m.key === "cp")).toBe(CANDLE_PAINTER_MODULE);
    expect(peekSuiteRuntime("trend", "candles")).toBe(candles);
  });
});


import { clearSuiteMemo, computeSuite } from "@/lib/indicator-canvas/host";
describe("paint/context correction parity through the real suite host", () => {
  it("invalidates same-length same-last-time content changes, including in-place historical corrections", async () => {
    clearSuiteMemo();
    const def = (await ensureSuiteRuntime("trend", "candles"))!;
    const data = chartBars();
    const input = { bars: data, tf: "D", symbol: "CORRECTION", isIntraday: false, lang: "en" as const };
    const before = computeSuite(def, { "cp.on": true, "cp.mode": "momentum" }, input, "free", colors);
    expect(computeSuite(def, { "cp.on": true, "cp.mode": "momentum" }, { ...input, bars: data.map((b) => ({ ...b })) }, "free", colors)).toBe(before);
    data[80] = { ...data[80], c: data[80].c + 30, h: data[80].h + 31 };
    const after = computeSuite(def, { "cp.on": true, "cp.mode": "momentum" }, input, "free", colors);
    expect(after).not.toBe(before);
    expect(after.candlePaint.slice(0, 80)).toEqual(before.candlePaint.slice(0, 80));
    expect(after.candlePaint).not.toEqual(before.candlePaint);
  });
});

import { describe, expect, it } from "vitest";
import {
  NINE_BAR_RESEARCH_SETTINGS,
  analyzeNineBarSeries,
  buildNineBarResearchReport,
  matchPrimaryNines,
  summarizeObservations,
  type ResearchBar,
  type ResearchSeries,
  type SeriesResearchResult,
} from "../nineBarResearch";

const day = 86_400;
const bars = (closes: number[], start = 1_700_000_000): ResearchBar[] => closes.map((c, i) => ({
  t: start + i * day,
  label: new Date((start + i * day) * 1000).toISOString().slice(0, 10),
  o: c,
  h: c + 0.6,
  l: c - 0.6,
  c,
  v: 1_000 + i,
}));

const series = (symbol: string, closes: number[], market: "us" | "crypto" = "us"): ResearchSeries => ({
  symbol,
  market,
  benchmark: market === "us" ? "SPY" : "BTC-USD",
  source: "fixture",
  bars: bars(closes),
});

const trend = (n: number, start = 100, step = 1) => Array.from({ length: n }, (_, i) => start + i * step);

describe("nine-bar research engine", () => {
  it("rejects malformed, duplicate, and reverse chronological bars", () => {
    const valid = series("X", trend(40));
    expect(() => analyzeNineBarSeries({ ...valid, bars: [valid.bars[0], valid.bars[0]] })).toThrow(/strictly increasing/);
    expect(() => analyzeNineBarSeries({ ...valid, bars: [...valid.bars].reverse() })).toThrow(/strictly increasing/);
    const bad = valid.bars.map((bar) => ({ ...bar }));
    bad[4].h = bad[4].l - 1;
    expect(() => analyzeNineBarSeries({ ...valid, bars: bad })).toThrow(/malformed OHLCV/);
  });

  it("uses the canonical kernel to identify endpoint 6–11 and the first nine at index 12", () => {
    const out = analyzeNineBarSeries(series("UP", trend(60)));
    const first = out.observations.filter((row) => row.episode === 1 && !row.repeatCycle && row.endpoint >= 6 && row.endpoint <= 11);
    expect(first.map((row) => [row.endpoint, row.i])).toEqual([
      [6, 9], [7, 10], [8, 11], [9, 12], [10, 13], [11, 14],
    ]);
    const nine = first.find((row) => row.endpoint === 9)!;
    expect(nine).toMatchObject({ direction: "rising", reversalDirection: "down", primary: true, repeatCycle: false });
    expect(nine.kernelEventId).toContain("nine-bar-v1.0.0|UP|1d|daily|rising|1");
  });

  it("reports repeat-cycle nines separately at absolute streak 18", () => {
    const out = analyzeNineBarSeries(series("UP", trend(70)));
    const nines = out.observations.filter((row) => row.endpoint === 9);
    expect(nines.map((row) => [row.absoluteStreak, row.repeatCycle])).toEqual([[9, false], [18, true], [27, true], [36, true], [45, true], [54, true], [63, true]]);
  });

  it("starts outcomes at the next open and treats same-bar ATR threshold order as ambiguous", () => {
    const closes = trend(50);
    const fixture = series("AMB", closes);
    // The repeat-cycle nine at index 21 has ATR history. Its next open is 122 and both thresholds touch.
    fixture.bars[22] = { ...fixture.bars[22], o: 122, h: 130, l: 114, c: 123 };
    const out = analyzeNineBarSeries(fixture);
    const nine = out.observations.find((row) => row.absoluteStreak === 18)!;
    const h1 = nine.outcomes.find((row) => row.horizon === 1)!;
    expect(h1.entryI).toBe(22);
    expect(h1.entry).toBe(122);
    expect(h1.ambiguous).toBe(true);
    expect(h1.meaningfulReversal).toBeNull();
    expect(h1.continuation).toBeNull();
  });

  it("keeps non-ATR outcomes measurable when event-bar ATR is not warmed up yet", () => {
    const out = analyzeNineBarSeries(series("EARLY", trend(40)));
    const nine = out.observations.find((row) => row.primary && row.endpoint === 9)!;
    expect(nine.i).toBe(12);
    expect(nine.features.atr).toBeNull();

    const h1 = nine.outcomes.find((row) => row.horizon === 1)!;
    expect(h1).toMatchObject({
      available: true,
      atrAvailable: false,
      entryI: 13,
      exitI: 13,
      meaningfulReversal: null,
      continuation: null,
      timeToReversalBars: null,
      unavailableReason: null,
    });
    expect(h1.signedCloseReturn).toBeCloseTo(0);
    expect(h1.mfePct).toBeGreaterThan(0);
    expect(h1.maePct).toBeGreaterThan(0);
  });

  it("does not measure an outcome across a split boundary or a >30% discontinuity", () => {
    const split = analyzeNineBarSeries(series("CUT", trend(60)));
    const eventNearDevEnd = split.observations.find((row) => row.i === 30);
    expect(eventNearDevEnd).toBeDefined();
    expect(eventNearDevEnd!.outcomes.find((outcome) => outcome.horizon === 10)).toMatchObject({
      available: false,
      unavailableReason: "split_boundary",
    });

    const gapBars = bars(trend(60));
    for (let i = 30; i < gapBars.length; i++) {
      gapBars[i] = { ...gapBars[i], o: gapBars[i].o * 2, h: gapBars[i].h * 2, l: gapBars[i].l * 2, c: gapBars[i].c * 2 };
    }
    const gapped = analyzeNineBarSeries({ ...series("GAP", trend(60)), bars: gapBars });
    expect(gapped.coverage.discontinuities).toBe(1);
    expect(gapped.observations.every((row) => row.outcomes.every((outcome) => !outcome.available || outcome.exitI! < 30 || row.i >= 30))).toBe(true);
  });

  it("calculates event-close features only from information available at the event", () => {
    const fixture = series("FEAT", trend(80));
    const first = analyzeNineBarSeries(fixture).observations.find((row) => row.endpoint === 9)!;
    const changed = fixture.bars.map((bar) => ({ ...bar }));
    for (let i = first.i + 1; i < changed.length; i++) changed[i].v *= 1000;
    const second = analyzeNineBarSeries({ ...fixture, bars: changed }).observations.find((row) => row.endpoint === 9)!;
    expect(second.features).toEqual(first.features);
  });

  it("keeps event feature buckets invariant when only later bars change", () => {
    const wave = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 7) * 8 + i * 0.05);
    const fixture = series("CAUSAL", wave);
    const firstResult = analyzeNineBarSeries(fixture);
    const event = firstResult.observations.find((row) => row.endpoint === 9 && row.features.atrDecile != null)!;
    const changed = fixture.bars.map((bar, i) => {
      if (i <= event.i) return { ...bar };
      const scale = i % 2 === 0 ? 1.12 : 0.88;
      return { ...bar, o: bar.o * scale, h: bar.h * scale + 5, l: bar.l * scale - 5, c: bar.c * scale };
    });
    const second = analyzeNineBarSeries({ ...fixture, bars: changed }).observations.find((row) => row.i === event.i)!;
    expect(second.features).toEqual(event.features);
  });

  it("matches primary nines deterministically within exact symbol/direction/split/feature buckets", () => {
    const wave = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 7) * 8 + i * 0.05);
    const stock = analyzeNineBarSeries(series("WAVE", wave));
    const pairsA = matchPrimaryNines([stock]);
    const pairsB = matchPrimaryNines([stock]);
    expect(pairsA).toEqual(pairsB);
    for (const pair of pairsA) {
      expect(pair.event.symbol).toBe(pair.baseline.symbol);
      expect(pair.event.direction).toBe(pair.baseline.direction);
      expect(pair.event.split).toBe(pair.baseline.split);
      expect(pair.event.features.returnDecile).toBe(pair.baseline.features.returnDecile);
      expect(pair.event.features.atrDecile).toBe(pair.baseline.features.atrDecile);
      expect(pair.baseline.isEndpointNeighborhood).toBe(false);
    }
  });

  it("summarizes missing and ambiguous outcomes without inventing rates", () => {
    expect(summarizeObservations([], 5)).toEqual({
      observations: 0,
      available: 0,
      ambiguous: 0,
      meanSignedReturn: null,
      medianSignedReturn: null,
      reversalRate: null,
      continuationRate: null,
      meanMfePct: null,
      meanMaePct: null,
    });
  });

  it("builds a deterministic report with endpoint, split, matched, friction, and bootstrap evidence", () => {
    const waveA = Array.from({ length: 320 }, (_, i) => 100 + Math.sin(i / 6) * 9 + i * 0.03);
    const waveB = Array.from({ length: 320 }, (_, i) => 80 + Math.cos(i / 8) * 7 - i * 0.01);
    const spy = series("SPY", Array.from({ length: 320 }, (_, i) => 100 + i * 0.04));
    const inputs = [series("A", waveA), series("B", waveB), spy];
    const first = buildNineBarResearchReport(inputs);
    const second = buildNineBarResearchReport(inputs);
    expect(first).toEqual(second);
    expect(first.schema).toBe("terminal.nine_bar_research.v1");
    expect(first.algorithmVersion).toBe("nine-bar-v1.0.0");
    expect(first.settings).toEqual(NINE_BAR_RESEARCH_SETTINGS);
    expect(first.endpointSummaries.map((row) => row.endpoint)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(first.splitSummaries.map((row) => row.split)).toEqual(["development", "validation", "holdout"]);
    expect(first.frictionPerSideBps).toEqual([1, 5, 10, 25]);
    expect(first.limitations.length).toBeGreaterThan(3);
  });

  it("matches primary nines using availability for the requested horizon, not a hidden 20-bar gate", () => {
    const feature = {
      atr: 1, atrPct: 0.01, trailing20Return: 0.2, relativeVolume20: 1,
      relativeStrength60: 0.1, leaderState: "leader", volumeState: "normal_low",
      trendState: "strong", volatilityState: "mid", returnDecile: 7, atrDecile: 4,
    } as const;
    const outcome = (horizon: number, available: boolean) => ({
      horizon, available, entryI: available ? 101 : null, exitI: available ? 101 + horizon : null,
      entry: available ? 100 : null, exitClose: available ? 99 : null,
      signedCloseReturn: available ? 0.01 : null, netSignedReturnByCost: available ? { "1": 0.0098 } : null,
      delayedSignedCloseReturn: available ? 0.005 : null, mfePct: available ? 0.02 : null,
      maePct: available ? -0.01 : null, meaningfulReversal: available ? true : null,
      continuation: available ? false : null, ambiguous: false, timeToReversalBars: available ? 2 : null,
      unavailableReason: available ? null : "series_end",
    });
    const event = {
      symbol: "X", market: "us", source: "fixture", benchmark: null, i: 100, t: 100, label: "2026-01-01",
      split: "holdout", segment: 0, direction: "rising", reversalDirection: "down", endpoint: 9,
      absoluteStreak: 9, episode: 1, cycle: 1, primary: true, repeatCycle: false, kernelEventId: "e",
      features: feature, outcomes: [outcome(5, true), outcome(10, true), outcome(20, false)],
    };
    const baseline = {
      symbol: "X", market: "us", source: "fixture", benchmark: null, i: 30, t: 30, label: "2025-10-01",
      split: "holdout", segment: 0, direction: "rising", reversalDirection: "down",
      isEndpointNeighborhood: false, features: feature,
      outcomes: [outcome(5, true), outcome(10, true), outcome(20, false)],
    };
    const result = {
      series: { symbol: "X", market: "us", benchmark: null, source: "fixture" },
      observations: [event], baselines: [baseline],
      coverage: { bars: 140, segments: 1, discontinuities: 0, comparisons: 136, endpointObservations: 1,
        primaryNines: 1, repeatNines: 0, baselineCandidates: 1, firstLabel: "2025-01-01", lastLabel: "2026-01-01" },
    } as unknown as SeriesResearchResult;
    expect((matchPrimaryNines as any)([result], 5)).toHaveLength(1);
    expect((matchPrimaryNines as any)([result], 10)).toHaveLength(1);
    expect((matchPrimaryNines as any)([result], 20)).toHaveLength(0);
  });

  it("publishes delayed-entry sensitivity separately from next-open results", () => {
    const sample = series("X", trend(160));
    sample.benchmark = null;
    const report = buildNineBarResearchReport([sample]) as any;
    expect(report.delayedEntrySummaries).toBeDefined();
    expect(report.delayedEntrySummaries.length).toBeGreaterThan(0);
    const row = report.delayedEntrySummaries.find((entry: any) => entry.split === "all" && entry.horizon === 5);
    expect(row).toMatchObject({ split: "all", horizon: 5 });
    expect(row).toHaveProperty("observations");
    expect(row).toHaveProperty("meanDelayedSignedReturn");
  });
});

/**
 * Reproducible descriptive research for the canonical Nine-Bar Exhaustion kernel.
 *
 * This module deliberately stays outside live scoring/alerts. It accepts frozen chronological
 * snapshots, never claims point-in-time certification, and reports unavailable/ambiguous outcomes
 * rather than filling them with favorable assumptions.
 */

import {
  NINE_BAR_ALGORITHM_VERSION,
  computeNineBarExhaustion,
  type NineBarDirection,
} from "./nineBarExhaustion";

export type ResearchMarket = "us" | "crypto" | "cn" | "hk" | "other";
export type ResearchSplit = "development" | "validation" | "holdout";
export type ReversalDirection = "up" | "down";

export interface ResearchBar {
  t: number;
  label: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ResearchSeries {
  symbol: string;
  market: ResearchMarket;
  benchmark: string | null;
  source: string;
  bars: ResearchBar[];
}

export const NINE_BAR_RESEARCH_SETTINGS = Object.freeze({
  schema: "nine-bar-methods-v1" as const,
  horizons: Object.freeze([1, 3, 5, 10, 20] as const),
  endpoints: Object.freeze([6, 7, 8, 9, 10, 11] as const),
  frictionPerSideBps: Object.freeze([1, 5, 10, 25] as const),
  atrPeriod: 14,
  returnLookback: 20,
  relativeStrengthLookback: 60,
  relativeVolumeLookback: 20,
  discontinuityRatio: 0.30,
  splitFractions: Object.freeze([0.60, 0.80] as const),
  bootstrapReplicates: 1_000,
  bootstrapSeed: 0x9e3779b9,
});

export interface ResearchFeatures {
  atr: number | null;
  atrPct: number | null;
  trailing20Return: number | null;
  relativeVolume20: number | null;
  relativeStrength60: number | null;
  leaderState: "leader" | "laggard" | "unknown";
  volumeState: "high" | "normal_low" | "unknown";
  trendState: "strong" | "moderate_sideways" | "unknown";
  volatilityState: "low" | "mid" | "high" | "unknown";
  returnDecile: number | null;
  atrDecile: number | null;
}

export interface ResearchOutcome {
  horizon: number;
  /** Forward path exists through this horizon. Independent of ATR-threshold availability. */
  available: boolean;
  /** Event-bar ATR(14) exists, so threshold-based reversal/continuation fields are evaluable. */
  atrAvailable: boolean;
  entryI: number | null;
  exitI: number | null;
  entry: number | null;
  exitClose: number | null;
  signedCloseReturn: number | null;
  netSignedReturnByCost: Record<string, number> | null;
  delayedSignedCloseReturn: number | null;
  mfePct: number | null;
  maePct: number | null;
  meaningfulReversal: boolean | null;
  continuation: boolean | null;
  ambiguous: boolean;
  timeToReversalBars: number | null;
  unavailableReason: "series_end" | "split_boundary" | "discontinuity" | null;
}

export interface EndpointObservation {
  symbol: string;
  market: ResearchMarket;
  source: string;
  benchmark: string | null;
  i: number;
  t: number;
  label: string;
  split: ResearchSplit;
  segment: number;
  direction: NineBarDirection;
  reversalDirection: ReversalDirection;
  endpoint: 6 | 7 | 8 | 9 | 10 | 11;
  absoluteStreak: number;
  episode: number;
  cycle: number;
  primary: boolean;
  repeatCycle: boolean;
  kernelEventId: string | null;
  features: ResearchFeatures;
  outcomes: ResearchOutcome[];
}

export interface BaselineObservation {
  symbol: string;
  market: ResearchMarket;
  source: string;
  benchmark: string | null;
  i: number;
  t: number;
  label: string;
  split: ResearchSplit;
  segment: number;
  direction: NineBarDirection;
  reversalDirection: ReversalDirection;
  isEndpointNeighborhood: false;
  features: ResearchFeatures;
  outcomes: ResearchOutcome[];
}

export interface SeriesResearchCoverage {
  bars: number;
  segments: number;
  discontinuities: number;
  comparisons: number;
  endpointObservations: number;
  primaryNines: number;
  repeatNines: number;
  baselineCandidates: number;
  firstLabel: string | null;
  lastLabel: string | null;
}

export interface SeriesResearchResult {
  series: Omit<ResearchSeries, "bars">;
  observations: EndpointObservation[];
  baselines: BaselineObservation[];
  coverage: SeriesResearchCoverage;
}

export interface MatchedNinePair {
  event: EndpointObservation;
  baseline: BaselineObservation;
}

export interface ObservationSummary {
  observations: number;
  available: number;
  ambiguous: number;
  meanSignedReturn: number | null;
  medianSignedReturn: number | null;
  reversalRate: number | null;
  continuationRate: number | null;
  meanMfePct: number | null;
  meanMaePct: number | null;
}

export interface BootstrapEffect {
  split: ResearchSplit | "all";
  horizon: number;
  matchedPairs: number;
  symbols: number;
  matchRate: number | null;
  meanSignedReturnDifference: number | null;
  meanSignedReturnCi95: [number, number] | null;
  reversalRateDifference: number | null;
  reversalRateCi95: [number, number] | null;
}

export interface NineBarResearchReport {
  schema: "terminal.nine_bar_research.v1";
  algorithmVersion: typeof NINE_BAR_ALGORITHM_VERSION;
  authority: "snapshot_descriptive_only";
  settings: typeof NINE_BAR_RESEARCH_SETTINGS;
  generatedFrom: {
    series: number;
    symbols: string[];
    sources: string[];
    markets: Partial<Record<ResearchMarket, number>>;
    firstLabel: string | null;
    lastLabel: string | null;
  };
  coverage: {
    bars: number;
    segments: number;
    discontinuities: number;
    endpointObservations: number;
    primaryNines: number;
    repeatNines: number;
    baselineCandidates: number;
    /** Legacy 20-bar matched cohort count; use matchedPrimaryNinesByHorizon for horizon-specific effects. */
    matchedPrimaryNines: number;
    matchedPrimaryNinesByHorizon: Record<string, number>;
  };
  endpointSummaries: Array<{
    endpoint: 6 | 7 | 8 | 9 | 10 | 11;
    byHorizon: Array<{ horizon: number; summary: ObservationSummary }>;
  }>;
  splitSummaries: Array<{
    split: ResearchSplit;
    byHorizon: Array<{ horizon: number; summary: ObservationSummary }>;
  }>;
  matchedEffects: BootstrapEffect[];
  contextSummaries: Array<{
    context: string;
    value: string;
    horizon: number;
    summary: ObservationSummary;
  }>;
  frictionPerSideBps: number[];
  frictionSensitivity: Array<{
    split: ResearchSplit | "all";
    horizon: number;
    perSideBps: number;
    observations: number;
    meanNetSignedReturn: number | null;
  }>;
  delayedEntrySummaries: Array<{
    split: ResearchSplit | "all";
    horizon: number;
    observations: number;
    meanDelayedSignedReturn: number | null;
  }>;
  seriesCoverage: SeriesResearchCoverage[];
  limitations: string[];
}

const SPLITS: readonly ResearchSplit[] = ["development", "validation", "holdout"];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const mean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function validateSeries(series: ResearchSeries): void {
  if (!/^[A-Za-z0-9.^_-]{1,32}$/.test(series.symbol)) throw new Error("invalid research symbol");
  let previous = -Infinity;
  for (let i = 0; i < series.bars.length; i++) {
    const bar = series.bars[i];
    if (!finite(bar.t) || bar.t <= previous) throw new Error(`bars must be strictly increasing at index ${i}`);
    if (
      !finite(bar.o) || !finite(bar.h) || !finite(bar.l) || !finite(bar.c) || !finite(bar.v)
      || bar.o <= 0 || bar.h <= 0 || bar.l <= 0 || bar.c <= 0 || bar.v < 0
      || bar.h < Math.max(bar.o, bar.c, bar.l) || bar.l > Math.min(bar.o, bar.c, bar.h)
    ) throw new Error(`malformed OHLCV at index ${i}`);
    previous = bar.t;
  }
}

function splitForIndex(index: number, count: number): ResearchSplit {
  if (index < Math.floor(count * NINE_BAR_RESEARCH_SETTINGS.splitFractions[0])) return "development";
  if (index < Math.floor(count * NINE_BAR_RESEARCH_SETTINGS.splitFractions[1])) return "validation";
  return "holdout";
}

function segmentIds(bars: readonly ResearchBar[]): { ids: number[]; ranges: Array<{ start: number; end: number }>; discontinuities: number } {
  const ids = new Array<number>(bars.length).fill(0);
  const ranges: Array<{ start: number; end: number }> = [];
  let segment = 0;
  let start = 0;
  let discontinuities = 0;
  for (let i = 1; i < bars.length; i++) {
    const gap = Math.abs(bars[i].o / bars[i - 1].c - 1) > NINE_BAR_RESEARCH_SETTINGS.discontinuityRatio;
    if (gap) {
      ranges.push({ start, end: i - 1 });
      segment++;
      start = i;
      discontinuities++;
    }
    ids[i] = segment;
  }
  if (bars.length) ranges.push({ start, end: bars.length - 1 });
  return { ids, ranges, discontinuities };
}

function wilderAtr(bars: readonly ResearchBar[], ranges: readonly { start: number; end: number }[]): Array<number | null> {
  const output: Array<number | null> = new Array(bars.length).fill(null);
  const period = NINE_BAR_RESEARCH_SETTINGS.atrPeriod;
  for (const range of ranges) {
    let atr = 0;
    let count = 0;
    for (let i = range.start; i <= range.end; i++) {
      const previousClose = i === range.start ? bars[i].c : bars[i - 1].c;
      const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - previousClose), Math.abs(bars[i].l - previousClose));
      count++;
      if (count <= period) {
        atr += tr;
        if (count === period) {
          atr /= period;
          output[i] = atr;
        }
      } else {
        atr = ((period - 1) * atr + tr) / period;
        output[i] = atr;
      }
    }
  }
  return output;
}

function trailingReturn(bars: readonly ResearchBar[], ids: readonly number[], index: number, lookback: number): number | null {
  const prior = index - lookback;
  if (prior < 0 || ids[prior] !== ids[index]) return null;
  return bars[index].c / bars[prior].c - 1;
}

function relativeVolume(bars: readonly ResearchBar[], ids: readonly number[], index: number, lookback: number): number | null {
  const start = index - lookback + 1;
  if (start < 0 || ids[start] !== ids[index]) return null;
  let sum = 0;
  for (let i = start; i <= index; i++) sum += bars[i].v;
  const average = sum / lookback;
  return average > 0 ? bars[index].v / average : null;
}

function benchmarkMap(benchmark: ResearchSeries | undefined): Map<number, ResearchBar> {
  return new Map((benchmark?.bars ?? []).map((bar) => [bar.t, bar]));
}

function relativeStrength(
  bars: readonly ResearchBar[],
  ids: readonly number[],
  index: number,
  benchmarkByTime: ReadonlyMap<number, ResearchBar>,
  lookback: number,
): number | null {
  const prior = index - lookback;
  if (prior < 0 || ids[prior] !== ids[index]) return null;
  const currentBenchmark = benchmarkByTime.get(bars[index].t);
  const priorBenchmark = benchmarkByTime.get(bars[prior].t);
  if (!currentBenchmark || !priorBenchmark || priorBenchmark.c <= 0) return null;
  return Math.log(bars[index].c / bars[prior].c) - Math.log(currentBenchmark.c / priorBenchmark.c);
}

function causalQuantileBuckets(
  values: readonly (number | null)[],
  split: ResearchSplit,
  bucketCount: number,
): Map<number, number> {
  const sorted: number[] = [];
  const result = new Map<number, number>();
  for (let i = 0; i < values.length; i++) {
    if (splitForIndex(i, values.length) !== split) continue;
    const value = values[i];
    if (value == null || !Number.isFinite(value)) continue;
    // Upper-bound insertion makes equal values deterministic by chronological order. Crucially,
    // the bucket freezes now: no observation after bar i can move a feature used at bar i.
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    sorted.splice(lo, 0, value);
    result.set(i, Math.min(bucketCount, Math.floor(lo * bucketCount / sorted.length) + 1));
  }
  return result;
}

interface FeatureArrays {
  atr: Array<number | null>;
  atrPct: Array<number | null>;
  trailing20: Array<number | null>;
  relativeVolume20: Array<number | null>;
  relativeStrength60: Array<number | null>;
  returnDecile: Array<number | null>;
  atrDecile: Array<number | null>;
  volatilityTercile: Array<number | null>;
}

function buildFeatureArrays(
  series: ResearchSeries,
  ids: readonly number[],
  ranges: readonly { start: number; end: number }[],
  benchmark: ResearchSeries | undefined,
): FeatureArrays {
  const bars = series.bars;
  const atr = wilderAtr(bars, ranges);
  const atrPct = atr.map((value, i) => value == null ? null : value / bars[i].c);
  const trailing20 = bars.map((_, i) => trailingReturn(bars, ids, i, NINE_BAR_RESEARCH_SETTINGS.returnLookback));
  const relativeVolume20 = bars.map((_, i) => relativeVolume(bars, ids, i, NINE_BAR_RESEARCH_SETTINGS.relativeVolumeLookback));
  const bench = benchmarkMap(benchmark);
  const relativeStrength60 = bars.map((_, i) => relativeStrength(
    bars,
    ids,
    i,
    bench,
    NINE_BAR_RESEARCH_SETTINGS.relativeStrengthLookback,
  ));
  const returnDecile: Array<number | null> = new Array(bars.length).fill(null);
  const atrDecile: Array<number | null> = new Array(bars.length).fill(null);
  const volatilityTercile: Array<number | null> = new Array(bars.length).fill(null);
  for (const split of SPLITS) {
    for (const [i, bucket] of causalQuantileBuckets(trailing20, split, 10)) returnDecile[i] = bucket;
    for (const [i, bucket] of causalQuantileBuckets(atrPct, split, 10)) atrDecile[i] = bucket;
    for (const [i, bucket] of causalQuantileBuckets(atrPct, split, 3)) volatilityTercile[i] = bucket;
  }
  return { atr, atrPct, trailing20, relativeVolume20, relativeStrength60, returnDecile, atrDecile, volatilityTercile };
}

function featuresAt(index: number, arrays: FeatureArrays): ResearchFeatures {
  const atr = arrays.atr[index];
  const atrPct = arrays.atrPct[index];
  const trailing20Return = arrays.trailing20[index];
  const relativeVolume20 = arrays.relativeVolume20[index];
  const relativeStrength60 = arrays.relativeStrength60[index];
  const volatilityBucket = arrays.volatilityTercile[index];
  return {
    atr,
    atrPct,
    trailing20Return,
    relativeVolume20,
    relativeStrength60,
    leaderState: relativeStrength60 == null ? "unknown" : relativeStrength60 > 0 ? "leader" : "laggard",
    volumeState: relativeVolume20 == null ? "unknown" : relativeVolume20 >= 1.2 ? "high" : "normal_low",
    trendState: trailing20Return == null || atrPct == null
      ? "unknown"
      : Math.abs(trailing20Return) >= 2 * atrPct ? "strong" : "moderate_sideways",
    volatilityState: volatilityBucket == null ? "unknown" : volatilityBucket === 1 ? "low" : volatilityBucket === 2 ? "mid" : "high",
    returnDecile: arrays.returnDecile[index],
    atrDecile: arrays.atrDecile[index],
  };
}

function unavailableOutcome(
  horizon: number,
  reason: Exclude<ResearchOutcome["unavailableReason"], null>,
  atrAvailable: boolean,
): ResearchOutcome {
  return {
    horizon,
    available: false,
    atrAvailable,
    entryI: null,
    exitI: null,
    entry: null,
    exitClose: null,
    signedCloseReturn: null,
    netSignedReturnByCost: null,
    delayedSignedCloseReturn: null,
    mfePct: null,
    maePct: null,
    meaningfulReversal: null,
    continuation: null,
    ambiguous: false,
    timeToReversalBars: null,
    unavailableReason: reason,
  };
}

function outcomeAt(
  bars: readonly ResearchBar[],
  ids: readonly number[],
  direction: NineBarDirection,
  eventIndex: number,
  horizon: number,
  atr: number | null,
): ResearchOutcome {
  const atrThreshold = atr != null && atr > 0 ? atr : null;
  const atrAvailable = atrThreshold !== null;
  const entryI = eventIndex + 1;
  const exitI = eventIndex + horizon;
  if (exitI >= bars.length) return unavailableOutcome(horizon, "series_end", atrAvailable);
  const split = splitForIndex(eventIndex, bars.length);
  if (splitForIndex(entryI, bars.length) !== split || splitForIndex(exitI, bars.length) !== split) {
    return unavailableOutcome(horizon, "split_boundary", atrAvailable);
  }
  if (ids[entryI] !== ids[eventIndex] || ids[exitI] !== ids[eventIndex]) {
    return unavailableOutcome(horizon, "discontinuity", atrAvailable);
  }

  const entry = bars[entryI].o;
  const sign = direction === "falling" ? 1 : -1;
  let maxFavorable = 0;
  let maxAdverse = 0;
  let resolved: "reversal" | "continuation" | "ambiguous" | null = null;
  let timeToReversalBars: number | null = null;

  for (let i = entryI; i <= exitI; i++) {
    const bar = bars[i];
    const openMove = sign * (bar.o - entry);
    if (atrThreshold !== null && resolved === null && openMove >= atrThreshold) {
      resolved = "reversal";
      timeToReversalBars = i - eventIndex;
    } else if (atrThreshold !== null && resolved === null && openMove <= -atrThreshold) {
      resolved = "continuation";
    }

    const favorableMove = direction === "falling" ? bar.h - entry : entry - bar.l;
    const adverseMove = direction === "falling" ? entry - bar.l : bar.h - entry;
    maxFavorable = Math.max(maxFavorable, favorableMove);
    maxAdverse = Math.max(maxAdverse, adverseMove);

    if (atrThreshold !== null && resolved === null) {
      const hitFavorable = favorableMove >= atrThreshold;
      const hitAdverse = adverseMove >= atrThreshold;
      if (hitFavorable && hitAdverse) resolved = "ambiguous";
      else if (hitFavorable) {
        resolved = "reversal";
        timeToReversalBars = i - eventIndex;
      } else if (hitAdverse) resolved = "continuation";
    }
  }

  const exitClose = bars[exitI].c;
  const signedCloseReturn = sign * (exitClose / entry - 1);
  const netSignedReturnByCost: Record<string, number> = {};
  for (const perSide of NINE_BAR_RESEARCH_SETTINGS.frictionPerSideBps) {
    netSignedReturnByCost[String(perSide)] = signedCloseReturn - (2 * perSide / 10_000);
  }

  let delayedSignedCloseReturn: number | null = null;
  const delayedEntryI = eventIndex + 2;
  const delayedExitI = delayedEntryI + horizon - 1;
  if (
    delayedExitI < bars.length
    && splitForIndex(delayedEntryI, bars.length) === split
    && splitForIndex(delayedExitI, bars.length) === split
    && ids[delayedEntryI] === ids[eventIndex]
    && ids[delayedExitI] === ids[eventIndex]
  ) {
    delayedSignedCloseReturn = sign * (bars[delayedExitI].c / bars[delayedEntryI].o - 1);
  }

  return {
    horizon,
    available: true,
    atrAvailable,
    entryI,
    exitI,
    entry,
    exitClose,
    signedCloseReturn,
    netSignedReturnByCost,
    delayedSignedCloseReturn,
    mfePct: maxFavorable / entry,
    maePct: maxAdverse / entry,
    meaningfulReversal: !atrAvailable || resolved === "ambiguous" ? null : resolved === "reversal",
    continuation: !atrAvailable || resolved === "ambiguous" ? null : resolved === "continuation",
    ambiguous: atrAvailable && resolved === "ambiguous",
    timeToReversalBars,
    unavailableReason: null,
  };
}

function outcomesAt(
  bars: readonly ResearchBar[],
  ids: readonly number[],
  direction: NineBarDirection,
  index: number,
  atr: number | null,
): ResearchOutcome[] {
  return NINE_BAR_RESEARCH_SETTINGS.horizons.map((horizon) => outcomeAt(bars, ids, direction, index, horizon, atr));
}

export function analyzeNineBarSeries(series: ResearchSeries, benchmark?: ResearchSeries): SeriesResearchResult {
  validateSeries(series);
  if (benchmark) validateSeries(benchmark);
  const { ids, ranges, discontinuities } = segmentIds(series.bars);
  const arrays = buildFeatureArrays(series, ids, ranges, benchmark);
  const observations: EndpointObservation[] = [];
  const endpointIndices = new Set<number>();
  let episode = 0;
  let comparisons = 0;

  for (const range of ranges) {
    const slice = series.bars.slice(range.start, range.end + 1);
    if (slice.length < 5) continue;
    const kernel = computeNineBarExhaustion(
      slice.map((bar) => ({ id: bar.label, t: bar.t, availableT: bar.t + 86_400, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v })),
      {
        symbol: series.symbol,
        timeframe: "1d",
        session: "daily",
        requirePriceFlip: false,
        cycleMode: "repeat",
        displayPolicy: "progressive",
        density: "all",
        historyBars: Math.max(1, slice.length),
        formingBarIndex: null,
      },
    );
    if (!kernel.ok) throw new Error(kernel.error.message);
    comparisons += kernel.coverage.validComparisons;
    const eventByKey = new Map(kernel.events.map((event) => [`${event.direction}:${event.absoluteStreak}:${event.i}`, event.id]));
    let localEpisode = 0;
    let previousPointI = -2;
    let previousDirection: NineBarDirection | null = null;
    for (const point of kernel.points) {
      if (point.absoluteStreak === 1 || point.i !== previousPointI + 1 || point.direction !== previousDirection) {
        localEpisode++;
        episode++;
      }
      previousPointI = point.i;
      previousDirection = point.direction;
      const firstCycleComparator = point.absoluteStreak >= 6 && point.absoluteStreak <= 11;
      const repeatNine = point.absoluteStreak >= 18 && point.absoluteStreak % 9 === 0;
      if (!firstCycleComparator && !repeatNine) continue;
      const endpoint = repeatNine ? 9 : point.absoluteStreak as 6 | 7 | 8 | 9 | 10 | 11;
      const i = range.start + point.i;
      endpointIndices.add(i);
      const features = featuresAt(i, arrays);
      observations.push({
        symbol: series.symbol,
        market: series.market,
        source: series.source,
        benchmark: series.benchmark,
        i,
        t: series.bars[i].t,
        label: series.bars[i].label,
        split: splitForIndex(i, series.bars.length),
        segment: ids[i],
        direction: point.direction,
        reversalDirection: point.direction === "falling" ? "up" : "down",
        endpoint,
        absoluteStreak: point.absoluteStreak,
        episode: episode - localEpisode + localEpisode,
        cycle: point.cycle,
        primary: endpoint === 9 && !repeatNine,
        repeatCycle: repeatNine,
        kernelEventId: endpoint === 9
          ? eventByKey.get(`${point.direction}:${point.absoluteStreak}:${point.i}`) ?? null
          : null,
        features,
        outcomes: outcomesAt(series.bars, ids, point.direction, i, features.atr),
      });
    }
  }

  // The episode counter above increments globally whenever a new relation run starts. Reassign in
  // stable observation order so sparse comparator materialization cannot create duplicate labels.
  let visibleEpisode = 0;
  let lastDirection: NineBarDirection | null = null;
  let lastAbsolute = Infinity;
  let lastSegment = -1;
  for (const observation of observations.sort((a, b) => a.i - b.i || a.endpoint - b.endpoint)) {
    if (observation.segment !== lastSegment || observation.direction !== lastDirection || observation.absoluteStreak <= lastAbsolute) {
      visibleEpisode++;
    }
    observation.episode = visibleEpisode;
    lastDirection = observation.direction;
    lastAbsolute = observation.absoluteStreak;
    lastSegment = observation.segment;
  }

  const neighborhood = new Set<number>();
  for (const endpointIndex of endpointIndices) {
    for (let offset = 0; offset <= 4; offset++) neighborhood.add(endpointIndex + offset);
  }
  const baselines: BaselineObservation[] = [];
  for (let i = 4; i < series.bars.length; i++) {
    if (ids[i] !== ids[i - 4]) continue;
    const relation: NineBarDirection | null = series.bars[i].c > series.bars[i - 4].c
      ? "rising"
      : series.bars[i].c < series.bars[i - 4].c ? "falling" : null;
    if (!relation || neighborhood.has(i)) continue;
    const features = featuresAt(i, arrays);
    if (features.returnDecile == null || features.atrDecile == null) continue;
    baselines.push({
      symbol: series.symbol,
      market: series.market,
      source: series.source,
      benchmark: series.benchmark,
      i,
      t: series.bars[i].t,
      label: series.bars[i].label,
      split: splitForIndex(i, series.bars.length),
      segment: ids[i],
      direction: relation,
      reversalDirection: relation === "falling" ? "up" : "down",
      isEndpointNeighborhood: false,
      features,
      outcomes: outcomesAt(series.bars, ids, relation, i, features.atr),
    });
  }

  return {
    series: { symbol: series.symbol, market: series.market, benchmark: series.benchmark, source: series.source },
    observations,
    baselines,
    coverage: {
      bars: series.bars.length,
      segments: ranges.length,
      discontinuities,
      comparisons,
      endpointObservations: observations.length,
      primaryNines: observations.filter((row) => row.primary).length,
      repeatNines: observations.filter((row) => row.repeatCycle).length,
      baselineCandidates: baselines.length,
      firstLabel: series.bars[0]?.label ?? null,
      lastLabel: series.bars.at(-1)?.label ?? null,
    },
  };
}

export function matchPrimaryNines(
  results: readonly SeriesResearchResult[],
  horizon = 20,
): MatchedNinePair[] {
  const pairs: MatchedNinePair[] = [];
  for (const result of [...results].sort((a, b) => a.series.symbol.localeCompare(b.series.symbol))) {
    const events = result.observations
      .filter((row) => row.primary && row.features.returnDecile != null && row.features.atrDecile != null)
      .sort((a, b) => a.i - b.i);
    const allPrimaryIndexes = events.map((event) => event.i);
    const used = new Set<number>();
    for (const event of events) {
      const eventOutcome = event.outcomes.find((outcome) => outcome.horizon === horizon);
      if (!eventOutcome?.available) continue;
      const candidates = result.baselines.filter((candidate) => {
        if (used.has(candidate.i)) return false;
        if (candidate.direction !== event.direction || candidate.split !== event.split) return false;
        if (candidate.features.returnDecile !== event.features.returnDecile || candidate.features.atrDecile !== event.features.atrDecile) return false;
        if (!candidate.outcomes.find((outcome) => outcome.horizon === horizon)?.available) return false;
        return allPrimaryIndexes.every((index) => Math.abs(candidate.i - index) > 20);
      }).sort((a, b) => Math.abs(a.i - event.i) - Math.abs(b.i - event.i) || a.i - b.i);
      const baseline = candidates[0];
      if (!baseline) continue;
      used.add(baseline.i);
      pairs.push({ event, baseline });
    }
  }
  return pairs;
}

export function summarizeObservations(observations: readonly EndpointObservation[] | readonly BaselineObservation[], horizon: number): ObservationSummary {
  const outcomes = observations.map((row) => row.outcomes.find((outcome) => outcome.horizon === horizon)).filter((row): row is ResearchOutcome => Boolean(row));
  const available = outcomes.filter((row) => row.available);
  const resolved = available.filter((row) => row.meaningfulReversal != null && row.continuation != null);
  const signed = available.map((row) => row.signedCloseReturn).filter((value): value is number => value != null);
  const mfe = available.map((row) => row.mfePct).filter((value): value is number => value != null);
  const mae = available.map((row) => row.maePct).filter((value): value is number => value != null);
  return {
    observations: observations.length,
    available: available.length,
    ambiguous: available.filter((row) => row.ambiguous).length,
    meanSignedReturn: mean(signed),
    medianSignedReturn: median(signed),
    reversalRate: resolved.length ? resolved.filter((row) => row.meaningfulReversal === true).length / resolved.length : null,
    continuationRate: resolved.length ? resolved.filter((row) => row.continuation === true).length / resolved.length : null,
    meanMfePct: mean(mfe),
    meanMaePct: mean(mae),
  };
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function percentile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function pairMetric(pair: MatchedNinePair, horizon: number, metric: "return" | "reversal"): number | null {
  const event = pair.event.outcomes.find((outcome) => outcome.horizon === horizon);
  const baseline = pair.baseline.outcomes.find((outcome) => outcome.horizon === horizon);
  if (!event?.available || !baseline?.available) return null;
  if (metric === "return") {
    if (event.signedCloseReturn == null || baseline.signedCloseReturn == null) return null;
    return event.signedCloseReturn - baseline.signedCloseReturn;
  }
  if (event.meaningfulReversal == null || baseline.meaningfulReversal == null) return null;
  return Number(event.meaningfulReversal) - Number(baseline.meaningfulReversal);
}

function bootstrapEffect(
  pairs: readonly MatchedNinePair[],
  split: ResearchSplit | "all",
  horizon: number,
  totalPrimary: number,
): BootstrapEffect {
  const selected = pairs.filter((pair) => split === "all" || pair.event.split === split);
  const symbols = Array.from(new Set(selected.map((pair) => pair.event.symbol))).sort();
  const bySymbol = new Map(symbols.map((symbol) => [symbol, selected.filter((pair) => pair.event.symbol === symbol)]));
  const pointReturns = selected.map((pair) => pairMetric(pair, horizon, "return")).filter((value): value is number => value != null);
  const pointReversals = selected.map((pair) => pairMetric(pair, horizon, "reversal")).filter((value): value is number => value != null);
  const returnBoot: number[] = [];
  const reversalBoot: number[] = [];
  if (symbols.length) {
    const random = xorshift32(NINE_BAR_RESEARCH_SETTINGS.bootstrapSeed ^ horizon ^ (split === "all" ? 0 : split.length * 131));
    for (let replicate = 0; replicate < NINE_BAR_RESEARCH_SETTINGS.bootstrapReplicates; replicate++) {
      const sampled: MatchedNinePair[] = [];
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[Math.floor(random() * symbols.length)];
        sampled.push(...(bySymbol.get(symbol) ?? []));
      }
      const returns = sampled.map((pair) => pairMetric(pair, horizon, "return")).filter((value): value is number => value != null);
      const reversals = sampled.map((pair) => pairMetric(pair, horizon, "reversal")).filter((value): value is number => value != null);
      const returnMean = mean(returns);
      const reversalMean = mean(reversals);
      if (returnMean != null) returnBoot.push(returnMean);
      if (reversalMean != null) reversalBoot.push(reversalMean);
    }
  }
  const returnLo = percentile(returnBoot, 0.025);
  const returnHi = percentile(returnBoot, 0.975);
  const reversalLo = percentile(reversalBoot, 0.025);
  const reversalHi = percentile(reversalBoot, 0.975);
  return {
    split,
    horizon,
    matchedPairs: selected.length,
    symbols: symbols.length,
    matchRate: totalPrimary ? selected.length / totalPrimary : null,
    meanSignedReturnDifference: mean(pointReturns),
    meanSignedReturnCi95: returnLo == null || returnHi == null ? null : [returnLo, returnHi],
    reversalRateDifference: mean(pointReversals),
    reversalRateCi95: reversalLo == null || reversalHi == null ? null : [reversalLo, reversalHi],
  };
}

function delayedEntryRows(observations: readonly EndpointObservation[]): NineBarResearchReport["delayedEntrySummaries"] {
  const rows: NineBarResearchReport["delayedEntrySummaries"] = [];
  for (const split of ["all", ...SPLITS] as const) {
    for (const horizon of NINE_BAR_RESEARCH_SETTINGS.horizons) {
      const values = observations
        .filter((row) => split === "all" || row.split === split)
        .map((row) => row.outcomes.find((outcome) => outcome.horizon === horizon))
        .filter((outcome): outcome is ResearchOutcome => Boolean(outcome?.available))
        .map((outcome) => outcome.delayedSignedCloseReturn)
        .filter((value): value is number => value != null);
      rows.push({ split, horizon, observations: values.length, meanDelayedSignedReturn: mean(values) });
    }
  }
  return rows;
}

function frictionRows(observations: readonly EndpointObservation[]): NineBarResearchReport["frictionSensitivity"] {
  const rows: NineBarResearchReport["frictionSensitivity"] = [];
  for (const split of ["all", ...SPLITS] as const) {
    for (const horizon of NINE_BAR_RESEARCH_SETTINGS.horizons) {
      for (const perSideBps of NINE_BAR_RESEARCH_SETTINGS.frictionPerSideBps) {
        const values = observations
          .filter((row) => split === "all" || row.split === split)
          .map((row) => row.outcomes.find((outcome) => outcome.horizon === horizon))
          .filter((outcome): outcome is ResearchOutcome => Boolean(outcome?.available))
          .map((outcome) => outcome.netSignedReturnByCost?.[String(perSideBps)])
          .filter((value): value is number => value != null);
        rows.push({ split, horizon, perSideBps, observations: values.length, meanNetSignedReturn: mean(values) });
      }
    }
  }
  return rows;
}

export function buildNineBarResearchReport(series: readonly ResearchSeries[]): NineBarResearchReport {
  const bySymbol = new Map(series.map((item) => [item.symbol, item]));
  const results = [...series]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((item) => analyzeNineBarSeries(item, item.benchmark ? bySymbol.get(item.benchmark) : undefined));
  const observations = results.flatMap((result) => result.observations);
  const primary = observations.filter((row) => row.primary);
  const pairsByHorizon = new Map<number, MatchedNinePair[]>(NINE_BAR_RESEARCH_SETTINGS.horizons.map((horizon) => [
    horizon,
    matchPrimaryNines(results, horizon),
  ]));
  const firstLabels = results.map((result) => result.coverage.firstLabel).filter((value): value is string => value != null).sort();
  const lastLabels = results.map((result) => result.coverage.lastLabel).filter((value): value is string => value != null).sort();
  const marketCounts: Partial<Record<ResearchMarket, number>> = {};
  for (const item of series) marketCounts[item.market] = (marketCounts[item.market] ?? 0) + 1;

  const endpointSummaries = NINE_BAR_RESEARCH_SETTINGS.endpoints.map((endpoint) => ({
    endpoint,
    byHorizon: NINE_BAR_RESEARCH_SETTINGS.horizons.map((horizon) => ({
      horizon,
      summary: summarizeObservations(observations.filter((row) => row.endpoint === endpoint && !row.repeatCycle), horizon),
    })),
  }));
  const splitSummaries = SPLITS.map((split) => ({
    split,
    byHorizon: NINE_BAR_RESEARCH_SETTINGS.horizons.map((horizon) => ({
      horizon,
      summary: summarizeObservations(primary.filter((row) => row.split === split), horizon),
    })),
  }));
  const matchedEffects: BootstrapEffect[] = [];
  for (const split of ["all", ...SPLITS] as const) {
    const denominator = primary.filter((row) => split === "all" || row.split === split).length;
    for (const horizon of NINE_BAR_RESEARCH_SETTINGS.horizons) {
      matchedEffects.push(bootstrapEffect(pairsByHorizon.get(horizon) ?? [], split, horizon, denominator));
    }
  }

  const contextSummaries: NineBarResearchReport["contextSummaries"] = [];
  const contexts: Array<[string, (row: EndpointObservation) => string]> = [
    ["direction", (row) => row.direction],
    ["leaderState", (row) => row.features.leaderState],
    ["volumeState", (row) => row.features.volumeState],
    ["trendState", (row) => row.features.trendState],
    ["volatilityState", (row) => row.features.volatilityState],
    ["market", (row) => row.market],
  ];
  for (const [context, selector] of contexts) {
    const values = Array.from(new Set(primary.map(selector))).sort();
    for (const value of values) {
      for (const horizon of [5, 10]) {
        contextSummaries.push({ context, value, horizon, summary: summarizeObservations(primary.filter((row) => selector(row) === value), horizon) });
      }
    }
  }

  return {
    schema: "terminal.nine_bar_research.v1",
    algorithmVersion: NINE_BAR_ALGORITHM_VERSION,
    authority: "snapshot_descriptive_only",
    settings: NINE_BAR_RESEARCH_SETTINGS,
    generatedFrom: {
      series: series.length,
      symbols: [...series].map((item) => item.symbol).sort(),
      sources: Array.from(new Set(series.map((item) => item.source))).sort(),
      markets: marketCounts,
      firstLabel: firstLabels[0] ?? null,
      lastLabel: lastLabels.at(-1) ?? null,
    },
    coverage: {
      bars: results.reduce((sum, result) => sum + result.coverage.bars, 0),
      segments: results.reduce((sum, result) => sum + result.coverage.segments, 0),
      discontinuities: results.reduce((sum, result) => sum + result.coverage.discontinuities, 0),
      endpointObservations: observations.length,
      primaryNines: primary.length,
      repeatNines: observations.filter((row) => row.repeatCycle).length,
      baselineCandidates: results.reduce((sum, result) => sum + result.coverage.baselineCandidates, 0),
      matchedPrimaryNines: (pairsByHorizon.get(20) ?? []).length,
      matchedPrimaryNinesByHorizon: Object.fromEntries(NINE_BAR_RESEARCH_SETTINGS.horizons.map((horizon) => [
        String(horizon),
        (pairsByHorizon.get(horizon) ?? []).length,
      ])),
    },
    endpointSummaries,
    splitSummaries,
    matchedEffects,
    contextSummaries,
    frictionPerSideBps: [...NINE_BAR_RESEARCH_SETTINGS.frictionPerSideBps],
    frictionSensitivity: frictionRows(primary),
    delayedEntrySummaries: delayedEntryRows(primary),
    seriesCoverage: results.map((result) => result.coverage),
    limitations: [
      "The repository panel is a current corrected snapshot, not a point-in-time availability receipt.",
      "The current universe omits delisted constituents and historical membership, so survivorship and selection bias remain.",
      "Per-bar corporate-action provenance is not independently certified; >30% gaps split segments but do not prove adjustment correctness.",
      "Daily OHLC cannot order favorable and adverse intrabar threshold touches; same-bar ties are reported as ambiguous.",
      "Matched estimates use prespecified observable price/volatility buckets but cannot remove unmeasured confounding.",
      "CN/HK and broad intraday panels are absent from the admitted snapshot, so cross-market and intraday generalization is unproven.",
      "No result from this module is a live score, probability, alert, trade instruction, or scientific promotion receipt.",
    ],
  };
}

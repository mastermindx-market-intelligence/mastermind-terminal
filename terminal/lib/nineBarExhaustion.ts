/**
 * Canonical, independent Nine-Bar Exhaustion kernel.
 *
 * This is a descriptive close-versus-four-bars-back setup counter. It is not proprietary DeMARK
 * code, does not implement Countdown/13, and makes no reversal-probability claim. Rendering and
 * alerts must consume this output rather than reimplementing the state machine.
 */

export const NINE_BAR_ALGORITHM_VERSION = "nine-bar-v1.0.0" as const;
export const NINE_BAR_LOOKBACK = 4 as const;
export const NINE_BAR_TARGET = 9 as const;
export const NINE_BAR_RETRO_REVEAL = 6 as const;

export type NineBarDirection = "rising" | "falling";
export type NineBarReversalDirection = "bull" | "bear";
export type NineBarDisplayPolicy = "progressive" | "retro6" | "completed";
export type NineBarDensity = "all" | "late" | "completion";
export type NineBarCycleMode = "single" | "repeat";

export interface NineBarInputBar {
  /** Stable source-bar identity. Falls back to `t` when absent. */
  id?: string;
  /** Source-bar chart identity, epoch seconds. Must be strictly increasing. */
  t: number;
  /** Earliest known availability/close epoch. Falls back to `t`. */
  availableT?: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface NineBarOptions {
  symbol: string;
  timeframe: string;
  session?: string;
  requirePriceFlip?: boolean;
  cycleMode?: NineBarCycleMode;
  displayPolicy?: NineBarDisplayPolicy;
  density?: NineBarDensity;
  historyBars?: number;
  /** The only unfinished source bar. When supplied it must be the final input index. */
  formingBarIndex?: number | null;
}

export interface NineBarPoint {
  id: string;
  algorithmVersion: typeof NINE_BAR_ALGORITHM_VERSION;
  symbol: string;
  timeframe: string;
  session: string;
  barId: string;
  i: number;
  sourceT: number;
  earliestObservableT: number;
  compareI: number;
  compareT: number;
  close: number;
  compareClose: number;
  direction: NineBarDirection;
  reversalDir: NineBarReversalDirection;
  absoluteStreak: number;
  cycle: number;
  count: number;
  forming: boolean;
  completed: boolean;
  confirmedAt: number | null;
  /** Eligible under episode semantics before density/history presentation filters. */
  historicalDisplayEligible: boolean;
  /** Final rendering decision under the selected display policy/density/history window. */
  displayEligible: boolean;
}

export interface NineBarCompletionEvent {
  id: string;
  algorithmVersion: typeof NINE_BAR_ALGORITHM_VERSION;
  symbol: string;
  timeframe: string;
  session: string;
  direction: NineBarDirection;
  reversalDir: NineBarReversalDirection;
  cycle: number;
  i: number;
  confirmedAt: number;
  sourceT: number;
  earliestObservableT: number;
  close: number;
  compareI: number;
  compareT: number;
  compareClose: number;
  absoluteStreak: number;
}

export interface NineBarEpisode {
  id: string;
  direction: NineBarDirection;
  startI: number;
  endI: number;
  maxStreak: number;
  completedCycles: number;
  active: boolean;
}

export interface NineBarCurrentState {
  direction: NineBarDirection;
  absoluteStreak: number;
  cycle: number;
  count: number;
  forming: boolean;
}

export type NormalizedNineBarOptions = Required<Omit<NineBarOptions, "formingBarIndex">> & {
  formingBarIndex: number | null;
};

export interface NineBarCoverage {
  bars: number;
  warmupBars: number;
  comparisonSlots: number;
  validComparisons: number;
  missingBars: number;
  interruptions: number;
  mode: "bar_based";
  lookbackBars: typeof NINE_BAR_LOOKBACK;
}

export type NineBarError = {
  code: "non_chronological" | "invalid_forming_index";
  message: string;
  i: number;
};

export type NineBarResult =
  | {
      ok: true;
      algorithmVersion: typeof NINE_BAR_ALGORITHM_VERSION;
      options: NormalizedNineBarOptions;
      points: NineBarPoint[];
      events: NineBarCompletionEvent[];
      episodes: NineBarEpisode[];
      current: NineBarCurrentState | null;
      coverage: NineBarCoverage;
    }
  | { ok: false; algorithmVersion: typeof NINE_BAR_ALGORITHM_VERSION; error: NineBarError };

const opposite = (direction: NineBarDirection): NineBarDirection => direction === "rising" ? "falling" : "rising";
const reversal = (direction: NineBarDirection): NineBarReversalDirection => direction === "rising" ? "bear" : "bull";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const barId = (bar: NineBarInputBar): string => bar.id == null || bar.id === "" ? String(bar.t) : String(bar.id);

function normalizeOptions(options: NineBarOptions): NormalizedNineBarOptions {
  const displayPolicy: NineBarDisplayPolicy = options.displayPolicy === "progressive" || options.displayPolicy === "completed"
    ? options.displayPolicy
    : "retro6";
  const density: NineBarDensity = options.density === "late" || options.density === "completion" ? options.density : "all";
  const cycleMode: NineBarCycleMode = options.cycleMode === "repeat" ? "repeat" : "single";
  const historyRaw = Number(options.historyBars);
  const historyBars = Number.isFinite(historyRaw) ? Math.max(1, Math.trunc(historyRaw)) : 500;
  return {
    symbol: String(options.symbol || "UNKNOWN"),
    timeframe: String(options.timeframe || "unknown"),
    session: String(options.session || "default"),
    requirePriceFlip: options.requirePriceFlip === true,
    cycleMode,
    displayPolicy,
    density,
    historyBars,
    formingBarIndex: options.formingBarIndex == null ? null : Math.trunc(options.formingBarIndex),
  };
}

interface ActiveRun {
  direction: NineBarDirection;
  episodeIndex: number;
  startI: number;
  absoluteStreak: number;
  cyclePointIndexes: number[];
  completedOnce: boolean;
}

/**
 * Compute the canonical setup state from chronological source bars.
 *
 * Complexity is O(n); no wall clock, I/O, chart API, mutable module state, or randomness is used.
 */
export function computeNineBarExhaustion(input: readonly NineBarInputBar[], options: NineBarOptions): NineBarResult {
  const bars = Array.isArray(input) ? input : [];
  const normalized = normalizeOptions(options);

  for (let i = 0; i < bars.length; i++) {
    const t = bars[i]?.t;
    if (!finite(t) || (i > 0 && t <= bars[i - 1].t)) {
      return {
        ok: false,
        algorithmVersion: NINE_BAR_ALGORITHM_VERSION,
        error: { code: "non_chronological", message: `bar ${i} does not have a strictly increasing finite time`, i },
      };
    }
  }
  if (normalized.formingBarIndex !== null && (
    normalized.formingBarIndex < 0
    || normalized.formingBarIndex >= bars.length
    || normalized.formingBarIndex !== bars.length - 1
  )) {
    return {
      ok: false,
      algorithmVersion: NINE_BAR_ALGORITHM_VERSION,
      error: {
        code: "invalid_forming_index",
        message: "formingBarIndex must identify the final input bar",
        i: normalized.formingBarIndex,
      },
    };
  }

  const points: NineBarPoint[] = [];
  const events: NineBarCompletionEvent[] = [];
  const episodes: NineBarEpisode[] = [];
  const missing = new Set<number>();
  let validComparisons = 0;
  let interruptions = 0;
  let previousRelation: NineBarDirection | null = null;
  let run: ActiveRun | null = null;

  const finishRun = (endI: number) => {
    if (!run) return;
    const episode = episodes[run.episodeIndex];
    episode.endI = Math.max(episode.startI, endI);
    episode.maxStreak = Math.max(episode.maxStreak, run.absoluteStreak);
    episode.active = false;
    run = null;
  };

  const startRun = (direction: NineBarDirection, i: number): ActiveRun => {
    const episodeIndex = episodes.length;
    episodes.push({
      id: `${NINE_BAR_ALGORITHM_VERSION}|${normalized.symbol}|${normalized.timeframe}|${normalized.session}|${direction}|${barId(bars[i])}`,
      direction,
      startI: i,
      endI: i,
      maxStreak: 0,
      completedCycles: 0,
      active: true,
    });
    return { direction, episodeIndex, startI: i, absoluteStreak: 0, cyclePointIndexes: [], completedOnce: false };
  };

  for (let i = NINE_BAR_LOOKBACK; i < bars.length; i++) {
    const current = bars[i];
    const reference = bars[i - NINE_BAR_LOOKBACK];
    let relation: NineBarDirection | null = null;
    if (finite(current.c) && finite(reference.c)) {
      if (current.c > reference.c) relation = "rising";
      else if (current.c < reference.c) relation = "falling";
      validComparisons++;
    } else {
      if (!finite(current.c)) missing.add(i);
      if (!finite(reference.c)) missing.add(i - NINE_BAR_LOOKBACK);
    }

    if (relation === null) {
      if (run) interruptions++;
      finishRun(i - 1);
      previousRelation = null;
      continue;
    }

    if (run && run.direction !== relation) {
      interruptions++;
      finishRun(i - 1);
    }

    if (!run) {
      const mayStart = !normalized.requirePriceFlip || previousRelation === opposite(relation);
      if (!mayStart) {
        previousRelation = relation;
        continue;
      }
      run = startRun(relation, i);
    }

    run.absoluteStreak++;
    const cycle = normalized.cycleMode === "repeat"
      ? Math.floor((run.absoluteStreak - 1) / NINE_BAR_TARGET) + 1
      : 1;
    const count = normalized.cycleMode === "repeat"
      ? ((run.absoluteStreak - 1) % NINE_BAR_TARGET) + 1
      : Math.min(run.absoluteStreak, NINE_BAR_TARGET);

    const episode = episodes[run.episodeIndex];
    episode.endI = i;
    episode.maxStreak = run.absoluteStreak;

    // In single-cycle mode the post-completion tail remains part of current streak state but emits
    // no repeated 9 labels or events.
    const shouldMaterialize = normalized.cycleMode === "repeat" || !run.completedOnce;
    if (shouldMaterialize) {
      const forming = normalized.formingBarIndex === i;
      const pointIndex = points.length;
      const pointIdentity = `${NINE_BAR_ALGORITHM_VERSION}|${normalized.symbol}|${normalized.timeframe}|${normalized.session}|${relation}|${cycle}|${count}|${barId(current)}`;
      const point: NineBarPoint = {
        id: pointIdentity,
        algorithmVersion: NINE_BAR_ALGORITHM_VERSION,
        symbol: normalized.symbol,
        timeframe: normalized.timeframe,
        session: normalized.session,
        barId: barId(current),
        i,
        sourceT: current.t,
        earliestObservableT: finite(current.availableT) ? current.availableT : current.t,
        compareI: i - NINE_BAR_LOOKBACK,
        compareT: reference.t,
        close: current.c,
        compareClose: reference.c,
        direction: relation,
        reversalDir: reversal(relation),
        absoluteStreak: run.absoluteStreak,
        cycle,
        count,
        forming,
        completed: false,
        confirmedAt: null,
        historicalDisplayEligible: false,
        displayEligible: false,
      };
      points.push(point);
      run.cyclePointIndexes.push(pointIndex);

      if (count === NINE_BAR_TARGET && !forming) {
        point.completed = true;
        point.confirmedAt = i;
        for (const idx of run.cyclePointIndexes) points[idx].historicalDisplayEligible = true;
        episode.completedCycles++;
        const eventIdentity = `${NINE_BAR_ALGORITHM_VERSION}|${normalized.symbol}|${normalized.timeframe}|${normalized.session}|${relation}|${cycle}|${barId(current)}`;
        events.push({
          id: eventIdentity,
          algorithmVersion: NINE_BAR_ALGORITHM_VERSION,
          symbol: normalized.symbol,
          timeframe: normalized.timeframe,
          session: normalized.session,
          direction: relation,
          reversalDir: reversal(relation),
          cycle,
          i,
          confirmedAt: i,
          sourceT: current.t,
          earliestObservableT: point.earliestObservableT,
          close: current.c,
          compareI: point.compareI,
          compareT: point.compareT,
          compareClose: reference.c,
          absoluteStreak: run.absoluteStreak,
        });
        run.cyclePointIndexes = [];
        if (normalized.cycleMode === "single") run.completedOnce = true;
      }
    }

    previousRelation = relation;
  }

  if (run) {
    const episode = episodes[run.episodeIndex];
    episode.active = true;
    episode.maxStreak = Math.max(episode.maxStreak, run.absoluteStreak);
    const activeCount = normalized.cycleMode === "repeat"
      ? ((run.absoluteStreak - 1) % NINE_BAR_TARGET) + 1
      : Math.min(run.absoluteStreak, NINE_BAR_TARGET);
    const revealActive = !run.completedOnce && (
      normalized.displayPolicy === "progressive"
      || (normalized.displayPolicy === "retro6" && activeCount >= NINE_BAR_RETRO_REVEAL)
    );
    if (revealActive) {
      for (const idx of run.cyclePointIndexes) points[idx].historicalDisplayEligible = true;
    }
  }

  const historyStart = Math.max(0, bars.length - normalized.historyBars);
  for (const point of points) {
    const densityOk = normalized.density === "all"
      || (normalized.density === "late" && point.count >= NINE_BAR_RETRO_REVEAL)
      || (normalized.density === "completion" && point.count === NINE_BAR_TARGET);
    point.displayEligible = point.historicalDisplayEligible && densityOk && point.i >= historyStart;
  }

  let current: NineBarCurrentState | null = null;
  if (run) {
    const count = normalized.cycleMode === "repeat"
      ? ((run.absoluteStreak - 1) % NINE_BAR_TARGET) + 1
      : Math.min(run.absoluteStreak, NINE_BAR_TARGET);
    const cycle = normalized.cycleMode === "repeat"
      ? Math.floor((run.absoluteStreak - 1) / NINE_BAR_TARGET) + 1
      : 1;
    current = {
      direction: run.direction,
      absoluteStreak: run.absoluteStreak,
      cycle,
      count,
      forming: normalized.formingBarIndex === bars.length - 1,
    };
  }

  return {
    ok: true,
    algorithmVersion: NINE_BAR_ALGORITHM_VERSION,
    options: normalized,
    points,
    events,
    episodes,
    current,
    coverage: {
      bars: bars.length,
      warmupBars: Math.min(NINE_BAR_LOOKBACK, bars.length),
      comparisonSlots: Math.max(0, bars.length - NINE_BAR_LOOKBACK),
      validComparisons,
      missingBars: missing.size,
      interruptions,
      mode: "bar_based",
      lookbackBars: NINE_BAR_LOOKBACK,
    },
  };
}

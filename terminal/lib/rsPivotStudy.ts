/**
 * RS x 30-minute pivot — ON-DEMAND, LOCAL, SHADOW research preview.
 *
 * Does not score live entries, publish alerts, persist events, or replace Macro's
 * Setup Species / Evaluation OS. Historical bar geometry is NOT a PIT availability
 * receipt. Relative strength here means excess trailing price return vs benchmark,
 * NOT institutional-flow identification or a cross-sectional percentile rank.
 */
import { type Bar6, resampleUsEquitySession } from "./intradayShared";
import { liveDisplayEpoch } from "./liveCandle";
import { usRegularSessionWindow } from "./usEquitySessionClock";
import { findPivotsHL, type Pivot } from "./suites/structure/pivots";

export type StudyArm = "rs_pivot" | "pivot" | "rs_ema" | "ema";
export const STUDY_ARMS: StudyArm[] = ["rs_pivot", "pivot", "rs_ema", "ema"];

export interface StudySettings {
  costBps: number;             // total round trip basis points (fees + spread + slippage)
  holdBars: 13 | 26 | 39;     // completed RTH 30-minute bars; overnight gap risk included
  touchTolerancePct: number;
  pivotMaxAgeBars: number;
  rsShortBars: number;         // completed aligned RTH bars; 65 approximates 5 sessions
  rsLongBars: number;          // 260 approximates 20 sessions
}
export const STUDY_DEFAULTS: StudySettings = Object.freeze({
  costBps: 10,
  holdBars: 26,
  touchTolerancePct: 0.0075,
  pivotMaxAgeBars: 39,
  rsShortBars: 65,
  rsLongBars: 260,
});

export interface StudyTrade {
  arm: StudyArm;
  pivotAt: number | null;
  confirmedAt: number | null;
  signalBarAt: number;
  signalAt: number; // completed-bar observation, never the bar open
  exitBarAt: number;
  exitTiming: "open" | "within_bar_unknown" | "close";
  grossR: number;
  costsR: number;
  entryAt: number;
  exitAt: number;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  exitReason: "stop" | "target" | "time";
  rsShortExcessPct: number;
  rsLongExcessPct: number;
  rNet: number;
  mfeR: number;
  maeR: number;
}
export interface StudySummary {
  trades: number;
  wins: number;
  winRate: number | null;
  expectancyR: number | null;
  medianR: number | null;
  profitFactor: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
}
export interface StudyArmResult {
  arm: StudyArm;
  summary: StudySummary;
  earlier: StudySummary;
  recent: StudySummary;
  censored: number;
  candidates: number;
  filteredRS: number;
  rejectedRisk: number;
  missedEntry: number;
  overlapping: number;
  unresolved: number;
  trades: StudyTrade[];
}
export interface StudyReport {
  schema: "terminal.rs_pivot_study.v2";
  engineRevision: "rs30-causal-v2";
  clockBasis: "ET_wall_clock_display_epoch_not_UTC";
  asOfDisplayEpoch: number;
  authority: "exploratory_display_only";
  benchmark: string;
  rsPath: Array<{ time: number; shortExcessPct: number; longExcessPct: number }>;
  lastCompleted: { closeAt: number; close: number; pivotPrice: number | null; confirmedAt: number | null } | null;
  coverage: {
    symbolBars: number;
    benchmarkBars: number;
    alignedBars: number;
    completeSessions: number;
    incompleteSessions: number;
    segments: number;
    missingExchangeSessions: number;
    excludedFutureBars: number;
    discontinuities: number;
    chronologicalCutDate: string;
    firstDate: string;
    lastDate: string;
  };
  settings: StudySettings;
  results: StudyArmResult[];
  limitations: string[];
}
type Level = Pivot & { kind: "low" };

function day(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}
function minutes(t: number): number {
  return ((Math.floor(t / 60) % 1440) + 1440) % 1440;
}
function valid(b: Bar6): boolean {
  if (!Array.isArray(b) || b.length !== 6 || !b.every(Number.isFinite)) return false;
  const [, o, h, l, c, v] = b;
  return Number.isSafeInteger(b[0]) && b[0] > 0 && o > 0 && l > 0 &&
    c > 0 && h >= Math.max(o, c, l) && l <= Math.min(o, c, h) && v >= 0;
}
function checkSeries(bars: Bar6[], label: string): void {
  if (!Array.isArray(bars)) throw new Error(label + ": missing bars");
  let prev = -1;
  for (const bar of bars) {
    if (!valid(bar) || bar[0] <= prev) throw new Error(label + ": malformed, duplicate or out-of-order bars");
    prev = bar[0];
  }
}
function ensureSettings(s: StudySettings): void {
  if (!Number.isFinite(s.costBps) || s.costBps < 0 || s.costBps > 150 ||
      ![13, 26, 39].includes(s.holdBars) ||
      !Number.isFinite(s.touchTolerancePct) || s.touchTolerancePct < 0 || s.touchTolerancePct > 0.03 ||
      !Number.isSafeInteger(s.pivotMaxAgeBars) || s.pivotMaxAgeBars < 5 || s.pivotMaxAgeBars > 100 ||
      !Number.isSafeInteger(s.rsShortBars) || s.rsShortBars < 3 ||
      !Number.isSafeInteger(s.rsLongBars) || s.rsLongBars < s.rsShortBars + 1) {
    throw new Error("Unsupported RS pivot study parameters");
  }
}

export function summarizeTrades(rows: readonly StudyTrade[]): StudySummary {
  if (!rows.length) return { trades: 0, wins: 0, winRate: null, expectancyR: null, medianR: null, profitFactor: null, avgMfeR: null, avgMaeR: null };
  const rs = rows.map(t => t.rNet).sort((a, b) => a - b);
  const wins = rs.filter(r => r > 0);
  const losses = rs.filter(r => r < 0);
  const med = rs.length % 2 ? rs[(rs.length - 1) / 2] : (rs[rs.length / 2 - 1] + rs[rs.length / 2]) / 2;
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    trades: rs.length,
    wins: wins.length,
    winRate: wins.length / rs.length,
    expectancyR: sum(rs) / rs.length,
    medianR: med,
    profitFactor: losses.length ? sum(wins) / Math.abs(sum(losses)) : null,
    avgMfeR: sum(rows.map(r => r.mfeR)) / rs.length,
    avgMaeR: sum(rows.map(r => r.maeR)) / rs.length,
  };
}

function ema20(bars: Bar6[]): number[] {
  const alpha = 2 / 21;
  const out: number[] = [];
  for (let i = 0; i < bars.length; i++)
    out.push(i === 0 ? bars[i][4] : alpha * bars[i][4] + (1 - alpha) * out[i - 1]);
  return out;
}
function atr14(bars: Bar6[]): number[] {
  const out: number[] = [];
  const alpha = 1 / 14;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = i ? bars[i - 1][4] : b[4];
    const tr = Math.max(b[2] - b[3], Math.abs(b[2] - prevClose), Math.abs(b[3] - prevClose));
    out.push(i === 0 ? tr : out[i - 1] * (1 - alpha) + tr * alpha);
  }
  return out;
}

/** Nominal candle geometry only. Scientific/source qualification stays in ingest/intraday_qualification.py. */
export function prepareStudyBarsFrom5m(raw: Bar6[], asOfDisplayEpoch: number) {
  checkSeries(raw, "5m input");
  const grid = new Set<number>();
  for (const b of raw) {
    const w = usRegularSessionWindow(b[0]);
    if (!w || minutes(b[0]) < w[0] || minutes(b[0]) >= w[1]) continue;
    if ((b[0] % 60) !== 0 || (minutes(b[0]) - w[0]) % 5 !== 0) throw new Error("Malformed 5m input grid");
    grid.add(b[0]);
  }
  const grouped = resampleUsEquitySession(raw, 30, "regular");
  let incompleteBuckets = 0, futureBuckets = 0;
  const bars = grouped.filter(b => {
    if (b[0] + 1800 > asOfDisplayEpoch) { futureBuckets++; return false; }
    if (!Array.from({ length: 6 }, (_, n) => b[0] + n * 300).every(t => grid.has(t))) { incompleteBuckets++; return false; }
    return true;
  });
  return { bars, rawBars: raw.length, incompleteBuckets, futureBuckets, meaning: "six_nominal_5m_slots_not_feed_or_PIT_qualification" as const };
}

/** Next exchange candle open, including holidays/half-days; no weekday heuristic. */
export function nextStudyBarOpen(t: number): number {
  const w = usRegularSessionWindow(t);
  if (!w) throw new Error("Non-session candle");
  if (minutes(t) + 30 < w[1]) return t + 1800;
  let midnight = Math.floor(t / 86400) * 86400;
  for (let n = 0; n < 10; n++) {
    midnight += 86400;
    const next = usRegularSessionWindow(midnight);
    if (next) return midnight + next[0] * 60;
  }
  throw new Error("US_SESSION_CLOCK_UNAVAILABLE");
}

/**
 * Pure completed-bar replay. Input and all exported clocks are ET display epochs.
 * Freeze asOfDisplayEpoch with the inputs when reproducing an export.
 */
export function runRSPivotStudy(
  symbolBars: Bar6[], benchmarkBars: Bar6[], benchmark = "SPY",
  overrides: Partial<StudySettings> = {},
  asOfDisplayEpoch = liveDisplayEpoch(Date.now(), "us") ?? 0,
): StudyReport {
  const s = { ...STUDY_DEFAULTS, ...overrides };
  ensureSettings(s);
  checkSeries(symbolBars, "symbol"); checkSeries(benchmarkBars, "benchmark");
  if (!Number.isSafeInteger(asOfDisplayEpoch) || asOfDisplayEpoch <= 0) throw new Error("Invalid observation cutoff");
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(benchmark)) throw new Error("Invalid benchmark");
  const benchByTime = new Map(benchmarkBars.map(b => [b[0], b]));
  const paired: Array<{ stock: Bar6; bench: Bar6 }> = [];
  const counts = new Map<string, number>();
  let excludedFutureBars = 0;
  for (const b of symbolBars) {
    const w = usRegularSessionWindow(b[0]);
    if (!w || minutes(b[0]) < w[0] || minutes(b[0]) + 30 > w[1] || (minutes(b[0]) - w[0]) % 30 !== 0) continue;
    counts.set(day(b[0]), counts.get(day(b[0])) ?? 0);
    if (b[0] + 1800 > asOfDisplayEpoch) { excludedFutureBars++; continue; }
    const mate = benchByTime.get(b[0]);
    if (!mate) continue;
    paired.push({ stock: b, bench: mate });
    counts.set(day(b[0]), (counts.get(day(b[0])) ?? 0) + 1);
  }
  const good = new Set<string>();
  for (const [date, count] of counts) {
    const w = usRegularSessionWindow(Date.parse(date + "T09:30:00Z") / 1000);
    if (w && count === (w[1] - w[0]) / 30) good.add(date);
  }
  const aligned = paired.filter(p => good.has(day(p.stock[0])));
  if (good.size < 22 || aligned.length < s.rsLongBars + 5) throw new Error("Insufficient complete, aligned 30-minute sessions for this study");
  const sessions = Array.from(good).sort();
  const cutDate = sessions[Math.floor(sessions.length * 0.7)] ?? sessions[sessions.length - 1];
  const bars = aligned.map(x => x.stock), spy = aligned.map(x => x.bench);
  const segments: Array<{ start: number; end: number }> = [];
  let begin = 0, discontinuities = 0;
  for (let i = 1; i < bars.length; i++) {
    // Missing exchange observations and large ambiguous action/price gaps reset ALL state.
    const actionGap = Math.abs(Math.log(bars[i][1] / bars[i - 1][4])) > Math.log(1.25) ||
      Math.abs(Math.log(spy[i][1] / spy[i - 1][4])) > Math.log(1.25);
    if (nextStudyBarOpen(bars[i - 1][0]) !== bars[i][0] || actionGap) {
      segments.push({ start: begin, end: i - 1 }); begin = i;
      if (actionGap) discontinuities++;
    }
  }
  segments.push({ start: begin, end: bars.length - 1 });
  let missingExchangeSessions = 0;
  for (let t = Math.floor(bars[0][0] / 86400) * 86400; t <= bars.at(-1)![0]; t += 86400) {
    if (usRegularSessionWindow(t) && !good.has(day(t))) missingExchangeSessions++;
  }
  type Candidate = { i: number; stop: number; pivotAt: number | null; confirmedAt: number | null; shortR: number; longR: number };
  const pools: Record<"pivot" | "ema", Candidate[]> = { pivot: [], ema: [] };
  const segmentEnds = new Map<number, number>();
  const rsPath: StudyReport["rsPath"] = [];
  let lastCompleted: StudyReport["lastCompleted"] = null;
  for (const segment of segments) {
    const local = bars.slice(segment.start, segment.end + 1), bench = spy.slice(segment.start, segment.end + 1);
    const ema = ema20(local), atr = atr14(local);
    const pv = findPivotsHL(local.map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })), 2, 2)
      .filter(p => p.kind === "low") as Level[];
    const lastPivot = pv.filter(p => p.confirmedAt < local.length - 1).at(-1);
    lastCompleted = { closeAt: local.at(-1)![0] + 1800, close: local.at(-1)![4],
      pivotPrice: lastPivot?.p ?? null, confirmedAt: lastPivot ? local[lastPivot.confirmedAt][0] + 1800 : null };
    let pi = 0, latest: Level | null = null;
    const consumed = new Set<number>();
    const used = { pivot: new Set<string>(), ema: new Set<string>() };
    for (let i = Math.max(s.rsLongBars, 22); i < local.length; i++) {
      // A setup must already be confirmed BEFORE this reclaim candle opens.
      while (pi < pv.length && pv[pi].confirmedAt < i) latest = pv[pi++];
      const b = local[i], prev = local[i - 1];
      const shortR = Math.log(b[4] / local[i - s.rsShortBars][4]) - Math.log(bench[i][4] / bench[i - s.rsShortBars][4]);
      const longR = Math.log(b[4] / local[i - s.rsLongBars][4]) - Math.log(bench[i][4] / bench[i - s.rsLongBars][4]);
      rsPath.push({ time: b[0], shortExcessPct: 100 * (Math.exp(shortR) - 1), longExcessPct: 100 * (Math.exp(longR) - 1) });
      if (b[4] <= b[1] || !(atr[i] > 0)) continue;
      const p = latest;
      const pivot = p && i - p.i <= s.pivotMaxAgeBars && !consumed.has(p.i) && b[3] <= p.p * (1 + s.touchTolerancePct) && b[3] >= p.p - atr[i] * 0.25 && b[4] > p.p;
      const emaReclaim = prev[4] <= ema[i - 1] && b[4] > ema[i];
      for (const family of ["pivot", "ema"] as const) {
        if (!(family === "pivot" ? pivot : emaReclaim) || used[family].has(day(b[0]))) continue;
        // Freeze the shared opportunity population BEFORE RS filters or outcomes.
        pools[family].push({ i: segment.start + i, stop: (family === "pivot" ? p!.p : Math.min(b[3], ema[i])) - atr[i] * 0.2,
          pivotAt: family === "pivot" ? local[p!.i][0] : null,
          confirmedAt: family === "pivot" ? local[p!.confirmedAt][0] + 1800 : null, shortR, longR });
        used[family].add(day(b[0]));
        if (family === "pivot") consumed.add(p!.i);
        segmentEnds.set(segment.start + i, segment.end);
      }
    }
  }
  const results: StudyArmResult[] = [];
  for (const arm of STUDY_ARMS) {
    const candidates = pools[arm === "rs_pivot" || arm === "pivot" ? "pivot" : "ema"];
    const trades: StudyTrade[] = [];
    let censored = 0, filteredRS = 0, rejectedRisk = 0, missedEntry = 0, overlapping = 0, unresolved = 0, occupiedUntil = -1;
    for (const candidate of candidates) {
      const { i, stop, shortR, longR } = candidate;
      if ((arm === "rs_pivot" || arm === "rs_ema") && !(shortR > 0 && longR > 0)) { filteredRS++; continue; }
      if (i <= occupiedUntil) { overlapping++; continue; }
      const next = bars[i + 1], segmentEnd = segmentEnds.get(i)!;
      if (!next || i + 1 > segmentEnd) {
        if (i === bars.length - 1) censored++; else missedEntry++;
        continue;
      }
      const entry = next[1], risk = entry - stop;
      if (!(risk > 0) || risk / entry < 0.002 || risk / entry > 0.06) { rejectedRisk++; continue; }
      const target = entry + 2 * risk, end = Math.min(segmentEnd, i + s.holdBars);
      let exitIndex = -1, exit = 0, exitReason: StudyTrade["exitReason"] = "time", exitTiming: StudyTrade["exitTiming"] = "close", mfe = 0, mae = 0;
      for (let k = i + 1; k <= end; k++) {
        const candle = bars[k];
        // At open the price is observed before any intra-bar high/low.
        if (candle[1] <= stop || candle[1] >= target) {
          exit = candle[1] <= stop ? candle[1] : target;
          exitReason = candle[1] <= stop ? "stop" : "target"; exitTiming = "open"; exitIndex = k;
          mfe = Math.max(mfe, (exit - entry) / risk); mae = Math.min(mae, (exit - entry) / risk); break;
        }
        if (candle[3] <= stop) {
          exit = stop; exitReason = "stop"; exitTiming = "within_bar_unknown"; exitIndex = k;
          // Do not count a post-stop high as realizable favorable excursion.
          mfe = Math.max(mfe, (candle[1] - entry) / risk); mae = Math.min(mae, -1); break;
        }
        if (candle[2] >= target) {
          exit = target; exitReason = "target"; exitTiming = "within_bar_unknown"; exitIndex = k;
          mfe = Math.max(mfe, 2); mae = Math.min(mae, (candle[3] - entry) / risk); break;
        }
        mfe = Math.max(mfe, (candle[2] - entry) / risk); mae = Math.min(mae, (candle[3] - entry) / risk);
        if (k === i + s.holdBars) { exit = candle[4]; exitIndex = k; }
      }
      if (exitIndex < 0) {
        if (segmentEnd === bars.length - 1) censored++; else unresolved++;
        occupiedUntil = end; continue;
      }
      const friction = ((entry + exit) / 2) * s.costBps / 10000;
      trades.push({ arm, pivotAt: candidate.pivotAt, confirmedAt: candidate.confirmedAt,
        signalBarAt: bars[i][0], signalAt: bars[i][0] + 1800, entryAt: next[0],
        exitBarAt: bars[exitIndex][0], exitAt: bars[exitIndex][0] + (exitTiming === "open" ? 0 : 1800),
        exitTiming, entry, stop, target, exit, exitReason, grossR: (exit - entry) / risk, costsR: friction / risk,
        rsShortExcessPct: 100 * (Math.exp(shortR) - 1), rsLongExcessPct: 100 * (Math.exp(longR) - 1),
        rNet: (exit - entry - friction) / risk, mfeR: mfe, maeR: mae });
      occupiedUntil = exitIndex;
    }
    results.push({ arm, summary: summarizeTrades(trades), earlier: summarizeTrades(trades.filter(t => day(t.signalBarAt) < cutDate)),
      recent: summarizeTrades(trades.filter(t => day(t.signalBarAt) >= cutDate)),
      candidates: candidates.length, filteredRS, rejectedRisk, missedEntry, overlapping, unresolved, censored, trades });
  }
  return {
    schema: "terminal.rs_pivot_study.v2", engineRevision: "rs30-causal-v2", clockBasis: "ET_wall_clock_display_epoch_not_UTC",
    asOfDisplayEpoch, authority: "exploratory_display_only", benchmark, rsPath, lastCompleted,
    coverage: { symbolBars: symbolBars.length, benchmarkBars: benchmarkBars.length, alignedBars: aligned.length,
      completeSessions: good.size, incompleteSessions: counts.size - good.size, segments: segments.length,
      missingExchangeSessions, excludedFutureBars, discontinuities, chronologicalCutDate: cutDate, firstDate: sessions[0], lastDate: sessions.at(-1)! },
    settings: s, results,
    limitations: [
      "Corrected bar history is not point-in-time availability or instrument/corporate-action certification.",
      "RS is excess log return over 65/260 aligned bars by default, approximate sessions, not cross-sectional rank or institutional buying.",
      "The interactive 70/30 split is descriptive, NOT an untouched holdout.",
      "Missing sessions and large ambiguous gaps reset indicators, pivots and RS; unresolved trades are excluded from resolved-trade metrics.",
      "Within-bar exit time and order are unknown; stop wins a stop/target tie. Excursions are conservative OHLC estimates.",
      "Fixed round-trip bps are an assumed cost scenario, not an observed spread/slippage model; sector/regime matched panels remain unqualified.",
      "No live signals, alerts, orders, sizing or scientific promotion are published.",
    ],
  };
}

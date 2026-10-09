/**
 * RS x 30-minute pivot — ON-DEMAND, LOCAL, SHADOW research preview.
 *
 * Does not score live entries, publish alerts, persist events, or replace Macro's
 * Setup Species / Evaluation OS. Historical bar geometry is NOT a PIT availability
 * receipt. Relative strength here means excess trailing price return vs benchmark,
 * NOT institutional-flow identification or a cross-sectional percentile rank.
 */
import { type Bar6 } from "./intradayShared";
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
  signalAt: number;
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
  trades: StudyTrade[];
}
export interface StudyReport {
  schema: "terminal.rs_pivot_study.v1";
  authority: "exploratory_display_only";
  benchmark: string;
  coverage: {
    symbolBars: number;
    benchmarkBars: number;
    alignedBars: number;
    completeSessions: number;
    incompleteSessions: number;
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

/** Bar-open epochs are market-local ET "display epochs", not UTC instants. */
export function runRSPivotStudy(
  symbolBars: Bar6[],
  benchmarkBars: Bar6[],
  benchmark = "SPY",
  overrides: Partial<StudySettings> = {},
): StudyReport {
  const s = { ...STUDY_DEFAULTS, ...overrides };
  ensureSettings(s);
  checkSeries(symbolBars, "symbol");
  checkSeries(benchmarkBars, "benchmark");
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(benchmark)) throw new Error("Invalid benchmark");
  const benchByTime = new Map(benchmarkBars.map(b => [b[0], b]));
  const paired: Array<{ stock: Bar6; bench: Bar6 }> = [];
  const counts = new Map<string, number>();
  for (const b of symbolBars) {
    const mate = benchByTime.get(b[0]);
    if (!mate) continue;
    const window = usRegularSessionWindow(b[0]);
    if (!window) continue;
    const minute = minutes(b[0]);
    if (minute < window[0] || minute + 30 > window[1] || (minute - window[0]) % 30 !== 0) continue;
    paired.push({ stock: b, bench: mate });
    counts.set(day(b[0]), (counts.get(day(b[0])) || 0) + 1);
  }
  const good = new Set<string>();
  for (const [date, count] of counts) {
    const w = usRegularSessionWindow(Date.parse(date + "T09:30:00Z") / 1000);
    if (w && count === (w[1] - w[0]) / 30) good.add(date);
  }
  // Avoid pretending an incomplete day or missing benchmark is a continuous 30m sequence.
  // The last session may be live/partially formed; it cannot open a research trade.
  const aligned = paired.filter(p => good.has(day(p.stock[0])));
  if (good.size < 22 || aligned.length < s.rsLongBars + s.holdBars + 10) {
    throw new Error("Insufficient complete, aligned 30-minute sessions for this study");
  }
  const sessions = Array.from(good).sort();
  const cutDate = sessions[Math.floor(sessions.length * 0.7)] ?? sessions[sessions.length - 1];
  const bars = aligned.map(x => x.stock);
  const spy = aligned.map(x => x.bench);
  const ema = ema20(bars), atr = atr14(bars);
  const pv = findPivotsHL(bars.map(b => ({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })), 2, 2)
    .filter(p => p.kind === "low") as Level[];
  const results: StudyArmResult[] = [];
  for (const arm of STUDY_ARMS) {
    const trades: StudyTrade[] = [];
    const consumed = new Set<number>();
    const usedDates = new Set<string>();
    let censored = 0;
    let occupiedUntil = -1;
    let pvIndex = 0;
    let latestPivot: Level | null = null;
    const isPivot = arm === "rs_pivot" || arm === "pivot";
    const requireRS = arm === "rs_pivot" || arm === "rs_ema";
    for (let i = Math.max(s.rsLongBars, 22); i < bars.length - 1; i++) {
      // A pivot with right=2 is actionable AFTER its confirmation BAR CLOSE, not at its extreme.
      while (pvIndex < pv.length && pv[pvIndex].confirmedAt < i) {
        latestPivot = pv[pvIndex++];
      }
      if (i <= occupiedUntil) continue;
      const b = bars[i], prev = bars[i - 1];
      const shortR = Math.log(b[4] / bars[i - s.rsShortBars][4]) -
        Math.log(spy[i][4] / spy[i - s.rsShortBars][4]);
      const longR = Math.log(b[4] / bars[i - s.rsLongBars][4]) -
        Math.log(spy[i][4] / spy[i - s.rsLongBars][4]);
      if (requireRS && !(shortR > 0 && longR > 0)) continue;
      if (usedDates.has(day(b[0])) || b[4] <= b[1] || !(atr[i] > 0)) continue;
      let signal = false;
      let stopBase = 0;
      let pivotAt: number | null = null, confirmedAt: number | null = null;
      if (isPivot) {
        const p = latestPivot;
        if (p && i - p.i <= s.pivotMaxAgeBars && !consumed.has(p.i) &&
          b[3] <= p.p * (1 + s.touchTolerancePct) &&
          b[3] >= p.p - atr[i] * 0.25 && b[4] > p.p) {
          signal = true;
          stopBase = p.p;
          pivotAt = bars[p.i][0];
          confirmedAt = bars[p.confirmedAt][0];
        }
      } else if (prev[4] <= ema[i - 1] && b[4] > ema[i]) {
        signal = true;
        stopBase = Math.min(b[3], ema[i]);
      }
      if (!signal) continue;
      const next = bars[i + 1];
      // A next-session open can gap past the intended stop. It may not be booked
      // as a fill at the previous close or the structural pivot.
      const entry = next[1], stop = stopBase - atr[i] * 0.20;
      const risk = entry - stop;
      if (!(risk > 0) || risk / entry < 0.002 || risk / entry > 0.06) continue;
      const target = entry + 2 * risk;
      let exitIndex = -1, exit = 0, exitReason: StudyTrade["exitReason"] = "time";
      let mfe = 0, mae = 0;
      const end = Math.min(bars.length - 1, i + s.holdBars);
      for (let k = i + 1; k <= end; k++) {
        const candle = bars[k];
        // Missing whole sessions were removed from aligned, so a crossing position
        // would have unobserved risk. Do not silently bridge such a calendar gap.
        const gapDays = Math.floor(candle[0] / 86400) - Math.floor(bars[k - 1][0] / 86400);
        if (gapDays > 4) break;
        mfe = Math.max(mfe, (candle[2] - entry) / risk);
        mae = Math.min(mae, (candle[3] - entry) / risk);
        if (candle[1] <= stop) { exit = candle[1]; exitReason = "stop"; exitIndex = k; break; }
        if (candle[3] <= stop) { exit = stop; exitReason = "stop"; exitIndex = k; break; }
        // Stop beats target if both print on one OHLC candle: pessimistic tie-break.
        if (candle[2] >= target) { exit = target; exitReason = "target"; exitIndex = k; break; }
        if (k === i + s.holdBars) { exit = candle[4]; exitReason = "time"; exitIndex = k; }
      }
      if (exitIndex < 0) { censored++; continue; }
      // Bps are ROUNDTRIP vs average traded notional, not erroneously bps per side.
      const friction = ((entry + exit) / 2) * s.costBps / 10_000;
      const rNet = (exit - entry - friction) / risk;
      trades.push({ arm, pivotAt, confirmedAt, signalAt: b[0], entryAt: next[0],
        exitAt: bars[exitIndex][0], entry, stop, target, exit, exitReason,
        rsShortExcessPct: 100 * (Math.exp(shortR) - 1),
        rsLongExcessPct: 100 * (Math.exp(longR) - 1),
        rNet, mfeR: mfe, maeR: mae });
      occupiedUntil = exitIndex;
      usedDates.add(day(b[0]));
      if (isPivot && latestPivot) consumed.add(latestPivot.i);
    }
    results.push({ arm, summary: summarizeTrades(trades),
      earlier: summarizeTrades(trades.filter(t => day(t.signalAt) < cutDate)),
      recent: summarizeTrades(trades.filter(t => day(t.signalAt) >= cutDate)),
      censored, trades });
  }
  return {
    schema: "terminal.rs_pivot_study.v1", authority: "exploratory_display_only",
    benchmark,
    coverage: { symbolBars: symbolBars.length, benchmarkBars: benchmarkBars.length,
      alignedBars: aligned.length, completeSessions: good.size,
      incompleteSessions: counts.size - good.size, chronologicalCutDate: cutDate,
      firstDate: sessions[0], lastDate: sessions[sessions.length - 1] },
    settings: s, results,
    limitations: [
      "Corrected bar history is not proof of point-in-time historical availability.",
      "Trailing excess price return is not cross-sectional RS rank or institutional buying evidence.",
      "The recent 30% split is descriptive, NOT a locked untouched holdout; interactive re-tuning contaminates it.",
      "No universe/survivorship, sector matching, catalyst/halts or corporate-action qualification is supplied here.",
      "Same-candle stop and target assumes stop first; overnight gaps use the next available open.",
      "No signals, alerts, broker orders, sized recommendations or scientific promotion are published.",
    ],
  };
}

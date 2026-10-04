// Product momentum math shared by chart projections and parity-locked Python research.
// The legacy Terminal "Stochastic RSI" pane is PRICE stochastic on H/L/C (14,3,3).
// True stochastic-of-RSI is a separately named research candidate, never silently substituted.
export const MOMENTUM_VERSION = "terminal-mtf-momentum/v2";
export const MOMENTUM_EPSILON = 1e-9;
export const MIN_MOMENTUM_BARS = 78;

export type MomentumBar = { h: number; l: number; c: number };
export type MomentumPhase = "washout" | "reclaim" | "bull" | "rollover" | "bear" | "neutral" | "mixed";
export type MomentumPoint = {
  stochK: number | null;
  stochD: number | null;
  rsiMacd: number | null;
  rsiSignal: number | null;
  score: number | null;
  phase: MomentumPhase | null;
};
const finite = (v: number | null): v is number => v != null && Number.isFinite(v);
const direction = (a: number, b: number): -1 | 0 | 1 =>
  a - b > MOMENTUM_EPSILON ? 1 : b - a > MOMENTUM_EPSILON ? -1 : 0;

function period(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("Indicator periods must be positive integers");
}
function sma(values: (number | null)[], n: number): (number | null)[] {
  period(n);
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const window = values.slice(i - n + 1, i + 1);
    if (window.every(finite)) out[i] = window.reduce((sum, v) => sum + v, 0) / n;
  }
  return out;
}
function ema(values: (number | null)[], n: number): (number | null)[] {
  period(n);
  const out: (number | null)[] = Array(values.length).fill(null);
  const alpha = 2 / (n + 1);
  let previous: number | null = null;
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!finite(value)) continue;
    if (previous == null) {
      sum += value;
      if (++count === n) out[i] = previous = sum / n;
    } else out[i] = previous = value * alpha + previous * (1 - alpha);
  }
  return out;
}
export function wilderRsi(close: number[], n = 14): (number | null)[] {
  period(n);
  const out: (number | null)[] = Array(close.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < close.length; i++) {
    const delta = close[i] - close[i - 1];
    const up = Math.max(delta, 0), down = Math.max(-delta, 0);
    if (i <= n) {
      gain += up; loss += down;
      if (i !== n) continue;
      gain /= n; loss /= n;
    } else {
      gain = (gain * (n - 1) + up) / n;
      loss = (loss * (n - 1) + down) / n;
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Mature values match the existing CM price-stochastic pane; no fabricated warmup zeros. */
export function terminalStochastic(bars: MomentumBar[], n = 14, kLength = 3, dLength = 3) {
  period(n);
  const raw: (number | null)[] = Array(bars.length).fill(null);
  for (let i = n - 1; i < bars.length; i++) {
    let high = -Infinity, low = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      high = Math.max(high, bars[j].h); low = Math.min(low, bars[j].l);
    }
    raw[i] = high === low ? 50 : 100 * (bars[i].c - low) / (high - low);
  }
  const k = sma(raw, kLength);
  return { k, d: sma(k, dLength) };
}

/** Research alternative; this is NOT the legacy product's price-stochastic series. */
export function trueStochRsi(close: number[], rsiLength = 14, n = 14, kLength = 3, dLength = 3) {
  period(n);
  const rsi = wilderRsi(close, rsiLength);
  const raw: (number | null)[] = Array(close.length).fill(null);
  for (let i = n - 1; i < close.length; i++) {
    const window = rsi.slice(i - n + 1, i + 1);
    if (!window.every(finite)) continue;
    const low = Math.min(...window), high = Math.max(...window);
    raw[i] = high === low ? 50 : 100 * (rsi[i]! - low) / (high - low);
  }
  const k = sma(raw, kLength);
  return { k, d: sma(k, dLength) };
}
export function rsiMacd(close: number[], rsiLength = 14, fast = 14, slow = 60, signalLength = 5) {
  const rsi = wilderRsi(close, rsiLength), a = ema(rsi, fast), b = ema(rsi, slow);
  const line = close.map((_, i) => finite(a[i]) && finite(b[i]) ? a[i]! - b[i]! : null);
  return { line, signal: ema(line, signalLength) };
}

/** Descriptive prior, not an entry probability. Epsilon suppresses roundoff-only crossovers. */
export function momentumPoints(bars: MomentumBar[]): MomentumPoint[] {
  const close = bars.map((b) => b.c), stochastic = terminalStochastic(bars), macd = rsiMacd(close);
  return bars.map((_, i) => {
    const k = stochastic.k[i], d = stochastic.d[i], m = macd.line[i], s = macd.signal[i];
    const point = { stochK: k, stochD: d, rsiMacd: m, rsiSignal: s };
    if (!finite(k) || !finite(d) || !finite(m) || !finite(s)) return { ...point, score: null, phase: null };
    const kd = direction(k, d), md = direction(m, s);
    const previousK = stochastic.k[i - 1] ?? null;
    const previousM = macd.line[i - 1] ?? null, previousS = macd.signal[i - 1] ?? null;
    const reclaim = kd > 0 && direction(k, 35) < 0 && finite(previousK) && direction(k, previousK) > 0;
    const macdReclaim = md > 0 && direction(m, 0) < 0 && finite(previousM) && finite(previousS)
      && direction(previousM, previousS) <= 0;
    const washout = direction(k, 20) < 0 && direction(d, 20) < 0;
    const rollover = kd < 0 && direction(k, 70) > 0;
    const phase: MomentumPhase = washout ? "washout" : reclaim || macdReclaim ? "reclaim"
      : kd > 0 && md > 0 ? "bull" : rollover ? "rollover"
      : kd < 0 && md < 0 ? "bear" : kd === 0 && md === 0 ? "neutral" : "mixed";
    let score = 50 + (k - 50) * .28 + 12 * kd + 16 * md;
    if (reclaim) score += 10;
    if (macdReclaim) score += 12;
    if (washout && kd < 0) score -= 8;
    return { ...point, score: Math.max(0, Math.min(100, score)), phase };
  });
}
export type TfSnapshot = { tf: string; point: MomentumPoint; weight: number };

/** The caller owns required-frame coverage. A missing required frame must not be silently omitted. */
export function confluenceScore(snapshots: TfSnapshot[], bottomPosition: number | null): number | null {
  if (new Set(snapshots.map((s) => s.tf)).size !== snapshots.length) throw new RangeError("Duplicate timeframes");
  if (snapshots.some((s) => !Number.isFinite(s.weight) || s.weight <= 0)) throw new RangeError("Weights must be positive and finite");
  if (bottomPosition != null && !Number.isFinite(bottomPosition)) throw new RangeError("Invalid bottom position");
  if (!snapshots.length || snapshots.some((s) => !finite(s.point.score))) return null;
  const weight = snapshots.reduce((sum, s) => sum + s.weight, 0);
  let score = snapshots.reduce((sum, s) => sum + s.point.score! * s.weight, 0) / weight;
  const reclaims = snapshots.filter((s) => s.point.phase === "reclaim").length;
  const falling = snapshots.filter((s) => s.point.phase === "washout" || s.point.phase === "bear").length;
  if (bottomPosition != null) score += 10 * (1 - Math.max(0, Math.min(1, bottomPosition)));
  score += Math.min(10, reclaims * 3);
  score -= Math.max(0, falling - 2) * 4;
  return Math.max(0, Math.min(100, score));
}

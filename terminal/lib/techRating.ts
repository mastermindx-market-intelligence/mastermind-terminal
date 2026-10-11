// techRating.ts — client-side TradingView-parity technical rating (BUILD-SPEC §3.1, R13).
// SINGLE AUTHOR: lane FE1a. Pure functions over Bar[]; no server compute.
//
// Implements TradingView's documented "Technical Rating" spec:
//   - 11 oscillators (RSI, Stoch %K, CCI, ADX, Awesome Osc, Momentum, MACD, StochRSI Fast,
//     Williams %R, Bull Bear Power, Ultimate Osc) — each votes Buy / Sell / Neutral.
//   - 15 moving averages (EMA/SMA at 10/20/30/50/100/200, Ichimoku Base, VWMA(20), HMA(9)) —
//     each votes Buy / Sell / Neutral vs price (Ichimoku uses TV's cloud rule).
//   - Group summaries: Oscillators, Moving Averages, and the overall Summary — each maps a
//     score in [-1, 1] to one of 5 zones: Strong sell / Sell / Neutral / Buy / Strong buy.
//   - Pivots: Classic / Fibonacci / Camarilla / Woodie / Demark from the PRIOR period's HLC.
//
// TV rating conditions are documented at tradingview.com (help: "Technical Ratings"). Each rule
// is annotated inline. Votes: score contribution +1 Buy, -1 Sell, 0 Neutral. Group score is the
// mean of member votes; the same 5-zone thresholds TV uses map score→verdict.

import type { Bar } from "./fund";

export type Vote = "Buy" | "Sell" | "Neutral";
export type Verdict = "Strong sell" | "Sell" | "Neutral" | "Buy" | "Strong buy";

export interface Row {
  name: string;
  value: number | null; // the indicator's current numeric value (null if not computable)
  vote: Vote;
}

export interface GroupScore {
  score: number; // mean vote in [-1, 1]
  verdict: Verdict;
  buy: number;
  sell: number;
  neutral: number;
}

export interface PivotLevels {
  method: string;
  p: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
}

export interface PivotTable {
  classic: PivotLevels;
  fibonacci: PivotLevels;
  camarilla: PivotLevels;
  woodie: PivotLevels;
  demark: PivotLevels;
}

export interface Ratings {
  oscillators: Row[];
  mas: Row[];
  pivots: PivotTable;
  // summary tuple: [Oscillators, Moving Averages, Overall Summary]
  summary: [GroupScore, GroupScore, GroupScore];
}

// ─────────────────────────────────────────────────────────────────────────────
// Series helpers (all pure). Arrays are chronological (oldest→newest).
// ─────────────────────────────────────────────────────────────────────────────

const closes = (b: Bar[]) => b.map((x) => x.c);
const highs = (b: Bar[]) => b.map((x) => x.h);
const lows = (b: Bar[]) => b.map((x) => x.l);

function sma(src: number[], len: number): number[] {
  const out: number[] = new Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

// NaN-aware SMA: only begins accumulating once it encounters the first non-NaN value;
// NaN inputs are treated as gaps (not zeros) — the window slides over real values only.
// Used for %K/%D smoothing in Stochastic and StochRSI to prevent fake-zero seed bias.
function smaN(src: number[], len: number): number[] {
  const out: number[] = new Array(src.length).fill(NaN);
  // Track a sliding window of only the finite values that appeared after the first
  // non-NaN entry, preserving positional alignment for the output.
  const buf: number[] = [];
  let started = false;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    if (!isFinite(src[i])) {
      // NaN/Inf gap — don't advance the window; output stays NaN
      continue;
    }
    if (!started) started = true;
    buf.push(src[i]);
    sum += src[i];
    if (buf.length > len) sum -= buf.shift()!;
    if (buf.length === len) out[i] = sum / len;
  }
  return out;
}

function ema(src: number[], len: number): number[] {
  const out: number[] = new Array(src.length).fill(NaN);
  const k = 2 / (len + 1);
  let prev = NaN;
  let finiteCount = 0;
  let seedSum = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (!isFinite(v)) {
      if (isFinite(prev)) out[i] = prev;
      continue;
    }
    if (isNaN(prev)) {
      seedSum += v;
      finiteCount++;
      if (finiteCount === len) {
        prev = seedSum / len;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

// Wilder's RMA (used by RSI/ADX).
// Standard Wilder seeding: accumulate exactly `len` finite values for the SMA seed,
// then apply α=1/len recursive smoothing.  NaN inputs carry the last value forward.
function rma(src: number[], len: number): number[] {
  const out: number[] = new Array(src.length).fill(NaN);
  const a = 1 / len;
  let prev = NaN;
  let finiteCount = 0;
  let seedSum = 0;
  for (let i = 0; i < src.length; i++) {
    if (isNaN(src[i])) {
      out[i] = prev;
      continue;
    }
    if (isNaN(prev)) {
      // accumulate seed window
      seedSum += src[i];
      finiteCount++;
      if (finiteCount === len) {
        prev = seedSum / len;
        out[i] = prev;
      }
      // before seed complete, output stays NaN
    } else {
      prev = a * src[i] + (1 - a) * prev;
      out[i] = prev;
    }
  }
  return out;
}

function wma(src: number[], len: number): number[] {
  const out: number[] = new Array(src.length).fill(NaN);
  const denom = (len * (len + 1)) / 2;
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let j = 0; j < len; j++) s += src[i - j] * (len - j);
    out[i] = s / denom;
  }
  return out;
}

function last(arr: number[]): number {
  return arr.length ? arr[arr.length - 1] : NaN;
}
function prev(arr: number[]): number {
  return arr.length >= 2 ? arr[arr.length - 2] : NaN;
}
function rising(arr: number[]): boolean {
  return last(arr) > prev(arr);
}
function falling(arr: number[]): boolean {
  return last(arr) < prev(arr);
}

// ─────────────────────────────────────────────────────────────────────────────
// Oscillators
// ─────────────────────────────────────────────────────────────────────────────

export function rsi(src: number[], len = 14): number[] {
  // Standard Wilder RSI seeding: index 0 has no prior close, so gains[0]/losses[0]
  // are NaN (excluded from the SMA seed).  First real change is at index 1.
  // rma() seeds with the first `len` finite values then applies α=1/len recursion.
  const gains: number[] = new Array(src.length).fill(NaN);
  const losses: number[] = new Array(src.length).fill(NaN);
  for (let i = 1; i < src.length; i++) {
    const ch = src[i] - src[i - 1];
    gains[i] = ch > 0 ? ch : 0;
    losses[i] = ch < 0 ? -ch : 0;
  }
  const ag = rma(gains, len);
  const al = rma(losses, len);
  return src.map((_, i) => {
    if (isNaN(ag[i]) || isNaN(al[i])) return NaN;
    if (al[i] === 0) return 100;
    const rs = ag[i] / al[i];
    return 100 - 100 / (1 + rs);
  });
}

// Stochastic %K = 100*(close-lowestLow)/(highestHigh-lowestLow), smoothed; %D = SMA(%K, d).
// %K and %D smoothing use smaN() (NaN-aware SMA) to avoid fake-zero warmup bias:
// only real rawK/k values enter the SMA window; NaN warmup slots are skipped.
function stoch(b: Bar[], kLen = 14, kSmooth = 3, dSmooth = 3) {
  const h = highs(b);
  const l = lows(b);
  const c = closes(b);
  const rawK: number[] = new Array(b.length).fill(NaN);
  for (let i = kLen - 1; i < b.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kLen + 1; j <= i; j++) {
      if (h[j] > hh) hh = h[j];
      if (l[j] < ll) ll = l[j];
    }
    rawK[i] = hh === ll ? 50 : (100 * (c[i] - ll)) / (hh - ll);
  }
  const k = smaN(rawK, kSmooth);
  const d = smaN(k, dSmooth);
  return { k, d };
}

// CCI = (tp - SMA(tp)) / (0.015 * mean deviation)
function cci(b: Bar[], len = 20): number[] {
  const tp = b.map((x) => (x.h + x.l + x.c) / 3);
  const ma = sma(tp, len);
  const out: number[] = new Array(b.length).fill(NaN);
  for (let i = len - 1; i < b.length; i++) {
    let md = 0;
    for (let j = i - len + 1; j <= i; j++) md += Math.abs(tp[j] - ma[i]);
    md /= len;
    out[i] = md === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * md);
  }
  return out;
}

// ADX (+ DI/-DI) via Wilder smoothing.
function adx(b: Bar[], len = 14): number[] {
  const n = b.length;
  const tr: number[] = new Array(n).fill(NaN);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = b[i].h - b[i - 1].h;
    const down = b[i - 1].l - b[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
  }
  const atr = rma(tr, len);
  const pDI = rma(plusDM, len).map((v, i) => (atr[i] ? (100 * v) / atr[i] : NaN));
  const mDI = rma(minusDM, len).map((v, i) => (atr[i] ? (100 * v) / atr[i] : NaN));
  const dx = pDI.map((v, i) => {
    const sum = v + mDI[i];
    return sum ? (100 * Math.abs(v - mDI[i])) / sum : NaN;
  });
  return rma(dx, len);
}

// Awesome Oscillator = SMA(median,5) - SMA(median,34)
function ao(b: Bar[]): number[] {
  const med = b.map((x) => (x.h + x.l) / 2);
  const f = sma(med, 5);
  const s = sma(med, 34);
  return med.map((_, i) => f[i] - s[i]);
}

// Momentum(10) = close - close[10]
function momentum(src: number[], len = 10): number[] {
  return src.map((v, i) => (i >= len ? v - src[i - len] : NaN));
}

// MACD line + signal.
function macd(src: number[], fast = 12, slow = 26, sig = 9) {
  const ef = ema(src, fast);
  const es = ema(src, slow);
  const line = src.map((_, i) => ef[i] - es[i]);
  // The signal EMA begins only after `sig` real MACD observations exist. Replacing
  // the MACD warmup NaNs with zero would fabricate an early signal and early vote.
  const signal = ema(line, sig);
  return { line, signal };
}

// Stochastic RSI Fast: %K = smooth(stoch of RSI), %D = SMA(%K).
// %K and %D smoothing use smaN() (NaN-aware SMA) to avoid fake-zero warmup bias:
// only real rawK/k values enter the SMA window; NaN warmup slots are skipped.
function stochRsi(src: number[], rsiLen = 14, stochLen = 14, kSm = 3, dSm = 3) {
  const r = rsi(src, rsiLen);
  const rawK: number[] = new Array(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    // Need stochLen real RSI values ending at i; RSI has NaN prefix of length rsiLen.
    // First real rawK: when r[i-stochLen+1..i] are all non-NaN.
    let hh = -Infinity;
    let ll = Infinity;
    let realCount = 0;
    for (let j = i - stochLen + 1; j <= i; j++) {
      if (j < 0 || isNaN(r[j])) continue;
      if (r[j] > hh) hh = r[j];
      if (r[j] < ll) ll = r[j];
      realCount++;
    }
    if (realCount < stochLen) continue; // warmup: not enough real RSI values yet
    rawK[i] = hh === ll ? 50 : (100 * (r[i] - ll)) / (hh - ll);
  }
  const k = smaN(rawK, kSm);
  const d = smaN(k, dSm);
  return { k, d };
}

// Williams %R(14) = -100*(highestHigh-close)/(highestHigh-lowestLow)
function williamsR(b: Bar[], len = 14): number[] {
  const out: number[] = new Array(b.length).fill(NaN);
  for (let i = len - 1; i < b.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - len + 1; j <= i; j++) {
      if (b[j].h > hh) hh = b[j].h;
      if (b[j].l < ll) ll = b[j].l;
    }
    out[i] = hh === ll ? -50 : (-100 * (hh - b[i].c)) / (hh - ll);
  }
  return out;
}

// Bull Bear Power(13) = (high - EMA) + (low - EMA)
function bullBearPower(b: Bar[], len = 13): number[] {
  const e = ema(closes(b), len);
  return b.map((x, i) => (isNaN(e[i]) ? NaN : x.h - e[i] + (x.l - e[i])));
}

// Ultimate Oscillator (7,14,28).
function ultimate(b: Bar[], s1 = 7, s2 = 14, s3 = 28): number[] {
  const n = b.length;
  const bp: number[] = new Array(n).fill(NaN);
  const tr: number[] = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const trueLow = Math.min(b[i].l, b[i - 1].c);
    bp[i] = b[i].c - trueLow;
    tr[i] = Math.max(b[i].h, b[i - 1].c) - trueLow;
  }
  const sumWin = (arr: number[], i: number, w: number) => {
    if (i < w) return NaN;
    let s = 0;
    for (let j = i - w + 1; j <= i; j++) s += arr[j];
    return s;
  };
  const out: number[] = new Array(n).fill(NaN);
  for (let i = s3; i < n; i++) {
    const avg1 = sumWin(bp, i, s1) / sumWin(tr, i, s1);
    const avg2 = sumWin(bp, i, s2) / sumWin(tr, i, s2);
    const avg3 = sumWin(bp, i, s3) / sumWin(tr, i, s3);
    if ([avg1, avg2, avg3].some((x) => !isFinite(x))) continue;
    out[i] = (100 * (4 * avg1 + 2 * avg2 + avg3)) / 7;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Moving averages used by the MA group
// ─────────────────────────────────────────────────────────────────────────────

// Ichimoku Base line (Kijun-sen) = (highest(period) + lowest(period)) / 2 over `len`.
function ichimokuLine(b: Bar[], len: number): number[] {
  const out: number[] = new Array(b.length).fill(NaN);
  for (let i = len - 1; i < b.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - len + 1; j <= i; j++) {
      if (b[j].h > hh) hh = b[j].h;
      if (b[j].l < ll) ll = b[j].l;
    }
    out[i] = (hh + ll) / 2;
  }
  return out;
}

// Volume-weighted MA.
function vwma(b: Bar[], len = 20): number[] {
  const out: number[] = new Array(b.length).fill(NaN);
  for (let i = len - 1; i < b.length; i++) {
    let pv = 0;
    let vv = 0;
    for (let j = i - len + 1; j <= i; j++) {
      pv += b[j].c * b[j].v;
      vv += b[j].v;
    }
    out[i] = vv === 0 ? NaN : pv / vv;
  }
  return out;
}

// Hull MA(len) = WMA(2*WMA(len/2) - WMA(len), sqrt(len))
function hma(src: number[], len = 9): number[] {
  const half = wma(src, Math.floor(len / 2));
  const full = wma(src, len);
  const diff = src.map((_, i) => 2 * half[i] - full[i]);
  return wma(diff.map((x) => (isNaN(x) ? 0 : x)), Math.round(Math.sqrt(len))).map((v, i) =>
    isNaN(diff[i]) ? NaN : v
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vote rules (TradingView documented conditions)
// ─────────────────────────────────────────────────────────────────────────────

// MA vote: price > MA → Buy, price < MA → Sell, equal → Neutral. (TV MA rating rule.)
function maVote(price: number, ma: number): Vote {
  if (!isFinite(ma) || !isFinite(price)) return "Neutral";
  if (price > ma) return "Buy";
  if (price < ma) return "Sell";
  return "Neutral";
}

// ─────────────────────────────────────────────────────────────────────────────
// Group scoring — TV 5-zone thresholds
//   score = mean of member votes (Buy=+1, Sell=-1, Neutral=0).
//   Strong buy: score ≥ 0.5;  Buy: 0.1 ≤ score < 0.5;  Neutral: -0.1 < score < 0.1;
//   Sell: -0.5 < score ≤ -0.1;  Strong sell: score ≤ -0.5.
// ─────────────────────────────────────────────────────────────────────────────

function voteVal(v: Vote): number {
  return v === "Buy" ? 1 : v === "Sell" ? -1 : 0;
}

export function verdictFromScore(score: number): Verdict {
  if (score >= 0.5) return "Strong buy";
  if (score >= 0.1) return "Buy";
  if (score > -0.1) return "Neutral";
  if (score > -0.5) return "Sell";
  return "Strong sell";
}

function groupScore(rows: Row[]): GroupScore {
  let buy = 0;
  let sell = 0;
  let neutral = 0;
  for (const r of rows) {
    if (r.vote === "Buy") buy++;
    else if (r.vote === "Sell") sell++;
    else neutral++;
  }
  const total = rows.length || 1;
  const score = (buy - sell) / total;
  return { score, verdict: verdictFromScore(score), buy, sell, neutral };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pivots — from prior period HLC (+ prior open for Woodie).
// ─────────────────────────────────────────────────────────────────────────────

function classicPivots(h: number, l: number, c: number): PivotLevels {
  const p = (h + l + c) / 3;
  return {
    method: "Classic",
    p,
    r1: 2 * p - l,
    s1: 2 * p - h,
    r2: p + (h - l),
    s2: p - (h - l),
    r3: h + 2 * (p - l),
    s3: l - 2 * (h - p),
  };
}

function fibonacciPivots(h: number, l: number, c: number): PivotLevels {
  const p = (h + l + c) / 3;
  const range = h - l;
  return {
    method: "Fibonacci",
    p,
    r1: p + 0.382 * range,
    r2: p + 0.618 * range,
    r3: p + 1.0 * range,
    s1: p - 0.382 * range,
    s2: p - 0.618 * range,
    s3: p - 1.0 * range,
  };
}

function camarillaPivots(h: number, l: number, c: number): PivotLevels {
  const range = h - l;
  return {
    method: "Camarilla",
    p: (h + l + c) / 3,
    r1: c + (range * 1.1) / 12,
    r2: c + (range * 1.1) / 6,
    r3: c + (range * 1.1) / 4,
    s1: c - (range * 1.1) / 12,
    s2: c - (range * 1.1) / 6,
    s3: c - (range * 1.1) / 4,
  };
}

function woodiePivots(h: number, l: number, curOpen: number): PivotLevels {
  // Woodie uses the CURRENT period's open (weighted) — TV: P = (H + L + 2*Open)/4.
  const p = (h + l + 2 * curOpen) / 4;
  const range = h - l;
  return {
    method: "Woodie",
    p,
    r1: 2 * p - l,
    s1: 2 * p - h,
    r2: p + range,
    s2: p - range,
    r3: h + 2 * (p - l),
    s3: l - 2 * (h - p),
  };
}

function demarkPivots(h: number, l: number, c: number, o: number): PivotLevels {
  let x: number;
  if (c < o) x = h + 2 * l + c;
  else if (c > o) x = 2 * h + l + c;
  else x = h + l + 2 * c;
  const p = x / 4;
  return {
    method: "Demark",
    p,
    r1: x / 2 - l,
    s1: x / 2 - h,
    r2: null,
    r3: null,
    s2: null,
    s3: null,
  };
}

function computePivots(bars: Bar[]): PivotTable {
  // Prior period = the second-to-last completed bar's HLC; current open = last bar's open.
  const empty: PivotLevels = { method: "", p: null, r1: null, r2: null, r3: null, s1: null, s2: null, s3: null };
  if (bars.length < 2) {
    return {
      classic: { ...empty, method: "Classic" },
      fibonacci: { ...empty, method: "Fibonacci" },
      camarilla: { ...empty, method: "Camarilla" },
      woodie: { ...empty, method: "Woodie" },
      demark: { ...empty, method: "Demark" },
    };
  }
  const p = bars[bars.length - 2]; // prior completed period
  const cur = bars[bars.length - 1];
  return {
    classic: classicPivots(p.h, p.l, p.c),
    fibonacci: fibonacciPivots(p.h, p.l, p.c),
    camarilla: camarillaPivots(p.h, p.l, p.c),
    woodie: woodiePivots(p.h, p.l, cur.o),
    demark: demarkPivots(p.h, p.l, p.c, p.o),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeRatings — the frozen export. Produces oscillator rows, MA rows, pivots, and the
 * [Oscillators, Moving Averages, Summary] group tuple. `tf` is accepted for signature
 * compatibility (the math is bar-agnostic); it is not used to alter indicator lengths.
 */
export function computeRatings(bars: Bar[], _tf?: string): Ratings {
  const c = closes(bars);
  const price = last(c);

  // ── Oscillators ──
  const rsiS = rsi(c, 14);
  const st = stoch(bars, 14, 3, 3);
  const cciS = cci(bars, 20);
  const adxS = adx(bars, 14);
  const pDIs = plusMinusDI(bars, 14); // for ADX directional vote
  const aoS = ao(bars);
  const momS = momentum(c, 10);
  const macdS = macd(c, 12, 26, 9);
  const srsi = stochRsi(c, 14, 14, 3, 3);
  const wrS = williamsR(bars, 14);
  const bbpS = bullBearPower(bars, 13);
  const uoS = ultimate(bars, 7, 14, 28);

  const oscillators: Row[] = [
    { name: "RSI (14)", value: nz(last(rsiS)), vote: rsiVote(rsiS) },
    { name: "Stochastic %K (14, 3, 3)", value: nz(last(st.k)), vote: stochVote(st) },
    { name: "CCI (20)", value: nz(last(cciS)), vote: cciVote(cciS) },
    { name: "ADX (14)", value: nz(last(adxS)), vote: adxVote(adxS, pDIs.pDI, pDIs.mDI) },
    { name: "Awesome Oscillator", value: nz(last(aoS)), vote: aoVote(aoS) },
    { name: "Momentum (10)", value: nz(last(momS)), vote: momentumVote(momS) },
    { name: "MACD (12, 26, 9)", value: nz(last(macdS.line)), vote: macdVote(macdS) },
    { name: "Stochastic RSI Fast (3, 3, 14, 14)", value: nz(last(srsi.k)), vote: stochRsiVote(srsi) },
    { name: "Williams %R (14)", value: nz(last(wrS)), vote: williamsVote(wrS) },
    { name: "Bull Bear Power (13)", value: nz(last(bbpS)), vote: bbpVote(bbpS) },
    { name: "Ultimate Oscillator (7, 14, 28)", value: nz(last(uoS)), vote: ultimateVote(uoS) },
  ];

  // ── Moving averages ──
  const maLens = [10, 20, 30, 50, 100, 200];
  const mas: Row[] = [];
  for (const len of maLens) {
    const e = last(ema(c, len));
    mas.push({ name: `EMA (${len})`, value: nz(e), vote: maVote(price, e) });
  }
  for (const len of maLens) {
    const s = last(sma(c, len));
    mas.push({ name: `SMA (${len})`, value: nz(s), vote: maVote(price, s) });
  }
  const ichi = last(ichimokuLine(bars, 26));
  mas.push({ name: "Ichimoku Base Line (9, 26, 52, 26)", value: nz(ichi), vote: ichimokuVote(bars, price) });
  const vw = last(vwma(bars, 20));
  mas.push({ name: "VWMA (20)", value: nz(vw), vote: maVote(price, vw) });
  const hm = last(hma(c, 9));
  mas.push({ name: "Hull MA (9)", value: nz(hm), vote: maVote(price, hm) });

  const oscGroup = groupScore(oscillators);
  const maGroup = groupScore(mas);
  // Overall summary = mean of the two group scores (TV weights osc + MA equally).
  const overallScore = (oscGroup.score + maGroup.score) / 2;
  const overall: GroupScore = {
    score: overallScore,
    verdict: verdictFromScore(overallScore),
    buy: oscGroup.buy + maGroup.buy,
    sell: oscGroup.sell + maGroup.sell,
    neutral: oscGroup.neutral + maGroup.neutral,
  };

  return {
    oscillators,
    mas,
    pivots: computePivots(bars),
    summary: [oscGroup, maGroup, overall],
  };
}

function nz(v: number): number | null {
  return isFinite(v) ? v : null;
}

// +DI/-DI helper (ADX directional vote needs both DIs).
function plusMinusDI(b: Bar[], len = 14) {
  const n = b.length;
  const tr: number[] = new Array(n).fill(NaN);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = b[i].h - b[i - 1].h;
    const down = b[i - 1].l - b[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
  }
  const atr = rma(tr, len);
  const pDI = rma(plusDM, len).map((v, i) => (atr[i] ? (100 * v) / atr[i] : NaN));
  const mDI = rma(minusDM, len).map((v, i) => (atr[i] ? (100 * v) / atr[i] : NaN));
  return { pDI, mDI };
}

// ── Individual TV vote rules ──

// RSI: <30 & rising → Buy; >70 & falling → Sell; else Neutral.
function rsiVote(s: number[]): Vote {
  const v = last(s);
  if (!isFinite(v)) return "Neutral";
  if (v < 30 && rising(s)) return "Buy";
  if (v > 70 && falling(s)) return "Sell";
  return "Neutral";
}

// Stochastic: %K<20 & %K>%D & %K rising → Buy; %K>80 & %K<%D & %K falling → Sell.
function stochVote(st: { k: number[]; d: number[] }): Vote {
  const k = last(st.k);
  const d = last(st.d);
  if (!isFinite(k) || !isFinite(d)) return "Neutral";
  if (k < 20 && k > d && rising(st.k)) return "Buy";
  if (k > 80 && k < d && falling(st.k)) return "Sell";
  return "Neutral";
}

// CCI: <-100 & rising → Buy; >100 & falling → Sell.
function cciVote(s: number[]): Vote {
  const v = last(s);
  if (!isFinite(v)) return "Neutral";
  if (v < -100 && rising(s)) return "Buy";
  if (v > 100 && falling(s)) return "Sell";
  return "Neutral";
}

// ADX: trend strong (ADX>20) → direction from +DI vs -DI (and DI rising); else Neutral.
function adxVote(adxS: number[], pDI: number[], mDI: number[]): Vote {
  const a = last(adxS);
  const p = last(pDI);
  const m = last(mDI);
  if (!isFinite(a) || a <= 20 || !isFinite(p) || !isFinite(m)) return "Neutral";
  if (p > m && rising(pDI)) return "Buy";
  if (m > p && rising(mDI)) return "Sell";
  return "Neutral";
}

// Awesome Osc: crosses/saucer above zero → Buy; below zero → Sell (simplified TV zero + slope).
function aoVote(s: number[]): Vote {
  const cur = last(s);
  const pr = prev(s);
  if (!isFinite(cur) || !isFinite(pr)) return "Neutral";
  // Zero-line cross or saucer in the positive/negative regime.
  if ((pr < 0 && cur > 0) || (cur > 0 && cur > pr)) return "Buy";
  if ((pr > 0 && cur < 0) || (cur < 0 && cur < pr)) return "Sell";
  return "Neutral";
}

// Momentum: rising → Buy; falling → Sell.
function momentumVote(s: number[]): Vote {
  const cur = last(s);
  const pr = prev(s);
  if (!isFinite(cur) || !isFinite(pr)) return "Neutral";
  if (cur > pr) return "Buy";
  if (cur < pr) return "Sell";
  return "Neutral";
}

// MACD: macd line > signal → Buy; < signal → Sell.
function macdVote(m: { line: number[]; signal: number[] }): Vote {
  const l = last(m.line);
  const s = last(m.signal);
  if (!isFinite(l) || !isFinite(s)) return "Neutral";
  if (l > s) return "Buy";
  if (l < s) return "Sell";
  return "Neutral";
}

// Stoch RSI: K<20 & K>D → Buy; K>80 & K<D → Sell.
function stochRsiVote(sr: { k: number[]; d: number[] }): Vote {
  const k = last(sr.k);
  const d = last(sr.d);
  if (!isFinite(k) || !isFinite(d)) return "Neutral";
  if (k < 20 && k > d) return "Buy";
  if (k > 80 && k < d) return "Sell";
  return "Neutral";
}

// Williams %R: <-80 & rising → Buy; >-20 & falling → Sell.
function williamsVote(s: number[]): Vote {
  const v = last(s);
  if (!isFinite(v)) return "Neutral";
  if (v < -80 && rising(s)) return "Buy";
  if (v > -20 && falling(s)) return "Sell";
  return "Neutral";
}

// Bull Bear Power: >0 & rising → Buy; <0 & falling → Sell.
function bbpVote(s: number[]): Vote {
  const v = last(s);
  if (!isFinite(v)) return "Neutral";
  if (v > 0 && rising(s)) return "Buy";
  if (v < 0 && falling(s)) return "Sell";
  return "Neutral";
}

// Ultimate Osc: <30 → Buy; >70 → Sell (TV oversold/overbought bands).
function ultimateVote(s: number[]): Vote {
  const v = last(s);
  if (!isFinite(v)) return "Neutral";
  if (v < 30) return "Buy";
  if (v > 70) return "Sell";
  return "Neutral";
}

// Ichimoku cloud vote (TV-standard displaced cloud rule).
//
// TradingView compares price to the cloud UNDER THE CURRENT BAR — which is Senkou Span A/B
// displaced +26 bars forward.  At bar n, the visible cloud was computed from bar n-26:
//   spanA_displayed = (tenkan[n-26] + kijun[n-26]) / 2
//   spanB_displayed = ichimokuLine(52)[n-26]
//
// The original implementation used the undisplaced current values (what would be projected
// at n+26), giving the wrong cloud reference for the vote.
//
// Vote rules (TV cloud rule):
//   Buy  when base < conv AND price > cloudTop AND price > base
//   Sell when base > conv AND price < cloudBot AND price < base
//   else Neutral
function ichimokuVote(bars: Bar[], price: number): Vote {
  const disp = 26;
  const n = bars.length;
  // Current bar's conversion/base lines (for the base < conv cross test)
  const conv = last(ichimokuLine(bars, 9));  // Tenkan at current bar
  const base = last(ichimokuLine(bars, 26)); // Kijun at current bar
  // Cloud under today's price: computed from bar n-1-disp (the "displayed" cloud)
  const cloudBarIdx = n - 1 - disp;
  if (cloudBarIdx < 0) return "Neutral";
  const barsForCloud = bars.slice(0, cloudBarIdx + 1);
  const convCloud = last(ichimokuLine(barsForCloud, 9));
  const baseCloud = last(ichimokuLine(barsForCloud, 26));
  const spanA = (convCloud + baseCloud) / 2;
  const spanBLine = ichimokuLine(barsForCloud, 52);
  const spanB = last(spanBLine);
  if (![conv, base, spanA, spanB, price].every(isFinite)) return "Neutral";
  const cloudTop = Math.max(spanA, spanB);
  const cloudBot = Math.min(spanA, spanB);
  if (base < conv && price > cloudTop && price > base) return "Buy";
  if (base > conv && price < cloudBot && price < base) return "Sell";
  return "Neutral";
}

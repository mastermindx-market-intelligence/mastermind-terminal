// intradayMath.ts — intraday session math for the Day Trade Suite (display-tier descriptive).
// All functions are pure, stateless over Bar arrays (chronological oldest→newest).
// Bar.time is NUMERIC (display-epoch seconds): market-local wall-clock reinterpreted as UTC.
//   US → ET epoch, CN/HK → UTC+8 epoch, crypto → UTC epoch.
// Null-padding convention: warmup/missing positions emit null (never NaN) — matching indicatorMath.ts.
// No buy/sell signals, no composite scores.

// ─── Types ────────────────────────────────────────────────────────────────────

/** Intraday bar. time = display-epoch seconds (NUMERIC — do not mix with 'YYYY-MM-DD' strings). */
export type Bar = {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

/** A contiguous slice of bars belonging to one display-day. */
export type SessionSlice = { start: number; end: number; day: number };

/** Per-session opening range result. */
export type ORSession = {
  day: number;
  hi: number;
  lo: number;
  mid: number;
  startIdx: number;
  endIdx: number;        // last bar index still inside the range window
  sessionEndIdx: number; // last bar index of this session
  exts: { k: number; up: number; dn: number }[];
};

/** Daily OHLC bar (from external cache). time = 'YYYY-MM-DD' string. */
export type DailyBar = { time: string; h: number; l: number; c: number };

/** A named price level. */
export type PriceLevel = { key: string; label: string; value: number };

// ─── Basic session helpers ────────────────────────────────────────────────────

/**
 * Minutes-since-midnight within the display-epoch day (0–1439).
 * Display-epoch: market-local wall-clock mapped to UTC seconds.
 */
export const minOfDay = (t: number): number => Math.floor(t / 60) % 1440;

/**
 * Integer day key (floored UTC day number). Two bars share a day-key iff they
 * fall on the same display-epoch calendar date.
 */
export const dayKey = (t: number): number => Math.floor(t / 86400);

/**
 * Opening minute-of-day for the given market.
 * crypto uses UTC day boundary (0); all others open at 09:30 local (570 min).
 */
export function sessionOpenMin(market: "us" | "cn" | "hk" | "crypto" | "ca"): number {
  return market === "crypto" ? 0 : 570; // 09:30 local for us/cn/hk/ca
}

/**
 * Return contiguous index ranges per display-day: [{ start, end, day }].
 * Bars within the same dayKey are grouped; the result is sorted chronologically.
 */
export function sessionSlices(bars: Bar[]): SessionSlice[] {
  if (!bars.length) return [];
  const slices: SessionSlice[] = [];
  let start = 0;
  let curDay = dayKey(bars[0].time);
  for (let i = 1; i <= bars.length; i++) {
    const d = i < bars.length ? dayKey(bars[i].time) : -1;
    if (d !== curDay) {
      slices.push({ start, end: i - 1, day: curDay });
      start = i;
      curDay = d;
    }
  }
  return slices;
}

// ─── Shared internal helpers ──────────────────────────────────────────────────

/** Population standard deviation over an array (divides by N, matching ChartPanel inline stddev). */
function popStdev(vals: number[]): number {
  if (!vals.length) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length);
}

/** Wilder RMA (matching indicatorMath.ts rma — same Wilder smoothing). */
function rmaArr(src: (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = Array(src.length).fill(null);
  const a = 1 / len;
  let prev: number | null = null;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null || !isFinite(v)) { out[i] = prev; continue; }
    if (prev == null) {
      if (i >= len - 1) {
        let s = 0, cnt = 0;
        for (let j = i - len + 1; j <= i; j++) {
          const x = src[j];
          if (x != null && isFinite(x)) { s += x; cnt++; }
        }
        prev = cnt ? s / cnt : null;
        out[i] = prev;
      }
    } else {
      prev = a * v + (1 - a) * prev;
      out[i] = prev;
    }
  }
  return out;
}

/** Simple moving average. */
function smaArr(src: (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = Array(src.length).fill(null);
  const q: number[] = []; let s = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null || !isFinite(v)) {
      q.push(0);
      if (q.length > len) s -= q.shift()!;
      continue;
    }
    q.push(v); s += v;
    if (q.length > len) s -= q.shift()!;
    if (q.length === len) out[i] = s / len;
  }
  return out;
}

/** Rolling highest high over `len` bars. */
function rollMax(bars: Bar[], len: number): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  for (let i = len - 1; i < bars.length; i++) {
    let mx = -Infinity;
    for (let j = i - len + 1; j <= i; j++) mx = Math.max(mx, bars[j].h);
    out[i] = mx;
  }
  return out;
}

/** Rolling lowest low over `len` bars. */
function rollMin(bars: Bar[], len: number): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  for (let i = len - 1; i < bars.length; i++) {
    let mn = Infinity;
    for (let j = i - len + 1; j <= i; j++) mn = Math.min(mn, bars[j].l);
    out[i] = mn;
  }
  return out;
}

/** ISO week number (ISO 8601: week 1 = week containing first Thursday). */
function isoWeek(t: number): { year: number; week: number } {
  // t is display-epoch seconds; treat as UTC date
  const ms = t * 1000;
  const d = new Date(ms);
  // Thursday in current week: shift to Thursday (day 4)
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((thursday.getTime() - jan1.getTime()) / 86400000) + 1) / 7);
  return { year, week };
}

// ─── sessionVwap ─────────────────────────────────────────────────────────────

export interface SessionVwapResult {
  vwap: (number | null)[];
  /** bands[k] corresponds to mults[k], e.g. bands[0] = ±1σ */
  bands: { up: (number | null)[]; dn: (number | null)[] }[];
}

/**
 * Session-reset VWAP with volume-weighted variance bands.
 *
 * Resets at each new dayKey. When !includePm, bars with minOfDay < openMin emit null.
 * tp = (h+l+c)/3. σ² = Σ(v·tp²)/Σv − vwap²; clamped ≥0 to avoid floating-point negatives.
 * v≤0 bars contribute 0 to accumulation (avoided, not skipped: σ still accumulates cleanly).
 *
 * @param mults  Sigma multipliers for band pairs (default [1,2,3]).
 */
export function sessionVwap(
  bars: Bar[],
  market: "us" | "cn" | "hk" | "crypto" | "ca",
  includePm = false,
  mults: number[] = [1, 2, 3],
): SessionVwapResult {
  const n = bars.length;
  const vwap: (number | null)[] = Array(n).fill(null);
  const bands: { up: (number | null)[]; dn: (number | null)[] }[] = mults.map(() => ({
    up: Array(n).fill(null),
    dn: Array(n).fill(null),
  }));

  const openMin = sessionOpenMin(market);
  let cumTV = 0, cumV = 0, cumTV2 = 0;
  let curDay = -1;

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const day = dayKey(bar.time);
    const mod = minOfDay(bar.time);

    // Session reset
    if (day !== curDay) {
      cumTV = 0; cumV = 0; cumTV2 = 0;
      curDay = day;
    }

    // Skip premarket bars when !includePm (for non-crypto markets with an open minute)
    if (!includePm && market !== "crypto" && mod < openMin) {
      // emit null for this bar
      continue;
    }

    const tp = (bar.h + bar.l + bar.c) / 3;
    const vol = bar.v > 0 ? bar.v : 0;

    cumTV += tp * vol;
    cumV += vol;
    cumTV2 += tp * tp * vol;

    if (cumV > 0) {
      const v0 = cumTV / cumV;
      vwap[i] = v0;
      // σ² = E[tp²] − E[tp]² ; clamp ≥0
      const variance = Math.max(0, cumTV2 / cumV - v0 * v0);
      const sigma = Math.sqrt(variance);
      for (let k = 0; k < mults.length; k++) {
        const offset = mults[k] * sigma;
        bands[k].up[i] = v0 + offset;
        bands[k].dn[i] = v0 - offset;
      }
    }
  }

  return { vwap, bands };
}

// ─── openingRange ─────────────────────────────────────────────────────────────

/**
 * Per-session opening range (ORB).
 *
 * Window = bars with minOfDay ∈ [openMin, openMin+rangeMin). Premarket bars are ALWAYS
 * ignored — the range only begins at session open. The window is "locked" after the
 * first bar past openMin+rangeMin: subsequent bars cannot change hi/lo.
 *
 * Extensions are computed as multiples of the range height above ORH and below ORL.
 */
export function openingRange(
  bars: Bar[],
  market: "us" | "cn" | "hk" | "crypto" | "ca",
  rangeMin = 15,
  exts: number[] = [1, 2],
): ORSession[] {
  const openMin = sessionOpenMin(market);
  const closeMin = openMin + rangeMin;

  const slices = sessionSlices(bars);
  const result: ORSession[] = [];

  for (const slice of slices) {
    let hi = -Infinity, lo = Infinity;
    let startIdx = -1, endIdx = -1;

    // Gather window bars
    for (let i = slice.start; i <= slice.end; i++) {
      const mod = minOfDay(bars[i].time);
      if (mod < openMin) continue; // skip premarket
      if (mod >= closeMin) break;  // window is over
      if (startIdx === -1) startIdx = i;
      endIdx = i;
      hi = Math.max(hi, bars[i].h);
      lo = Math.min(lo, bars[i].l);
    }

    // Skip sessions with no window bars
    if (startIdx === -1) continue;

    const mid = (hi + lo) / 2;
    const height = hi - lo;

    const extArr = exts.map((k) => ({
      k,
      up: hi + k * height,
      dn: lo - k * height,
    }));

    result.push({
      day: slice.day,
      hi,
      lo,
      mid,
      startIdx,
      endIdx,
      sessionEndIdx: slice.end,
      exts: extArr,
    });
  }

  return result;
}

// ─── rvolSeries ───────────────────────────────────────────────────────────────

export interface RvolResult {
  cum: (number | null)[];   // cumulative RVOL vs baseline cumulative vol at same slot
  slot: (number | null)[];  // bar-level slot RVOL (this bar's vol / baseline bar-vol at same slot)
  sessionsUsed: number;     // number of prior complete sessions in the baseline
}

/**
 * Relative volume series (time-of-day normalized).
 *
 * Slot key = minOfDay. Baseline = mean(cum-vol at same slot) over prior sessions /
 * mean(bar-vol at same slot) over prior sessions (exclude current session).
 *
 * If sessionsUsed < 3: all null (caller must show honest "insufficient history" note).
 * Current session: RVOL computed from today's running totals vs the baseline.
 * Prior sessions: those sessions have their slot values averaged from available samples.
 */
export function rvolSeries(
  bars: Bar[],
  market: "us" | "cn" | "hk" | "crypto" | "ca",
  baselineSessions = 10,
): RvolResult {
  const n = bars.length;
  const cum: (number | null)[] = Array(n).fill(null);
  const slot: (number | null)[] = Array(n).fill(null);

  const openMin = sessionOpenMin(market);
  const slices = sessionSlices(bars);

  // Count sessions that precede the current (last) session as baseline
  // Baseline = up to `baselineSessions` prior complete sessions
  const currentSlice = slices[slices.length - 1];
  const priorSlices = slices.slice(0, slices.length - 1);
  const baselineSlices = priorSlices.slice(-baselineSessions);
  const sessionsUsed = baselineSlices.length;

  if (sessionsUsed < 3) {
    return { cum, slot, sessionsUsed };
  }

  // Build baseline: for each minOfDay slot, collect bar-vols and cumulative vols
  // across baseline sessions (RTH only — skip premarket for non-crypto)
  const slotBarVols: Map<number, number[]> = new Map();
  const slotCumVols: Map<number, number[]> = new Map();

  for (const s of baselineSlices) {
    let runCum = 0;
    for (let i = s.start; i <= s.end; i++) {
      const bar = bars[i];
      const mod = minOfDay(bar.time);
      if (market !== "crypto" && mod < openMin) continue;
      runCum += Math.max(0, bar.v);
      if (!slotBarVols.has(mod)) { slotBarVols.set(mod, []); slotCumVols.set(mod, []); }
      slotBarVols.get(mod)!.push(Math.max(0, bar.v));
      slotCumVols.get(mod)!.push(runCum);
    }
  }

  // Average baseline values per slot
  const baseBarVol: Map<number, number> = new Map();
  const baseCumVol: Map<number, number> = new Map();
  for (const [mod, vals] of slotBarVols) {
    baseBarVol.set(mod, vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  for (const [mod, vals] of slotCumVols) {
    baseCumVol.set(mod, vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  // Compute RVOL for all sessions that have baseline coverage
  for (const s of slices) {
    let runCum = 0;
    for (let i = s.start; i <= s.end; i++) {
      const bar = bars[i];
      const mod = minOfDay(bar.time);
      if (market !== "crypto" && mod < openMin) continue;
      runCum += Math.max(0, bar.v);

      const baseBar = baseBarVol.get(mod);
      const baseCum = baseCumVol.get(mod);

      if (baseBar != null && baseBar > 0) {
        slot[i] = Math.max(0, bar.v) / baseBar;
      }
      if (baseCum != null && baseCum > 0) {
        cum[i] = runCum / baseCum;
      }
    }
  }

  return { cum, slot, sessionsUsed };
}

// ─── ttmSqueeze ───────────────────────────────────────────────────────────────

export interface TtmSqueezeResult {
  mom: (number | null)[];
  squeeze: (0 | 1 | 2 | 3 | null)[];
}

/**
 * TTM Squeeze — momentum oscillator + squeeze tier detection.
 *
 * BB standard deviation: POPULATION (÷N) — the house convention for every charted band,
 * because the product publishes `ta.stdev` as the BB definition (IND_DEFS.bb.source) and
 * Pine's ta.stdev is population. indicatorMath.bollingerBands() now defaults to the same
 * population σ and is the single owner of the chart's band math, so this squeeze detector
 * and the chart's own BB overlay agree by construction rather than by comment.
 * (The sample/ddof=1 bands still exist behind `bollingerBands(..., 1)` for the Macro Python
 *  engine contract only — see bollingerRenderParity.test.ts and indicatorParity.test.ts.)
 *
 * KC = SMA ± mult·RMA(TR, len). Squeeze tier reports the TIGHTEST KC that still contains the BB
 * (kcMults ascending): 3 = inside 1.0×KC (tightest), 2 = 1.5×KC, 1 = 2.0×KC, 0 = no squeeze.
 *
 * Momentum = linear regression of val[] over `momLen` bars, value at last bar:
 *   val[i] = close[i] − ((hh(len)[i] + ll(len)[i]) / 2 + sma(close,len)[i]) / 2
 *   linreg: fit y = a + b·x over x=0..momLen-1, return a + b·(momLen-1).
 */
export function ttmSqueeze(
  bars: Bar[],
  len = 20,
  bbMult = 2,
  kcMults: number[] = [1, 1.5, 2],
  momLen = 20,
): TtmSqueezeResult {
  const n = bars.length;
  const mom: (number | null)[] = Array(n).fill(null);
  const squeeze: (0 | 1 | 2 | 3 | null)[] = Array(n).fill(null);

  if (n < len) return { mom, squeeze };

  const closes = bars.map((b) => b.c);

  // SMA of close
  const smaCl = smaArr(closes.map((v) => v), len);

  // Rolling highest high and lowest low over `len`
  const hhArr = rollMax(bars, len);
  const llArr = rollMin(bars, len);

  // True Range for KC
  const tr: (number | null)[] = bars.map((b, i) => {
    if (i === 0) return b.h - b.l;
    const pc = bars[i - 1].c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
  const atrArr = rmaArr(tr, len);

  for (let i = len - 1; i < n; i++) {
    const sma = smaCl[i];
    const hh = hhArr[i];
    const ll = llArr[i];
    const atr = atrArr[i];
    if (sma == null || hh == null || ll == null || atr == null) continue;

    // BB: population std dev (÷N) matching ChartPanel inline convention
    const window = closes.slice(i - len + 1, i + 1);
    const mean = window.reduce((a, v) => a + v, 0) / len;
    const popSd = popStdev(window); // ÷N
    const bbWidth = 2 * bbMult * popSd;

    // Squeeze tier — kcMults sorted ascending (tightest channel first). The tier reports the
    // TIGHTEST channel that still contains the BB: squeezed inside kcMults[0] (1.0×KC) → tier 3
    // (extreme compression), kcMults[1] (1.5×) → tier 2, kcMults[2] (2.0×) → tier 1, none → 0.
    let tier: 0 | 1 | 2 | 3 = 0;
    for (let k = 0; k < kcMults.length; k++) {
      const kcWidth = 2 * kcMults[k] * atr;
      if (bbWidth < kcWidth) {
        tier = (kcMults.length - k) as 0 | 1 | 2 | 3;
        break;
      }
    }
    squeeze[i] = tier;

    // Momentum oscillator value: close − ((hh+ll)/2 + sma)/2
    const val = closes[i] - ((hh + ll) / 2 + mean) / 2;

    // Linear regression of val series over momLen bars, evaluated at last point
    if (i >= momLen - 1 + (len - 1)) {
      // We need momLen bars of `val` ending at i; but val depends on hh/ll/sma (need len warmup)
      // So start collecting val from index (len-1) onward; for linreg at i we need i >= len-1+momLen-1
      // Build the val window ending at i
      const vals: number[] = [];
      let valid = true;
      for (let j = i - momLen + 1; j <= i; j++) {
        const s2 = smaCl[j];
        const h2 = hhArr[j];
        const l2 = llArr[j];
        if (s2 == null || h2 == null || l2 == null) { valid = false; break; }
        const m2 = closes.slice(j - len + 1, j + 1).reduce((a, v) => a + v, 0) / len;
        vals.push(closes[j] - ((h2 + l2) / 2 + m2) / 2);
      }
      if (valid && vals.length === momLen) {
        // Linreg: y = a + b·x, x = 0..momLen-1; evaluate at x = momLen-1
        const N = momLen;
        let sx = 0, sy = 0, sxy = 0, sx2 = 0;
        for (let x = 0; x < N; x++) {
          sx += x; sy += vals[x]; sxy += x * vals[x]; sx2 += x * x;
        }
        const denom = N * sx2 - sx * sx;
        if (denom !== 0) {
          const b = (N * sxy - sx * sy) / denom;
          const a = (sy - b * sx) / N;
          mom[i] = a + b * (N - 1);
        } else {
          mom[i] = vals[N - 1]; // degenerate: constant x, just use last val
        }
      }
    }
  }

  return { mom, squeeze };
}

// ─── adx ──────────────────────────────────────────────────────────────────────

export interface AdxResult {
  adx: (number | null)[];
  diPlus: (number | null)[];
  diMinus: (number | null)[];
}

/**
 * Wilder DMI + ADX.
 * Uses the same RMA style as indicatorMath.ts (Wilder smoothing, α=1/len).
 * ADX is always in [0,100] (bounded by construction).
 */
export function adx(bars: Bar[], len = 10): AdxResult {
  const n = bars.length;
  const adxArr: (number | null)[] = Array(n).fill(null);
  const diPlusArr: (number | null)[] = Array(n).fill(null);
  const diMinusArr: (number | null)[] = Array(n).fill(null);

  if (n < 2) return { adx: adxArr, diPlus: diPlusArr, diMinus: diMinusArr };

  // Compute raw DM and TR
  const dmPlus: (number | null)[] = Array(n).fill(null);
  const dmMinus: (number | null)[] = Array(n).fill(null);
  const trArr: (number | null)[] = Array(n).fill(null);

  for (let i = 1; i < n; i++) {
    const cur = bars[i], prev = bars[i - 1];
    const upMove = cur.h - prev.h;
    const downMove = prev.l - cur.l;
    dmPlus[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    dmMinus[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    trArr[i] = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
  }
  trArr[0] = bars[0].h - bars[0].l;

  // Smooth via Wilder RMA
  const smoothTR = rmaArr(trArr, len);
  const smoothDMP = rmaArr(dmPlus, len);
  const smoothDMM = rmaArr(dmMinus, len);

  // DI+ = 100 × smoothDMP / smoothTR; DI- = 100 × smoothDMM / smoothTR
  const diPlusRaw: (number | null)[] = smoothTR.map((tr, i) => {
    if (tr == null || tr === 0 || smoothDMP[i] == null) return null;
    return 100 * smoothDMP[i]! / tr;
  });
  const diMinusRaw: (number | null)[] = smoothTR.map((tr, i) => {
    if (tr == null || tr === 0 || smoothDMM[i] == null) return null;
    return 100 * smoothDMM[i]! / tr;
  });

  // DX = 100 × |DI+ − DI−| / (DI+ + DI−)
  const dx: (number | null)[] = diPlusRaw.map((dp, i) => {
    const dm = diMinusRaw[i];
    if (dp == null || dm == null) return null;
    const sum = dp + dm;
    if (sum === 0) return 0;
    return 100 * Math.abs(dp - dm) / sum;
  });

  // ADX = RMA(DX, len)
  const adxSmoothed = rmaArr(dx, len);

  for (let i = 0; i < n; i++) {
    adxArr[i] = adxSmoothed[i];
    diPlusArr[i] = diPlusRaw[i];
    diMinusArr[i] = diMinusRaw[i];
  }

  return { adx: adxArr, diPlus: diPlusArr, diMinus: diMinusArr };
}

// ─── cvdApprox ────────────────────────────────────────────────────────────────

/**
 * Session-reset cumulative volume delta (approximation from OHLCV).
 *
 * Per bar: delta = v × ((c−l) − (h−c)) / (h−l)
 * When h===l (doji/zero-range bar): use sign(c − prevClose)·v
 *   (prevClose is the close of the previous bar, regardless of session; 0 for first bar overall).
 * Resets to 0 at the start of each new session (new dayKey).
 * Returns cumulative sum of bar deltas within each session.
 */
export function cvdApprox(bars: Bar[]): (number | null)[] {
  const n = bars.length;
  const out: (number | null)[] = Array(n).fill(null);
  let cumDelta = 0;
  let curDay = -1;
  let prevClose: number | null = null;

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const day = dayKey(bar.time);

    if (day !== curDay) {
      cumDelta = 0;
      curDay = day;
    }

    let delta: number;
    const range = bar.h - bar.l;
    if (range === 0) {
      // h===l: use sign(c − prevClose)·v; 0 for first bar
      const prev = prevClose ?? bar.c;
      const diff = bar.c - prev;
      delta = (diff > 0 ? 1 : diff < 0 ? -1 : 0) * Math.max(0, bar.v);
    } else {
      delta = Math.max(0, bar.v) * ((bar.c - bar.l) - (bar.h - bar.c)) / range;
    }

    prevClose = bar.c;
    cumDelta += delta;
    out[i] = cumDelta;
  }

  return out;
}

// ─── pivotLevels ──────────────────────────────────────────────────────────────

/**
 * Classic / Camarilla / Fibonacci pivot levels from prior-day OHLC.
 *
 * Classic: PP=(H+L+C)/3, R1=2PP−L, S1=2PP−H, R2=PP+(H−L), S2=PP−(H−L), R3=R1+(H−L), S3=S1−(H−L)
 * Camarilla: R1=C+(H−L)×1.1/12, R2=C+(H−L)×1.1/6, R3=C+(H−L)×1.1/4, R4=C+(H−L)×1.1/2
 *            S1=C−(H−L)×1.1/12, S2=C−(H−L)×1.1/6, S3=C−(H−L)×1.1/4, S4=C−(H−L)×1.1/2
 * Fib: PP=(H+L+C)/3, R1=PP+0.382×(H−L), R2=PP+0.618×(H−L), R3=PP+1.0×(H−L)
 *                    S1=PP−0.382×(H−L), S2=PP−0.618×(H−L), S3=PP−1.0×(H−L)
 */
export function pivotLevels(
  pd: { h: number; l: number; c: number },
  mode: "classic" | "camarilla" | "fib",
): PriceLevel[] {
  const { h, l, c } = pd;
  const hl = h - l;

  if (mode === "classic") {
    const pp = (h + l + c) / 3;
    return [
      { key: "PP", label: "PP", value: pp },
      { key: "R1", label: "R1", value: 2 * pp - l },
      { key: "R2", label: "R2", value: pp + hl },
      { key: "R3", label: "R3", value: 2 * pp - l + hl }, // R1 + (H−L)
      { key: "S1", label: "S1", value: 2 * pp - h },
      { key: "S2", label: "S2", value: pp - hl },
      { key: "S3", label: "S3", value: 2 * pp - h - hl }, // S1 − (H−L)
    ];
  }

  if (mode === "camarilla") {
    const f = hl * 1.1;
    return [
      { key: "R4", label: "R4", value: c + f / 2 },
      { key: "R3", label: "R3", value: c + f / 4 },
      { key: "R2", label: "R2", value: c + f / 6 },
      { key: "R1", label: "R1", value: c + f / 12 },
      { key: "S1", label: "S1", value: c - f / 12 },
      { key: "S2", label: "S2", value: c - f / 6 },
      { key: "S3", label: "S3", value: c - f / 4 },
      { key: "S4", label: "S4", value: c - f / 2 },
    ];
  }

  // fib
  const pp = (h + l + c) / 3;
  return [
    { key: "PP", label: "PP", value: pp },
    { key: "R1", label: "R1", value: pp + 0.382 * hl },
    { key: "R2", label: "R2", value: pp + 0.618 * hl },
    { key: "R3", label: "R3", value: pp + 1.0 * hl },
    { key: "S1", label: "S1", value: pp - 0.382 * hl },
    { key: "S2", label: "S2", value: pp - 0.618 * hl },
    { key: "S3", label: "S3", value: pp - 1.0 * hl },
  ];
}

// ─── sessionLevels ────────────────────────────────────────────────────────────

/**
 * Named session levels derived from historical daily bars and current intraday bars.
 *
 * PDH/PDL/PDC: from the last COMPLETED daily bar strictly before the current session's
 *   calendar date (derived from the last intraday bar's dayKey).
 * PWH/PWL: prior ISO week's daily bars (week < current bar's ISO week).
 * Open: first intraday bar with minOfDay >= openMin today.
 * PMH/PML: today's premarket bars (minOfDay < openMin); US-only; omit when none.
 *
 * daily[] bars are 'YYYY-MM-DD' string-keyed. Current session date is inferred from
 * the last bar in `bars`.
 */
export function sessionLevels(
  bars: Bar[],
  market: "us" | "cn" | "hk" | "crypto" | "ca",
  daily: DailyBar[],
): PriceLevel[] {
  const levels: PriceLevel[] = [];
  if (!bars.length || !daily.length) return levels;

  const openMin = sessionOpenMin(market);

  // Current session date: derive from the last intraday bar's display-epoch
  // dayKey → calendar date string (treat display-epoch as UTC)
  const lastBar = bars[bars.length - 1];
  const currentDayMs = dayKey(lastBar.time) * 86400 * 1000;
  const currentDateStr = new Date(currentDayMs).toISOString().slice(0, 10);

  // Prior daily bars (strictly before currentDateStr)
  const priorDaily = daily.filter((d) => d.time < currentDateStr);
  if (!priorDaily.length) return levels;

  // PDH/PDL/PDC — last completed daily bar
  const pd = priorDaily[priorDaily.length - 1];
  levels.push({ key: "PDH", label: "PDH", value: pd.h });
  levels.push({ key: "PDL", label: "PDL", value: pd.l });
  levels.push({ key: "PDC", label: "PDC", value: pd.c });

  // ISO week of current session
  const { year: curYear, week: curWeek } = isoWeek(lastBar.time);

  // PWH/PWL — prior ISO week
  const priorWeekBars = priorDaily.filter((d) => {
    // Convert YYYY-MM-DD to an epoch for isoWeek computation
    const ms = new Date(d.time + "T00:00:00Z").getTime() / 1000;
    const { year, week } = isoWeek(ms);
    // Prior week = week before current; handle year boundaries
    if (year < curYear) return true;
    if (year === curYear && week < curWeek) return true;
    return false;
  });
  // Find the most recent prior week
  if (priorWeekBars.length) {
    const lastPriorWeekMs = new Date(priorWeekBars[priorWeekBars.length - 1].time + "T00:00:00Z").getTime() / 1000;
    const { year: pwYear, week: pwWeek } = isoWeek(lastPriorWeekMs);
    const pwBars = priorWeekBars.filter((d) => {
      const ms = new Date(d.time + "T00:00:00Z").getTime() / 1000;
      const { year, week } = isoWeek(ms);
      return year === pwYear && week === pwWeek;
    });
    if (pwBars.length) {
      const pwh = Math.max(...pwBars.map((d) => d.h));
      const pwl = Math.min(...pwBars.map((d) => d.l));
      levels.push({ key: "PWH", label: "PWH", value: pwh });
      levels.push({ key: "PWL", label: "PWL", value: pwl });
    }
  }

  // Today's intraday bars
  const currentDayKey = dayKey(lastBar.time);
  const todayBars = bars.filter((b) => dayKey(b.time) === currentDayKey);

  // Open: first bar with minOfDay >= openMin today
  const openBar = todayBars.find((b) => minOfDay(b.time) >= openMin);
  if (openBar) {
    levels.push({ key: "Open", label: "Open", value: openBar.o });
  }

  // PMH/PML: premarket bars (minOfDay < openMin) — US-only; omit if none
  if (market === "us") {
    const pmBars = todayBars.filter((b) => minOfDay(b.time) < openMin);
    if (pmBars.length) {
      const pmh = Math.max(...pmBars.map((b) => b.h));
      const pml = Math.min(...pmBars.map((b) => b.l));
      levels.push({ key: "PMH", label: "PMH", value: pmh });
      levels.push({ key: "PML", label: "PML", value: pml });
    }
  }

  return levels;
}

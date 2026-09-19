// indicatorMath.ts — pure math for the DT technicals suite (display-tier descriptive).
// All functions are stateless over Bar arrays (chronological oldest→newest).
// No buy/sell signals, no composite scores.

export type Bar = { time: string; o: number; h: number; l: number; c: number; v: number };

// ─── Basic helpers ─────────────────────────────────────────────────────────────

/** Wilder RMA (standard Wilder smoothing — SMA seed over first `len` finite values,
 *  then recursive α=1/len smoothing).  Matches techRating.ts and standard TV/Pine behaviour.
 *  Null/non-finite inputs carry the last value forward (no output produced until seeded). */
export function rma(src: (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = Array(src.length).fill(null);
  const a = 1 / len;
  let prev: number | null = null;
  // Collect indices of finite values for seed window tracking.
  let finiteCount = 0;
  let seedSum = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null || !isFinite(v)) {
      // carry forward without advancing the seed count
      out[i] = prev;
      continue;
    }
    if (prev == null) {
      // accumulate seed window
      seedSum += v;
      finiteCount++;
      if (finiteCount === len) {
        // Standard Wilder: seed = SMA of first `len` finite values
        prev = seedSum / len;
        out[i] = prev;
      }
      // Before seed is complete, output stays null
    } else {
      prev = a * v + (1 - a) * prev;
      out[i] = prev;
    }
  }
  return out;
}

export function ema(src: (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = Array(src.length).fill(null);
  const k = 2 / (len + 1);
  let prev: number | null = null, s = 0, c = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null || !isFinite(v)) { out[i] = prev; continue; }
    if (prev == null) {
      s += v; c++;
      if (c === len) { prev = s / len; out[i] = prev; }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function sma(src: (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = Array(src.length).fill(null);
  const q: number[] = []; let s = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null || !isFinite(v)) { q.push(0); if (q.length > len) { s -= q.shift()!; } continue; }
    q.push(v); s += v;
    if (q.length > len) s -= q.shift()!;
    if (q.length === len) out[i] = s / len;
  }
  return out;
}

/** ATR via Wilder RMA. */
export function atr(bars: Bar[], len: number): (number | null)[] {
  const tr: (number | null)[] = bars.map((r, i) => {
    if (i === 0) return r.h - r.l;
    const pc = bars[i - 1].c;
    return Math.max(r.h - r.l, Math.abs(r.h - pc), Math.abs(r.l - pc));
  });
  return rma(tr, len);
}

/** Rolling percentile rank of value in a complete finite window (0–100).
 *  A partial window created by upstream warmup/nulls stays null instead of silently
 *  shrinking the requested lookback. */
export function rollingPercentile(src: (number | null)[], win: number): (number | null)[] {
  const out: (number | null)[] = Array(src.length).fill(null);
  for (let i = win - 1; i < src.length; i++) {
    const v = src[i];
    if (v == null) continue;
    let below = 0, total = 0;
    for (let j = i - win + 1; j <= i; j++) {
      const x = src[j];
      if (x == null || !isFinite(x)) continue;
      total++;
      if (x <= v) below++;
    }
    if (total === win) out[i] = (below / win) * 100;
  }
  return out;
}

// ─── Ichimoku ──────────────────────────────────────────────────────────────────

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

export interface IchimokuResult {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  /** Span A displaced +displacement bars forward (indices 0..N-1+displacement). */
  spanA: (number | null)[];
  /** Span B displaced +displacement bars forward. */
  spanB: (number | null)[];
  /** Times for the spanA/spanB arrays (length N + displacement). Future entries match the
   *  type of the input bar times — business-day 'YYYY-MM-DD' strings on daily bars, epoch-second
   *  numbers advanced by the median bar interval on intraday bars — because lightweight-charts
   *  picks one time converter per setData array and throws on mixed time types. */
  futureTimes: (string | number)[];
}

/** Compute Ichimoku components. Returns arrays aligned to `bars` for tenkan/kijun,
 *  and extended arrays of length bars.length+displacement for span A/B. */
export function ichimoku(bars: Bar[], tenkan = 9, kijun = 26, senkouB = 52, displacement = 26): IchimokuResult {
  const n = bars.length;
  const tenkanArr: (number | null)[] = Array(n).fill(null);
  const kijunArr: (number | null)[] = Array(n).fill(null);
  const spanAArr: (number | null)[] = Array(n + displacement).fill(null);
  const spanBArr: (number | null)[] = Array(n + displacement).fill(null);

  const hiT = rollMax(bars, tenkan), loT = rollMin(bars, tenkan);
  const hiK = rollMax(bars, kijun), loK = rollMin(bars, kijun);
  const hiB = rollMax(bars, senkouB), loB = rollMin(bars, senkouB);

  for (let i = 0; i < n; i++) {
    if (hiT[i] != null && loT[i] != null) tenkanArr[i] = (hiT[i]! + loT[i]!) / 2;
    if (hiK[i] != null && loK[i] != null) kijunArr[i] = (hiK[i]! + loK[i]!) / 2;
    // span A/B are displaced forward by `displacement` bars
    const sa = (tenkanArr[i] != null && kijunArr[i] != null) ? (tenkanArr[i]! + kijunArr[i]!) / 2 : null;
    const sb = (hiB[i] != null && loB[i] != null) ? (hiB[i]! + loB[i]!) / 2 : null;
    spanAArr[i + displacement] = sa;
    spanBArr[i + displacement] = sb;
  }

  // Extend the time axis `displacement` slots past the last bar so the displaced cloud can render.
  // bar.time is a 'YYYY-MM-DD' string on daily bars and a numeric epoch-second on intraday bars.
  // Future entries MUST keep the same time type as the historical bars: lightweight-charts picks
  // one time converter for the whole setData array from its first element and throws on a mix.
  const futureTimes: (string | number)[] = [...bars.map((b) => b.time as string | number)];
  const lastT = bars.length ? (bars[bars.length - 1].time as string | number) : null;
  const isEpoch = typeof lastT === "number" || (typeof lastT === "string" && /^\d{6,}$/.test(lastT));
  if (lastT != null && isEpoch) {
    // Intraday: advance by the median recent bar interval, emitting the same type as the input.
    const toNum = (t: string | number) => (typeof t === "number" ? t : Number(t));
    const deltas: number[] = [];
    for (let i = Math.max(1, n - 20); i < n; i++) deltas.push(toNum(bars[i].time as any) - toNum(bars[i - 1].time as any));
    deltas.sort((a, b) => a - b);
    const step = (deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0) || 60;
    let t = toNum(lastT);
    for (let k = 0; k < displacement; k++) { t += step; futureTimes.push(typeof lastT === "number" ? t : String(t)); }
  } else {
    // Daily: approx business days — skip Sat/Sun.
    let lastDate = lastT == null ? new Date() : new Date((lastT as string) + "T00:00:00Z");
    for (let k = 0; k < displacement; k++) {
      lastDate = new Date(lastDate.getTime() + 86400_000);
      while (lastDate.getUTCDay() === 0 || lastDate.getUTCDay() === 6) lastDate = new Date(lastDate.getTime() + 86400_000);
      futureTimes.push(lastDate.toISOString().slice(0, 10));
    }
  }

  return { tenkan: tenkanArr, kijun: kijunArr, spanA: spanAArr, spanB: spanBArr, futureTimes };
}

// ─── SuperTrend ────────────────────────────────────────────────────────────────

export interface SupertrendResult {
  /** up-rail (green, below price when bullish). null at flip bars. */
  up: (number | null)[];
  /** down-rail (red, above price when bearish). null at flip bars. */
  down: (number | null)[];
  /** true = trend is up (price > support). */
  trend: (boolean | null)[];
}

export function supertrend(bars: Bar[], period = 10, mult = 3): SupertrendResult {
  const n = bars.length;
  const upArr: (number | null)[] = Array(n).fill(null);
  const dnArr: (number | null)[] = Array(n).fill(null);
  const trendArr: (boolean | null)[] = Array(n).fill(null);

  const atrArr = atr(bars, period);
  let prevUp: number | null = null, prevDn: number | null = null;
  let prevTrend: boolean | null = null;

  for (let i = 0; i < n; i++) {
    const a = atrArr[i];
    if (a == null) continue;
    const hl2 = (bars[i].h + bars[i].l) / 2;
    const basicUp = hl2 - mult * a;
    const basicDn = hl2 + mult * a;

    // Wilder-style: only tighten the trail, never widen.
    // Band-carry comparison uses PRIOR bar close (close[1] in Pine), not current close.
    // Pine reference:
    //   upLine := close[1] > upLine[1] ? math.max(basicUp, upLine[1]) : basicUp
    //   dnLine := close[1] < dnLine[1] ? math.min(basicDn, dnLine[1]) : basicDn
    //   trend  := close < upLine[1] ? false : (close > dnLine[1] ? true : trend[1])
    const priorClose = i > 0 ? bars[i - 1].c : bars[i].c;
    const finalUp: number = prevUp != null && priorClose > prevUp ? Math.max(basicUp, prevUp) : basicUp;
    const finalDn: number = prevDn != null && priorClose < prevDn ? Math.min(basicDn, prevDn) : basicDn;

    let trend: boolean;
    if (prevTrend == null) {
      trend = bars[i].c > finalUp;
    } else if (prevTrend && prevUp != null && bars[i].c < prevUp) {
      trend = false;
    } else if (!prevTrend && prevDn != null && bars[i].c > prevDn) {
      trend = true;
    } else {
      trend = prevTrend;
    }

    trendArr[i] = trend;
    upArr[i] = trend ? finalUp : null;
    dnArr[i] = !trend ? finalDn : null;

    prevUp = finalUp; prevDn = finalDn; prevTrend = trend;
  }

  return { up: upArr, down: dnArr, trend: trendArr };
}

// ─── Anchored VWAP ─────────────────────────────────────────────────────────────
//
// Canonical daily-bar approximation over typical price TP=(H+L+C)/3 (M2 parity
// contract with engine/indicators_m2.py). Cumulative Σ(TP·V)/Σ(V) from the anchor
// bar inclusive; strictly-before-anchor is null and a zero cumulative-volume span
// is null (never the bar's raw TP) — matches the Python engine's NaN convention.

/** String anchor modes. "vol_spike" = the max-volume bar in the trailing `lookback`
 *  window (ties → most recent) — an EARNINGS PROXY (the quarter's top-volume session),
 *  never a true earnings date. A plain number anchor is an explicit positional index. */
export type AvwapAnchor = "swing_low" | "swing_high" | "max_history" | "vol_spike";

/** Resolve an anchor spec to a positional bar index, or null if it cannot be located.
 *  A numeric spec is an explicit positional index (out-of-range → null). String modes
 *  scan the trailing `lookback` window. */
function findAnchorIndex(bars: Bar[], anchor: AvwapAnchor | number, lookback: number): number | null {
  const n = bars.length;
  if (typeof anchor === "number") {
    const pos = Math.trunc(anchor);
    return pos >= 0 && pos < n ? pos : null;
  }
  const start = Math.max(0, n - lookback);
  const window = bars.slice(start);
  if (!window.length) return null;
  if (anchor === "swing_low") {
    let minI = 0, minV = Infinity;
    for (let i = 0; i < window.length; i++) if (window[i].l < minV) { minV = window[i].l; minI = i; }
    return start + minI;
  } else if (anchor === "swing_high") {
    let maxI = 0, maxV = -Infinity;
    for (let i = 0; i < window.length; i++) if (window[i].h > maxV) { maxV = window[i].h; maxI = i; }
    return start + maxI;
  } else if (anchor === "vol_spike") {
    // Max-volume bar in the trailing window; ties → most recent (scan with >=).
    let maxI = 0, maxV = -Infinity;
    for (let i = 0; i < window.length; i++) if (window[i].v >= maxV) { maxV = window[i].v; maxI = i; }
    return start + maxI;
  }
  // max_history
  return start;
}

/** Anchored VWAP. `anchor` is a string mode or an explicit positional bar index.
 *  Values strictly before the anchor bar are null; a zero cumulative-volume span
 *  yields null (M2 canonical convention). */
export function avwap(bars: Bar[], anchor: AvwapAnchor | number = "swing_low", lookback = 252): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  const anchorIdx = findAnchorIndex(bars, anchor, lookback);
  if (anchorIdx == null) return out;
  let cumTP = 0, cumV = 0;
  for (let i = anchorIdx; i < bars.length; i++) {
    const r = bars[i];
    const tp = (r.h + r.l + r.c) / 3;
    const vol = r.v > 0 ? r.v : 0;
    cumTP += tp * vol;
    cumV += vol;
    out[i] = cumV > 0 ? cumTP / cumV : null;
  }
  return out;
}

/** Rolling VWAP over a trailing window of `n` bars: Σ(TP·V)/Σ(V).
 *  null until `n` bars are available; null if the window's total volume is 0.
 *  Daily-bar approximation over typical price (H+L+C)/3 — not intraday-true VWAP. */
export function rollingVwap(bars: Bar[], n = 20): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  const tpv: number[] = [], vq: number[] = [];
  let sTpv = 0, sV = 0;
  for (let i = 0; i < bars.length; i++) {
    const r = bars[i];
    const tp = (r.h + r.l + r.c) / 3;
    const vol = r.v > 0 ? r.v : 0;
    tpv.push(tp * vol); vq.push(vol);
    sTpv += tp * vol; sV += vol;
    if (tpv.length > n) { sTpv -= tpv.shift()!; sV -= vq.shift()!; }
    if (tpv.length === n) out[i] = sV > 0 ? sTpv / sV : null;
  }
  return out;
}

/** Bucket key under pandas W-FRI (week ending Friday):
 *  the date of the Friday that closes this bar's Sat..Fri window.
 *  Daily bars carry YYYY-MM-DD strings; intraday ChartPanel bars carry numeric
 *  display-epoch seconds, whose UTC date is the intended market-local display date. */
function weekEndFriKey(time: string | number): string {
  const dt = typeof time === "number"
    ? new Date(time * 1000)
    : new Date(time + "T00:00:00Z");
  const w = dt.getUTCDay();          // Sun=0 .. Sat=6
  const add = (5 - w + 7) % 7;       // Fri→0, Sat→6, Sun→5, … Thu→1
  const fri = new Date(dt.getTime() + add * 86400_000);
  return fri.toISOString().slice(0, 10);
}

/** Week-anchored VWAP: cumulative Σ(TP·V)/Σ(V) within each calendar week (pandas
 *  W-FRI period — weeks end Friday), reset at the first session of each week.
 *  The first session of a week has VWAP = that bar's TP (if volume > 0); a zero
 *  cumulative-volume span yields null. Assumes ascending, deduplicated bars.
 *  Daily inputs are a daily-bar approximation; numeric intraday inputs accumulate
 *  from their intraday typical-price/volume observations. */
export function weekAnchoredVwap(bars: Bar[]): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  let curKey: string | null = null, cumTP = 0, cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const r = bars[i];
    const key = weekEndFriKey(r.time);
    if (key !== curKey) { curKey = key; cumTP = 0; cumV = 0; }
    const tp = (r.h + r.l + r.c) / 3;
    const vol = r.v > 0 ? r.v : 0;
    cumTP += tp * vol; cumV += vol;
    out[i] = cumV > 0 ? cumTP / cumV : null;
  }
  return out;
}

// ─── Volume Profile ────────────────────────────────────────────────────────────

export interface VProfileBin {
  priceLo: number;
  priceMid: number;
  priceHi: number;
  volume: number;   // total or money-flow weighted depending on shelfMode
}

export interface VProfileResult {
  bins: VProfileBin[];
  poc: number;          // price of bin with highest volume
  vah: number;          // value area high (70%)
  val: number;          // value area low (70%)
}

/** Money-flow multiplier — buy share of bar volume (0.5 when h==l). */
export function buyShare(r: Bar): number {
  const range = r.h - r.l;
  if (range === 0) return 0.5;
  return ((r.c - r.l) - (r.h - r.c)) / range * 0.5 + 0.5;
}

export function vprofile(bars: Bar[], window = 126, bins = 24, shelfMode = false): VProfileResult {
  const slice = bars.slice(Math.max(0, bars.length - window));
  if (!slice.length) return { bins: [], poc: 0, vah: 0, val: 0 };

  const loPrice = Math.min(...slice.map((r) => r.l));
  const hiPrice = Math.max(...slice.map((r) => r.h));
  const range = hiPrice - loPrice;
  if (range === 0) return { bins: [{ priceLo: loPrice, priceMid: loPrice, priceHi: loPrice, volume: slice.reduce((a, r) => a + r.v, 0) }], poc: loPrice, vah: loPrice, val: loPrice };

  const binSize = range / bins;
  const volBins: number[] = Array(bins).fill(0);

  for (const r of slice) {
    const tp = (r.h + r.l + r.c) / 3;
    const bi = Math.min(bins - 1, Math.floor((tp - loPrice) / binSize));
    const weight = shelfMode ? buyShare(r) * r.v : r.v;
    if (weight > 0) volBins[bi] += weight;
  }

  const binArr: VProfileBin[] = volBins.map((vol, i) => ({
    priceLo: loPrice + i * binSize,
    priceMid: loPrice + (i + 0.5) * binSize,
    priceHi: loPrice + (i + 1) * binSize,
    volume: vol,
  }));

  // POC = bin with max volume
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (volBins[i] > volBins[pocIdx]) pocIdx = i;
  const poc = binArr[pocIdx].priceMid;

  // Value area: accumulate from POC outward until 70% of total volume covered
  const totalVol = volBins.reduce((a, v) => a + v, 0);
  const target = totalVol * 0.7;
  let acc = volBins[pocIdx], hi = pocIdx, lo = pocIdx;
  while (acc < target && (hi < bins - 1 || lo > 0)) {
    const upNext = hi < bins - 1 ? volBins[hi + 1] : -Infinity;
    const dnNext = lo > 0 ? volBins[lo - 1] : -Infinity;
    if (upNext >= dnNext) { hi++; acc += volBins[hi]; }
    else { lo--; acc += volBins[lo]; }
  }

  return { bins: binArr, poc, vah: binArr[hi].priceHi, val: binArr[lo].priceLo };
}

/** Per-bar POC (Point of Control = midpoint of the max-volume price bin) computed
 *  over the PRIOR `window` bars [t-window, t-1], EXCLUDING bar t (PIT-safe).
 *  null while fewer than `window` prior bars exist. Bins: linspace(min low, max high,
 *  bins+1) of the slice; each bar's full volume into the bin holding its TP (top edge
 *  clipped into the last bin); POC ties → lower-price bin. M2 parity with rolling_poc.
 *  Daily-bar approximation over typical price (H+L+C)/3 — not intraday-true VWAP. */
export function rollingPoc(bars: Bar[], window = 126, bins = 24): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  for (let t = window; t < bars.length; t++) {
    const slice = bars.slice(t - window, t); // prior window, excludes bar t
    let loPrice = Infinity, hiPrice = -Infinity, totalVol = 0;
    for (const r of slice) {
      if (r.l < loPrice) loPrice = r.l;
      if (r.h > hiPrice) hiPrice = r.h;
      totalVol += r.v;
    }
    if (totalVol <= 0) continue;
    if (loPrice === hiPrice) { out[t] = loPrice; continue; } // degenerate → that price
    const binSize = (hiPrice - loPrice) / bins;
    const volBins: number[] = Array(bins).fill(0);
    for (const r of slice) {
      const tp = (r.h + r.l + r.c) / 3;
      const bi = Math.min(bins - 1, Math.floor((tp - loPrice) / binSize));
      if (r.v > 0) volBins[bi] += r.v;
    }
    let pocIdx = 0;
    for (let i = 1; i < bins; i++) if (volBins[i] > volBins[pocIdx]) pocIdx = i; // ties → lower bin
    out[t] = loPrice + (pocIdx + 0.5) * binSize;
  }
  return out;
}

// ─── Volatility Box ────────────────────────────────────────────────────────────

export interface VolboxResult {
  /** Index where the current (or last) squeeze started. null if never squeezed. */
  squeezeStart: number | null;
  /** null = unresolved; "up" | "down" = resolved. */
  resolution: "up" | "down" | null;
  /** Index where resolution happened (null if unresolved). */
  resolutionIdx: number | null;
  /** The box hi/lo levels during the squeeze. */
  boxHi: number;
  boxLo: number;
  /** BB bandwidth for each bar (null before warmup). */
  bandwidth: (number | null)[];
  /** Whether each bar is in a squeeze. */
  inSqueeze: boolean[];
}

export function volbox(bars: Bar[], bbLen = 20, mult = 2, pctileWin = 126, squeezePct = 25, boxWin = 20): VolboxResult {
  const n = bars.length;
  const closes = bars.map((r) => r.c);

  // Bollinger band basis + upper/lower
  const basisArr = sma(closes, bbLen);
  const sdArr: (number | null)[] = Array(n).fill(null);
  for (let i = bbLen - 1; i < n; i++) {
    const w = closes.slice(i - bbLen + 1, i + 1);
    const m = basisArr[i] ?? (w.reduce((a, b) => a + b, 0) / w.length);
    sdArr[i] = Math.sqrt(w.reduce((a, v) => a + (v - m) ** 2, 0) / w.length);
  }

  const bwArr: (number | null)[] = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const b = basisArr[i], sd = sdArr[i];
    if (b == null || sd == null || b === 0) continue;
    const upper = b + mult * sd, lower = b - mult * sd;
    bwArr[i] = (upper - lower) / b;
  }

  const bwPct = rollingPercentile(bwArr, pctileWin);

  // Find the most recent complete squeeze and resolution
  const inSqueeze = bwPct.map((p) => p != null && p <= squeezePct);

  // Scan for the last squeeze episode
  let squeezeStart: number | null = null;
  let resolution: "up" | "down" | null = null;
  let resolutionIdx: number | null = null;
  let boxHi = 0, boxLo = 0;
  let curSqueezeStart: number | null = null;

  for (let i = 0; i < n; i++) {
    if (inSqueeze[i]) {
      if (curSqueezeStart == null) curSqueezeStart = i;
    } else {
      if (curSqueezeStart != null) {
        // squeeze ended — check resolution
        const squeezeEnd = i - 1;
        // box hi/lo = rolling max(high,boxWin) / min(low,boxWin) during squeeze
        let bhi = -Infinity, blo = Infinity;
        const sqLen = squeezeEnd - curSqueezeStart + 1;
        for (let j = Math.max(0, squeezeEnd - boxWin + 1); j <= squeezeEnd; j++) {
          if (bars[j].h > bhi) bhi = bars[j].h;
          if (bars[j].l < blo) blo = bars[j].l;
        }
        // Resolution: first close that breaks out
        let resolved: "up" | "down" | null = null;
        let resolvedAt: number | null = null;
        for (let j = i; j < n; j++) {
          if (bars[j].c > bhi) { resolved = "up"; resolvedAt = j; break; }
          if (bars[j].c < blo) { resolved = "down"; resolvedAt = j; break; }
        }
        // This episode is a candidate — keep it (the LAST squeeze wins if there are multiple resolved ones)
        squeezeStart = curSqueezeStart;
        resolution = resolved;
        resolutionIdx = resolvedAt;
        boxHi = bhi;
        boxLo = blo;
        if (resolved != null) {
          // This episode is resolved — continue to find any newer episode
          curSqueezeStart = null;
        } else {
          curSqueezeStart = null;
        }
      }
    }
  }

  // If we're still in a squeeze at the end
  if (curSqueezeStart != null) {
    squeezeStart = curSqueezeStart;
    resolution = null;
    resolutionIdx = null;
    let bhi = -Infinity, blo = Infinity;
    for (let j = Math.max(0, n - boxWin); j < n; j++) {
      if (bars[j].h > bhi) bhi = bars[j].h;
      if (bars[j].l < blo) blo = bars[j].l;
    }
    boxHi = bhi;
    boxLo = blo;
  }

  return { squeezeStart, resolution, resolutionIdx, boxHi, boxLo, bandwidth: bwArr, inSqueeze };
}

// ─── RSI Stack ─────────────────────────────────────────────────────────────────

export interface RsiStackResult {
  r1: (number | null)[];
  r2: (number | null)[];
  r3: (number | null)[];
}

export function rsiStack(bars: Bar[], len1 = 7, len2 = 14, len3 = 21): RsiStackResult {
  const closes = bars.map((r) => r.c);
  // RSI via RMA (Wilder's method, matching techRating.ts)
  function rsiFromCloses(src: number[], len: number): (number | null)[] {
    const gains: (number | null)[] = Array(src.length).fill(null);
    const losses: (number | null)[] = Array(src.length).fill(null);
    for (let i = 1; i < src.length; i++) {
      const ch = src[i] - src[i - 1];
      gains[i] = ch > 0 ? ch : 0;
      losses[i] = ch < 0 ? -ch : 0;
    }
    const ag = rma(gains, len);
    const al = rma(losses, len);
    return src.map((_, i) => {
      const g = ag[i], l = al[i];
      if (g == null || l == null) return null;
      if (l === 0) return 100;
      return 100 - 100 / (1 + g / l);
    });
  }
  return {
    r1: rsiFromCloses(closes, len1),
    r2: rsiFromCloses(closes, len2),
    r3: rsiFromCloses(closes, len3),
  };
}

// ─── Accumulation % ───────────────────────────────────────────────────────────
//
// Descriptive money-flow share (close-in-range). Does not identify institutional vs retail activity.
// 35/50/75 are public charting reference bands, not signals.

export function accumPct(bars: Bar[], win = 63): (number | null)[] {
  const out: (number | null)[] = Array(bars.length).fill(null);
  const buyVol = bars.map((r) => buyShare(r) * Math.max(0, r.v));
  let cumBuy = 0, cumVol = 0;
  const qBuy: number[] = [], qVol: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    qBuy.push(buyVol[i]); qVol.push(Math.max(0, bars[i].v));
    cumBuy += buyVol[i]; cumVol += Math.max(0, bars[i].v);
    if (qBuy.length > win) { cumBuy -= qBuy.shift()!; cumVol -= qVol.shift()!; }
    if (qBuy.length === win && cumVol > 0) out[i] = 100 * cumBuy / cumVol;
  }
  return out;
}

// ─── Bollinger Bands (sample std dev, ddof=1) ─────────────────────────────────
//
// NOTE: This implementation uses the *sample* standard deviation (divides by N-1)
// to match the Python engine's _bb_bands() (numpy ddof=1) and the parity fixtures.
// The ChartPanel.tsx inline `stddev` function uses *population* std dev (divides by N)
// — that is a known divergence between the chart display and this math library.
// See indicatorParity.test.ts for the documented test.todo covering this divergence.

export interface BollingerResult {
  upper: (number | null)[];
  mid: (number | null)[];
  lower: (number | null)[];
}

/** Bollinger Bands with SMA basis and sample std dev (ddof=1). */
export function bollingerBands(bars: Bar[], len = 20, mult = 2.0): BollingerResult {
  const closes = bars.map((r) => r.c);
  const n = closes.length;
  const upperArr: (number | null)[] = Array(n).fill(null);
  const midArr: (number | null)[] = Array(n).fill(null);
  const lowerArr: (number | null)[] = Array(n).fill(null);

  for (let i = len - 1; i < n; i++) {
    const window = closes.slice(i - len + 1, i + 1);
    const mean = window.reduce((a, v) => a + v, 0) / len;
    // Sample std dev: divide by (N-1) to match Python numpy ddof=1
    const variance = window.reduce((a, v) => a + (v - mean) ** 2, 0) / (len - 1);
    const sd = Math.sqrt(variance);
    midArr[i] = mean;
    upperArr[i] = mean + mult * sd;
    lowerArr[i] = mean - mult * sd;
  }

  return { upper: upperArr, mid: midArr, lower: lowerArr };
}

// ─── Trend Ribbon ─────────────────────────────────────────────────────────────

export interface RibbonResult {
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  /** State per bar: "ribbonUp" | "ribbonDown" | "flat" */
  state: ("ribbonUp" | "ribbonDown" | "flat")[];
  /** Whether the short-term momentum is up (close > emaFast and emaFast rising). */
  shortUp: (boolean | null)[];
}

export function trendRibbon(bars: Bar[], fast = 20, slow = 50, slopeWin = 10): RibbonResult {
  const closes = bars.map((r) => r.c);
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const n = bars.length;
  const state: ("ribbonUp" | "ribbonDown" | "flat")[] = Array(n).fill("flat");
  const shortUpArr: (boolean | null)[] = Array(n).fill(null);

  for (let i = slopeWin; i < n; i++) {
    const f = ef[i], s = es[i];
    if (f == null || s == null) continue;
    const prevS = es[i - slopeWin];
    const slopeUp = prevS != null && s > prevS;
    const slopeDn = prevS != null && s < prevS;
    const c = closes[i];

    const ribbonUp = f > s && slopeUp && c > s;
    const ribbonDn = f < s && slopeDn && c < s;

    if (ribbonUp) state[i] = "ribbonUp";
    else if (ribbonDn) state[i] = "ribbonDown";
    else state[i] = "flat";

    const prevF = ef[i - 1];
    shortUpArr[i] = (f != null && prevF != null && c > f && f > prevF);
  }

  return { emaFast: ef, emaSlow: es, state, shortUp: shortUpArr };
}

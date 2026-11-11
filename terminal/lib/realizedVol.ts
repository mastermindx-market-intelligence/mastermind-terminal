// realizedVol.ts — Yang-Zhang realized volatility + percentile cone (BUILD-SPEC §3.1, recipe in
// data/options-iv.md §12). SINGLE AUTHOR: lane FE1a.
//
// Used as the universal IV fallback for symbols with no listed options (CN/HK/crypto): a
// realized-vol cone over windows [10, 21, 42, 63, 126, 252]. All pure functions over Bar[].

import type { Bar } from "./fund";

export const RV_WINDOWS = [10, 21, 42, 63, 126, 252];

/**
 * realizedVolYZ — Yang-Zhang annualized realized vol (as a decimal, e.g. 0.31 = 31%).
 * Combines overnight variance, open→close variance and the Rogers-Satchell drift-free term:
 *   sigma_YZ^2 = sigma_overnight^2 + k*sigma_OC^2 + (1-k)*sigma_RS^2 ,  k = 0.34/(1.34+(N+1)/(N-1))
 * Needs ≥ 2 bars (returns 0 otherwise, since overnight returns need a prior close).
 */
export function realizedVolYZ(bars: Bar[], annualize = 252): number {
  const n = bars.length;
  if (n < 2) return 0;

  // Overnight: log(O_i / C_{i-1})  (i = 1..n-1)
  const oRets: number[] = [];
  // Open-to-close: log(C_i / O_i)  (i = 1..n-1, aligned to the overnight window)
  const ocRets: number[] = [];
  for (let i = 1; i < n; i++) {
    const prevC = bars[i - 1].c;
    const o = bars[i].o;
    const c = bars[i].c;
    if (prevC > 0 && o > 0 && c > 0) {
      oRets.push(Math.log(o / prevC));
      ocRets.push(Math.log(c / o));
    }
  }

  const varO = sampleVar(oRets);
  const varC = sampleVar(ocRets);

  // Rogers-Satchell over the same i=1..n-1 window.
  let rsSum = 0;
  let rsN = 0;
  for (let i = 1; i < n; i++) {
    const { o, h, l, c } = bars[i];
    if (o > 0 && h > 0 && l > 0 && c > 0) {
      rsSum += Math.log(h / o) * Math.log(h / c) + Math.log(l / o) * Math.log(l / c);
      rsN++;
    }
  }
  const varRS = rsN > 0 ? rsSum / rsN : 0;

  const N = Math.max(oRets.length, 2);
  const k = 0.34 / (1.34 + (N + 1) / (N - 1));
  const varYZ = varO + k * varC + (1 - k) * varRS;
  return Math.sqrt(Math.max(varYZ, 0) * annualize);
}

/** Sample variance (Bessel-corrected). Returns 0 for < 2 points. */
function sampleVar(xs: number[]): number {
  const m = xs.length;
  if (m < 2) return 0;
  let mu = 0;
  for (const x of xs) mu += x;
  mu /= m;
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return s / (m - 1);
}

export interface RvConeRow {
  window: number; // trailing days
  current: number | null; // most-recent trailing-window RV (decimal)
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
}

/**
 * realizedVolCone — for each window, roll the YZ estimator across all available history and
 * summarize the distribution (min / p25 / median / p75 / max) plus the CURRENT trailing value.
 * The cone is what the widget draws: current RV against its own historical percentile band.
 *
 * Rolling step is 1 bar. To keep this cheap for 252-day windows over multi-year history we cap
 * the number of samples at ~500 by striding.
 */
export function realizedVolCone(bars: Bar[]): RvConeRow[] {
  return RV_WINDOWS.map((w) => {
    // Need w+1 bars for one YZ sample (overnight return uses the prior close).
    if (bars.length < w + 1) {
      return { window: w, current: null, min: null, p25: null, median: null, p75: null, max: null };
    }

    const samples: number[] = [];
    let current: number | null = null;
    const total = bars.length - w; // number of possible window end-positions
    const stride = Math.max(1, Math.floor(total / 500));
    for (let end = bars.length; end - (w + 1) >= 0; end -= stride) {
      // window = bars[end-(w+1) .. end-1]; +1 for the overnight seed bar
      const slice = bars.slice(end - (w + 1), end);
      const rv = realizedVolYZ(slice);
      const eligible = isFinite(rv) && rv > 0;
      // The first computed window is Current, even when historical sampling excludes it.
      if (end === bars.length) current = eligible ? rv : null;
      if (eligible) samples.push(rv);
    }

    if (samples.length === 0) {
      return { window: w, current: null, min: null, p25: null, median: null, p75: null, max: null };
    }

    const sorted = samples.slice().sort((a, b) => a - b);
    return {
      window: w,
      current,
      min: sorted[0],
      p25: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      max: sorted[sorted.length - 1],
    };
  });
}

/** Linear-interpolated percentile over an already-sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * rvPercentileRank — where the current RV sits within its historical [min,max] band for a window
 * (0..1). Handy for a "RV is at the 82nd percentile" caption. null when insufficient data.
 */
export function rvPercentileRank(row: RvConeRow): number | null {
  if (row.current == null || row.min == null || row.max == null) return null;
  if (row.max <= row.min) return null;
  const r = (row.current - row.min) / (row.max - row.min);
  return Math.max(0, Math.min(1, r));
}

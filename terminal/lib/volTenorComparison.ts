/**
 * volTenorComparison.ts — constant-tenor comparison over the PUBLISHED ATM
 * term structure (Options R1 W3B; freeze §W3B B1 rules + 2026-10-21 axes
 * amendment).
 *
 * Pure: no React, no DOM, no network. IVs are percent NUMBERS as in
 * components/vol/volTypes.ts (58.2 == 58.2%).
 *
 * Honesty contract (each clause is test-enforced):
 *   - A comparison point is `supplied`, `interpolated` (variance-linear in
 *     CALENDAR days between the two nearest supplied expiries) or
 *     `unsupported` — never extrapolated outside the supplied range.
 *   - The payload publishes no spot and no per-strike delta: the delta axis
 *     is `unsupported` for every input until the producer changes.
 *   - The expected move is the DECLARED iv·√T approximation on trading days
 *     252, in percent, with a price range only when a spot is supplied, and
 *     carries no confidence level of any kind.
 *   - Skew is read in STRIKE space (share of the reference strike) between
 *     ADJACENT supplied finite legs only; wings stay blank.
 *
 * Admission mirrors the shared owner the panels use
 * (volShared.reportedVolNumber / volIsoDay via VolTermPanel) — a row is a
 * candidate only with a finite dte ≥ 0, a valid ISO expiry and a finite
 * atm_iv; re-stated locally because this module must not import React.
 */

import type { VolSmileExp, VolSmilePoint, VolTermRow } from "@/components/vol/volTypes";

export type PointBasis = "supplied" | "interpolated" | "unsupported";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Same rule as volShared.reportedVolNumber (React-free restatement). */
function obsNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

/** Same rule as volShared.volIsoDay (React-free restatement). */
function isoDay(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return null;
  const epoch = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value ? value : null;
}

// ── Constant tenor ────────────────────────────────────────────────────────────

export interface TenorPoint {
  tenorDays: number;
  iv: number | null;
  basis: PointBasis;
  between?: { lo: VolTermRow; hi: VolTermRow };
  reason?: "outside_supplied_range" | "no_supplied_points" | "invalid_tenor";
}

export const STANDARD_TENORS = [7, 14, 21, 30, 60, 90] as const;

/**
 * One constant-tenor ATM IV point. An exact supplied DTE is `supplied`; a tenor
 * strictly between two admitted neighbours is variance-linear in calendar days:
 * v(t) = σ_lo²·dte_lo + (σ_hi²·dte_hi − σ_lo²·dte_lo)·(t − dte_lo)/(dte_hi − dte_lo),
 * iv = √(v(t)/t). Outside the supplied range → `unsupported`, never extrapolated.
 * Null/non-finite supplied points are never chosen as neighbours.
 */
export function constantTenorPoint(term: readonly VolTermRow[] | undefined, tenorDays: number): TenorPoint {
  if (!Number.isFinite(tenorDays) || tenorDays <= 0) {
    return { tenorDays, iv: null, basis: "unsupported", reason: "invalid_tenor" };
  }
  const admitted = (term ?? [])
    .map((row) => ({ dte: obsNum(row?.dte), exp: isoDay(row?.exp), iv: obsNum(row?.atm_iv) }))
    .filter((row): row is { dte: number; exp: string; iv: number } =>
      Number.isFinite(row.dte) && row.exp != null && Number.isFinite(row.iv))
    .sort((a, b) => a.dte - b.dte);
  if (admitted.length === 0) {
    return { tenorDays, iv: null, basis: "unsupported", reason: "no_supplied_points" };
  }
  const exact = admitted.find((row) => row.dte === tenorDays);
  if (exact) {
    return { tenorDays, iv: exact.iv, basis: "supplied" };
  }
  const lo = [...admitted].reverse().find((row) => row.dte < tenorDays);
  const hi = admitted.find((row) => row.dte > tenorDays);
  if (lo == null || hi == null) {
    return { tenorDays, iv: null, basis: "unsupported", reason: "outside_supplied_range" };
  }
  const vLo = lo.iv * lo.iv * lo.dte;
  const vHi = hi.iv * hi.iv * hi.dte;
  const w = (tenorDays - lo.dte) / (hi.dte - lo.dte);
  const v = vLo + (vHi - vLo) * w;
  return {
    tenorDays,
    iv: Math.sqrt(v / tenorDays),
    basis: "interpolated",
    between: {
      lo: { dte: lo.dte, exp: lo.exp, atm_iv: lo.iv },
      hi: { dte: hi.dte, exp: hi.exp, atm_iv: hi.iv },
    },
  };
}

// ── Constant delta (honest placeholder) ───────────────────────────────────────

/**
 * The published payload carries no per-strike delta, so a constant-delta point
 * cannot exist yet. Kept as a typed boundary so a future delta publication has
 * exactly one place to land — never invented client-side.
 */
export function constantDeltaPoint(_term: unknown, _delta: number): { basis: "unsupported"; reason: "delta_not_published" } {
  void _term;
  void _delta;
  return { basis: "unsupported", reason: "delta_not_published" };
}

// ── Expected move (declared approximation, no confidence level) ──────────────

export interface ExpectedMove {
  estimator: "iv_sqrt_t";
  annualisation: "trading_days_252";
  pct: number;
  horizonDays: number;
  ivPct: number;
  ivAsOf: string;
  spotAsOf: string | null;
  lo: number | null;
  hi: number | null;
  spot: number | null;
}

/**
 * iv·√T expected move in PERCENT on trading days 252: pct = ivPct·√(days/252).
 * A price range exists only when a finite spot > 0 with its own as-of is
 * supplied — the two clocks (volatility vs spot) are carried separately.
 * Returns null when the IV or horizon is not a usable number.
 */
export function expectedMoveFromIv(input: {
  ivPct: number;
  horizonDays: number;
  ivAsOf: string;
  spot?: { value: number; asOf: string } | null;
}): ExpectedMove | null {
  const { ivPct, horizonDays, ivAsOf, spot } = input;
  if (!Number.isFinite(ivPct) || !Number.isFinite(horizonDays) || horizonDays <= 0) return null;
  const pct = ivPct * Math.sqrt(horizonDays / 252);
  const okSpot =
    spot != null &&
    Number.isFinite(spot.value) &&
    spot.value > 0 &&
    typeof spot.asOf === "string" &&
    spot.asOf.length > 0;
  return {
    estimator: "iv_sqrt_t",
    annualisation: "trading_days_252",
    pct,
    horizonDays,
    ivPct,
    ivAsOf,
    spotAsOf: okSpot ? spot.asOf : null,
    lo: okSpot ? spot.value * (1 - pct / 100) : null,
    hi: okSpot ? spot.value * (1 + pct / 100) : null,
    spot: okSpot ? spot.value : null,
  };
}

// ── Event windows (dates only) ────────────────────────────────────────────────

export interface CurveEvent {
  kind: string;
  /** "YYYY-MM-DD"; time of day is never assumed. */
  date: string;
  label: string;
  source: string;
}

/** Events whose window (today → expiry, inclusive) contains the event date. */
export function eventInWindow(expiry: string, events: readonly CurveEvent[], today: string): CurveEvent[] {
  if (!ISO_DAY.test(expiry) || !ISO_DAY.test(today)) return [];
  return events.filter(
    (event) => event != null && ISO_DAY.test(event.date ?? "") && today <= event.date && event.date <= expiry,
  );
}

/** Weekdays strictly after `today` through `expiry` (holidays NOT subtracted). */
export function tradingDaysBetween(today: string, expiry: string): number | null {
  if (!ISO_DAY.test(today) || !ISO_DAY.test(expiry)) return null;
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  let n = 0;
  const cur = new Date(start);
  for (let guard = 0; guard < 800; guard++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (cur.getTime() > end) break;
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

// ── Skew in strike space (delta axis unsupported) ─────────────────────────────

export interface SkewPoint {
  pctOfRef: number;
  strike: number | null;
  iv: number | null;
  basis: PointBasis;
  between?: { lo: number; hi: number };
  reason?: "no_strike_supplied" | "wing_gap" | "no_reference";
}

type SmileLeg = "call_iv" | "put_iv";

function legValue(point: VolSmilePoint, leg: SmileLeg): number {
  return obsNum(point[leg]);
}

/**
 * The ATM display proxy VolSkewPanel draws around: the supplied strike with the
 * smallest finite |call_iv − put_iv| gap (same rule, React-free restatement —
 * VolSkewPanel does not export it).
 */
export function atmProxyStrike(smile: VolSmileExp | undefined): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (const point of smile?.points ?? []) {
    if (typeof point?.strike !== "number" || !Number.isFinite(point.strike) || point.strike <= 0) continue;
    const c = obsNum(point.call_iv);
    const q = obsNum(point.put_iv);
    if (!Number.isFinite(c) || !Number.isFinite(q)) continue;
    const gap = Math.abs(c - q);
    if (gap < bestGap) {
      bestGap = gap;
      best = point.strike;
    }
  }
  return best;
}

/**
 * Skew rows as a share of the reference strike, in strike space only. A row
 * whose share matches a supplied strike is `supplied` on the requested leg;
 * strictly between two ADJACENT supplied finite legs it is linear-in-strike
 * `interpolated`; beyond the supplied legs it stays `unsupported`
 * (no_strike_supplied); a non-finite leg between the bracketing strikes makes
 * the gap explicit (wing_gap) — never bridged, never extrapolated.
 * "auto" reads the put leg at/below the reference and the call leg above,
 * the same convention VolSkewPanel's descriptive 95–105 read uses.
 */
export function skewInStrikeSpace(
  smile: VolSmileExp | undefined,
  refStrike: number | null,
  pctsOfRef: readonly number[],
  leg: "call" | "put" | "auto",
): SkewPoint[] {
  const ref = refStrike != null && Number.isFinite(refStrike) && refStrike > 0 ? refStrike : null;
  const points = (smile?.points ?? []).filter(
    (point) => typeof point?.strike === "number" && Number.isFinite(point.strike) && point.strike > 0,
  );
  const rows = pctsOfRef.map((pct): SkewPoint => {
    if (ref == null || !Number.isFinite(pct) || pct <= 0) {
      return { pctOfRef: pct, strike: null, iv: null, basis: "unsupported", reason: ref == null ? "no_reference" : "no_strike_supplied" };
    }
    const smileLeg: SmileLeg = leg === "call" ? "call_iv" : leg === "put" ? "put_iv" : pct <= 100 ? "put_iv" : "call_iv";
    const target = ref * (pct / 100);
    const sorted = [...points].sort((a, b) => a.strike - b.strike);
    const exact = sorted.find((point) => Math.abs((point.strike / ref) * 100 - pct) < 0.5);
    if (exact != null) {
      const iv = legValue(exact, smileLeg);
      return Number.isFinite(iv)
        ? { pctOfRef: pct, strike: exact.strike, iv, basis: "supplied" }
        : { pctOfRef: pct, strike: exact.strike, iv: null, basis: "unsupported", reason: "no_strike_supplied" };
    }
    const finite = sorted
      .map((point) => ({ strike: point.strike, v: legValue(point, smileLeg) }))
      .filter((point) => Number.isFinite(point.v));
    const lo = [...finite].reverse().find((point) => point.strike < target);
    const hi = finite.find((point) => point.strike > target);
    if (lo == null || hi == null) {
      return { pctOfRef: pct, strike: null, iv: null, basis: "unsupported", reason: "no_strike_supplied" };
    }
    const bridged = sorted.some((point) => lo.strike < point.strike && point.strike < hi.strike);
    if (bridged) {
      return { pctOfRef: pct, strike: null, iv: null, basis: "unsupported", reason: "wing_gap" };
    }
    return {
      pctOfRef: pct,
      iv: lo.v + (hi.v - lo.v) * ((target - lo.strike) / (hi.strike - lo.strike)),
      strike: null,
      basis: "interpolated",
      between: { lo: lo.strike, hi: hi.strike },
    };
  });
  return rows;
}

// ── Answer line ───────────────────────────────────────────────────────────────

/** Vol-point differences of the selected point against the 7D and 30D anchors; null when a side has no point. */
export function answerLine(
  selected: TenorPoint,
  ref7: TenorPoint,
  ref30: TenorPoint,
): { above7: number | null; above30: number | null } {
  const diff = (a: TenorPoint, b: TenorPoint) => (a.iv != null && b.iv != null ? a.iv - b.iv : null);
  return { above7: diff(selected, ref7), above30: diff(selected, ref30) };
}

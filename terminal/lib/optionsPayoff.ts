/**
 * Deterministic options expiration-payoff math.
 *
 * Scope:
 * - user-entered option legs only (call/put, long/short, strike, premium, quantity)
 * - one standard 100-share contract multiplier
 * - expiration payoff only
 *
 * Explicitly NOT modeled here: mark-to-market value before expiry, implied volatility,
 * probability, assignment timing, dividends, borrow, commissions, slippage, taxes,
 * exercise policy, order routing, or a trade recommendation.
 */

export const OPTION_CONTRACT_MULTIPLIER = 100;
export const PAYOFF_MAX_LEGS = 6;

export type OptionRight = "C" | "P";
export type OptionPositionSide = "long" | "short";

export interface PayoffLegInput {
  id: string;
  right: OptionRight;
  side: OptionPositionSide;
  strike: number;
  /** Quoted option premium per share, in dollars. Must be non-negative. */
  premium: number;
  /** Positive whole option-contract count. */
  quantity: number;
}

export interface PayoffPoint {
  price: number;
  pnl: number;
}

export interface BreakEvenRange {
  from: number;
  /** null means the zero-P/L range extends without bound. */
  to: number | null;
}

export interface PayoffAnalysis {
  valid: boolean;
  errors: string[];
  legs: PayoffLegInput[];
  contractMultiplier: typeof OPTION_CONTRACT_MULTIPLIER;
  /** Entry cashflow in dollars: positive = credit received, negative = debit paid. */
  entryCashflow: number;
  breakEvens: number[];
  /** Continuous underlying-price ranges whose expiration P/L is exactly zero. */
  breakEvenRanges: BreakEvenRange[];
  /** Best expiration P/L in dollars when finite. It may be negative if every outcome loses. */
  bestExpiryPnl: number | null;
  bestExpiryPnlUnlimited: boolean;
  /** Positive dollar loss amount when finite. */
  maxLoss: number | null;
  maxLossUnlimited: boolean;
  /** Change in expiration P/L for a $1 rise in underlying once above every strike. */
  highPriceSlope: number;
  knots: PayoffPoint[];
  chart: PayoffPoint[];
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function roundMoney(v: number): number {
  return Math.abs(v) < 5e-9 ? 0 : Math.round(v * 100) / 100;
}

function roundPrice(v: number): number {
  return Math.abs(v) < 5e-9 ? 0 : Math.round(v * 10000) / 10000;
}

function validateLeg(leg: PayoffLegInput, index: number): string[] {
  const errors: string[] = [];
  const label = `leg ${index + 1}`;
  if (!leg || typeof leg !== "object") return [`${label}: invalid leg`];
  if (leg.right !== "C" && leg.right !== "P") errors.push(`${label}: right must be C or P`);
  if (leg.side !== "long" && leg.side !== "short") errors.push(`${label}: side must be long or short`);
  if (!finite(leg.strike) || leg.strike <= 0) errors.push(`${label}: strike must be a positive finite number`);
  if (!finite(leg.premium) || leg.premium < 0) errors.push(`${label}: premium must be a non-negative finite number`);
  if (!Number.isSafeInteger(leg.quantity) || leg.quantity < 1 || leg.quantity > 100_000) {
    errors.push(`${label}: quantity must be a positive safe integer`);
  }
  return errors;
}

export function payoffLegAtExpiry(leg: PayoffLegInput, underlyingPrice: number): number {
  if (!finite(underlyingPrice) || underlyingPrice < 0) return Number.NaN;
  const intrinsic = leg.right === "C"
    ? Math.max(0, underlyingPrice - leg.strike)
    : Math.max(0, leg.strike - underlyingPrice);
  const position = leg.side === "long" ? 1 : -1;
  const perShare = position * (intrinsic - leg.premium);
  return roundMoney(perShare * leg.quantity * OPTION_CONTRACT_MULTIPLIER);
}

export function payoffAtExpiry(legs: readonly PayoffLegInput[], underlyingPrice: number): number {
  if (!finite(underlyingPrice) || underlyingPrice < 0) return Number.NaN;
  let total = 0;
  for (const leg of legs) {
    const value = payoffLegAtExpiry(leg, underlyingPrice);
    if (!finite(value)) return Number.NaN;
    total += value;
  }
  return roundMoney(total);
}

export function entryCashflow(legs: readonly PayoffLegInput[]): number {
  let total = 0;
  for (const leg of legs) {
    const direction = leg.side === "long" ? -1 : 1;
    total += direction * leg.premium * leg.quantity * OPTION_CONTRACT_MULTIPLIER;
  }
  return roundMoney(total);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map(roundPrice))].sort((a, b) => a - b);
}

function breakEvenSet(legs: readonly PayoffLegInput[], strikes: number[]): {
  roots: number[];
  ranges: BreakEvenRange[];
} {
  if (!legs.length) return { roots: [], ranges: [] };
  const knots = uniqueSorted([0, ...strikes]);
  const roots: number[] = [];
  const ranges: BreakEvenRange[] = [];
  const zero = (v: number) => Math.abs(v) < 1e-7;

  const addRoot = (v: number) => {
    if (!finite(v) || v < 0) return;
    const rounded = roundPrice(v);
    if (!roots.some((r) => Math.abs(r - rounded) < 1e-4)) roots.push(rounded);
  };
  const addRange = (from: number, to: number | null) => {
    const next = { from: roundPrice(from), to: to == null ? null : roundPrice(to) };
    const last = ranges[ranges.length - 1];
    if (last && last.to != null && Math.abs(last.to - next.from) < 1e-4) {
      last.to = next.to;
      return;
    }
    ranges.push(next);
  };

  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    const ya = payoffAtExpiry(legs, a);
    const yb = payoffAtExpiry(legs, b);
    if (zero(ya) && zero(yb)) {
      addRange(a, b);
      continue;
    }
    if (zero(ya)) addRoot(a);
    if (zero(yb)) addRoot(b);
    if ((ya < 0 && yb > 0) || (ya > 0 && yb < 0)) {
      addRoot(a + (-ya * (b - a)) / (yb - ya));
    }
  }

  const last = knots[knots.length - 1] ?? 0;
  const yLast = payoffAtExpiry(legs, last);
  const slope = highPriceSlope(legs);
  if (Math.abs(slope) > 1e-12) {
    const root = last - yLast / slope;
    if (root >= last - 1e-7) addRoot(root);
  } else if (zero(yLast)) {
    addRange(last, null);
  }

  const pointRoots = roots
    .filter((root) => !ranges.some((range) => root >= range.from - 1e-7 && (range.to == null || root <= range.to + 1e-7)))
    .sort((a, b) => a - b);
  return { roots: pointRoots, ranges };
}

export function highPriceSlope(legs: readonly PayoffLegInput[]): number {
  let slope = 0;
  for (const leg of legs) {
    if (leg.right !== "C") continue;
    const position = leg.side === "long" ? 1 : -1;
    slope += position * leg.quantity * OPTION_CONTRACT_MULTIPLIER;
  }
  return slope;
}

function chartDomain(strikes: number[], breakEvens: number[]): [number, number] {
  const values = [...strikes, ...breakEvens].filter((v) => finite(v) && v >= 0);
  if (!values.length) return [0, 100];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const center = (lo + hi) / 2;
  const rawSpan = Math.max(hi - lo, center * 0.22, 10);
  const min = Math.max(0, lo - rawSpan * 0.65);
  const max = hi + rawSpan * 0.75;
  return [roundPrice(min), roundPrice(Math.max(max, min + 10))];
}

function chartPoints(legs: readonly PayoffLegInput[], strikes: number[], breakEvens: number[]): PayoffPoint[] {
  const [min, max] = chartDomain(strikes, breakEvens);
  const base = Array.from({ length: 81 }, (_, i) => min + ((max - min) * i) / 80);
  const xs = uniqueSorted([...base, ...strikes, ...breakEvens].filter((v) => v >= min && v <= max));
  return xs.map((price) => ({ price, pnl: payoffAtExpiry(legs, price) }));
}

export function analyzeExpirationPayoff(inputs: readonly PayoffLegInput[]): PayoffAnalysis {
  const legs = inputs.map((leg) => ({ ...leg }));
  const errors: string[] = [];
  if (legs.length < 1) errors.push("at least one option leg is required");
  if (legs.length > PAYOFF_MAX_LEGS) errors.push(`at most ${PAYOFF_MAX_LEGS} option legs are supported`);
  legs.forEach((leg, index) => errors.push(...validateLeg(leg, index)));
  const ids = legs.map((leg) => String(leg.id ?? ""));
  if (ids.some((id) => !id)) errors.push("every leg requires a stable id");
  if (new Set(ids).size !== ids.length) errors.push("leg ids must be unique");

  const empty: PayoffAnalysis = {
    valid: false,
    errors,
    legs,
    contractMultiplier: OPTION_CONTRACT_MULTIPLIER,
    entryCashflow: 0,
    breakEvens: [],
    breakEvenRanges: [],
    bestExpiryPnl: null,
    bestExpiryPnlUnlimited: false,
    maxLoss: null,
    maxLossUnlimited: false,
    highPriceSlope: 0,
    knots: [],
    chart: [],
  };
  if (errors.length) return empty;

  const strikes = uniqueSorted(legs.map((leg) => leg.strike));
  const knotsX = uniqueSorted([0, ...strikes]);
  const knots = knotsX.map((price) => ({ price, pnl: payoffAtExpiry(legs, price) }));
  const slope = highPriceSlope(legs);
  const bestExpiryPnlUnlimited = slope > 1e-12;
  const maxLossUnlimited = slope < -1e-12;
  const knotPnls = knots.map((p) => p.pnl);
  const bestExpiryPnl = bestExpiryPnlUnlimited ? null : roundMoney(Math.max(...knotPnls));
  const minPnl = Math.min(...knotPnls);
  const maxLoss = maxLossUnlimited ? null : roundMoney(Math.max(0, -minPnl));
  const breakEven = breakEvenSet(legs, strikes);
  const breakEvens = breakEven.roots;

  return {
    valid: true,
    errors: [],
    legs,
    contractMultiplier: OPTION_CONTRACT_MULTIPLIER,
    entryCashflow: entryCashflow(legs),
    breakEvens,
    breakEvenRanges: breakEven.ranges,
    bestExpiryPnl,
    bestExpiryPnlUnlimited,
    maxLoss,
    maxLossUnlimited,
    highPriceSlope: slope,
    knots,
    chart: chartPoints(legs, strikes, breakEvens),
  };
}

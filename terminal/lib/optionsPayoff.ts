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
  /** Number root approximations; admitted residual is strictly below half a cent. */
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

interface DecimalValue {
  units: bigint;
  exponent: number;
}

function decimalNumber(value: DecimalValue): number {
  return Number(`${value.units}e${value.exponent}`);
}

function compareDecimals(a: DecimalValue, b: DecimalValue): number {
  const exponent = Math.min(a.exponent, b.exponent);
  const difference = a.units * BigInt(10) ** BigInt(a.exponent - exponent)
    - b.units * BigInt(10) ** BigInt(b.exponent - exponent);
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

function roundMoney(value: DecimalValue | null): number {
  if (!value) return Number.NaN;
  const exponent = value.exponent + 2;
  let cents: bigint;
  if (exponent >= 0) {
    cents = value.units * BigInt(10) ** BigInt(exponent);
  } else {
    const divisor = BigInt(10) ** BigInt(-exponent);
    cents = value.units / divisor;
    const twiceRemainder = (value.units % divisor) * BigInt(2);
    // Preserve Math.round's tie-to-positive-infinity policy, in decimal
    // arithmetic. Converting to Number before this step can move a cent tie.
    if (twiceRemainder >= divisor) cents += BigInt(1);
    else if (twiceRemainder < -divisor) cents -= BigInt(1);
  }
  const rounded = Number(`${cents}e-2`);
  if (!finite(rounded)) return Number.NaN;
  return rounded === 0 ? 0 : rounded;
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

/** Exact base-10 components of an admitted JavaScript input number. */
function decimalParts(value: number): DecimalValue {
  const [mantissa, power = "0"] = String(value).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  return { units: BigInt(whole + fraction), exponent: Number(power) - fraction.length };
}

// Sum the admitted decimal inputs before converting to binary floating point. This
// preserves exact cancellation without a tolerance that would erase small cashflows.
function exactPayoff(legs: readonly PayoffLegInput[], underlyingPrice: number, includeIntrinsic = true): DecimalValue | null {
  if (!finite(underlyingPrice) || underlyingPrice < 0) return null;
  if (legs.some((leg, i) => validateLeg(leg, i).length > 0)) return null;
  const values = [underlyingPrice, ...legs.flatMap((leg) => [leg.strike, leg.premium])].map(decimalParts);
  const exponent = Math.min(...values.map((value) => value.exponent));
  const scaled = values.map((value) => value.units * BigInt(10) ** BigInt(value.exponent - exponent));
  const price = scaled[0];
  const zero = BigInt(0);
  const asNumber = (units: bigint) => Number(`${units}e${exponent}`);
  let total = zero;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const strike = scaled[1 + i * 2];
    const premium = scaled[2 + i * 2];
    const difference = leg.right === "C" ? price - strike : strike - price;
    const intrinsic = includeIntrinsic && difference > zero ? difference : zero;
    const direction = BigInt(leg.side === "long" ? 1 : -1);
    const value = direction * (intrinsic - premium) * BigInt(leg.quantity) * BigInt(OPTION_CONTRACT_MULTIPLIER);
    if (!finite(asNumber(value))) return null;
    total += value;
  }
  const result = asNumber(total);
  if (!finite(result) || (total !== zero && result === 0)) return null;
  return { units: total, exponent };
}

function rawPayoff(legs: readonly PayoffLegInput[], underlyingPrice: number): number {
  const value = exactPayoff(legs, underlyingPrice);
  return value ? decimalNumber(value) : Number.NaN;
}

export function payoffLegAtExpiry(leg: PayoffLegInput, underlyingPrice: number): number {
  return roundMoney(exactPayoff([leg], underlyingPrice));
}

export function payoffAtExpiry(legs: readonly PayoffLegInput[], underlyingPrice: number): number {
  return roundMoney(exactPayoff(legs, underlyingPrice));
}

export function entryCashflow(legs: readonly PayoffLegInput[]): number {
  return roundMoney(exactPayoff(legs, 0, false));
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function breakEvenSet(legs: readonly PayoffLegInput[], strikes: number[]): {
  roots: number[];
  ranges: BreakEvenRange[];
} | null {
  if (!legs.length) return { roots: [], ranges: [] };
  const knots = uniqueSorted([0, ...strikes]);
  const roots: number[] = [];
  const ranges: BreakEvenRange[] = [];
  const zero = (v: number) => v === 0;

  // Root coordinates remain Numbers. After conversion, require the returned
  // coordinate's exact-decimal payoff to be strictly inside the half-cent
  // display cell around zero. This is an admission check, never a root-merging
  // or zero-range tolerance. Exact knot/range classification remains separate.
  const faithfulRoot = (price: number) => {
    const residual = exactPayoff(legs, price);
    if (!residual) return false;
    return compareDecimals({
      units: residual.units < BigInt(0) ? -residual.units : residual.units,
      exponent: residual.exponent,
    }, { units: BigInt(5), exponent: -3 }) < 0;
  };

  const addRoot = (v: number) => {
    if (!finite(v) || v < 0) return;
    if (!roots.includes(v)) roots.push(v);
  };
  const addRange = (from: number, to: number | null) => {
    const next = { from, to };
    const last = ranges[ranges.length - 1];
    if (last && last.to != null && last.to === next.from) {
      last.to = next.to;
      return;
    }
    ranges.push(next);
  };

  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    const ya = rawPayoff(legs, a);
    const yb = rawPayoff(legs, b);
    if (!finite(ya) || !finite(yb)) return null;
    if (zero(ya) && zero(yb)) {
      addRange(a, b);
      continue;
    }
    if (zero(ya)) addRoot(a);
    if (zero(yb)) addRoot(b);
    if ((ya < 0 && yb > 0) || (ya > 0 && yb < 0)) {
      // The affine slope is an exact, bounded integer. Do not form an
      // endpoint-P/L ratio and then multiply by interval width: that ratio
      // can underflow even when the resulting displacement is representable.
      const slope = legs.reduce((total, leg) => {
        const intrinsicSlope = leg.right === "C"
          ? (a >= leg.strike ? 1 : 0) : (a < leg.strike ? -1 : 0);
        const direction = leg.side === "long" ? 1 : -1;
        return total + intrinsicSlope * direction * leg.quantity * OPTION_CONTRACT_MULTIPLIER;
      }, 0);
      // Solve from the closer endpoint to preserve a small displacement.
      const root = Math.abs(ya) <= Math.abs(yb)
        ? a - ya / slope : b - yb / slope;
      if (slope === 0 || !finite(root) || root <= a || root >= b || !faithfulRoot(root)) return null;
      addRoot(root);
    }
  }

  const last = knots[knots.length - 1] ?? 0;
  const yLast = rawPayoff(legs, last);
  const slope = highPriceSlope(legs);
  if (!finite(yLast) || !finite(slope)) return null;
  if (slope !== 0 && zero(yLast)) {
    addRoot(last);
  } else if ((slope > 0 && yLast < 0) || (slope < 0 && yLast > 0)) {
    // Opposite signs prove the mathematical root is in this tail. Extrapolated
    // roots left of the tail are irrelevant and must not trigger refusal.
    const root = last - yLast / slope;
    if (!finite(root) || root <= last || !faithfulRoot(root)) return null;
    addRoot(root);
  } else if (slope === 0 && zero(yLast)) {
    addRange(last, null);
  }

  const pointRoots = roots
    .filter((root) => !ranges.some((range) => root >= range.from && (range.to == null || root <= range.to)))
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
  return [min, Math.max(max, min + 10)];
}

function chartPoints(legs: readonly PayoffLegInput[], strikes: number[], breakEvens: number[]): PayoffPoint[] {
  const [min, max] = chartDomain(strikes, breakEvens);
  const base = Array.from({ length: 81 }, (_, i) => min + ((max - min) * i) / 80);
  if (!base.every(finite)) return [];
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
  const exactKnots = knotsX.map((price) => ({ price, pnl: exactPayoff(legs, price) }));
  if (exactKnots.some((point) => point.pnl === null)) {
    errors.push("calculation exceeds the supported numeric range");
    return empty;
  }
  const knotValues = exactKnots.map((point) => point.pnl!);
  const knots = exactKnots.map(({ price, pnl }) => ({ price, pnl: roundMoney(pnl) }));
  const slope = highPriceSlope(legs);
  const bestExpiryPnlUnlimited = slope > 1e-12;
  const maxLossUnlimited = slope < -1e-12;
  const knotPnls = knotValues.map(decimalNumber);
  const bestKnot = knotValues.reduce((a, b) => compareDecimals(a, b) >= 0 ? a : b);
  const worstKnot = knotValues.reduce((a, b) => compareDecimals(a, b) <= 0 ? a : b);
  const bestExpiryPnl = bestExpiryPnlUnlimited ? null : roundMoney(bestKnot);
  const maxLoss = maxLossUnlimited ? null : roundMoney({
    units: worstKnot.units < BigInt(0) ? -worstKnot.units : BigInt(0),
    exponent: worstKnot.exponent,
  });
  const breakEven = breakEvenSet(legs, strikes);
  const breakEvens = breakEven?.roots ?? [];
  const cashflow = entryCashflow(legs);
  const domain = chartDomain(strikes, breakEvens);
  const chart = domain.every(finite) ? chartPoints(legs, strikes, breakEvens) : [];
  const amounts = [cashflow, slope, ...knotPnls, ...knots.map((p) => p.pnl)];
  if (bestExpiryPnl != null) amounts.push(bestExpiryPnl);
  if (maxLoss != null) amounts.push(maxLoss);
  if (!breakEven || !amounts.every(finite) || !domain.every(finite) || chart.length < 2
    || chart.some((p) => !finite(p.price) || !finite(p.pnl))) {
    errors.push("calculation exceeds the supported numeric range");
    return empty;
  }

  return {
    valid: true,
    errors: [],
    legs,
    contractMultiplier: OPTION_CONTRACT_MULTIPLIER,
    entryCashflow: cashflow,
    breakEvens,
    breakEvenRanges: breakEven.ranges,
    bestExpiryPnl,
    bestExpiryPnlUnlimited,
    maxLoss,
    maxLossUnlimited,
    highPriceSlope: slope,
    knots,
    chart,
  };
}

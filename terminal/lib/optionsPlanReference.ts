/** Exact-decimal expiry reference only. No pre-expiry valuation, fill or persistence. */
export type ReferenceLeg = {
  underlying: string;
  expiry: string;
  right: 'call';
  strike: string;
  quantity: number;
  multiplier: 100;
  currency: 'USD';
  deliverable: 'standard_shares';
  exercise: 'american';
  settlement: 'physical';
  bid: string | null;
  ask: string | null;
};
export type ReferencePlan = {
  legs: [ReferenceLeg, ReferenceLeg];
  basis: 'midpoint' | 'natural' | 'custom';
  customDebit?: string;
  /** Total fees for the whole spread, not a silently assumed per-leg amount. */
  fees: string | null;
};
export type ExpiryReference = {
  debitPerShare: string;
  totalDebit: string;
  grossMaxLoss: string;
  grossMaxGain: string;
  breakEven: string;
  netMaxLoss: string | null;
  netMaxGain: string | null;
  netBreakEven: string | null;
  fees: string | null;
};
const SCALE = BigInt(1_000_000);
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const MAX_VALUE = BigInt(1_000_000) * SCALE;
function decimal(value: unknown, places = 4): bigint {
  if (typeof value !== 'string' || !new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${places}})?$`).test(value)) {
    throw new Error('invalid_decimal');
  }
  const [whole, fraction = ''] = value.split('.');
  const parsed = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  if (parsed > MAX_VALUE) throw new Error('out_of_range');
  return parsed;
}
function text(value: bigint): string {
  const sign = value < ZERO ? '-' : '';
  const absolute = value < ZERO ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function checked(plan: ReferencePlan) {
  if (!plan || !Array.isArray(plan.legs) || plan.legs.length !== 2) throw new Error('two_legs_required');
  const [long, short] = plan.legs;
  if (!long || !short || !long.underlying || long.underlying !== short.underlying
    || long.expiry !== short.expiry || !validDate(long.expiry)) throw new Error('identity_mismatch');
  for (const leg of plan.legs) {
    if (leg.right !== 'call' || leg.multiplier !== 100 || leg.currency !== 'USD'
      || leg.deliverable !== 'standard_shares' || leg.exercise !== 'american'
      || leg.settlement !== 'physical') throw new Error('unsupported_contract');
  }
  if (!Number.isSafeInteger(long.quantity) || long.quantity < 1 || long.quantity > 10_000
    || short.quantity !== -long.quantity) throw new Error('invalid_quantity');
  const low = decimal(long.strike), high = decimal(short.strike);
  if (low <= ZERO || high <= low) throw new Error('invalid_strikes');
  const quotes = plan.legs.map((leg) => {
    if (leg.bid === null || leg.ask === null) throw new Error('quote_unavailable');
    const bid = decimal(leg.bid), ask = decimal(leg.ask);
    if (ask < bid) throw new Error('crossed_quote');
    return { bid, ask };
  });
  const [l, s] = quotes;
  let debit: bigint;
  if (plan.basis === 'midpoint') debit = (l.bid + l.ask - s.bid - s.ask) / BigInt(2);
  else if (plan.basis === 'natural') debit = l.ask - s.bid;
  else if (plan.basis === 'custom') debit = decimal(plan.customDebit);
  else throw new Error('invalid_basis');
  if (debit <= ZERO || debit >= high - low) throw new Error('debit_outside_spread');
  const units = BigInt(long.quantity) * HUNDRED;
  const fees = plan.fees === null ? null : decimal(plan.fees);
  return { low, high, debit, units, fees };
}
export function expiryReference(plan: ReferencePlan): ExpiryReference {
  const { low, high, debit, units, fees } = checked(plan);
  const total = debit * units, gain = (high - low - debit) * units;
  // Fractional microdollar break-even is not rounded into an apparently exact value.
  const netBreakEven = fees === null || fees > gain || fees % units !== ZERO
    ? null : text(low + debit + fees / units);
  return {
    debitPerShare: text(debit), totalDebit: text(total),
    grossMaxLoss: text(total), grossMaxGain: text(gain), breakEven: text(low + debit),
    netMaxLoss: fees === null ? null : text(total + fees),
    netMaxGain: fees === null ? null : text(gain - fees),
    netBreakEven, fees: fees === null ? null : text(fees),
  };
}
export function expiryPnl(plan: ReferencePlan, underlyingPrice: string): { gross: string; net: string | null } {
  const { low, high, debit, units, fees } = checked(plan);
  const spot = decimal(underlyingPrice, 6);
  const intrinsic = spot <= low ? ZERO : spot >= high ? high - low : spot - low;
  const gross = (intrinsic - debit) * units;
  return { gross: text(gross), net: fees === null ? null : text(gross - fees) };
}
export function shockedSpot(base: string, percent: number): string {
  if (!Number.isInteger(percent) || percent < -100 || percent > 100) throw new Error('invalid_shock');
  // Four-decimal input times integer percent remains exact at six decimals.
  return text(decimal(base) * BigInt(100 + percent) / HUNDRED);
}
export function shiftedIv(basePercent: string, percentagePoints: number): string {
  if (!Number.isInteger(percentagePoints) || Math.abs(percentagePoints) > 100) throw new Error('invalid_iv_shift');
  const shifted = decimal(basePercent) + BigInt(percentagePoints) * SCALE;
  if (shifted <= ZERO) throw new Error('nonpositive_iv');
  return text(shifted);
}

/** Deliberately synthetic. Dates are labels; no resolved expiry/valuation instant is asserted. */
export function syntheticPlan(): ReferencePlan {
  const common = { underlying: 'NVDA', expiry: '2026-10-16', right: 'call' as const,
    multiplier: 100 as const, currency: 'USD' as const, deliverable: 'standard_shares' as const,
    exercise: 'american' as const, settlement: 'physical' as const };
  return { legs: [
    { ...common, strike: '185', quantity: 1, bid: '5.20', ask: '5.30' },
    { ...common, strike: '190', quantity: -1, bid: '3.20', ask: '3.30' },
  ], basis: 'midpoint', fees: null };
}

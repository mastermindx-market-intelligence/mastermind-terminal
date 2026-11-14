import { finite, finiteProduct, nativePrice, priceCurrency, type PriceObservation } from "./portfolioMoney";

export type InstitutionHolding = {
  account: string;
  name: string;
  type?: string | null;
  symbol: string | null;
  price: number | null;
  value: number | null;
  currency: string | null;
  asOf: string | null;
  syncedAt: string;
};
type Lot = { shares: number | null; brokerage?: InstitutionHolding };

function canMarkFromShareQuote(lot: Lot) {
  const holding = lot.brokerage;
  return !!holding?.symbol && ["equity","etf","mutual fund"].includes(holding.type ?? "") &&
    finite(holding.value) && finite(holding.price) && finite(lot.shares) &&
    Math.abs(lot.shares * holding.price - holding.value) < 0.011;
}

/** Institution value and unit price can have different multipliers, particularly for options and bonds. */
export function positionPrice(lot: Lot, quote: PriceObservation, fallback: PriceObservation) {
  const holding = lot.brokerage;
  if (!holding) return nativePrice(quote, fallback);
  const currency = priceCurrency(holding.currency);
  const live = canMarkFromShareQuote(lot) ? nativePrice(quote, null) : null;
  if (live && currency && live.currency === currency) return live;
  return currency && finite(holding.price) ? { last: holding.price, currency, chg: null } : null;
}

export function holdingValue(lot: Lot, last: number | null, unit?: unknown): number | null {
  const holding = lot.brokerage;
  if (holding && priceCurrency(holding.currency) && finite(holding.value) &&
      (!canMarkFromShareQuote(lot) || !finite(last) || unit !== holding.currency)) return holding.value;
  return priceCurrency(unit) ? finiteProduct(lot.shares, last) : null;
}

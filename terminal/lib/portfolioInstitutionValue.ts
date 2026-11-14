import { finite, finiteProduct, nativePrice, priceCurrency, type PriceObservation } from "./portfolioMoney";

export type InstitutionHolding = {
  account: string;
  costBasis?: number | null;
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

/** A reported aggregate cost can supply an average entry only on a known per-share instrument. */
export function averageInstitutionCost(item: {symbol: string | null; type: string | null; quantity: number; costBasis?: number | null; currency: string | null}) {
  if (!item.symbol || !["equity", "etf", "mutual fund"].includes(item.type ?? "") ||
      !priceCurrency(item.currency) || !finite(item.costBasis) || item.costBasis < 0 || item.quantity <= 0) return null;
  const average = item.costBasis / item.quantity;
  return finite(average) ? average : null;
}

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
  if (holding && !canMarkFromShareQuote(lot)) return null;
  return priceCurrency(unit) ? finiteProduct(lot.shares, last) : null;
}

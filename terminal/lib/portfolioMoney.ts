// Monetary units are explicit source data. Never derive a historical unit from
// a ticker, market, current quote, or the user's reporting preference.
const currencies = new Set(Intl.supportedValuesOf("currency"));
currencies.delete("XXX"); currencies.delete("XTS");

/** Exact ISO code only: GBp (pence) must not silently become GBP (pounds). */
export function priceCurrency(value: unknown): string | null {
  return typeof value === "string" && currencies.has(value) ? value : null;
}

export type PriceObservation = { last?: unknown; chg?: unknown; currency?: unknown } | null | undefined;
export type NativePrice = { last: number; currency: string | null; chg: number | null };
export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function finiteProduct(a: unknown, b: unknown): number | null {
  if (!finite(a) || !finite(b)) return null;
  const value = a * b;
  return finite(value) ? value : null;
}

/** Price and unit come from the SAME selected observation, never a cross-source join. */
export function nativePrice(quote: PriceObservation, fallback: PriceObservation): NativePrice | null {
  const row = finite(quote?.last) ? quote : finite(fallback?.last) ? fallback : null;
  return row ? { last: row.last as number, currency: priceCurrency(row.currency), chg: finite(row.chg) ? row.chg : null } : null;
}

export type MoneyPart = { amount: number; currency: string | null };
export function commonMoney(parts: readonly MoneyPart[]): MoneyPart | null {
  if (!parts.length) return null;
  const currency = parts[0].currency;
  if (!currency || parts.some(part => part.currency !== currency || !finite(part.amount))) return null;
  const amount = parts.reduce((sum, part) => sum + part.amount, 0);
  return finite(amount) ? { amount, currency } : null;
}

export type CostPosition = { shares: number | null; entryPrice: number | null; entryCurrency?: string | null; status: "open" | "closed" };
export type CostGap = "currency_unknown" | "currency_mismatch" | "amount_overflow";

/** The existing positive-cost population, qualified as ONE monetary cohort.
 * A missing/different unit invalidates its weights; it never drops that lot and
 * renormalizes the remaining ones. Shorts/zero/unsized retain the caller's existing policy.
 */
export function positiveCostCohort<T extends CostPosition>(positions: readonly T[]): {
  parts: { position: T; cost: number }[]; money: MoneyPart | null; reason: CostGap | null;
} {
  const parts = positions.flatMap(position => {
    if (position.status !== "open" || !finite(position.shares) || !finite(position.entryPrice)) return [];
    const cost = position.shares * position.entryPrice;
    return cost > 0 ? [{ position, cost }] : [];
  });
  if (!parts.length) return { parts, money: null, reason: null };
  const amounts = parts.map(({ position, cost }) => ({ amount: cost, currency: priceCurrency(position.entryCurrency) }));
  const reason: CostGap | null = amounts.some(part => !finite(part.amount)) ? "amount_overflow"
    : amounts.some(part => !part.currency) ? "currency_unknown"
    : amounts.some(part => part.currency !== amounts[0].currency) ? "currency_mismatch" : null;
  if (reason) return { parts, money: null, reason };
  const money = commonMoney(amounts);
  return { parts, money, reason: money ? null : "amount_overflow" };
}

export const moneyCopy = {
  entryCurrency: { en: "Currency of entry price", zh: "入场价格币种" },
  entryCurrencyHint: { en: "Use a currency code such as USD or HKD. Leave blank if unknown.", zh: "使用 USD、HKD 等币种代码。未知时留空。" },
  unknownCurrency: { en: "Currency not recorded", zh: "未记录币种" },
  unavailableTotals: { en: "Some monetary totals are unavailable because units are missing or differ. No currency conversion has been applied.", zh: "部分金额汇总因币种缺失或不同而不可用，未进行货币换算。" },
} as const;

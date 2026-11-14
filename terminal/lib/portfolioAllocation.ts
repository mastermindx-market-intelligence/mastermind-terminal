import { finite, priceCurrency, type PriceObservation } from "./portfolioMoney";
import { holdingValue, positionPrice, type InstitutionHolding } from "./portfolioInstitutionValue";
import type { Position } from "./portfolio";

export const SAMPLE_LOTS = [
  { ticker: "AAPL", name: "Apple", sector: ["Information technology", "信息技术"], shares: 20, examplePrice: 200 },
  { ticker: "JPM", name: "JPMorgan Chase", sector: ["Financials", "金融"], shares: 15, examplePrice: 200 },
  { ticker: "XOM", name: "Exxon Mobil", sector: ["Energy", "能源"], shares: 20, examplePrice: 100 },
  { ticker: "JNJ", name: "Johnson & Johnson", sector: ["Health care", "医疗保健"], shares: 5, examplePrice: 200 },
] as const;

export type Allocation = { ticker: string; value: number; weight: number; institutionName?: string; unlisted?: boolean };

/** Market-value weights require every open lot, one currency, positive gross value and no shorts. */
export function marketAllocation(positions: readonly (Pick<Position, "ticker" | "shares" | "status"> & {brokerage?: InstitutionHolding})[],
  quotes: Readonly<Record<string, PriceObservation>>, manifest: Readonly<Record<string, PriceObservation>>) {
  const byTicker = new Map<string, number>();
  const institutions = new Map<string, { institutionName: string; unlisted: boolean }>();
  let currency: string | null = null;
  let total = 0;
  for (const p of positions) {
    if (p.status !== "open") continue;
    if (!finite(p.shares) || p.shares < 0) return null;
    if (p.shares === 0) continue;
    const q = positionPrice(p, quotes[p.ticker], manifest[p.ticker]);
    const unit = q?.currency ?? priceCurrency(p.brokerage?.currency);
    if (!unit || (currency && currency !== unit)) return null;
    const value = holdingValue(p, q?.last ?? null, unit);
    if (value === null || value <= 0) return null;
    if (p.brokerage) institutions.set(p.ticker, { institutionName: p.brokerage.name, unlisted: !p.brokerage.symbol });
    currency = unit;
    byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + value);
    total += value;
  }
  if (!currency || !finite(total) || total <= 0) return null;
  const rows: Allocation[] = Array.from(byTicker, ([ticker, value]) => ({ ticker, value, weight: value / total * 100, ...institutions.get(ticker) }));
  rows.sort((a,b) => b.value - a.value || a.ticker.localeCompare(b.ticker));
  return { currency, total, rows };
}

/** Use a complete USD observations set or a fully illustrative example; never blend the two. */
export function exampleAllocation(quotes: Readonly<Record<string, PriceObservation>>) {
  const observed = SAMPLE_LOTS.every(p => finite(quotes[p.ticker]?.last) && Number(quotes[p.ticker]?.last) > 0 && priceCurrency(quotes[p.ticker]?.currency) === "USD");
  const source = observed ? quotes : Object.fromEntries(SAMPLE_LOTS.map(p => [p.ticker, { last: p.examplePrice, currency: "USD" }]));
  const lots = SAMPLE_LOTS.map(p => ({ ...p, status: "open" as const }));
  return { observed, allocation: marketAllocation(lots, source, {})! };
}

export function distanceFromHigh(last: unknown, high: unknown): number | null {
  if (!finite(last) || last <= 0 || !finite(high) || high <= 0) return null;
  const distance = (last / high - 1) * 100;
  return finite(distance) ? distance : null;
}

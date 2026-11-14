import { resolveRegularSessionDisplay, type QuoteDisplayInput } from "./quoteDisplay";
import { isPublicBoatsQuote, type ExtProvenance } from "./extQuoteFreshness";

export type DiscoverQuote = QuoteDisplayInput & {
  regularPrice?: number | null; regularChg?: number | null; ts?: number;
};
export type DiscoverOvernight = ExtProvenance & { extPrice: number; extChg: number | null; extTs: number; extSession: "overnight" };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Same regular-session resolver as Portfolio and Watchlist. Price and change
 * stay in the same lane; a missing current change never borrows an EOD change.
 * A fresh HTTP response is not evidence of a fresh exchange observation.
 */
export function discoverRegularReading(snapshot: { last: number | null; chg: number | null }, quote: DiscoverQuote | null | undefined, now = Date.now()) {
  const resolved = resolveRegularSessionDisplay(quote);
  const price = finite(quote?.regularPrice) && quote.regularPrice > 0 ? quote.regularPrice : resolved.regularPrice;
  const change = finite(quote?.regularChg) ? quote.regularChg : resolved.regularChg;
  if (price == null) return { price: snapshot.last, change: snapshot.chg, kind: "snapshot" as const, observed: null };
  const observed = finite(quote?.ts) && quote.ts > 0 ? quote.ts * 1000 : null;
  const current = observed !== null && now >= observed && now - observed <= 60_000;
  const kind = quote?.basis === "DELAYED_15M" ? "delayed" as const
    : finite(quote?.close) && quote.close > 0 || quote?.basis === "EOD" ? "close" as const
    : current && quote?.live === true ? "live" as const : "quote" as const;
  return { price, change, kind, observed };
}

export function discoverOvernightReading(value: unknown, now = Date.now()): DiscoverOvernight | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !isPublicBoatsQuote(value, now)) return null;
  return value as DiscoverOvernight;
}

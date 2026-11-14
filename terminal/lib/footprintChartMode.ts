/** An exact futures root is required before entering the order-flow tape consumer.
 * Equity candles and index symbols cannot be converted into bid/ask executions. */
export type FootprintPair = "ES" | "NQ";
export type FootprintInterval = 1 | 5;
export type FootprintEligibility =
  | { status: "supported"; pair: FootprintPair; intervalMinutes: FootprintInterval }
  | { status: "unsupported_symbol" }
  | { status: "unsupported_timeframe"; pair: FootprintPair };

export function footprintEligibility(symbol: string, timeframe: string): FootprintEligibility {
  // Never silently map a cash index, equity ticker, or a dated contract to a different
  // contract. The futures owner chooses the actual active contract in its published view.
  const normalized = symbol.trim().toUpperCase();
  if (normalized !== "ES" && normalized !== "NQ") return { status: "unsupported_symbol" };
  const pair = normalized as FootprintPair;
  if (timeframe !== "1m" && timeframe !== "5m")
    return { status: "unsupported_timeframe", pair };
  return { status: "supported", pair, intervalMinutes: timeframe === "1m" ? 1 : 5 };
}

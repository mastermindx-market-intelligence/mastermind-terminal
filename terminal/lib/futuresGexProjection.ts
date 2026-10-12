/**
 * Source-aligned index-options gamma projected onto an equity-index futures axis.
 *
 * This is NOT native CME futures-options gamma, a live data feed, or a chart renderer.
 * The caller supplies time-aligned observed index and named futures-contract prices.
 * The source option strike and unrounded mapped price remain intact for auditing.
 * No price is manufactured when the two clocks, identity or source values fail.
 */
export type FuturesGexPair = "ES" | "NQ";
export type IndexGexRoot = "SPX" | "NDX";

export type FuturesGexQuotePair = {
  pair: FuturesGexPair;
  indexRoot: IndexGexRoot;
  futuresContract: string;
  indexPrice: number;
  futuresPrice: number;
  indexTimestampMs: number;
  futuresTimestampMs: number;
  /** Exchange feed entitlement and freshness must be checked outside this mapper. */
};

export type FuturesGexStrike = {
  strike: number;
  gammaNetMn: number | null;
};

export type FuturesGexProjection = {
  pair: FuturesGexPair;
  indexRoot: IndexGexRoot;
  futuresContract: string;
  basis: number;
  observedAtMs: number;
  skewMs: number;
  mapped: Array<{
    sourceStrike: number;
    futuresPrice: number;
    displayTickPrice: number;
    gammaNetMn: number | null;
  }>;
};

/** The chart must separately enforce provider freshness and commercial display rights. */
export function projectFuturesGex(
  quotes: FuturesGexQuotePair,
  source: readonly FuturesGexStrike[],
  maxClockSkewMs = 5000,
): FuturesGexProjection | null {
  if (!quotes || (quotes.pair === "ES" ? quotes.indexRoot !== "SPX" : quotes.pair === "NQ" ? quotes.indexRoot !== "NDX" : true)) return null;
  // Never allow continuous (=F) symbols: a real contract identity is needed across rolls.
  if (!/^(ES|NQ)[FGHJKMNQUVXZ]\d{1,4}$/.test(quotes.futuresContract) ||
      !quotes.futuresContract.startsWith(quotes.pair)) return null;
  const finite = (n: number) => typeof n === "number" && Number.isFinite(n);
  if (!finite(quotes.indexPrice) || !finite(quotes.futuresPrice) ||
      quotes.indexPrice <= 0 || quotes.futuresPrice <= 0 ||
      !finite(quotes.indexTimestampMs) || !finite(quotes.futuresTimestampMs) ||
      quotes.indexTimestampMs <= 0 || quotes.futuresTimestampMs <= 0 ||
      !finite(maxClockSkewMs) || maxClockSkewMs < 0) return null;
  const skewMs = Math.abs(quotes.indexTimestampMs - quotes.futuresTimestampMs);
  if (skewMs > maxClockSkewMs || !Array.isArray(source)) return null;
  const basis = quotes.futuresPrice - quotes.indexPrice;
  const mapped: FuturesGexProjection["mapped"] = [];
  for (const row of source) {
    if (!row || !finite(row.strike) || row.strike <= 0 ||
        !(row.gammaNetMn === null || finite(row.gammaNetMn))) return null;
    const futuresPrice = row.strike + basis;
    if (!finite(futuresPrice) || futuresPrice <= 0) return null;
    mapped.push({
      sourceStrike: row.strike,
      futuresPrice,
      displayTickPrice: Math.round(futuresPrice / 0.25) * 0.25,
      gammaNetMn: row.gammaNetMn,
    });
  }
  return {
    pair: quotes.pair,
    indexRoot: quotes.indexRoot,
    futuresContract: quotes.futuresContract,
    basis,
    observedAtMs: Math.max(quotes.indexTimestampMs, quotes.futuresTimestampMs),
    skewMs,
    mapped,
  };
}

/**
 * Index-options exposure placed on a named ES/NQ price axis, not native futures gamma.
 * Pure coordinate math: use buildFuturesGexFrame at the source/replay boundary.
 * Exposure remains USD millions per +1% move in the SOURCE INDEX under either mapping.
 * See docs/FUTURES_GEX_ORDERFLOW_RESEARCH_2026-10-12.md for assumptions and sources.
 */
export type FuturesGexPair = "ES" | "NQ";
export type IndexGexRoot = "SPX" | "NDX";
export type FuturesGexMapping = "basis" | "ratio";
export const FUTURES_GEX_UNIT = "usd_millions_per_1pct_index_move" as const;
export type FuturesGexQuotePair = {
  pair: FuturesGexPair; indexRoot: IndexGexRoot; futuresContract: string;
  indexPrice: number; futuresPrice: number;
  indexTimestampMs: number; futuresTimestampMs: number;
};
export type FuturesGexStrike = { strike: number; gammaNetMn: number | null };
export type FuturesGexProjection = {
  pair: FuturesGexPair; indexRoot: IndexGexRoot; futuresContract: string;
  method: FuturesGexMapping; exposureUnit: typeof FUTURES_GEX_UNIT;
  basis: number; ratio: number; observedAtMs: number; skewMs: number;
  indexTimestampMs: number; futuresTimestampMs: number;
  mapped: Array<{ sourceStrike: number; futuresPrice: number;
    displayTickPrice: number; gammaNetMn: number | null }>;
};
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const finiteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export const validClockMs = (v: unknown): v is number =>
  finiteNumber(v) && Number.isSafeInteger(v) && v > 0;
const priceNumber = (v: unknown): v is number =>
  finiteNumber(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER / 4;
/** Syntax only. The frame requires the instrument definition and validity interval too. */
export function isFuturesGexContract(symbol: unknown, pair: unknown): symbol is string {
  return (pair === "ES" || pair === "NQ") && typeof symbol === "string" &&
    /^(ES|NQ)[HMUZ]\d{1,4}$/.test(symbol) && symbol.startsWith(pair);
}
/** Legacy default preserved; new source consumers must explicitly choose the method. */
export function projectFuturesGex(
  quotes: FuturesGexQuotePair,
  source: readonly FuturesGexStrike[],
  maxClockSkewMs = 5000,
  method: FuturesGexMapping = "basis",
): FuturesGexProjection | null {
  if (!isRecord(quotes) ||
      !(quotes.pair === "ES" && quotes.indexRoot === "SPX" ||
        quotes.pair === "NQ" && quotes.indexRoot === "NDX") ||
      !isFuturesGexContract(quotes.futuresContract, quotes.pair) ||
      !priceNumber(quotes.indexPrice) || !priceNumber(quotes.futuresPrice) ||
      !validClockMs(quotes.indexTimestampMs) || !validClockMs(quotes.futuresTimestampMs) ||
      !finiteNumber(maxClockSkewMs) || maxClockSkewMs < 0 ||
      (method !== "basis" && method !== "ratio") || !Array.isArray(source)) return null;
  const skewMs = Math.abs(quotes.indexTimestampMs - quotes.futuresTimestampMs);
  if (skewMs > maxClockSkewMs) return null;
  const basis = quotes.futuresPrice - quotes.indexPrice;
  const ratio = quotes.futuresPrice / quotes.indexPrice;
  if (!finiteNumber(ratio) || ratio <= 0) return null;
  const mapped: FuturesGexProjection["mapped"] = [];
  const seen = new Set<number>();
  for (const row of source) {
    if (!isRecord(row) || !priceNumber(row.strike) || seen.has(row.strike) ||
        !(row.gammaNetMn === null || finiteNumber(row.gammaNetMn))) return null;
    seen.add(row.strike);
    const futuresPrice = method === "ratio" ? row.strike * ratio : row.strike + basis;
    if (!priceNumber(futuresPrice)) return null;
    // Rounding belongs only to the display label, never source identity or calculations.
    const displayTickPrice = Math.round(futuresPrice * 4) / 4;
    if (displayTickPrice <= 0) return null;
    mapped.push({ sourceStrike: row.strike, futuresPrice, displayTickPrice,
      gammaNetMn: row.gammaNetMn });
  }
  return {
    pair: quotes.pair, indexRoot: quotes.indexRoot, futuresContract: quotes.futuresContract,
    method, exposureUnit: FUTURES_GEX_UNIT, basis, ratio,
    indexTimestampMs: quotes.indexTimestampMs, futuresTimestampMs: quotes.futuresTimestampMs,
    observedAtMs: Math.max(quotes.indexTimestampMs, quotes.futuresTimestampMs), skewMs, mapped,
  };
}

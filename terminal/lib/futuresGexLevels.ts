/** Coordinate-only consumer of the incumbent Options Levels owner. No new level model. */
import { deriveOptLevels, type OptLevelKey } from "./optionsLevels";
import { projectFuturesGex, type FuturesGexMapping, type FuturesGexQuotePair } from "./futuresGexProjection";

export type FuturesLevelKey = Extract<OptLevelKey, "call_wall" | "put_wall" | "gamma_flip">;
export type FuturesNamedLevel = {
  key: FuturesLevelKey; sourcePrice: number; futuresPrice: number; displayTickPrice: number;
  /** The source publishes these landmarks for its ALL-expiry book, independent of the bubble lens. */
  expiryScope: "all";
};
export const FUTURES_LEVEL_KEYS: readonly FuturesLevelKey[] = ["call_wall", "put_wall", "gamma_flip"];
export function deriveFuturesNamedLevels(source: unknown, quotes: FuturesGexQuotePair,
  maxClockSkewMs: number, method: FuturesGexMapping): FuturesNamedLevel[] {
  const levels = deriveOptLevels(source, null, quotes.indexRoot).levels.filter(
    (level): level is typeof level & { key: FuturesLevelKey } => FUTURES_LEVEL_KEYS.includes(level.key as FuturesLevelKey));
  // Two roles may legitimately occupy one source price. Project the price once, retain both roles.
  const prices = [...new Set(levels.map(level => level.price))];
  const projection = projectFuturesGex(quotes, prices.map(strike => ({ strike, gammaNetMn: null })), maxClockSkewMs, method);
  if (!projection) return [];
  const mapped = new Map(projection.mapped.map(row => [row.sourceStrike, row]));
  return levels.map(level => {
    const row = mapped.get(level.price)!;
    return { key: level.key, sourcePrice: level.price, futuresPrice: row.futuresPrice,
      displayTickPrice: row.displayTickPrice, expiryScope: "all" };
  });
}

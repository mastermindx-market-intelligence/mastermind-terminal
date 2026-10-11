/**
 * heatmapCapitalization.ts — pure market-cap sizing + coverage helpers.
 *
 * HONESTY DOCTRINE (real-cap mode):
 *   - Source: ingest/build_universe.py enriches the manifest `mcap` field from
 *     the Polygon reference cache key `market_cap_usd` (USD).
 *   - Financial as-of for market cap is UNKNOWN. Never infer a market-cap date
 *     from filesystem mtime, quote timestamps, or manifest as_of.
 *   - Legacy SizingMode "cap" stays the price×volume proxy and is never
 *     reinterpreted by these helpers.
 *   - New SizingMode "marketCap" uses only finite positive source mcap (USD),
 *     independent of volume. No arbitrary positive floor for unknown/zero/
 *     NaN/Infinity — those are disclosed, not fabricated into economic area.
 *   - Newcap has a named cached-reference limitation (see MARKET_CAP_SOURCE).
 */

/** Named provenance for real market-cap sizing (UI disclosure must quote these names). */
export const MARKET_CAP_SOURCE = {
  /** Manifest / HeatmapTile field carrying USD market cap. */
  manifestField: "mcap",
  /** Upstream Polygon reference-cache key written by ingest/build_universe.py. */
  referenceKey: "market_cap_usd",
  /** Read-only ingest module that performs the enrichment. */
  ingestModule: "ingest/build_universe.py",
  /** Reference cache the key is read from. */
  cache: "Polygon reference cache",
  /** Unit of the stored value. */
  unit: "USD",
  /** Financial as-of is unknown — deliberately null, never inferred. */
  financialAsOf: null as null,
  /** Named limitation of the new-cap source. */
  limitation: "named cached-reference limitation",
  /** Provenance stamp written onto HeatmapTile when the mcap key was present. */
  tileProvenance: "polygon_ref_market_cap_usd",
} as const;

export type CapStatus = "ok" | "missing" | "invalid";

export interface CapValue {
  status: CapStatus;
  /** USD market cap when status === "ok"; otherwise undefined. */
  value?: number;
}

/**
 * Classify a source mcap value.
 *   - undefined / null → "missing" (key absent — coverage counts it missing)
 *   - present but not finite > 0 → "invalid" (0, negative, NaN, ±Infinity, non-number)
 *   - finite > 0 → "ok"
 * No positive floor is applied anywhere on the invalid/missing paths.
 */
export function classifyMarketCap(raw: unknown): CapValue {
  if (raw === undefined || raw === null) return { status: "missing" };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return { status: "invalid" };
  }
  return { status: "ok", value: raw };
}

/** True when the source mcap is a finite positive USD number (usable for real-cap sizing). */
export function hasUsableMarketCap(raw: unknown): boolean {
  return classifyMarketCap(raw).status === "ok";
}

/**
 * Real-cap sizing value (marketCap mode).
 * Returns the finite positive source mcap in USD, else 0 (missing/invalid).
 * 0 means "no fabricated economic area" — the caller discloses those names.
 */
export function marketCapSizingValue(raw: unknown): number {
  const c = classifyMarketCap(raw);
  return c.status === "ok" ? (c.value as number) : 0;
}

/**
 * Legacy "cap" proxy = price × volume, floor 1.
 * Preserved bit-for-bit vs the pre-A15 Treemap path so old saved views are
 * never silently reinterpreted. Independent of source mcap.
 */
export function legacyCapProxyValue(price: number | undefined, vol: number | undefined): number {
  return Math.max((price ?? 0) * (vol ?? 0), 1);
}

/** Cap-coverage counters for a tile population. */
export interface CapCoverage {
  /** Population size used as the coverage denominator (original scoped universe). */
  total: number;
  /** Names with finite positive source mcap. */
  withCap: number;
  /** Names whose mcap key is absent. */
  missingCap: number;
  /** Names whose mcap key is present but not finite positive. */
  invalidCap: number;
  /** Tickers with missing mcap (disclosed list, not area-sized). */
  missingTickers: string[];
  /** Tickers with invalid mcap (disclosed list, not area-sized). */
  invalidTickers: string[];
}

/**
 * Coverage of usable source mcap against `tiles`.
 * Pass the ORIGINAL scoped universe (pre render-pruning) so coverage is not
 * rewritten by the ~500-tile render cap.
 */
export function capCoverage(
  tiles: ReadonlyArray<{ ticker: string; mcap?: number }>
): CapCoverage {
  let withCap = 0;
  let missingCap = 0;
  let invalidCap = 0;
  const missingTickers: string[] = [];
  const invalidTickers: string[] = [];
  for (const t of tiles) {
    const c = classifyMarketCap(t.mcap);
    if (c.status === "ok") {
      withCap++;
    } else if (c.status === "missing") {
      missingCap++;
      missingTickers.push(t.ticker);
    } else {
      invalidCap++;
      invalidTickers.push(t.ticker);
    }
  }
  return {
    total: tiles.length,
    withCap,
    missingCap,
    invalidCap,
    missingTickers,
    invalidTickers,
  };
}

/**
 * Partition tiles for marketCap layout.
 *   - usable → finite positive source mcap (area-sized by real cap)
 *   - excluded → missing/invalid (kept visible via disclosure list; never
 *     given fabricated area inside the cap-weighted treemap)
 */
export function partitionMarketCapTiles<T extends { ticker: string; mcap?: number }>(
  tiles: ReadonlyArray<T>
): { usable: T[]; excluded: T[] } {
  const usable: T[] = [];
  const excluded: T[] = [];
  for (const t of tiles) {
    if (hasUsableMarketCap(t.mcap)) usable.push(t);
    else excluded.push(t);
  }
  return { usable, excluded };
}

/**
 * Shared types for the Heatmap surface.
 */

// ─── Manifest (from public/data/manifest.json) ────────────────────────────────

export interface ManifestSymbol {
  name: string;
  sec: string;        // "Equities" | "Crypto"
  col?: string;
  last: number;
  chg: number;        // 1D % change (real, nightly Polygon)
  open?: number;
  high?: number;
  low?: number;
  vol?: number;
  hi52?: number;
  lo52?: number;
  verdict?: string;
  wr?: number;
  pf?: number;
  cagr?: number;
  regimeBull?: boolean;
  /**
   * USD market capitalization when the nightly universe already carries it.
   * Financial as-of is unknown — never inferred from mtime/quote timestamps.
   * Only finite positive values are usable for cached USD-cap sizing;
   * missing/invalid names are disclosed separately (no fabricated area).
   */
  mcap?: number;
}

export interface ManifestPayload {
  as_of: string;
  source: string;
  symbols: Record<string, ManifestSymbol>;
}

// ─── Flow index (from /api/flow?f=flow_idx) ───────────────────────────────────

export interface FlowIdxRow {
  key: string;              // ticker
  asof: string;
  spot?: number;
  net_premium_mn?: number;  // magnitude reliable; direction soft
  tone?: "neg" | "neutral" | "pos";    // reliable when positioning_reliable
  net_doi?: number;         // ΔOI-derived, 348/368
  doi_pc?: number;          // 315/368
  zerodte_share?: number;   // 368/368
  fresh_contracts?: number; // 348/368
  positioning_lean?: string; // 87/368, sparse
  signed_pc?: number;        // 347/368, soft direction
  verdict?: string;          // 368/368
}

export interface FlowIdxPayload {
  as_of?: string;
  asof?: string;
  rows?: FlowIdxRow[];
  // Also accept flat record format
  [key: string]: unknown;
}

// ─── Unified tile data ────────────────────────────────────────────────────────

export type GicsSector =
  | "Information Technology"
  | "Communication Services"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Financials"
  | "Health Care"
  | "Energy"
  | "Industrials"
  | "Materials"
  | "Utilities"
  | "Real Estate"
  | "Crypto"
  | "ETF"
  | "Other";

export interface HeatmapTile {
  ticker: string;
  name: string;
  sector: GicsSector;
  // Price fields
  price: number;
  chg1d: number;          // real, 1D %
  vol?: number;
  hi52?: number;
  lo52?: number;
  // Flow fields (optional — missing = price-only tile)
  flowAsof?: string;
  netPremiumMn?: number;  // magnitude only
  tone?: "neg" | "neutral" | "pos";
  netDoi?: number;
  doiPc?: number;
  zerodte?: number;
  freshContracts?: number;
  posLean?: string;       // sparse, soft
  signedPc?: number;      // soft direction
  verdict?: string;
  // Computed
  hasFlow: boolean;
  callSharePct?: number;  // derived from doiPc when available
  /**
   * Source USD market capitalization as received from the universe payload
   * (raw — may be absent, zero, NaN, or non-finite). Absent key = missing;
   * present but not finite positive = invalid. Both are disclosed, never
   * floored into fake area. See terminal/lib/heatmapCapitalization.ts.
   */
  mcap?: number;
  /**
   * Provenance stamp written when the universe payload carried a capitalization
   * value. Cached reference — not a live quote timestamp.
   */
  mcapSource?: string;
}

// ─── Layer / view / sizing ────────────────────────────────────────────────────

export type Layer   = "price" | "flow";
export type View    = "map" | "table";
/**
 * Sizing modes:
 *   - "equal"     → area = 1
 *   - "cap"       → LEGACY dollar-volume proxy (price × vol). Never reinterpreted.
 *   - "premium"   → |netPremiumMn| on the flow layer
 *   - "marketCap" → cached USD market cap (finite positive source value only).
 *     Distinct from "cap": independent of volume; missing/invalid disclosed.
 */
export type SizingMode = "equal" | "cap" | "premium" | "marketCap";
export type Timeframe  = "1D" | "1W" | "1M" | "YTD";

// ─── Treemap layout node ──────────────────────────────────────────────────────

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapNode extends LayoutRect {
  tile: HeatmapTile;
}

export interface SectorBlock extends LayoutRect {
  sector: GicsSector;
  nodes: TreemapNode[];
}

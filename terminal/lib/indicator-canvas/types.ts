// IndicatorCanvas — frozen contract for premium suite modules and their renderer.
//
// Program docs: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md (§5-§8) and
// docs/PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md (per-module visual specs).
//
// Design in one paragraph: a suite module is a PURE function over bars + settings that returns a
// declarative draw-list (Prim[]) plus optional per-bar candle repaints, tooltip payloads and signal
// events. One generic renderer (render.ts) draws every module's prims into the chart's existing
// indicator SVG overlay (z-index 2) each frame; ChartPanel owns coordinate mapping and passes a
// CoordMapper. Modules never touch the DOM, never read CSS, never import chart libraries — that is
// what keeps 40+ modules maintainable and testable.
//
// Coordinates: prims address the x-axis by BAR INDEX into the bars array handed to the module
// (ChartPanel renders that same array, so array index === LWC logical index; the renderer maps via
// timeScale().logicalToCoordinate which stays valid off-screen — required for zones that start
// left of the viewport). "right" = viewport right edge. Y is plain price.
//
// Colors: modules MUST use ctx.colors.* (resolved from CSS tokens by the host) — never hex
// literals. Directional elements use up/down (these flip under html[data-updown="east"]);
// aggressor-side volume uses flowBuy/flowSell (a distinct non-flipping family, like health
// tokens); accents/warn/text come through as-is. See README.md for the doctrine rules.

// ---------------------------------------------------------------------------- bars & module input

export interface SuiteBar {
  t: number; // numeric epoch seconds (host converts ChartPanel's string|number times once)
  o: number; h: number; l: number; c: number; v: number;
}

export interface SuiteColors {
  up: string;       // bullish/direction-up   (token --up; flips east)
  down: string;     // bearish/direction-down (token --down; flips east)
  flowBuy: string;  // aggressive-buy volume  (token --flow-buy; never flips)
  flowSell: string; // aggressive-sell volume (token --flow-sell; never flips)
  warn: string;     // exhaustion/caution     (token --warn; never flips)
  brand: string;    // accent                 (token --brand-2)
  text: string;     // primary text           (token --text)
  muted: string;    // secondary text         (token --muted)
  neutral: string;  // structural gray        (token --text-dim)
}

export interface ModuleCtx {
  bars: SuiteBar[];
  tf: string;              // active timeframe key (e.g. "1D", "5m")
  symbol: string;
  isIntraday: boolean;
  s: Record<string, any>;  // this module's settings, UNPREFIXED keys, defaults merged
  /** The WHOLE suite's flat params (module-prefixed keys, defaults merged). Satellite modules that
   *  re-derive another module's series (signals over the engine's curve, divergences over the wave)
   *  MUST read the producer's settings from here — never re-assume its defaults. */
  suite: Record<string, any>;
  colors: SuiteColors;
  lang: "en" | "zh";
}

// ---------------------------------------------------------------------------------- draw-list prims

export type XRef = number | "right"; // bar index, or viewport right edge

interface PrimBase {
  id: string;          // stable within a compute pass (used for tooltip linkage / debugging)
  z?: number;          // draw order within the module output (default 0; higher = on top)
  minPxPerBar?: number; // optional density gate: hide when barWidth(px) < this (declutter zoom-out)
}

export interface ZonePrim extends PrimBase {
  kind: "zone";
  i1: number; i2: XRef;   // x-range (bar indices)
  p1: number; p2: number; // price range (any order)
  fill: string; fillAlpha?: number;          // default alpha 0.10, renderer clamps to ≤0.18
  stroke?: string; strokeW?: number; dash?: string;
  edges?: Array<"top" | "bottom" | "left" | "right">; // stroke only these edges (omit = full rect)
  radius?: number;
  midline?: { color: string; dash?: string }; // horizontal line at (p1+p2)/2 across the zone
}

export interface LinePrim extends PrimBase {
  kind: "line";
  a: { i: number; p: number };
  b: { i: XRef; p: number };
  color: string; w?: number; dash?: string; alpha?: number;
}

export interface PolyPrim extends PrimBase { // zigzag / connected path
  kind: "poly";
  pts: Array<{ i: number; p: number }>;
  color: string; w?: number; dash?: string; alpha?: number;
}

export interface CloudPrim extends PrimBase { // filled band between two point series
  kind: "cloud";
  upper: Array<{ i: number; p: number }>;
  lower: Array<{ i: number; p: number }>;   // same length as upper
  segColors?: string[];                      // per-segment fill color (length = upper.length - 1)
  fillAlpha?: number;                        // default 0.12
}

export interface GradLinePrim extends PrimBase { // per-segment colored polyline (state-colored waves)
  kind: "gradline";
  pts: Array<{ i: number; p: number }>;
  colors: string[]; // per-point; segment n uses colors[n]
  w?: number;
  dash?: string;    // optional stroke-dasharray (e.g. dotted midlines)
  alpha?: number;
}

export type LabelStyle = "pill" | "tag" | "bare" | "chip";
export interface LabelPrim extends PrimBase {
  kind: "label";
  i: XRef; p: number;
  text: string;
  place: "above" | "below" | "left" | "right" | "center";
  style: LabelStyle;   // pill = rounded bg + optional pointer; tag = tinted bg (fin-tag formula);
                       // bare = text only; chip = small stat chip (bg + border)
  color: string; bg?: string;
  fs?: number;         // px; default 10 (--fs-micro); renderer clamps 8..20
  bold?: boolean;
  dxPx?: number; dyPx?: number;
  pointer?: boolean;   // pill only: small triangle pointing at (i,p)
  tooltipId?: string;
}

export type MarkerShape =
  | "diamond" | "tri-up" | "tri-down" | "circle" | "square" | "x" | "arrow-up" | "arrow-down"
  | "triple-lines"; // three short stacked horizontal lines (oscillator buy/sell convention)
export interface MarkerPrim extends PrimBase {
  kind: "marker";
  i: number; p: number;
  shape: MarkerShape;
  size?: number;       // px half-extent; default 5
  fill: string; stroke?: string; alpha?: number;
  tooltipId?: string;
}

export interface ProfilePrim extends PrimBase { // horizontal volume-at-price bars
  kind: "profile";
  side: "right" | "box";                    // right = anchored to viewport right edge
  box?: { i1: number; i2: XRef; p1: number; p2: number }; // required when side="box"
  bins: Array<{
    p1: number; p2: number;
    frac: number;                            // 0..1 of max bin (bar length)
    color: string; alpha?: number;
    overlayFrac?: number; overlayColor?: string; // e.g. buy-volume overlay on total
    label?: string;                          // optional per-bin text (e.g. strength %)
  }>;
  maxPx?: number;                            // max bar length in px (default 120)
}

export interface ColumnsPrim extends PrimBase { // vertical bars in y-space (oscillator histograms)
  kind: "columns";
  items: Array<{ i: number; v: number; color: string; alpha?: number }>; // sorted by i ascending
  base?: number;        // bar baseline value (default 0)
  widthFrac?: number;   // bar width as a fraction of barW (default 0.6, clamp 0.1..1)
}

export interface BgShadePrim extends PrimBase { // background column tint (trend background)
  kind: "bgshade";
  i1: number; i2: XRef;
  color: string; alpha: number;              // renderer clamps alpha to ≤0.10
}

export type Prim =
  | ZonePrim | LinePrim | PolyPrim | CloudPrim | GradLinePrim
  | LabelPrim | MarkerPrim | ProfilePrim | BgShadePrim | ColumnsPrim;

// --------------------------------------------------------------------------------- module results

export interface TooltipDef {
  id: string;
  title: string;
  accent?: string; // left swatch color
  rows: Array<{ k: string; v: string; color?: string }>;
}

export interface CandlePaintEntry { i: number; color?: string; borderColor?: string; wickColor?: string }

// ------------------------------------------------------------------------------- chart tables (W3)

/** On-chart dashboard table, rendered as positioned DOM by ChartTables.tsx (never SVG/canvas). */
export interface TableSpec {
  id: string;                       // stable per module (one table per id; last writer wins)
  pos: "tl" | "tr" | "bl" | "br";   // corner anchor within the price pane area
  title?: string;
  compact?: boolean;                // tighter paddings + smaller type
  columns: Array<{ key: string; label?: string; num?: boolean }>;
  rows: Array<{
    label: string;                  // left header cell
    cells: Array<{
      text: string;
      color?: string;               // token/text color (design tokens only)
      bg?: string;                  // tint background (renderer applies alpha)
      bold?: boolean;
      fade?: number;                // 0..1 recency fade (0 = fresh/bright)
      tip?: string;                 // title-attr tooltip
    }>;
  }>;
  footnote?: string;                // honest-basis line (e.g. "MTF rows = resampled from chart bars")
}

export interface SuiteEvent {
  type: string;              // e.g. "bos", "choch", "ob_created", "ob_touch", "fvg_retest"
  dir: "bull" | "bear" | "neutral";
  i: number; p?: number;
  strength?: number;         // 0..100 when the module scores it
  label?: string;            // human-readable one-liner
}

export interface ModuleResult {
  prims: Prim[];
  candlePaint?: CandlePaintEntry[];
  tooltips?: TooltipDef[];
  events?: SuiteEvent[];
  tables?: TableSpec[];
}

export type ModuleCompute = (ctx: ModuleCtx) => ModuleResult;

// -------------------------------------------------------------------------------- settings schema

export type SuiteFieldType = "number" | "color" | "bool" | "select" | "size" | "linestyle";
export interface SuiteField {
  key: string;   // UNPREFIXED (host stores as `${moduleKey}.${key}` in indParams[suiteKey])
  label: string; // plain English (existing registry precedent — field labels are not in LEX)
  type: SuiteFieldType;
  min?: number; max?: number; step?: number;              // number
  options?: Array<{ v: string | number; label: string }>; // select
  tip?: string;                                            // tooltip line under the control
  showIf?: { key: string; eq: any };                       // conditional visibility within module
}

/**
 * Module entitlement levels. Mirrors SubscriptionTier (lib/subscriptionTier.ts) by design — the
 * two namespaces are joined by rank comparisons that fail in OPPOSITE directions on a mismatch
 * (the picker fails OPEN, the renderer fails CLOSED), so they must be renamed in one commit.
 *
 * `essential` was called `insider` before the billing rename; the old name is still accepted
 * inbound everywhere a tier can arrive from storage or a cached page, and never written back.
 */
export type SuiteTier = "free" | "essential" | "pro";

/**
 * Tier → the badge/chip TEXT and the CSS modifier suffix.
 *
 * The internal value and the user-facing label stay separate concerns even though they now
 * spell the same word. T2 flipped the VALUE to `essential` and deliberately held the display
 * copy at "Insider"; T3 (this map's `essential` entry, the i18n LEX, and the `.im-tier-*` /
 * `.gp-tier-*` rules keyed off these strings) completed the user-visible rename to "Essential",
 * matching the macro site and Stripe. Chips must keep routing through here rather than
 * interpolating the raw tier: that is what made the copy change reviewable instead of a silent
 * side effect of a value rename, and it is what keeps the next display rename one edit.
 *
 * Whatever label lands here also becomes a CSS modifier suffix (`im-tier-${label}`), so a new
 * value needs a matching rule in app/globals.css — pinned in both directions by
 * lib/__tests__/suiteAlerts.test.ts.
 */
export const SUITE_TIER_LABEL: Record<SuiteTier, string> = {
  free: "free",
  essential: "essential",
  pro: "pro",
};

export interface SuiteModuleDef {
  key: string;      // short, e.g. "ms", "ob", "fvg"
  label: string;    // "Market Structure"
  tag: string;      // compact legend tag, e.g. "MS"
  tier: SuiteTier;  // minimum tier that unlocks the module
  defaultOn: boolean;
  fields: SuiteField[];
  defaults: Record<string, any>; // UNPREFIXED keys
  compute: ModuleCompute;
}

/**
 * A module's IDENTITY and settings schema, with no computation attached.
 *
 * This is the half of `SuiteModuleDef` that the picker, the legend, the settings dialog and
 * TerminalShell's boot path actually need. It exists because the other half — `compute` — is
 * hundreds of lines per module, and declaring both in one file meant reading a module's label
 * dragged its entire implementation into the eager bundle (~562 KB into /terminal before a
 * single premium suite was active).
 *
 * The metadata literal lives in `<module>.meta.ts` and is the SINGLE canonical definition of a
 * module's identity, tier, fields and defaults. The implementation spreads it and adds `compute`,
 * so there is exactly one truth and the two can never drift.
 */
export type SuiteModuleMeta = Omit<SuiteModuleDef, "compute">;

/** A suite's identity and module metadata, with no computation reachable from it. */
export interface SuiteMetaDef extends Omit<SuiteDef, "modules"> {
  modules: SuiteModuleMeta[];
}

export interface SuiteDef {
  key: string;      // e.g. "structure" — also the mm.inds key and indParams key
  label: string;    // "Structure Core"
  tag: string;      // "SC"
  tkey?: string;    // LEX key for the localized suite name
  kind: "overlay" | "pane";  // pane = suite renders into its own sub-pane in suite y-space
  /** pane suites only: fixed autoscale range + optional static guide lines (e.g. RSI 30/70). */
  pane?: { min: number; max: number; lines?: Array<{ p: number; dashed?: boolean; label?: string }> };
  modules: SuiteModuleDef[];
}

// -------------------------------------------------------------------------------- renderer contract

export interface CoordMapper {
  xi(i: number): number | null;  // bar index -> x px (valid off-screen; null only on failure)
  y(p: number): number | null;   // price -> y px
  W: number; H: number;          // viewport size
  i0: number; i1: number;        // visible logical range (bar indices, may be fractional/out of array bounds)
  barW: number;                  // current px per bar (density gates, marker autoscale)
}

// Per-module render payload assembled by the host for ChartPanel.
export interface SuiteRenderBundle {
  prims: Prim[];                 // z-sorted, caps applied
  tooltips: Map<string, TooltipDef>;
  candlePaint: CandlePaintEntry[];
  events: SuiteEvent[];
  tables: TableSpec[];
}

// Hard caps enforced by the host (drop excess, single console.warn per module per session).
export const MAX_PRIMS_PER_MODULE = 400;
export const MAX_TOTAL_PRIMS = 1600;

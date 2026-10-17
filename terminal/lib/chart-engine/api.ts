// Mastermind Chart Engine — renderer-agnostic contract (P0).
//
// This file is the boundary the masterplan (docs/CHART_ENGINE_MASTERPLAN.md) draws
// between everything we own and the one rented layer (the canvas renderer). It must
// NOT import from "lightweight-charts": law 1 of the masterplan is that these
// semantics are defined by our own contract tests, not by LWC. The lwc/ adapter maps
// these types onto LWC 5.2; a future canvas/ renderer will implement the same shapes.
//
// Everything here is types + interfaces only. createEngine lives in index.ts so that
// this module carries no implementation and no renderer dependency.

// ── Time & data ───────────────────────────────────────────────────────────────
// Mirrors LWC's `Time` union (UTCTimestamp | BusinessDay | string) structurally
// without importing it. Callers pass either a "YYYY-MM-DD" string, a unix-seconds
// number, or a {year,month,day} business day — exactly what ChartPanel already feeds
// LWC's setData/update.
export type EngineBusinessDay = { year: number; month: number; day: number };
export type EngineTime = number | string | EngineBusinessDay;

// Whitespace point: a time slot with no value (LWC renders a gap). Every data row is
// either a valued row or whitespace; setData accepts a mix, matching LWC.
export type EngineWhitespace = { time: EngineTime };

export type EngineBar = {
  time: EngineTime;
  open: number;
  high: number;
  low: number;
  close: number;
};

// Single-value point for line/area/histogram/baseline. `color` is honored per-point
// by histogram/baseline in LWC; kept optional here so the adapter forwards it 1:1.
export type EnginePoint = {
  time: EngineTime;
  value: number;
  color?: string;
};

export type EngineBarRow = EngineBar | EngineWhitespace;
export type EnginePointRow = EnginePoint | EngineWhitespace;
export type EngineSeriesRow = EngineBarRow | EnginePointRow;

// Structural mirror of LWC's MismatchDirection enum. The contract never imports
// lightweight-charts; the adapter maps these strings onto the numeric enum.
export type EngineMismatchDirection = "none" | "nearest-left" | "nearest-right";

// Runtime mirrors of lightweight-charts enum values (forwarded 1:1 in option bags).
// ChartPanel and tests use these instead of importing from "lightweight-charts".
export const EngineCrosshairMode = {
  Normal: 0,
  Magnet: 1,
  Hidden: 2,
  MagnetOHLC: 3,
} as const;
export type EngineCrosshairMode = (typeof EngineCrosshairMode)[keyof typeof EngineCrosshairMode];

export const EngineColorType = {
  Solid: "solid",
  VerticalGradient: "gradient",
} as const;
export type EngineColorType = (typeof EngineColorType)[keyof typeof EngineColorType];

export const EngineLineStyle = {
  Solid: 0,
  Dotted: 1,
  Dashed: 2,
  LargeDashed: 3,
  SparseDotted: 4,
} as const;
export type EngineLineStyle = (typeof EngineLineStyle)[keyof typeof EngineLineStyle];

export const EngineLineType = {
  Simple: 0,
  WithSteps: 1,
  Curved: 2,
} as const;
export type EngineLineType = (typeof EngineLineType)[keyof typeof EngineLineType];

export const EnginePriceScaleMode = {
  Normal: 0,
  Logarithmic: 1,
  Percentage: 2,
  IndexedTo100: 3,
} as const;
export type EnginePriceScaleMode = (typeof EnginePriceScaleMode)[keyof typeof EnginePriceScaleMode];

// ── Series kinds ────────────────────────────────────────────────────────────────
export type EngineSeriesKind = "candles" | "bars" | "line" | "area" | "histogram" | "baseline";

// Series style options are intentionally open. ChartPanel passes large, kind-specific
// option bags (upColor/wickUpColor/priceFormat/priceScaleId/lineStyle/…) and the
// adapter forwards them verbatim to LWC, which validates them. Modeling every LWC
// option here would couple the contract to LWC and defeat law 1. Consumers get an
// index signature; the adapter narrows per-kind. This is the documented `any` idiom
// for the P0 pass-through boundary — see the adapter's `SeriesPartialOptionsMap` cast.
export type EngineSeriesOptions = Record<string, unknown>;

// ── Geometry / ranges ───────────────────────────────────────────────────────────
export type EngineRange<T> = { from: T; to: T };
export type EngineLogicalRange = EngineRange<number>;

// ── Markers ─────────────────────────────────────────────────────────────────────
// Structural mirror of LWC's SeriesMarker (SeriesMarkerBase fields). `position` and
// `shape` use LWC's string unions so the adapter forwards without translation.
export type EngineMarkerPosition =
  | "aboveBar"
  | "belowBar"
  | "inBar"
  | "atPriceTop"
  | "atPriceBottom"
  | "atPriceMiddle";
export type EngineMarkerShape = "circle" | "square" | "arrowUp" | "arrowDown";

export type MarkerSpec = {
  time: EngineTime;
  position: EngineMarkerPosition;
  shape: EngineMarkerShape;
  color: string;
  id?: string;
  text?: string;
  size?: number;
  price?: number;
};

// ── Watermark ─────────────────────────────────────────────────────────────────
// One line of a pane watermark. Mirrors LWC's TextWatermarkLineOptions; the adapter
// fills LWC's required-but-uninteresting fields (fontFamily/fontStyle) with defaults
// when omitted so callers only supply what varies.
export type WatermarkLine = {
  text: string;
  color?: string;
  fontSize?: number;
  fontStyle?: string;
  fontFamily?: string;
  lineHeight?: number;
};
export type WatermarkSpec = {
  visible?: boolean;
  horzAlign?: "left" | "center" | "right";
  vertAlign?: "top" | "center" | "bottom";
  lines: WatermarkLine[];
};

// ── Price line ──────────────────────────────────────────────────────────────────
// Open bag: LWC's CreatePriceLineOptions is Partial<PriceLineOptions> & {price}. Only
// `price` is required; the rest (color/lineWidth/lineStyle/axisLabelVisible/title/…)
// pass through. Kept structural to avoid importing LWC's option type.
export type PriceLineSpec = { price: number } & Record<string, unknown>;

// ── Engine options (createEngine / applyOptions) ─────────────────────────────────
// A subset of LWC's ChartOptions covering exactly the top-level groups ChartPanel sets
// in its createChart call and later applyOptions calls (layout / grid / crosshair /
// timeScale / rightPriceScale / localization). Each group is left as an open bag: the
// nested shapes are large and LWC-specific, and the adapter forwards them 1:1 into
// DeepPartial<ChartOptions>. Narrowing these would recouple the contract to LWC.
export type EngineOptions = {
  width?: number;
  height?: number;
  autoSize?: boolean;
  layout?: Record<string, unknown>;
  grid?: Record<string, unknown>;
  crosshair?: Record<string, unknown>;
  timeScale?: Record<string, unknown>;
  rightPriceScale?: Record<string, unknown>;
  leftPriceScale?: Record<string, unknown>;
  localization?: Record<string, unknown>;
  handleScroll?: Record<string, unknown> | boolean;
  handleScale?: Record<string, unknown> | boolean;
  kineticScroll?: Record<string, unknown>;
} & Record<string, unknown>;

// ── Event params ────────────────────────────────────────────────────────────────
// The crosshair/click/dbl-click callback payload. LWC's MouseEventParams is rich
// (point, time, logical, seriesData map, hoveredSeries, …); the contract exposes the
// same object shape structurally as an open record so consumers read what they need.
// The lwc adapter REBUILDS it (remapMouseParams): seriesData/hoveredSeries are re-keyed to
// the owned SeriesHandles and no native key (sourceEvent included) survives.
export type EngineMouseEventParams = {
  time?: EngineTime;
  logical?: number;
  point?: { x: number; y: number };
} & Record<string, unknown>;
export type EngineMouseHandler = (param: EngineMouseEventParams) => void;
export type EngineLogicalRangeHandler = (range: EngineLogicalRange | null) => void;

// ── Live-resource census ────────────────────────────────────────────────────────
// A read-only count of what the RENDERER currently holds, read back from the renderer
// itself rather than from caller bookkeeping. That direction is the whole point: a
// consumer that creates series through unwrap() (ChartPanel still does, at ~51 sites)
// is invisible to any registry the engine keeps, so only the renderer's own view can
// prove that no resource outlived the owner that created it. Compare a census against
// the caller's tracked owners and the difference IS the orphan count.
//
// Counts must be cheap and must never throw — a census taken mid-teardown is exactly
// when the numbers matter, so a disposed engine answers {alive:false} with zeroes
// instead of raising.
export type EngineInventory = {
  // false once destroy() has run; every count below is then 0.
  alive: boolean;
  panes: number;
  // Live series across every pane.
  series: number;
  // Per-pane series counts, in pane order (a pane-topology regression shows up here
  // as a phantom pane holding 0 series even when the total is unchanged).
  seriesByPane: number[];
  // Live price lines across every live series. Price lines created on a series the
  // creator does not own (e.g. the shared price series) outlive that creator, so this
  // is the count that exposes an unpooled price line.
  priceLines: number;
  // Watermark plugins this engine created and has not replaced.
  watermarks: number;
};

// ── Disposed semantics ──────────────────────────────────────────────────────────
// After engine.destroy() or series.remove(), the C02 surface is deterministic and
// never throws:
//   • mutators (apply/set/remove/subscribe/swap/crosshair/…) are no-ops
//   • queries return null, [] or 0 (options bags return {})
//   • subscriptions neither attach nor invoke
//   • inventory() stays safe (alive:false, zeroes) — already true since P0
// Double destroy / double remove remains a no-op. Handles obtained before disposal
// stay callable: they do not throw, they go quiet. Native objects are never leaked
// from the C02 methods (data() / dataByIndex / getSeries return owned shapes).
//
// P0/P0.5 methods that already existed on this contract still go through ensure()
// and throw Error("chart-engine: disposed") / "series removed" so the original
// adapter tests stay byte-identical. New methods listed below follow this block.

// ── Handles ─────────────────────────────────────────────────────────────────────

export interface PriceLineHandle {
  applyOptions(opts: Partial<PriceLineSpec>): void;
  // Currently applied options (open bag; `price` is always present while live).
  options(): Record<string, unknown>;
  // Removes this price line from its series. Idempotent.
  remove(): void;
  unwrap<T>(): T; // engine-unwrap: raw IPriceLine
}

export interface PaneHandle {
  // A PaneHandle denotes ONE pane for its lifetime. After the chart's swapPanes
  // (or any other move that reorders panes), `index()` MUST return that pane's
  // CURRENT index, and every other method MUST keep acting on the same pane.
  // This is the IDENTITY semantic; positional handles that re-resolve through
  // the renderer at a stored slot index would address the wrong pane after a
  // swap and silently corrupt overlay metrics, stretch factors, and snapshot
  // capture. If the pane itself is removed, `index()` returns -1 and the acting
  // methods throw the engine's "no longer exists" error — they do NOT silently
  // point at another pane.
  index(): number;
  height(): number;
  setHeight(px: number): void;
  setStretchFactor(factor: number): void;
  stretchFactor(): number;
  // The pane's live DOM element (legend/overlay positioning hooks anchor to it).
  // null while the pane is not laid out yet.
  getHTMLElement(): HTMLElement | null;
  // Series currently on this pane, in renderer order. Returns the SAME SeriesHandle
  // objects the caller created through addSeries (identity holds across lookups).
  getSeries(): SeriesHandle[];
  // Price scale on this pane by id ("right" | "left" | overlay id).
  priceScale(priceScaleId: string): PriceScaleHandle;
  unwrap<T>(): T; // engine-unwrap: raw IPaneApi
}

// A price scale addressed by id ("right" | "left" | any overlay id like "volume").
// Resolved live per call — scales are chart-owned and survive pane churn.
export interface PriceScaleHandle {
  width(): number;
  applyOptions(opts: Record<string, unknown>): void;
  options(): Record<string, unknown>;
  getVisibleRange(): EngineRange<number> | null;
  setVisibleRange(range: EngineRange<number>): void;
  setAutoScale(on: boolean): void;
  unwrap<T>(): T; // engine-unwrap: raw IPriceScaleApi
}

export interface TimeScaleHandle {
  getVisibleLogicalRange(): EngineLogicalRange | null;
  setVisibleLogicalRange(range: EngineLogicalRange): void;
  subscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void;
  unsubscribeVisibleLogicalRangeChange(handler: EngineLogicalRangeHandler): void;
  timeToCoordinate(time: EngineTime): number | null;
  coordinateToTime(x: number): EngineTime | null;
  // LWC spells this scrollToRealTime (capital T); the contract keeps the conventional
  // lowercase-t name and the adapter bridges. See index.ts.
  scrollToRealtime(): void;
  scrollToPosition(position: number, animated?: boolean): void;
  applyOptions(opts: Record<string, unknown>): void;
  fitContent(): void;
  getVisibleRange(): EngineRange<EngineTime> | null;
  setVisibleRange(range: EngineRange<EngineTime>): void;
  logicalToCoordinate(logical: number): number | null;
  coordinateToLogical(x: number): number | null;
  width(): number;
  // Exact time→index (findNearest=false) is what paneSync uses to share a calendar
  // instant across peers; findNearest=true is LWC's nearest-bar fallback.
  timeToIndex(time: EngineTime, findNearest?: boolean): number | null;
  options(): Record<string, unknown>;
  unwrap<T>(): T; // engine-unwrap: raw ITimeScaleApi
}

export interface SeriesHandle {
  readonly kind: EngineSeriesKind;
  setData(rows: EngineSeriesRow[]): void;
  update(row: EngineSeriesRow, historicalUpdate?: boolean): void;
  applyOptions(opts: EngineSeriesOptions): void;
  options(): EngineSeriesOptions;
  // Snapshot of the rows last passed to setData/update. Never a native series object.
  data(): readonly EngineSeriesRow[];
  // Row at a logical index. `mismatchDirection` is a string union; the adapter maps
  // it onto LWC's numeric MismatchDirection. Missing index with "none" → null.
  dataByIndex(logicalIndex: number, mismatchDirection?: EngineMismatchDirection): EngineSeriesRow | null;
  // Replaces the full marker set on this series. First call lazily creates the markers
  // primitive; subsequent calls reuse it. Cleared on remove().
  setMarkers(marks: MarkerSpec[]): void;
  createPriceLine(opts: PriceLineSpec): PriceLineHandle;
  removePriceLine(line: PriceLineHandle): void;
  priceLines(): PriceLineHandle[];
  // The price scale this series is currently attached to (resolved live).
  priceScale(): PriceScaleHandle;
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(y: number): number | null;
  paneIndex(): number;
  // The pane this series currently lives in (resolved live — see PaneHandle).
  pane(): PaneHandle;
  // Moves the series to paneIndex. The renderer clamps an out-of-range index to the
  // current pane count and appends a new pane at the end (LWC getOrCreatePane
  // semantics; see lib/__tests__/subpaneAssign.test.ts). The contract preserves this.
  moveToPane(paneIndex: number): void;
  attachPrimitive(primitive: unknown): void;
  detachPrimitive(primitive: unknown): void;
  // Removes the series from the chart (delegates to the chart, not the series, in LWC).
  // Idempotent; detaches any markers primitive first.
  remove(): void;
  unwrap<T>(): T; // engine-unwrap: raw ISeriesApi
}

export interface ChartEngine {
  // Renderer identity (R01-A02). "lwc" is the rented adapter; "mm" is the owned canvas.
  readonly impl: "lwc" | "mm";
  addSeries(kind: EngineSeriesKind, options?: EngineSeriesOptions, paneIndex?: number): SeriesHandle;
  // Same as series.remove(); kept so ChartPanel's chart.removeSeries(s) cluster maps 1:1.
  removeSeries(series: SeriesHandle): void;
  panes(): PaneHandle[];
  timeScale(): TimeScaleHandle;
  priceScale(priceScaleId: string, paneIndex?: number): PriceScaleHandle;
  // Generated chart root element (LWC's chartElement(); used for measuring/listeners).
  chartElement(): HTMLElement;
  // Currently applied chart options (open bag, same groups as EngineOptions).
  options(): EngineOptions;
  setCrosshairPosition(price: number, time: EngineTime, series: SeriesHandle): void;
  clearCrosshairPosition(): void;
  // {width,height} of a pane's plotting area (throws for a missing pane, matching the
  // renderer — callers that probe speculatively own their try/catch, as ChartPanel does).
  paneSize(paneIndex?: number): { width: number; height: number };
  swapPanes(first: number, second: number): void;
  // All panes composited to one canvas (share/snapshot feature).
  /** Synchronously consume pending paint before capturing the current raster. */
  takeScreenshot(): HTMLCanvasElement;
  applyOptions(options: EngineOptions): void;
  subscribeCrosshairMove(handler: EngineMouseHandler): void;
  unsubscribeCrosshairMove(handler: EngineMouseHandler): void;
  subscribeClick(handler: EngineMouseHandler): void;
  unsubscribeClick(handler: EngineMouseHandler): void;
  subscribeDblClick(handler: EngineMouseHandler): void;
  unsubscribeDblClick(handler: EngineMouseHandler): void;
  // Sets (or replaces) a text watermark on the given pane. Re-calling for the same pane
  // replaces the previous watermark. Cleared on destroy(). A bare WatermarkLine[] is
  // shorthand for {lines}; pass a WatermarkSpec to control alignment/visibility
  // (ChartPanel centers its brand watermark and toggles `visible` per settings).
  setWatermark(paneIndex: number, spec: WatermarkSpec | WatermarkLine[]): void;
  resize(width: number, height: number, forceRepaint?: boolean): void;
  // P0 escape hatch (masterplan §"unwrap() is temporary"): returns the raw renderer
  // handle so ChartPanel can reach APIs not yet surfaced. Every call site is tech debt
  // tagged `// engine-unwrap:` and must reach zero before P3. For LWC this is IChartApi.
  unwrap<T>(): T; // engine-unwrap: raw IChartApi
  // Live-resource census (see EngineInventory). Read-only, cheap, and safe after
  // destroy(). Every renderer that implements this contract owes the same numbers —
  // it is how a lifecycle claim stays checkable across a renderer swap.
  inventory(): EngineInventory;
  destroy(): void;
}

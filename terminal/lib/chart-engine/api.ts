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
// The adapter passes LWC's param through untouched.
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

// ── Handles ─────────────────────────────────────────────────────────────────────

export interface PriceLineHandle {
  applyOptions(opts: Partial<PriceLineSpec>): void;
  // Removes this price line from its series. Idempotent.
  remove(): void;
  unwrap<T>(): T; // engine-unwrap: raw IPriceLine
}

export interface PaneHandle {
  index(): number;
  height(): number;
  setHeight(px: number): void;
  setStretchFactor(factor: number): void;
  stretchFactor(): number;
  // The pane's live DOM element (legend/overlay positioning hooks anchor to it).
  // null while the pane is not laid out yet.
  getHTMLElement(): HTMLElement | null;
  unwrap<T>(): T; // engine-unwrap: raw IPaneApi
}

// A price scale addressed by id ("right" | "left" | any overlay id like "volume").
// Resolved live per call — scales are chart-owned and survive pane churn.
export interface PriceScaleHandle {
  width(): number;
  applyOptions(opts: Record<string, unknown>): void;
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
  unwrap<T>(): T; // engine-unwrap: raw ITimeScaleApi
}

export interface SeriesHandle {
  readonly kind: EngineSeriesKind;
  setData(rows: EngineSeriesRow[]): void;
  update(row: EngineSeriesRow, historicalUpdate?: boolean): void;
  applyOptions(opts: EngineSeriesOptions): void;
  // Replaces the full marker set on this series. First call lazily creates the markers
  // primitive; subsequent calls reuse it. Cleared on remove().
  setMarkers(marks: MarkerSpec[]): void;
  createPriceLine(opts: PriceLineSpec): PriceLineHandle;
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
  addSeries(kind: EngineSeriesKind, options?: EngineSeriesOptions, paneIndex?: number): SeriesHandle;
  panes(): PaneHandle[];
  timeScale(): TimeScaleHandle;
  priceScale(priceScaleId: string, paneIndex?: number): PriceScaleHandle;
  // {width,height} of a pane's plotting area (throws for a missing pane, matching the
  // renderer — callers that probe speculatively own their try/catch, as ChartPanel does).
  paneSize(paneIndex?: number): { width: number; height: number };
  swapPanes(first: number, second: number): void;
  // All panes composited to one canvas (share/snapshot feature).
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

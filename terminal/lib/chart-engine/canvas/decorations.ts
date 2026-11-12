// Mastermind Chart Engine — built-in decorations: pure layout + painter (P3).
//
// This module owns the LAYOUT and PAINT of the chart engine's built-in decorations
// (series markers, price lines, the text watermark, and session-shading rects) for
// the native Canvas2D renderer. It is pure geometry: every layout* function takes
// plain data (specs from ./api.ts plus a projection of the current view) and returns
// paint ops — no DOM, no canvas, no renderer state. paintDecorations() then draws a
// layout bundle over a structural subset of CanvasRenderingContext2D.
//
// Laws honoured here:
//   • NEVER import "lightweight-charts" (not even types) — specs are mirrored
//     structurally from ./api.ts.
//   • NEVER hardcode green/red/up/down (or any) colors: every painted colour is
//     carried in the layout, which took it from the caller's spec. Where a colour
//     is absent the op is skipped, not defaulted.
//   • Layout is in CSS (media) pixels; y grows downward (see the Projection
//     convention in the masterplan). Device-pixel snapping happens at the edges the
//     eye notices (marker centres, stroke ys, rect edges) and is idempotent, so the
//     host may snap again at draw time.
//
// PAINT Z-ORDER (documented contract of paintDecorations):
//   1. session shading rects   — bottom (they read as background)
//   2. price lines             — above shading, below point markers
//   3. markers                 — on top of series-adjacent furniture
//   4. watermark               — top (ghost text overlays everything)
//
// The primitive HOST (registry, z-order integration, hit-testing) is a sibling
// module; everything here is a pure function the host composes.

import type { EngineMarkerShape, EngineTime, MarkerSpec, PriceLineSpec, WatermarkSpec } from "../api";

// ── Local geometry vocabulary (shared with sibling canvas/ lanes) ──────────────
// Fractional bar index; 0 = first row of the primary series.
export type LogicalIndex = number;

// The shared projection vocabulary (masterplan coordinate convention). A bar at
// logical index i is centred at xOfLogical(i); y grows downward.
export type Projection = {
  generation: number;
  dpr: number;
  widthPx: number;
  heightPx: number;
  xOfLogical(i: LogicalIndex): number;
  logicalOfX(x: number): LogicalIndex;
  yOfPrice(p: number): number;
  priceOfY(y: number): number;
};

export type Rect = { x: number; y: number; width: number; height: number };

// Measures `text` in `font` (CSS font shorthand) and returns its advance width.
export type Measure = (text: string, font: string) => number;

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Snap a media-space value to the device pixel grid. Idempotent.
function snapToDevice(v: number, dpr: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.round(v * d) / d;
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y)
    && Number.isFinite(r.width) && Number.isFinite(r.height);
}

// ── Markers ────────────────────────────────────────────────────────────────────

// Bar lookup + per-bar y anchors, supplied by the host from the primary series.
export type RowsIndex = {
  indexOfTime(t: EngineTime): LogicalIndex | null;
  highY(i: LogicalIndex): number;
  lowY(i: LogicalIndex): number;
  closeY(i: LogicalIndex): number;
};

export type MarkerLayoutCtx = {
  projection: Projection;
  rowsIndex: RowsIndex;
  barSpacing: number;
  dpr: number;
  /**
   * LWC lays marker text out in the chart's `layout.fontSize` / `fontFamily`
   * (SeriesMarkersRenderer.setParams). `fontSize` drives the text stacking
   * arithmetic (default 12); `font` is the CSS shorthand the painter sets.
   */
  fontSize?: number;
  font?: string;
};

// One marker glyph ready to paint. x/y is the glyph CENTRE in CSS px (device-
// snapped). `size` is LWC's renderer item size — calculateShapeHeight(barSpacing)
// × the spec's size multiplier — and the painter re-derives each shape's drawn
// span from it with markerShapeSize, exactly as LWC's draw functions do. A size
// of 0 (spec size 0) hides the glyph but still draws the text. Text is centred on
// the glyph's x and sits above/below it per LWC (textBaseline "middle").
export type MarkerLayout = {
  x: number;
  y: number;
  shape: EngineMarkerShape;
  size: number;
  color: string;
  text?: string;
  textX?: number;
  textY?: number;
  textAlign: "left" | "center" | "right";
  font?: string;
};

// `markers` are the paintable ops; `dropped` counts every spec that could not be
// placed (time absent from the index, NaN anchors, atPrice* without a finite
// price). A dropped marker is NEVER emitted — never drawn at x=0.
export type MarkerLayoutResult = { markers: MarkerLayout[]; dropped: number };

// ── LWC series-markers geometry (lightweight-charts series-markers/utils) ──────
// size(bs, coeff)         = ceiledOdd(clamp(bs, 12, 30) × coeff)
// shapeSize(shape, s)     = size(s, arrow 1 | circle 0.8 | square 0.7)
// calculateShapeHeight(bs)= ceiledEven(size(bs, 1))        — the renderer item size
// shapeMargin(bs)         = max(size(bs, 0.1), 3)           — stack gap / text gap
const MARKER_MIN_SHAPE_SIZE_PX = 12;
const MARKER_MAX_SHAPE_SIZE_PX = 30;
const MARKER_MIN_SHAPE_MARGIN_PX = 3;
// LWC Constants.TextMargin: text sits 0.6 × fontSize beyond the glyph edge and
// a text line advances the stack by 1.2 × fontSize.
const MARKER_TEXT_MARGIN = 0.1;
/** LWC layoutOptionsDefaults.fontSize — the marker text height when the host passes none. */
export const DEFAULT_MARKER_FONT_SIZE = 12;
const MARKER_TEXT_FONT = `${DEFAULT_MARKER_FONT_SIZE}px sans-serif`;

function ceiledEven(x: number): number {
  const ceiled = Math.ceil(x);
  return ceiled % 2 !== 0 ? ceiled - 1 : ceiled;
}

function ceiledOdd(x: number): number {
  const ceiled = Math.ceil(x);
  return ceiled % 2 === 0 ? ceiled - 1 : ceiled;
}

function markerSize(barSpacing: number, coeff: number): number {
  return ceiledOdd(clampNum(barSpacing, MARKER_MIN_SHAPE_SIZE_PX, MARKER_MAX_SHAPE_SIZE_PX) * coeff);
}

/** LWC shapeSize(shape, originalSize): the drawn span of a shape for a renderer item size. */
export function markerShapeSize(shape: EngineMarkerShape, originalSize: number): number {
  switch (shape) {
    case "circle":
      return markerSize(originalSize, 0.8);
    case "square":
      return markerSize(originalSize, 0.7);
    default:
      return markerSize(originalSize, 1);
  }
}

/** LWC calculateShapeHeight(barSpacing): the renderer item size at multiplier 1. */
export function markerShapeHeight(barSpacing: number): number {
  return ceiledEven(markerSize(barSpacing, 1));
}

/** LWC shapeMargin(barSpacing): the vertical gap between stacked glyphs and text. */
export function markerShapeMargin(barSpacing: number): number {
  return Math.max(markerSize(barSpacing, 0.1), MARKER_MIN_SHAPE_MARGIN_PX);
}

function adjustedAutoscaleMargin(margin: number, hasSide: boolean, hasInBar: boolean): number {
  if (hasSide) return margin;
  if (hasInBar) return Math.ceil(margin / 2);
  return 0;
}

/**
 * LWC SeriesMarkersPrimitive._getAutoScaleMargins: the pixel bands a series with
 * markers reserves above and below its autoscaled price range so the glyphs stay
 * inside the pane. Census over EVERY marker of the series (not only the visible
 * ones), as LWC's _getMarkerPositions does; atPrice* markers reserve nothing.
 * `null` when the series has no markers (LWC returns null, the scale sees 0).
 */
export function markerAutoscaleMargins(
  markers: readonly MarkerSpec[],
  barSpacing: number,
): { above: number; below: number } | null {
  if (markers.length === 0 || !Number.isFinite(barSpacing)) return null;
  let aboveBar = false;
  let belowBar = false;
  let inBar = false;
  for (const marker of markers) {
    if (marker.position === "aboveBar") aboveBar = true;
    else if (marker.position === "belowBar") belowBar = true;
    else if (marker.position === "inBar") inBar = true;
  }
  const marginValue = markerShapeHeight(barSpacing) * 1.5 + markerShapeMargin(barSpacing) * 2;
  return {
    above: adjustedAutoscaleMargin(marginValue, aboveBar, inBar),
    below: adjustedAutoscaleMargin(marginValue, belowBar, inBar),
  };
}

// PERF-B: single-slot layout memo per markers array. Layout depends only on
// (markers content, projection geometry, rows anchors, text font size); the
// fingerprint below covers everything observable — generation for data/rows
// identity, the window/width/height/dpr/barSpacing for geometry, fontSize/font
// for the text. A WeakMap keyed on the markers array keeps the entry bounded by
// the live arrays (setMarkers always installs a fresh array). The memoised result
// object is shared between paints and must only be read.
type MarkerMemo = {
  generation: number;
  from: number;
  to: number;
  widthPx: number;
  heightPx: number;
  dpr: number;
  barSpacing: number;
  fontSize: number;
  font: string;
  result: MarkerLayoutResult;
};
const markerMemo = new WeakMap<MarkerSpec[], MarkerMemo>();

function markerFontSize(ctx: MarkerLayoutCtx): number {
  const v = ctx.fontSize;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_MARKER_FONT_SIZE;
}

export function layoutMarkers(markers: MarkerSpec[], ctx: MarkerLayoutCtx): MarkerLayoutResult {
  if (markers.length === 0) return { markers: [], dropped: 0 };
  const { projection, barSpacing, dpr } = ctx;
  const fontSize = markerFontSize(ctx);
  const font = typeof ctx.font === "string" && ctx.font !== "" ? ctx.font : MARKER_TEXT_FONT;
  const leftLogical = projection.logicalOfX(0);
  const rightLogical = projection.logicalOfX(projection.widthPx);
  const from = Number.isFinite(leftLogical) ? Math.floor(leftLogical) : 0;
  const to = Number.isFinite(rightLogical) ? Math.ceil(rightLogical) : 0;
  const memo = markerMemo.get(markers);
  if (memo
    && memo.generation === projection.generation
    && memo.from === from && memo.to === to
    && memo.widthPx === projection.widthPx
    && memo.heightPx === projection.heightPx
    && memo.dpr === dpr
    && memo.barSpacing === barSpacing
    && memo.fontSize === fontSize
    && memo.font === font) {
    return memo.result;
  }
  const result = layoutMarkersUncached(markers, ctx, fontSize, font);
  markerMemo.set(markers, {
    generation: projection.generation,
    from,
    to,
    widthPx: projection.widthPx,
    heightPx: projection.heightPx,
    dpr,
    barSpacing,
    fontSize,
    font,
    result,
  });
  return result;
}

/**
 * LWC SeriesMarkersPaneView._makeValid + fillSizeAndY, per bar instead of per
 * consecutive run (LWC sorts markers by time, so the two agree on sorted input
 * and this one also stacks correctly on unsorted input).
 *
 *   offsets start at shapeMargin per bar and side;
 *   aboveBar: y = highY − half − offset; text y − half − 0.6·fs;
 *             offset += 1.2·fs (text) then += size + shapeMargin
 *   belowBar: mirror (text y + half + shapeMargin + 0.6·fs)
 *   inBar / atPriceMiddle: y = closeY / priceY; text below as belowBar
 *   atPriceTop / atPriceBottom: priceY ∓ half, no stack offset
 *
 * `highY`/`lowY` are taken as the upper/lower screen anchors (min/max), which is
 * LWC's getPrice high↔low swap on an inverted scale.
 */
function layoutMarkersUncached(
  markers: MarkerSpec[],
  ctx: MarkerLayoutCtx,
  textHeight: number,
  font: string,
): MarkerLayoutResult {
  const { projection, rowsIndex, barSpacing, dpr } = ctx;
  const shapeHeight = markerShapeHeight(barSpacing);
  const shapeMargin = markerShapeMargin(barSpacing);
  const textBeyondEdge = textHeight * (0.5 + MARKER_TEXT_MARGIN);
  const textAdvance = textHeight * (1 + 2 * MARKER_TEXT_MARGIN);
  const out: MarkerLayout[] = [];
  let dropped = 0;

  // Per-bar stacking offsets (LWC offsets.aboveBar / offsets.belowBar).
  const aboveOffsets = new Map<LogicalIndex, number>();
  const belowOffsets = new Map<LogicalIndex, number>();

  for (const marker of markers) {
    const index = rowsIndex.indexOfTime(marker.time);
    if (index == null || !Number.isFinite(index)) {
      dropped++;
      continue;
    }
    const multiplier = typeof marker.size === "number" && Number.isFinite(marker.size)
      ? Math.max(marker.size, 0)
      : 1;
    const size = shapeHeight * multiplier;
    // A non-finite barSpacing poisons the shape height; a marker without a
    // usable size is never emitted (NaN guard). Size 0 is a legal "text only".
    if (!Number.isFinite(size)) {
      dropped++;
      continue;
    }
    const halfSize = size / 2;
    const x = projection.xOfLogical(index);
    if (!Number.isFinite(x)) {
      dropped++;
      continue;
    }
    const hasText = typeof marker.text === "string" && marker.text !== "";

    let y: number;
    let textY: number | undefined;
    const position = marker.position;
    if (position === "aboveBar" || position === "belowBar") {
      const highY = rowsIndex.highY(index);
      const lowY = rowsIndex.lowY(index);
      if (!Number.isFinite(highY) || !Number.isFinite(lowY)) {
        dropped++;
        continue;
      }
      if (position === "aboveBar") {
        let offset = aboveOffsets.get(index) ?? shapeMargin;
        y = Math.min(highY, lowY) - halfSize - offset;
        if (hasText) {
          textY = y - halfSize - textBeyondEdge;
          offset += textAdvance;
        }
        offset += size + shapeMargin;
        aboveOffsets.set(index, offset);
      } else {
        let offset = belowOffsets.get(index) ?? shapeMargin;
        y = Math.max(highY, lowY) + halfSize + offset;
        if (hasText) {
          textY = y + halfSize + shapeMargin + textBeyondEdge;
          offset += textAdvance;
        }
        offset += size + shapeMargin;
        belowOffsets.set(index, offset);
      }
    } else if (position === "inBar") {
      const closeY = rowsIndex.closeY(index);
      if (!Number.isFinite(closeY)) {
        dropped++;
        continue;
      }
      y = closeY;
      if (hasText) textY = y + halfSize + shapeMargin + textBeyondEdge;
    } else {
      // atPriceTop / atPriceBottom / atPriceMiddle anchor to the spec's price and
      // ignore the per-bar stack (LWC isPriceMarker).
      const price = marker.price;
      if (typeof price !== "number" || !Number.isFinite(price)) {
        dropped++;
        continue;
      }
      const priceY = projection.yOfPrice(price);
      if (!Number.isFinite(priceY)) {
        dropped++;
        continue;
      }
      if (position === "atPriceTop") {
        y = priceY - halfSize;
        if (hasText) textY = y - halfSize - textBeyondEdge;
      } else if (position === "atPriceBottom") {
        y = priceY + halfSize;
        if (hasText) textY = y + halfSize + shapeMargin + textBeyondEdge;
      } else {
        y = priceY;
        if (hasText) textY = y + halfSize + shapeMargin + textBeyondEdge;
      }
    }

    const sx = snapToDevice(x, dpr);
    const sy = snapToDevice(y, dpr);
    const layout: MarkerLayout = {
      x: sx,
      y: sy,
      shape: marker.shape,
      size,
      color: typeof marker.color === "string" ? marker.color : "",
      textAlign: "center",
    };
    if (hasText && textY !== undefined) {
      layout.text = marker.text;
      layout.textX = sx;
      layout.textY = snapToDevice(textY, dpr);
      layout.font = font;
    }
    out.push(layout);
  }
  return { markers: out, dropped };
}

// ── Price lines ────────────────────────────────────────────────────────────────

export type PriceLineLayoutCtx = {
  projection: Projection;
  plotRect: Rect;
  // The price-axis strip the axis label box lives in.
  axisRect: Rect;
  measure: Measure;
};

export type PriceLineLayout = {
  // Snapped to whole CSS px (this ctx carries no dpr); the painter re-snaps.
  y: number;
  x0: number;
  x1: number;
  // Empty array = solid. Derived from the spec's lineStyle (LWC enum number or
  // style name); unknown styles fall back to solid.
  dash: number[];
  lineWidth: number;
  color: string;
  // Honoured from the spec (both default true).
  lineVisible: boolean;
  // Title text at the line's left, inside the plot.
  title?: { text: string; x: number; y: number; width: number };
  // Axis label box (price text), only when axisLabelVisible !== false.
  label?: { boxRect: Rect; text: string; textX: number; textY: number };
  // Caller-supplied axis label colours (LWC axisLabelColor / axisLabelTextColor).
  // The painter draws the label BOX only when both are present; otherwise the
  // label renders as bare text in the line's colour — never an invented colour.
  boxFill?: string;
  textColor?: string;
};

// LWC LineStyle enum → dash pattern in CSS px, scaled by lineWidth (mirrors
// LWC's own getDashPattern: dotted [w,w], dashed [2w,2w], largeDashed [6w,6w],
// sparseDotted [w,4w]). Numbers are the values ChartPanel already passes
// (0 solid, 1 dotted, 2 dashed); style names accepted alongside.
function dashFor(style: unknown, lineWidth: number): number[] {
  const key = typeof style === "number" ? String(style)
    : typeof style === "string" ? style.toLowerCase()
    : "";
  switch (key) {
    case "0":
    case "solid":
      return [];
    case "1":
    case "dotted":
      return [lineWidth, lineWidth];
    case "2":
    case "dashed":
      return [2 * lineWidth, 2 * lineWidth];
    case "3":
    case "largedashed":
      return [6 * lineWidth, 6 * lineWidth];
    case "4":
    case "sparsedotted":
      return [lineWidth, 4 * lineWidth];
    default:
      return [];
  }
}

const PRICE_AXIS_LABEL_HEIGHT_PX = 18;
const PRICE_LINE_TITLE_PAD_PX = 4;
const PRICE_LINE_TITLE_FONT = "11px sans-serif";
const PRICE_AXIS_LABEL_FONT = "11px sans-serif";

export function layoutPriceLines(
  lines: PriceLineSpec[],
  ctx: PriceLineLayoutCtx,
): PriceLineLayout[] {
  const { projection, plotRect, axisRect, measure } = ctx;
  const out: PriceLineLayout[] = [];
  const top = plotRect.y;
  const bottom = plotRect.y + plotRect.height;

  for (const spec of lines) {
    const price = spec.price;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    const rawY = projection.yOfPrice(price);
    // Cull: a price that maps outside the plot (or to NaN) is never drawn.
    if (!Number.isFinite(rawY) || rawY < top || rawY > bottom) continue;

    const lineWidth = typeof spec.lineWidth === "number" && Number.isFinite(spec.lineWidth)
      && spec.lineWidth > 0 ? spec.lineWidth : 1;

    const layout: PriceLineLayout = {
      y: Math.round(rawY),
      x0: plotRect.x,
      x1: plotRect.x + plotRect.width,
      dash: dashFor(spec.lineStyle, lineWidth),
      lineWidth,
      color: typeof spec.color === "string" ? spec.color : "",
      lineVisible: spec.lineVisible !== false,
    };

    const title = typeof spec.title === "string" ? spec.title.trim() : "";
    if (title !== "") {
      layout.title = {
        text: title,
        x: plotRect.x + PRICE_LINE_TITLE_PAD_PX,
        y: layout.y,
        width: measure(title, PRICE_LINE_TITLE_FONT),
      };
    }

    if (spec.axisLabelVisible !== false && axisRect.width > 0 && axisRect.height > 0) {
      const height = Math.min(PRICE_AXIS_LABEL_HEIGHT_PX, axisRect.height);
      // Clamp so the box never spills past the axis strip.
      const boxY = clampNum(layout.y - height / 2, axisRect.y, axisRect.y + axisRect.height - height);
      layout.label = {
        boxRect: { x: axisRect.x, y: boxY, width: axisRect.width, height },
        text: String(price),
        textX: axisRect.x + axisRect.width / 2,
        textY: boxY + height / 2,
      };
      const boxFill = typeof spec.axisLabelColor === "string" ? spec.axisLabelColor : undefined;
      const textColor = typeof spec.axisLabelTextColor === "string" ? spec.axisLabelTextColor : undefined;
      if (boxFill !== undefined) layout.boxFill = boxFill;
      if (textColor !== undefined) layout.textColor = textColor;
    }

    out.push(layout);
  }
  return out;
}

// ── Watermark ──────────────────────────────────────────────────────────────────

export type WatermarkLineLayout = {
  text: string;
  // Anchor x per horzAlign (left edge / centre / right edge of the plot).
  x: number;
  // Vertical centre of the line's line-box.
  y: number;
  font: string;
  // Absent when the spec's line carried no colour: the painter then skips the
  // line rather than inventing one (no-hardcoded-colours law).
  color?: string;
  textAlign: "left" | "center" | "right";
  // Measured advance width (measure(text, font)) — handy for hit-testing.
  width: number;
};

export type WatermarkLayout = { lines: WatermarkLineLayout[] };

// Mirrors the lwc adapter's neutral defaults (fontSize 44) so both renderers
// agree when the caller omits the field.
const WATERMARK_DEFAULT_FONT_SIZE = 44;
const WATERMARK_LINE_HEIGHT_RATIO = 1.2;
const WATERMARK_DEFAULT_FONT_FAMILY = "sans-serif";

export function layoutWatermark(
  spec: WatermarkSpec,
  plotRect: Rect,
  measure: Measure,
): WatermarkLayout {
  if (spec.visible === false) return { lines: [] };
  const horzAlign = spec.horzAlign ?? "center";
  const vertAlign = spec.vertAlign ?? "center";

  const boxes = spec.lines.map((line) => {
    const fontSize = typeof line.fontSize === "number" && Number.isFinite(line.fontSize)
      && line.fontSize > 0 ? line.fontSize : WATERMARK_DEFAULT_FONT_SIZE;
    const lineHeight = typeof line.lineHeight === "number" && Number.isFinite(line.lineHeight)
      && line.lineHeight > 0 ? line.lineHeight : fontSize * WATERMARK_LINE_HEIGHT_RATIO;
    return { line, fontSize, lineHeight };
  });

  // Multi-line stacks are centred as a BLOCK: the whole stack honours vertAlign,
  // each line then occupies its own line-box inside the block.
  const blockHeight = boxes.reduce((sum, b) => sum + b.lineHeight, 0);
  const top = vertAlign === "top" ? plotRect.y
    : vertAlign === "bottom" ? plotRect.y + plotRect.height - blockHeight
    : plotRect.y + (plotRect.height - blockHeight) / 2;
  const anchorX = horzAlign === "left" ? plotRect.x
    : horzAlign === "right" ? plotRect.x + plotRect.width
    : plotRect.x + plotRect.width / 2;

  let cursor = top;
  const lines: WatermarkLineLayout[] = [];
  for (const b of boxes) {
    const font = `${b.line.fontStyle || "normal"} ${b.fontSize}px ${b.line.fontFamily || WATERMARK_DEFAULT_FONT_FAMILY}`;
    const text = b.line.text ?? "";
    lines.push({
      text,
      x: anchorX,
      y: cursor + b.lineHeight / 2,
      font,
      color: typeof b.line.color === "string" && b.line.color !== "" ? b.line.color : undefined,
      textAlign: horzAlign,
      width: measure(text, font),
    });
    cursor += b.lineHeight;
  }
  return { lines };
}

// ── Session shading ────────────────────────────────────────────────────────────

export type SessionShadingSpec = {
  // Bar times (display-epoch seconds, the rowsIndex's key space).
  fromTime: number;
  toTime: number;
  color: string;
};

export type SessionShadingRect = Rect & { color: string };

export function layoutSessionShading(
  sessions: SessionShadingSpec[],
  projection: Projection,
  rowsIndex: RowsIndex,
  plotRect: Rect,
): SessionShadingRect[] {
  const out: SessionShadingRect[] = [];
  // Bar edges are centre ± barSpacing/2; this signature carries no barSpacing, so
  // derive it from the (linear) projection.
  const spacingRaw = projection.xOfLogical(1) - projection.xOfLogical(0);
  const half = Number.isFinite(spacingRaw) && spacingRaw > 0 ? spacingRaw / 2 : 0;
  const plotLeft = plotRect.x;
  const plotRight = plotRect.x + plotRect.width;

  for (const session of sessions) {
    const { fromTime, toTime, color } = session;
    if (typeof fromTime !== "number" || typeof toTime !== "number"
      || !Number.isFinite(fromTime) || !Number.isFinite(toTime)) continue;
    const fromIndex = rowsIndex.indexOfTime(fromTime);
    const toIndex = rowsIndex.indexOfTime(toTime);
    if (fromIndex == null || toIndex == null
      || !Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) continue;

    const leftEdge = projection.xOfLogical(fromIndex) - half;
    const rightEdge = projection.xOfLogical(toIndex) + half;
    if (!Number.isFinite(leftEdge) || !Number.isFinite(rightEdge)) continue;

    // Clip to the plot rect; drop sessions that end up zero-width (or reversed).
    const x0 = Math.max(plotLeft, Math.min(leftEdge, rightEdge));
    const x1 = Math.min(plotRight, Math.max(leftEdge, rightEdge));
    if (!(x1 > x0)) continue;

    out.push({
      x: x0,
      y: plotRect.y,
      width: x1 - x0,
      height: plotRect.height,
      color: typeof color === "string" ? color : "",
    });
  }
  return out;
}

// ── Painter ────────────────────────────────────────────────────────────────────

// The structural subset of CanvasRenderingContext2D the painter needs. The host
// supplies a ctx already carrying the DPR transform (media coordinate space), the
// same contract fancy-canvas gives LWC plugins.
export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | "save" | "restore" | "beginPath" | "moveTo" | "lineTo" | "arc" | "rect"
  | "closePath" | "fill" | "stroke" | "fillText" | "fillRect" | "setLineDash"
> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  lineWidth: number;
  font: string;
  textAlign: CanvasRenderingContext2D["textAlign"];
  textBaseline: CanvasRenderingContext2D["textBaseline"];
};

export type DecorationLayouts = {
  sessionShading?: SessionShadingRect[];
  priceLines?: PriceLineLayout[];
  markers?: MarkerLayout[];
  watermark?: WatermarkLayout;
};

/**
 * Paint a decoration layout bundle in the documented z-order: shading rects,
 * price lines, markers, watermark. Pure consumer of layout data — every colour
 * comes from the layouts; non-finite ops are skipped (never thrown on).
 */
export function paintDecorations(
  ctx: PaintContext,
  layouts: DecorationLayouts,
  opts: { dpr: number },
): void {
  const dpr = Number.isFinite(opts.dpr) && opts.dpr > 0 ? opts.dpr : 1;
  for (const rect of layouts.sessionShading ?? []) paintShadingRect(ctx, rect, dpr);
  for (const line of layouts.priceLines ?? []) paintPriceLine(ctx, line, dpr);
  for (const marker of layouts.markers ?? []) paintMarker(ctx, marker);
  if (layouts.watermark) {
    for (const line of layouts.watermark.lines) paintWatermarkLine(ctx, line);
  }
}

function paintShadingRect(ctx: PaintContext, rect: SessionShadingRect, dpr: number): void {
  if (!isFiniteRect(rect) || rect.color === "" || rect.width <= 0 || rect.height <= 0) return;
  const x0 = snapToDevice(rect.x, dpr);
  const y0 = snapToDevice(rect.y, dpr);
  const x1 = snapToDevice(rect.x + rect.width, dpr);
  const y1 = snapToDevice(rect.y + rect.height, dpr);
  if (!(x1 > x0) || !(y1 > y0)) return;
  ctx.save();
  ctx.fillStyle = rect.color;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

function paintPriceLine(ctx: PaintContext, line: PriceLineLayout, dpr: number): void {
  const { color } = line;
  if (!Number.isFinite(line.y) || !Number.isFinite(line.x0) || !Number.isFinite(line.x1)
    || color === "") return;
  const y = snapToDevice(line.y, dpr);

  if (line.lineVisible && line.lineWidth > 0) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = line.lineWidth;
    ctx.setLineDash(line.dash);
    ctx.beginPath();
    ctx.moveTo(snapToDevice(line.x0, dpr), y);
    ctx.lineTo(snapToDevice(line.x1, dpr), y);
    ctx.stroke();
    ctx.restore();
  }

  const title = line.title;
  if (title && title.text !== "" && Number.isFinite(title.x)) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = PRICE_LINE_TITLE_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title.text, title.x, y);
    ctx.restore();
  }

  const label = line.label;
  if (label && label.text !== "" && Number.isFinite(label.textX) && Number.isFinite(label.textY)) {
    const boxFill = typeof line.boxFill === "string" && line.boxFill !== "" ? line.boxFill : null;
    const textColor = typeof line.textColor === "string" && line.textColor !== "" ? line.textColor : null;
    const boxed = boxFill !== null && textColor !== null;
    ctx.save();
    if (boxed && label.boxRect && isFiniteRect(label.boxRect)
      && label.boxRect.width > 0 && label.boxRect.height > 0) {
      const bx0 = snapToDevice(label.boxRect.x, dpr);
      const by0 = snapToDevice(label.boxRect.y, dpr);
      const bx1 = snapToDevice(label.boxRect.x + label.boxRect.width, dpr);
      const by1 = snapToDevice(label.boxRect.y + label.boxRect.height, dpr);
      if (bx1 > bx0 && by1 > by0) {
        ctx.fillStyle = boxFill;
        ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      }
    }
    // Box text needs the caller's contrast colour; bare text falls back to the
    // line's own colour (never an invented one).
    ctx.fillStyle = boxed && textColor !== null ? textColor : color;
    ctx.font = PRICE_AXIS_LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.text, label.textX, label.textY);
    ctx.restore();
  }
}

/**
 * LWC series-markers drawItem: text first, then the shape through drawCircle /
 * drawSquare / drawArrow, each of which re-derives its span from the item size
 * with shapeSize (so a 10 px item draws a 9 px circle, a 7 px square and an
 * 11 px arrow). Size 0 skips the shape (LWC drawShape) but keeps the text.
 */
function paintMarker(ctx: PaintContext, marker: MarkerLayout): void {
  if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)
    || !Number.isFinite(marker.size) || marker.size < 0 || marker.color === "") return;
  const { x, y, size } = marker;
  ctx.save();
  ctx.fillStyle = marker.color;
  if (marker.text !== undefined && marker.text !== ""
    && marker.textX !== undefined && marker.textY !== undefined
    && Number.isFinite(marker.textX) && Number.isFinite(marker.textY)) {
    ctx.font = marker.font ?? MARKER_TEXT_FONT;
    ctx.textAlign = marker.textAlign;
    ctx.textBaseline = "middle";
    ctx.fillText(marker.text, marker.textX, marker.textY);
  }
  if (size > 0) {
    switch (marker.shape) {
      case "circle": {
        const r = (markerShapeSize("circle", size) - 1) / 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "square": {
        const squareSize = markerShapeSize("square", size);
        const half = (squareSize - 1) / 2;
        ctx.beginPath();
        ctx.rect(x - half, y - half, squareSize, squareSize);
        ctx.fill();
        break;
      }
      case "arrowUp":
      case "arrowDown": {
        const up = marker.shape === "arrowUp";
        const halfArrow = (markerShapeSize("arrowUp", size) - 1) / 2;
        const halfBase = (ceiledOdd(size / 2) - 1) / 2;
        // Head apex points away from the bar; the stem extends back toward it.
        const head = up ? y - halfArrow : y + halfArrow;
        const stem = up ? y + halfArrow : y - halfArrow;
        ctx.beginPath();
        ctx.moveTo(x - halfArrow, y);
        ctx.lineTo(x, head);
        ctx.lineTo(x + halfArrow, y);
        ctx.lineTo(x + halfBase, y);
        ctx.lineTo(x + halfBase, stem);
        ctx.lineTo(x - halfBase, stem);
        ctx.lineTo(x - halfBase, y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default:
        break;
    }
  }
  ctx.restore();
}

function paintWatermarkLine(ctx: PaintContext, line: WatermarkLineLayout): void {
  if (line.text === "" || line.color === undefined || line.color === ""
    || !Number.isFinite(line.x) || !Number.isFinite(line.y)) return;
  ctx.save();
  ctx.fillStyle = line.color;
  ctx.font = line.font;
  ctx.textAlign = line.textAlign;
  ctx.textBaseline = "middle";
  ctx.fillText(line.text, line.x, line.y);
  ctx.restore();
}

// Native Canvas2D series painters (P3).
//
// Draw the six EngineSeriesKind shapes from pure geometry onto a structural
// CanvasRenderingContext2D subset. No DOM, no lightweight-charts, no colour
// literals: every directional colour is read from the SeriesPaintStyle the
// caller passes (canvas cannot resolve CSS variables).
//
// Device-pixel snapping: snapPx(v, dpr) places a 1 CSS-px stroke on a device
// pixel centre — 0.5 CSS-px offset at dpr 1 (odd device width), no offset at
// dpr 2 (1 CSS px = 2 device px, even). snapWidth(w, dpr) rounds a CSS width
// to a whole number of device pixels and never returns less than 1 device px,
// so candle bodies stay visible at dense zooms. When a bar's body span
// (2 * halfWidth) is under 2 CSS px, wicks are forced to exactly 1 device px.
//
// Geometry types here are local structural mirrors of the sibling series.ts
// lane; the parent unifies the exports. See RESULT.md INTEGRATION_NOTES.

import type { EngineSeriesKind } from "../api";

export type SeriesKind = EngineSeriesKind;

/** Structural subset of CanvasRenderingContext2D that the painters actually call. */
export type PaintContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  setLineDash(segments: number[]): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  save(): void;
  restore(): void;
  clip(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
};

export type CandleGeom = {
  x: number;
  halfWidth: number;
  openY: number;
  closeY: number;
  highY: number;
  lowY: number;
  up: boolean;
  visible: boolean;
  /**
   * Per-bar overrides from the row (LWC `color`/`borderColor`/`wickColor`). Each wins over
   * the up/down style colour for its own part only; absent means the style colour.
   */
  color?: string;
  borderColor?: string;
  wickColor?: string;
  /** Part visibility (LWC `wickVisible`/`borderVisible`); only `false` hides the part. */
  wickVisible?: boolean;
  borderVisible?: boolean;
};

export type BarGeom = CandleGeom & {
  openTickLength: number;
  closeTickLength: number;
};

export type LineVertex = { x: number; y: number };
export type LinePolyline = { points: Array<LineVertex | null> };

export type AreaGeom = { line: LinePolyline; baseY: number };

export type HistogramColumn = {
  x: number;
  halfWidth: number;
  topY: number;
  baseY: number;
  up: boolean;
  /** Per-column fill from the row (LWC histogram `color`); absent means the style colour. */
  color?: string;
};

export type HistogramGeom = { columns: HistogramColumn[] };

export type BaselineGeom = { line: LinePolyline; baseY: number };

/**
 * Caller-resolved series colours and line chrome. Painters never substitute a
 * default: a missing field is a caller bug, not a green/red fallback.
 */
export type SeriesPaintStyle = {
  upColor: string;
  downColor: string;
  wickUpColor: string;
  wickDownColor: string;
  borderUpColor: string;
  borderDownColor: string;
  lineColor: string;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  topFillColor: string;
  bottomFillColor: string;
  topLineColor: string;
  bottomLineColor: string;
  baseValueColor: string;
  priceLineVisible?: boolean;
};

export type ClipRect = { x: number; y: number; width: number; height: number };
export type PaintView = { dpr: number; clipRect: ClipRect };

export type PaintGeometryMap = {
  candles: CandleGeom[];
  bars: BarGeom[];
  line: LinePolyline;
  area: AreaGeom;
  histogram: HistogramGeom;
  baseline: BaselineGeom;
};

const MIN_BODY_SPAN_FOR_CSS_WICK = 2;

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function finiteAll(...ns: number[]): boolean {
  for (const n of ns) if (!finite(n)) return false;
  return true;
}

function finitePt(p: LineVertex): boolean {
  return finite(p.x) && finite(p.y);
}

function finiteRect(r: ClipRect): boolean {
  return finiteAll(r.x, r.y, r.width, r.height);
}

function viewDpr(view: PaintView): number {
  return view.dpr > 0 && finite(view.dpr) ? view.dpr : 1;
}

/**
 * Snap a CSS-pixel coordinate onto the device-pixel grid for a 1 CSS-px stroke.
 *
 * Convert to device pixels and round. A 1 CSS-px stroke covers `round(dpr)`
 * device pixels; when that count is odd (dpr 1 → 1) the coordinate is offset
 * by half a device pixel so the stroke is centred on a physical pixel. When
 * the count is even (dpr 2 → 2) the stroke already fills whole pixels and
 * needs no offset.
 */
export function snapPx(v: number, dpr: number): number {
  return snapPxForStroke(v, dpr, 1);
}

/**
 * Round a CSS width to a whole number of device pixels. Result is at least
 * one device pixel (`1 / dpr`) so a candle body never disappears.
 */
export function snapWidth(w: number, dpr: number): number {
  if (!finite(w) || !(dpr > 0)) return 0;
  return Math.max(1 / dpr, Math.round(Math.abs(w) * dpr) / dpr);
}

function snapPxForStroke(v: number, dpr: number, strokeCss: number): number {
  if (!finite(v) || !(dpr > 0)) return 0;
  const deviceStroke = Math.max(1, Math.round(Math.abs(strokeCss) * dpr));
  const scaled = v * dpr;
  if (deviceStroke % 2 === 1) return (Math.round(scaled - 0.5) + 0.5) / dpr;
  return Math.round(scaled) / dpr;
}

function snapEdge(v: number, dpr: number): number {
  if (!finite(v) || !(dpr > 0)) return 0;
  return Math.round(v * dpr) / dpr;
}

function deviceMin(dpr: number): number {
  return 1 / dpr;
}

function wickWidthCss(halfWidth: number, dpr: number): number {
  return 2 * halfWidth < MIN_BODY_SPAN_FOR_CSS_WICK ? deviceMin(dpr) : snapWidth(1, dpr);
}

function dashFor(style: SeriesPaintStyle["lineStyle"], width: number): number[] {
  if (style === "dashed") return [width * 2, width * 2];
  if (style === "dotted") return [width, width];
  return [];
}

function applyStroke(
  ctx: PaintContext,
  color: string,
  width: number,
  lineStyle: SeriesPaintStyle["lineStyle"] = "solid",
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashFor(lineStyle, width));
}

function withClip(ctx: PaintContext, clip: ClipRect, paint: () => void): void {
  ctx.save();
  try {
    if (finiteRect(clip)) {
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
    }
    paint();
  } finally {
    ctx.restore();
  }
}

/** An item whose colour resolves empty is not painted: no colour is ever substituted. */
function groupByColor<T>(items: readonly T[], colorOf: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const color = colorOf(item);
    if (!color) continue;
    const batch = groups.get(color);
    if (batch) batch.push(item);
    else groups.set(color, [item]);
  }
  return groups;
}

function isDrawableCandle(c: CandleGeom): boolean {
  return c.visible === true && finiteAll(c.x, c.halfWidth, c.openY, c.closeY, c.highY, c.lowY);
}

function bodyBox(
  x: number,
  halfWidth: number,
  y0: number,
  y1: number,
  dpr: number,
): { x: number; y: number; w: number; h: number } {
  const min = deviceMin(dpr);
  let left = snapEdge(x - halfWidth, dpr);
  const right = snapEdge(x + halfWidth, dpr);
  let w = right - left;
  if (w < min) {
    const cx = snapEdge(x, dpr);
    left = cx - min / 2;
    w = min;
  }
  let top = snapEdge(Math.min(y0, y1), dpr);
  const bot = snapEdge(Math.max(y0, y1), dpr);
  let h = bot - top;
  if (h < min) {
    const cy = snapEdge((y0 + y1) / 2, dpr);
    top = cy - min / 2;
    h = min;
  }
  return { x: left, y: top, w, h };
}

function fillBoxes(
  ctx: PaintContext,
  color: string,
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
): void {
  if (boxes.length === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const b of boxes) ctx.rect(b.x, b.y, b.w, b.h);
  ctx.fill();
}

function strokeBoxes(
  ctx: PaintContext,
  color: string,
  width: number,
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
): void {
  if (boxes.length === 0) return;
  applyStroke(ctx, color, width, "solid");
  ctx.beginPath();
  for (const b of boxes) ctx.rect(b.x, b.y, b.w, b.h);
  ctx.stroke();
}

export function paintCandles(
  ctx: PaintContext,
  geom: CandleGeom[],
  style: SeriesPaintStyle,
  view: PaintView,
): void {
  withClip(ctx, view.clipRect, () => {
    const dpr = viewDpr(view);
    const bars = geom.filter(isDrawableCandle);
    if (bars.length === 0) return;
    const wickW = wickWidthCss(bars[0].halfWidth, dpr);
    const borderW = snapWidth(1, dpr);
    const wicks = bars.filter((c) => c.wickVisible !== false);
    const bordered = bars.filter((c) => c.borderVisible !== false);

    for (const [color, batch] of groupByColor(wicks, (c) => c.wickColor ?? (c.up ? style.wickUpColor : style.wickDownColor))) {
      applyStroke(ctx, color, wickW, "solid");
      ctx.beginPath();
      for (const c of batch) {
        const x = snapPxForStroke(c.x, dpr, wickW);
        ctx.moveTo(x, snapPxForStroke(c.highY, dpr, wickW));
        ctx.lineTo(x, snapPxForStroke(c.lowY, dpr, wickW));
      }
      ctx.stroke();
    }

    for (const [color, batch] of groupByColor(bars, (c) => c.color ?? (c.up ? style.upColor : style.downColor))) {
      fillBoxes(ctx, color, batch.map((c) => bodyBox(c.x, c.halfWidth, c.openY, c.closeY, dpr)));
    }

    const minBorder = 2 * borderW;
    for (const [color, batch] of groupByColor(bordered, (c) => c.borderColor ?? (c.up ? style.borderUpColor : style.borderDownColor))) {
      const boxes = batch
        .map((c) => bodyBox(c.x, c.halfWidth, c.openY, c.closeY, dpr))
        .filter((b) => b.w > minBorder && b.h > minBorder);
      strokeBoxes(ctx, color, borderW, boxes);
    }
  });
}

export function paintBars(
  ctx: PaintContext,
  geom: BarGeom[],
  style: SeriesPaintStyle,
  view: PaintView,
): void {
  withClip(ctx, view.clipRect, () => {
    const dpr = viewDpr(view);
    const bars = geom.filter(isDrawableCandle);
    if (bars.length === 0) return;
    const strokeW = wickWidthCss(bars[0].halfWidth, dpr);

    for (const [color, batch] of groupByColor(bars, (c) => c.color ?? (c.up ? style.upColor : style.downColor))) {
      applyStroke(ctx, color, strokeW, "solid");
      ctx.beginPath();
      for (const b of batch) {
        const x = snapPxForStroke(b.x, dpr, strokeW);
        const openLen = finite(b.openTickLength) ? b.openTickLength : b.halfWidth;
        const closeLen = finite(b.closeTickLength) ? b.closeTickLength : b.halfWidth;
        ctx.moveTo(x, snapPxForStroke(b.highY, dpr, strokeW));
        ctx.lineTo(x, snapPxForStroke(b.lowY, dpr, strokeW));
        ctx.moveTo(snapPxForStroke(b.x - openLen, dpr, strokeW), snapPxForStroke(b.openY, dpr, strokeW));
        ctx.lineTo(x, snapPxForStroke(b.openY, dpr, strokeW));
        ctx.moveTo(x, snapPxForStroke(b.closeY, dpr, strokeW));
        ctx.lineTo(snapPxForStroke(b.x + closeLen, dpr, strokeW), snapPxForStroke(b.closeY, dpr, strokeW));
      }
      ctx.stroke();
    }
  });
}

function strokeRuns(
  ctx: PaintContext,
  runs: LineVertex[][],
  dpr: number,
  strokeW: number,
): void {
  if (runs.length === 0) return;
  ctx.beginPath();
  for (const run of runs) {
    if (run.length === 0) continue;
    ctx.moveTo(snapPxForStroke(run[0].x, dpr, strokeW), snapPxForStroke(run[0].y, dpr, strokeW));
    for (let i = 1; i < run.length; i++) {
      ctx.lineTo(snapPxForStroke(run[i].x, dpr, strokeW), snapPxForStroke(run[i].y, dpr, strokeW));
    }
  }
  ctx.stroke();
}

function fillRunsToBase(
  ctx: PaintContext,
  runs: LineVertex[][],
  baseY: number,
  dpr: number,
): void {
  if (runs.length === 0) return;
  const by = snapEdge(baseY, dpr);
  ctx.beginPath();
  for (const run of runs) {
    if (run.length === 0) continue;
    const first = run[0];
    const last = run[run.length - 1];
    ctx.moveTo(snapEdge(first.x, dpr), by);
    for (const p of run) ctx.lineTo(snapEdge(p.x, dpr), snapEdge(p.y, dpr));
    ctx.lineTo(snapEdge(last.x, dpr), by);
    ctx.closePath();
  }
  ctx.fill();
}

function finiteRuns(points: Array<LineVertex | null>): LineVertex[][] {
  const runs: LineVertex[][] = [];
  let run: LineVertex[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  };
  for (const p of points) {
    if (p == null || !finitePt(p)) flush();
    else run.push(p);
  }
  flush();
  return runs;
}

export function paintLine(
  ctx: PaintContext,
  geom: LinePolyline,
  style: SeriesPaintStyle,
  view: PaintView,
): void {
  withClip(ctx, view.clipRect, () => {
    const dpr = viewDpr(view);
    const runs = finiteRuns(geom.points);
    if (runs.length === 0) return;
    const width = style.lineWidth > 0 && finite(style.lineWidth) ? snapWidth(style.lineWidth, dpr) : 0;
    if (width <= 0) return;
    applyStroke(ctx, style.lineColor, width, style.lineStyle);
    strokeRuns(ctx, runs, dpr, width);
  });
}

export function paintArea(
  ctx: PaintContext,
  geom: AreaGeom,
  style: SeriesPaintStyle,
  view: PaintView,
): void {
  withClip(ctx, view.clipRect, () => {
    const dpr = viewDpr(view);
    if (!finite(geom.baseY)) return;
    const runs = finiteRuns(geom.line.points);
    if (runs.length === 0) return;
    ctx.fillStyle = style.topFillColor;
    fillRunsToBase(ctx, runs, geom.baseY, dpr);
    const width = style.lineWidth > 0 && finite(style.lineWidth) ? snapWidth(style.lineWidth, dpr) : 0;
    if (width <= 0) return;
    applyStroke(ctx, style.lineColor, width, style.lineStyle);
    strokeRuns(ctx, runs, dpr, width);
  });
}

export function paintHistogram(
  ctx: PaintContext,
  geom: HistogramGeom,
  style: SeriesPaintStyle,
  view: PaintView,
): void {
  withClip(ctx, view.clipRect, () => {
    const dpr = viewDpr(view);
    const cols = geom.columns.filter((c) => finiteAll(c.x, c.halfWidth, c.topY, c.baseY));
    if (cols.length === 0) return;
    for (const [color, batch] of groupByColor(cols, (c) => c.color ?? (c.up ? style.upColor : style.downColor))) {
      fillBoxes(ctx, color, batch.map((c) => bodyBox(c.x, c.halfWidth, c.topY, c.baseY, dpr)));
    }
  });
}

function interpolateX(a: LineVertex, b: LineVertex, baseY: number): number {
  const dy = b.y - a.y;
  if (dy === 0) return a.x;
  return a.x + ((baseY - a.y) / dy) * (b.x - a.x);
}

function splitBaseline(
  points: Array<LineVertex | null>,
  baseY: number,
): { above: LineVertex[][]; below: LineVertex[][] } {
  const above: LineVertex[][] = [];
  const below: LineVertex[][] = [];
  let curA: LineVertex[] | null = null;
  let curB: LineVertex[] | null = null;
  const pushA = (p: LineVertex): void => {
    if (!curA) {
      curA = [p];
      above.push(curA);
    } else curA.push(p);
  };
  const pushB = (p: LineVertex): void => {
    if (!curB) {
      curB = [p];
      below.push(curB);
    } else curB.push(p);
  };
  const signOf = (y: number): number => (y < baseY ? 1 : y > baseY ? -1 : 0);

  let prev: LineVertex | null = null;
  let prevSign = 0;
  for (const raw of points) {
    if (raw == null || !finitePt(raw)) {
      prev = null;
      curA = null;
      curB = null;
      prevSign = 0;
      continue;
    }
    const s = signOf(raw.y);
    if (prev == null) {
      if (s >= 0) pushA(raw);
      if (s <= 0) pushB(raw);
      if (s > 0) curB = null;
      if (s < 0) curA = null;
      prev = raw;
      prevSign = s;
      continue;
    }
    if (prevSign > 0 && s < 0) {
      const c = { x: interpolateX(prev, raw, baseY), y: baseY };
      pushA(c);
      curA = null;
      pushB(c);
      pushB(raw);
    } else if (prevSign < 0 && s > 0) {
      const c = { x: interpolateX(prev, raw, baseY), y: baseY };
      pushB(c);
      curB = null;
      pushA(c);
      pushA(raw);
    } else if (s > 0) {
      pushA(raw);
      curB = null;
    } else if (s < 0) {
      pushB(raw);
      curA = null;
    } else {
      pushA(raw);
      pushB(raw);
    }
    prev = raw;
    prevSign = s;
  }
  return { above, below };
}

export function paintBaseline(
  ctx: PaintContext,
  geom: BaselineGeom,
  style: SeriesPaintStyle,
  view: PaintView,
): void {
  withClip(ctx, view.clipRect, () => {
    const dpr = viewDpr(view);
    if (!finite(geom.baseY)) return;
    const { above, below } = splitBaseline(geom.line.points, geom.baseY);
    ctx.fillStyle = style.topFillColor;
    fillRunsToBase(ctx, above, geom.baseY, dpr);
    ctx.fillStyle = style.bottomFillColor;
    fillRunsToBase(ctx, below, geom.baseY, dpr);

    const width = style.lineWidth > 0 && finite(style.lineWidth) ? snapWidth(style.lineWidth, dpr) : 0;
    if (width > 0) {
      applyStroke(ctx, style.topLineColor, width, style.lineStyle);
      strokeRuns(ctx, above, dpr, width);
      applyStroke(ctx, style.bottomLineColor, width, style.lineStyle);
      strokeRuns(ctx, below, dpr, width);
    }

    const clip = view.clipRect;
    if (finiteRect(clip)) {
      applyStroke(ctx, style.baseValueColor, snapWidth(1, dpr), "solid");
      const y = snapPx(geom.baseY, dpr);
      ctx.beginPath();
      ctx.moveTo(clip.x, y);
      ctx.lineTo(clip.x + clip.width, y);
      ctx.stroke();
    }
  });
}

export function paintSeries<K extends SeriesKind>(
  ctx: PaintContext,
  kind: K,
  geom: PaintGeometryMap[K],
  style: SeriesPaintStyle,
  view: PaintView,
): void {
  switch (kind) {
    case "candles":
      paintCandles(ctx, geom as CandleGeom[], style, view);
      return;
    case "bars":
      paintBars(ctx, geom as BarGeom[], style, view);
      return;
    case "line":
      paintLine(ctx, geom as LinePolyline, style, view);
      return;
    case "area":
      paintArea(ctx, geom as AreaGeom, style, view);
      return;
    case "histogram":
      paintHistogram(ctx, geom as HistogramGeom, style, view);
      return;
    case "baseline":
      paintBaseline(ctx, geom as BaselineGeom, style, view);
      return;
    default: {
      const _never: never = kind;
      void _never;
    }
  }
}

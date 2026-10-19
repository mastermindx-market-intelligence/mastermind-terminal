// Native canvas renderer — pure series geometry (P3 / R02).
//
// Maps rows + a local Projection into painter-ready geometry for all six series
// kinds. No DOM, no lightweight-charts. Colors, border/wick flags and baseline
// values are read from the caller's options bag; this module never invents a
// palette. Every emitted item carries {index, time} so hit-testing can recover
// the source row. When barSpacing < 1, OHLC kinds collapse to VisualGeometry
// (device-pixel columns that keep true min/max) — aggregation is visual only.

import type {
  EngineBar,
  EnginePoint,
  EngineSeriesKind,
  EngineSeriesOptions,
  EngineSeriesRow,
  EngineTime,
} from "../api";

export type LogicalIndex = number;
export type TimeScaleState = {
  visibleFrom: number; visibleTo: number; barSpacing: number; rightOffset: number; widthPx: number;
};
export type PriceScaleState = {
  mode: "normal" | "log" | "percent" | "indexed100"; inverted: boolean;
  from: number; to: number; heightPx: number; margins: { top: number; bottom: number };
};
export type Projection = {
  generation: number; dpr: number; widthPx: number; heightPx: number;
  xOfLogical(i: number): number; logicalOfX(x: number): number;
  yOfPrice(p: number): number; priceOfY(y: number): number;
};
export type PointId = { index: number; time: EngineTime };
export type CandleBody = PointId & {
  x: number; yOpen: number; yClose: number; width: number; up: boolean;
  color?: string; borderVisible: boolean; borderColor?: string;
};
export type CandleWick = PointId & {
  x: number; yHigh: number; yLow: number; visible: boolean; color?: string;
};
export type BarTick = PointId & {
  x: number; yOpen: number; yHigh: number; yLow: number; yClose: number;
  openX: number; closeX: number; thinBars: boolean; up: boolean; color?: string;
};
export type LineVertex = { x: number; y: number };
export type LinePoint = PointId & { x: number; y: number; value: number; color?: string };
export type CurveControls = { cp1x: number; cp1y: number; cp2x: number; cp2y: number };
export type LineSegment = { points: LinePoint[]; vertices: LineVertex[]; curves?: CurveControls[] };
export type AreaFill = { vertices: LineVertex[]; closed: true };
export type HistogramColumn = PointId & {
  x: number; y: number; yBase: number; width: number; color?: string;
};
export type VisualColumn = {
  x: number; yHigh: number; yLow: number; yOpen: number; yClose: number;
  fromIndex: number; toIndex: number;
};
/** Visual-only aggregation. Must not be treated as source data. */
export type VisualGeometry = { readonly kind: "visual"; columns: VisualColumn[]; slice: [number, number] };
export type CandleGeometry = {
  bodies: CandleBody[]; wicks: CandleWick[]; slice: [number, number]; visual: VisualGeometry | null;
};
export type BarGeometry = { ticks: BarTick[]; slice: [number, number]; visual: VisualGeometry | null };
export type LineGeometry = { segments: LineSegment[]; lineType: 0 | 1 | 2; slice: [number, number] };
export type AreaGeometry = {
  segments: LineSegment[]; fills: AreaFill[]; baselineY: number; lineType: 0 | 1 | 2; slice: [number, number];
};
export type HistogramGeometry = {
  columns: HistogramColumn[]; slice: [number, number]; visual: VisualGeometry | null;
};
export type BaselineBand = { segments: LineSegment[]; fills: AreaFill[] };
export type BaselineGeometry = {
  baseY: number; basePrice: number; above: BaselineBand; below: BaselineBand;
  lineType: 0 | 1 | 2; slice: [number, number];
};
export type Extents = { min: number; max: number };

const CURVE_TENSION = 6;

export function snap(v: number, dpr: number): number {
  if (!Number.isFinite(v)) return v;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.round(v * ratio) / ratio;
}

/** LWC-mirroring body width: floor(barSpacing * 0.7) >= 1, gap >= 1px when spacing >= 3. */
export function barBodyWidth(barSpacing: number, dpr: number): number {
  const spacing = Number.isFinite(barSpacing) ? Math.abs(barSpacing) : 0;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  let width = Math.floor(spacing * 0.7);
  if (width < 1) width = 1;
  if (spacing >= 3) {
    const maxW = Math.floor(spacing) - 1;
    if (maxW >= 1 && width > maxW) width = maxW;
  }
  return snap(width, ratio);
}

export function barSpacingOf(proj: Projection): number {
  return proj.xOfLogical(1) - proj.xOfLogical(0);
}

export function createProjection(spec: {
  generation?: number;
  dpr: number;
  widthPx: number;
  heightPx: number;
  visibleFrom: number;
  visibleTo: number;
  priceFrom: number;
  priceTo: number;
  inverted?: boolean;
  margins?: { top: number; bottom: number };
}): Projection {
  const span = spec.visibleTo - spec.visibleFrom;
  const barSpacing = span === 0 ? spec.widthPx : spec.widthPx / span;
  const topPx = (spec.margins?.top ?? 0) * spec.heightPx;
  const bottomPx = (spec.margins?.bottom ?? 0) * spec.heightPx;
  const inner = Math.max(0, spec.heightPx - topPx - bottomPx);
  const priceSpan = spec.priceTo - spec.priceFrom;
  const inverted = !!spec.inverted;
  return {
    generation: spec.generation ?? 0,
    dpr: spec.dpr,
    widthPx: spec.widthPx,
    heightPx: spec.heightPx,
    xOfLogical(i: number): number {
      return (i - spec.visibleFrom + 0.5) * barSpacing;
    },
    logicalOfX(x: number): number {
      if (barSpacing === 0) return spec.visibleFrom;
      return spec.visibleFrom - 0.5 + x / barSpacing;
    },
    yOfPrice(p: number): number {
      if (priceSpan === 0) return topPx + inner / 2;
      const ratio = (p - spec.priceFrom) / priceSpan;
      return inverted ? topPx + ratio * inner : topPx + (1 - ratio) * inner;
    },
    priceOfY(y: number): number {
      if (inner === 0) return spec.priceFrom;
      const ratio = (y - topPx) / inner;
      return inverted ? spec.priceFrom + ratio * priceSpan : spec.priceTo - ratio * priceSpan;
    },
  };
}

export function visibleSlice(rows: readonly EngineSeriesRow[], proj: Projection): [number, number] {
  const n = rows.length;
  if (n === 0) return [0, -1];
  const visibleFrom = proj.logicalOfX(0) + 0.5;
  const visibleTo = proj.logicalOfX(proj.widthPx) + 0.5;
  const fromIndex = Math.max(0, Math.floor(visibleFrom) - 1);
  const toIndex = Math.min(n - 1, Math.ceil(visibleTo));
  if (fromIndex > toIndex) return [0, -1];
  return [fromIndex, toIndex];
}

function isBar(row: EngineSeriesRow): row is EngineBar {
  return "open" in row || "high" in row || "close" in row;
}
function isPoint(row: EngineSeriesRow): row is EnginePoint { return "value" in row; }
function finite(n: unknown): n is number { return typeof n === "number" && Number.isFinite(n); }
function barIsGap(row: EngineSeriesRow): boolean {
  return !isBar(row) || !finite(row.open) || !finite(row.high) || !finite(row.low) || !finite(row.close);
}
function pointIsGap(row: EngineSeriesRow): boolean { return !isPoint(row) || !finite(row.value); }
function optStr(opts: EngineSeriesOptions, key: string): string | undefined {
  const v = opts[key];
  return typeof v === "string" ? v : undefined;
}
function optBool(opts: EngineSeriesOptions, key: string, fallback: boolean): boolean {
  const v = opts[key];
  return typeof v === "boolean" ? v : fallback;
}
function optNum(opts: EngineSeriesOptions, key: string, fallback: number): number {
  const v = opts[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function lineTypeOf(opts: EngineSeriesOptions): 0 | 1 | 2 {
  const v = opts.lineType;
  return v === 1 || v === 2 ? v : 0;
}
function upColor(opts: EngineSeriesOptions, up: boolean): string | undefined {
  return up ? optStr(opts, "upColor") : optStr(opts, "downColor");
}

function denseColumns(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  slice: [number, number],
  asBars: boolean,
): VisualGeometry {
  const dpr = proj.dpr;
  const byCol = new Map<number, VisualColumn & { openP: number; closeP: number; highP: number; lowP: number }>();
  const [from, to] = slice;
  for (let i = from; i <= to; i++) {
    const row = rows[i];
    let openP: number;
    let highP: number;
    let lowP: number;
    let closeP: number;
    if (asBars) {
      if (barIsGap(row) || !isBar(row)) continue;
      openP = row.open;
      highP = row.high;
      lowP = row.low;
      closeP = row.close;
    } else {
      if (pointIsGap(row) || !isPoint(row)) continue;
      openP = highP = lowP = closeP = row.value;
    }
    const col = Math.floor(proj.xOfLogical(i) * dpr);
    const existing = byCol.get(col);
    if (!existing) {
      byCol.set(col, {
        x: snap((col + 0.5) / dpr, dpr), yHigh: 0, yLow: 0, yOpen: 0, yClose: 0,
        fromIndex: i, toIndex: i, openP, closeP, highP, lowP,
      });
    } else {
      existing.toIndex = i;
      existing.closeP = closeP;
      if (highP > existing.highP) existing.highP = highP;
      if (lowP < existing.lowP) existing.lowP = lowP;
    }
  }
  const columns: VisualColumn[] = [];
  for (const key of [...byCol.keys()].sort((a, b) => a - b)) {
    const col = byCol.get(key)!;
    columns.push({
      x: col.x,
      yHigh: snap(proj.yOfPrice(col.highP), dpr), yLow: snap(proj.yOfPrice(col.lowP), dpr),
      yOpen: snap(proj.yOfPrice(col.openP), dpr), yClose: snap(proj.yOfPrice(col.closeP), dpr),
      fromIndex: col.fromIndex, toIndex: col.toIndex,
    });
  }
  return { kind: "visual", columns, slice };
}

export function candleGeometry(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  opts: EngineSeriesOptions = {},
): CandleGeometry {
  const slice = visibleSlice(rows, proj);
  const spacing = barSpacingOf(proj);
  if (spacing < 1) {
    return { bodies: [], wicks: [], slice, visual: denseColumns(rows, proj, slice, true) };
  }
  const dpr = proj.dpr;
  const width = barBodyWidth(spacing, dpr);
  const borderVisible = optBool(opts, "borderVisible", true);
  const wickVisible = optBool(opts, "wickVisible", true);
  const bodies: CandleBody[] = [];
  const wicks: CandleWick[] = [];
  const [from, to] = slice;
  for (let i = from; i <= to; i++) {
    const row = rows[i];
    if (barIsGap(row) || !isBar(row)) continue;
    const up = row.close >= row.open;
    const color = upColor(opts, up);
    const x = snap(proj.xOfLogical(i), dpr);
    const id: PointId = { index: i, time: row.time };
    bodies.push({
      ...id,
      x,
      yOpen: snap(proj.yOfPrice(row.open), dpr),
      yClose: snap(proj.yOfPrice(row.close), dpr),
      width,
      up,
      color,
      borderVisible,
      borderColor: up
        ? optStr(opts, "borderUpColor") ?? optStr(opts, "borderColor")
        : optStr(opts, "borderDownColor") ?? optStr(opts, "borderColor"),
    });
    wicks.push({
      ...id,
      x,
      yHigh: snap(proj.yOfPrice(row.high), dpr),
      yLow: snap(proj.yOfPrice(row.low), dpr),
      visible: wickVisible,
      color: up
        ? optStr(opts, "wickUpColor") ?? optStr(opts, "wickColor") ?? color
        : optStr(opts, "wickDownColor") ?? optStr(opts, "wickColor") ?? color,
    });
  }
  return { bodies, wicks, slice, visual: null };
}

export function barGeometry(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  opts: EngineSeriesOptions = {},
): BarGeometry {
  const slice = visibleSlice(rows, proj);
  const spacing = barSpacingOf(proj);
  if (spacing < 1) {
    return { ticks: [], slice, visual: denseColumns(rows, proj, slice, true) };
  }
  const dpr = proj.dpr;
  const width = barBodyWidth(spacing, dpr);
  const thinBars = optBool(opts, "thinBars", false);
  const tickLen = thinBars ? snap(1, dpr) : snap(width / 2, dpr);
  const ticks: BarTick[] = [];
  const [from, to] = slice;
  for (let i = from; i <= to; i++) {
    const row = rows[i];
    if (barIsGap(row) || !isBar(row)) continue;
    const up = row.close >= row.open;
    const x = snap(proj.xOfLogical(i), dpr);
    ticks.push({
      index: i,
      time: row.time,
      x,
      yOpen: snap(proj.yOfPrice(row.open), dpr),
      yHigh: snap(proj.yOfPrice(row.high), dpr),
      yLow: snap(proj.yOfPrice(row.low), dpr),
      yClose: snap(proj.yOfPrice(row.close), dpr),
      openX: snap(x - tickLen, dpr),
      closeX: snap(x + tickLen, dpr),
      thinBars,
      up,
      color: upColor(opts, up),
    });
  }
  return { ticks, slice, visual: null };
}

function collectLinePoints(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  slice: [number, number],
): LinePoint[][] {
  const dpr = proj.dpr;
  const segments: LinePoint[][] = [];
  let current: LinePoint[] = [];
  const [from, to] = slice;
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (let i = from; i <= to; i++) {
    const row = rows[i];
    // LWC line items skip whitespace: the line runs straight on to the next valued point.
    if (pointIsGap(row) || !isPoint(row)) continue;
    current.push({
      index: i,
      time: row.time,
      x: snap(proj.xOfLogical(i), dpr),
      y: snap(proj.yOfPrice(row.value), dpr),
      value: row.value,
      color: row.color,
    });
  }
  flush();
  return segments;
}

function curveControlsFor(points: LinePoint[], dpr: number): CurveControls[] {
  const curves: CurveControls[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = i - 1;
    const to = i;
    const before = Math.max(0, from - 1);
    const after = Math.min(points.length - 1, to + 1);
    const cp1x = points[from].x + (points[to].x - points[before].x) / CURVE_TENSION;
    const cp1y = points[from].y + (points[to].y - points[before].y) / CURVE_TENSION;
    const cp2x = points[to].x - (points[after].x - points[from].x) / CURVE_TENSION;
    const cp2y = points[to].y - (points[after].y - points[from].y) / CURVE_TENSION;
    curves.push({
      cp1x: snap(cp1x, dpr),
      cp1y: snap(cp1y, dpr),
      cp2x: snap(cp2x, dpr),
      cp2y: snap(cp2y, dpr),
    });
  }
  return curves;
}

function verticesFor(points: LinePoint[], lineType: 0 | 1 | 2): LineVertex[] {
  if (points.length === 0) return [];
  if (lineType !== 1) return points.map((p) => ({ x: p.x, y: p.y }));
  const vertices: LineVertex[] = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    vertices.push({ x: points[i].x, y: points[i - 1].y });
    vertices.push({ x: points[i].x, y: points[i].y });
  }
  return vertices;
}

function decorateSegments(groups: LinePoint[][], lineType: 0 | 1 | 2, dpr: number): LineSegment[] {
  return groups.map((points) => {
    const seg: LineSegment = { points, vertices: verticesFor(points, lineType) };
    if (lineType === 2 && points.length >= 2) seg.curves = curveControlsFor(points, dpr);
    return seg;
  });
}

export function lineGeometry(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  opts: EngineSeriesOptions = {},
): LineGeometry {
  const slice = visibleSlice(rows, proj);
  const lineType = lineTypeOf(opts);
  const groups = collectLinePoints(rows, proj, slice);
  return { segments: decorateSegments(groups, lineType, proj.dpr), lineType, slice };
}

function closeFill(vertices: LineVertex[], baselineY: number): AreaFill | null {
  if (vertices.length === 0) return null;
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  return {
    closed: true,
    vertices: [...vertices, { x: last.x, y: baselineY }, { x: first.x, y: baselineY }],
  };
}

export function areaGeometry(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  opts: EngineSeriesOptions = {},
): AreaGeometry {
  const line = lineGeometry(rows, proj, opts);
  let baselineY: number;
  if (finite(opts.base)) baselineY = snap(proj.yOfPrice(opts.base), proj.dpr);
  else if (optBool(opts, "invertFilledArea", false)) baselineY = 0;
  else baselineY = snap(proj.heightPx, proj.dpr);
  const fills: AreaFill[] = [];
  for (const seg of line.segments) {
    const fill = closeFill(seg.vertices, baselineY);
    if (fill) fills.push(fill);
  }
  return { segments: line.segments, fills, baselineY, lineType: line.lineType, slice: line.slice };
}

export function histogramGeometry(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  opts: EngineSeriesOptions = {},
): HistogramGeometry {
  const slice = visibleSlice(rows, proj);
  const spacing = barSpacingOf(proj);
  if (spacing < 1) {
    return { columns: [], slice, visual: denseColumns(rows, proj, slice, false) };
  }
  const dpr = proj.dpr;
  const width = barBodyWidth(spacing, dpr);
  const base = optNum(opts, "base", 0);
  const yBase = snap(proj.yOfPrice(base), dpr);
  const fallbackColor = optStr(opts, "color");
  const columns: HistogramColumn[] = [];
  const [from, to] = slice;
  for (let i = from; i <= to; i++) {
    const row = rows[i];
    if (pointIsGap(row) || !isPoint(row)) continue;
    columns.push({
      index: i,
      time: row.time,
      x: snap(proj.xOfLogical(i), dpr),
      y: snap(proj.yOfPrice(row.value), dpr),
      yBase,
      width,
      color: row.color ?? fallbackColor,
    });
  }
  return { columns, slice, visual: null };
}

function interpolateCross(a: LinePoint, b: LinePoint, basePrice: number, proj: Projection): LinePoint {
  const span = b.value - a.value;
  const t = span === 0 ? 0.5 : (basePrice - a.value) / span;
  const x = snap(a.x + t * (b.x - a.x), proj.dpr);
  const y = snap(proj.yOfPrice(basePrice), proj.dpr);
  return { index: b.index, time: b.time, x, y, value: basePrice };
}

function splitBand(
  groups: LinePoint[][],
  basePrice: number,
  proj: Projection,
  lineType: 0 | 1 | 2,
  above: boolean,
): BaselineBand {
  const dpr = proj.dpr;
  const baseY = snap(proj.yOfPrice(basePrice), dpr);
  const out: LinePoint[][] = [];
  for (const points of groups) {
    let current: LinePoint[] = [];
    const flush = () => {
      if (current.length) out.push(current);
      current = [];
    };
    const keep = (p: LinePoint) => (above ? p.value >= basePrice : p.value < basePrice);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = i > 0 ? points[i - 1] : null;
      if (prev && keep(prev) !== keep(p)) {
        const cross = interpolateCross(prev, p, basePrice, proj);
        current.push(cross);
        if (keep(prev)) flush();
      }
      if (keep(p)) current.push(p);
      else flush();
    }
    flush();
  }
  const segments = decorateSegments(out, lineType, dpr);
  const fills: AreaFill[] = [];
  for (const seg of segments) {
    const fill = closeFill(seg.vertices, baseY);
    if (fill) fills.push(fill);
  }
  return { segments, fills };
}

export function baselineGeometry(
  rows: readonly EngineSeriesRow[],
  proj: Projection,
  opts: EngineSeriesOptions = {},
): BaselineGeometry {
  const slice = visibleSlice(rows, proj);
  const lineType = lineTypeOf(opts);
  const raw = opts.baseValue;
  let basePrice = 0;
  if (raw && typeof raw === "object" && finite((raw as { price?: unknown }).price)) {
    basePrice = (raw as { price: number }).price;
  } else if (finite(opts.base)) {
    basePrice = opts.base;
  }
  const groups = collectLinePoints(rows, proj, slice);
  return {
    baseY: snap(proj.yOfPrice(basePrice), proj.dpr),
    basePrice,
    above: splitBand(groups, basePrice, proj, lineType, true),
    below: splitBand(groups, basePrice, proj, lineType, false),
    lineType,
    slice,
  };
}

function consider(min: number, max: number, v: number): { min: number; max: number } {
  return { min: v < min ? v : min, max: v > max ? v : max };
}

export function extentsOf(
  rows: readonly EngineSeriesRow[],
  from: number,
  to: number,
  kind: EngineSeriesKind,
  opts: EngineSeriesOptions = {},
): Extents | null {
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(rows.length - 1, Math.floor(to));
  if (start > end) return null;
  let min = Infinity;
  let max = -Infinity;
  const ohlc = kind === "candles" || kind === "bars";
  for (let i = start; i <= end; i++) {
    const row = rows[i];
    if (ohlc) {
      if (!isBar(row)) continue;
      if (finite(row.high)) ({ min, max } = consider(min, max, row.high));
      if (finite(row.low)) ({ min, max } = consider(min, max, row.low));
      if (finite(row.open)) ({ min, max } = consider(min, max, row.open));
      if (finite(row.close)) ({ min, max } = consider(min, max, row.close));
    } else {
      if (!isPoint(row) || !finite(row.value)) continue;
      ({ min, max } = consider(min, max, row.value));
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (kind === "histogram") {
    const base = optNum(opts, "base", 0);
    ({ min, max } = consider(min, max, base));
  }
  if (kind === "baseline") {
    const raw = opts.baseValue;
    const price = raw && typeof raw === "object" && finite((raw as { price?: unknown }).price)
      ? (raw as { price: number }).price
      : optNum(opts, "base", 0);
    ({ min, max } = consider(min, max, price));
  }
  return { min, max };
}

// Mastermind Chart Engine — LWC price-axis labels for the native Canvas2D engine.
// Mirrors lightweight-charts v5.2.0: PriceAxisView + PriceAxisViewRenderer (label box,
// tick, separator, text), PriceAxisWidget._fixLabelOverlap / recalculateOverlapping
// (label stacking), PriceAxisWidget.optimalWidth, and ColorParser.generateContrastColors.
// Pure helpers plus one draw call; frame.ts decides which labels exist. No
// lightweight-charts import (chartEngineBoundary).

/** LWC PriceAxisRendererOptionsProvider.options() for a layout font. */
export type PriceAxisRendererOptions = {
  font: string;
  fontSize: number;
  borderSize: number;
  tickLength: number;
  paddingTop: number;
  paddingBottom: number;
  paddingInner: number;
  paddingOuter: number;
};

export function priceAxisRendererOptions(fontSize: number, fontFamily: string): PriceAxisRendererOptions {
  const tickLength = 5;
  const paddingTop = 2.5 / 12 * fontSize;
  return {
    font: `${fontSize}px ${fontFamily}`,
    fontSize,
    borderSize: 1,
    tickLength,
    paddingTop,
    paddingBottom: paddingTop,
    paddingInner: fontSize / 12 * tickLength,
    paddingOuter: fontSize / 12 * tickLength,
  };
}

export type Rgba = readonly [number, number, number, number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\s*\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/;
const COLOR_CACHE_CAP = 256;
const colorCache = new Map<string, Rgba | null>();

function parseHex(hex: string): Rgba {
  const h = hex.length <= 4 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? Math.round(n(6) / 255 * 10000) / 10000 : 1];
}

function rgbOfMatch(m: RegExpMatchArray): Rgba {
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] ? parseFloat(m[4]) : 1];
}

/** LWC getRgbStringViaBrowser: the computed colour of a hidden element; null if the
 *  browser rejects the string (the element's declared colour stays empty). */
function rgbViaBrowser(color: string): Rgba | null {
  if (typeof document === "undefined" || !document.body || typeof window === "undefined") return null;
  const el = document.createElement("div");
  el.style.display = "none";
  el.style.color = color;
  if (el.style.color === "") return null;
  document.body.appendChild(el);
  try {
    const m = window.getComputedStyle(el).color.match(RGB);
    return m ? rgbOfMatch(m) : null;
  } finally {
    document.body.removeChild(el);
  }
}

/**
 * A CSS colour as [r, g, b, a]. Hex and rgb()/rgba() are parsed directly; anything
 * else goes through the browser exactly as LWC does. Unparseable → null, where LWC
 * throws: mm then skips the label instead of failing the frame.
 */
export function parseCssColor(color: string): Rgba | null {
  if (typeof color !== "string" || color === "") return null;
  if (colorCache.has(color)) return colorCache.get(color) ?? null;
  const s = color.trim();
  let out: Rgba | null = null;
  if (HEX.test(s)) out = parseHex(s.slice(1));
  else {
    const m = s.match(RGB);
    out = m ? rgbOfMatch(m) : rgbViaBrowser(s);
  }
  if (colorCache.size >= COLOR_CACHE_CAP) colorCache.clear();
  colorCache.set(color, out);
  return out;
}

export type ContrastColors = { background: string; foreground: string };

/** LWC ColorParser.generateContrastColors: the label box drops alpha; text is black on
 *  a light box (NTSC grayscale > 160), white otherwise. */
export function contrastColors(color: string): ContrastColors | null {
  const rgba = parseCssColor(color);
  if (!rgba) return null;
  const gray = 0.199 * rgba[0] + 0.687 * rgba[1] + 0.114 * rgba[2];
  return { background: `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})`, foreground: gray > 160 ? "black" : "white" };
}

type Metrics = { width: number; actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number };

/** LWC TextWidthCache: digits 2-9 measure as 0, with textBaseline middle. */
function metricsOf(ctx: CanvasRenderingContext2D, text: string, re: RegExp = /[2-9]/g): Metrics {
  if (typeof ctx.measureText !== "function") return { width: text.length * 7 };
  const prev = ctx.textBaseline;
  ctx.textBaseline = "middle";
  const m = ctx.measureText(String(text).replace(re, "0")) as Metrics;
  ctx.textBaseline = prev;
  return m;
}

export function measureAxisText(ctx: CanvasRenderingContext2D, text: string, re?: RegExp): number {
  return metricsOf(ctx, text, re).width;
}

export function yMidCorrection(ctx: CanvasRenderingContext2D, text: string, re?: RegExp): number {
  const m = metricsOf(ctx, text, re);
  return ((m.actualBoundingBoxAscent || 0) - (m.actualBoundingBoxDescent || 0)) / 2;
}

/** One half (axis or pane) of an LWC PriceAxisView's renderer data. */
export type AxisLabelPart = {
  text: string;
  visible: boolean;
  color: string;
};

/**
 * LWC PriceAxisView common renderer data plus its two parts. The axis part draws in the
 * price axis (tick slot reserved, no separator); the pane part draws inside the pane
 * against the axis (no tick slot, separator in the pane background).
 */
export type AxisLabelView = {
  coordinate: number;
  renderCoordinate: number | null;
  fixedCoordinate: number | null;
  background: string;
  additionalPaddingTop: number;
  additionalPaddingBottom: number;
  axis: AxisLabelPart;
  pane: AxisLabelPart;
};

export function axisLabelView(init: Partial<AxisLabelView> & Pick<AxisLabelView, "coordinate" | "background">): AxisLabelView {
  return {
    renderCoordinate: null,
    fixedCoordinate: null,
    additionalPaddingTop: 0,
    additionalPaddingBottom: 0,
    axis: { text: "", visible: false, color: "white" },
    pane: { text: "", visible: false, color: "white" },
    ...init,
  };
}

export function labelVisible(v: AxisLabelView): boolean {
  return v.axis.visible || v.pane.visible;
}

/** LWC PriceAxisView.height: max of the two renderers (0 when hidden). The common
 *  additional padding is NOT part of it. */
export function labelHeight(v: AxisLabelView, ro: PriceAxisRendererOptions): number {
  return labelVisible(v) ? ro.fontSize + ro.paddingTop + ro.paddingBottom : 0;
}

/** LWC getRenderCoordinate. */
export function renderCoordinateOf(v: AxisLabelView): number {
  return v.fixedCoordinate ?? v.renderCoordinate ?? v.coordinate;
}

/** LWC recalculateOverlapping (dev:8967). dir 1 stacks upward-sorted labels, -1 downward. */
export function recalculateOverlapping(views: AxisLabelView[], direction: 1 | -1, scaleHeight: number, ro: PriceAxisRendererOptions): void {
  if (views.length === 0) return;
  let currentGroupStart = 0;
  const center = scaleHeight / 2;
  const initLabelHeight = labelHeight(views[0], ro);
  const rc0 = renderCoordinateOf(views[0]);
  let spaceBeforeCurrentGroup = direction === 1
    ? center - (rc0 - initLabelHeight / 2)
    : rc0 - initLabelHeight / 2 - center;
  spaceBeforeCurrentGroup = Math.max(0, spaceBeforeCurrentGroup);
  for (let i = 1; i < views.length; i++) {
    const view = views[i];
    const prev = views[i - 1];
    const height = labelHeight(prev, ro);
    const coordinate = renderCoordinateOf(view);
    const prevCoordinate = renderCoordinateOf(prev);
    const overlap = direction === 1 ? coordinate > prevCoordinate - height : coordinate < prevCoordinate + height;
    if (overlap) {
      const newCoordinate = prevCoordinate - height * direction;
      view.renderCoordinate = newCoordinate;
      const edgePoint = newCoordinate - direction * height / 2;
      const outOfViewport = direction === 1 ? edgePoint < 0 : edgePoint > scaleHeight;
      if (outOfViewport && spaceBeforeCurrentGroup > 0) {
        const desiredGroupShift = direction === 1 ? -1 - edgePoint : edgePoint - scaleHeight;
        const possibleShift = Math.min(desiredGroupShift, spaceBeforeCurrentGroup);
        for (let k = currentGroupStart; k < views.length; k++) {
          views[k].renderCoordinate = renderCoordinateOf(views[k]) + direction * possibleShift;
        }
        spaceBeforeCurrentGroup -= possibleShift;
      }
    } else {
      currentGroupStart = i;
      spaceBeforeCurrentGroup = direction === 1
        ? prevCoordinate - height - coordinate
        : coordinate - (prevCoordinate + height);
    }
  }
}

/** LWC PriceAxisWidget._fixLabelOverlap (dev:9412). Mutates renderCoordinate. */
export function fixLabelOverlap(views: AxisLabelView[], scaleHeight: number, center: number, ro: PriceAxisRendererOptions): void {
  const top = views.filter((v) => v.coordinate <= center).sort((a, b) => b.coordinate - a.coordinate);
  const bottom = views.filter((v) => v.coordinate > center);
  if (top.length && bottom.length) bottom.push(top[0]);
  bottom.sort((a, b) => a.coordinate - b.coordinate);
  for (const view of views) {
    const halfHeight = Math.floor(labelHeight(view, ro) / 2);
    const coordinate = renderCoordinateOf(view);
    if (coordinate > -halfHeight && coordinate < halfHeight) view.renderCoordinate = halfHeight;
    if (coordinate > scaleHeight - halfHeight && coordinate < scaleHeight + halfHeight) {
      view.renderCoordinate = scaleHeight - halfHeight;
    }
  }
  recalculateOverlapping(top, 1, scaleHeight, ro);
  recalculateOverlapping(bottom, -1, scaleHeight, ro);
}

/**
 * LWC PriceAxisWidget.optimalWidth (dev:9217): the widest of the mark, back-label and
 * crosshair-extreme texts plus the fixed tick/padding run, rounded up to an even width.
 */
export function optimalPriceAxisWidth(
  ctx: CanvasRenderingContext2D,
  ro: PriceAxisRendererOptions,
  texts: readonly string[],
  minimumWidth = 0,
): number {
  ctx.font = ro.font;
  let maxW = 0;
  for (const t of texts) {
    if (!t) continue;
    const w = measureAxisText(ctx, t);
    if (w > maxW) maxW = w;
  }
  const res = Math.ceil(ro.borderSize + ro.tickLength + ro.paddingInner + ro.paddingOuter + 5 + (maxW || 34));
  return Math.max(minimumWidth, res + (res % 2));
}

export type DrawLabelArgs = {
  view: AxisLabelView;
  part: "axis" | "pane";
  ro: PriceAxisRendererOptions;
  align: "left" | "right";
  /** Left edge of the target area in this ctx's CSS pixels (the axis strip or pane). */
  x0: number;
  /** The target area's media width (axis strip width, or pane width for a pane label). */
  mediaWidth: number;
  dpr: number;
  /** priceScale ticksVisible (default false): ANDed into the axis tick, as LWC renderer(). */
  ticksVisible: boolean;
  /** LWC paneBackgroundColor (layout background top colour) for the pane separator. */
  paneBackground: string;
};

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii: [number, number, number, number]): void {
  ctx.beginPath();
  const c = ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number[]) => void };
  if (typeof c.roundRect === "function") {
    c.roundRect(x, y, w, h, radii);
    return;
  }
  ctx.rect(x, y, w, h);
}

/**
 * LWC PriceAxisViewRenderer.draw (dev:1815). Geometry is computed in bitmap pixels and
 * drawn divided by dpr: the ctx carries setTransform(dpr), so each box edge lands on the
 * same device pixel LWC's bitmap-space draw does.
 */
export function drawPriceAxisLabel(ctx: CanvasRenderingContext2D, a: DrawLabelArgs): void {
  const { view, ro, dpr } = a;
  const data = view[a.part];
  if (!data.visible || data.text.length === 0) return;
  const axisPart = a.part === "axis";
  const tickVisible = axisPart && a.ticksVisible;
  const moveTextToInvisibleTick = !axisPart;
  const separatorVisible = !axisPart;
  const tickSize = (tickVisible || !moveTextToInvisibleTick) ? ro.tickLength : 0;
  const horzBorder = separatorVisible ? ro.borderSize : 0;
  const paddingTop = ro.paddingTop + view.additionalPaddingTop;
  const paddingBottom = ro.paddingBottom + view.additionalPaddingBottom;
  ctx.font = ro.font;
  const textMid = yMidCorrection(ctx, data.text);
  const textWidth = Math.ceil(measureAxisText(ctx, data.text));
  const totalHeight = ro.fontSize + paddingTop + paddingBottom;
  const totalWidth = ro.borderSize + ro.paddingInner + ro.paddingOuter + textWidth + tickSize;
  const tickHeightB = Math.max(1, Math.floor(dpr));
  let totalHeightB = Math.round(totalHeight * dpr);
  if (totalHeightB % 2 !== tickHeightB % 2) totalHeightB += 1;
  const horzBorderB = horzBorder > 0 ? Math.max(1, Math.floor(horzBorder * dpr)) : 0;
  const totalWidthB = Math.round(totalWidth * dpr);
  const tickSizeB = Math.round(tickSize * dpr);
  const yMid = renderCoordinateOf(view);
  const yMidB = Math.round(yMid * dpr) - Math.floor(dpr * 0.5);
  const yTopB = Math.floor(yMidB + tickHeightB / 2 - totalHeightB / 2);
  const yBottomB = yTopB + totalHeightB;
  const alignRight = a.align === "right";
  const bitmapWidth = Math.round(a.mediaWidth * dpr);
  const x0B = Math.round(a.x0 * dpr);
  const xInside = alignRight ? a.mediaWidth - horzBorder : horzBorder;
  const xInsideB = alignRight ? bitmapWidth - horzBorderB : horzBorderB;
  const xTickB = alignRight ? xInsideB - tickSizeB : xInsideB + tickSizeB;
  const xText = alignRight ? xInside - tickSize - ro.paddingInner - horzBorder : xInside + tickSize + ro.paddingInner;
  const radius = 2 * dpr;
  const px = (b: number) => (x0B + b) / dpr;
  const py = (b: number) => b / dpr;

  ctx.save();
  try {
    roundRectPath(
      ctx,
      px(alignRight ? xInsideB - totalWidthB : xInsideB),
      py(yTopB),
      totalWidthB / dpr,
      totalHeightB / dpr,
      (alignRight ? [radius, 0, 0, radius] : [0, radius, radius, 0]).map((r) => r / dpr) as [number, number, number, number],
    );
    ctx.fillStyle = view.background;
    ctx.fill();
  } finally {
    ctx.restore();
  }
  if (tickVisible) {
    ctx.fillStyle = data.color;
    ctx.fillRect(px(Math.min(xInsideB, xTickB)), py(yMidB), Math.abs(xTickB - xInsideB) / dpr, tickHeightB / dpr);
  }
  if (separatorVisible && a.paneBackground) {
    ctx.fillStyle = a.paneBackground;
    ctx.fillRect(px(alignRight ? bitmapWidth - horzBorderB : 0), py(yTopB), horzBorderB / dpr, (yBottomB - yTopB) / dpr);
  }
  ctx.textAlign = alignRight ? "right" : "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = data.color;
  ctx.fillText(data.text, a.x0 + xText, (yTopB / dpr + yBottomB / dpr) / 2 + textMid);
}

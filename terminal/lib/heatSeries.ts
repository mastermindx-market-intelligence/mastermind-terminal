/**
 * heatSeries.ts — TradingView Lightweight-Charts v5 custom-series heatmap plugin.
 *
 * This is the "paint surface" renderer: an intraday exposure/premium field painted
 * BEHIND the price candles. Each bar carries a vertical stack of `cells` ({low, high,
 * amount}); the renderer builds the native time×strike grid, interpolates ONLY across
 * the observed time coordinates into a screen-width raster, then scales strike rows with
 * nearest-neighbour sampling. That preserves real irregular snapshot spacing and crisp
 * strike bands instead of bilinear-blurring a tiny source image in both directions.
 *
 * Algorithm mirrors quanted's decoded renderer (research/quanted_options/js_extracts):
 *   1. Over the visible range, collect the union of unique cell boundaries → sorted
 *      levels `p`; grid height g = p.length - 1, width h = #visible bars.
 *   2. Build native amount/RGBA arrays, y-flipped so the highest price is the top row.
 *   3. Interpolate source columns at their ACTUAL chart x coordinates into a
 *      screen-width raster. Blit with smoothing disabled so price rows stay legible.
 *
 * The shader (`heatShade`) is a PURE function exported for unit testing — its exact
 * two-band curve (sqrt ramp to hue, then over-expose toward white above 60% of day-max)
 * is the signature and is asserted at o = 0/0.3/0.6/0.8/1.0 in heatSeries.test.ts.
 *
 * Colors: pos/neg RGB triplets are resolved from CSS vars at mount (default --up/--down),
 * so the East-Asian red-up flip (html[data-updown="east"]) is honored — never a hardcoded
 * direction hex (DESIGN_OBSERVATORY §2). Per-metric pairs are scaffolded for the greeks.
 */

import type {
  ICustomSeriesPaneView,
  ICustomSeriesPaneRenderer,
  PaneRendererCustomData,
  CustomSeriesPricePlotValues,
  PriceToCoordinateConverter,
  CustomData,
  CustomSeriesOptions,
  Time,
  WhitespaceData,
} from "lightweight-charts";
import { customSeriesDefaultOptions } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

// ─── RGB triplet helpers ────────────────────────────────────────────────────

export type Rgb = readonly [number, number, number];

/**
 * heatShade — the exact two-band diverging shader (see RECON §3, verbatim semantics).
 *
 * @param amount  signed cell value (e.g. net premium at a strike-minute)
 * @param maxAbs  max(|min|,|max|) over the field — the day-max used to normalize
 * @param pos     RGB triplet for positive amounts (from --up)
 * @param neg     RGB triplet for negative amounts (from --down)
 * @param W       opacity weight 0..1 (the pane opacity slider)
 * @returns an `rgba(r,g,b,a)` string
 *
 * Band 1 (o ≤ 0.6): sqrt-eased blend from the panel base to the full hue.
 * Band 2 (o > 0.6): over-expose toward white by up to 35% — the "hot core".
 * Alpha: 0.84·o^0.72, scaled by W. Zero/missing values are transparent, so empty cells
 * do not turn the selected session into a muddy rectangular block.
 */
export function heatShade(
  amount: number,
  maxAbs: number,
  pos: Rgb,
  neg: Rgb,
  W: number,
): string {
  const weight = Number.isFinite(W) ? Math.min(1, Math.max(0, W)) : 0;
  if (!(maxAbs > 0) || !Number.isFinite(maxAbs) || !Number.isFinite(amount)) {
    return "rgba(30,30,35,0.000)";
  }
  const o = Math.min(1, Math.abs(amount) / maxAbs);
  const c = amount >= 0 ? pos : neg;
  let r: number, g: number, b: number;
  if (o <= 0.6) {
    const e = Math.sqrt(o / 0.6);
    r = 30 + e * (c[0] - 30);
    g = 30 + e * (c[1] - 30);
    b = 35 + e * (c[2] - 35);
  } else {
    const e = ((o - 0.6) / 0.4) * 0.35;
    r = c[0] + (255 - c[0]) * e;
    g = c[1] + (255 - c[1]) * e;
    b = c[2] + (255 - c[2]) * e;
  }
  const a = 0.84 * Math.pow(o, 0.72) * weight;
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`;
}

export interface TimeInterpolation {
  left: number;
  right: number;
  mix: number;
}

/**
 * Locate the two observed time columns surrounding a chart x coordinate.
 *
 * Unlike stretching an h-pixel bitmap uniformly, this preserves long gaps between sparse
 * snapshots. Coordinates outside the observations clamp to the nearest edge column.
 */
export function timeInterpolation(
  sampleX: readonly number[],
  x: number,
): TimeInterpolation | null {
  if (!sampleX.length || !Number.isFinite(x)) return null;
  const last = sampleX.length - 1;
  if (x <= sampleX[0]) return { left: 0, right: 0, mix: 0 };
  if (x >= sampleX[last]) return { left: last, right: last, mix: 0 };

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (sampleX[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = sampleX[hi] - sampleX[lo];
  if (!(span > 0)) return { left: lo, right: lo, mix: 0 };
  return { left: lo, right: hi, mix: Math.min(1, Math.max(0, (x - sampleX[lo]) / span)) };
}

/**
 * The grid rows `[start, end)` a cell occupies, given the boundary→row lookup built from
 * the union of every visible cell boundary.
 *
 * A cell spans [low, high), which may cover MORE than one row whenever some other bar
 * contributed a boundary inside this cell's band. Keying a cell to the single row at its
 * `low` (the pre-fix behaviour) left those interior rows unwritten — transparent stripes
 * across the field on non-uniform ladders (B3). Returns null when the cell's `low` isn't a
 * known boundary; an unknown `high` degrades to a single row rather than dropping the cell.
 */
export function cellRowSpan(
  rowOf: Map<number, number>,
  cell: { low: number; high: number },
  g: number,
): [number, number] | null {
  const start = rowOf.get(cell.low);
  if (start === undefined || start >= g) return null;
  const endBoundary = rowOf.get(cell.high);
  const end = endBoundary === undefined ? start + 1 : Math.max(start + 1, endBoundary);
  return [start, Math.min(end, g)];
}

/** Parse an `rgb()/rgba()` string to `[r,g,b,a255]`. Falls back to transparent black. */
export function parseRgba(s: string): [number, number, number, number] {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]*)\)/);
  if (!m) return [0, 0, 0, 0];
  return [+m[1], +m[2], +m[3], Math.round((m[4] ? +m[4] : 1) * 255)];
}

/**
 * Parse a CSS color value to an RGB triplet. Supports `#rgb`, `#rrggbb`, and
 * `rgb()/rgba()`. Returns null when it can't be parsed (caller keeps its default).
 *
 * Used at mount to turn `getComputedStyle(...).getPropertyValue('--up')` into the
 * `pos`/`neg` triplets the shader needs. Re-resolve on theme / data-updown change.
 */
export function cssColorToRgb(raw: string): Rgb | null {
  const s = raw.trim();
  if (!s) return null;
  if (s[0] === "#") {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
    if (hex.length !== 6) return null;
    const n = Number.parseInt(hex, 16);
    if (Number.isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

/**
 * Resolve the pos/neg RGB pair for a metric from CSS custom properties.
 *
 * EVERY metric now resolves its OWN `--metric-<key>-pos/neg` pair. In observatory.css the
 * directional metrics default to `var(--up)` / `var(--down)`, so an untouched surface still
 * follows the theme's directional tokens and honours the East-Asian red-up flip; vanna and
 * charm default to fixed greek hues (NOT a bull/bear read, so they do not flip). Routing all
 * four through per-metric vars is what lets the surface theme engine
 * (components/surface/surfaceTheme) recolour any single metric by writing one inline custom
 * property — no hardcoded direction hex anywhere, and no chart remount.
 *
 * Those pair vars are .obs-scoped, so pass the pane's .obs-scoped root as `at` to resolve
 * them — falling back to documentElement and then to the west defaults.
 * SSR-safe (returns sensible defaults with no document).
 */
export const METRIC_COLOR_VARS: Record<string, { pos: string; neg: string }> = {
  netprem: { pos: "--metric-netprem-pos", neg: "--metric-netprem-neg" },
  gamma: { pos: "--metric-gamma-pos", neg: "--metric-gamma-neg" },
  gex: { pos: "--metric-gamma-pos", neg: "--metric-gamma-neg" }, // `gex` = the gamma grid key
  vanna: { pos: "--metric-vanna-pos", neg: "--metric-vanna-neg" },
  charm: { pos: "--metric-charm-pos", neg: "--metric-charm-neg" },
};

const DEFAULT_POS: Rgb = [38, 194, 129] as const; // --up west default
const DEFAULT_NEG: Rgb = [240, 86, 107] as const; // --down west default

export function resolveMetricColors(metric: string, at?: Element | null): { pos: Rgb; neg: Rgb } {
  const vars = METRIC_COLOR_VARS[metric] ?? METRIC_COLOR_VARS.netprem;
  if (typeof document === "undefined") return { pos: DEFAULT_POS, neg: DEFAULT_NEG };
  // Resolve against the pane's .obs-scoped element when given (so the greek pair vars
  // resolve), else :root (where --up/--down are defined).
  const el = at ?? document.documentElement;
  const cs = getComputedStyle(el);
  const pos = cssColorToRgb(cs.getPropertyValue(vars.pos)) ?? DEFAULT_POS;
  const neg = cssColorToRgb(cs.getPropertyValue(vars.neg)) ?? DEFAULT_NEG;
  return { pos, neg };
}

// ─── Series data + options ──────────────────────────────────────────────────

export interface HeatCell {
  low: number;
  high: number;
  amount: number;
}

/** One bar of the heat field: a time + its vertical stack of cells. */
export interface HeatData extends CustomData<Time> {
  time: Time;
  cells: HeatCell[];
}

export interface HeatSeriesOptions extends CustomSeriesOptions {
  /** Shader mapping a signed amount → rgba string. */
  cellShader: (amount: number) => string;
  /** Opacity weight 0..1 forwarded into the shader (redundant with cellShader's W;
   * kept so the plugin can be driven either way). */
  opacity: number;
}

export const heatSeriesDefaultOptions: HeatSeriesOptions = {
  ...customSeriesDefaultOptions,
  cellShader: () => "rgba(0,0,0,0)",
  opacity: 1,
  // The field is a background wash — never draw a price line or last-value label for it.
  priceLineVisible: false,
  lastValueVisible: false,
} as HeatSeriesOptions;

function isHeat(d: HeatData | WhitespaceData<Time>): d is HeatData {
  return Array.isArray((d as HeatData).cells) && (d as HeatData).cells.length > 0;
}

// ─── Renderer ───────────────────────────────────────────────────────────────

class HeatRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, HeatData> | null = null;
  private _options: HeatSeriesOptions | null = null;
  private _timeRaster: HTMLCanvasElement | OffscreenCanvas | null = null;
  private _rasterKey = "";

  update(
    data: PaneRendererCustomData<Time, HeatData>,
    options: HeatSeriesOptions,
  ): void {
    this._data = data;
    this._options = options;
  }

  destroy(): void {
    if (this._timeRaster) {
      this._timeRaster.width = 0;
      this._timeRaster.height = 0;
      this._timeRaster = null;
    }
    this._rasterKey = "";
    this._data = null;
    this._options = null;
  }

  draw(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter): void {
    const data = this._data;
    const options = this._options;
    if (!data || !options || !data.visibleRange) return;

    // MEDIA space: priceConverter returns CSS-pixel coords and the context is already
    // DPR-scaled, so we paint the upscaled field in CSS px (matches quanted's renderer).
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { bars, barSpacing, visibleRange } = data;
      if (!visibleRange) return;
      const { from, to } = visibleRange;
      const h = to - from; // number of visible bars = grid width
      if (h <= 0) return;

      // 1. Collect the union of unique cell boundaries across visible bars.
      const boundarySet = new Set<number>();
      let minLow = Infinity;
      let maxHigh = -Infinity;
      for (let i = from; i < to; i++) {
        const bar = bars[i];
        const cells = bar?.originalData?.cells;
        if (!cells) continue;
        for (const cell of cells) {
          boundarySet.add(cell.low);
          boundarySet.add(cell.high);
          if (cell.low < minLow) minLow = cell.low;
          if (cell.high > maxHigh) maxHigh = cell.high;
        }
      }
      if (minLow >= maxHigh) return;

      const boundaries = [...boundarySet].sort((a, b) => a - b);
      const g = Math.max(1, boundaries.length - 1); // grid height (level count)

      // Boundary → row index. A cell fills EVERY row in its [low,high) band (cellRowSpan),
      // not just the row at its `low` — otherwise interior rows contributed by another
      // bar's boundaries stay unwritten and read as transparent stripes (B3).
      const rowOf = new Map<number, number>();
      for (let i = 0; i < boundaries.length; i++) rowOf.set(boundaries[i], i);

      // 2. Native-resolution source arrays (one entry per observed time×strike cell).
      const buf = new Uint8ClampedArray(h * g * 4);
      const amounts = new Float64Array(h * g);
      for (let i = from; i < to; i++) {
        const bar = bars[i];
        const cells = bar?.originalData?.cells;
        if (!cells) continue;
        const col = i - from;
        for (const cell of cells) {
          const span = cellRowSpan(rowOf, cell, g);
          if (!span) continue;
          // One shader call per CELL (not per row) — the band is one value.
          const [r, gg, b, a] = parseRgba(options.cellShader(cell.amount));
          for (let row = span[0]; row < span[1]; row++) {
            const yFlipped = g - 1 - row; // highest price at the top row
            const px = (yFlipped * h + col) * 4;
            buf[px] = r;
            buf[px + 1] = gg;
            buf[px + 2] = b;
            buf[px + 3] = a;
            amounts[yFlipped * h + col] = cell.amount;
          }
        }
      }
      // 3. Build a screen-width time raster using the ACTUAL chart x positions. The old
      // path stretched every source column uniformly, which lied about sparse/irregular
      // snapshots and made an 11-column feed visibly blocky.
      const first = bars[from];
      const last = bars[to - 1];
      if (!first || !last) return;
      const firstGap = h > 1 ? Math.max(1, bars[from + 1].x - first.x) : barSpacing;
      const lastGap = h > 1 ? Math.max(1, last.x - bars[to - 2].x) : barSpacing;
      const xLeft = first.x - firstGap / 2;
      const xRight = last.x + lastGap / 2;
      if (xRight <= xLeft) return;
      // Every interval owns its numeric price extent, not an equal fraction of
      // the image. Re-project on each paint so zoom, inversion and log scales
      // agree with the price axis without rebuilding the cached time raster.
      const rowBounds = boundaries.map((price) => priceConverter(price));

      // One raster pixel per CSS pixel (capped for pathological zoom), then a final
      // nearest-neighbour vertical scale. Interpolation is horizontal only.
      const plotWidth = xRight - xLeft;
      const rasterWidth = Math.max(1, Math.min(4096, Math.ceil(plotWidth)));
      const sampleX = new Array<number>(h);
      for (let col = 0; col < h; col++) sampleX[col] = bars[from + col].x;
      // Crosshair motion redraws the pane without changing the field. Hash the compact
      // native source and geometry so that expensive screen-width interpolation is reused
      // during those redraws while still invalidating on data, palette, zoom, or pan.
      let sourceHash = 2166136261;
      for (let i = 0; i < buf.length; i++) {
        sourceHash ^= buf[i];
        sourceHash = Math.imul(sourceHash, 16777619);
      }
      const rasterKey = [
        sourceHash >>> 0,
        g,
        rasterWidth,
        xLeft.toFixed(3),
        xRight.toFixed(3),
        sampleX.map((x) => x.toFixed(3)).join(","),
      ].join(":");
      if (!this._timeRaster || this._timeRaster.width !== rasterWidth || this._timeRaster.height !== g) {
        try {
          this._timeRaster =
            typeof OffscreenCanvas !== "undefined"
              ? new OffscreenCanvas(rasterWidth, g)
              : document.createElement("canvas");
        } catch {
          this._timeRaster = document.createElement("canvas");
        }
        this._timeRaster.width = rasterWidth;
        this._timeRaster.height = g;
        this._rasterKey = "";
      }
      const tctx = this._timeRaster.getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!tctx) return;

      if (this._rasterKey !== rasterKey) {
        const timeImg = tctx.createImageData(rasterWidth, g);
        const timeBuf = timeImg.data;
        const mixes = new Array<TimeInterpolation>(rasterWidth);
        for (let outCol = 0; outCol < rasterWidth; outCol++) {
          const chartX = xLeft + ((outCol + 0.5) / rasterWidth) * plotWidth;
          mixes[outCol] = timeInterpolation(sampleX, chartX) ?? { left: 0, right: 0, mix: 0 };
        }
        for (let row = 0; row < g; row++) {
          for (let outCol = 0; outCol < rasterWidth; outCol++) {
            const { left, right, mix } = mixes[outCol];
            const amountL = amounts[row * h + left];
            const amountR = amounts[row * h + right];
            const [r, gg, b, a] = parseRgba(
              options.cellShader(amountL + (amountR - amountL) * mix),
            );
            const dst = (row * rasterWidth + outCol) * 4;
            timeBuf[dst] = r;
            timeBuf[dst + 1] = gg;
            timeBuf[dst + 2] = b;
            timeBuf[dst + 3] = a;
          }
        }
        tctx.putImageData(timeImg, 0, 0);
        this._rasterKey = rasterKey;
      }

      const prevSmoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      try {
        for (let row = 0; row < g; row++) {
          const low = rowBounds[row];
          const high = rowBounds[row + 1];
          if (low == null || high == null || !Number.isFinite(low) || !Number.isFinite(high)) continue;
          const height = Math.abs(high - low);
          if (height <= 0) continue;
          ctx.drawImage(
            this._timeRaster as CanvasImageSource,
            0, g - 1 - row, rasterWidth, 1,
            xLeft, Math.min(low, high), plotWidth, height,
          );
        }
      } finally {
        ctx.imageSmoothingEnabled = prevSmoothing;
      }
    });
  }
}

// ─── Pane view ──────────────────────────────────────────────────────────────

/**
 * HeatSeries — the ICustomSeriesPaneView the chart consumes.
 *
 * Usage:
 *   const view = new HeatSeries();
 *   const series = chart.addCustomSeries(view, { cellShader, opacity });
 *   series.setData(bars);   // bars: { time, cells:[{low,high,amount}] }[]
 */
export class HeatSeries implements ICustomSeriesPaneView<Time, HeatData, HeatSeriesOptions> {
  private _renderer = new HeatRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(
    data: PaneRendererCustomData<Time, HeatData>,
    options: HeatSeriesOptions,
  ): void {
    // Fold the conflation factor into barSpacing so wide zoom-outs still tile flush.
    this._renderer.update(
      {
        ...data,
        barSpacing: data.barSpacing * data.conflationFactor,
      } as PaneRendererCustomData<Time, HeatData>,
      options,
    );
  }

  priceValueBuilder(plotRow: HeatData): CustomSeriesPricePlotValues {
    if (!plotRow.cells || plotRow.cells.length === 0) return [0, 0, 0];
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of plotRow.cells) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    return [lo, hi, (lo + hi) / 2];
  }

  isWhitespace(d: HeatData | WhitespaceData<Time>): d is WhitespaceData<Time> {
    return !isHeat(d);
  }

  defaultOptions(): HeatSeriesOptions {
    return heatSeriesDefaultOptions;
  }

  destroy(): void {
    this._renderer.destroy();
  }
}

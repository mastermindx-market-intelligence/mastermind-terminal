// Mastermind Chart Engine — synchronous snapshot compositor (P3, R05).
//
// The renderer law (lib/chart-engine/api.ts: takeScreenshot(): HTMLCanvasElement) is that
// a screenshot is a synchronous composite of the engine's pane canvases plus its overlay
// canvases. This module implements that law for the native canvas renderer: it creates
// one output bitmap at device resolution (CSS size × dpr), paints the caller's background
// first (omitted → transparent; the palette always comes from the caller, this module
// never bakes in a color), then blits each layer in order with drawImage. Nothing here
// hands back future work of any kind — the ChartPanel snapshot flow
// (components/ChartPanel.tsx, "const src = chartRef.current.takeScreenshot()") consumes
// the canvas the moment it is returned, exactly as it consumes LWC's today.
//
// Evidence crops follow the house docs/pr-crops convention (one directory per feature,
// crops named NN-<viewport>-<lang>[-<theme>]-<slug>.png, captured at the device pixel
// ratio — e.g. Playwright Chromium at DPR 2). cropSnapshot() cuts a CSS-pixel rectangle
// and keeps the capture DPR, so the saved crop is the exact device bitmap of that region:
// no resample, the very bytes the renderer produced.
//
// Encoding has exactly one call site — snapshotDataUrl() — and it fails loudly: a host
// that cannot encode (jsdom without a canvas raster, stripped builds) raises a typed
// SnapshotUnavailableError instead of letting a silently blank "data:," leak into an
// evidence pipeline or a share card.
//
// Like everything under lib/chart-engine/canvas/, this module never imports
// "lightweight-charts", not even types: canvas sources are mirrored structurally.

/** A drawable 2D source. The renderer's panes/overlays are plain canvases;
 *  OffscreenCanvas is accepted structurally for layers the engine may paint off the DOM. */
export type SnapshotSource = HTMLCanvasElement | OffscreenCanvas;

/** One layer of the composite, positioned in CSS pixels. Drawn in array order. */
export interface SnapshotLayer {
  canvas: SnapshotSource;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Layer opacity in [0,1]; the previous globalAlpha is restored after the layer. */
  opacity?: number;
}

/** Output geometry: CSS-pixel size plus the device pixel ratio to rasterize at. */
export interface SnapshotSize {
  widthPx: number;
  heightPx: number;
  dpr: number;
}

export interface ComposeSnapshotOptions {
  /** Fill painted before any layer. Omit for a transparent background. */
  background?: string;
  /** Canvas factory, injectable so a host without a DOM (plain Node) can supply one. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

/** A pane canvas at its CSS-pixel layout slot (the canvas renderer's pane layout). */
export interface PaneLayerSource {
  canvas: SnapshotSource;
  top: number;
  height: number;
}

/** An overlay canvas spanning the whole chart (crosshair, drawings, …), drawn above panes. */
export interface OverlayLayerSource {
  canvas: SnapshotSource;
}

/** A rectangle in CSS pixels, as used for evidence crops. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropOptions {
  /** Canvas factory, injectable so a host without a DOM (plain Node) can supply one. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

// R05-A02: the failure is part of the interface. An encode that did not happen must
// surface as this type — never as a blank image the caller happily files as evidence.
export class SnapshotUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = "SnapshotUnavailableError";
  }
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new SnapshotUnavailableError(
      "chart-engine: no DOM available to create a snapshot canvas — pass opts.createCanvas",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// The one guarded context lookup: a host without a raster (jsdom) answers null (or
// throws "Not implemented"); either becomes the typed error, never a silent skip.
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch (err) {
    throw new SnapshotUnavailableError("chart-engine: 2d context unavailable for snapshot", { cause: err });
  }
  if (!ctx) {
    throw new SnapshotUnavailableError("chart-engine: 2d context unavailable for snapshot");
  }
  return ctx;
}

/**
 * Composite pane/overlay canvases into one screenshot bitmap, strictly synchronously
 * (R05-A01). The output canvas is `round(widthPx * dpr) × round(heightPx * dpr)` device
 * pixels; layers are drawn in order at dpr-scaled positions; `opacity` rides on
 * globalAlpha and is restored after each layer.
 */
export function composeSnapshot(
  layers: SnapshotLayer[],
  size: SnapshotSize,
  opts: ComposeSnapshotOptions = {},
): HTMLCanvasElement {
  const outW = Math.round(size.widthPx * size.dpr);
  const outH = Math.round(size.heightPx * size.dpr);
  const out = (opts.createCanvas ?? defaultCreateCanvas)(outW, outH);
  // The bitmap size is this module's law, not the factory's: re-assert it so an injected
  // factory can only choose WHERE the canvas comes from, never its resolution.
  out.width = outW;
  out.height = outH;
  const ctx = context2d(out);
  if (opts.background !== undefined) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, outW, outH);
  }
  for (const layer of layers) {
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(
      layer.canvas,
      layer.x * size.dpr,
      layer.y * size.dpr,
      layer.width * size.dpr,
      layer.height * size.dpr,
    );
    ctx.globalAlpha = prevAlpha;
  }
  return out;
}

/**
 * Pane layout → layer list for the engine's takeScreenshot(): each pane canvas becomes a
 * full-width layer at its CSS `top`, then each overlay becomes a full-chart layer above
 * them (ChartPanel composites its indicator/signals/drawings overlays in exactly that
 * stacking order). The composed height is the lowest pane edge, so overlays cover every
 * pane even when pane tops are not contiguous.
 */
export function layersFromPanes(
  panes: PaneLayerSource[],
  overlays: OverlayLayerSource[],
  width: number,
): SnapshotLayer[] {
  const totalHeight = panes.reduce((bottom, pane) => Math.max(bottom, pane.top + pane.height), 0);
  const layers: SnapshotLayer[] = panes.map((pane) => ({
    canvas: pane.canvas,
    x: 0,
    y: pane.top,
    width,
    height: pane.height,
  }));
  for (const overlay of overlays) {
    layers.push({ canvas: overlay.canvas, x: 0, y: 0, width, height: totalHeight });
  }
  return layers;
}

/**
 * Cut a pixel-exact evidence crop (R05-A03): `rect` is in CSS pixels against a snapshot
 * rasterized at `dpr`; the result is the device bitmap of that region at native
 * resolution, ready for a `NN-<viewport>-<lang>[-<theme>]-<slug>.png` crop under
 * docs/pr-crops/. The rect's EDGES (not origin and size separately) snap to the device
 * grid, so integer-aligned rects copy 1:1 (source rect == dest rect: a straight blit
 * with no resampling — the crop is byte-identical to the region) and adjacent crops
 * share an exact edge with no gap and no doubled pixel row.
 */
export function cropSnapshot(
  src: HTMLCanvasElement,
  rect: CropRect,
  dpr: number,
  opts: CropOptions = {},
): HTMLCanvasElement {
  const sx0 = Math.round(rect.x * dpr);
  const sx1 = Math.round((rect.x + rect.w) * dpr);
  const sy0 = Math.round(rect.y * dpr);
  const sy1 = Math.round((rect.y + rect.h) * dpr);
  const sw = sx1 - sx0;
  const sh = sy1 - sy0;
  if (sw <= 0 || sh <= 0) {
    throw new RangeError(
      `chart-engine: degenerate crop ${sw}x${sh} from rect {x:${rect.x}, y:${rect.y}, w:${rect.w}, h:${rect.h}} at dpr ${dpr}`,
    );
  }
  const out = (opts.createCanvas ?? defaultCreateCanvas)(sw, sh);
  out.width = sw;
  out.height = sh;
  const ctx = context2d(out);
  ctx.drawImage(src, sx0, sy0, sw, sh, 0, 0, sw, sh);
  return out;
}

/**
 * The single toDataURL call site in the engine. Returns the data URL, or throws a typed
 * SnapshotUnavailableError when the host cannot encode — a missing/throwing toDataURL or
 * a blank "data:," / "data:" answer (the empty-image sentinel some hosts return) is an
 * explicit failure, never a silently blank PNG (R05-A02).
 */
export function snapshotDataUrl(canvas: HTMLCanvasElement, type = "image/png"): string {
  if (typeof canvas.toDataURL !== "function") {
    throw new SnapshotUnavailableError(`chart-engine: toDataURL is not implemented (requested ${type})`);
  }
  let url: unknown;
  try {
    url = canvas.toDataURL(type);
  } catch (err) {
    throw new SnapshotUnavailableError(`chart-engine: toDataURL(${type}) failed`, { cause: err });
  }
  // A real encode is "data:<mediatype>[;base64],<payload>" with a non-empty payload.
  if (
    typeof url !== "string" ||
    !url.startsWith("data:") ||
    !url.includes(",") ||
    url.slice(url.indexOf(",") + 1).length === 0
  ) {
    throw new SnapshotUnavailableError(`chart-engine: toDataURL(${type}) returned no image data`);
  }
  return url;
}

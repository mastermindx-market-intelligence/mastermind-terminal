import type { PriceLineSpec } from "./chart-engine";
import { axisValueAtCoordinate, zoomAxisRange, type AxisMargins, type AxisRange } from "./chart-engine/axisZoom";
import { validOptionsChartLevel, type OptionsChartLevel } from "./optionsCompanion";

// ChartPanel reads line.options(); the rest of the handle stays opaque in this file.
interface PinLine { options(): unknown }

interface PinHost<L extends PinLine = PinLine> {
  createPriceLine(options: PriceLineSpec): L;
  removePriceLine(line: L): void;
}
export interface OptionsPricePin<L extends PinLine = PinLine> { host: PinHost<L>; line: L; key: string }

export function removeOptionsPricePin<L extends PinLine = PinLine>(pin: OptionsPricePin<L> | null): null {
  if (pin) { try { pin.host.removePriceLine(pin.line); } catch { /* chart/series may already have been disposed */ } }
  return null;
}

/** Idempotent, native price-line update. Never mutates chart identity, OHLC, user drawings or saved workspaces. The host is the chart-engine price-line contract, so this file stays outside the G01 boundary. */
export function syncOptionsPricePin<L extends PinLine = PinLine>(current: OptionsPricePin<L> | null, host: PinHost<L> | null,
  level: OptionsChartLevel | null | undefined, root: string, allowed: boolean, color: string): OptionsPricePin<L> | null {
  if (!host || !allowed || !validOptionsChartLevel(level, root)) return removeOptionsPricePin(current);
  const key = JSON.stringify([root, level.price, level.session, level.label, color]);
  if (current?.host === host && current.key === key) return current;
  removeOptionsPricePin(current);
  try {
    const line = host.createPriceLine({ price: level.price, color, lineWidth: 1, lineStyle: 2 /* dashed */,
      axisLabelVisible: true, title: level.label.slice(0, 64) });
    return { host, line, key };
  } catch { return null; }
}

export type OptionsPinVisibility = "visible" | "offscreen" | "unavailable";

/** A view receipt for one exact qualified level and one native series host.
 * A stale host's reveal callback cannot act on a newer chart or source read. */
export interface OptionsPinViewport {
  level: OptionsChartLevel;
  generation: object;
  state: OptionsPinVisibility;
  coordinate: number | null;
  paneHeight: number;
  reveal: () => void;
}

/**
 * Where a synced pin's coordinate actually renders: inside the pane extent
 * (0..paneHeight, and inside the optional clipped viewport band when one is
 * supplied), outside that extent, or unknowable because the coordinate or the
 * geometry is not usable. A zero-height or non-finite viewport band cannot show
 * anything, so it never classifies as visible. Pure arithmetic over pixels the
 * chart layer already measured — no DOM, chart, series or data access.
 */
export function optionsPinVisibility(coordinate: number | null, paneHeight: number,
  viewport?: { from: number; to: number }): OptionsPinVisibility {
  if (coordinate === null || !Number.isFinite(coordinate)) return "unavailable";
  if (!Number.isFinite(paneHeight) || paneHeight <= 0) return "unavailable";
  if (viewport != null) {
    if (!Number.isFinite(viewport.from) || !Number.isFinite(viewport.to)) return "unavailable";
    const bandTop = Math.max(0, Math.min(viewport.from, viewport.to));
    const bandBottom = Math.min(paneHeight, Math.max(viewport.from, viewport.to));
    if (bandBottom <= bandTop) return "offscreen";
    if (coordinate < bandTop || coordinate > bandBottom) return "offscreen";
  }
  if (coordinate < 0 || coordinate > paneHeight) return "offscreen";
  return "visible";
}

/**
 * Range that brings an offscreen pin's coordinate back into view, in the already
 * linearized native display domain the caller supplies — no price/percent/index/
 * log conversion happens here, so the result goes straight back to the same
 * setter domain the input range came from. Expansion is uniform about the range
 * centre through the existing zoomAxisRange primitive, sized from the
 * coordinate's actual offscreen distance so the target lands inside the inner
 * (margin-respecting) pane band with breathing room; an inverted range keeps its
 * orientation. A coordinate already inside the pane returns the input range
 * object unchanged, so a scroll-only reveal never rescales. Unusable range,
 * geometry or target returns null instead of a guess; inputs are never mutated
 * and results are never NaN.
 */
export function optionsPinRevealRange(range: AxisRange | null, coordinate: number | null, paneHeight: number,
  margins: AxisMargins): AxisRange | null {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from === range.to) return null;
  if (coordinate === null || !Number.isFinite(coordinate)) return null;
  if (!Number.isFinite(paneHeight) || paneHeight <= 1) return null;
  const { top, bottom } = margins;
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top < 0 || bottom < 0) return null;
  const topPx = top * paneHeight;
  const bottomPx = bottom * paneHeight;
  const internalHeight = paneHeight - topPx - bottomPx;
  if (!(internalHeight > 1)) return null;
  if (coordinate >= 0 && coordinate <= paneHeight) return range;

  // The renderer's coordinate mapping is linear (chart-engine/axisZoom), so the
  // value under an offscreen coordinate is that same line extended past the pane
  // edges: sample the two in-pane points axisValueAtCoordinate already provides.
  // That function only accepts ascending ranges, so an inverted range is sampled
  // ascending and reflected about the centre — its rendered mirror image.
  const low = Math.min(range.from, range.to);
  const high = Math.max(range.from, range.to);
  const sorted: AxisRange = { from: low, to: high };
  const sortedValueAtTop = axisValueAtCoordinate(sorted, 0, paneHeight, margins);
  const sortedValueAtBottom = axisValueAtCoordinate(sorted, paneHeight - 1, paneHeight, margins);
  const sortedTarget = sortedValueAtTop + (sortedValueAtBottom - sortedValueAtTop) * (coordinate / (paneHeight - 1));
  const targetValue = range.from <= range.to ? sortedTarget : low + high - sortedTarget;
  const position = (targetValue - range.from) / (range.to - range.from);
  // An offscreen coordinate must map outside the range; anything else is unusable.
  if (!Number.isFinite(position) || (position >= 0 && position <= 1)) return null;

  // position > 1 sits beyond the `to` end at the pane's top, < 0 beyond the
  // `from` end at the bottom — for inverted ranges (from > to) alike.
  const innerSpan = internalHeight - 1;
  const sideMarginPx = position > 1 ? topPx : bottomPx;
  const insetPx = Math.min(Math.max(sideMarginPx, innerSpan / 8), innerSpan / 4);
  const landing = position > 1 ? 1 - insetPx / innerSpan : insetPx / innerSpan;
  const factor = (position - 0.5) / (landing - 0.5);
  if (!Number.isFinite(factor) || factor <= 1) return null;

  const expanded = zoomAxisRange({ from: low, to: high }, (low + high) / 2, factor);
  if (!Number.isFinite(expanded.from) || !Number.isFinite(expanded.to)) return null;
  if (!(expanded.to - expanded.from > high - low)) return null; // numeric limit reached; keep the caller's range
  return range.from < range.to ? expanded : { from: expanded.to, to: expanded.from };
}

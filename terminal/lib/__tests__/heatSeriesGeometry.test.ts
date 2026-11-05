import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeatSeries, type HeatCell } from "@/lib/heatSeries";
import type { Time, PriceToCoordinateConverter } from "lightweight-charts";

// Execute the production renderer. This tiny raster target records its actual output
// geometry; it does not duplicate the renderer's price-to-row calculation.
class Raster {
  width: number;
  height: number;
  image: { width: number; height: number; data: Uint8ClampedArray } | null = null;
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  getContext() {
    return {
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image: Raster["image"]) => { this.image = image; },
    };
  }
}

type Blit = { source: Raster; sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };
function target() {
  const blits: Blit[] = [];
  const context = {
    imageSmoothingEnabled: true,
    drawImage(source: Raster, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      blits.push({ source, sx, sy, sw, sh, dx, dy, dw, dh });
    },
  };
  const value = { useMediaCoordinateSpace: (fn: (scope: unknown) => void) => fn({ context, mediaSize: { width: 200, height: 1200 } }) };
  return {
    value,
    context,
    // Read a CSS-pixel position from the image commands actually emitted by HeatSeries.
    redAt(x: number, y: number): number | null {
      const hit = [...blits].reverse().find((b) => x >= b.dx && x < b.dx + b.dw && y >= b.dy && y < b.dy + b.dh);
      if (!hit?.source.image) return null;
      const ix = Math.floor(hit.sx + (x - hit.dx) / hit.dw * hit.sw);
      const iy = Math.floor(hit.sy + (y - hit.dy) / hit.dh * hit.sh);
      return hit.source.image.data[(iy * hit.source.image.width + ix) * 4];
    },
  };
}

const irregular: HeatCell[] = [
  { low: 99.5, high: 100.5, amount: 1 },
  { low: 100.5, high: 105.5, amount: 2 },
  { low: 105.5, high: 114.5, amount: 3 },
];

function viewFor(cells: HeatCell[]) {
  const view = new HeatSeries();
  view.update({
    bars: [10, 20].map((x, i) => ({ x, time: i, barColor: "transparent", originalData: { time: (100 + i) as Time, cells } })),
    barSpacing: 10,
    conflationFactor: 1,
    visibleRange: { from: 0, to: 2 },
  } as Parameters<HeatSeries["update"]>[0], {
    ...view.defaultOptions(),
    cellShader: (amount: number) => `rgba(${Math.round(amount * 40)},0,0,1)`,
  });
  return view;
}

function paint(view: HeatSeries, converter: (price: number) => number | null) {
  const out = target();
  view.renderer().draw(out.value as unknown as Parameters<ReturnType<HeatSeries["renderer"]>["draw"]>[0], converter as PriceToCoordinateConverter, false);
  return out;
}

beforeEach(() => { vi.stubGlobal("OffscreenCanvas", Raster); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("HeatSeries actual raster geometry", () => {
  it("places nonuniform bands at their numeric prices rather than equal-height rows", () => {
    const out = paint(viewFor(irregular), (price) => (120 - price) * 10);
    expect(out.redAt(15, 180)).toBe(80); // price 102: the middle band, not the narrow bottom band
    expect(out.redAt(15, 200)).toBe(40); // price 100
    expect(out.redAt(15, 100)).toBe(120); // price 110
    expect(out.context.imageSmoothingEnabled).toBe(true);
  });

  it("preserves uniform-band geometry", () => {
    const cells = [100, 105, 110].map((low, i) => ({ low, high: low + 5, amount: i + 1 }));
    const out = paint(viewFor(cells), (price) => (120 - price) * 10);
    expect(out.redAt(15, 175)).toBe(40);
    expect(out.redAt(15, 125)).toBe(80);
    expect(out.redAt(15, 75)).toBe(120);
  });

  it("uses the converter on an inverted price axis", () => {
    const out = paint(viewFor(irregular), (price) => (price - 90) * 10);
    expect(out.redAt(15, 120)).toBe(80);
    expect(out.redAt(15, 100)).toBe(40);
    expect(out.redAt(15, 200)).toBe(120);
  });

  it("uses the actual nonlinear converter for internal boundaries", () => {
    const toY = (price: number) => 1000 - 100 * Math.log(price);
    const out = paint(viewFor(irregular), toY);
    expect(out.redAt(15, toY(102))).toBe(80);
    expect(out.redAt(15, toY(100))).toBe(40);
    expect(out.redAt(15, toY(110))).toBe(120);
  });

  it("updates price geometry while reusing an unchanged time raster", () => {
    const view = viewFor(irregular);
    paint(view, (price) => (120 - price) * 10);
    const out = paint(view, (price) => (115 - price) * 20);
    expect(out.redAt(15, 260)).toBe(80); // still price 102 after zoom and pan
  });

  it("does not discard projectable bands when an outer boundary is unavailable", () => {
    const out = paint(viewFor(irregular), (price) => price > 110 ? null : (120 - price) * 10);
    expect(out.redAt(15, 180)).toBe(80);
    expect(out.redAt(15, 200)).toBe(40);
    expect(out.redAt(15, 100)).toBeNull();
  });
});

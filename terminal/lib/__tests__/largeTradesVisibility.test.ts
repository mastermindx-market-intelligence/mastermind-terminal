import { describe, expect, it } from "vitest";
import { largeTradesClip, largeTradesControlBounds, largeTradesPlotBounds, largeTradesPoint, resolveLargeTradesPricePane } from "../largeTrades/visibility";

const price = { key: "__price__", paneIndex: 0, top: 0, height: 500, collapsed: false };
const normal = { maximized: null, collapsed: new Set<string>() };

describe("large-trade price pane ownership", () => {
  it("rejects an absent price pane instead of using the hidden native sliver", () => {
    expect(resolveLargeTradesPricePane(null, normal, 0)).toBeNull();
    expect(largeTradesPlotBounds(null, 0, 800)).toBeNull();
  });
  it("honors the synchronous nonprice maximize control before measured layout catches up", () => {
    expect(resolveLargeTradesPricePane(price, { ...normal, maximized: "rsi" }, 0)).toBeNull();
  });
  it("honors synchronous price collapse even when measured collapsed is still false", () => {
    expect(resolveLargeTradesPricePane(price, { ...normal, collapsed: new Set(["__price__"]) }, 0)).toBeNull();
  });
  it("admits a maximized price pane and waits for a fresh measured pane on restore", () => {
    expect(resolveLargeTradesPricePane(price, { ...normal, maximized: "__price__" }, 0)).toEqual(price);
    expect(resolveLargeTradesPricePane(null, normal, 0)).toBeNull();
    expect(resolveLargeTradesPricePane(price, normal, 0)).toEqual(price);
  });
  it("rejects a stale pane index during reorder and then uses the measured new top", () => {
    expect(resolveLargeTradesPricePane(price, normal, 1)).toBeNull();
    const moved = { ...price, paneIndex: 1, top: 180, height: 320 };
    const admitted = resolveLargeTradesPricePane(moved, normal, 1);
    const plot = largeTradesPlotBounds(admitted, 60, 800)!;
    expect(largeTradesPoint(plot, 125, 80)).toEqual({ x: 185, y: 260 });
  });
  it.each([0, -1, NaN, Infinity])("rejects nonpositive or unmeasurable height %s", (height) => {
    expect(resolveLargeTradesPricePane({ ...price, height }, normal, 0)).toBeNull();
  });
  it.each([-1, NaN, Infinity])("rejects an invalid pane top %s", (top) => {
    expect(resolveLargeTradesPricePane({ ...price, top }, normal, 0)).toBeNull();
  });
  it("rejects a collapsed measured pane and retired native pane", () => {
    expect(resolveLargeTradesPricePane({ ...price, collapsed: true }, normal, 0)).toBeNull();
    expect(resolveLargeTradesPricePane(price, normal, null)).toBeNull();
  });
});

describe("large-trade bounded controls and mandatory context", () => {
  it("keeps the complete dock/inspector containing rectangle below the native pane header and above RSI", () => {
    expect(largeTradesControlBounds({ x: 64, y: 120, width: 800, height: 300 }, 934, 620))
      .toEqual({ x: 64, y: 168, width: 800, height: 252 });
  });
  it("intersects the viewport without moving a control into another pane or either axis", () => {
    expect(largeTradesControlBounds({ x: 64, y: 120, width: 800, height: 300 }, 934, 620,
      { x: 100, y: 200, width: 500, height: 160 })).toEqual({ x: 100, y: 200, width: 500, height: 160 });
  });
  it("admits exactly one44px target with8px padding and rejects one pixel less", () => {
    expect(largeTradesControlBounds({ x: 0, y: 0, width: 60, height: 108 }, 60, 108))
      .toEqual({ x: 0, y: 48, width: 60, height: 60 });
    expect(largeTradesControlBounds({ x: 0, y: 0, width: 60, height: 107 }, 60, 107)).toBeNull();
    expect(largeTradesControlBounds({ x: 0, y: 0, width: 59, height: 108 }, 59, 108)).toBeNull();
  });
  it("co-hides the feature for an absent or fully scrolled-out price owner", () => {
    expect(largeTradesControlBounds(null, 390, 600)).toBeNull();
    expect(largeTradesControlBounds({ x: 0, y: 0, width: 320, height: 300 }, 390, 600,
      { x: 0, y: 400, width: 390, height: 200 })).toBeNull();
  });
  it("readmits the unchanged enabled study after a short owning price pane is restored", () => {
    const small = { x: 0, y: 0, width: 320, height: 90 };
    expect(largeTradesControlBounds(small, 390, 600)).toBeNull();
    expect(largeTradesControlBounds({ ...small, height: 320 }, 390, 600))
      .toEqual({ x: 0, y: 48, width: 320, height: 272 });
  });
  it.each([NaN, Infinity, -1])("rejects an invalid viewport height %s", (height) => {
    expect(largeTradesControlBounds({ x: 0, y: 0, width: 320, height: 300 }, 390, 600,
      { x: 0, y: 0, width: 390, height })).toBeNull();
  });
});

describe("large-trade plot coordinates and clipping", () => {
  it("adds the visible left scale exactly once and leaves a right-only chart unchanged", () => {
    expect(largeTradesPoint(largeTradesPlotBounds(price, 64, 800)!, 100, 150)).toEqual({ x: 164, y: 150 });
    expect(largeTradesPoint(largeTradesPlotBounds(price, 0, 800)!, 100, 150)).toEqual({ x: 100, y: 150 });
  });
  it("clips marker ink to the price plot, excluding both axes and neighboring panes", () => {
    const plot = largeTradesPlotBounds({ ...price, top: 100, height: 300 }, 64, 800)!;
    expect(largeTradesClip(plot, 934, 520)).toBe("inset(100px 70px 120px 64px)");
    expect(largeTradesPoint(plot, 0, 0)).toEqual({ x: 64, y: 100 });
    expect(largeTradesPoint(plot, 800, 300)).toEqual({ x: 864, y: 400 });
  });
  it.each([[null, 10], [10, null], [-1, 10], [801, 10], [10, -1], [10, 501], [NaN, 20]])(
    "omits a center outside the owned plot: %s/%s", (x, y) => {
      expect(largeTradesPoint(largeTradesPlotBounds(price, 64, 800)!, x, y)).toBeNull();
    },
  );
  it("hides unmeasured roots and rejects invalid plot widths", () => {
    expect(largeTradesPlotBounds(price, 0, 0)).toBeNull();
    expect(largeTradesPlotBounds(price, -1, 800)).toBeNull();
    expect(largeTradesClip(null, 934, 520)).toBe("inset(100%)");
    expect(largeTradesClip(largeTradesPlotBounds(price, 0, 800), 0, 520)).toBe("inset(100%)");
  });
});

// @vitest-environment jsdom
// The displayed price scale (left or right) is the one gestures must answer to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
});
afterEach(() => { vi.restoreAllMocks(); });

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
}));

function dispatchPointer(el: EventTarget, type: string, x: number, y: number, ts: number): void {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  Object.defineProperty(ev, "timeStamp", { value: ts });
  el.dispatchEvent(ev);
}

describe("I9 scaleLeft: the displayed scale must answer to gestures", () => {
  it("a vertical plot drag moves the MANUAL 'left' scale when the left axis is displayed", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(host, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler,
      leftPriceScale: { visible: true }, rightPriceScale: { visible: false },
    });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D", priceScaleId: "left" });
    s.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    engine.priceScale("left").setVisibleRange({ from: 100, to: 140 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLElement;
    const before = engine.priceScale("left").getVisibleRange();
    dispatchPointer(overlay, "pointerdown", 60, 20, 0);
    dispatchPointer(overlay, "pointermove", 60, 60, 20);
    dispatchPointer(overlay, "pointerup", 60, 60, 20);
    const after = engine.priceScale("left").getVisibleRange();
    expect(after).not.toEqual(before);
    engine.destroy();
    host.remove();
  });

  it("control: with the default right scale displayed, the same drag moves priceScale('right')", () => {
    // The control proves the helper still answers "right" when ChartPanel has
    // not flipped scaleLeft. If displayedScaleId ever returns "left" by default,
    // this test goes red because the right scale no longer receives the drag.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(host, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler,
    });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    engine.priceScale("right").setVisibleRange({ from: 100, to: 140 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLElement;
    const before = engine.priceScale("right").getVisibleRange();
    dispatchPointer(overlay, "pointerdown", 60, 20, 0);
    dispatchPointer(overlay, "pointermove", 60, 60, 20);
    dispatchPointer(overlay, "pointerup", 60, 60, 20);
    const after = engine.priceScale("right").getVisibleRange();
    expect(after).not.toEqual(before);
    engine.destroy();
    host.remove();
  });
});

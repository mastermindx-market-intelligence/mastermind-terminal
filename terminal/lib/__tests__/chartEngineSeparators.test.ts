// @vitest-environment jsdom
// Pane separators on the canvas ("mm") renderer: the line between panes, the drag that
// resizes the pair (LWC PaneSeparator arithmetic), and the empty-pane cleanup that keeps
// the separators in step with the pane stack.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import {
  attachSeparatorInput,
  beginSeparatorResize,
  PANE_SEPARATOR_DEFAULTS,
  paneSeparatorOptions,
  separatorStretchesAt,
  type SeparatorInputHost,
} from "@/lib/chart-engine/canvas/separators";
import { TIME_AXIS_HIT_HEIGHT_PX } from "@/lib/chart-engine/canvas/inputBridge";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

type CtxCall = { method: string; args: unknown[] };
type FakeCtx = CanvasRenderingContext2D & { __calls: CtxCall[] };

function makeFakeCtx(): FakeCtx {
  const calls: CtxCall[] = [];
  const rec = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  const props: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    __calls: calls,
    setTransform: rec("setTransform"),
    fillRect: rec("fillRect"),
    clearRect: rec("clearRect"),
    drawImage: rec("drawImage"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    save: rec("save"),
    restore: rec("restore"),
    scale: rec("scale"),
    translate: rec("translate"),
    rect: rec("rect"),
    arc: rec("arc"),
    clip: rec("clip"),
    closePath: rec("closePath"),
    fillText: rec("fillText"),
    strokeRect: rec("strokeRect"),
    setLineDash: rec("setLineDash"),
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha"]) {
    Object.defineProperty(ctx, p, {
      get: () => props[p],
      set: (v: unknown) => {
        // Record the style a later fillRect paints with.
        calls.push({ method: `set:${p}`, args: [v] });
        props[p] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx as unknown as FakeCtx;
}

const ctxByCanvas = new WeakMap<HTMLCanvasElement, FakeCtx>();

const ROWS: EngineSeriesRow[] = Array.from({ length: 20 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
}));
const LINE_ROWS: EngineSeriesRow[] = ROWS.map((r) => ({ time: r.time, value: 5 }));

function dispatchPointer(
  el: EventTarget,
  type: string,
  x: number,
  y: number,
  extra: { pointerId?: number; pointerType?: string; button?: number; relatedTarget?: EventTarget | null } = {},
): MouseEvent {
  const ev = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: extra.button ?? 0,
    relatedTarget: extra.relatedTarget ?? null,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, "pointerId", { value: extra.pointerId ?? 1 });
  Object.defineProperty(ev, "pointerType", { value: extra.pointerType ?? "mouse" });
  el.dispatchEvent(ev);
  return ev;
}

function dispatchWheel(el: EventTarget, x: number, y: number, deltaY: number): WheelEvent {
  const ev = new WheelEvent("wheel", { clientX: x, clientY: y, deltaY, ctrlKey: true, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** The colour a style attribute holds once the CSSOM has normalised it. */
function css(color: string): string {
  const probe = document.createElement("div");
  probe.style.backgroundColor = color;
  return probe.style.backgroundColor;
}

describe("separator arithmetic (LWC PaneSeparator)", () => {
  it("moves stretch 1:1 with the pointer and clamps each pane at 30px", () => {
    const r = beginSeparatorResize({ stretchFactor: 1, height: 100 }, { stretchFactor: 1, height: 100 }, 50)!;
    expect(r).not.toBeNull();
    expect(r.pixelStretchFactor).toBeCloseTo(0.01, 12);
    expect(r.minPaneStretch).toBeCloseTo(0.3, 12);
    expect(r.maxPaneStretch).toBeCloseTo(1.7, 12);
    const down = separatorStretchesAt(r, 70);
    expect(down.top).toBeCloseTo(1.2, 12);
    expect(down.bottom).toBeCloseTo(0.8, 12);
    const up = separatorStretchesAt(r, 30);
    expect(up.top).toBeCloseTo(0.8, 12);
    expect(up.top + up.bottom).toBeCloseTo(2, 12);
    expect(separatorStretchesAt(r, -1000).top).toBeCloseTo(0.3, 12);
    expect(separatorStretchesAt(r, 1000).top).toBeCloseTo(1.7, 12);
  });

  it("refuses a pair at or under two minimum panes, and an unlaid-out pair", () => {
    expect(beginSeparatorResize({ stretchFactor: 1, height: 30 }, { stretchFactor: 1, height: 30 }, 0)).toBeNull();
    expect(beginSeparatorResize({ stretchFactor: 1, height: 31 }, { stretchFactor: 1, height: 30 }, 0)).not.toBeNull();
    expect(beginSeparatorResize({ stretchFactor: 1, height: 0 }, { stretchFactor: 1, height: 0 }, 0)).toBeNull();
    expect(beginSeparatorResize({ stretchFactor: 0, height: 100 }, { stretchFactor: 0, height: 100 }, 0)).toBeNull();
    expect(beginSeparatorResize({ stretchFactor: NaN, height: 100 }, { stretchFactor: 1, height: 100 }, 0)).toBeNull();
  });

  it("a lower pane's reserve (the mm time-axis band) is kept on top of its 30px", () => {
    const r = beginSeparatorResize({ stretchFactor: 1, height: 100 }, { stretchFactor: 1, height: 100 }, 0, 24)!;
    expect(r.minPaneStretch).toBeCloseTo(0.3, 12);
    expect(r.maxPaneStretch).toBeCloseTo(2 - 0.54, 12);
    expect(beginSeparatorResize({ stretchFactor: 1, height: 42 }, { stretchFactor: 1, height: 42 }, 0, 24)).toBeNull();
    expect(beginSeparatorResize({ stretchFactor: 1, height: 43 }, { stretchFactor: 1, height: 42 }, 0, 24)).not.toBeNull();
  });

  it("paneSeparatorOptions reads layout.panes and falls back per key to LWC's defaults", () => {
    expect(paneSeparatorOptions({})).toEqual(PANE_SEPARATOR_DEFAULTS);
    expect(paneSeparatorOptions({ layout: { panes: { enableResize: "no", separatorColor: 3 } } })).toEqual(PANE_SEPARATOR_DEFAULTS);
    expect(paneSeparatorOptions({ layout: { panes: { separatorHoverColor: "#123" } } })).toEqual({
      ...PANE_SEPARATOR_DEFAULTS,
      separatorHoverColor: "#123",
    });
    expect(paneSeparatorOptions({ layout: { panes: { enableResize: false, separatorColor: "#111", separatorHoverColor: "#222" } } }))
      .toEqual({ enableResize: false, separatorColor: "#111", separatorHoverColor: "#222" });
  });
});

describe("separator input binding", () => {
  function host(panes: { stretchFactor: number; height: number }[]) {
    const root = document.createElement("div");
    const handle = document.createElement("div");
    handle.dataset.mmSeparator = "0";
    const backdrop = document.createElement("div");
    backdrop.dataset.mmSeparatorBackdrop = "0";
    backdrop.style.display = "none";
    handle.appendChild(backdrop);
    root.appendChild(handle);
    document.body.appendChild(root);
    const resize = vi.fn();
    const wheel = vi.fn();
    const h: SeparatorInputHost = {
      root,
      panes: () => panes,
      options: () => ({ ...PANE_SEPARATOR_DEFAULTS }),
      reservePx: () => 0,
      resize,
      wheel,
    };
    return { root, handle, backdrop, resize, wheel, h };
  }

  it("dispose removes every listener and hides the backdrop of a drag in flight", () => {
    const t = host([{ stretchFactor: 1, height: 100 }, { stretchFactor: 1, height: 100 }]);
    const binding = attachSeparatorInput(t.h);
    dispatchPointer(t.handle, "pointerdown", 10, 100);
    expect(t.backdrop.style.display).toBe("block");
    binding.dispose();
    expect(t.backdrop.style.display).toBe("none");
    dispatchPointer(t.handle, "pointermove", 10, 140);
    dispatchPointer(t.handle, "pointerdown", 10, 100);
    dispatchPointer(t.handle, "pointermove", 10, 140);
    dispatchWheel(t.handle, 10, 100, -120);
    expect(t.resize).not.toHaveBeenCalled();
    expect(t.wheel).not.toHaveBeenCalled();
    expect(t.backdrop.style.display).toBe("none");
    binding.dispose();
    t.root.remove();
  });

  it("only the pointer that pressed drives the drag", () => {
    const t = host([{ stretchFactor: 1, height: 100 }, { stretchFactor: 1, height: 100 }]);
    const binding = attachSeparatorInput(t.h);
    dispatchPointer(t.handle, "pointerdown", 10, 100, { pointerId: 7 });
    dispatchPointer(t.handle, "pointermove", 10, 140, { pointerId: 8 });
    expect(t.resize).not.toHaveBeenCalled();
    dispatchPointer(t.handle, "pointerup", 10, 140, { pointerId: 8 });
    expect(t.backdrop.style.display).toBe("block");
    dispatchPointer(t.handle, "pointermove", 10, 140, { pointerId: 7 });
    expect(t.resize).toHaveBeenCalledTimes(1);
    const [index, top, bottom] = t.resize.mock.calls[0];
    expect(index).toBe(0);
    expect(top).toBeCloseTo(1.4, 12);
    expect(bottom).toBeCloseTo(0.6, 12);
    dispatchPointer(t.handle, "pointercancel", 10, 140, { pointerId: 7 });
    expect(t.backdrop.style.display).toBe("none");
    binding.dispose();
    t.root.remove();
  });
});

describe("canvas engine pane separators", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      type: string,
    ) {
      if (type !== "2d") return null;
      let ctx = ctxByCanvas.get(this);
      if (!ctx) {
        ctx = makeFakeCtx();
        ctxByCanvas.set(this, ctx);
      }
      return ctx;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  /** Three panes of 100px each: a candle pane and two line sub-panes. */
  function mount(opts: Record<string, unknown> = {}) {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 300,
      devicePixelRatio: 1,
      scheduler,
      layout: { textColor: "#abc", panes: { separatorColor: "#222", separatorHoverColor: "#333" } },
      ...opts,
    });
    const main = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    main.setData(ROWS);
    const sub1 = engine.addSeries("line", {}, 1);
    sub1.setData(LINE_ROWS);
    const sub2 = engine.addSeries("line", {}, 2);
    sub2.setData(LINE_ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const root = engine.chartElement();
    const overlay = root.querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    const handles = () => [...root.querySelectorAll<HTMLElement>("[data-mm-separator]")];
    const heights = () => engine.panes().map((p) => p.height());
    return { engine, scheduler, root, overlay, handles, heights, main, sub1, sub2 };
  }

  it("draws one separator per pane boundary, before the overlay, 4px into the upper pane", () => {
    const { engine, root, overlay, handles, heights } = mount();
    expect(heights()).toEqual([100, 100, 100]);
    const hs = handles();
    expect(hs.map((h) => h.dataset.mmSeparator)).toEqual(["0", "1"]);
    expect(hs.map((h) => h.style.top)).toEqual(["96px", "196px"]);
    expect(hs.every((h) => h.style.height === "9px" && h.style.zIndex === "50")).toBe(true);
    expect(root.lastElementChild).toBe(overlay);
    for (const h of hs) {
      expect(h.parentElement).toBe(root);
      const line = h.querySelector<HTMLElement>("[data-mm-separator-line]")!;
      expect(line.style.top).toBe("4px");
      expect(line.style.height).toBe("1px");
      expect(line.style.backgroundColor).toBe(css("#222"));
      expect(line.style.pointerEvents).toBe("none");
      expect(h.style.cursor).toBe("row-resize");
      expect(h.style.pointerEvents).toBe("auto");
    }
    engine.destroy();
  });

  it("a single-pane chart has no separator", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, { width: 200, height: 300, devicePixelRatio: 1, scheduler });
    engine.addSeries("candles", {}).setData(ROWS);
    scheduler.flush();
    expect(engine.chartElement().querySelectorAll("[data-mm-separator]")).toHaveLength(0);
    engine.destroy();
  });

  it("separators follow the pane stack when panes are added and emptied away", () => {
    const { engine, root, overlay, handles, heights, sub2 } = mount();
    engine.removeSeries(sub2);
    expect(engine.panes()).toHaveLength(2);
    expect(heights()).toEqual([150, 150]);
    expect(handles().map((h) => h.style.top)).toEqual(["146px"]);
    const again = engine.addSeries("line", {}, 2);
    again.setData(LINE_ROWS);
    expect(handles().map((h) => h.dataset.mmSeparator)).toEqual(["0", "1"]);
    expect(handles()[1].querySelector<HTMLElement>("[data-mm-separator-line]")!.style.backgroundColor).toBe(css("#222"));
    expect(root.lastElementChild).toBe(overlay);
    engine.destroy();
  });

  it("applyOptions restyles the line and keeps the layout keys it did not name", () => {
    const { engine, handles } = mount();
    engine.applyOptions({ layout: { panes: { separatorColor: "#444" } } });
    const layout = engine.options().layout as Record<string, unknown>;
    expect(layout.textColor).toBe("#abc");
    expect(layout.panes).toMatchObject({ separatorColor: "#444", separatorHoverColor: "#333" });
    for (const h of handles()) {
      expect(h.querySelector<HTMLElement>("[data-mm-separator-line]")!.style.backgroundColor).toBe(css("#444"));
    }
    dispatchPointer(handles()[0], "pointerover", 10, 100);
    expect(handles()[0].style.backgroundColor).toBe(css("#333"));
    engine.destroy();
  });

  it("hover paints the handle and leaving it clears the paint, but not a move onto its own line", () => {
    const { engine, root, handles } = mount();
    const h = handles()[0];
    const line = h.querySelector<HTMLElement>("[data-mm-separator-line]")!;
    dispatchPointer(h, "pointerover", 10, 100);
    expect(h.style.backgroundColor).toBe(css("#333"));
    dispatchPointer(h, "pointerout", 10, 100, { relatedTarget: line });
    expect(h.style.backgroundColor).toBe(css("#333"));
    dispatchPointer(h, "pointerout", 10, 120, { relatedTarget: root });
    expect(h.style.backgroundColor).toBe("");
    // A drag keeps the paint while the pointer runs off the band; release clears it.
    dispatchPointer(h, "pointerover", 10, 100);
    dispatchPointer(h, "pointerdown", 10, 100);
    dispatchPointer(h, "pointerout", 10, 140, { relatedTarget: root });
    expect(h.style.backgroundColor).toBe(css("#333"));
    dispatchPointer(h, "pointerup", 10, 140);
    expect(h.style.backgroundColor).toBe("");
    engine.destroy();
  });

  it("dragging a separator moves the boundary 1:1 with the pointer after a 5px move", () => {
    const { engine, handles, heights } = mount();
    const h = handles()[0];
    dispatchPointer(h, "pointerdown", 10, 100);
    dispatchPointer(h, "pointermove", 12, 102);
    expect(heights()).toEqual([100, 100, 100]);
    dispatchPointer(h, "pointermove", 10, 100);
    dispatchPointer(h, "pointermove", 10, 120);
    const [a, b, c] = heights();
    expect(Math.abs(a - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 80)).toBeLessThanOrEqual(1);
    expect(c).toBe(300 - a - b);
    expect(engine.panes()[0].stretchFactor() + engine.panes()[1].stretchFactor()).toBeCloseTo(2, 12);
    expect(engine.panes()[2].stretchFactor()).toBe(1);
    expect(h.style.top).toBe(`${a - 4}px`);
    dispatchPointer(h, "pointermove", 10, 70);
    expect(Math.abs(heights()[0] - 70)).toBeLessThanOrEqual(1);
    dispatchPointer(h, "pointerup", 10, 70);
    dispatchPointer(h, "pointermove", 10, 10);
    expect(Math.abs(heights()[0] - 70)).toBeLessThanOrEqual(1);
    engine.destroy();
  });

  it("the drag clamps at 30px a pane, and the last pane also keeps its time-axis band", () => {
    const { engine, handles, heights } = mount();
    dispatchPointer(handles()[0], "pointerdown", 10, 100);
    dispatchPointer(handles()[0], "pointermove", 10, -500);
    expect(Math.abs(heights()[0] - 30)).toBeLessThanOrEqual(1);
    dispatchPointer(handles()[0], "pointermove", 10, 900);
    expect(Math.abs(heights()[1] - 30)).toBeLessThanOrEqual(1);
    dispatchPointer(handles()[0], "pointerup", 10, 900);
    const last = handles()[1];
    const y = heights()[0] + heights()[1];
    dispatchPointer(last, "pointerdown", 10, y);
    dispatchPointer(last, "pointermove", 10, y + 900);
    expect(Math.abs(heights()[2] - (30 + TIME_AXIS_HIT_HEIGHT_PX))).toBeLessThanOrEqual(1);
    dispatchPointer(last, "pointerup", 10, y + 900);
    engine.destroy();
  });

  it("with timeScale.visible false the last pane clamps at a plain 30px", () => {
    const { engine, handles, heights } = mount({ timeScale: { visible: false } });
    dispatchPointer(handles()[1], "pointerdown", 10, 200);
    dispatchPointer(handles()[1], "pointermove", 10, 900);
    expect(Math.abs(heights()[2] - 30)).toBeLessThanOrEqual(1);
    engine.destroy();
  });

  it("the backdrop holds the row-resize cursor for the length of the drag only", () => {
    const { engine, handles } = mount();
    const h = handles()[0];
    const backdrop = h.querySelector<HTMLElement>("[data-mm-separator-backdrop]")!;
    expect(backdrop.style.display).toBe("none");
    expect(backdrop.style.cursor).toBe("row-resize");
    dispatchPointer(h, "pointerdown", 10, 100);
    expect(backdrop.style.display).toBe("block");
    dispatchPointer(h, "pointermove", 10, 130);
    expect(backdrop.style.display).toBe("block");
    dispatchPointer(h, "pointerup", 10, 130);
    expect(backdrop.style.display).toBe("none");
    dispatchPointer(h, "pointerdown", 10, 100);
    dispatchPointer(h, "pointercancel", 10, 100);
    expect(backdrop.style.display).toBe("none");
    engine.destroy();
  });

  it("a secondary mouse button does not start a resize", () => {
    const { engine, handles, heights } = mount();
    const h = handles()[0];
    dispatchPointer(h, "pointerdown", 10, 100, { button: 2 });
    dispatchPointer(h, "pointermove", 10, 140);
    expect(heights()).toEqual([100, 100, 100]);
    expect(h.querySelector<HTMLElement>("[data-mm-separator-backdrop]")!.style.display).toBe("none");
    engine.destroy();
  });

  it("enableResize false: no hover paint, no pointer target, no drag", () => {
    const { engine, handles, heights } = mount();
    engine.applyOptions({ layout: { panes: { enableResize: false } } });
    const h = handles()[0];
    expect(h.style.pointerEvents).toBe("none");
    expect(h.style.cursor).toBe("");
    dispatchPointer(h, "pointerover", 10, 100);
    expect(h.style.backgroundColor).toBe("");
    dispatchPointer(h, "pointerdown", 10, 100);
    dispatchPointer(h, "pointermove", 10, 140);
    expect(heights()).toEqual([100, 100, 100]);
    // The line still draws: LWC hides only the handle, never the separator row.
    expect(h.querySelector<HTMLElement>("[data-mm-separator-line]")!.style.backgroundColor).toBe(css("#222"));
    engine.destroy();
  });

  it("a wheel over a separator zooms exactly as a wheel over the plot does", () => {
    const viaOverlay = mount();
    const before = viaOverlay.engine.timeScale().getVisibleLogicalRange()!;
    expect(dispatchWheel(viaOverlay.overlay, 50, 100, -120).defaultPrevented).toBe(true);
    const overlayAfter = viaOverlay.engine.timeScale().getVisibleLogicalRange()!;
    expect(Math.abs((overlayAfter.to - overlayAfter.from) - (before.to - before.from))).toBeGreaterThan(0.01);
    viaOverlay.engine.destroy();

    const viaHandle = mount();
    expect(dispatchWheel(viaHandle.handles()[0], 50, 100, -120).defaultPrevented).toBe(true);
    const handleAfter = viaHandle.engine.timeScale().getVisibleLogicalRange()!;
    expect(handleAfter.from).toBeCloseTo(overlayAfter.from, 9);
    expect(handleAfter.to).toBeCloseTo(overlayAfter.to, 9);
    viaHandle.engine.destroy();
  });

  it("destroy removes the separator listeners from the root", () => {
    const { engine, root } = mount();
    const removed = vi.spyOn(root, "removeEventListener");
    engine.destroy();
    const types = removed.mock.calls.map((c) => c[0]).sort();
    expect(types).toEqual(["pointercancel", "pointerdown", "pointermove", "pointerout", "pointerover", "pointerup", "wheel"]);
  });

  it("the screenshot draws each separator line at its pane boundary", () => {
    const { engine } = mount();
    const shot = engine.takeScreenshot();
    const calls = ctxByCanvas.get(shot)!.__calls;
    const rows: Array<{ y: unknown; h: unknown; style: unknown }> = [];
    let style: unknown;
    for (const c of calls) {
      if (c.method === "set:fillStyle") style = c.args[0];
      if (c.method === "fillRect" && c.args[0] === 0 && c.args[2] === 200) rows.push({ y: c.args[1], h: c.args[3], style });
    }
    expect(rows).toEqual([
      { y: 100, h: 1, style: "#222" },
      { y: 200, h: 1, style: "#222" },
    ]);
    engine.destroy();
  });

  it("emptying the last pane removes it and detaches the primitives it held", () => {
    const { engine, handles, sub1, sub2 } = mount();
    const detached = vi.fn();
    sub2.attachPrimitive({ id: "probe", attached() {}, detached, update() {} });
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 19 });
    sub2.remove();
    expect(engine.panes()).toHaveLength(2);
    expect(handles()).toHaveLength(1);
    expect(detached).toHaveBeenCalledTimes(1);
    sub1.moveToPane(0);
    expect(engine.panes()).toHaveLength(1);
    expect(handles()).toHaveLength(0);
    expect(engine.inventory()).toMatchObject({ panes: 1, series: 2, seriesByPane: [2] });
    engine.destroy();
  });
});

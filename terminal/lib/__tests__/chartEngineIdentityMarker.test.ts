// @vitest-environment jsdom
//
// Engine identity marker — `[data-chart-engine]` on the host container.
//
// Both engine implementations carry `readonly impl: "lwc" | "mm"` (api.ts), and the
// seat's Playwright/live proofs select with `[data-chart-engine="mm"]`. The marker is
// the runtime that proves that selector — written after a successful construct, cleared
// on destroy (idempotent, owned).
//
// Mocking: the LWC half reuses the lwcAdapter.test.ts precedent (vi.mock("lightweight-charts")
// stand-in). The canvas half stubs HTMLCanvasElement.getContext("2d") the same way
// chartEngineCanvasC02.test.ts does, plus a construction-only manual scheduler.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// lightweight-charts stand-in — minimal surface the constructor needs.
// ─────────────────────────────────────────────────────────────────────────────

const L = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;
  const charts: { remove: Spy }[] = [];
  const createChart = vi.fn((): unknown => {
    const chart = { remove: vi.fn() };
    charts.push(chart);
    return chart;
  });
  const reset = (): void => {
    charts.length = 0;
    createChart.mockClear();
  };
  return { charts, createChart, reset };
});

vi.mock("lightweight-charts", () => ({
  createChart: L.createChart,
  CandlestickSeries: { seriesType: "Candlestick" },
  BarSeries: { seriesType: "Bar" },
  LineSeries: { seriesType: "Line" },
  AreaSeries: { seriesType: "Area" },
  HistogramSeries: { seriesType: "Histogram" },
  BaselineSeries: { seriesType: "Baseline" },
  MismatchDirection: { NearestLeft: -1, None: 0, NearestRight: 1 },
  createSeriesMarkers: vi.fn(),
  createTextWatermark: vi.fn(),
}));

// Imported AFTER mock registration.
import { createEngine } from "../chart-engine";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";

// ─────────────────────────────────────────────────────────────────────────────
// Canvas stub — recording 2D context per HTMLCanvasElement.
// ─────────────────────────────────────────────────────────────────────────────

type FakeCall = { method: string; args: unknown[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D & { __calls: FakeCall[] }>();

function makeFakeCtx(): CanvasRenderingContext2D & { __calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const rec = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as unknown as CanvasRenderingContext2D & { __calls: FakeCall[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared test harness.
// ─────────────────────────────────────────────────────────────────────────────

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  L.reset();
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
    return ctx as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  container.remove();
});

// ─────────────────────────────────────────────────────────────────────────────
// I1 — default ("lwc") writes the marker; destroy() clears it; no descendants.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity marker: default impl 'lwc'", () => {
  it("createEngine(el) writes data-chart-engine='lwc' to the host element", () => {
    const engine = createEngine(container, {});
    try {
      expect(container.dataset.chartEngine).toBe("lwc");
      expect(container.getAttribute("data-chart-engine")).toBe("lwc");
    } finally {
      engine.destroy();
    }
  });

  it("destroy() removes the marker from the host", () => {
    const engine = createEngine(container, {});
    expect(container.dataset.chartEngine).toBe("lwc");
    engine.destroy();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
    expect(container.dataset.chartEngine).toBeUndefined();
  });

  it("the marker does NOT appear on a descendant (host scope only)", () => {
    const engine = createEngine(container, {});
    try {
      for (const child of Array.from(container.querySelectorAll("*"))) {
        expect(child.hasAttribute("data-chart-engine")).toBe(false);
      }
    } finally {
      engine.destroy();
    }
  });

  it("a second destroy() is a no-op and does not throw", () => {
    const engine = createEngine(container, {});
    engine.destroy();
    expect(() => engine.destroy()).not.toThrow();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I2 — "mm" writes the marker; destroy() clears it; idempotent destroy.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity marker: impl 'mm'", () => {
  function mountMm() {
    const scheduler = createManualScheduler();
    const engine = createEngine(container, { width: 200, height: 100 }, "mm");
    // The test never registers the scheduler at the public boundary, but
    // createEngine forwards it via CanvasEngineOptions; we don't need it because
    // each test owns at most one requestPaint before teardown.
    void scheduler;
    return engine;
  }

  it("createEngine(el, opts, 'mm') writes data-chart-engine='mm'", () => {
    const engine = mountMm();
    try {
      expect(container.dataset.chartEngine).toBe("mm");
      expect(container.getAttribute("data-chart-engine")).toBe("mm");
    } finally {
      engine.destroy();
    }
  });

  it("destroy() clears the marker for 'mm'", () => {
    const engine = mountMm();
    expect(container.dataset.chartEngine).toBe("mm");
    engine.destroy();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
    expect(container.dataset.chartEngine).toBeUndefined();
  });

  it("a second destroy() on 'mm' is a no-op and does not throw", () => {
    const engine = mountMm();
    engine.destroy();
    expect(() => engine.destroy()).not.toThrow();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I3 — the marker sits on the HOST element only, never on any descendant.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity marker: host-only scoping", () => {
  it("'mm' writes only to the host; no descendant carries the marker", () => {
    const engine = createEngine(container, { width: 200, height: 100 }, "mm");
    try {
      expect(container.getAttribute("data-chart-engine")).toBe("mm");
      // Whatever the canvas engine inserted inside the container — root, panes, overlay,
      // canvases — none should carry the marker. querySelectorAll("*") + for-of catches
      // every descendant, including nested ones.
      for (const child of Array.from(container.querySelectorAll("*"))) {
        expect(child.hasAttribute("data-chart-engine")).toBe(false);
      }
    } finally {
      engine.destroy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I4 — refusal path: an unsupported option group makes mount throw AND
//       leaves no marker on the host.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity marker: refusal path leaves the host untouched", () => {
  it("createEngine(el, { trackingMode: {} }, 'mm') throws and writes no marker", () => {
    // 'trackingMode' is OUTSIDE ALLOWED_GROUPS in lib/chart-engine/options.ts; the mm
    // gate refuses it regardless of capabilities. This is exactly what constraint C1
    // is asking us to defend: a refused construct must NOT leave data-chart-engine on
    // the host.
    expect(() => {
      createEngine(
        container,
        { trackingMode: { mouse: true } } as unknown as Parameters<typeof createEngine>[1],
        "mm",
      );
    }).toThrow();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
    expect(container.dataset.chartEngine).toBeUndefined();
  });

  it("destroy() on a refused mount would be a no-op (no engine survived)", () => {
    let engine: ReturnType<typeof createEngine> | null = null;
    expect(() => {
      engine = createEngine(
        container,
        { overlayPriceScales: {} } as unknown as Parameters<typeof createEngine>[1],
        "mm",
      );
    }).toThrow();
    // No engine to destroy — the throw pre-dates any constructor side-effect; the host
    // must still carry no marker.
    void engine;
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I5 — destroy() only clears the marker if the host actually reads THIS impl.
//       A stale destroy() from an older engine must not wipe a newer engine's marker.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity marker: ownership when engines swap on the same host", () => {
  it("a later 'mm' marker survives an obsolete 'lwc' engine's late destroy()", () => {
    // Mount lwc (default), then destroy, then mount mm on the same host. The earlier
    // lwc engine's destroy() must NOT clear the marker written by the mm engine.
    const lwc = createEngine(container, {});
    lwc.destroy();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);

    const mm = createEngine(container, { width: 200, height: 100 }, "mm");
    expect(container.dataset.chartEngine).toBe("mm");

    // Late call on the older engine — must not mutate the marker, must not throw.
    expect(() => lwc.destroy()).not.toThrow();
    expect(container.dataset.chartEngine).toBe("mm");

    mm.destroy();
  });

  it("a later 'lwc' marker survives an obsolete 'mm' engine's late destroy()", () => {
    const mm = createEngine(container, { width: 200, height: 100 }, "mm");
    mm.destroy();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);

    const lwc = createEngine(container, {});
    expect(container.dataset.chartEngine).toBe("lwc");

    expect(() => mm.destroy()).not.toThrow();
    expect(container.dataset.chartEngine).toBe("lwc");

    lwc.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I6 — coexistence: the ENGID marker (data-chart-engine="mm") and the KINETIC
//      input controller live on the same host. After createEngine(el, opts, "mm"),
//      the marker is on the host AND a pointer drag on the overlay pans the chart.
//      After destroy(), the marker is gone AND a later drag is a no-op.
//
//      This is the FOLD3 coexistence assertion: ENGID wrote the marker, KINETIC
//      attached the listeners; the parent guarantees both stay right on the same
//      element. Mutant receipt lives in the implementation file — commenting out
//      the marker write in canvas/index.ts makes this test red, restoring it makes
//      it green.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity marker: coexistence with KINETIC input controller", () => {
  const ROWS = Array.from({ length: 40 }, (_, i) => ({
    time: 1700000000 + i * 3600,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
  }));

  function dispatchPointer(
    el: EventTarget,
    type: string,
    x: number,
    y: number,
    extra: { pointerId?: number; pointerType?: string; timeStamp?: number } = {},
  ): void {
    const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(ev, "pointerId", { value: extra.pointerId ?? 1 });
    Object.defineProperty(ev, "pointerType", { value: extra.pointerType ?? "mouse" });
    if (extra.timeStamp != null) Object.defineProperty(ev, "timeStamp", { value: extra.timeStamp });
    el.dispatchEvent(ev);
  }

  it("marker write and pointer drag co-exist on the same 'mm' engine", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      scheduler,
      kineticScroll: { mouse: true, touch: true },
    });

    // ENGID half — the marker is on the host element.
    expect(container.dataset.chartEngine).toBe("mm");

    // KINETIC half — pointer drag pans the visible logical range.
    const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    expect(overlay).toBeTruthy();
    const before = engine.timeScale().getVisibleLogicalRange();
    dispatchPointer(overlay, "pointerdown", 40, 30, { timeStamp: 10 });
    dispatchPointer(overlay, "pointermove", 140, 30, { timeStamp: 30 });
    const during = engine.timeScale().getVisibleLogicalRange();
    expect(during).not.toBeNull();
    expect(during!.from).not.toBe(before!.from);
    expect(during!.to).not.toBe(before!.to);
    dispatchPointer(overlay, "pointerup", 140, 30, { timeStamp: 30 });

    // Destroy: marker gone AND a later drag changes nothing.
    engine.destroy();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
    const rangeAfterDestroy = engine.timeScale().getVisibleLogicalRange();
    dispatchPointer(overlay, "pointerdown", 40, 30, { timeStamp: 100 });
    dispatchPointer(overlay, "pointermove", 140, 30, { timeStamp: 120 });
    expect(engine.timeScale().getVisibleLogicalRange()).toBe(rangeAfterDestroy);
  });
});

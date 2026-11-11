// Contract tests for the native engine input controller (lib/chart-engine/canvas/input.ts).
// Pure event records, injectable clock + scheduler — no DOM, no lightweight-charts.

import { describe, expect, it } from "vitest";
import {
  createInputController,
  logicalOfX,
  type InputControllerOptions,
  type InputEvent,
  type InputGesture,
  type InputGestureKind,
  type InputPointerType,
  type InputRegion,
  type PriceScaleState,
  type TimeScaleState,
} from "@/lib/chart-engine/canvas/input";
import { axisValueAtCoordinate, wheelDeltaToZoomFactor } from "@/lib/chart-engine/axisZoom";

const OPTIONS: InputControllerOptions = {
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
  handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  kineticScroll: { mouse: true, touch: true },
};

type Host = {
  ts: TimeScaleState;
  price: PriceScaleState;
  auto: boolean;
  nowMs: number;
  queued: Array<() => void>;
  gestures: InputGestureKind[];
  ranges: Array<{ from: number; to: number }>;
};

function makeHost(partial?: Partial<TimeScaleState>): {
  host: Host;
  controller: ReturnType<typeof createInputController>;
  step: () => void;
} {
  const ts: TimeScaleState = {
    visibleFrom: 0,
    visibleTo: 100,
    barSpacing: 10,
    rightOffset: 0,
    widthPx: 1000,
    ...partial,
  };
  const price: PriceScaleState = {
    mode: "normal",
    inverted: false,
    from: 100,
    to: 200,
    heightPx: 400,
    margins: { top: 0.1, bottom: 0.1 },
  };
  const host: Host = {
    ts,
    price,
    auto: false,
    nowMs: 0,
    queued: [],
    gestures: [],
    ranges: [],
  };
  const controller = createInputController({
    getTimeScale: () => host.ts,
    setVisibleLogicalRange: (range) => {
      const oldSpan = host.ts.visibleTo - host.ts.visibleFrom;
      const nextSpan = range.to - range.from;
      host.ts.visibleFrom = range.from;
      host.ts.visibleTo = range.to;
      if (oldSpan > 0 && nextSpan > 0 && Math.abs(nextSpan - oldSpan) > 1e-18) {
        host.ts.barSpacing *= oldSpan / nextSpan;
      }
      host.ranges.push({ from: range.from, to: range.to });
    },
    getPriceScale: () => host.price,
    setPriceRange: (_pane, range) => {
      host.price = { ...host.price, from: range.from, to: range.to };
    },
    isPriceScaleAuto: () => host.auto,
    now: () => host.nowMs,
    schedule: (cb) => {
      host.queued.push(cb);
      return () => {
        host.queued = host.queued.filter((item) => item !== cb);
      };
    },
    options: OPTIONS,
    onGesture: (g: InputGesture) => {
      host.gestures.push(g.kind);
    },
  });
  const step = (): void => {
    const batch = host.queued;
    host.queued = [];
    for (const cb of batch) cb();
  };
  return { host, controller, step };
}

function evt(
  type: InputEvent["type"],
  extra: Partial<InputEvent> & { x: number; y: number },
): InputEvent {
  return {
    type,
    pointerId: 1,
    pointerType: "mouse",
    timeStamp: 1,
    region: "plot",
    paneIndex: 0,
    ...extra,
  };
}

function touch(
  type: InputEvent["type"],
  pointerId: number,
  x: number,
  y: number,
  extra: Partial<InputEvent> = {},
): InputEvent {
  return evt(type, {
    pointerId,
    pointerType: "touch" satisfies InputPointerType,
    x,
    y,
    region: "plot" satisfies InputRegion,
    ...extra,
  });
}

describe("createInputController pan", () => {
  it("shifts the logical range by dxPx / barSpacing for a 100 px plot drag", () => {
    const { host, controller } = makeHost();
    const spacing = host.ts.barSpacing;
    controller.handleEvent(evt("pointerdown", { x: 200, y: 80, timeStamp: 10 }));
    controller.handleEvent(evt("pointermove", { x: 300, y: 80, timeStamp: 30 }));
    expect(host.ts.visibleFrom).toBeCloseTo(-100 / spacing, 12);
    expect(host.ts.visibleTo).toBeCloseTo(100 - 100 / spacing, 12);
    expect(host.ts.visibleTo - host.ts.visibleFrom).toBeCloseTo(100, 12);
  });
});

describe("createInputController wheel zoom (I02 anchor law)", () => {
  it("keeps the logical index under the pointer fixed to 1e-9", () => {
    const { host, controller } = makeHost();
    const x = 250;
    const before = logicalOfX(x, host.ts);
    controller.handleEvent(evt("wheel", {
      x,
      y: 40,
      ctrlKey: true,
      deltaY: -120,
      deltaMode: 0,
      timeStamp: 5,
    }));
    const after = logicalOfX(x, host.ts);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1e-9);
  });

  it("restores the baseline within 1e-9 after equal opposite wheel deltas", () => {
    const { host, controller } = makeHost();
    const baseline = { from: host.ts.visibleFrom, to: host.ts.visibleTo, barSpacing: host.ts.barSpacing };
    const x = 400;
    controller.handleEvent(evt("wheel", { x, y: 20, ctrlKey: true, deltaY: 80, deltaMode: 0, timeStamp: 1 }));
    controller.handleEvent(evt("wheel", { x, y: 20, ctrlKey: true, deltaY: -80, deltaMode: 0, timeStamp: 2 }));
    expect(Math.abs(host.ts.visibleFrom - baseline.from)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(host.ts.visibleTo - baseline.to)).toBeLessThanOrEqual(1e-9);
    const roundTrip = wheelDeltaToZoomFactor(80, 0) * wheelDeltaToZoomFactor(-80, 0);
    expect(roundTrip).toBeCloseTo(1, 12);
  });
});

describe("createInputController pinch", () => {
  it("keeps the midpoint logical fixed and does not jump when a finger lifts", () => {
    const { host, controller } = makeHost();
    controller.handleEvent(touch("pointerdown", 1, 100, 50, { timeStamp: 10 }));
    controller.handleEvent(touch("pointerdown", 2, 300, 50, { timeStamp: 11 }));
    const mid = 200;
    const before = logicalOfX(mid, host.ts);
    controller.handleEvent(touch("pointermove", 1, 50, 50, { timeStamp: 20 }));
    controller.handleEvent(touch("pointermove", 2, 350, 50, { timeStamp: 20 }));
    const after = logicalOfX(mid, host.ts);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1e-9);
    const frozen = { from: host.ts.visibleFrom, to: host.ts.visibleTo };
    controller.handleEvent(touch("pointerup", 2, 350, 50, { timeStamp: 30 }));
    expect(Math.abs(host.ts.visibleFrom - frozen.from)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(host.ts.visibleTo - frozen.to)).toBeLessThanOrEqual(1e-9);
    expect(host.gestures.filter((k) => k === "pinchend")).toEqual(["pinchend"]);
  });
});

describe("createInputController inertia", () => {
  it("decays velocity monotonically and stops under 0.05 px/ms or 1.5 s", () => {
    const { host, controller, step } = makeHost();
    controller.handleEvent(evt("pointerdown", { x: 100, y: 40, timeStamp: 1000 }));
    controller.handleEvent(evt("pointermove", { x: 160, y: 40, timeStamp: 1020 }));
    controller.handleEvent(evt("pointermove", { x: 240, y: 40, timeStamp: 1040 }));
    controller.handleEvent(evt("pointermove", { x: 340, y: 40, timeStamp: 1060 }));
    host.nowMs = 1060;
    controller.handleEvent(evt("pointerup", { x: 340, y: 40, timeStamp: 1060 }));
    expect(host.gestures).toContain("inertiastart");

    const speeds: number[] = [];
    let frames = 0;
    while (host.queued.length > 0 && frames < 200) {
      const from0 = host.ts.visibleFrom;
      const t0 = host.nowMs;
      host.nowMs += 16;
      step();
      frames += 1;
      const dt = host.nowMs - t0;
      const dx = (from0 - host.ts.visibleFrom) * host.ts.barSpacing;
      speeds.push(Math.abs(dx / dt));
      if (host.gestures.includes("inertiaend")) break;
    }
    expect(host.gestures).toContain("inertiaend");
    expect(host.queued.length).toBe(0);
    expect(speeds.length).toBeGreaterThan(2);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-12);
    }
    expect(speeds[speeds.length - 1]).toBeLessThan(0.05 + 1e-9);
    expect(frames * 16).toBeLessThanOrEqual(1500 + 16);
  });

  it("cancels inertia on pointerdown so later frames do not move the range", () => {
    const { host, controller, step } = makeHost();
    controller.handleEvent(evt("pointerdown", { x: 50, y: 40, timeStamp: 1 }));
    controller.handleEvent(evt("pointermove", { x: 180, y: 40, timeStamp: 20 }));
    host.nowMs = 20;
    controller.handleEvent(evt("pointerup", { x: 180, y: 40, timeStamp: 20 }));
    expect(host.gestures).toContain("inertiastart");
    const frozenFrom = host.ts.visibleFrom;
    controller.handleEvent(evt("pointerdown", { x: 180, y: 40, timeStamp: 40, pointerId: 9 }));
    expect(host.gestures).toContain("inertiaend");
    host.nowMs += 16;
    step();
    host.nowMs += 16;
    step();
    expect(host.ts.visibleFrom).toBe(frozenFrom);
  });
});

describe("createInputController price-axis drag", () => {
  it("zooms the price range around the drag origin", () => {
    const { host, controller } = makeHost();
    const originY = 80;
    const before = axisValueAtCoordinate(
      { from: host.price.from, to: host.price.to },
      originY,
      host.price.heightPx,
      host.price.margins,
      host.price.inverted,
    );
    controller.handleEvent(evt("pointerdown", {
      x: 980, y: originY, timeStamp: 1, region: "priceAxis",
    }));
    controller.handleEvent(evt("pointermove", {
      x: 980, y: 160, timeStamp: 20, region: "priceAxis",
    }));
    const after = axisValueAtCoordinate(
      { from: host.price.from, to: host.price.to },
      originY,
      host.price.heightPx,
      host.price.margins,
      host.price.inverted,
    );
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1e-9);
    expect(host.price.to - host.price.from).not.toBeCloseTo(100, 6);
  });
});

describe("createInputController tap / long-press", () => {
  it("classifies a tap from timeStamp (<=300 ms, <8 px) and ignores now()", () => {
    const { host, controller } = makeHost();
    host.nowMs = 0;
    controller.handleEvent(evt("pointerdown", { x: 40, y: 40, timeStamp: 1000 }));
    host.nowMs = 10_000;
    controller.handleEvent(evt("pointerup", { x: 43, y: 41, timeStamp: 1180 }));
    expect(host.gestures).toEqual(["tap"]);
  });

  it("classifies a long-press from timeStamp (>=500 ms) and ignores now()", () => {
    const { host, controller } = makeHost();
    host.nowMs = 50;
    controller.handleEvent(evt("pointerdown", { x: 40, y: 40, timeStamp: 2000 }));
    host.nowMs = 51;
    controller.handleEvent(evt("pointerup", { x: 41, y: 40, timeStamp: 2600 }));
    expect(host.gestures).toEqual(["longpress"]);
  });
});

describe("createInputController dispose", () => {
  it("is idempotent and stops further camera writes", () => {
    const { host, controller } = makeHost();
    controller.dispose();
    controller.dispose();
    controller.handleEvent(evt("pointerdown", { x: 10, y: 10, timeStamp: 1 }));
    controller.handleEvent(evt("pointermove", { x: 110, y: 10, timeStamp: 20 }));
    expect(host.ts.visibleFrom).toBe(0);
    expect(host.ts.visibleTo).toBe(100);
    expect(host.gestures).toEqual([]);
  });
});

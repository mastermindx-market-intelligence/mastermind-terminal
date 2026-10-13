// @vitest-environment jsdom
// INTEGRATE3 G4: ModelSeriesHandle.attachPrimitive shape-guards via
// assertEnginePrimitive. A bag that is not an EnginePrimitive is refused;
// a valid primitive still attaches.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCanvasEngine,
  createManualScheduler,
  EngineRefusalError,
} from "@/lib/chart-engine/canvas";
import type { EnginePrimitive } from "@/lib/chart-engine/primitive";

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
    clip: rec("clip"),
    closePath: rec("closePath"),
    fillText: rec("fillText"),
    setLineDash: rec("setLineDash"),
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha"]) {
    Object.defineProperty(ctx, p, {
      get: () => props[p],
      set: (v: unknown) => {
        calls.push({ method: `set:${p}`, args: [v] });
        props[p] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx as unknown as FakeCtx;
}

describe("attachPrimitive shape guard (G4)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      type: string,
    ) {
      if (type !== "2d") return null;
      return makeFakeCtx();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it("refuses a non-primitive bag and attaches a valid EnginePrimitive", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 80,
      height: 40,
      devicePixelRatio: 1,
      scheduler,
    });
    const s = engine.addSeries("line", { color: "#fff" });
    s.setData([{ time: 1, value: 1 }, { time: 2, value: 2 }]);
    const before = (s.unwrap() as { primitives: unknown[] }).primitives.length;

    expect(() => s.attachPrimitive({})).toThrow(EngineRefusalError);
    try {
      s.attachPrimitive({});
    } catch (err) {
      expect(err).toBeInstanceOf(EngineRefusalError);
      const e = err as EngineRefusalError;
      expect(e.reason).toMatch(/not an EnginePrimitive/);
    }
    expect((s.unwrap() as { primitives: unknown[] }).primitives.length).toBe(before);

    const prim: EnginePrimitive = {
      id: "g4",
      attached() { /* */ },
      detached() { /* */ },
      update() { /* */ },
    };
    s.attachPrimitive(prim);
    expect((s.unwrap() as { primitives: unknown[] }).primitives.length).toBe(before + 1);
    engine.destroy();
  });
});

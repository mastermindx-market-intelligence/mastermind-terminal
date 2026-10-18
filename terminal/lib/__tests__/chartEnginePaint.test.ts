import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  paintArea,
  paintBars,
  paintBaseline,
  paintCandles,
  paintHistogram,
  paintLine,
  paintSeries,
  snapPx,
  snapWidth,
  type BarGeom,
  type BaselineGeom,
  type CandleGeom,
  type HistogramGeom,
  type LinePolyline,
  type PaintContext,
  type SeriesPaintStyle,
} from "@/lib/chart-engine/canvas/paint";

type RecordedCall = { op: string; args: unknown[] };

function createRecordingCtx(): { ctx: PaintContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const rec = (op: string) => (...args: unknown[]): void => {
    calls.push({ op, args });
  };
  let fillStyle: PaintContext["fillStyle"] = "";
  let strokeStyle: PaintContext["strokeStyle"] = "";
  let lineWidth = 1;
  let globalAlpha = 1;
  const ctx: PaintContext = {
    get fillStyle() { return fillStyle; },
    set fillStyle(v) { fillStyle = v; calls.push({ op: "fillStyle", args: [v] }); },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(v) { strokeStyle = v; calls.push({ op: "strokeStyle", args: [v] }); },
    get lineWidth() { return lineWidth; },
    set lineWidth(v) { lineWidth = v; calls.push({ op: "lineWidth", args: [v] }); },
    get globalAlpha() { return globalAlpha; },
    set globalAlpha(v) { globalAlpha = v; calls.push({ op: "globalAlpha", args: [v] }); },
    setLineDash: rec("setLineDash"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    rect: rec("rect"),
    fillRect: rec("fillRect"),
    strokeRect: rec("strokeRect"),
    closePath: rec("closePath"),
    fill: rec("fill"),
    stroke: rec("stroke"),
    save: rec("save"),
    restore: rec("restore"),
    clip: rec("clip"),
    translate: rec("translate"),
    scale: rec("scale"),
  };
  return { ctx, calls };
}

const STYLE: SeriesPaintStyle = {
  upColor: "up-body",
  downColor: "down-body",
  wickUpColor: "up-wick",
  wickDownColor: "down-wick",
  borderUpColor: "up-border",
  borderDownColor: "down-border",
  lineColor: "line",
  lineWidth: 1,
  lineStyle: "solid",
  topFillColor: "top-fill",
  bottomFillColor: "bottom-fill",
  topLineColor: "top-line",
  bottomLineColor: "bottom-line",
  baseValueColor: "base",
  priceLineVisible: false,
};

const VIEW = { dpr: 1, clipRect: { x: 0, y: 0, width: 200, height: 100 } };

function candle(
  x: number,
  up: boolean,
  extra: Partial<CandleGeom> = {},
): CandleGeom {
  return {
    x,
    halfWidth: 3,
    openY: up ? 40 : 20,
    closeY: up ? 20 : 40,
    highY: 10,
    lowY: 50,
    up,
    visible: true,
    ...extra,
  };
}

const THREE: CandleGeom[] = [
  candle(10, true),
  candle(20, false),
  candle(30, true, { openY: 30, closeY: 30 }),
];

function ops(calls: RecordedCall[]): string[] {
  return calls.map((c) => c.op);
}

function count(calls: RecordedCall[], op: string): number {
  return calls.filter((c) => c.op === op).length;
}

function assigned(calls: RecordedCall[], op: string): unknown[] {
  return calls.filter((c) => c.op === op).map((c) => c.args[0]);
}

function assertNoNaN(calls: RecordedCall[]): void {
  for (const c of calls) {
    for (const a of c.args) {
      if (typeof a === "number") {
        expect(Number.isFinite(a), `${c.op} received ${String(a)}`).toBe(true);
      }
    }
  }
}

function clipBalanced(calls: RecordedCall[]): void {
  expect(count(calls, "save")).toBe(count(calls, "restore"));
  expect(count(calls, "save")).toBeGreaterThan(0);
  expect(ops(calls).slice(0, 4)).toEqual(["save", "beginPath", "rect", "clip"]);
  expect(ops(calls)[ops(calls).length - 1]).toBe("restore");
}

describe("snapPx / snapWidth", () => {
  it("centres a 1 CSS-px stroke on a device pixel at dpr 1", () => {
    expect(snapPx(10, 1)).toBe(10.5);
    expect(snapPx(10.4, 1)).toBe(10.5);
    expect(snapPx(10.6, 1)).toBe(10.5);
  });

  it("uses no 0.5 offset at dpr 2 where 1 CSS px is an even device width", () => {
    expect(snapPx(10, 2)).toBe(10);
    expect(snapPx(10.2, 2)).toBe(10);
    expect(snapPx(10.3, 2)).toBe(10.5);
  });

  it("never returns a width thinner than one device pixel", () => {
    expect(snapWidth(0.1, 1)).toBe(1);
    expect(snapWidth(0.1, 2)).toBe(0.5);
    expect(snapWidth(2.4, 1)).toBe(2);
    expect(snapWidth(2.6, 1)).toBe(3);
  });
});

describe("paint.ts colour-literal law", () => {
  it("contains no hardcoded #rrggbb / rgb( colour literals", () => {
    const src = readFileSync(join(process.cwd(), "lib/chart-engine/canvas/paint.ts"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rgba?\s*\(/);
    expect(src).not.toMatch(/hsla?\s*\(/);
  });
});

describe("clip save/restore", () => {
  it("balances save and restore even with empty geometry", () => {
    for (const paint of [
      (ctx: PaintContext) => paintCandles(ctx, [], STYLE, VIEW),
      (ctx: PaintContext) => paintBars(ctx, [], STYLE, VIEW),
      (ctx: PaintContext) => paintLine(ctx, { points: [] }, STYLE, VIEW),
      (ctx: PaintContext) => paintArea(ctx, { line: { points: [] }, baseY: 50 }, STYLE, VIEW),
      (ctx: PaintContext) => paintHistogram(ctx, { columns: [] }, STYLE, VIEW),
      (ctx: PaintContext) => paintBaseline(ctx, { line: { points: [] }, baseY: 50 }, STYLE, VIEW),
    ]) {
      const { ctx, calls } = createRecordingCtx();
      paint(ctx);
      clipBalanced(calls);
    }
  });
});

describe("paintCandles", () => {
  it("draws three candles (up/down/doji) inside a clip with colour-batched fills", () => {
    const { ctx, calls } = createRecordingCtx();
    paintCandles(ctx, THREE, STYLE, VIEW);
    clipBalanced(calls);
    assertNoNaN(calls);
    expect(count(calls, "fill")).toBe(2);
    expect(count(calls, "fillRect")).toBe(0);
    const fills = assigned(calls, "fillStyle");
    expect(fills).toContain("up-body");
    expect(fills).toContain("down-body");
    expect(assigned(calls, "strokeStyle")).toContain("up-wick");
    expect(assigned(calls, "strokeStyle")).toContain("down-wick");
    expect(assigned(calls, "strokeStyle")).toContain("up-border");
    expect(assigned(calls, "strokeStyle")).toContain("down-border");
    const wickX = snapPx(10, 1);
    expect(calls.some((c) => c.op === "moveTo" && c.args[0] === wickX && c.args[1] === snapPx(10, 1))).toBe(true);
  });

  it("skips invisible bars and non-finite coordinates (no NaN ever reaches ctx)", () => {
    const { ctx, calls } = createRecordingCtx();
    paintCandles(ctx, [
      candle(10, true, { visible: false }),
      candle(Number.NaN, true),
      candle(20, false, { openY: Number.POSITIVE_INFINITY }),
      candle(30, true, { highY: Number.NaN }),
    ], STYLE, VIEW);
    clipBalanced(calls);
    assertNoNaN(calls);
    expect(count(calls, "fill")).toBe(0);
    expect(count(calls, "stroke")).toBe(0);
  });

  it("snaps wick centres at dpr 1 and dpr 2", () => {
    const geom = [candle(10, true)];
    const a = createRecordingCtx();
    paintCandles(a.ctx, geom, STYLE, { ...VIEW, dpr: 1 });
    expect(a.calls.some((c) => c.op === "moveTo" && c.args[0] === 10.5)).toBe(true);

    const b = createRecordingCtx();
    paintCandles(b.ctx, geom, STYLE, { ...VIEW, dpr: 2 });
    expect(b.calls.some((c) => c.op === "moveTo" && c.args[0] === 10)).toBe(true);
  });

  it("uses 1 device-px wicks when the body span is under 2 CSS px", () => {
    const { ctx, calls } = createRecordingCtx();
    paintCandles(ctx, [candle(10, true, { halfWidth: 0.4 })], STYLE, { ...VIEW, dpr: 2 });
    const widths = assigned(calls, "lineWidth");
    expect(widths).toContain(0.5);
  });
});

describe("colour batching", () => {
  it("issues O(colours) fill() calls for mixed candles, not O(bars)", () => {
    const bars: CandleGeom[] = [];
    for (let i = 0; i < 400; i++) bars.push(candle(i * 4, i % 2 === 0));
    const { ctx, calls } = createRecordingCtx();
    paintCandles(ctx, bars, STYLE, VIEW);
    expect(count(calls, "fill")).toBe(2);
    expect(count(calls, "fillRect")).toBe(0);
  });

  it("collapses to one fill() when upColor equals downColor (colour-keyed, not flag-keyed)", () => {
    const same: SeriesPaintStyle = { ...STYLE, upColor: "body", downColor: "body" };
    const bars: CandleGeom[] = [candle(10, true), candle(20, false), candle(30, true)];
    const { ctx, calls } = createRecordingCtx();
    paintCandles(ctx, bars, same, VIEW);
    expect(count(calls, "fill")).toBe(1);
    expect(assigned(calls, "fillStyle")).toEqual(["body"]);
  });

  it("maps up bodies to upColor and down bodies to downColor (falsifier: swap the ternary)", () => {
    const { ctx, calls } = createRecordingCtx();
    paintCandles(ctx, [candle(10, true), candle(20, false)], STYLE, VIEW);
    const styles = assigned(calls, "fillStyle");
    expect(styles[0]).toBe("up-body");
    expect(styles[1]).toBe("down-body");
  });
});

describe("paintBars", () => {
  it("batches OHLC ticks by up/down colour and draws open/close ticks", () => {
    const geom: BarGeom[] = THREE.map((c) => ({ ...c, openTickLength: 2, closeTickLength: 2 }));
    const { ctx, calls } = createRecordingCtx();
    paintBars(ctx, geom, STYLE, VIEW);
    clipBalanced(calls);
    assertNoNaN(calls);
    expect(count(calls, "stroke")).toBe(2);
    expect(assigned(calls, "strokeStyle")).toEqual(["up-body", "down-body"]);
    const xs = calls
      .filter((c) => c.op === "moveTo" || c.op === "lineTo")
      .map((c) => c.args[0] as number);
    expect(xs).toContain(snapPx(10 + 2, 1));
    expect(xs).toContain(snapPx(10 - 2, 1));
  });
});

describe("paintLine", () => {
  it("breaks the polyline at null gaps (moveTo on the next finite point)", () => {
    const geom: LinePolyline = {
      points: [{ x: 0, y: 10 }, { x: 10, y: 12 }, null, { x: 30, y: 14 }, { x: 40, y: 16 }],
    };
    const { ctx, calls } = createRecordingCtx();
    paintLine(ctx, geom, STYLE, VIEW);
    clipBalanced(calls);
    const path = calls.filter((c) => c.op === "moveTo" || c.op === "lineTo");
    expect(path.map((c) => c.op)).toEqual(["moveTo", "lineTo", "moveTo", "lineTo"]);
    expect(path[0].args).toEqual([snapPx(0, 1), snapPx(10, 1)]);
    expect(path[1].args).toEqual([snapPx(10, 1), snapPx(12, 1)]);
    expect(path[2].args).toEqual([snapPx(30, 1), snapPx(14, 1)]);
    expect(path[3].args).toEqual([snapPx(40, 1), snapPx(16, 1)]);
    expect(assigned(calls, "strokeStyle")).toContain("line");
  });

  it("applies dashed lineStyle via setLineDash", () => {
    const { ctx, calls } = createRecordingCtx();
    paintLine(ctx, { points: [{ x: 0, y: 10 }, { x: 10, y: 10 }] }, { ...STYLE, lineStyle: "dashed" }, VIEW);
    expect(assigned(calls, "setLineDash")).toContainEqual([2, 2]);
  });

  it("treats non-finite vertices as gap breaks", () => {
    const geom: LinePolyline = {
      points: [{ x: 0, y: 10 }, { x: Number.NaN, y: 12 }, { x: 30, y: 14 }],
    };
    const { ctx, calls } = createRecordingCtx();
    paintLine(ctx, geom, STYLE, VIEW);
    assertNoNaN(calls);
    expect(count(calls, "moveTo")).toBe(2);
  });
});

describe("paintArea", () => {
  it("closes each gap-separated segment down to baseY and does not stroke across the gap", () => {
    const geom = {
      line: { points: [{ x: 0, y: 10 }, { x: 10, y: 12 }, null, { x: 30, y: 14 }, { x: 40, y: 16 }] },
      baseY: 50,
    };
    const { ctx, calls } = createRecordingCtx();
    paintArea(ctx, geom, STYLE, VIEW);
    clipBalanced(calls);
    expect(count(calls, "closePath")).toBe(2);
    expect(count(calls, "fill")).toBe(1);
    expect(assigned(calls, "fillStyle")).toContain("top-fill");

    let last: [number, number] | null = null;
    for (const c of calls) {
      if (c.op === "moveTo") {
        last = c.args as [number, number];
        continue;
      }
      if (c.op === "lineTo" && last) {
        const fromX = last[0];
        const toX = c.args[0] as number;
        expect(Math.abs(fromX - snapPx(10, 1)) < 1e-9 && Math.abs(toX - snapPx(30, 1)) < 1e-9).toBe(false);
        last = c.args as [number, number];
      }
    }
    const by = 50;
    expect(calls.some((c) => (c.op === "moveTo" || c.op === "lineTo") && c.args[1] === by)).toBe(true);
  });
});

describe("paintHistogram", () => {
  it("batches columns by fill colour", () => {
    const geom: HistogramGeom = {
      columns: [
        { x: 10, halfWidth: 3, topY: 20, baseY: 50, up: true },
        { x: 20, halfWidth: 3, topY: 30, baseY: 50, up: false },
        { x: 30, halfWidth: 3, topY: 15, baseY: 50, up: true },
      ],
    };
    const { ctx, calls } = createRecordingCtx();
    paintHistogram(ctx, geom, STYLE, VIEW);
    clipBalanced(calls);
    expect(count(calls, "fill")).toBe(2);
    expect(assigned(calls, "fillStyle")).toEqual(["up-body", "down-body"]);
  });
});

describe("paintBaseline", () => {
  it("interpolates the crossing so there is no horizontal step at the base", () => {
    const geom: BaselineGeom = {
      line: { points: [{ x: 0, y: 10 }, { x: 10, y: 30 }] },
      baseY: 20,
    };
    const { ctx, calls } = createRecordingCtx();
    paintBaseline(ctx, geom, STYLE, VIEW);
    clipBalanced(calls);
    const crossX = snapPx(5, 1);
    const crossY = snapPx(20, 1);
    const hits = calls.filter(
      (c) => (c.op === "moveTo" || c.op === "lineTo") && c.args[0] === crossX && c.args[1] === crossY,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(assigned(calls, "fillStyle")).toContain("top-fill");
    expect(assigned(calls, "fillStyle")).toContain("bottom-fill");
    expect(assigned(calls, "strokeStyle")).toContain("top-line");
    expect(assigned(calls, "strokeStyle")).toContain("bottom-line");
    expect(assigned(calls, "strokeStyle")).toContain("base");
  });

  it("breaks both sides at a null gap", () => {
    const geom: BaselineGeom = {
      line: { points: [{ x: 0, y: 10 }, { x: 10, y: 8 }, null, { x: 30, y: 40 }, { x: 40, y: 42 }] },
      baseY: 20,
    };
    const { ctx, calls } = createRecordingCtx();
    paintBaseline(ctx, geom, STYLE, VIEW);
    assertNoNaN(calls);
    expect(count(calls, "moveTo")).toBeGreaterThanOrEqual(2);
  });
});

describe("paintSeries dispatcher", () => {
  it("routes each of the six kinds onto the named painter", () => {
    const cases: Array<() => RecordedCall[]> = [
      () => { const r = createRecordingCtx(); paintSeries(r.ctx, "candles", THREE, STYLE, VIEW); return r.calls; },
      () => { const r = createRecordingCtx(); paintSeries(r.ctx, "bars", THREE.map((c) => ({ ...c, openTickLength: 2, closeTickLength: 2 })), STYLE, VIEW); return r.calls; },
      () => { const r = createRecordingCtx(); paintSeries(r.ctx, "line", { points: [{ x: 0, y: 1 }, { x: 2, y: 3 }] }, STYLE, VIEW); return r.calls; },
      () => { const r = createRecordingCtx(); paintSeries(r.ctx, "area", { line: { points: [{ x: 0, y: 1 }, { x: 2, y: 3 }] }, baseY: 10 }, STYLE, VIEW); return r.calls; },
      () => { const r = createRecordingCtx(); paintSeries(r.ctx, "histogram", { columns: [{ x: 4, halfWidth: 2, topY: 1, baseY: 8, up: true }] }, STYLE, VIEW); return r.calls; },
      () => { const r = createRecordingCtx(); paintSeries(r.ctx, "baseline", { line: { points: [{ x: 0, y: 1 }, { x: 8, y: 9 }] }, baseY: 5 }, STYLE, VIEW); return r.calls; },
    ];
    for (const run of cases) {
      const calls = run();
      clipBalanced(calls);
      assertNoNaN(calls);
    }
  });
});

describe("perf", () => {
  it("paints 40k candles through the recorder well under 400 ms", () => {
    const n = 40_000;
    const bars: CandleGeom[] = new Array(n);
    for (let i = 0; i < n; i++) {
      bars[i] = {
        x: i,
        halfWidth: 2,
        openY: 40,
        closeY: i % 2 === 0 ? 20 : 50,
        highY: 10,
        lowY: 60,
        up: i % 2 === 0,
        visible: true,
      };
    }
    const { ctx, calls } = createRecordingCtx();
    const t0 = performance.now();
    paintCandles(ctx, bars, STYLE, VIEW);
    const dt = performance.now() - t0;
    // Generous hard bound; typical recorder time on this host is well under 80 ms.
    console.log(`paint 40k candles (recorder): ${dt.toFixed(2)} ms`);
    expect(dt).toBeLessThan(400);
    expect(count(calls, "fill")).toBe(2);
    expect(count(calls, "fillRect")).toBe(0);
    expect(count(calls, "save")).toBe(count(calls, "restore"));
  });
});

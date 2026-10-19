// @vitest-environment jsdom
// mm parity — LWC per-row colours, part visibility, dense histograms and the line-width
// default. Production paints volume, MACD, squeeze and Pine columns from `{}` series
// options plus a colour on every row; before this, mm dropped every one of them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANVAS_NEUTRAL_DEFAULTS, createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import type { EngineBar } from "@/lib/chart-engine/api";

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

function mount() {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(container, { width: 200, height: 100, devicePixelRatio: 1, scheduler });
  return { engine, scheduler };
}

function paneCtx(engine: ReturnType<typeof createCanvasEngine>): FakeCtx {
  const canvas = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
  const ctx = ctxByCanvas.get(canvas);
  if (!ctx) throw new Error("no ctx for pane canvas");
  return ctx;
}

type Rect = { x: number; y: number; w: number; h: number };
type Batch = { color: unknown; rects: Rect[]; moves: number };

/** Each fill()/stroke() with the colour in force and the path it closed. */
function batches(ctx: FakeCtx, op: "fill" | "stroke"): Batch[] {
  const out: Batch[] = [];
  let fillStyle: unknown;
  let strokeStyle: unknown;
  let rects: Rect[] = [];
  let moves = 0;
  for (const c of ctx.__calls) {
    if (c.method === "set:fillStyle") fillStyle = c.args[0];
    else if (c.method === "set:strokeStyle") strokeStyle = c.args[0];
    else if (c.method === "beginPath") { rects = []; moves = 0; }
    else if (c.method === "rect") {
      const [x, y, w, h] = c.args as number[];
      rects.push({ x, y, w, h });
    } else if (c.method === "moveTo") moves++;
    else if (c.method === op) out.push({ color: op === "fill" ? fillStyle : strokeStyle, rects, moves });
  }
  return out;
}

const colors = (bs: Batch[]) => bs.map((b) => b.color);
const rectsOf = (bs: Batch[], color: string) => bs.filter((b) => b.color === color).flatMap((b) => b.rects);
const movesOf = (bs: Batch[], color: string) => bs.filter((b) => b.color === color).reduce((n, b) => n + b.moves, 0);

const T0 = 1_700_000_000;
const OHLC: EngineBar[] = [
  { time: T0, open: 10, high: 12, low: 9, close: 11, color: "body1", borderColor: "border1", wickColor: "wick1" },
  { time: T0 + 60, open: 11, high: 14, low: 10, close: 13, color: "body2" },
  { time: T0 + 120, open: 13, high: 15, low: 12, close: 12 },
];

describe("histogram per-row colours with `{}` series options (volume / MACD / Pine)", () => {
  it("paints each row in its own colour; a row with no colour stays unpainted (F6)", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("histogram", {});
    s.setData([
      { time: T0, value: 10, color: "pos" },
      { time: T0 + 60, value: -4, color: "neg" },
      { time: T0 + 120, value: 12 },
    ]);
    engine.timeScale().fitContent();
    scheduler.flush();
    const fills = batches(paneCtx(engine), "fill");
    expect(rectsOf(fills, "pos")).toHaveLength(1);
    expect(rectsOf(fills, "neg")).toHaveLength(1);
    expect(colors(fills)).not.toContain(CANVAS_NEUTRAL_DEFAULTS.seriesColor);
    expect(colors(fills)).not.toContain("");
    engine.destroy();
  });

  it("a row colour wins over the series colour for that column only", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("histogram", { color: "series" });
    s.setData([
      { time: T0, value: 10, color: "row" },
      { time: T0 + 60, value: 4 },
      { time: T0 + 120, value: 12 },
    ]);
    engine.timeScale().fitContent();
    scheduler.flush();
    const fills = batches(paneCtx(engine), "fill");
    expect(rectsOf(fills, "row")).toHaveLength(1);
    expect(rectsOf(fills, "series")).toHaveLength(2);
    engine.destroy();
  });
});

describe("candles per-row colours follow LWC precedence", () => {
  it("row color paints the body only; borderColor / wickColor paint their own part", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);
    engine.timeScale().fitContent();
    scheduler.flush();
    const ctx = paneCtx(engine);
    const fills = batches(ctx, "fill");
    const strokes = batches(ctx, "stroke");
    expect(rectsOf(fills, "body1")).toHaveLength(1);
    expect(rectsOf(fills, "body2")).toHaveLength(1);
    expect(rectsOf(fills, "D")).toHaveLength(1);
    expect(movesOf(strokes, "wick1")).toBe(1);
    expect(rectsOf(strokes, "border1")).toHaveLength(1);
    // Row 2 sets only `color`: its wick and border stay the series up colour.
    expect(colors(strokes)).not.toContain("body2");
    expect(movesOf(strokes, "U")).toBe(1);
    expect(rectsOf(strokes, "U")).toHaveLength(1);
    engine.destroy();
  });

  it("a colourless candles series paints only the parts whose row carries a colour", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles");
    s.setData(OHLC);
    engine.timeScale().fitContent();
    scheduler.flush();
    const ctx = paneCtx(engine);
    const fills = batches(ctx, "fill");
    const strokes = batches(ctx, "stroke");
    expect(rectsOf(fills, "body1")).toHaveLength(1);
    expect(rectsOf(fills, "body2")).toHaveLength(1);
    expect(movesOf(strokes, "wick1")).toBe(1);
    expect(rectsOf(strokes, "border1")).toHaveLength(1);
    for (const c of [...colors(fills), ...colors(strokes)]) {
      expect(c).not.toBe("");
      expect(c).not.toBe(CANVAS_NEUTRAL_DEFAULTS.seriesColor);
    }
    engine.destroy();
  });
});

describe("candle part visibility", () => {
  const opts = {
    upColor: "U", downColor: "D",
    wickUpColor: "WU", wickDownColor: "WD",
    borderUpColor: "BU", borderDownColor: "BD",
  };
  const rows: EngineBar[] = OHLC.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));

  function paint(extra: Record<string, unknown>) {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { ...opts, ...extra });
    s.setData(rows);
    engine.timeScale().fitContent();
    scheduler.flush();
    const ctx = paneCtx(engine);
    const out = { fills: batches(ctx, "fill"), strokes: batches(ctx, "stroke") };
    engine.destroy();
    return out;
  }

  it("wickVisible:false hides the wicks and keeps every body", () => {
    const shown = paint({});
    expect(movesOf(shown.strokes, "WU") + movesOf(shown.strokes, "WD")).toBe(3);
    const hidden = paint({ wickVisible: false });
    expect(movesOf(hidden.strokes, "WU") + movesOf(hidden.strokes, "WD")).toBe(0);
    expect(rectsOf(hidden.fills, "U").length + rectsOf(hidden.fills, "D").length).toBe(3);
  });

  it("borderVisible:false hides the borders and keeps every body and wick", () => {
    const shown = paint({});
    expect(rectsOf(shown.strokes, "BU").length + rectsOf(shown.strokes, "BD").length).toBe(3);
    const hidden = paint({ borderVisible: false });
    expect(rectsOf(hidden.strokes, "BU").length + rectsOf(hidden.strokes, "BD").length).toBe(0);
    expect(rectsOf(hidden.fills, "U").length + rectsOf(hidden.fills, "D").length).toBe(3);
    expect(movesOf(hidden.strokes, "WU") + movesOf(hidden.strokes, "WD")).toBe(3);
  });
});

describe("bars per-row colour", () => {
  it("a row color strokes that bar; the others keep the series colours", () => {
    const { engine, scheduler } = mount();
    // The price line strokes in the last bar's colour ("D"); hide it so only bar strokes count.
    const s = engine.addSeries("bars", { upColor: "U", downColor: "D", priceLineVisible: false });
    s.setData(OHLC);
    engine.timeScale().fitContent();
    scheduler.flush();
    const strokes = batches(paneCtx(engine), "stroke");
    // Each bar is three strokes: high-low, open tick, close tick.
    expect(movesOf(strokes, "body1")).toBe(3);
    expect(movesOf(strokes, "body2")).toBe(3);
    expect(movesOf(strokes, "D")).toBe(3);
    engine.destroy();
  });
});

describe("dense (LOD) columns", () => {
  const N = 2000;
  const dense = (i: number) => T0 + i * 60;

  it("histogram columns stand on the base and keep their row colour", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("histogram", {});
    s.setData(Array.from({ length: N }, (_, i) => ({ time: dense(i), value: 5 + (i % 7), color: "vol" })));
    engine.timeScale().fitContent();
    scheduler.flush();
    const baseY = s.priceToCoordinate(0)!;
    const cols = rectsOf(batches(paneCtx(engine), "fill"), "vol");
    expect(cols.length).toBeGreaterThan(50);
    for (const r of cols) expect(Math.abs(r.y + r.h - baseY)).toBeLessThanOrEqual(1);
    engine.destroy();
  });

  it("histogram columns of negative values hang from the base", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("histogram", { color: "h" });
    s.setData(Array.from({ length: N }, (_, i) => ({ time: dense(i), value: -5 - (i % 7) })));
    engine.timeScale().fitContent();
    scheduler.flush();
    const baseY = s.priceToCoordinate(0)!;
    const cols = rectsOf(batches(paneCtx(engine), "fill"), "h");
    expect(cols.length).toBeGreaterThan(50);
    for (const r of cols) expect(Math.abs(r.y - baseY)).toBeLessThanOrEqual(1);
    engine.destroy();
  });

  it("dense candles and bars keep the per-row colour of each column's last bar", () => {
    for (const kind of ["candles", "bars"] as const) {
      const { engine, scheduler } = mount();
      const s = engine.addSeries(kind, { upColor: "U", downColor: "D" });
      s.setData(Array.from({ length: N }, (_, i) => ({
        time: dense(i), open: 10, high: 12, low: 9, close: 11, color: "tint",
      })));
      engine.timeScale().fitContent();
      scheduler.flush();
      const fills = batches(paneCtx(engine), "fill");
      expect(rectsOf(fills, "tint").length, kind).toBeGreaterThan(50);
      expect(rectsOf(fills, "U"), kind).toHaveLength(0);
      engine.destroy();
    }
  });
});

describe("dense (LOD) candle part visibility", () => {
  it("wickVisible:false still hides the wicks when columns are aggregated", () => {
    const wickMoves = (extra: Record<string, unknown>) => {
      const { engine, scheduler } = mount();
      const s = engine.addSeries("candles", { upColor: "U", downColor: "D", wickUpColor: "WU", wickDownColor: "WD", ...extra });
      s.setData(Array.from({ length: 2000 }, (_, i) => ({ time: T0 + i * 60, open: 10, high: 12 + (i % 3), low: 8, close: 11 })));
      engine.timeScale().fitContent();
      scheduler.flush();
      const strokes = batches(paneCtx(engine), "stroke");
      engine.destroy();
      return movesOf(strokes, "WU") + movesOf(strokes, "WD");
    };
    expect(wickMoves({})).toBeGreaterThan(50);
    expect(wickMoves({ wickVisible: false })).toBe(0);
  });
});

describe("line width default", () => {
  it("a line series without lineWidth strokes 3px, as LWC does", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "L" });
    s.setData([{ time: T0, value: 1 }, { time: T0 + 60, value: 2 }, { time: T0 + 120, value: 1.5 }]);
    scheduler.flush();
    const calls = paneCtx(engine).__calls;
    const at = calls.findIndex((c) => c.method === "set:strokeStyle" && c.args[0] === "L");
    expect(at).toBeGreaterThanOrEqual(0);
    const width = calls.slice(at).find((c) => c.method === "set:lineWidth");
    expect(width?.args[0]).toBe(3);
    engine.destroy();
  });
});

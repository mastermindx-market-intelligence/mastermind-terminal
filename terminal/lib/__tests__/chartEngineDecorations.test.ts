import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the native chart-engine decorations module (lib/chart-engine/canvas/
// decorations.ts): pure layout (markers, price lines, watermark, session
// shading) plus the painter over a structural ctx.
//
// No DOM is needed: paintDecorations takes a structural subset of
// CanvasRenderingContext2D, so the "canvas" here is a recording fake object and
// the suite runs in plain Node (no jsdom pragma, no HTMLCanvasElement stub).
// Every assertion is against the documented layout rules, with rule numbers
// (base size, gap, dash table, label geometry) hardcoded HERE on purpose — a
// mutant that changes the implementation must turn these red.
// ─────────────────────────────────────────────────────────────────────────────

import {
  layoutMarkers,
  layoutPriceLines,
  layoutWatermark,
  layoutSessionShading,
  paintDecorations,
  type PaintContext,
  type Projection,
  type Rect,
  type RowsIndex,
} from "../chart-engine/canvas/decorations";
import type { MarkerSpec, PriceLineSpec } from "../chart-engine/api";

// ── Fakes ──────────────────────────────────────────────────────────────────────

type ViewOpts = {
  widthPx?: number;
  visibleFrom?: number;
  visibleTo?: number;
  heightPx?: number;
  priceFrom?: number;
  priceTo?: number;
  plotTop?: number;
  plotHeight?: number;
  dpr?: number;
};

// Linear projection in the masterplan's coordinate convention:
// x(i) = (i - visibleFrom + 0.5) * barSpacing; price maps top-down over the plot.
function makeProjection(o: ViewOpts = {}): { projection: Projection; barSpacing: number } {
  const widthPx = o.widthPx ?? 500;
  const visibleFrom = o.visibleFrom ?? 0;
  const visibleTo = o.visibleTo ?? 5;
  const heightPx = o.heightPx ?? 200;
  const priceFrom = o.priceFrom ?? 0;
  const priceTo = o.priceTo ?? 100;
  const plotTop = o.plotTop ?? 0;
  const plotHeight = o.plotHeight ?? heightPx;
  const barSpacing = widthPx / (visibleTo - visibleFrom);
  const projection: Projection = {
    generation: 1,
    dpr: o.dpr ?? 1,
    widthPx,
    heightPx,
    xOfLogical: (i) => (i - visibleFrom + 0.5) * barSpacing,
    logicalOfX: (x) => visibleFrom + x / barSpacing - 0.5,
    yOfPrice: (p) => plotTop + ((priceTo - p) / (priceTo - priceFrom)) * plotHeight,
    priceOfY: (y) => priceTo - ((y - plotTop) / plotHeight) * (priceTo - priceFrom),
  };
  return { projection, barSpacing };
}

type FakeRow = { time: number; highY: number; lowY: number; closeY: number };

function makeRows(rows: FakeRow[]): RowsIndex {
  const indexOf = new Map<number, number>(rows.map((r, i) => [r.time, i]));
  return {
    indexOfTime: (t) => {
      const i = indexOf.get(t as number);
      return i === undefined ? null : i;
    },
    highY: (i) => (rows[i] === undefined ? NaN : rows[i].highY),
    lowY: (i) => (rows[i] === undefined ? NaN : rows[i].lowY),
    closeY: (i) => (rows[i] === undefined ? NaN : rows[i].closeY),
  };
}

// Recording ctx: every call appends { m, args, state } where state is the ctx
// style snapshot AT CALL TIME — so tests can assert which colour/font a stroke
// or fill actually used, not just that it happened.
type RecordedOp = {
  m: string;
  args: unknown[];
  state: {
    fillStyle: unknown;
    strokeStyle: unknown;
    lineWidth: unknown;
    font: unknown;
    textAlign: unknown;
    textBaseline: unknown;
  };
};

function makeCtx() {
  const ops: RecordedOp[] = [];
  const ctx = {
    fillStyle: "<<fill>>",
    strokeStyle: "<<stroke>>",
    lineWidth: -1,
    font: "<<font>>",
    textAlign: "<<align>>",
    textBaseline: "<<baseline>>",
    save: () => record("save"),
    restore: () => record("restore"),
    beginPath: () => record("beginPath"),
    moveTo: (x: number, y: number) => record("moveTo", x, y),
    lineTo: (x: number, y: number) => record("lineTo", x, y),
    arc: (x: number, y: number, r: number, a: number, b: number) => record("arc", x, y, r, a, b),
    rect: (x: number, y: number, w: number, h: number) => record("rect", x, y, w, h),
    closePath: () => record("closePath"),
    fill: () => record("fill"),
    stroke: () => record("stroke"),
    fillText: (t: string, x: number, y: number) => record("fillText", t, x, y),
    fillRect: (x: number, y: number, w: number, h: number) => record("fillRect", x, y, w, h),
    setLineDash: (d: number[]) => record("setLineDash", d),
  };
  function record(m: string, ...args: unknown[]) {
    ops.push({
      m,
      args,
      state: {
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        font: ctx.font,
        textAlign: ctx.textAlign,
        textBaseline: ctx.textBaseline,
      },
    });
  }
  return { ctx: ctx as unknown as PaintContext, ops };
}

const fakeMeasure = (text: string): number => text.length * 7;

// Narrowing helper for optional lookups: a missing op IS a test failure, so fail
// loudly with what was expected rather than sprinkling non-null assertions.
function req<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`expected op not recorded: ${what}`);
  return v;
}

const ROWS: FakeRow[] = [
  { time: 100, highY: 80, lowY: 160, closeY: 120 },
  { time: 200, highY: 60, lowY: 150, closeY: 110 },
  { time: 300, highY: 70, lowY: 170, closeY: 130 },
];

// ── layoutMarkers ──────────────────────────────────────────────────────────────

describe("layoutMarkers", () => {
  function run(markers: MarkerSpec[], opts: { barSpacing?: number; dpr?: number } = {}) {
    const { projection } = makeProjection({ dpr: opts.dpr ?? 1 });
    return layoutMarkers(markers, {
      projection,
      rowsIndex: makeRows(ROWS),
      barSpacing: opts.barSpacing ?? 10,
      dpr: opts.dpr ?? 1,
    });
  }

  // LWC geometry at barSpacing 10: clamp(10, 12, 30) = 12 -> size(12, 1) = ceiledOdd(12) = 11,
  // calculateShapeHeight = ceiledEven(11) = 10 (half 5), shapeMargin = max(ceiledOdd(1.2) = 1, 3) = 3.
  const SHAPE = 10;
  const HALF = SHAPE / 2;
  const MARGIN = 3;

  it("anchors the first aboveBar marker one shapeMargin above the bar high (LWC offsets start at shapeMargin)", () => {
    const { markers, dropped } = run([{ time: 100, position: "aboveBar", shape: "arrowUp", color: "c" }]);
    expect(dropped).toBe(0);
    // y = highY - half - shapeMargin = 80 - 5 - 3
    expect(markers[0]).toMatchObject({ x: 50, y: 80 - HALF - MARGIN, size: SHAPE, shape: "arrowUp", color: "c" });
  });

  it("stacks a second and third aboveBar marker upward by size + shapeMargin each", () => {
    const { markers } = run([
      { time: 100, position: "aboveBar", shape: "circle", color: "a" },
      { time: 100, position: "aboveBar", shape: "square", color: "b" },
      { time: 100, position: "aboveBar", shape: "circle", color: "c" },
    ]);
    // offsets 3 -> 16 -> 29: 80 - 5 - 3 = 72; 80 - 5 - 16 = 59; 80 - 5 - 29 = 46
    expect(markers.map((m) => m.y)).toEqual([72, 59, 46]);
    // first input marker is the one closest to the bar
    expect(markers[0].color).toBe("a");
    expect(markers[2].color).toBe("c");
  });

  it("stacks belowBar markers downward from the bar low", () => {
    const { markers } = run([
      { time: 100, position: "belowBar", shape: "circle", color: "a" },
      { time: 100, position: "belowBar", shape: "circle", color: "b" },
    ]);
    // first: 160 + 5 + 3 = 168; second: 160 + 5 + 16 = 181
    expect(markers.map((m) => m.y)).toEqual([168, 181]);
  });

  it("stacks per bar: markers on different bars never stack", () => {
    const { markers } = run([
      { time: 100, position: "aboveBar", shape: "circle", color: "a" },
      { time: 200, position: "aboveBar", shape: "circle", color: "b" },
    ]);
    expect(markers.map((m) => m.y)).toEqual([72, 52]); // both highY - half - shapeMargin
  });

  it("anchors aboveBar to the upper screen edge of the bar on an inverted scale (LWC getPrice high/low swap)", () => {
    // Inverted scale: the bar's low is drawn ABOVE its high.
    const rows = makeRows([{ time: 100, highY: 160, lowY: 80, closeY: 120 }]);
    const { projection } = makeProjection();
    const res = layoutMarkers(
      [
        { time: 100, position: "aboveBar", shape: "circle", color: "a" },
        { time: 100, position: "belowBar", shape: "circle", color: "b" },
      ],
      { projection, rowsIndex: rows, barSpacing: 10, dpr: 1 },
    );
    expect(res.markers.map((m) => m.y)).toEqual([72, 168]);
  });

  it("centres inBar markers on the close and never stacks them", () => {
    const { markers } = run([
      { time: 100, position: "inBar", shape: "circle", color: "a" },
      { time: 100, position: "inBar", shape: "square", color: "b" },
    ]);
    expect(markers.map((m) => m.y)).toEqual([120, 120]);
  });

  it("anchors atPrice markers to the spec price; atPriceMiddle is exact", () => {
    const { projection } = makeProjection({ priceFrom: 0, priceTo: 100, plotHeight: 200 });
    const res = layoutMarkers(
      [
        { time: 100, position: "atPriceMiddle", shape: "circle", color: "a", price: 50 },
        { time: 100, position: "atPriceTop", shape: "circle", color: "b", price: 50 },
        { time: 100, position: "atPriceBottom", shape: "circle", color: "c", price: 50 },
        { time: 100, position: "atPriceMiddle", shape: "circle", color: "d" },
      ],
      { projection, rowsIndex: makeRows(ROWS), barSpacing: 10, dpr: 1 },
    );
    expect(res.dropped).toBe(1); // atPrice without a finite price is not placeable
    // middle: exact; top: priceY - half; bottom: priceY + half — no stack offset for price markers
    expect(res.markers.map((m) => m.y)).toEqual([100, 100 - HALF, 100 + HALF]);
  });

  it("sizes the glyph as LWC calculateShapeHeight(clamp(barSpacing, 12, 30)) × the spec size", () => {
    const tiny = run([{ time: 100, position: "inBar", shape: "circle", color: "a" }], { barSpacing: 3 });
    const mid = run([{ time: 100, position: "inBar", shape: "circle", color: "a" }], { barSpacing: 20 });
    const big = run([{ time: 100, position: "inBar", shape: "circle", color: "a" }], { barSpacing: 100 });
    const scaled = run([{ time: 100, position: "inBar", shape: "circle", color: "a", size: 2 }], { barSpacing: 10 });
    const hidden = run([{ time: 100, position: "inBar", shape: "circle", color: "a", size: -3 }]);
    expect(tiny.markers[0].size).toBe(10); // clamp 12 -> ceiledOdd 11 -> ceiledEven 10
    expect(mid.markers[0].size).toBe(18); // 20 -> 19 -> 18
    expect(big.markers[0].size).toBe(28); // clamp 30 -> 29 -> 28
    expect(scaled.markers[0].size).toBe(20);
    // LWC: max(size, 0) — a negative multiplier hides the glyph but keeps the marker
    expect(hidden.markers[0].size).toBe(0);
  });

  it("size 0 still advances the per-bar stack (LWC offsets += shapeSize + shapeMargin)", () => {
    const { markers } = run([
      { time: 100, position: "aboveBar", shape: "circle", color: "a", size: 0 },
      { time: 100, position: "aboveBar", shape: "circle", color: "b" },
    ]);
    // first: 80 - 0 - 3 = 77 (size 0); offset 3 + 0 + 3 = 6; second: 80 - 5 - 6 = 69
    expect(markers.map((m) => [m.size, m.y])).toEqual([[0, 77], [SHAPE, 69]]);
  });

  it("drops markers whose time is absent from the index and reports the count", () => {
    const { markers, dropped } = run([
      { time: 999, position: "aboveBar", shape: "circle", color: "gone" },
      { time: 100, position: "aboveBar", shape: "circle", color: "kept" },
      { time: "2020-01-01", position: "aboveBar", shape: "circle", color: "gone-too" },
    ]);
    expect(dropped).toBe(2);
    expect(markers).toHaveLength(1);
    expect(markers[0].color).toBe("kept");
    expect(markers[0].x).toBe(50); // the survivor is at ITS bar, never at x=0
  });

  it("drops markers whose row anchors are NaN (NaN guard)", () => {
    const rows = makeRows([{ time: 100, highY: NaN, lowY: NaN, closeY: NaN }]);
    const { projection } = makeProjection();
    const res = layoutMarkers(
      [{ time: 100, position: "aboveBar", shape: "circle", color: "a" }],
      { projection, rowsIndex: rows, barSpacing: 10, dpr: 1 },
    );
    expect(res.markers).toHaveLength(0);
    expect(res.dropped).toBe(1);
  });

  it("drops every marker when barSpacing is NaN instead of emitting NaN sizes", () => {
    const { markers, dropped } = run([
      { time: 100, position: "inBar", shape: "circle", color: "a" },
      { time: 200, position: "inBar", shape: "circle", color: "b" },
    ], { barSpacing: NaN });
    expect(markers).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  it("snaps marker centres to the device pixel grid", () => {
    // barSpacing 9 -> clamp 12 -> shape 10, margin 3; raw y = 100.3 - 5 - 3 = 92.3 -> 92.5 at dpr 2, 92 at dpr 1
    const rows = makeRows([{ time: 100, highY: 100.3, lowY: 200, closeY: 150 }]);
    const { projection } = makeProjection({ dpr: 2 });
    const r2 = layoutMarkers(
      [{ time: 100, position: "aboveBar", shape: "circle", color: "a" }],
      { projection, rowsIndex: rows, barSpacing: 9, dpr: 2 },
    );
    const r1 = layoutMarkers(
      [{ time: 100, position: "aboveBar", shape: "circle", color: "a" }],
      { projection: { ...projection, dpr: 1 }, rowsIndex: rows, barSpacing: 9, dpr: 1 },
    );
    expect(r2.markers[0].y).toBeCloseTo(92.5, 10);
    expect(r1.markers[0].y).toBeCloseTo(92, 10);
  });

  it("centres aboveBar text on the glyph x, 0.6 × fontSize above the glyph top (LWC TextMargin)", () => {
    const { markers } = run([{ time: 100, position: "aboveBar", shape: "arrowUp", color: "c", text: "BUY" }]);
    const m = markers[0];
    expect(m.text).toBe("BUY");
    expect(m.textX).toBe(50);
    expect(m.textAlign).toBe("center");
    // y 72; text = 72 - 5 - 0.6 * 12 = 59.8 -> snapped 60 at dpr 1
    expect(m.textY).toBe(60);
    expect(m.font).toBe("12px sans-serif");
  });

  it("puts belowBar, inBar and atPriceMiddle text under the glyph: y + half + shapeMargin + 0.6 × fontSize", () => {
    const { projection } = makeProjection({ priceFrom: 0, priceTo: 100, plotHeight: 200 });
    const { markers } = layoutMarkers(
      [
        { time: 100, position: "belowBar", shape: "circle", color: "a", text: "b" },
        { time: 100, position: "inBar", shape: "circle", color: "a", text: "i" },
        { time: 100, position: "atPriceMiddle", shape: "circle", color: "a", text: "m", price: 50 },
        { time: 100, position: "atPriceTop", shape: "circle", color: "a", text: "t", price: 50 },
      ],
      { projection, rowsIndex: makeRows(ROWS), barSpacing: 10, dpr: 1 },
    );
    // belowBar y 168 -> 168 + 5 + 3 + 7.2 = 183.2 -> 183; inBar 120 -> 135.2 -> 135;
    // atPriceMiddle 100 -> 115.2 -> 115; atPriceTop y 95 -> 95 - 5 - 7.2 = 82.8 -> 83
    expect(markers.map((m) => m.textY)).toEqual([183, 135, 115, 83]);
  });

  it("a text line advances the per-bar stack by 1.2 × fontSize before the glyph span", () => {
    const { markers } = run([
      { time: 100, position: "aboveBar", shape: "arrowUp", color: "c", text: "BUY" },
      { time: 100, position: "aboveBar", shape: "circle", color: "d" },
    ]);
    // offset 3 + 14.4 (text) + 13 (shape + margin) = 30.4; second y = 80 - 5 - 30.4 = 44.6 -> 45
    expect(markers.map((m) => m.y)).toEqual([72, 45]);
  });

  it("lays text out in the host's layout font and font size", () => {
    const { projection } = makeProjection();
    const { markers } = layoutMarkers(
      [{ time: 100, position: "aboveBar", shape: "circle", color: "c", text: "x" }],
      { projection, rowsIndex: makeRows(ROWS), barSpacing: 10, dpr: 1, fontSize: 20, font: "20px Fam" },
    );
    // 72 - 5 - 0.6 * 20 = 55
    expect(markers[0].textY).toBe(55);
    expect(markers[0].font).toBe("20px Fam");
  });

  it("omits text fields entirely for empty text", () => {
    const { markers } = run([{ time: 100, position: "inBar", shape: "circle", color: "c", text: "" }]);
    expect(markers[0].text).toBeUndefined();
    expect(markers[0].textX).toBeUndefined();
    expect(markers[0].textY).toBeUndefined();
  });
});

// ── layoutPriceLines ───────────────────────────────────────────────────────────

describe("layoutPriceLines", () => {
  const plotRect: Rect = { x: 0, y: 0, width: 400, height: 200 };
  const axisRect: Rect = { x: 400, y: 0, width: 60, height: 200 };

  function run(lines: PriceLineSpec[], opts: ViewOpts = {}) {
    const { projection } = makeProjection({ priceFrom: 0, priceTo: 100, plotHeight: 200, ...opts });
    return layoutPriceLines(lines, { projection, plotRect, axisRect, measure: fakeMeasure });
  }

  it("snaps y and spans the plot rect", () => {
    const [line] = run([{ price: 50 }]);
    expect(line.y).toBe(100); // (100-50)/100 * 200
    expect(line.x0).toBe(0);
    expect(line.x1).toBe(400);
  });

  it("culls lines whose price is outside the plot's price range", () => {
    const lines = run([{ price: -10 }, { price: 50 }, { price: 150 }, { price: NaN }, { price: Infinity }]);
    expect(lines).toHaveLength(1);
    expect(lines[0].y).toBe(100);
  });

  it("maps lineStyle to a lineWidth-scaled dash array per style", () => {
    const styles = run([
      { price: 10, lineStyle: 0, lineWidth: 1 },
      { price: 20, lineStyle: 1, lineWidth: 1 },
      { price: 30, lineStyle: 2, lineWidth: 1 },
      { price: 40, lineStyle: 2, lineWidth: 3 },
      { price: 50, lineStyle: 3, lineWidth: 2 },
      { price: 60, lineStyle: 4, lineWidth: 2 },
      { price: 70, lineStyle: "dashed", lineWidth: 1 },
      { price: 80, lineStyle: 99, lineWidth: 1 },
      { price: 90, lineStyle: "wiggly", lineWidth: 1 },
    ]);
    const dashes = Object.fromEntries(styles.map((l) => [l.y, l.dash]));
    expect(dashes[180]).toEqual([]);            // solid
    expect(dashes[160]).toEqual([1, 1]);        // dotted, w=1
    expect(dashes[140]).toEqual([2, 2]);        // dashed, w=1
    expect(dashes[120]).toEqual([6, 6]);        // dashed, w=3
    expect(dashes[100]).toEqual([12, 12]);      // largeDashed, w=2
    expect(dashes[80]).toEqual([2, 8]);         // sparseDotted, w=2
    expect(dashes[60]).toEqual([2, 2]);         // "dashed" name
    expect(dashes[40]).toEqual([]);             // unknown number -> solid
    expect(dashes[20]).toEqual([]);             // unknown name -> solid
  });

  it("defaults lineWidth to 1 when missing or non-finite", () => {
    const [a, b, c] = run([{ price: 50 }, { price: 50, lineWidth: 0 }, { price: 50, lineWidth: NaN }]);
    expect(a.lineWidth).toBe(1);
    expect(b.lineWidth).toBe(1);
    expect(c.lineWidth).toBe(1);
  });

  it("lays out the axis label box centred on the line, clamped into the axis", () => {
    const [mid] = run([{ price: 50 }]);
    const label = req(mid.label, "axis label");
    expect(label.boxRect).toEqual({ x: 400, y: 91, width: 60, height: 18 });
    expect(label.text).toBe("50");
    expect(label.textX).toBe(430);
    expect(label.textY).toBe(100);
    // near the top: the box clamps so it cannot spill above the axis strip
    const [top] = run([{ price: 99 }]);
    expect(req(top.label, "axis label").boxRect.y).toBe(0);
  });

  it("honours axisLabelVisible and carries the caller's label colours", () => {
    const [hidden] = run([{ price: 50, axisLabelVisible: false }]);
    expect(hidden.label).toBeUndefined();
    const [shown] = run([{ price: 50, axisLabelVisible: true, axisLabelColor: "bg", axisLabelTextColor: "fg" }]);
    expect(shown.label).toBeDefined();
    expect(shown.boxFill).toBe("bg");
    expect(shown.textColor).toBe("fg");
  });

  it("records lineVisible so the painter can skip the stroke", () => {
    const [a, b] = run([{ price: 50 }, { price: 50, lineVisible: false }]);
    expect(a.lineVisible).toBe(true);
    expect(b.lineVisible).toBe(false);
  });

  it("places the title at the line's left inside the plot, trimmed, measured", () => {
    const [line] = run([{ price: 50, title: "  PDH " }]);
    expect(line.title).toEqual({ text: "PDH", x: 4, y: 100, width: 21 }); // 3 chars * 7
    const [bare] = run([{ price: 50, title: "   " }]);
    expect(bare.title).toBeUndefined();
  });
});

// ── layoutWatermark ────────────────────────────────────────────────────────────

describe("layoutWatermark", () => {
  const plotRect: Rect = { x: 100, y: 50, width: 200, height: 100 };

  it("covers all 9 horzAlign x vertAlign combinations", () => {
    for (const horzAlign of ["left", "center", "right"] as const) {
      for (const vertAlign of ["top", "center", "bottom"] as const) {
        const { lines } = layoutWatermark(
          { horzAlign, vertAlign, lines: [{ text: "MM", fontSize: 40, color: "wm" }] },
          plotRect,
          fakeMeasure,
        );
        // default lineHeight = 40 * 1.2 = 48; line centre sits inside its line-box
        const expectedY = vertAlign === "top" ? 50 + 24
          : vertAlign === "bottom" ? 50 + 100 - 48 + 24
          : 50 + (100 - 48) / 2 + 24;
        const expectedX = horzAlign === "left" ? 100 : horzAlign === "right" ? 300 : 200;
        expect(lines, `${horzAlign}/${vertAlign}`).toHaveLength(1);
        expect(lines[0].x, `${horzAlign}/${vertAlign}`).toBe(expectedX);
        expect(lines[0].y, `${horzAlign}/${vertAlign}`).toBeCloseTo(expectedY, 10);
        expect(lines[0].textAlign, `${horzAlign}/${vertAlign}`).toBe(horzAlign);
      }
    }
  });

  it("centres a multi-line stack as a block and honours per-line lineHeight", () => {
    const { lines } = layoutWatermark(
      {
        vertAlign: "center",
        horzAlign: "center",
        lines: [
          { text: "Mastermind", fontSize: 20, lineHeight: 20, color: "a" },
          { text: "Terminal", fontSize: 30, lineHeight: 30, color: "b" },
        ],
      },
      plotRect,
      fakeMeasure,
    );
    // block height 50 -> top = 50 + (100 - 50)/2 = 75
    expect(lines.map((l) => l.y)).toEqual([75 + 10, 75 + 20 + 15]);
  });

  it("builds the font string from per-line style and defaults fontSize 44", () => {
    const { lines } = layoutWatermark(
      {
        lines: [
          { text: "a", fontStyle: "italic", fontSize: 12, fontFamily: "serif" },
          { text: "b" },
        ],
      },
      plotRect,
      fakeMeasure,
    );
    expect(lines[0].font).toBe("italic 12px serif");
    expect(lines[1].font).toBe("normal 44px sans-serif");
  });

  it("defaults lineHeight to fontSize * 1.2", () => {
    const { lines } = layoutWatermark(
      { vertAlign: "top", lines: [{ text: "x", fontSize: 10 }, { text: "y", fontSize: 10, lineHeight: 50 }] },
      plotRect,
      fakeMeasure,
    );
    expect(lines.map((l) => l.y)).toEqual([50 + 6, 50 + 12 + 25]);
  });

  it("returns no lines when visible is false", () => {
    expect(layoutWatermark({ visible: false, lines: [{ text: "x" }] }, plotRect, fakeMeasure).lines).toEqual([]);
  });

  it("passes the colour through and leaves it absent when the spec had none", () => {
    const { lines } = layoutWatermark({ lines: [{ text: "x", color: "c1" }, { text: "y" }] }, plotRect, fakeMeasure);
    expect(lines[0].color).toBe("c1");
    expect(lines[1].color).toBeUndefined();
  });

  it("measures each line with its own font", () => {
    const calls: Array<[string, string]> = [];
    const { lines } = layoutWatermark(
      { lines: [{ text: "hello", fontSize: 10 }] },
      plotRect,
      (text, font) => {
        calls.push([text, font]);
        return text.length * 3;
      },
    );
    expect(calls).toEqual([["hello", "normal 10px sans-serif"]]);
    expect(lines[0].width).toBe(15);
  });
});

// ── layoutSessionShading ───────────────────────────────────────────────────────

describe("layoutSessionShading", () => {
  const plotRect: Rect = { x: 0, y: 0, width: 500, height: 200 };
  // times map to indices 0..4 with barSpacing 100 -> bar i spans (i*100, (i+1)*100)
  const rows = makeRows([
    { time: 100, highY: 0, lowY: 0, closeY: 0 },
    { time: 200, highY: 0, lowY: 0, closeY: 0 },
    { time: 300, highY: 0, lowY: 0, closeY: 0 },
    { time: 400, highY: 0, lowY: 0, closeY: 0 },
    { time: 500, highY: 0, lowY: 0, closeY: 0 },
  ]);

  function run(sessions: Array<{ fromTime: number; toTime: number; color: string }>, rect: Rect = plotRect) {
    const { projection } = makeProjection({ widthPx: 500, visibleTo: 5 });
    return layoutSessionShading(sessions, projection, rows, rect);
  }

  it("spans from the first bar's left edge to the last bar's right edge, full plot height", () => {
    const rects = run([{ fromTime: 200, toTime: 400, color: "shade" }]);
    expect(rects).toEqual([{ x: 100, y: 0, width: 300, height: 200, color: "shade" }]);
  });

  it("clips rects to the plot rect", () => {
    const narrow: Rect = { x: 120, y: 10, width: 300, height: 90 };
    const rects = run([{ fromTime: 100, toTime: 500, color: "shade" }], narrow);
    expect(rects).toEqual([{ x: 120, y: 10, width: 300, height: 90, color: "shade" }]);
  });

  it("drops sessions that are zero-width after clipping", () => {
    const offRight: Rect = { x: 300, y: 0, width: 100, height: 200 };
    expect(run([{ fromTime: 100, toTime: 200, color: "shade" }], offRight)).toEqual([]);
    expect(run([{ fromTime: 100, toTime: 100, color: "shade" }], { x: 0, y: 0, width: 0, height: 200 })).toEqual([]);
  });

  it("drops sessions whose times are unknown or non-finite", () => {
    expect(run([{ fromTime: 999, toTime: 400, color: "s" }])).toEqual([]);
    expect(run([{ fromTime: NaN, toTime: 400, color: "s" }])).toEqual([]);
    expect(run([{ fromTime: 100, toTime: Infinity, color: "s" }])).toEqual([]);
  });

  it("normalises reversed from/to times into a well-formed rect", () => {
    // fromTime 400 -> bar 3 (right edge 300); toTime 200 -> bar 1 (left edge 200)
    const rects = run([{ fromTime: 400, toTime: 200, color: "s" }]);
    expect(rects[0]).toMatchObject({ x: 200, width: 100 });
  });
});

// ── paintDecorations ───────────────────────────────────────────────────────────

describe("paintDecorations", () => {
  it("paints in z-order: shading, price lines, markers, watermark", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      sessionShading: [{ x: 0, y: 0, width: 10, height: 10, color: "fill-1" }],
      priceLines: [{ y: 5, x0: 0, x1: 10, dash: [], lineWidth: 1, color: "line-1", lineVisible: true }],
      markers: [{ x: 5, y: 5, shape: "circle", size: 6, color: "mark-1", textAlign: "left" }],
      watermark: { lines: [{ text: "wm", x: 5, y: 5, font: "12px f", color: "wm-1", textAlign: "center", width: 9 }] },
    }, { dpr: 1 });
    const iShade = ops.findIndex((o) => o.m === "fillRect" && o.state.fillStyle === "fill-1");
    const iLine = ops.findIndex((o) => o.m === "stroke" && o.state.strokeStyle === "line-1");
    const iMark = ops.findIndex((o) => o.m === "fill" && o.state.fillStyle === "mark-1");
    const iWm = ops.findIndex((o) => o.m === "fillText" && o.args[0] === "wm");
    expect(iShade).toBeGreaterThanOrEqual(0);
    expect(iLine).toBeGreaterThanOrEqual(0);
    expect(iMark).toBeGreaterThanOrEqual(0);
    expect(iWm).toBeGreaterThanOrEqual(0);
    expect(iShade).toBeLessThan(iLine);
    expect(iLine).toBeLessThan(iMark);
    expect(iMark).toBeLessThan(iWm);
  });

  it("strokes price lines with the layout's dash, width and colour", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      priceLines: [{ y: 20, x0: 0, x1: 100, dash: [2, 2], lineWidth: 3, color: "c", lineVisible: true }],
    }, { dpr: 1 });
    const dash = req(ops.find((o) => o.m === "setLineDash"), "setLineDash");
    const stroke = req(ops.find((o) => o.m === "stroke"), "stroke");
    expect(dash.args[0]).toEqual([2, 2]);
    expect(stroke.state.strokeStyle).toBe("c");
    expect(stroke.state.lineWidth).toBe(3);
    expect(ops.indexOf(dash)).toBeLessThan(ops.indexOf(stroke));
    expect(ops.some((o) => o.m === "moveTo" && o.args[1] === 20)).toBe(true);
    expect(ops.some((o) => o.m === "lineTo" && o.args[1] === 20)).toBe(true);
  });

  it("skips the stroke when lineVisible is false but still paints the label", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      priceLines: [{
        y: 20, x0: 0, x1: 100, dash: [2, 2], lineWidth: 3, color: "c", lineVisible: false,
        label: { boxRect: { x: 0, y: 11, width: 40, height: 18 }, text: "42", textX: 20, textY: 20 },
      }],
    }, { dpr: 1 });
    expect(ops.filter((o) => o.m === "stroke")).toHaveLength(0);
    expect(ops.filter((o) => o.m === "setLineDash")).toHaveLength(0);
    const text = req(ops.find((o) => o.m === "fillText" && o.args[0] === "42"), "bare label text");
    expect(text.state.fillStyle).toBe("c"); // bare label falls back to the line colour
  });

  it("draws the boxed axis label only when both label colours are supplied", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      priceLines: [{
        y: 20, x0: 0, x1: 100, dash: [], lineWidth: 1, color: "c", lineVisible: true,
        label: { boxRect: { x: 400, y: 11, width: 60, height: 18 }, text: "42", textX: 430, textY: 20 },
        boxFill: "bg", textColor: "fg",
      }],
    }, { dpr: 1 });
    const box = req(ops.find((o) => o.m === "fillRect" && o.state.fillStyle === "bg"), "label box");
    const text = req(ops.find((o) => o.m === "fillText" && o.args[0] === "42"), "label text");
    expect(box.args).toEqual([400, 11, 60, 18]);
    expect(text.state.fillStyle).toBe("fg");
    expect(text.state.textAlign).toBe("center");
  });

  it("builds each marker shape as LWC's draw functions do (shapeSize re-applied to the item size)", () => {
    // item size 10 -> clamp 12: circle ceiledOdd(9.6) = 9 (r 4), square ceiledOdd(8.4) = 9 (half 4),
    // arrow ceiledOdd(12) = 11 (half 5) with a stem base ceiledOdd(10 / 2) = 5 (half 2).
    const shapes = ["circle", "square", "arrowUp", "arrowDown"] as const;
    for (const shape of shapes) {
      const { ctx, ops } = makeCtx();
      paintDecorations(ctx, {
        markers: [{ x: 50, y: 60, shape, size: 10, color: "mc", textAlign: "center" }],
      }, { dpr: 1 });
      expect(ops.some((o) => o.m === "beginPath"), shape).toBe(true);
      const fills = ops.filter((o) => o.m === "fill");
      expect(fills).toHaveLength(1);
      expect(req(fills[0], "marker fill").state.fillStyle, shape).toBe("mc");
      const path = ops.filter((o) => o.m === "moveTo" || o.m === "lineTo").map((o) => o.args.join(","));
      if (shape === "circle") {
        expect(ops.some((o) => o.m === "arc" && o.args[0] === 50 && o.args[1] === 60 && o.args[2] === 4)).toBe(true);
      }
      if (shape === "square") {
        expect(ops.some((o) => o.m === "rect" && o.args.join(",") === "46,56,9,9")).toBe(true);
      }
      if (shape === "arrowUp") {
        // head: left wing, apex above, right wing; stem: base width 5 down to y + 5
        expect(path).toEqual(["45,60", "50,55", "55,60", "52,60", "52,65", "48,65", "48,60"]);
        expect(ops.some((o) => o.m === "closePath")).toBe(true);
      }
      if (shape === "arrowDown") {
        expect(path).toEqual(["45,60", "50,65", "55,60", "52,60", "52,55", "48,55", "48,60"]);
      }
    }
  });

  it("paints marker text in the layout font, centred, middle baseline, before the glyph", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      markers: [{
        x: 50, y: 60, shape: "circle", size: 10, color: "mc",
        text: "hi", textX: 50, textY: 48, textAlign: "center", font: "13px Fam",
      }],
    }, { dpr: 1 });
    const text = req(ops.find((o) => o.m === "fillText" && o.args[0] === "hi"), "marker text");
    expect(text.args[1]).toBe(50);
    expect(text.args[2]).toBe(48);
    expect(text.state.fillStyle).toBe("mc");
    expect(text.state.font).toBe("13px Fam");
    expect(text.state.textAlign).toBe("center");
    expect(text.state.textBaseline).toBe("middle");
    // LWC drawItem: text, then the shape
    expect(ops.indexOf(text)).toBeLessThan(ops.findIndex((o) => o.m === "arc"));
  });

  it("size 0 draws the text but no glyph (LWC drawShape early return)", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      markers: [{ x: 50, y: 60, shape: "circle", size: 0, color: "mc", text: "only", textX: 50, textY: 48, textAlign: "center" }],
    }, { dpr: 1 });
    expect(ops.filter((o) => o.m === "fillText")).toHaveLength(1);
    expect(ops.filter((o) => o.m === "arc" || o.m === "rect" || o.m === "fill")).toHaveLength(0);
  });

  it("skips watermark lines that carry no colour", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      watermark: { lines: [
        { text: "shown", x: 1, y: 2, font: "12px f", color: "wmc", textAlign: "center", width: 5 },
        { text: "hidden", x: 1, y: 2, font: "12px f", textAlign: "center", width: 5 },
      ] },
    }, { dpr: 1 });
    const texts = ops.filter((o) => o.m === "fillText");
    expect(texts).toHaveLength(1);
    const shown = req(texts[0], "watermark text");
    expect(shown.args[0]).toBe("shown");
    expect(shown.state.fillStyle).toBe("wmc");
    expect(shown.state.font).toBe("12px f");
  });

  it("snaps strokes and fills to the device pixel grid", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      sessionShading: [{ x: 10.3, y: 0, width: 5.1, height: 40, color: "s" }],
      priceLines: [{ y: 7.25, x0: 0, x1: 10, dash: [], lineWidth: 1, color: "c", lineVisible: true }],
    }, { dpr: 2 });
    const rect = req(ops.find((o) => o.m === "fillRect" && o.state.fillStyle === "s"), "snapped rect");
    expect(rect.args).toEqual([10.5, 0, 5, 40]); // 10.3 -> 10.5, right edge 15.4 -> 15.5
    expect(ops.some((o) => o.m === "moveTo" && o.args[1] === 7.5)).toBe(true);
  });

  it("treats a non-finite dpr as 1", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      priceLines: [{ y: 7.4, x0: 0, x1: 10, dash: [], lineWidth: 1, color: "c", lineVisible: true }],
    }, { dpr: 0 });
    expect(ops.some((o) => o.m === "moveTo" && o.args[1] === 7)).toBe(true);
  });

  it("skips non-finite ops without throwing and keeps save/restore balanced", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {
      sessionShading: [{ x: NaN, y: 0, width: 5, height: 5, color: "s" }],
      priceLines: [{ y: NaN, x0: 0, x1: 10, dash: [], lineWidth: 1, color: "c", lineVisible: true }],
      markers: [{ x: 5, y: NaN, shape: "circle", size: 6, color: "mc", textAlign: "left" }],
      watermark: { lines: [{ text: "t", x: NaN, y: 2, font: "f", color: "c", textAlign: "left", width: 1 }] },
    }, { dpr: 1 });
    expect(ops.filter((o) => o.m === "fillRect")).toHaveLength(0);
    expect(ops.filter((o) => o.m === "stroke")).toHaveLength(0);
    expect(ops.filter((o) => o.m === "fill")).toHaveLength(0);
    expect(ops.filter((o) => o.m === "fillText")).toHaveLength(0);
    expect(ops.filter((o) => o.m === "save")).toHaveLength(ops.filter((o) => o.m === "restore").length);
  });

  it("paints an empty bundle as a no-op", () => {
    const { ctx, ops } = makeCtx();
    paintDecorations(ctx, {}, { dpr: 1 });
    expect(ops).toHaveLength(0);
  });
});

// ── No hardcoded colours (chart law) ───────────────────────────────────────────

describe("decorations.ts source hygiene", () => {
  const source = readFileSync(
    new URL("../chart-engine/canvas/decorations.ts", import.meta.url),
    "utf8",
  );

  it("contains no hex colour literals", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("contains no rgb()/hsl() colour functions", () => {
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("contains no quoted CSS colour keywords", () => {
    const keywords = [
      "red", "green", "blue", "black", "white", "gray", "grey", "cyan", "magenta",
      "yellow", "orange", "purple", "pink", "brown", "transparent", "currentColor",
    ];
    for (const kw of keywords) {
      expect(source, `colour keyword "${kw}"`).not.toContain(`"${kw}"`);
    }
  });
});

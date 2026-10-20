// @vitest-environment jsdom
// [PAR-DECOR] mm decoration parity: price-line defaults, contrast colours and titles.
// Every assertion here can fail (falsifiers in G4: default line width, contrast
// threshold, dropped title/label paints, forced lineVisible).
//
// Reference — lightweight-charts 5.2.0 dev build
// (terminal/node_modules/lightweight-charts/dist/lightweight-charts.development.mjs):
//   • priceLineOptionsDefaults (dev:12618): color '#FF0000', lineStyle 2 (Dashed),
//     lineWidth 1, lineVisible true, axisLabelVisible true, title '',
//     axisLabelColor '', axisLabelTextColor ''. SeriesApi.createPriceLine merges it
//     into the caller's bag (dev:12763).
//   • CustomPriceLinePaneView._internal__updateImpl (dev:2344): the line paints iff
//     the series is visible and lineVisible; color/lineWidth/lineStyle pass through.
//   • CustomPriceLinePriceAxisView._internal__updateRendererData (dev:2369): the axis
//     label paints iff axisLabelVisible, the title paints inside the pane iff
//     title !== '', colours from axisLabelColor || color and text from
//     axisLabelTextColor || generateContrastColors(...).foreground.
//   • ColorParser._internal_generateContrastColors (dev:406) over the NTSC weights
//     0.199/0.687/0.114 (dev:356-358): black text when grayscale > 160 else white;
//     _private__parseColor throws on an unparseable string (dev:434-445) — mm's
//     contrastColors answers null and the frame skips the label instead.
//   • HorizontalLineRenderer._internal__drawImpl (dev:1871) with getDashPattern
//     (dev:77): dashed(2) = [2*w, 2*w] — mm's dashFor (decorations.ts:297) mirrors it.
//
// mm keeps the createPriceLine spec VERBATIM (canvas/model.ts:1819-1828) and paints
// from it (canvas/frame.ts:490-507 axis views, canvas/frame.ts:864-866 +
// canvas/decorations.ts:327-385 the line strokes), so the LWC defaults object is NOT
// merged: a spec option that LWC would default stays absent. D1a therefore pins the
// defaults by their VALUES (the bag LWC's own merge would produce); the bare-spec gap
// is pinned in D1b and reported in the task NOTES, not fixed here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";
import { contrastColors } from "@/lib/chart-engine/canvas/priceAxis";

type Call = { method: string; args: unknown[] };
type Ctx = CanvasRenderingContext2D & { __calls: Call[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, Ctx>();

const STATE_PROPS = [
  "fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline",
  "lineCap", "lineJoin", "lineDashOffset", "globalAlpha",
] as const;

function makeFakeCtx(): Ctx {
  const calls: Call[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect", "arc", "clip", "setLineDash",
  ]) ctx[m] = rec(m);
  // Property writes are paint evidence too (strokeStyle/lineWidth/fillStyle carry the
  // colours and widths the frame chose), so log them into the SAME chronological call
  // log as "@prop" entries; the getter returns the last set value (priceAxis metricsOf
  // reads textBaseline back).
  const state: Record<string, unknown> = {};
  for (const p of STATE_PROPS) {
    Object.defineProperty(ctx, p, {
      configurable: true,
      get: () => state[p],
      set: (v: unknown) => { state[p] = v; calls.push({ method: `@${p}`, args: [v] }); },
    });
  }
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  ctx.measureText = () => ({ width: 60 }); // fixed advance -> a stable optimal strip width
  return ctx as unknown as Ctx;
}

let container: HTMLDivElement;
const ROWS: EngineSeriesRow[] = [
  { time: "2026-01-05", value: 10 },
  { time: "2026-01-06", value: 11 },
  { time: "2026-01-07", value: 12 },
];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement, type: string,
  ) {
    if (type !== "2d") return null;
    let c = ctxByCanvas.get(this);
    if (!c) { c = makeFakeCtx(); ctxByCanvas.set(this, c); }
    return c as unknown as CanvasRenderingContext2D;
  });
});
afterEach(() => { vi.restoreAllMocks(); container.remove(); });

function mount() {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(container, { width: 300, height: 120, devicePixelRatio: 1, scheduler });
  const series = engine.addSeries("line");
  series.setData(ROWS);
  return { engine, scheduler, series };
}

/** The pane canvas' chronological call log. */
function paneCalls(): Call[] {
  const canvas = container.querySelector("canvas[data-mm-pane-canvas='0']") as HTMLCanvasElement;
  return ctxByCanvas.get(canvas)!.__calls;
}

/** The calls of the LAST painted pane frame (paintPaneFrame opens with a full-width clearRect). */
function lastFrame(): Call[] {
  const calls = paneCalls();
  let start = 0;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i].method === "clearRect" && calls[i].args[0] === 0) start = i;
  }
  return calls.slice(start);
}

type Stroke = { color: unknown; width: unknown; dash: unknown; y: number | null };

/** Every stroke() with the strokeStyle/lineWidth/setLineDash/ moveTo y it last set. */
function strokesOf(frame: Call[]): Stroke[] {
  const out: Stroke[] = [];
  for (let i = 0; i < frame.length; i++) {
    if (frame[i].method !== "stroke") continue;
    const found: Stroke = { color: undefined, width: undefined, dash: undefined, y: null };
    for (let j = i - 1; j >= 0; j--) {
      const c = frame[j];
      if (found.color === undefined && c.method === "@strokeStyle") found.color = c.args[0];
      if (found.width === undefined && c.method === "@lineWidth") found.width = c.args[0];
      if (found.dash === undefined && c.method === "setLineDash") found.dash = c.args[0];
      if (found.y === null && c.method === "moveTo") found.y = Number(c.args[1]);
      if (found.color !== undefined && found.width !== undefined
        && found.dash !== undefined && found.y !== null) break;
    }
    out.push(found);
  }
  return out;
}

type Label = { text: string; x: number; y: number; fill: unknown };

/** Every fillText with the fillStyle in force at that moment. */
function fillTextsOf(frame: Call[]): Label[] {
  const out: Label[] = [];
  for (let i = 0; i < frame.length; i++) {
    if (frame[i].method !== "fillText") continue;
    let fill: unknown;
    for (let j = i - 1; j >= 0; j--) {
      if (frame[j].method === "@fillStyle") { fill = frame[j].args[0]; break; }
    }
    out.push({
      text: String(frame[i].args[0]),
      x: Number(frame[i].args[1]),
      y: Number(frame[i].args[2]),
      fill,
    });
  }
  return out;
}

function nearestBefore(frame: Call[], from: number, method: string): Call | null {
  for (let j = from - 1; j >= 0; j--) if (frame[j].method === method) return frame[j];
  return null;
}

/** The label (or title) texts painted in a y band around `y` (LWC label boxes are centred on it). */
function textsNear(labels: Label[], y: number, tol = 0.3): Label[] {
  return labels.filter((l) => Math.abs(l.y - y) <= tol);
}

/**
 * The y the label (and pane title) of a price line at `price` paints at:
 * drawPriceAxisLabel centres the box on round(yMid) + 0.5 at dpr 1 — exactly 1.0
 * below the axis MARK at the same price (mark y + 0 yMid correction), so the 0.3
 * band never confuses the two.
 */
function labelYOf(series: { priceToCoordinate(p: number): number | null }, price: number): number {
  const y = series.priceToCoordinate(price);
  expect(y).not.toBeNull();
  return Math.round(y as number) + 0.5;
}

describe("mm decoration parity (PAR-DECOR)", () => {
  it("D1a a spec carrying LWC's price-line default values paints LWC's default line and its axis label", () => {
    const { engine, scheduler, series } = mount();
    // The bag SeriesApi.createPriceLine's merge (dev:12763) would hand the renderer:
    // every value is priceLineOptionsDefaults' (dev:12618).
    series.createPriceLine({ price: 11, color: "#FF0000", lineWidth: 1, lineStyle: 2 });
    // A spec that OMITS lineWidth still paints at LWC's default width 1 — the mm
    // fallback (decorations.ts:343-345); an omitted lineStyle keeps mm's own solid
    // fallback shape (the LWC merge would have made it Dashed — see NOTES).
    series.createPriceLine({ price: 10.6, color: "#FF0000" });
    scheduler.flush();
    const frame = lastFrame();
    const y = Math.round(series.priceToCoordinate(11)!);
    expect(y).toBeGreaterThan(0);

    // The line: strokeStyle #FF0000, lineWidth 1, the Dashed(2) dash [2*w, 2*w].
    expect(strokesOf(frame)).toContainEqual({ color: "#FF0000", width: 1, dash: [2, 2], y });

    // The default WIDTH: the omitted-lineWidth line strokes at width 1 too.
    const y2 = Math.round(series.priceToCoordinate(10.6)!);
    expect(strokesOf(frame).filter((s) => s.y === y2)).toEqual([
      { color: "#FF0000", width: 1, dash: [], y: y2 },
    ]);

    // The axis label IS painted at the line's y, inside the price-axis strip (x >= plot
    // width), with the contrast text colour ('' axisLabelTextColor -> foreground of
    // #FF0000 = white) on the #FF0000 label box (rgb(...), alpha dropped).
    const plotWidth = engine.timeScale().width();
    const yLabel = labelYOf(series, 11);
    const label = textsNear(fillTextsOf(frame), yLabel).find((l) => l.text === "11.00");
    expect(label).toBeDefined();
    expect(label!.x).toBeGreaterThanOrEqual(plotWidth);
    const fillAt = frame.findIndex((c) => c.method === "fillText" && c.args[0] === "11.00"
      && Math.abs(Number(c.args[2]) - yLabel) <= 0.3);
    expect(fillAt).toBeGreaterThanOrEqual(0);
    expect(nearestBefore(frame, fillAt, "@fillStyle")?.args[0]).toBe("white");
    const boxFill = nearestBefore(frame, fillAt, "fill");
    const boxFillStyle = nearestBefore(
      frame,
      frame.findIndex((c) => c === boxFill),
      "@fillStyle",
    );
    expect(boxFillStyle?.args[0]).toBe("rgb(255, 0, 0)");
    engine.destroy();
  });

  it("D1b a bare {price} spec paints nothing: mm does not merge priceLineOptionsDefaults", () => {
    const { engine, scheduler, series } = mount();
    // LWC would merge the defaults (dev:12763) and paint '#FF0000' dashed with a label;
    // mm paints from the spec as stored (model.ts:1823), so a missing colour is the
    // empty colour of the colour law: no stroke, no label (frame.ts:494-497,
    // decorations.ts:574). Parity gap reported in NOTES; pinned here as behaviour.
    series.createPriceLine({ price: 10.4 });
    scheduler.flush();
    const frame = lastFrame();
    const yBare = Math.round(series.priceToCoordinate(10.4)!);
    expect(yBare).toBeGreaterThan(0);
    expect(strokesOf(frame).filter((s) => s.y === yBare)).toEqual([]);
    expect(textsNear(fillTextsOf(frame), labelYOf(series, 10.4))).toEqual([]);
    engine.destroy();
  });

  it("D2 an empty colour paints NO line and NO axis label", () => {
    const { engine, scheduler, series } = mount();
    series.createPriceLine({ price: 10.4, color: "" });
    series.createPriceLine({ price: 11.6, color: "#00AA00" });
    scheduler.flush();
    const frame = lastFrame();
    // The coloured line paints; the empty-colour one never reaches the canvas.
    const yOn = Math.round(series.priceToCoordinate(11.6)!);
    const yOff = Math.round(series.priceToCoordinate(10.4)!);
    expect(strokesOf(frame).filter((s) => s.y === yOn)).toHaveLength(1);
    expect(strokesOf(frame).filter((s) => s.y === yOff)).toEqual([]);
    // The coloured line's own axis label is the baseline the empty colour must not match.
    const labelOn = textsNear(fillTextsOf(frame), labelYOf(series, 11.6)).find((l) => l.text === "11.60");
    expect(labelOn).toBeDefined();
    // ...and the empty colour builds no axis-label view (contrastColors("") -> null,
    // frame.ts:494-497), so no text in its band either.
    expect(textsNear(fillTextsOf(frame), labelYOf(series, 10.4))).toEqual([]);
    // paintPriceLine returns before touching the ctx for an empty colour.
    expect(frame.some((c) => c.method === "@strokeStyle" && c.args[0] === "")).toBe(false);
    engine.destroy();
    // LWC divergence (recorded in NOTES, not fixed): getRgbStringViaBrowser("") reads
    // rgb(0, 0, 0) (dev:372-383), so LWC paints a black line and a black/white label.
  });

  it("D3 lineVisible:false still paints the axis label; axisLabelVisible:false still paints the line", () => {
    // Half A — LWC hides only the line (dev:2348-2351), the label follows
    // axisLabelVisible alone (dev:2374-2389); mm mirrors that split.
    {
      const { engine, scheduler, series } = mount();
      series.createPriceLine({ price: 11, color: "#00AA00", lineVisible: false });
      scheduler.flush();
      const frame = lastFrame();
      const y = Math.round(series.priceToCoordinate(11)!);
      expect(strokesOf(frame).filter((s) => s.y === y)).toEqual([]);
      const label = textsNear(fillTextsOf(frame), labelYOf(series, 11)).find((l) => l.text === "11.00");
      expect(label).toBeDefined();
      engine.destroy();
    }
    // Half B — the line ignores axisLabelVisible (dev:2344-2364); the label obeys it.
    {
      const { engine, scheduler, series } = mount();
      series.createPriceLine({ price: 11, color: "#00AA00", axisLabelVisible: false });
      scheduler.flush();
      const frame = lastFrame();
      const y = Math.round(series.priceToCoordinate(11)!);
      expect(strokesOf(frame).filter((s) => s.y === y)).toHaveLength(1);
      expect(textsNear(fillTextsOf(frame), labelYOf(series, 11))).toEqual([]);
      engine.destroy();
    }
  });

  it("D4 contrast colours: NTSC threshold straddle, both ends, and unparseable -> null", () => {
    // Direct unit test of the exported helper (priceAxis.ts contrastColors, the mirror
    // of ColorParser._internal_generateContrastColors, dev:406).
    // gray = 0.199*R + 0.687*G + 0.114*B (dev:356-358); black text when > 160.
    expect(contrastColors("#ffffff")).toEqual({ background: "rgb(255, 255, 255)", foreground: "black" });
    expect(contrastColors("#000000")).toEqual({ background: "rgb(0, 0, 0)", foreground: "white" });
    // Straddle: pure-green greys of 0.687*232 = 159.384 (<= 160) and 0.687*233 = 160.071 (> 160).
    expect(contrastColors("#00e800")?.foreground).toBe("white");
    expect(contrastColors("#00e900")?.foreground).toBe("black");
    // Unparseable -> null (LWC throws at dev:434-445; mm answers null so the frame skips).
    expect(contrastColors("")).toBeNull();
    expect(contrastColors("not-a-colour")).toBeNull();
    // The same law through the painted label's fillStyle.
    for (const [hex, text] of [["#00e800", "white"], ["#00e900", "black"]] as const) {
      const { engine, scheduler, series } = mount();
      series.createPriceLine({ price: 11, color: hex });
      scheduler.flush();
      const frame = lastFrame();
      const yLabel = labelYOf(series, 11);
      const at = frame.findIndex((c) => c.method === "fillText"
        && Math.abs(Number(c.args[2]) - yLabel) <= 0.3);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(nearestBefore(frame, at, "@fillStyle")?.args[0]).toBe(text);
      engine.destroy();
    }
  });

  it("D5 a price-line title paints beside the line INSIDE the plot; an empty title paints no extra text", () => {
    // LWC paints the title in the pane against the axis when title !== '' (dev:2379-2382);
    // mm carries it on the view's pane part (frame.ts:505) drawn by paintPaneFrame
    // (frame.ts:979-988) inside the plot's right edge.
    {
      const { engine, scheduler, series } = mount();
      series.createPriceLine({ price: 11, color: "#00AA00", title: "VWAP" });
      scheduler.flush();
      const frame = lastFrame();
      const plotWidth = engine.timeScale().width();
      const title = fillTextsOf(frame).find((l) => l.text === "VWAP");
      expect(title).toBeDefined();
      expect(title!.x).toBeLessThan(plotWidth); // on the plot, NOT in the axis strip
      expect(Math.abs(title!.y - labelYOf(series, 11))).toBeLessThanOrEqual(0.3);
      // The title takes the same contrast text colour as the axis label.
      const at = frame.findIndex((c) => c.method === "fillText" && c.args[0] === "VWAP");
      expect(nearestBefore(frame, at, "@fillStyle")?.args[0]).toBe("white");
      engine.destroy();
    }
    {
      const { engine, scheduler, series } = mount();
      series.createPriceLine({ price: 11, color: "#00AA00" });
      scheduler.flush();
      const frame = lastFrame();
      expect(fillTextsOf(frame).some((l) => l.text === "VWAP")).toBe(false);
      engine.destroy();
    }
  });
});

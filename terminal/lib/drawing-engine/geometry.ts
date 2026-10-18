import type { DrawKind, Pt } from "@/lib/drawings";

/**
 * The renderer is intentionally family-driven: the catalog can stay declarative
 * while related tools share bounded SVG primitives. Keeping this map exhaustive
 * makes adding a registry kind without a rendering contract a type error.
 */
export type DrawingRendererFamily =
  | "axis"
  | "line"
  | "channel"
  | "pitchfork"
  | "fib"
  | "fib-extension"
  | "fib-grid"
  | "fib-time"
  | "fan"
  | "radial"
  | "gann"
  | "pattern"
  | "cycle"
  | "position"
  | "forecast"
  | "bar-pattern"
  | "sector"
  | "anchored-vwap"
  | "volume-profile"
  | "range"
  | "freehand"
  | "shape"
  | "curve"
  | "arrow"
  | "mark"
  | "stylized"
  | "annotation"
  | "media";

export const DRAWING_RENDERER_FAMILY = {
  trendline: "line", ray: "line", infoline: "line", extendedline: "line", trendangle: "line",
  hline: "axis", horizontalray: "axis", vline: "axis", crossline: "axis",
  channel: "channel", regressiontrend: "channel", flattopbottom: "channel", disjointchannel: "channel",
  pitchfork: "pitchfork", schiffpitchfork: "pitchfork", modifiedschiffpitchfork: "pitchfork", insidepitchfork: "pitchfork",
  fib: "fib", fibtrend: "fib-extension", fibchannel: "fib-grid", fibtimezone: "fib-time",
  fibspeedresistancefan: "fan", trendbasedfibtime: "fib-time", fibcircles: "radial", fibspiral: "radial",
  fibspeedresistancearcs: "radial", fibwedge: "radial", pitchfan: "fan",
  gannbox: "gann", gannsquarefixed: "gann", gannsquare: "gann", gannfan: "fan",
  xabcd: "pattern", cypher: "pattern", headandshoulders: "pattern", abcd: "pattern",
  trianglepattern: "pattern", threedrives: "pattern", elliottimpulse: "pattern", elliottcorrection: "pattern",
  elliotttriangle: "pattern", elliottdoublecombo: "pattern", elliotttriplecombo: "pattern",
  cycliclines: "cycle", timecycles: "cycle", sineline: "cycle",
  longposition: "position", shortposition: "position", forecast: "forecast", ghostfeed: "forecast",
  barpattern: "bar-pattern", sector: "sector", anchoredvwap: "anchored-vwap",
  fixedrangevolumeprofile: "volume-profile", pricerange: "range", daterange: "range",
  dateandpricerange: "range", measure: "range",
  brush: "freehand", highlighter: "freehand", path: "freehand",
  rect: "shape", rotatedrect: "shape", ellipse: "shape", circle: "shape", triangle: "shape",
  polyline: "freehand", arc: "curve", curve: "curve", doublecurve: "curve",
  arrowmarker: "mark", arrow: "arrow", arrowmarkleft: "mark", arrowmarkright: "mark",
  arrowmarktop: "mark", arrowmarkbottom: "mark", flagmark: "mark",
  momentum: "stylized", flow: "stylized", emphasis: "stylized", whisper: "stylized", subtle: "stylized",
  divergence: "stylized", journey: "stylized", fork: "stylized", threepaths: "stylized", burj: "stylized",
  text: "annotation", anchoredtext: "annotation", note: "annotation", anchorednote: "annotation",
  callout: "annotation", pricelabel: "annotation", pricenote: "annotation", signpost: "annotation",
  comment: "annotation", image: "media", emoji: "media", icon: "media",
} as const satisfies Record<DrawKind, DrawingRendererFamily>;

/** 24 settings-ready Fibonacci slots. The first eleven enabled defaults match the drawing UI. */
export const FIBONACCI_LEVEL_SLOTS = [
  -4.236, -3.618, -2.618, -1.618, -1, -0.786, -0.618, -0.5, -0.382, -0.236,
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236, 4.618,
] as const;

export const DEFAULT_FIBONACCI_LEVELS = [
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618,
] as const;

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

function rounded(value: number, precision: number): number {
  return +finite(value, 0).toFixed(Math.max(0, Math.min(12, precision)));
}
function timeAt(a: Pt, b: Pt, fraction: number, orderedTimes: readonly string[]): string {
  const ai = orderedTimes.indexOf(String(a.t));
  const bi = orderedTimes.indexOf(String(b.t));
  if (ai >= 0 && bi >= 0 && orderedTimes.length) {
    const index = Math.max(0, Math.min(orderedTimes.length - 1, Math.round(ai + (bi - ai) * fraction)));
    return String(orderedTimes[index]);
  }
  return fraction < 0.5 ? String(a.t) : String(b.t);
}

function between(a: Pt, b: Pt, fraction: number, price: number, orderedTimes: readonly string[], precision: number): Pt {
  return { t: timeAt(a, b, fraction, orderedTimes), p: rounded(price, precision) };
}

/**
 * Expands economical two-anchor gestures into editable semantic controls.
 * Original anchors always stay at indices 0 and 1; derived handles follow.
 */
export function materializeSemanticPoints(
  kind: DrawKind,
  points: readonly Pt[],
  orderedTimes: readonly string[],
  precision: number,
): Pt[] {
  const a = points[0], b = points[1];
  if (!a || !b) return points.map((point) => ({ ...point }));
  const copy = points.map((point) => ({ ...point }));
  const rawDelta = b.p - a.p;
  const span = Math.max(Math.abs(rawDelta), Math.max(Math.abs(a.p), 1) * 0.01);
  const middle = (a.p + b.p) / 2;
  const bend = Math.max(span * 0.42, Math.max(Math.abs(a.p), 1) * 0.006);

  if (kind === "longposition" || kind === "shortposition") {
    const direction = kind === "longposition" ? 1 : -1;
    const target = { ...b, p: rounded(a.p + direction * span, precision) };
    const stop = { t: String(b.t), p: rounded(a.p - direction * span, precision) };
    return [copy[0], target, stop];
  }
  if (kind === "curve") {
    return [copy[0], copy[1], between(a, b, 0.5, middle - Math.sign(rawDelta || 1) * bend, orderedTimes, precision)];
  }
  if (kind === "doublecurve") {
    return [
      copy[0], copy[1],
      between(a, b, 0.38, middle - bend, orderedTimes, precision),
      between(a, b, 0.62, middle + bend, orderedTimes, precision),
    ];
  }
  if (kind === "divergence") {
    const offset = span * 0.55;
    return [
      copy[0], copy[1],
      { t: String(a.t), p: rounded(a.p - offset, precision) },
      { t: String(b.t), p: rounded(b.p + offset, precision) },
    ];
  }
  if (kind === "journey") {
    return [
      copy[0], copy[1],
      between(a, b, 0.2, a.p + rawDelta * 0.2 - bend, orderedTimes, precision),
      between(a, b, 0.4, a.p + rawDelta * 0.4 + bend * 0.65, orderedTimes, precision),
      between(a, b, 0.6, a.p + rawDelta * 0.6 - bend * 0.65, orderedTimes, precision),
      between(a, b, 0.8, a.p + rawDelta * 0.8 + bend, orderedTimes, precision),
    ];
  }
  if (kind === "fork") {
    const hub = between(a, b, 0.42, a.p + rawDelta * 0.42, orderedTimes, precision);
    return [
      copy[0], copy[1], hub,
      { t: String(b.t), p: rounded(b.p + bend, precision) },
      { t: String(b.t), p: rounded(b.p - bend, precision) },
    ];
  }
  if (kind === "threepaths") {
    return [
      copy[0], copy[1],
      { t: String(a.t), p: rounded(a.p + bend, precision) },
      { t: String(b.t), p: rounded(b.p + bend * 0.45, precision) },
      { t: String(a.t), p: rounded(a.p - bend, precision) },
    ];
  }
  if (kind === "burj") {
    return [copy[0], copy[1], between(a, b, 0.5, Math.max(a.p, b.p) + bend, orderedTimes, precision)];
  }
  return copy;
}

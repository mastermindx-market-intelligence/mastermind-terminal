import type { DrawKind, Drawing } from "@/lib/drawings";
import { getDrawingTool } from "@/lib/drawingTools";
import { DRAWING_RENDERER_FAMILY } from "@/lib/drawing-engine/geometry";
import { fibonacciSettings } from "@/lib/drawing-engine/settings";
import { timeToMs } from "@/lib/timeWindow";
import type { ChartPriceWindowSource } from "@/lib/chartPriceWindow";
import type { WirePt } from "@/lib/chartBus";

/** Admission policy over the existing native registry, not a second drawing catalog.
 * Deliberately excludes computed-volume, portfolio-sizing, pane-space and gesture-derived
 * tools until their observation/metadata contracts can support model-authored analysis.
 */
export const AI_NATIVE_DRAWING_KINDS = [
  "trendline", "ray", "extendedline", "infoline", "hline", "horizontalray", "vline", "crossline",
  "channel", "disjointchannel", "pitchfork", "modifiedschiffpitchfork",
  "fib", "fibtrend", "fibchannel", "fibspeedresistancefan", "pitchfan",
  "xabcd", "cypher", "abcd", "headandshoulders", "trianglepattern", "threedrives",
  "elliottimpulse", "elliottcorrection", "elliotttriangle",
  "pricerange", "daterange", "dateandpricerange", "measure",
  "path", "polyline", "rect", "triangle", "arrow",
  "arrowmarker", "arrowmarkleft", "arrowmarkright", "arrowmarktop", "arrowmarkbottom", "flagmark",
  "text", "note", "callout", "pricelabel", "pricenote", "signpost", "comment",
] as const satisfies readonly DrawKind[];
export type AiNativeDrawingKind = (typeof AI_NATIVE_DRAWING_KINDS)[number];
const admitted = new Set<string>(AI_NATIVE_DRAWING_KINDS);
export const isAiNativeDrawingKind = (kind: unknown): kind is AiNativeDrawingKind =>
  typeof kind === "string" && admitted.has(kind);

const ROLES: Partial<Record<AiNativeDrawingKind, readonly string[]>> = {
  channel: ["baseline_start", "baseline_end", "parallel_offset"],
  disjointchannel: ["upper_start", "upper_end", "lower_start", "lower_end"],
  pitchfork: ["origin_pivot", "second_pivot", "third_pivot"],
  modifiedschiffpitchfork: ["origin_pivot", "second_pivot", "third_pivot"],
  fib: ["zero_level", "one_level"],
  fibtrend: ["move_start", "move_end", "retracement_end"],
  fibchannel: ["baseline_start", "baseline_end", "offset_anchor"],
  pitchfan: ["origin", "first_boundary", "second_boundary"],
  xabcd: ["X", "A", "B", "C", "D"], cypher: ["X", "A", "B", "C", "D"],
  abcd: ["A", "B", "C", "D"],
  elliottimpulse: ["0", "1", "2", "3", "4", "5"],
  elliottcorrection: ["0", "A", "B", "C"],
  elliotttriangle: ["0", "A", "B", "C", "D", "E"],
  callout: ["subject", "text_position"],
};

export function aiNativeDrawingContract(kind: AiNativeDrawingKind) {
  const tool = getDrawingTool(kind)!;
  const family = DRAWING_RENDERER_FAMILY[kind];
  const fields = ["color", "width", "dash", "opacity"];
  if (tool.capabilities.includes("fill")) fields.push("fill_color", "fill_opacity");
  if (tool.capabilities.includes("fontSize")) fields.push("font_size");
  return {
    kind, label: tool.label, family,
    min_points: tool.creation.semanticPointCount ?? tool.creation.minPoints,
    max_points: tool.creation.semanticPointCount ?? tool.creation.maxPoints,
    anchor_roles: ROLES[kind] ?? (tool.creation.pointCount === "variable" ? ["ordered_vertices"] :
      Array.from({ length: tool.creation.maxPoints }, (_, index) => `anchor_${index + 1}`)),
    chronological: family === "pattern" || family === "pitchfork" || kind === "fibtrend",
    nonzero_price_legs: kind === "xabcd",
    style_fields: fields,
    text: family === "annotation" && kind !== "pricelabel" ? "required" : kind === "hline" ? "optional_label" : "unsupported",
    semantics: family === "pattern" ? "interpretive_annotation_not_detection" :
      family === "range" || kind === "infoline" ? "loaded_bar_measurement" : "geometric_annotation",
  };
}

export function describeAiDrawingCapabilities() {
  return { schema: "chart.drawing_tools.v1", op: "draw.tool", coordinate_domain: "price",
    anchor_space: "data", timestamp: "epoch_seconds_exact_loaded_bar",
    points: "explicit_semantic_anchors_no_invented_gesture_handles",
    projection: "all_observation_times_must_be_loaded_on_exact_target",
    fibonacci: { kinds: ["fib", "fibtrend"], basis: "raw_price_arithmetic_even_on_log_display",
      fields: ["levels", "reverse", "labels"], max_levels: 24, ratio_range: [-100, 100] },
    tools: AI_NATIVE_DRAWING_KINDS.map(aiNativeDrawingContract),
  };
}

/** Recover the accepted native contract from the actual stored object, not its caption.
 * Only supported override fields are reported; Fibonacci values use the renderer's
 * effective settings so a later read can distinguish and revise each construction.
 */
export function nativeDrawingStateArgs(drawing: Drawing): Record<string, unknown> | null {
  if (!isAiNativeDrawingKind(drawing.kind)) return null;
  const contract = aiNativeDrawingContract(drawing.kind);
  const overrides: Record<string, unknown> = {
    color: drawing.color, width: drawing.width, dash: drawing.dash, opacity: drawing.opacity,
    fill_color: drawing.fillColor, fill_opacity: drawing.fillOpacity, font_size: drawing.fontSize,
  };
  const style = Object.fromEntries(contract.style_fields
    .filter(key => overrides[key] !== undefined).map(key => [key, overrides[key]]));
  const args: Record<string, unknown> = { kind: drawing.kind,
    points: drawing.points.map(point => ({ t: Number(point.t) || point.t, p: point.p })) };
  if (Object.keys(style).length) args.style = style;
  if (contract.text !== "unsupported" && drawing.text) args.text = drawing.text;
  if (drawing.kind === "fib" || drawing.kind === "fibtrend") {
    const settings = fibonacciSettings(drawing.meta);
    args.fibonacci = { levels: settings.levels.filter(level => level.visible).map(level => level.value),
      reverse: settings.reverse, labels: settings.labels };
  }
  return args;
}

/** Rechecked at queue execution, against the existing accepted renderer's bar owner. */
export function nativeDrawingAnchorError(
  kind: AiNativeDrawingKind, points: readonly WirePt[], source: ChartPriceWindowSource | null,
  symbol: string, tf: string,
): string | null {
  if (!source || source.symbol !== symbol || source.tf !== tf || !source.bars.length || source.bars.length > 200_000)
    return "drawing_source_not_current";
  const times = new Set(source.bars.map(bar => timeToMs(bar.time)));
  if (points.some(point => !times.has(point.t * 1000))) return "drawing_anchor_not_loaded";
  if (new Set(points.map(point => `${point.t}:${point.p}`)).size !== points.length)
    return "duplicate_drawing_anchor";
  const contract = aiNativeDrawingContract(kind);
  if (contract.chronological && points.some((point, index) => index > 0 && point.t <= points[index - 1].t))
    return "drawing_anchor_order_invalid";
  if (contract.nonzero_price_legs && points.some((point, index) => index > 0 && point.p === points[index - 1].p))
    return "degenerate_pattern_leg";
  if ((kind === "fib" || kind === "fibtrend") && points[0]?.p === points[1]?.p)
    return "degenerate_drawing";
  if (["channel", "fibchannel"].includes(kind) && points[0]?.t === points[1]?.t)
    return "degenerate_drawing";
  if (["channel", "fibchannel", "pitchfork", "modifiedschiffpitchfork", "triangle"].includes(kind)
      && points.length === 3) {
    const [a, b, c] = points;
    if ((b.t - a.t) * (c.p - a.p) === (c.t - a.t) * (b.p - a.p)) return "degenerate_drawing";
  }
  return null;
}

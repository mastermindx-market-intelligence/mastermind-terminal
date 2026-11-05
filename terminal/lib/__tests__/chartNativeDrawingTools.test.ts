import { describe, expect, it } from "vitest";
import { translate, requiresExactChartTarget, type ChartCommandV2 } from "@/lib/chartBus";
import { AI_NATIVE_DRAWING_KINDS, aiNativeDrawingContract, describeAiDrawingCapabilities, nativeDrawingAnchorError } from "@/lib/chartDrawingTools";
import { drawingToolAcceptsPersistedPointCount, getDrawingTool } from "@/lib/drawingTools";
import { DRAWING_RENDERER_FAMILY } from "@/lib/drawing-engine/geometry";
import { fibonacciPriceLevels, fibonacciSettings } from "@/lib/drawing-engine/settings";
import type { ChartPriceWindowSource } from "@/lib/chartPriceWindow";

const start = 1721606400;
const anchors = [{ t: start, p: 100 }, { t: start + 86400, p: 120 }, { t: start + 172800, p: 110 }];
const source: ChartPriceWindowSource = { symbol: "SYNTHETIC", tf: "D", replay: false,
  bars: anchors.map(point => ({ time: point.t, o: point.p, h: point.p + 2, l: point.p - 2, c: point.p, v: 100 })) };
const draw = (args: Record<string, unknown>) => translate({ on: true, v: 2, batch_id: "native", seq: 1,
  op: "draw.tool", id: "ai_native", args } as ChartCommandV2, { tfs: [], indicators: [] });

describe("reviewed native drawing admission", () => {
  it("derives every advertised label and point contract from the actual registry", () => {
    const capabilities = describeAiDrawingCapabilities();
    expect(capabilities.tools).toHaveLength(AI_NATIVE_DRAWING_KINDS.length);
    expect(requiresExactChartTarget({ op: "draw.tool" })).toBe(true);
    for (const contract of capabilities.tools) {
      const tool = getDrawingTool(contract.kind)!;
      expect(tool.creation.anchorSpace).toBe("data");
      expect(contract.label).toBe(tool.label);
      expect(drawingToolAcceptsPersistedPointCount(contract.kind, contract.min_points)).toBe(true);
      expect(drawingToolAcceptsPersistedPointCount(contract.kind, contract.max_points)).toBe(true);
    }
  });

  it.each(AI_NATIVE_DRAWING_KINDS)("translates %s into one native, AI-owned logical object", kind => {
    const contract = aiNativeDrawingContract(kind);
    const points = Array.from({ length: contract.min_points }, (_, index) => ({ t: start + index * 86400, p: 100 + (index % 2 ? 20 : index) }));
    const result = draw({ kind, points, ...(contract.text === "required" ? { text: "Observed structure" } : {}) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draw).toHaveLength(1);
    expect(result.draw![0]).toMatchObject({ id: "ai_native", command_id: "ai_native", kind, by: "ai", source: "ai" });
    expect(result.draw![0].points).toEqual(points.map(point => ({ t: String(point.t), p: point.p })));
  });

  it.each(["longposition", "shortposition", "anchoredvwap", "fixedrangevolumeprofile", "divergence", "curve", "fibcircles", "schiffpitchfork", "insidepitchfork", "image", "rotatedrect", "flattopbottom"])
    ("refuses unqualified semantic tool %s", kind => {
      expect(draw({ kind, points: anchors })).toMatchObject({ ok: false, error: "unsupported_drawing_tool" });
    });

  it("refuses incomplete semantic handles, arbitrary metadata, and ignored styling", () => {
    expect(draw({ kind: "pitchfork", points: anchors.slice(0, 2) })).toMatchObject({ ok: false, error: "bad_drawing_point_count" });
    expect(draw({ kind: "elliottimpulse", points: anchors })).toMatchObject({ ok: false, error: "bad_drawing_point_count" });
    expect(draw({ kind: "fib", points: anchors.slice(0, 2), meta: { by: "user" } })).toMatchObject({ ok: false, error: "unknown_drawing_argument" });
    expect(draw({ kind: "trendline", points: anchors.slice(0, 2), style: { font_size: 20 } })).toMatchObject({ ok: false, error: "unsupported_drawing_style" });
    expect(draw({ kind: "text", points: anchors.slice(0, 1) })).toMatchObject({ ok: false, error: "drawing_text_required" });
  });

  it("qualifies all timestamps against the exact loaded source; it never snaps missing anchors", () => {
    expect(nativeDrawingAnchorError("pitchfork", anchors, source, "SYNTHETIC", "D")).toBeNull();
    expect(nativeDrawingAnchorError("pitchfork", anchors, source, "OTHER", "D")).toBe("drawing_source_not_current");
    expect(nativeDrawingAnchorError("pitchfork", [anchors[0], { ...anchors[1], t: anchors[1].t + 1 }, anchors[2]], source, "SYNTHETIC", "D")).toBe("drawing_anchor_not_loaded");
    expect(nativeDrawingAnchorError("pitchfork", [anchors[2], anchors[1], anchors[0]], source, "SYNTHETIC", "D")).toBe("drawing_anchor_order_invalid");
    expect(nativeDrawingAnchorError("channel", anchors.map((point, i) => ({ ...point, p: 100 + i * 10 })), source, "SYNTHETIC", "D")).toBe("degenerate_drawing");
  });
  it("rejects a zero-price pattern leg instead of rendering an undefined ratio as zero", () => {
    const points = [100, 100, 115, 108, 121].map((p, index) => ({ t: start + index * 86400, p }));
    const loaded = { ...source, bars: points.map(point => ({ time: point.t, o: point.p, h: point.p + 1, l: point.p - 1, c: point.p, v: 100 })) };
    expect(nativeDrawingAnchorError("xabcd", points, loaded, "SYNTHETIC", "D")).toBe("degenerate_pattern_leg");
    expect(aiNativeDrawingContract("xabcd").nonzero_price_legs).toBe(true);
  });
});

describe("three-pivot Fibonacci extension geometry", () => {
  it("uses C + (B − A) × ratio and remains distinct from a Fibonacci channel", () => {
    const result = draw({ kind: "fibtrend", points: anchors, fibonacci: { levels: [0, 1, 1.618] } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    const drawing = result.draw![0];
    const settings = fibonacciSettings(drawing.meta);
    const levels = fibonacciPriceLevels("fibtrend", drawing.points, settings);
    expect(levels.map(level => level.price)).toEqual([110, 130, 142.36]);
    const shifted = fibonacciPriceLevels("fibtrend", drawing.points.map((point, i) => i === 2 ? { ...point, p: point.p + 7 } : point), settings);
    expect(shifted.map((level, i) => level.price - levels[i].price)).toEqual([7, 7, 7]);
    expect(DRAWING_RENDERER_FAMILY.fibtrend).toBe("fib-extension");
    expect(DRAWING_RENDERER_FAMILY.fibchannel).toBe("fib-grid");
  });

  it("preserves two-point retracement reversal and rejects silently rounded levels", () => {
    const points = anchors.map(point => ({ t: String(point.t), p: point.p }));
    const settings = fibonacciSettings({ fibLevels: [0, 1], fibReverse: true });
    expect(fibonacciPriceLevels("fib", points, settings).map(level => level.price)).toEqual([120, 100]);
    expect(fibonacciPriceLevels("fibtrend", points, settings).map(level => level.price)).toEqual([110, 90]);
    expect(draw({ kind: "fibtrend", points: anchors, fibonacci: { levels: [1.12345678] } })).toMatchObject({ ok: false, error: "bad_fibonacci_levels" });
    expect(draw({ kind: "fibtrend", points: anchors, fibonacci: { levels: [1, 1] } })).toMatchObject({ ok: false, error: "bad_fibonacci_levels" });
  });
});

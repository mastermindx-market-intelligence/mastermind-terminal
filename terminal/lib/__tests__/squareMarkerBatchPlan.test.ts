import { describe, expect, it } from "vitest";
import { planSquareMarkerBatch, sameSquareMarkerBatchStyle } from "@/lib/indicator-canvas/squareMarkerBatch";
import { MACDX_ENGINE_DEFAULTS } from "@/lib/suites/macdx/macdEngine";
import { MACD_TREND_MODULE } from "@/lib/suites/macdx/macdTrend";
import type { CoordMapper, MarkerPrim, ModuleCtx, SuiteBar, SuiteColors } from "@/lib/indicator-canvas/types";

const mapper: Pick<CoordMapper, "xi" | "y" | "W" | "barW"> = {
  xi: (i) => i * 10,
  y: (p) => 100 - p,
  W: 240,
  barW: 10,
};

function square(id: string, i: number, extra: Partial<MarkerPrim> = {}): MarkerPrim {
  return {
    kind: "marker",
    id,
    i,
    p: 40,
    shape: "square",
    size: 3,
    fill: "var(--up)",
    alpha: 0.55,
    ...extra,
  };
}

describe("square marker batch planner", () => {
  it("plans only a style-identical, tooltip-free run and keeps every rectangle exact", () => {
    const safe = [square("s1", 2), square("s2", 4), square("s3", 6)];
    expect(planSquareMarkerBatch(safe, mapper)).toEqual({
      paths: ["M17 57H23V63H17Z" + "M37 57H43V63H37Z" + "M57 57H63V63H57Z"],
      fill: "var(--up)",
      stroke: null,
      alpha: 0.55,
      visibleCount: 3,
    });

    expect(planSquareMarkerBatch([safe[0], square("tip", 4, { tooltipId: "tip" })], mapper)).toBeNull();
    expect(planSquareMarkerBatch([safe[0], square("other", 4, { fill: "var(--down)" })], mapper)).toBeNull();
  });

  it("partitions a dense overlap run into separate opacity layers, and skips no dots", () => {
    const dense = [2, 2.4, 2.8, 3.2, 3.6].map((i, index) => square(`dense-${index}`, i));
    const plan = planSquareMarkerBatch(dense, mapper);
    expect(plan?.visibleCount).toBe(5);
    expect(plan?.paths).toHaveLength(2);
    expect(plan?.paths.reduce((n, d) => n + (d.match(/M/g)?.length ?? 0), 0)).toBe(5);

    // Two overlapping dots need two layers, which would save no node. The ordinary renderer is the
    // honest fallback rather than replacing two rectangles with two more complicated paths.
    expect(planSquareMarkerBatch([square("a", 2), square("b", 2.4)], mapper)).toBeNull();
  });

  it("clamps alpha and refuses non-monotonic source order", () => {
    expect(planSquareMarkerBatch([
      square("a", 2, { alpha: 4 }),
      square("b", 4, { alpha: 4 }),
    ], mapper)?.alpha).toBe(1);
    expect(planSquareMarkerBatch([square("later", 4), square("earlier", 2)], mapper)).toBeNull();
  });
});


describe("MACD phase-ribbon consumption", () => {
  const colors: SuiteColors = {
    up: "var(--up)", down: "var(--down)", flowBuy: "var(--flow-buy)",
    flowSell: "var(--flow-sell)", warn: "var(--warn)", brand: "var(--brand-2)",
    text: "var(--text)", muted: "var(--muted)", neutral: "var(--text-dim)",
  };

  function bars(n = 1255): SuiteBar[] {
    let price = 100;
    let seed = 0x12345678;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return Array.from({ length: n }, (_, i) => {
      const open = price;
      const swing = Math.sin(i / 6) * 0.9 + Math.sin(i / 29) * 1.4;
      const shock = i > 30 && i % 47 === 0 ? (i % 94 === 0 ? 4.5 : -4.5) : 0;
      const close = Math.max(5, price + (random() - 0.5) * 1.6 + swing + shock);
      const high = Math.max(open, close) + random() * 1.1;
      const low = Math.min(open, close) - random() * 1.1;
      price = close;
      return { t: 86400 * (i + 1), o: open, h: high, l: low, c: close, v: 1000 };
    });
  }

  function phaseSquares(): MarkerPrim[] {
    const d = MACDX_ENGINE_DEFAULTS;
    const ctx: ModuleCtx = {
      bars: bars(), tf: "1D", symbol: "TEST", isIntraday: false, s: {}, colors, lang: "en",
      suite: {
        "eng.fast": d.fast,
        "eng.slow": d.slow,
        "eng.signalLen": d.signalLen,
        "eng.oscMa": d.oscMa,
        "eng.sigMa": d.sigMa,
        "trend.on": true,
      },
    };
    const result = MACD_TREND_MODULE.compute(ctx);
    return (result.prims ?? []).filter(
      (prim): prim is MarkerPrim => prim.kind === "marker" && prim.shape === "square",
    );
  }

  function projectedNodeCount(markers: MarkerPrim[], barW: number): { nodes: number; represented: number } {
    const from = 1255 - 400;
    const projected = {
      xi: (i: number) => (i - from) * barW,
      y: (p: number) => 200 - p,
      W: 400 * barW,
      barW,
    };
    let nodes = 0;
    let represented = 0;
    for (let i = 0; i < markers.length;) {
      const marker = markers[i];
      if (marker.tooltipId) {
        nodes++;
        represented++;
        i++;
        continue;
      }
      let end = i + 1;
      while (
        end < markers.length &&
        !markers[end].tooltipId &&
        sameSquareMarkerBatchStyle(marker, markers[end], barW)
      ) end++;
      const run = markers.slice(i, end);
      const plan = planSquareMarkerBatch(run, projected);
      nodes += plan ? plan.paths.length : run.length;
      represented += plan ? plan.visibleCount : run.length;
      i = end;
    }
    return { nodes, represented };
  }

  it("reduces the real phase ribbon at normal and overlapping zoom densities without losing a dot", () => {
    const markers = phaseSquares();
    expect(markers.length).toBeGreaterThan(100);

    const normal = projectedNodeCount(markers, 3);
    expect(normal.represented).toBe(markers.length);
    expect(normal.nodes).toBeLessThan(markers.length * 0.35);

    const dense = projectedNodeCount(markers, 1.35);
    expect(dense.represented).toBe(markers.length);
    expect(dense.nodes).toBeLessThan(markers.length * 0.65);
  });
});

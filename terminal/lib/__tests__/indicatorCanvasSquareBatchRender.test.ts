// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrims } from "@/lib/indicator-canvas/render";
import type { CoordMapper, MarkerPrim, Prim, SuiteRenderBundle } from "@/lib/indicator-canvas/types";

const mapper: CoordMapper = {
  xi: (i) => i * 10,
  y: (p) => 100 - p,
  W: 140,
  H: 200,
  i0: 0,
  i1: 14,
  barW: 10,
};

function marker(id: string, i: number, extra: Partial<MarkerPrim> = {}): MarkerPrim {
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

function draw(prims: Prim[], tooltipIds: string[] = []) {
  const wrap = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wrap.appendChild(svg);
  document.body.appendChild(wrap);
  const bundle: SuiteRenderBundle = {
    prims,
    tooltips: new Map(tooltipIds.map((id) => [id, { id, title: id, rows: [] }])),
    candlePaint: [],
    events: [],
    tables: [],
  };
  renderPrims(svg, bundle, mapper);
  return { wrap, svg };
}

describe("indicator-canvas square marker batch integration", () => {
  it("replaces a safe square run with one exact compound path", () => {
    const { wrap, svg } = draw([
      marker("s1", 2),
      marker("s2", 4),
      marker("s3", 6),
      marker("s4", 8),
    ]);

    expect(svg.querySelectorAll("rect"), "one rect per dot leaves the phase ribbon allocation-heavy")
      .toHaveLength(0);
    const paths = [...svg.querySelectorAll("path")];
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute("d")).toBe(
      "M17 57H23V63H17Z" +
      "M37 57H43V63H37Z" +
      "M57 57H63V63H57Z" +
      "M77 57H83V63H77Z",
    );
    expect(paths[0].getAttribute("fill")).toBe("var(--up)");
    expect(paths[0].getAttribute("opacity")).toBe("0.55");
    wrap.remove();
  });

  it("preserves tooltip nodes, primitive order, and honest overlap fallback", () => {
    const tip = marker("tip", 1, { tooltipId: "phase-start" });
    const circle = marker("circle", 7, { shape: "circle" });
    const { wrap, svg } = draw([
      tip,
      marker("safe-a", 3),
      marker("safe-b", 5),
      circle,
      marker("overlap-a", 8),
      marker("overlap-b", 8.4),
    ], ["phase-start"]);

    expect([...svg.children].map((el) => el.tagName.toLowerCase())).toEqual([
      "rect", "path", "circle", "rect", "rect",
    ]);
    expect(svg.firstElementChild?.getAttribute("data-ic-tip")).toBe("phase-start");
    expect(svg.querySelectorAll('[data-ic-tip="phase-start"]')).toHaveLength(1);
    wrap.remove();
  });
});

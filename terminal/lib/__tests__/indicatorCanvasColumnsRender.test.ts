// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrims } from "@/lib/indicator-canvas/render";
import type { ColumnsPrim, CoordMapper, SuiteRenderBundle } from "@/lib/indicator-canvas/types";

const mapper: CoordMapper = {
  xi: (i) => i * 10,
  y: (p) => 100 - p,
  W: 100,
  H: 200,
  i0: 4,
  i1: 5,
  barW: 10,
};

function bundle(): SuiteRenderBundle {
  const styles = [
    { color: "var(--up)" },
    { color: "var(--down)", alpha: 0.5 },
    { color: "var(--up)", alpha: 0.5 },
  ] as const;
  const columns: ColumnsPrim = {
    kind: "columns",
    id: "hist",
    base: 0,
    widthFrac: 0.6,
    items: Array.from({ length: 10 }, (_, i) => ({
      i,
      v: i % 2 === 0 ? 20 + i : -(10 + i),
      ...styles[i % styles.length],
    })),
  };
  return {
    prims: [columns],
    tooltips: new Map(),
    candlePaint: [],
    events: [],
    tables: [],
  };
}

describe("indicator-canvas columns renderer", () => {
  it("batches visible histogram bars by visual style without changing their rectangle geometry", () => {
    const wrap = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wrap.appendChild(svg);
    document.body.appendChild(wrap);

    renderPrims(svg, bundle(), mapper);

    // Visible logical range is 4..5 and columns deliberately retain two bars of padding on each
    // side, so exactly indices 2..7 must be represented. Offscreen history must not leak in.
    const paths = [...svg.querySelectorAll("path")];
    const subpaths = paths.reduce((n, p) => n + ((p.getAttribute("d") || "").match(/M/g)?.length ?? 0), 0);
    expect(subpaths).toBe(6);

    // Per-bar DOM nodes are the hot-path defect. Six visible bars here use only the three distinct
    // fill/opacity styles carried by the input.
    expect(svg.querySelectorAll("rect")).toHaveLength(0);
    expect(paths).toHaveLength(3);

    const keyed = new Map(paths.map((p) => [
      `${p.getAttribute("fill")}|${p.getAttribute("fill-opacity") ?? "1"}`,
      p.getAttribute("d") || "",
    ]));
    expect(new Set(keyed.keys())).toEqual(new Set([
      "var(--up)|1",
      "var(--down)|0.5",
      "var(--up)|0.5",
    ]));

    // i=4 => x=40, 6px width, v=24 => y from 76 up to baseline 100.
    expect(keyed.get("var(--down)|0.5")).toContain("M37 76H43V100H37Z");
    // i=3 and i=6 share the opaque-up style; both exact rectangles survive inside one path.
    expect(keyed.get("var(--up)|1")).toContain("M27 100H33V113H27Z");
    expect(keyed.get("var(--up)|1")).toContain("M57 74H63V100H57Z");

    wrap.remove();
  });
});

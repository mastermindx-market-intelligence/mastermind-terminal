// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrims } from "@/lib/indicator-canvas/render";
import type { CloudPrim, CoordMapper, SuiteRenderBundle } from "@/lib/indicator-canvas/types";

const wrapBundle = (c: CloudPrim): SuiteRenderBundle => ({
  prims: [c], tooltips: new Map(), candlePaint: [], events: [], tables: [],
});

describe("cloud viewport slicing in the renderer", () => {
  it("transforms only the padded visible slice of a long monotonic cloud", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    let xiCalls = 0, yCalls = 0;
    const m: CoordMapper = {
      xi: (i) => { xiCalls++; return (i - 400) * 10; },
      y: (p) => { yCalls++; return 500 - p; },
      W: 1000, H: 600, i0: 400, i1: 499, barW: 10,
    };
    const upper = Array.from({ length: 1000 }, (_, i) => ({ i, p: 110 + Math.sin(i / 10) }));
    const lower = Array.from({ length: 1000 }, (_, i) => ({ i, p: 90 + Math.sin(i / 10) }));
    const c: CloudPrim = {
      kind: "cloud", id: "long-cloud", upper, lower,
      segColors: Array.from({ length: 999 }, () => "var(--brand-2)"), fillAlpha: 0.12,
    };

    renderPrims(svg, wrapBundle(c), m);

    expect(xiCalls).toBe(110);
    expect(yCalls).toBe(220);
    const poly = svg.querySelector("polygon");
    expect(poly).not.toBeNull();
    const coords = (poly?.getAttribute("points") || "").trim().split(/\s+/);
    expect(coords).toHaveLength(220);
    expect(coords[0].startsWith("-50,")).toBe(true);
    expect(coords[109].startsWith("1040,")).toBe(true);
  });

  it("keeps cloud segment colors anchored to original point indexes after slicing", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const m: CoordMapper = {
      xi: (i) => (i - 10) * 10, y: (p) => 100 - p,
      W: 50, H: 120, i0: 10, i1: 15, barW: 10,
    };
    const upper = Array.from({ length: 30 }, (_, i) => ({ i, p: 60 + i }));
    const lower = Array.from({ length: 30 }, (_, i) => ({ i, p: 40 + i }));
    const segColors = Array.from({ length: 29 }, (_, i) => i < 12 ? "red" : i < 19 ? "blue" : "green");
    const c: CloudPrim = { kind: "cloud", id: "states", upper, lower, segColors };

    renderPrims(svg, wrapBundle(c), m);

    const polys = [...svg.querySelectorAll("polygon")];
    expect(polys.map((p) => p.getAttribute("fill"))).toEqual(["red", "blue", "green"]);
  });

  it("falls back to full-history coordinate work when upper indexes are unsorted", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    let xiCalls = 0;
    const m: CoordMapper = {
      xi: (i) => { xiCalls++; return i * 10; }, y: (p) => p,
      W: 100, H: 100, i0: 0, i1: 9, barW: 10,
    };
    const upper = [{ i: 0, p: 3 }, { i: 7, p: 4 }, { i: 3, p: 5 }, { i: 9, p: 6 }];
    const lower = [{ i: 0, p: 1 }, { i: 7, p: 2 }, { i: 3, p: 3 }, { i: 9, p: 4 }];
    renderPrims(svg, wrapBundle({ kind: "cloud", id: "unsorted", upper, lower }), m);
    expect(xiCalls).toBe(4);
  });
});

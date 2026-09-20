// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrims } from "@/lib/indicator-canvas/render";
import type {
  CloudPrim, CoordMapper, GradLinePrim, SuiteRenderBundle,
} from "@/lib/indicator-canvas/types";

function bundle(prim: SuiteRenderBundle["prims"][number]): SuiteRenderBundle {
  return { prims: [prim], tooltips: new Map(), candlePaint: [], events: [], tables: [] };
}

describe("indicator-canvas long-series viewport projection", () => {
  it("projects only the visible sorted slice plus boundary points", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    const pts = Array.from({ length: 1000 }, (_, i) => ({ i, p: i / 10 }));
    const prim: GradLinePrim = {
      kind: "gradline",
      id: "g",
      pts,
      colors: new Array(pts.length).fill("var(--brand-2)"),
      w: 2,
    };
    let xiCalls = 0;
    let yCalls = 0;
    const m: CoordMapper = {
      xi: (i) => { xiCalls++; return (i - 400) * 10; },
      y: (p) => { yCalls++; return p; },
      W: 1000,
      H: 500,
      i0: 400,
      i1: 499,
      barW: 10,
    };

    renderPrims(svg, bundle(prim), m);

    expect(xiCalls, "full-history x projection returned to the pan/zoom hot path").toBeLessThanOrEqual(110);
    expect(yCalls).toBe(xiCalls);
    expect(xiCalls).toBeGreaterThanOrEqual(100);

    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toContain("M-30 39.7");
    expect(d).toContain("L1020 50.2");
    expect(d).not.toContain("-4000 0");

    svg.remove();
  });


  it("keeps source-space segment colors when the visible slice begins mid-series", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    const pts = Array.from({ length: 21 }, (_, i) => ({ i, p: i }));
    const colors = pts.map((_, i) => i < 10 ? "red" : i < 13 ? "green" : "blue");
    const prim: GradLinePrim = { kind: "gradline", id: "colors", pts, colors };
    const m: CoordMapper = {
      xi: (i) => (i - 10) * 10,
      y: (p) => p,
      W: 100,
      H: 100,
      i0: 10,
      i1: 11,
      barW: 10,
    };

    renderPrims(svg, bundle(prim), m);

    const paths = [...svg.querySelectorAll("path")];
    expect(paths.map((p) => p.getAttribute("stroke"))).toEqual(["red", "green", "blue"]);
    expect(paths[0].getAttribute("d")).toContain("M-30 7");
    expect(paths[0].getAttribute("d")).toContain("L0 10");
    expect(paths[1].getAttribute("d")).toContain("M0 10");
    expect(paths[1].getAttribute("d")).toContain("L30 13");

    svg.remove();
  });

  it("culls cloud projection while preserving paired geometry and source colors", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    const upper = Array.from({ length: 1000 }, (_, i) => ({ i, p: 100 + i / 10 }));
    const lower = Array.from({ length: 1000 }, (_, i) => ({ i, p: 90 + i / 10 }));
    const segColors = upper.map((_, i) => i < 450 ? "red" : "green");
    const prim: CloudPrim = {
      kind: "cloud",
      id: "cloud",
      upper,
      lower,
      segColors,
      fillAlpha: 0.12,
    };
    let xiCalls = 0;
    let yCalls = 0;
    const m: CoordMapper = {
      xi: (i) => { xiCalls++; return (i - 400) * 10; },
      y: (p) => { yCalls++; return p; },
      W: 1000,
      H: 500,
      i0: 400,
      i1: 499,
      barW: 10,
    };

    renderPrims(svg, bundle(prim), m);

    expect(xiCalls).toBeLessThanOrEqual(110);
    expect(yCalls).toBe(xiCalls * 2);
    const polys = [...svg.querySelectorAll("polygon")];
    expect(polys.map((p) => p.getAttribute("fill"))).toEqual(["red", "green"]);
    expect(polys[0].getAttribute("points")).toContain("-30,139.7");
    expect(polys[1].getAttribute("points")).toContain("500,145");

    svg.remove();
  });

  it("falls back to full projection when point indexes are not monotonic", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    const pts = [
      { i: 0, p: 1 },
      { i: 10, p: 2 },
      { i: 5, p: 3 },
      { i: 15, p: 4 },
    ];
    const prim: GradLinePrim = {
      kind: "gradline",
      id: "unsorted",
      pts,
      colors: ["a", "a", "a", "a"],
    };
    let xiCalls = 0;
    const m: CoordMapper = {
      xi: (i) => { xiCalls++; return i * 10; },
      y: (p) => p,
      W: 160,
      H: 100,
      i0: 5,
      i1: 10,
      barW: 10,
    };

    renderPrims(svg, bundle(prim), m);
    expect(xiCalls).toBe(pts.length);
    svg.remove();
  });
});

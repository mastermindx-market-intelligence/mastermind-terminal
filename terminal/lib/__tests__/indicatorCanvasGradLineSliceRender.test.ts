// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrims } from "@/lib/indicator-canvas/render";
import type { CoordMapper, GradLinePrim, SuiteRenderBundle } from "@/lib/indicator-canvas/types";

const wrapBundle = (g: GradLinePrim): SuiteRenderBundle => ({
  prims: [g], tooltips: new Map(), candlePaint: [], events: [], tables: [],
});

describe("gradline viewport slicing in the renderer", () => {
  it("transforms and serializes only the padded visible slice of a long monotonic line", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    let xiCalls = 0, yCalls = 0;
    const m: CoordMapper = {
      xi: (i) => { xiCalls++; return (i - 400) * 10; },
      y: (p) => { yCalls++; return 500 - p; },
      W: 1000, H: 600, i0: 400, i1: 499, barW: 10,
    };
    const pts = Array.from({ length: 1000 }, (_, i) => ({ i, p: 100 + Math.sin(i / 10) }));
    const g: GradLinePrim = {
      kind: "gradline", id: "long", pts, colors: pts.map(() => "var(--brand-2)"), w: 1.5,
    };

    renderPrims(svg, wrapBundle(g), m);

    expect(xiCalls).toBe(110);
    expect(yCalls).toBe(110);
    const path = svg.querySelector("path");
    expect(path).not.toBeNull();
    const d = path?.getAttribute("d") || "";
    expect((d.match(/L/g) || []).length).toBe(109);
    expect(d.startsWith("M-50 ")).toBe(true);
    expect(d).toContain("L1040 ");
  });


  it("keeps state-color boundaries in original point-index space after slicing", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const m: CoordMapper = {
      xi: (i) => (i - 10) * 10,
      y: (p) => 100 - p,
      W: 50, H: 120, i0: 10, i1: 15, barW: 10,
    };
    const pts = Array.from({ length: 30 }, (_, i) => ({ i, p: i }));
    const colors = pts.map((_, i) => i < 12 ? "red" : i < 19 ? "blue" : "green");
    const g: GradLinePrim = { kind: "gradline", id: "states", pts, colors };

    renderPrims(svg, wrapBundle(g), m);

    const paths = [...svg.querySelectorAll("path")];
    expect(paths.map((p) => p.getAttribute("stroke"))).toEqual(["red", "blue", "green"]);
    expect(paths[0].getAttribute("d")).toContain("L20 88");   // red segment 11 -> 12
    expect(paths[1].getAttribute("d")).toContain("L90 81");   // blue segment 18 -> 19
    expect(paths[2].getAttribute("d")).toBe("M90 81L100 80"); // retained right crossing endpoint
  });

  it("keeps full-history behavior for unsorted points", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    let xiCalls = 0;
    const m: CoordMapper = {
      xi: (i) => { xiCalls++; return i * 10; },
      y: (p) => p, W: 100, H: 100, i0: 0, i1: 9, barW: 10,
    };
    const g: GradLinePrim = {
      kind: "gradline", id: "unsorted",
      pts: [{ i: 0, p: 1 }, { i: 7, p: 2 }, { i: 3, p: 3 }, { i: 9, p: 4 }],
      colors: ["red", "red", "red", "red"],
    };
    renderPrims(svg, wrapBundle(g), m);
    expect(xiCalls).toBe(4);
  });
});

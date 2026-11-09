// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineSeries, type LineSeriesProps, type Series } from "../../components/fin/FinCharts";
import { workspaceCurve } from "../intelligenceWorkspaceView";

function renderLine(props: LineSeriesProps): HTMLDivElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(LineSeries, {
    vw: 400, height: 200, noLegend: true, ...props,
  }));
  return host;
}

function hitCenters(host: HTMLDivElement): number[] {
  return Array.from(host.querySelectorAll("rect.fin-hitcol"), element =>
    Number(element.getAttribute("x")) + Number(element.getAttribute("width")) / 2);
}

function lines(host: HTMLDivElement, stroke?: string): SVGPolylineElement[] {
  return Array.from(host.querySelectorAll<SVGPolylineElement>("polyline.fin-line"))
    .filter(element => stroke === undefined || element.getAttribute("stroke") === stroke);
}

function points(line: SVGPolylineElement): number[][] {
  const raw = line.getAttribute("points")?.trim();
  expect(raw).toBeTruthy();
  return raw!.split(/\s+/).map(point => point.split(",").map(Number));
}

function expectRuns(host: HTMLDivElement, slots: number[][], stroke?: string): void {
  const actual = lines(host, stroke);
  const centers = hitCenters(host);
  expect(actual).toHaveLength(slots.length);
  actual.forEach((line, run) => {
    const actualPoints = points(line);
    expect(actualPoints).toHaveLength(slots[run].length);
    actualPoints.forEach(([x, y], index) => {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeCloseTo(centers[slots[run][index]], 8);
    });
  });
}

const labels = ["Jan 1", "Jan 2", "Jan 3", "Jan 4", "Jan 5"];
const color = "#123456";

describe("LineSeries preserves source gaps in rendered SVG", () => {
  it("renders projected producer equity as separate original-index runs", () => {
    const raw = {
      status: "ok",
      equity: {
        t: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"],
        v: [100, 101, null, 104, 105],
      },
    };
    const before = JSON.stringify(raw);
    const curve = workspaceCurve(raw);
    expect(curve).not.toBeNull();
    const host = renderLine({
      labels: curve!.dates,
      series: [{ name: "Strategy equity", values: curve!.values, color }],
      includeZero: false, refLine: curve!.values[0],
    });
    expectRuns(host, [[0, 1], [3, 4]], color);
    expect(hitCenters(host)).toHaveLength(5);
    const reference = host.querySelector("line.fin-refline");
    expect(reference).not.toBeNull();
    expect(Number(reference!.getAttribute("y1"))).toBeCloseTo(points(lines(host)[0])[0][1], 8);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(0);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("breaks at consecutive null, undefined and nonfinite slots without compressing x", () => {
    const values = [null, 100, 101, undefined, NaN, Infinity, 105, 106, null];
    const host = renderLine({
      labels: values.map((_, index) => String(index)),
      series: [{ name: "Equity", values }],
    });
    expectRuns(host, [[1, 2], [6, 7]]);
    expect(hitCenters(host)).toHaveLength(values.length);
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("treats a sparse array slot as a gap", () => {
    const values = new Array<number | null>(5);
    values[0] = 100; values[1] = 101; values[3] = 104; values[4] = 105;
    const host = renderLine({ labels, series: [{ name: "Equity", values }] });
    expectRuns(host, [[0, 1], [3, 4]]);
  });

  it("keeps numeric zero as a real observation on both sides of a gap", () => {
    const host = renderLine({ labels, series: [{ name: "Equity", values: [0, 1, null, 0, -1] }] });
    expectRuns(host, [[0, 1], [3, 4]]);
  });

  it.each([0, "Equity"])("keeps contiguous geometry and dotted selection by %s", dotted => {
    const host = renderLine({
      labels, series: [{ name: "Equity", values: [0, 1, 2, 3, 4], color }],
      dotted: typeof dotted === "number" ? [dotted] : [dotted],
      markers: true,
    });
    expectRuns(host, [[0, 1, 2, 3, 4]], color);
    expect(lines(host)[0].classList.contains("fin-line-dotted")).toBe(true);
    expect(lines(host)[0].getAttribute("fill")).toBe("none");
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(5);
  });

  it("keeps independent run boundaries, colors, and dotted styles for multiple series", () => {
    const series: Series[] = [
      { name: "A", values: [1, 2, null, 4, 5], color: "#111111" },
      { name: "B", values: [1, null, 3, 4, null], color: "#222222" },
    ];
    const host = renderLine({ labels, series, dotted: ["B"], markers: true });
    expectRuns(host, [[0, 1], [3, 4]], "#111111");
    expectRuns(host, [[0], [2, 3]], "#222222");
    expect(lines(host, "#111111").every(line => !line.classList.contains("fin-line-dotted"))).toBe(true);
    expect(lines(host, "#222222").every(line => line.classList.contains("fin-line-dotted"))).toBe(true);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(7);
  });

  it.each([undefined, false, true])("keeps isolated observations visible with markers %s", markers => {
    const host = renderLine({ labels, series: [{ name: "Equity", values: [1, null, 3, null, 5] }], markers });
    expectRuns(host, [[0], [2], [4]]);
    const nodes = Array.from(host.querySelectorAll("circle.fin-node"));
    const centers = hitCenters(host);
    expect(nodes).toHaveLength(3);
    nodes.forEach((node, index) => {
      expect(Number(node.getAttribute("cx"))).toBeCloseTo(centers[index * 2], 8);
      expect(Number.isFinite(Number(node.getAttribute("cy")))).toBe(true);
      expect(Number(node.getAttribute("r"))).toBeGreaterThan(0);
    });
  });

  it("shows a lone observation with the default marker setting", () => {
    const host = renderLine({ labels: ["Jan 1"], series: [{ name: "Equity", values: [1] }] });
    expectRuns(host, [[0]]);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(1);
  });

  it("adds a singleton marker without marking a contiguous run", () => {
    const host = renderLine({ labels, series: [{ name: "Equity", values: [1, null, 3, 4, 5] }] });
    expectRuns(host, [[0], [2, 3, 4]]);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(1);
  });

  it("keeps the empty placeholder when no valid numeric observation exists", () => {
    const host = renderLine({ labels: ["A", "B", "C"], series: [{ name: "Equity", values: [null, NaN, Infinity] }] });
    expect(host.querySelector(".fin-empty")?.textContent).toBe("No data");
    expect(lines(host)).toHaveLength(0);
    expect(host.querySelector("svg")).toBeNull();
  });

  it("breaks before an existing source slot without shifting any expiry position", () => {
    const host = renderLine({
      labels, series: [{ name: "IV", values: [30, 31, 32, 33, 34] }],
      breakBefore: [false, false, true, false, false],
    });
    expectRuns(host, [[0, 1], [2, 3, 4]]);
    expect(hitCenters(host)).toHaveLength(5);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(0);
  });

  it("keeps all observations visible when source ambiguity withholds every connection", () => {
    const host = renderLine({
      labels, series: [{ name: "IV", values: [30, 31, 32, 33, 34] }],
      breakBefore: [false, true, true, true, true],
    });
    expectRuns(host, [[0], [1], [2], [3], [4]]);
    expect(hitCenters(host)).toHaveLength(5);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(5);
  });

  it("combines explicit source boundaries and nonfinite observations", () => {
    const host = renderLine({
      labels, series: [{ name: "IV", values: [30, null, 32, 33, 34] }],
      breakBefore: [false, false, false, true, false],
    });
    expectRuns(host, [[0], [2], [3, 4]]);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(2);
  });

  it("preserves zero-valued isolated points with source boundaries", () => {
    const host = renderLine({
      labels: ["2026-11-06", "2026-11-27"], series: [{ name: "IV", values: [0, 0] }],
      breakBefore: [false, true],
    });
    expectRuns(host, [[0], [1]]);
    expect(host.querySelectorAll("circle.fin-node")).toHaveLength(2);
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});

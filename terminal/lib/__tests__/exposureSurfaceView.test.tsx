// @vitest-environment jsdom
/**
 * ExposureSurface view tests — mounts the surface with react-dom/client
 * (jsdom). @testing-library/react is not in the supplied closure (see
 * heatmapCapDisclosure.test.tsx), so elements are queried and events
 * dispatched directly, like the repo's other component tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, type QualifiedProjection } from "../exposureMapProjection";
import ExposureSurface from "@/components/exposure-map/ExposureSurface";

const now = Date.parse("2026-10-19T20:00:00Z");
const SESSION = "2026-10-15";
const EXPIRIES = ["2026-10-16", "2026-10-23"];
const STRIKES = [100, 103];
const NULL_CELL = { net: null, gross: null, known_net: null, known_gross: null, qualified: 0, missing: 2, status: "unavailable" };

const raw = (vannaLocked = false): typeof producer => {
  const base = structuredClone(producer);
  const proto = base.cells[0]!;
  base.cells = EXPIRIES.flatMap((expiry, e) => STRIKES.map((strike, s) => {
    const cell = structuredClone(proto);
    cell.expiry = expiry;
    cell.economic_expiry_at = `${expiry}T20:00:00Z`;
    cell.strike = strike;
    const net = (s % 2 === 0 ? 1 : -1) * strike * 1e6 * (e + 1);
    cell.gamma = { ...cell.gamma, net, gross: Math.abs(net) * 2, known_net: net, known_gross: Math.abs(net) * 2 };
    if (strike === 103 && expiry === "2026-10-23") cell.gamma = { ...cell.gamma, ...NULL_CELL } as unknown as typeof cell.gamma;
    if (vannaLocked) cell.vanna = { ...cell.vanna, ...NULL_CELL } as unknown as typeof cell.vanna;
    return cell;
  }));
  base.cell_count = base.cells.length;
  return base;
};
const parse = (p: unknown): QualifiedProjection => qualifiedExposureProjection(p, "SPY", SESSION, now)!;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
const mount = (props: Partial<Parameters<typeof ExposureSurface>[0]> = {}) => {
  act(() => {
    root.render(<ExposureSurface projection={null} lens={{ kind: "all" }} referenceSpot={100} lang="en" now={now} {...props} />);
  });
};
const section = () => document.querySelector<HTMLElement>("[data-surface-status]")!;
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

describe("ExposureSurface view", () => {
  const projection = parse(raw());
  it("renders ready with one prism per finite cell, legend and footer", () => {
    mount({ projection });
    expect(section().getAttribute("data-surface-status")).toBe("ready");
    expect(section().getAttribute("data-surface-identity")).toBe("provider_observed");
    // 4 cells in the window, one withholds gamma: 3 prisms, 1 dotted absence.
    expect(document.querySelectorAll("[data-surface-cell]")).toHaveLength(3);
    expect(document.querySelectorAll("[data-tier='u']")).toHaveLength(1);
    expect(document.querySelector("[data-testid=surface-window-line]")?.textContent).toContain("4 cells of 4");
    expect(document.body.textContent).toContain("NET GAMMA $M · CELL");
    expect(document.body.textContent).toContain("Nothing is smoothed; clipping the window never changes a cell.");
    // The withheld cell is never drawn as a zero column.
    expect(document.querySelector("[data-testid=surface-field]")!.textContent ?? "").not.toMatch(/(^|[^0-9])0M/);
  });
  it("seeds the dominant cell label and moves it on prism click", () => {
    mount({ projection });
    expect(document.querySelector("[data-testid=surface-focus-label]")?.textContent).toContain("100 × Oct 23 · +200M");
    const target = [...document.querySelectorAll("[data-surface-cell]")].find((p) => p.getAttribute("data-strike") === "103")!;
    click(target);
    expect(document.querySelector("[data-testid=surface-inspector] h3")?.textContent).toContain("103");
    expect(document.querySelector("[data-testid=surface-focus-label]")?.textContent).toContain("103 × Oct 16");
    expect(document.querySelector("[data-testid=surface-pill]")?.textContent).toContain("103");
  });
  it("rotates 0 → 90 and switches the legend eyebrow on Gross", () => {
    mount({ projection });
    expect(section().getAttribute("data-surface-rotation")).toBe("0");
    click(button("Rotate ⟳"));
    expect(section().getAttribute("data-surface-rotation")).toBe("90");
    click(button("Gross"));
    expect(section().getAttribute("data-surface-mode")).toBe("gross");
    expect(document.body.textContent).toContain("GROSS GAMMA $M · CELL");
  });
  it("toggles the reference-spot plane", () => {
    mount({ projection });
    expect(document.querySelector("[data-testid=surface-spot-plane]")).not.toBeNull();
    click(button("Spot plane"));
    expect(document.querySelector("[data-testid=surface-spot-plane]")).toBeNull();
  });
  it("shows the Vanna · locked chip only when vanna is withheld", () => {
    mount({ projection });
    expect(document.body.textContent).not.toContain("Vanna · locked");
    mount({ projection: parse(raw(true)) });
    expect(document.body.textContent).toContain("Vanna · locked");
    expect(document.body.textContent).toContain("not drawn as zero");
  });
  it("reports no-projection and empty-window without ever going blank", () => {
    mount({ projection: null });
    expect(section().getAttribute("data-surface-status")).toBe("no-projection");
    expect(document.body.textContent).toContain("No qualified projection for this session");
    mount({ projection, referenceSpot: 110 });
    expect(section().getAttribute("data-surface-status")).toBe("empty-window");
    expect(document.body.textContent).toContain("No cells inside ±4%");
    click(button("Widen window"));
    expect(section().getAttribute("data-surface-status")).toBe("ready");
  });
  it("renders the zh footer and never leaks raw enum values", () => {
    mount({ projection, lang: "zh" });
    expect(document.body.textContent).toContain("不做任何平滑");
    expect(document.body.textContent).toContain("柱高是 10月15日 投影中该单元的净 Gamma");
    for (const text of [document.body.textContent ?? "", ""]) {
      expect(text).not.toContain("modeled_exposure");
      expect(text).not.toContain("provider_observed");
      expect(text).not.toContain("provider_approximation");
    }
  });
});

describe("ExposureSurface viewport placement", () => {
  it.each([240, 390, 720])("keeps real plotted faces inside a measured %ipx field", (width) => {
    // The exact two-expiry/one-strike shape that failed the real handoff
    // browser cases. Width measurement is supplied here; hit testing remains
    // the responsibility of the unforced Playwright interaction.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
    const source = raw();
    source.cells = source.cells.filter((cell) => cell.strike === 100);
    source.cell_count = source.cells.length;
    mount({ projection: parse(source) });
    const assertContained = () => {
      const svg = document.querySelector<SVGSVGElement>("[data-testid=surface-field]")!;
      const [x, y, w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      expect([x, y, w]).toEqual([0, 0, width]);
      expect(Number(svg.getAttribute("width"))).toBe(width);
      expect(Number(svg.getAttribute("height"))).toBe(h);
      const points = [...svg.querySelectorAll("polygon")].flatMap((polygon) =>
        polygon.getAttribute("points")!.trim().split(/\s+/).map((pair) => pair.split(",").map(Number)));
      for (const line of svg.querySelectorAll("line")) {
        points.push([Number(line.getAttribute("x1")), Number(line.getAttribute("y1"))],
          [Number(line.getAttribute("x2")), Number(line.getAttribute("y2"))]);
      }
      expect(svg.querySelectorAll("[data-surface-cell]")).toHaveLength(2);
      expect(points.length).toBeGreaterThan(24);
      for (const [px, py] of points) {
        expect(Number.isFinite(px) && Number.isFinite(py)).toBe(true);
        expect(px).toBeGreaterThanOrEqual(0);
        expect(px).toBeLessThanOrEqual(w!);
        expect(py).toBeGreaterThan(16); // clear of the fixed corner caption
        expect(py).toBeLessThan(h! - 14); // room for the axis ticks
      }
      const label = svg.querySelector("[data-testid=surface-focus-label] rect")!;
      expect(Number(label.getAttribute("y"))).toBeGreaterThanOrEqual(0);
      expect(document.querySelector("[data-testid=surface-inspector]")?.textContent).toContain("+200M");
      expect(document.querySelector("[data-testid=surface-inspector]")?.textContent).toContain("400M");
    };
    for (const mode of ["Net", "Gross", "|Net|"]) {
      click(button(mode));
      for (let rotation = 0; rotation < 4; rotation++) {
        for (let elevation = 0; elevation < 4; elevation++) {
          assertContained();
          click([...document.querySelectorAll("button")].find((item) => item.textContent?.includes("°"))!);
        }
        click(button("Rotate ⟳"));
      }
    }
  });
});

it("keeps the selected edge-cell label visible without shifting the plotted values", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240);
  const source = raw();
  const proto = source.cells[0]!;
  source.cells = EXPIRIES.flatMap((expiry, e) => Array.from({ length: 9 }, (_, s) => {
    const strike = 96 + s, net = strike * 1e6 * (e + 1);
    return { ...structuredClone(proto), expiry, strike, economic_expiry_at: `${expiry}T20:00:00Z`,
      gamma: { ...proto.gamma, net, gross: net * 2, known_net: net, known_gross: net * 2 } };
  }));
  source.cell_count = source.cells.length;
  mount({ projection: parse(source) });
  const face = document.querySelector('[data-surface-cell][data-strike="96"][data-expiry="2026-10-16"]')!;
  const before = face.querySelector("polygon")!.getAttribute("points");
  click(face);
  expect(face.querySelector("polygon")!.getAttribute("points")).toBe(before);
  const label = document.querySelector("[data-testid=surface-focus-label] rect")!;
  const x = Number(label.getAttribute("x")), width = Number(label.getAttribute("width"));
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x + width).toBeLessThanOrEqual(240);
  expect(document.querySelector("[data-testid=surface-focus-label]")?.textContent).toContain("96 × Oct 16 · +96M");
});

// @vitest-environment jsdom
/**
 * ExposureSurface view tests — mounts the surface with react-dom/client
 * (jsdom). @testing-library/react is not in the supplied closure (see
 * heatmapCapDisclosure.test.tsx), so elements are queried and events
 * dispatched directly, like the repo's other component tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, type QualifiedProjection } from "../exposureMapProjection";
import ExposureSurface from "@/components/exposure-map/ExposureSurface";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const pick = (select: HTMLSelectElement, value: string) => act(() => {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
const row = (strike: number, expiry: string) => document.querySelector<HTMLElement>(`[data-exact-cell][data-strike='${strike}'][data-expiry='${expiry}']`)!;
const exactView = () => click(button("Exact 2D values"));
const inspectorText = () => document.querySelector("[data-testid=surface-inspector]")?.textContent;

describe("ExposureSurface exact cells and selection identity", () => {
  it("offers every displayed cell including unavailable gamma, with full dates and native buttons", () => {
    mount({ projection: parse(raw()) });
    exactView();
    expect(document.querySelectorAll("[data-exact-cell]")).toHaveLength(4);
    expect(row(103, "2026-10-23").getAttribute("data-value")).toBe("unavailable");
    expect(row(103, "2026-10-23").textContent).toContain("unavailable");
    const target = row(103, "2026-10-23").querySelector<HTMLButtonElement>("button")!;
    expect(target.disabled).toBe(false);
    expect(target.getAttribute("aria-label")).toBe("Inspect strike 103, expiry 2026-10-23");
    click(target);
    expect(target.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-testid=surface-exact-selected-value]")?.textContent).toBe("—");
    click(button("Go to cell details"));
    expect(document.activeElement).toBe(document.querySelector("[data-testid=surface-inspector]"));
    click(button("Back to selected cell"));
    expect(document.activeElement).toBe(target);
    click(button("3D surface"));
    expect(section().getAttribute("data-selection-state")).toBe("selected");
    expect(inspectorText()).toContain("103 × 2026-10-23");
  });

  it("keeps tiny nonzero and genuine zero distinct without rounding exact values", () => {
    const projection = structuredClone(parse(raw()));
    projection.cells[0]!.gamma.net = 1;
    projection.cells[0]!.gamma.gross = 2;
    projection.cells[1]!.gamma.net = 0;
    projection.cells[1]!.gamma.gross = 0;
    mount({ projection }); exactView();
    expect(row(100, "2026-10-16").textContent).toContain("+0.000001");
    expect(row(103, "2026-10-16").getAttribute("data-value")).toBe("0");
    expect(row(103, "2026-10-16").textContent).not.toContain("unavailable");
    click(row(100, "2026-10-16").querySelector("button")!);
    expect(document.querySelector("[data-testid=surface-exact-selected-value]")?.textContent).toBe("+0.000001");
    expect(inspectorText()).toContain("$M per +1% spot");
  });

  it("retains a chosen coordinate across presentation and metric changes; abs uses absolute net", () => {
    const pins: unknown[] = [], opens: unknown[] = [];
    mount({ projection: parse(raw()), onPinCell: c => pins.push(c), onOpenInMap: c => opens.push(c) });
    exactView(); click(row(103, "2026-10-16").querySelector("button")!);
    for (const [metric, value] of [["Gross", "206"], ["|Net|", "103"], ["Net", "-103"]]) {
      click(button(metric!));
      expect(row(103, "2026-10-16").getAttribute("data-value")).toBe(value);
      expect(document.querySelector("[data-testid=surface-exact-selected-value]")?.textContent).toBe(value);
      expect(inspectorText()).toContain("103 × 2026-10-16");
    }
    click(button("3D surface"));
    expect(document.querySelector("[data-testid=surface-focus-label]")?.textContent).toContain("103 × Oct 16");
    click(button("Pin strike 103")); click(button("Open strike in Exposure ↗"));
    expect(pins).toEqual([{ strike: 103, expiry: "2026-10-16" }]);
    expect(opens).toEqual(pins);
  });

  it("retains a crop-hidden selection without a substitute or action against another cell", () => {
    mount({ projection: parse(raw()), onPinCell: () => { throw new Error("Must not expose a replacement action"); } });
    exactView(); click(row(103, "2026-10-16").querySelector("button")!);
    pick(document.querySelectorAll("select")[0]!, "2");
    expect(section().getAttribute("data-selection-state")).toBe("outside-window");
    expect(document.querySelector("[data-testid=surface-inspector]")).toBeNull();
    expect(document.querySelector("[data-testid=surface-selection-status]")?.textContent).toContain("103 × 2026-10-16");
    expect(document.querySelector("[data-testid=surface-pill]")?.textContent).toBe("103 × 2026-10-16");
    click(button("Restore selection window"));
    expect(section().getAttribute("data-selection-state")).toBe("selected");
    expect(inspectorText()).toContain("103 × 2026-10-16");
  });

  it("restores a selected expiry after reducing the expiry cap", () => {
    const projection = structuredClone(parse(raw()));
    projection.cells = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(projection.cells[0]!), expiry: `2026-11-${String(i + 1).padStart(2, "0")}` }));
    mount({ projection }); exactView();
    click(row(100, "2026-11-06").querySelector("button")!);
    pick(document.querySelectorAll("select")[1]!, "5");
    expect(section().getAttribute("data-selection-state")).toBe("outside-window");
    expect(document.querySelectorAll("[data-exact-cell]")).toHaveLength(5);
    click(button("Restore selection window"));
    expect(row(100, "2026-11-06").querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("distinguishes lens exclusion from a crop and restores the same cell when the lens returns", () => {
    const projection = parse(raw());
    mount({ projection }); exactView(); click(row(103, "2026-10-16").querySelector("button")!);
    mount({ projection, lens: { kind: "next-live" } });
    expect(section().getAttribute("data-selection-state")).toBe("outside-lens");
    expect(document.querySelector("[data-testid=surface-inspector]")).toBeNull();
    mount({ projection });
    expect(inspectorText()).toContain("103 × 2026-10-16");
  });

  it.each([
    ["root", (p: QualifiedProjection) => { p.root = "QQQ"; }],
    ["snapshot", (p: QualifiedProjection) => { p.source_snapshot_ref = "different-source"; }],
    ["session", (p: QualifiedProjection) => { p.clocks.source_session = "2026-10-16"; }],
    ["population", (p: QualifiedProjection) => { p.population.id = "different-population"; }],
    ["cell population", (p: QualifiedProjection) => { p.cells[1]!.population_id = "different-cell-population"; }],
  ] as const)("fences a selected coordinate when its %s changes", (_label, modify) => {
    const projection = parse(raw()); mount({ projection }); exactView();
    click(row(103, "2026-10-16").querySelector("button")!);
    const next = structuredClone(projection); modify(next);
    mount({ projection: next });
    expect(section().getAttribute("data-selection-state")).toBe("source-changed");
    expect(document.querySelector("[data-testid=surface-inspector]")).toBeNull();
    expect(document.querySelector("[data-testid=surface-selection-status]")?.textContent).toContain("Source identity changed");
    click(button("Inspect largest visible cell"));
    expect(section().getAttribute("data-selection-state")).toBe("selected");
    expect(inspectorText()).toContain("100 × 2026-10-23");
  });

  it("retains selection during source absence and names a coordinate removed from the same source", () => {
    const projection = parse(raw()); mount({ projection }); exactView();
    click(row(103, "2026-10-16").querySelector("button")!);
    mount({ projection: null });
    expect(section().getAttribute("data-selection-state")).toBe("source-unavailable");
    mount({ projection });
    expect(inspectorText()).toContain("103 × 2026-10-16");
    mount({ projection: { ...projection, cells: projection.cells.filter(c => !(c.strike === 103 && c.expiry === "2026-10-16")) } });
    expect(section().getAttribute("data-selection-state")).toBe("missing-cell");
    expect(document.querySelector("[data-testid=surface-inspector]")).toBeNull();
  });

  it("does not substitute a dominant cell for an externally requested hidden coordinate", () => {
    mount({ projection: parse(raw()), focusCell: { strike: 103, expiry: "2026-10-16" }, referenceSpot: 98 });
    expect(section().getAttribute("data-selection-state")).toBe("outside-window");
    expect(document.querySelector("[data-testid=surface-inspector]")).toBeNull();
  });

  it("retains source clocks and complete snapshot identity in translated exact view", () => {
    const projection = parse(raw()); mount({ projection, lang: "zh" });
    click(button("精确 2D 数值"));
    expect(document.body.textContent).toContain("2026-10-15");
    expect(document.body.textContent).toContain(projection.source_snapshot_ref);
    expect(document.body.textContent).toContain(projection.clocks.available_at);
    expect(document.body.textContent).toContain("来源可用时间");
    expect(document.body.textContent).toContain("并非全市场覆盖");
  });
});


it("does not mislabel complete dated gamma as partial gamma when joint Greeks are incomplete", () => {
  const projection = structuredClone(parse(raw()));
  projection.kind = "dated_provider_approximation";
  projection.cells[0]!.joint.complete = false;
  mount({ projection }); exactView();
  const gammaRow = row(100, "2026-10-16");
  expect(gammaRow.getAttribute("data-value")).toBe("100");
  expect(gammaRow.textContent).toContain("Joint Greeks incomplete");
  expect(gammaRow.textContent).not.toContain("Partial coverage");
  click(gammaRow.querySelector("button")!);
  expect(inspectorText()).toContain("Provider approximation");
  expect(inspectorText()).toContain("Joint Greek coverage");
});


it("retains an admitted fractional strike exactly while outside the window", () => {
  const projection = structuredClone(parse(raw()));
  projection.cells[1]!.strike = 103.125;
  mount({ projection }); exactView();
  click(row(103.125, "2026-10-16").querySelector("button")!);
  pick(document.querySelectorAll("select")[0]!, "2");
  expect(document.querySelector("[data-testid=surface-pill]")?.textContent).toBe("103.125 × 2026-10-16");
  expect(document.querySelector("[data-testid=surface-selection-status]")?.textContent).toContain("103.125 × 2026-10-16");
});


it("fits every actual 3D prism inside the measured viewBox at every rotation and mode", () => {
  mount({ projection: parse(raw()) });
  for (const metric of ["Net", "Gross", "|Net|"]) {
    click(button(metric));
    for (let turn = 0; turn < 4; turn++) {
      const svg = document.querySelector<SVGElement>("[data-testid=surface-field]")!;
      const [, , width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
      for (const polygon of svg.querySelectorAll("[data-surface-cell] polygon")) {
        const points = polygon.getAttribute("points")!.split(" ").map(point => point.split(",").map(Number));
        for (const [x, y] of points) {
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(width!);
          expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(height!);
        }
      }
      click(button("Rotate ⟳"));
    }
  }
});


it.each([[0, 1e8], [1, 1e8], [1e-200, 1e200]])("keeps gross geometry usable for finite net %s / gross %s", (net, gross) => {
  const projection = structuredClone(parse(raw()));
  projection.cells = [projection.cells[0]!];
  projection.cells[0]!.gamma.net = net; projection.cells[0]!.gamma.gross = gross;
  mount({ projection }); click(button("Gross"));
  const polygons = [...document.querySelectorAll("[data-surface-cell] polygon")];
  const points = polygons.flatMap(polygon => polygon.getAttribute("points")!.split(" ").map(point => point.split(",").map(Number)));
  expect(points.every(point => point.every(Number.isFinite))).toBe(true);
  expect(Math.max(...points.map(p => p[0]!)) - Math.min(...points.map(p => p[0]!))).toBeGreaterThan(10);
  const face = polygons[0]!.getAttribute("points")!.split(" ").map(point => point.split(",").map(Number));
  expect(face[3]![1]! - face[0]![1]!).toBeGreaterThan(30);
  expect(document.querySelector("[data-testid=surface-height-reference]")?.textContent).toContain(String(gross / 1e6));
});

it("keeps the gross height reference fixed when the window excludes its largest cell", () => {
  const projection = structuredClone(parse(raw()));
  projection.cells[1]!.gamma.gross = 1e9;
  mount({ projection }); click(button("Gross"));
  const before = document.querySelector("[data-testid=surface-height-reference]")?.textContent;
  pick(document.querySelectorAll("select")[0]!, "2");
  expect(document.querySelector("[data-testid=surface-height-reference]")?.textContent).toBe(before);
  expect(before).toContain("1000M");
});

it.each([[100, "0.5"], [101, "0"], [99, "1"]])("places a single-strike spot plane correctly for spot %s", (spot, expectedRow) => {
  const projection = structuredClone(parse(raw())); projection.cells = [projection.cells[0]!];
  mount({ projection, referenceSpot: spot });
  expect(document.querySelector("[data-testid=surface-spot-plane]")?.getAttribute("data-row")).toBe(expectedRow);
});

it("shows continuous tier bounds for sub-million cells and names the zero reference", () => {
  const projection = structuredClone(parse(raw())); projection.cells = [projection.cells[0]!];
  projection.cells[0]!.gamma.net = 1e6;
  mount({ projection });
  const legend = document.querySelector("[data-testid=surface-legend]")!;
  expect(legend.textContent).toContain("≥ 0.7");
  expect(legend.textContent).toContain("0.45 – <0.7");
  expect(legend.textContent).not.toContain("1–0");
  const next = structuredClone(projection); next.cells[0]!.gamma.net = 0;
  mount({ projection: next });
  expect(legend.textContent).toContain("Net-book reference is zero");
});

it("removes floating-point noise only from legend labels and retains tiny bands", () => {
  const projection = structuredClone(parse(raw())); projection.cells = [projection.cells[0]!];
  projection.cells[0]!.gamma.net = 936e6;
  mount({ projection });
  const legend = document.querySelector("[data-testid=surface-legend]")!;
  expect(legend.textContent).toContain("≥ 655.2");
  expect(legend.textContent).not.toContain("655.1999999999999");
  expect(legend.textContent).toContain("Tier limits are rounded");
  const next = structuredClone(projection); next.cells[0]!.gamma.net = 0.00000123456789012345;
  mount({ projection: next }); click(button("Exact 2D values"));
  expect(document.querySelector("[data-testid=surface-exact-selected-value]")?.textContent).toBe("+" + String(next.cells[0]!.gamma.net / 1e6));
  expect(legend.textContent).toContain("8.64197523086e-13");
});


it("draws negative net below the same zero plane and positive net above it", () => {
  mount({ projection: parse(raw()) });
  for (const [strike, direction] of [[100, -1], [103, 1]]) {
    const face = document.querySelector(`[data-surface-cell][data-strike='${strike}'][data-expiry='2026-10-16'] polygon`)!;
    const points = face.getAttribute("points")!.split(" ").map(point => point.split(",").map(Number));
    expect(Math.sign(points[0]![1]! - points[3]![1]!)).toBe(direction);
  }
});

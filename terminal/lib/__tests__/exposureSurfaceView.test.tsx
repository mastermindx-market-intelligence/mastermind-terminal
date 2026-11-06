// @vitest-environment jsdom
/**
 * ExposureSurface view tests — mounts the surface with react-dom/client
 * (jsdom). @testing-library/react is not in the supplied closure (see
 * heatmapCapDisclosure.test.tsx), so elements are queried and events
 * dispatched directly, like the repo's other component tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const raw = (vannaLocked = false, mutate?: (base: typeof producer) => void): typeof producer => {
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
  mutate?.(base);
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
const press = (el: Element, key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(event); });
  return event.defaultPrevented;
};
// Real rendered coordinates: every polygon vertex, line endpoint and focus-rect
// corner in the SVG viewBox — the camera pads 20px, with 2px rounding slack.
const PAD = 18;
const geometry = () => {
  const svg = document.querySelector("[data-testid=surface-field]")!;
  const [, , w, h] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
  const coords: [number, number][] = [];
  for (const poly of svg.querySelectorAll("polygon")) {
    for (const pair of (poly.getAttribute("points") ?? "").trim().split(/\s+/)) {
      const [x, y] = pair.split(",").map(Number);
      coords.push([x, y]);
    }
  }
  for (const line of svg.querySelectorAll("line")) {
    coords.push([Number(line.getAttribute("x1")), Number(line.getAttribute("y1"))]);
    coords.push([Number(line.getAttribute("x2")), Number(line.getAttribute("y2"))]);
  }
  for (const rect of svg.querySelectorAll("rect")) {
    const x = Number(rect.getAttribute("x")), y = Number(rect.getAttribute("y"));
    coords.push([x, y], [x + Number(rect.getAttribute("width")), y + Number(rect.getAttribute("height"))]);
  }
  return { w, h, coords };
};
const expectFitted = () => {
  const { w, h, coords } = geometry();
  expect(w).toBeGreaterThan(0);
  expect(h).toBeGreaterThan(0);
  expect(coords.length).toBeGreaterThan(0);
  for (const [x, y] of coords) {
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(PAD);
    expect(x).toBeLessThanOrEqual(w - PAD);
    expect(y).toBeGreaterThanOrEqual(PAD);
    expect(y).toBeLessThanOrEqual(h - PAD);
  }
};
// The elevation control is the only enabled toolbar button outside the mode
// chips that is neither Rotate nor Spot plane.
const elevationButton = () => [...section().querySelectorAll("button")].filter((b) => !b.disabled
  && b.textContent !== "Rotate ⟳" && !["Net", "Gross", "Abs", "Spot plane"].includes(b.textContent ?? ""))[0]!;

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
  it("labels cells for assistive tech in the active language", () => {
    mount({ projection, lang: "zh" });
    const cell = [...document.querySelectorAll("[data-surface-cell]")].find((g) =>
      g.getAttribute("data-strike") === "103" && g.getAttribute("data-expiry") === "2026-10-16")!;
    expect(cell.getAttribute("aria-label")).toContain("103 × 10月16日 · −103M · 净 Gamma $M · 单元");
  });

  describe("rendered geometry — real coordinates in the SVG viewBox", () => {
    it("fits polygons, lines, plane and focus chip at every rotation × elevation", () => {
      mount({ projection });
      const elevation = elevationButton();
      for (let r = 0; r < 4; r++) {
        for (let e = 0; e < 4; e++) {
          expectFitted();
          click(elevation);
        }
        click(button("Rotate ⟳"));
      }
      expectFitted();
    });
    it("draws genuine gross columns when net cancels to zero and gross survives", () => {
      const cancelled = parse(raw(false, (p) => {
        const good = structuredClone((p.cells[0] as { gamma: Record<string, unknown> }).gamma);
        for (const c of p.cells as { gamma: Record<string, unknown> }[]) {
          c.gamma = { ...good, net: 0, known_net: 0, gross: 4e8, known_gross: 4e8 };
        }
      }));
      mount({ projection: cancelled });
      click(button("Gross"));
      const prisms = [...document.querySelectorAll("[data-surface-cell]")];
      expect(prisms).toHaveLength(4);
      // Column height is the top face's drop below the base's front corner —
      // a zero column still owns its floor footprint, so the bounding box lies.
      const dropOf = (g: Element) => {
        const polys = [...g.querySelectorAll("polygon")];
        const ysOf = (poly: Element) => (poly.getAttribute("points") ?? "").trim().split(/\s+/)
          .map((pair) => Number(pair.split(",")[1]));
        return Math.max(...polys.flatMap(ysOf)) - Math.max(...ysOf(polys[polys.length - 1]!));
      };
      for (const g of prisms) {
        expect(g.getAttribute("data-sign")).toBe("positive");
        expect(dropOf(g)).toBeGreaterThan(10);
      }
      expectFitted();
      // The same book in net mode is honestly flat: a known zero, not unknown.
      click(button("Net"));
      for (const g of document.querySelectorAll("[data-surface-cell]")) expect(dropOf(g)).toBeLessThan(0.5);
    });
    it("keeps the S2 desktop journey inside the field: dominant column, spot plane, rotation", () => {
      const s2 = parse(raw(false, (p) => {
        const proto = structuredClone(p.cells[0]!);
        const good = structuredClone((proto as unknown as { gamma: Record<string, unknown> }).gamma);
        p.cells = ([[103, "2026-10-23", 1e8, 1.5e8], [103, "2026-10-30", 2e8, 4e8],
          [98, "2026-10-23", -3e7, 4.5e7], [98, "2026-10-30", -6e7, 9e7]] as const).map(([strike, expiry, net, gross]) => {
          const cell = structuredClone(proto);
          cell.expiry = expiry;
          cell.economic_expiry_at = `${expiry}T20:00:00Z`;
          cell.strike = strike;
          cell.gamma = { ...good, net, known_net: net, gross, known_gross: gross } as unknown as typeof cell.gamma;
          return cell;
        });
        p.cell_count = p.cells.length;
      }));
      mount({ projection: s2, referenceSpot: 100 });
      expectFitted();
      const dominant = [...document.querySelectorAll("[data-surface-cell]")].find((g) =>
        g.getAttribute("data-strike") === "103" && g.getAttribute("data-expiry") === "2026-10-30")!;
      const polys = [...dominant.querySelectorAll("polygon")];
      const ysOf = (poly: Element) => (poly.getAttribute("points") ?? "").trim().split(/\s+/)
        .map((pair) => Number(pair.split(",")[1]));
      // The dominant +200M column genuinely rises above its footprint.
      expect(Math.max(...polys.flatMap(ysOf)) - Math.max(...ysOf(polys[polys.length - 1]!))).toBeGreaterThan(10);
      expect(document.querySelector("[data-testid=surface-spot-plane]")!.textContent).toContain("100.00");
      expect(document.querySelector("[data-testid=surface-pill]")?.textContent).toContain("103");
      // The cell-centre plane survives a quarter turn, still fully fitted.
      click(button("Rotate ⟳"));
      expect(document.querySelector("[data-testid=surface-spot-plane]")).not.toBeNull();
      expectFitted();
    });
  });

  describe("keyboard exact-cell selection", () => {
    it("makes finite cells pressable buttons; Enter and Space select; placeholders stay inert", () => {
      mount({ projection });
      const cells = [...document.querySelectorAll("[data-surface-cell]")];
      expect(cells).toHaveLength(3);
      for (const g of cells) {
        expect(g.getAttribute("role")).toBe("button");
        expect(g.getAttribute("tabindex")).toBe("0");
        expect(["true", "false"]).toContain(g.getAttribute("aria-pressed"));
        expect(g.getAttribute("aria-label")).toMatch(/ × .+ · /);
      }
      const pressed = cells.filter((g) => g.getAttribute("aria-pressed") === "true");
      expect(pressed).toHaveLength(1);
      expect(pressed[0]!.getAttribute("data-strike")).toBe("100"); // dominant seed
      const placeholder = document.querySelector("circle[data-tier='u']")!;
      expect(placeholder.getAttribute("tabindex")).toBeNull();
      expect(placeholder.getAttribute("role")).toBeNull();
      expect(placeholder.getAttribute("aria-label")).toBeNull();
      const target = cells.find((g) => g.getAttribute("data-strike") === "103" && g.getAttribute("data-expiry") === "2026-10-16")!;
      expect(target.getAttribute("aria-label")).toContain("103 × Oct 16 · −103M");
      expect(target.getAttribute("aria-label")).toContain("NET GAMMA $M · CELL");
      expect(press(target, "Enter")).toBe(true);
      expect(document.querySelector("[data-testid=surface-inspector] h3")?.textContent).toContain("103");
      expect(target.getAttribute("aria-pressed")).toBe("true");
      const other = cells.find((g) => g.getAttribute("data-strike") === "100" && g.getAttribute("data-expiry") === "2026-10-23")!;
      expect(press(other, " ")).toBe(true);
      expect(document.querySelector("[data-testid=surface-inspector] h3")?.textContent).toContain("100");
      expect(other.getAttribute("aria-pressed")).toBe("true");
      expect(target.getAttribute("aria-pressed")).toBe("false");
    });
    it("exposes the child buttons through the svg's group role", () => {
      mount({ projection });
      const svg = document.querySelector("[data-testid=surface-field]")!;
      expect(svg.getAttribute("role")).toBe("group");
      expect(svg.getAttribute("aria-label")).toBeTruthy();
      expect(svg.querySelectorAll('[role="button"]')).toHaveLength(3);
    });
  });

  it("paints prism signs from the parent g and never hides the focus chip", () => {
    // The suite runs from the terminal root (vitest config dir); the component
    // source next to it is the real painted CSS.
    const css = readFileSync(resolve(process.cwd(), "components/exposure-map/ExposureSurface.module.css"), "utf8");
    expect(css).toContain('.prism[data-sign="positive"] .faceTop');
    expect(css).toContain('.prism[data-sign="negative"] .faceRight');
    expect(css).not.toContain('.prism [data-sign="positive"]');
    expect(css).not.toContain('.prism [data-sign="negative"]');
    expect(css).toContain(".prism:focus-visible polygon");
    expect(css).not.toContain(".focusLabel{display:none");
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
        expect(py).toBeGreaterThanOrEqual(16); // inclusive camera padding above the floor
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

it("keeps the selected edge-cell label visible with one value-preserving camera", () => {
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
  const svg = document.querySelector<SVGSVGElement>("[data-testid=surface-field]")!;
  const points = (node: Element) => node.getAttribute("points")!.split(/\s+/).map(pair => {
    const [x, y] = pair.split(",").map(Number); return { x: x!, y: y! };
  });
  const capture = () => {
    const floor = [...svg.querySelectorAll('g[class*="floor"] line')].map(line => ({
      a: { x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")) },
      b: { x: Number(line.getAttribute("x2")), y: Number(line.getAttribute("y2")) },
    }));
    const strikes = [...new Set(source.cells.map(cell => cell.strike))].sort((a,b)=>b-a);
    const middle = (a: {x:number;y:number}, b: {x:number;y:number}) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const ticks = [...svg.querySelectorAll('g[class*="ticks"] text')].map(text => {
      const label=text.textContent!, strikeIndex=strikes.findIndex(strike=>String(strike)===label);
      const expiryIndex=EXPIRIES.findIndex(expiry=>`Oct ${Number(expiry.slice(-2))}`===label);
      // The floor supplies each label's world anchor independently of the
      // camera implementation. Fixed-size label offsets must remain fixed.
      const anchor=strikeIndex>=0 ? middle(floor[strikeIndex]!.b,floor[strikeIndex+1]!.b)
        : middle(floor[strikes.length+1+expiryIndex]!.b,floor[strikes.length+2+expiryIndex]!.b);
      expect(strikeIndex>=0||expiryIndex>=0).toBe(true);
      return {label,anchor,dx:Number(text.getAttribute("x"))-anchor.x,dy:Number(text.getAttribute("y"))-anchor.y};
    });
    const plane=svg.querySelector('[data-testid="surface-spot-plane"]')!;
    const spot=points(plane.querySelector("polygon")!)[2]!,spotText=plane.querySelector("text")!;
    return {floor:floor.flatMap(line=>[line.a,line.b]), polygons:[...svg.querySelectorAll("polygon")].flatMap(points),ticks,
      spot:{anchor:spot,dx:Number(spotText.getAttribute("x"))-spot.x,dy:Number(spotText.getAttribute("y"))-spot.y},
      labels:[...svg.querySelectorAll("[data-surface-cell]")].map(cell=>cell.getAttribute("aria-label")),
      labelHeight:Number(svg.querySelector('[data-testid="surface-focus-label"] rect')!.getAttribute("height"))};
  };
  const before=capture();
  click(face);
  const after=capture();
  expect(after.labels).toEqual(before.labels);
  expect(after.labelHeight).toBe(before.labelHeight);
  const lo=before.floor.reduce((best,p,i)=>p.x<before.floor[best]!.x?i:best,0);
  const hi=before.floor.reduce((best,p,i)=>p.x>before.floor[best]!.x?i:best,0);
  const scale=(after.floor[hi]!.x-after.floor[lo]!.x)/(before.floor[hi]!.x-before.floor[lo]!.x);
  const dx=after.floor[lo]!.x-scale*before.floor[lo]!.x,dy=after.floor[lo]!.y-scale*before.floor[lo]!.y;
  expect(scale).toBeGreaterThan(0);
  const transformed=(a:{x:number;y:number},b:{x:number;y:number},epsilon:number)=>{
    expect(Math.abs(b.x-(scale*a.x+dx))).toBeLessThanOrEqual(epsilon);
    expect(Math.abs(b.y-(scale*a.y+dy))).toBeLessThanOrEqual(epsilon);
  };
  expect(after.floor).toHaveLength(before.floor.length);
  before.floor.forEach((point,i)=>transformed(point,after.floor[i]!,1e-8));
  // poly() serializes to one decimal place: each coordinate rounds by at
  // most .05px, hence .05*(1+scale) bounds the before/after residual.
  const serializedEpsilon=.05*(1+Math.abs(scale))+1e-8;
  expect(after.polygons).toHaveLength(before.polygons.length);
  before.polygons.forEach((point,i)=>transformed(point,after.polygons[i]!,serializedEpsilon));
  transformed(before.spot.anchor,after.spot.anchor,serializedEpsilon);
  expect(Math.abs(after.spot.dx-before.spot.dx)).toBeLessThanOrEqual(.1+1e-8);
  expect(Math.abs(after.spot.dy-before.spot.dy)).toBeLessThanOrEqual(.1+1e-8);
  const sharedTicks=after.ticks.filter(tick=>before.ticks.some(old=>old.label===tick.label));
  expect(sharedTicks.length).toBeGreaterThan(0);
  for(const tick of sharedTicks){const old=before.ticks.find(old=>old.label===tick.label)!;
    transformed(old.anchor,tick.anchor,1e-8);expect(tick.dx).toBeCloseTo(old.dx,8);expect(tick.dy).toBeCloseTo(old.dy,8);}
  const label = document.querySelector("[data-testid=surface-focus-label] rect")!;
  const x = Number(label.getAttribute("x")), width = Number(label.getAttribute("width"));
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x + width).toBeLessThanOrEqual(240);
  expect(document.querySelector("[data-testid=surface-focus-label]")?.textContent).toContain("96 × Oct 16 · +96M");
});

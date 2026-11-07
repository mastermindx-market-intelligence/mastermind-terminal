import { describe, it, expect } from "vitest";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, type QualifiedProjection } from "../exposureMapProjection";
import { applySurfaceCamera, buildExposureSurface, daysToExpiry, fitSurfaceCamera, projectSurfacePoint,
  surfaceSpotRow, surfaceTier, tierBoundsMn, SURFACE_NO_BOX,
  type SurfaceSceneItem } from "../exposureSurface";

const now = Date.parse("2026-10-19T20:00:00Z");
const SESSION = "2026-10-15";
const EXPIRIES = ["2026-10-16", "2026-10-23", "2026-11-20"];
const STRIKES = [94, 97, 100, 103, 106];
const NULL_CELL = { net: null, gross: null, known_net: null, known_gross: null, qualified: 0, missing: 2, status: "unavailable" };
type Raw = typeof producer;
/** Loose view of the raw payload for mutation callbacks; the parse below
 * revalidates everything the loosening could touch. */
type LooseRaw = Omit<{ [K in keyof Raw]: Raw[K] extends object ? Record<string, unknown> : Raw[K] }, "cells">
  & { cells: Record<string, unknown>[]; valuation?: Record<string, unknown>; capabilities?: Record<string, unknown> };
const withNull = (metric: unknown): Record<string, unknown> => ({ ...(metric as Record<string, unknown>), ...NULL_CELL });

/** Synthetic multi-cell book cloned from the single-cell producer fixture;
 * every cell individually revalidates against the consumer contract. */
const raw = (changes: (p: LooseRaw) => void = () => {}): Raw => {
  const proto = producer.cells[0]!;
  const cells = EXPIRIES.flatMap((expiry, e) => STRIKES.map((strike, s) => {
    const cell = structuredClone(proto);
    cell.expiry = expiry;
    cell.economic_expiry_at = `${expiry}T20:00:00Z`;
    cell.strike = strike;
    const net = (s % 2 === 0 ? 1 : -1) * strike * 1000 * (e + 1);
    cell.gamma = { ...cell.gamma, net, gross: Math.abs(net) * 2, known_net: net, known_gross: Math.abs(net) * 2 };
    if (strike === 103 && expiry === "2026-10-23") cell.gamma = withNull(cell.gamma) as typeof cell.gamma;
    return cell;
  }));
  const base = { ...structuredClone(producer), cells, cell_count: cells.length } as unknown as LooseRaw;
  changes(base);
  return base as unknown as Raw;
};
const parse = (p: unknown): QualifiedProjection => qualifiedExposureProjection(p, "SPY", SESSION, now)!;
const lens = { kind: "all" } as const;
const opts = (over: Partial<Parameters<typeof buildExposureSurface>[1]> = {}): Parameters<typeof buildExposureSurface>[1] =>
  ({ lens, mode: "net", windowPct: 8, expiryCap: 9, referenceSpot: 100, ...over });
const find = (surface: ReturnType<typeof buildExposureSurface>, strike: number, expiry: string) =>
  surface.cells.find((c) => c.strike === strike && c.expiry === expiry)!;

describe("buildExposureSurface — exact cells, clipping law, full-lens nets", () => {
  const p = parse(raw());
  it("scales each shown cell's net and gross exactly, never rounding", () => {
    const surface = buildExposureSurface(p, opts());
    const proj = p.cells.find((c) => c.strike === 106 && c.expiry === "2026-11-20")!;
    expect(find(surface, 106, "2026-11-20").netMn).toBe(proj.gamma.net! / 1e6);
    expect(find(surface, 106, "2026-11-20").grossMn).toBe(proj.gamma.gross! / 1e6);
    expect(surface.totals.cellsShown).toBe(15);
    expect(surface.strikes).toEqual([106, 103, 100, 97, 94]);
    expect(surface.expiries).toEqual(EXPIRIES);
  });
  it("clips the window without changing any surviving cell's value or tier", () => {
    const wide = buildExposureSurface(p, opts({ windowPct: 8 }));
    const narrow = buildExposureSurface(p, opts({ windowPct: 2 }));
    expect(narrow.totals.cellsShown).toBe(3);
    for (const cell of narrow.cells) {
      const before = find(wide, cell.strike, cell.expiry);
      expect(cell.valueMn).toBe(before.valueMn);
      expect(cell.tier).toBe(before.tier);
      expect(cell.netMn).toBe(before.netMn);
    }
    expect(wide.bookMaxAbsMn).toBe(narrow.bookMaxAbsMn);
  });
  it("caps expiries to the nearest N by date", () => {
    const surface = buildExposureSurface(p, opts({ expiryCap: 2 }));
    expect(surface.expiries).toEqual(["2026-10-16", "2026-10-23"]);
    expect(surface.totals.expiriesShown).toBe(2);
    expect(surface.cells.every((c) => surface.expiries.includes(c.expiry))).toBe(true);
  });
  it("sums strike and expiry nets over the FULL lens set; unknown is not zero", () => {
    const surface = buildExposureSurface(p, opts({ windowPct: 2, expiryCap: 1 }));
    const strikeNet = EXPIRIES.reduce<number | null>((a, e) => {
      const net = p.cells.find((c) => c.strike === 100 && c.expiry === e)!.gamma.net;
      return net == null ? null : a! + net / 1e6;
    }, 0);
    expect(surface.strikeNetMn.get(100)).toBe(strikeNet);
    const expiryNet = STRIKES.reduce<number | null>((acc, s) => {
      const net = p.cells.find((c) => c.strike === s && c.expiry === "2026-10-16")!.gamma.net;
      return net == null ? null : acc! + net / 1e6;
    }, 0);
    expect(surface.expiryNetMn.get("2026-10-16")).toBe(expiryNet);
    // The one null member nulls its own strike and expiry nets even though the
    // window and cap would hide the cell itself.
    expect(surface.strikeNetMn.get(103)).toBeNull();
    expect(surface.expiryNetMn.get("2026-10-23")).toBeNull();
  });
  it("modes: gross is unsigned, abs is |net|, tiers stay book-relative", () => {
    const gross = buildExposureSurface(p, opts({ mode: "gross" }));
    const abs = buildExposureSurface(p, opts({ mode: "abs" }));
    const cell = find(gross, 106, "2026-11-20");
    expect(cell.valueMn).toBe(cell.grossMn);
    expect(find(abs, 106, "2026-11-20").valueMn).toBe(Math.abs(find(abs, 106, "2026-11-20").netMn!));
    expect(cell.tier).toBe(surfaceTier(cell.grossMn, gross.bookMaxAbsMn));
  });
});

describe("surfaceTier and tierBoundsMn — the book-relative ladder", () => {
  it("splits at the exact thresholds", () => {
    expect(surfaceTier(280, 400)).toBe(5);
    expect(surfaceTier(279.9, 400)).toBe(4);
    expect(surfaceTier(180, 400)).toBe(4);
    expect(surfaceTier(16, 400)).toBe(1);
    expect(surfaceTier(15.9, 400)).toBe(0);
    expect(surfaceTier(null, 400)).toBe("u");
    expect(surfaceTier(5, 0)).toBe(0);
  });
  it("prints the five $mn thresholds the legend shows", () => {
    expect(tierBoundsMn(400)).toEqual([280, 180, 100, 48, 16]);
  });
});

describe("unavailable metrics and matched-population changes", () => {
  it("lists vanna and charm only when every cell withholds them", () => {
    expect(buildExposureSurface(parse(raw()), opts()).unavailable).toEqual([]);
    const noVanna = parse(raw((p) => { for (const c of p.cells) c.vanna = withNull(c.vanna); }));
    expect(buildExposureSurface(noVanna, opts()).unavailable).toEqual(["vanna"]);
    const neither = parse(raw((p) => {
      for (const c of p.cells) { c.vanna = withNull(c.vanna); c.charm = withNull(c.charm); }
    }));
    expect(buildExposureSurface(neither, opts()).unavailable).toEqual(["vanna", "charm"]);
  });
  it("computes changeMn only against an equal population id", () => {
    const current = parse(raw());
    const prior = parse(raw((p) => {
      for (const c of p.cells) {
        const gamma = c.gamma as Record<string, unknown>;
        if (gamma.net != null) { gamma.net = Number(gamma.net) * 1.1; gamma.known_net = gamma.net; }
      }
    }));
    const surface = buildExposureSurface(current, opts({ prior }));
    const priorNet = find(buildExposureSurface(prior, opts()), 106, "2026-11-20").netMn!;
    expect(find(surface, 106, "2026-11-20").changeMn).toBeCloseTo(find(surface, 106, "2026-11-20").netMn! - priorNet, 12);
    expect(surface.priorSession).toBe(SESSION);
    const drifted = parse(raw((p) => { p.cells[0]!.population_id = "f".repeat(64); }));
    expect(buildExposureSurface(drifted, opts({ prior })).cells.find((c) => c.strike === 94)!.changeMn).toBeNull();
    expect(buildExposureSurface(current, opts()).cells.every((c) => c.changeMn == null)).toBe(true);
  });
});

describe("projectSurfacePoint — isometric invariants", () => {
  const frame = (rotation: 0 | 90 | 180 | 270, elevationDeg = 30) =>
    ({ rotation, elevationDeg, cellW: 10, cellD: 8, heightPx: 100 });
  it("mirrors x under a 180° turn", () => {
    const flat = projectSurfacePoint(2, 3, 40, frame(0));
    const turned = projectSurfacePoint(2, 3, 40, frame(180));
    expect(turned.x).toBeCloseTo(-flat.x, 12);
  });
  it("drops the height term at 90° elevation", () => {
    const raised = projectSurfacePoint(2, 3, 40, frame(0, 90));
    expect(raised.y).toBeCloseTo(projectSurfacePoint(2, 3, 0, frame(0, 90)).y, 12);
    expect(projectSurfacePoint(2, 3, 40, frame(0, 30)).y)
      .toBeLessThan(projectSurfacePoint(2, 3, 0, frame(0, 30)).y);
  });
  it("depth is the painter's key: larger is nearer", () => {
    expect(projectSurfacePoint(3, 3, 0, frame(0)).depth).toBeGreaterThan(projectSurfacePoint(0, 0, 0, frame(0)).depth);
    expect(projectSurfacePoint(2, 5, 90, frame(0)).depth).toBe(7);
  });
});

describe("daysToExpiry and the dated identity", () => {
  it("counts whole days from the session", () => {
    expect(daysToExpiry("2026-10-17", "2026-10-16")).toBe(1);
    expect(daysToExpiry("2026-10-16", "2026-10-16")).toBe(0);
    expect(daysToExpiry("2026-10-17", null)).toBeNull();
    expect(daysToExpiry("not-a-date", "2026-10-16")).toBeNull();
  });
  it("draws a dated provider approximation and labels its identity", () => {
    const dated = parse(raw((p) => {
      p.kind = "dated_provider_approximation";
      p.valuation = { basis: "provider_eod_approximation", source_session: SESSION, observation_clock: "session_only",
        methodology_ref: "https://www.thetadata.net/docs/Articles/Data-And-Requests/Option-Greeks.html",
        endpoint: "/v3/option/history/greeks/eod", requested_version: "1", serving_build: null,
        tenor_policy: "provider_eod_whole_days_0dte_0.15" };
      p.capabilities = { dated_cells: true, instantaneous: false, next_live: false, joint_scenario: false, repricing: false, historical_pit: false };
      p.clocks = { ...p.clocks, option_observed_at: null, underlying_observed_at: null };
      for (const c of p.cells) {
        c.vanna = withNull(c.vanna);
        c.charm = withNull(c.charm);
        c.joint = { ...(c.joint as Record<string, unknown>), complete: false, qualified: 0, missing: 2 };
      }
    }));
    const surface = buildExposureSurface(dated, opts());
    expect(surface.identity).toBe("provider_approximation");
    expect(surface.totals.cellsShown).toBe(15);
    expect(surface.unavailable).toEqual(["vanna", "charm"]);
    // The one withheld gamma member stays a labelled absence, never a zero.
    expect(surface.cells.filter((c) => c.netMn == null)).toHaveLength(1);
    expect(surface.cells.find((c) => c.netMn == null)!.tier).toBe("u");
  });
});

describe("mode-matched book normalisation", () => {
  // Every cell gets one valid complete gamma (the first cell's) with the
  // values swapped, so the nulled fixture cell stays contract-valid.
  const swapGamma = (p: LooseRaw, net: number, gross: number) => {
    const proto = structuredClone((p.cells[0] as { gamma: Record<string, unknown> }).gamma);
    for (const c of p.cells as { gamma: Record<string, unknown> }[]) {
      c.gamma = { ...proto, net, known_net: net, gross, known_gross: gross };
    }
  };
  it("gross mode normalises against gross gamma so a cancelled book still draws", () => {
    const cancelled = parse(raw((p) => swapGamma(p, 0, 4e8)));
    const gross = buildExposureSurface(cancelled, opts({ mode: "gross" }));
    expect(gross.bookMaxAbsMn).toBe(400);
    const cell = find(gross, 106, "2026-11-20");
    expect(cell.valueMn).toBe(400);
    expect(cell.tier).toBe(5);
    // Same book in net mode is honestly flat — a known zero, not unknown.
    const net = buildExposureSurface(cancelled, opts({ mode: "net" }));
    expect(net.bookMaxAbsMn).toBe(0);
    expect(find(net, 106, "2026-11-20").tier).toBe(0);
    expect(find(net, 106, "2026-11-20").valueMn).toBe(0);
  });
  it("net and abs stay on |net| while gross follows gross gamma", () => {
    const mixed = parse(raw((p) => {
      swapGamma(p, 0, 3e8);
      for (const c of p.cells as { strike: number; gamma: Record<string, unknown> }[]) {
        const net = c.strike >= 100 ? 2e8 : -2e8;
        c.gamma = { ...c.gamma, net, known_net: net };
      }
    }));
    expect(buildExposureSurface(mixed, opts({ mode: "net" })).bookMaxAbsMn).toBe(200);
    expect(buildExposureSurface(mixed, opts({ mode: "abs" })).bookMaxAbsMn).toBe(200);
    const gross = buildExposureSurface(mixed, opts({ mode: "gross" }));
    expect(gross.bookMaxAbsMn).toBe(300);
    expect(find(gross, 94, "2026-10-16").tier).toBe(surfaceTier(300, 300));
  });
  it("window clipping still never moves a tier in gross mode", () => {
    const wide = buildExposureSurface(parse(raw()), opts({ mode: "gross" }));
    const narrow = buildExposureSurface(parse(raw()), opts({ mode: "gross", windowPct: 2 }));
    expect(narrow.bookMaxAbsMn).toBe(wide.bookMaxAbsMn);
    for (const cell of narrow.cells) expect(cell.tier).toBe(find(wide, cell.strike, cell.expiry).tier);
  });
});

describe("surfaceSpotRow — the cell-centre row of the reference spot", () => {
  it("lands on i+0.5 at exact strikes and interpolates between centres", () => {
    expect(surfaceSpotRow([103, 98], 103)).toBe(0.5);
    expect(surfaceSpotRow([103, 98], 98)).toBe(1.5);
    // Descending 103,98 with spot 100: 0.5 + (103−100)/(103−98) = 1.1 — the
    // centre convention, not a cell-edge count.
    expect(surfaceSpotRow([103, 98], 100)).toBeCloseTo(1.1, 12);
  });
  it("clamps outside covered centres without inventing a price-to-row slope", () => {
    expect(surfaceSpotRow([103, 98], 104)).toBe(0.5);
    expect(surfaceSpotRow([103, 98], 97)).toBe(1.5);
    expect(surfaceSpotRow([1000], 1030)).toBe(0.5);
    expect(surfaceSpotRow([1000], 970)).toBe(0.5);
  });
  it("uses each actual interval for nonuniform strike spacing", () => {
    expect(surfaceSpotRow([110, 103, 98], 105)).toBeCloseTo(0.5 + 5 / 7, 12);
    expect(surfaceSpotRow([110, 103, 98], 100)).toBeCloseTo(2.1, 12);
    expect(surfaceSpotRow([110, 103, 98], 120)).toBe(0.5);
    expect(surfaceSpotRow([110, 103, 98], 90)).toBe(2.5);
  });
  it("keeps single-strike books and refuses unusable input", () => {
    expect(surfaceSpotRow([103], 103)).toBe(0.5);
    expect(surfaceSpotRow([], 100)).toBeNull();
    expect(surfaceSpotRow([103, 98], NaN)).toBeNull();
    expect(surfaceSpotRow([103, 98], Infinity)).toBeNull();
  });
});

describe("fitSurfaceCamera — one uniform camera for geometry and label boxes", () => {
  const box = (dxMin: number, dyMin: number, dxMax: number, dyMax: number) => ({ dxMin, dyMin, dxMax, dyMax });
  const at = (x: number, y: number, b = SURFACE_NO_BOX): SurfaceSceneItem => ({ p: { x, y }, box: b });
  const extentOf = (items: SurfaceSceneItem[], cam: ReturnType<typeof fitSurfaceCamera>) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const it of items) {
      const p = applySurfaceCamera(it.p, cam);
      minX = Math.min(minX, p.x + it.box.dxMin); maxX = Math.max(maxX, p.x + it.box.dxMax);
      minY = Math.min(minY, p.y + it.box.dyMin); maxY = Math.max(maxY, p.y + it.box.dyMax);
    }
    return { minX, maxX, minY, maxY };
  };
  const expectFitted = (items: SurfaceSceneItem[], w: number, h: number, pad = 20) => {
    const cam = fitSurfaceCamera(items, w, h);
    const e = extentOf(items, cam);
    for (const v of [cam.scale, cam.tx, cam.ty, e.minX, e.maxX, e.minY, e.maxY]) expect(Number.isFinite(v)).toBe(true);
    expect(e.minX).toBeGreaterThanOrEqual(pad - 0.01);
    expect(e.maxX).toBeLessThanOrEqual(w - pad + 0.01);
    expect(e.minY).toBeGreaterThanOrEqual(pad - 0.01);
    expect(e.maxY).toBeLessThanOrEqual(h - pad + 0.01);
    return cam;
  };
  const scene = [at(-300, -80), at(300, 40), at(0, 0, box(-60, -26, 60, -8))];
  it("fits width and height with padding across realistic and tight viewports", () => {
    for (const [w, h] of [[1024, 560], [720, 446], [360, 260], [300, 240]] as const) expectFitted(scene, w, h);
  });
  it("keeps the label union whole at narrow widths instead of hiding it", () => {
    const cam = expectFitted(scene, 240, 220);
    expect(cam.scale).toBeGreaterThan(0);
    const e = extentOf(scene, cam);
    expect(e.maxX - e.minX).toBeLessThanOrEqual(200.01);
  });
  it("fits real projected surfaces across rotations, elevations and narrow fields", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const elevationDeg of [20, 60]) {
        const frame = { rotation, elevationDeg, cellW: 34, cellD: 12, heightPx: 280 };
        const items: SurfaceSceneItem[] = [];
        for (const [c, r, height] of [[-1.5, -1.5, 0], [1.5, 1.5, 0], [-1.5, 1.5, 280], [1.5, -1.5, 280],
          [0, 0, 280], [0, 0, 0]] as const) items.push(at(projectSurfacePoint(c, r, height, frame).x, projectSurfacePoint(c, r, height, frame).y));
        items.push(at(0, 200, box(-90, -26, 90, -8))); // a wide focus chip
        for (const w of [1024, 320]) expectFitted(items, w, 420);
      }
    }
  });
  it("keeps nonzero geometry in the actual 252px field at a 320px viewport", () => {
    // Fixed focus + spot labels exceed the nominal 212px inner width. They
    // must not collapse the real columns to a point; use a compact gutter.
    const items = [at(-59, 130), at(59, 0),
      at(29.4, -100, box(-70, -26, 70, -8)),
      at(26.5, -70, box(6, -16, 146, -4))];
    const cam = fitSurfaceCamera(items, 252, 260);
    expect(cam.scale).toBeGreaterThan(0.1);
    const e = extentOf(items, cam);
    expect(e.minX).toBeGreaterThanOrEqual(8 - 0.01);
    expect(e.maxX).toBeLessThanOrEqual(252 - 8 + 0.01);
    expect(e.minY).toBeGreaterThanOrEqual(8 - 0.01);
    expect(e.maxY).toBeLessThanOrEqual(260 - 8 + 0.01);
  });
  it("finds a positive feasible interval even when the zero-scale label union fails", () => {
    const items = [at(0, 0, box(0, 0, 140, 10)), at(100, 0, box(-140, 0, 0, 10))];
    const cam = fitSurfaceCamera(items, 200, 200);
    expect(cam.scale).toBeGreaterThan(0);
    const e = extentOf(items, cam);
    expect(e.minX).toBeGreaterThanOrEqual(20 - 0.01);
    expect(e.maxX).toBeLessThanOrEqual(180 + 0.01);
  });
  it("degrades without NaN on unusable dimensions", () => {
    for (const [w, h] of [[0, 0], [10, 4], [NaN, 300], [720, NaN], [-40, 200]] as const) {
      const cam = fitSurfaceCamera(scene, w, h);
      const p = applySurfaceCamera({ x: 3, y: -4 }, cam);
      for (const v of [cam.scale, cam.tx, cam.ty, p.x, p.y]) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it("drops non-finite anchors instead of poisoning the fit", () => {
    const cam = fitSurfaceCamera([at(-100, -50), at(100, 50), at(NaN, 5)], 720, 400);
    const e = extentOf([at(-100, -50), at(100, 50)], cam);
    expect(Number.isFinite(e.minX)).toBe(true);
  });
  it("centres an empty scene at rest", () => {
    const p = applySurfaceCamera({ x: 0, y: 0 }, fitSurfaceCamera([], 720, 400));
    expect(p.x).toBe(360);
    expect(p.y).toBe(200);
  });
  it("never scales the pure projection itself — the camera maps, the lib stays raw", () => {
    const frame = { rotation: 90 as const, elevationDeg: 30, cellW: 10, cellD: 8, heightPx: 100 };
    // A quarter turn maps (2,3) to (−3,2), so the painter's key follows.
    expect(projectSurfacePoint(2, 3, 40, frame).depth).toBe(-1);
    const cam = { scale: 2, tx: 10, ty: 20 };
    expect(applySurfaceCamera({ x: 1, y: -2 }, cam)).toEqual({ x: 12, y: 16 });
  });
});

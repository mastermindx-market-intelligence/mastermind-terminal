import { describe, it, expect } from "vitest";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, type QualifiedProjection } from "../exposureMapProjection";
import { buildExposureSurface, daysToExpiry, projectSurfacePoint, surfaceTier, tierBoundsMn } from "../exposureSurface";

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

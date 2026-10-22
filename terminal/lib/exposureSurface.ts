// The lens owner is a sibling of this module under terminal/lib/.
import { selectedProjectionCells, type QualifiedProjection, type ExposureLens } from "./exposureMapProjection";

export const SURFACE_VERSION = "exposure-surface/v1";
export type SurfaceMode = "net" | "gross" | "abs";
export const SURFACE_WINDOWS = [2, 4, 8] as const;
export const SURFACE_EXPIRY_CAPS = [5, 9, 15] as const;
export const SURFACE_ELEVATIONS = [20, 30, 45, 60] as const;
/** Relative tier ladder of the BOOK max |net| (tier 5 … 1); below → 0. */
export const SURFACE_TIERS = [0.7, 0.45, 0.25, 0.12, 0.04] as const;
export type SurfaceTier = 0 | 1 | 2 | 3 | 4 | 5 | "u";

/** One shown cell of the projection, already scaled to $mn. Nothing is
 * averaged, interpolated, smoothed or filled; a null stays null. */
export interface SurfaceCell {
  strike: number; expiry: string; economicExpiryAt: string | null; populationId: string;
  netMn: number | null; grossMn: number | null; valueMn: number | null; tier: SurfaceTier;
  qualified: boolean; changeMn: number | null;
}
export interface SurfaceOptions {
  lens: ExposureLens; mode: SurfaceMode; windowPct: number; expiryCap: number;
  referenceSpot: number | null; now?: number; prior?: QualifiedProjection | null;
}
export interface ExposureSurface {
  version: typeof SURFACE_VERSION; root: string; session: string | null;
  identity: "provider_observed" | "provider_approximation"; mode: SurfaceMode;
  windowPct: number; expiryCap: number; referenceSpot: number | null;
  strikes: number[]; expiries: string[]; cells: SurfaceCell[]; bookMaxAbsMn: number;
  totals: { cellsShown: number; cellsInLens: number; expiriesInLens: number; expiriesShown: number; strikesShown: number };
  strikeNetMn: ReadonlyMap<number, number | null>;
  expiryNetMn: ReadonlyMap<string, number | null>;
  unavailable: ("vanna" | "charm")[]; sourceRef: string; priorSession: string | null;
}
export interface IsoFrame { rotation: 0 | 90 | 180 | 270; elevationDeg: number; cellW: number; cellD: number; heightPx: number }

const MN = 1e6;
type LensCell = QualifiedProjection["cells"][number];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sumOrNull = (values: (number | null)[]): number | null => {
  if (!values.length || values.some((v) => v == null)) return null;
  const n = values.reduce<number>((a, b) => a + b!, 0);
  return Number.isFinite(n) ? n : null;
};

/** Tier of one cell against the BOOK max |net|, computed before any windowing
 * so clipping the window can never move a surviving cell's tier. */
export function surfaceTier(valueMn: number | null, bookMaxAbsMn: number): SurfaceTier {
  if (!finite(valueMn)) return "u";
  if (!(bookMaxAbsMn > 0)) return 0;
  const ratio = Math.abs(valueMn) / bookMaxAbsMn;
  for (let i = 0; i < SURFACE_TIERS.length; i++) if (ratio >= SURFACE_TIERS[i]) return (SURFACE_TIERS.length - i) as 1 | 2 | 3 | 4 | 5;
  return 0;
}

/** The five $mn thresholds the legend prints, highest first. */
export function tierBoundsMn(bookMaxAbsMn: number): number[] {
  return SURFACE_TIERS.map((t) => t * bookMaxAbsMn);
}

/** Whole days between the projection session and an expiry date. */
export function daysToExpiry(expiry: string, session: string | null): number | null {
  const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(v) : NaN);
  const ms = day(expiry) - (session == null ? NaN : day(session));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

const SIN30 = 0.5;
const COS30 = Math.cos(Math.PI / 6);

/** Pure isometric projection. `col`/`row` are grid coordinates already centred
 * on the grid, so a rotation quarter turn is a plain coordinate rotation; the
 * returned `depth` is the painter's key (larger = nearer, paint back → front). */
export function projectSurfacePoint(col: number, row: number, height: number, frame: IsoFrame): { x: number; y: number; depth: number } {
  let c = col, r = row;
  for (let q = 0; q < frame.rotation / 90; q++) { const prev = c; c = -r; r = prev; }
  const elevation = (frame.elevationDeg * Math.PI) / 180;
  const k = Math.sin(elevation) / SIN30;
  const x = (c - r) * frame.cellW * COS30;
  const yBase = (c + r) * frame.cellD * SIN30 * k;
  return { x, y: yBase - height * Math.cos(elevation), depth: c + r };
}

/** Select the projection's own cells through the existing lens owner, window
 * and cap them without changing any cell, and compute book-relative tiers. */
export function buildExposureSurface(p: QualifiedProjection, o: SurfaceOptions): ExposureSurface {
  const lensCells = selectedProjectionCells(p, o.lens, o.now ?? Date.now());
  // Book max over the WHOLE lens set, before windowing or capping: clipping
  // the window never changes a surviving cell's value or tier.
  let bookMaxAbsMn = 0;
  for (const cell of lensCells) {
    if (finite(cell.gamma.net) && Math.abs(cell.gamma.net) / MN > bookMaxAbsMn) bookMaxAbsMn = Math.abs(cell.gamma.net) / MN;
  }
  const expiriesInLens = [...new Set(lensCells.map((c) => c.expiry))].sort();
  const shownExpiries = new Set(expiriesInLens.slice(0, Math.max(0, Math.trunc(o.expiryCap))));
  const spot = finite(o.referenceSpot) ? o.referenceSpot : null;
  const shown = lensCells.filter((c) => shownExpiries.has(c.expiry)
    && (spot == null || Math.abs(c.strike - spot) / spot <= o.windowPct / 100));
  const priorCells = new Map(o.prior?.cells.map((c) => [`${c.expiry}|${c.strike}`, c]));
  const cells: SurfaceCell[] = shown.map((c) => {
    const netMn = finite(c.gamma.net) ? c.gamma.net / MN : null;
    const grossMn = finite(c.gamma.gross) ? c.gamma.gross / MN : null;
    const valueMn = o.mode === "net" ? netMn : o.mode === "gross" ? grossMn : netMn == null ? null : Math.abs(netMn);
    let changeMn: number | null = null;
    const prior = priorCells.get(`${c.expiry}|${c.strike}`);
    const priorNet = prior && finite(prior.gamma.net) ? prior.gamma.net / MN : null;
    if (prior && prior.population_id === c.population_id && netMn != null && priorNet != null) changeMn = netMn - priorNet;
    return { strike: c.strike, expiry: c.expiry, economicExpiryAt: c.economic_expiry_at, populationId: c.population_id,
      netMn, grossMn, valueMn, tier: surfaceTier(valueMn, bookMaxAbsMn), qualified: c.joint.complete, changeMn };
  });
  // Full-lens nets: all expiries for a strike, all strikes for an expiry.
  // Unknown is not zero — one null member nulls the whole net.
  const strikeNets = new Map<number, (number | null)[]>();
  const expiryNets = new Map<string, (number | null)[]>();
  for (const c of lensCells) {
    const net = finite(c.gamma.net) ? c.gamma.net / MN : null;
    (strikeNets.get(c.strike) ?? strikeNets.set(c.strike, []).get(c.strike)!).push(net);
    (expiryNets.get(c.expiry) ?? expiryNets.set(c.expiry, []).get(c.expiry)!).push(net);
  }
  const strikeNetMn = new Map([...strikeNets].map(([strike, nets]) => [strike, sumOrNull(nets)] as const));
  const expiryNetMn = new Map([...expiryNets].map(([expiry, nets]) => [expiry, sumOrNull(nets)] as const));
  // An empty window probes the lens set so an available metric is never
  // reported locked just because the window clipped everything away.
  const probe = shown.length ? shown : lensCells;
  const unavailable: ("vanna" | "charm")[] = [];
  if (probe.length && probe.every((c) => c.vanna.net == null)) unavailable.push("vanna");
  if (probe.length && probe.every((c) => c.charm.net == null)) unavailable.push("charm");
  return {
    version: SURFACE_VERSION, root: p.root,
    session: p.clocks.source_session ?? null,
    identity: p.kind === "modeled_exposure" ? "provider_observed" : "provider_approximation",
    mode: o.mode, windowPct: o.windowPct, expiryCap: o.expiryCap, referenceSpot: spot,
    strikes: [...new Set(shown.map((c) => c.strike))].sort((a, b) => b - a),
    expiries: expiriesInLens.filter((e) => shownExpiries.has(e)),
    cells, bookMaxAbsMn,
    totals: { cellsShown: shown.length, cellsInLens: lensCells.length, expiriesInLens: expiriesInLens.length,
      expiriesShown: shownExpiries.size, strikesShown: new Set(shown.map((c) => c.strike)).size },
    strikeNetMn, expiryNetMn, unavailable,
    sourceRef: p.source_snapshot_ref,
    priorSession: o.prior ? o.prior.clocks.source_session ?? null : null,
  };
}

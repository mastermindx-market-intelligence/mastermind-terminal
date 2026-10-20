import { scenarioGrid, type ExposureNodeInput } from "./marketStructure";
import type { ExpiryLens } from "./gexLadder";

export type QualifiedMetric = "gamma" | "vanna" | "charm";
export type ExposureLens = ExpiryLens | { kind: "next-live" } | { kind: "week" };
export interface ExposureShock { spotPercent: number; ivPoints: number; calendarDays: number }
type Metric = { unit: string; expected: number | null; received: number; qualified: number; missing: number;
  net: number | null; gross: number | null; qualified_population_id: string; status: string };
type Cell = { strike: number; expiry: string; economic_expiry_at: string | null; population_id: string } & Record<QualifiedMetric, Metric>;
export interface QualifiedProjection {
  root: string; source_snapshot_ref: string; security_id: string;
  clocks: Record<string, string | null>;
  population: { id: string; scope: string; full_universe_expected: null; full_universe_complete: false };
  greek_provenance: Partial<Record<QualifiedMetric, { model_ref: string; source_ref: string }>> | null;
  cells: Cell[];
}
const units = { gamma: "usd_delta_per_1pct_spot", vanna: "usd_delta_per_1vol_point", charm: "usd_delta_per_calendar_day" };
const metrics: QualifiedMetric[] = ["gamma", "vanna", "charm"];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const sum = (values: (number | null)[]) => { if (!values.length || values.some((v) => v == null)) return null; const n = values.reduce<number>((a, b) => a + b!, 0); return Number.isFinite(n) ? n : null; };

/** Strict consumer of the incumbent producer contract; never promotes legacy marginals. */
export function qualifiedExposureProjection(raw: unknown, root: string, session: string, now: number): QualifiedProjection | null {
  if (!object(raw) || raw.schema !== "options_hub.exposure_projection/v1" || raw.root !== root || raw.kind !== "modeled_exposure"
    || raw.scale !== "dollars" || raw.position_basis !== "assumed_long_call_short_put"
    || typeof raw.source_snapshot_ref !== "string" || !raw.source_snapshot_ref || typeof raw.security_id !== "string" || !raw.security_id
    || !object(raw.clocks) || raw.clocks.source_session !== session || raw.clocks.oi_report_date !== session || !object(raw.population) || !digest(raw.population.id)
    || !["observed_population", "supplied_expected_population"].includes(raw.population.scope as string)
    || raw.population.full_universe_complete !== false || raw.population.full_universe_expected !== null
    || (raw.greek_provenance != null && !object(raw.greek_provenance)) || !Array.isArray(raw.cells) || !raw.cells.length
    || raw.cells_status !== "complete" || raw.cell_count !== raw.cells.length) return null;
  const instants = ["option_observed_at", "underlying_observed_at", "greeks_available_at", "oi_available_at", "available_at"];
  const clocks = raw.clocks;
  for (const key of instants) {
    const value = clocks[key];
    if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now) return null;
    if (key !== "available_at" && Date.parse(value) > Date.parse(clocks.available_at as string)) return null;
  }
  if (Date.parse(clocks.greeks_available_at as string) < Date.parse(clocks.option_observed_at as string)) return null;
  for (const key of ["option_observed_at", "underlying_observed_at"]) {
    if (new Date(clocks[key] as string).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) !== session) return null;
  }
  const seen = new Set<string>();
  for (const cell of raw.cells) {
    if (!object(cell) || !finite(cell.strike) || cell.strike <= 0 || typeof cell.expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(cell.expiry)
      || !Number.isFinite(Date.parse(cell.expiry)) || new Date(cell.expiry).toISOString().slice(0, 10) !== cell.expiry || !digest(cell.population_id)) return null;
    const identity = `${cell.expiry}|${cell.strike}`;
    if (seen.has(identity)) return null; seen.add(identity);
    for (const metric of metrics) {
      const m = cell[metric];
      if (!object(m) || m.unit !== units[metric] || !count(m.received) || !count(m.qualified) || !count(m.missing)
        || m.received > m.qualified + m.missing
        || (m.expected !== null && (!count(m.expected) || m.expected !== m.qualified + m.missing)) || !digest(m.qualified_population_id)
        || (m.net !== null && !finite(m.net)) || (m.gross !== null && (!finite(m.gross) || m.gross < 0))) return null;
      if (m.net !== null || m.gross !== null) {
        if (m.missing !== 0 || m.qualified === 0 || cell.expiry < session || !["complete_observed", "complete_expected"].includes(m.status as string)
          || (m.status === "complete_expected") !== (m.expected !== null)
          || m.net === null || m.gross === null || m.gross + Math.max(1, Math.abs(m.net)) * 1e-12 < Math.abs(m.net)) return null;
        // Qualified zero-OI members need no Greek. Net cancellation with nonzero
        // gross still needs the source's model and units.
        const provenance = object(raw.greek_provenance) ? raw.greek_provenance[metric] : null;
        if (m.gross !== 0 && (!object(provenance) || typeof provenance.model_ref !== "string" || !provenance.model_ref || provenance.source_ref !== raw.source_snapshot_ref)) return null;
      }
    }
  }
  return raw as unknown as QualifiedProjection;
}

export function selectedProjectionCells(p: QualifiedProjection, lens: ExposureLens, now = Date.now()): Cell[] {
  if (lens.kind === "next-live" || lens.kind === "week") {
    // Date labels cannot identify an intraday fixing/expiry boundary.
    if (!Number.isFinite(now) || p.cells.some((c) => !c.economic_expiry_at || !/(Z|[+-]\d{2}:\d{2})$/.test(c.economic_expiry_at) || !Number.isFinite(Date.parse(c.economic_expiry_at)))) return [];
    const live = p.cells.filter((c) => Date.parse(c.economic_expiry_at!) > now);
    if (lens.kind === "next-live") {
      const next = Math.min(...live.map((c) => Date.parse(c.economic_expiry_at!)));
      return live.filter((c) => Date.parse(c.economic_expiry_at!) === next);
    }
    const date = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const day = Date.parse(date), weekday = (new Date(day).getUTCDay() + 6) % 7;
    const monday = day - weekday * 86400_000;
    return live.filter((c) => Date.parse(c.expiry) >= monday && Date.parse(c.expiry) < monday + 7 * 86400_000);
  }
  return p.cells.filter((c) => lens.kind === "all" || (lens.kind === "zero" && c.expiry === p.clocks.source_session)
    || (lens.kind === "ex-zero" && c.expiry !== p.clocks.source_session) || (lens.kind === "one" && c.expiry === lens.exp));
}

/** Explicit local shock through the existing scenario owner, only over identical qualified members. */
export function projectedExposureScenario(p: QualifiedProjection, cell: Cell, shock: ExposureShock): number | null {
  const weights = { gamma: shock.spotPercent, vanna: shock.ivPoints, charm: shock.calendarDays };
  if (!Object.values(weights).every(Number.isFinite) || Math.abs(shock.spotPercent) > 3 || Math.abs(shock.ivPoints) > 5 || shock.calendarDays < 0 || shock.calendarDays > 5) return null;
  const active = metrics.filter((m) => weights[m] !== 0);
  if (!active.length) return 0;
  if (active.some((m) => cell[m].net == null)) return null;
  if (new Set(active.map((m) => cell[m].qualified_population_id)).size !== 1) return null;
  const models = active.filter((m) => cell[m].gross !== 0).map((m) => p.greek_provenance?.[m]?.model_ref);
  if (models.some((m) => !m) || new Set(models).size > 1) return null;
  const grid = scenarioGrid({ gammaMn: weights.gamma === 0 ? 0 : cell.gamma.net! / 1e6, gammaKnown: 1,
    vannaMn: weights.vanna === 0 ? 0 : cell.vanna.net! / 1e6, charmMn: weights.charm === 0 ? 0 : cell.charm.net! / 1e6,
    deltaMn: null, callAbsMn: 0, putAbsMn: 0, nStrikes: 1, nStrikesFull: null, windowed: true },
    { dsPct: [shock.spotPercent], dVolPts: [shock.ivPoints], dtDays: shock.calendarDays });
  const value = grid.cells[0][0]; return finite(value) ? value : null;
}

export function projectionNodes(p: QualifiedProjection, lens: ExposureLens, metric: QualifiedMetric | "combined", shock: ExposureShock, now = Date.now()) {
  const selected = selectedProjectionCells(p, lens, now);
  const groups = new Map<number, Cell[]>();
  for (const cell of selected) groups.set(cell.strike, [...(groups.get(cell.strike) ?? []), cell]);
  const rows: ExposureNodeInput[] = [...groups].map(([strike, cells]) => ({ strike,
    netMn: metric === "combined" ? sum(cells.map((c) => projectedExposureScenario(p, c, shock))) : sum(cells.map((c) => c[metric].net == null ? null : c[metric].net / 1e6)),
    grossMn: metric === "gamma" ? sum(cells.map((c) => c.gamma.gross == null ? null : c.gamma.gross / 1e6)) : null }));
  const coverage = metric === "combined" ? null : {
    expected: selected.some((c) => c[metric].expected == null) ? null : selected.reduce((n, c) => n + c[metric].expected!, 0),
    received: selected.reduce((n, c) => n + c[metric].received, 0), qualified: selected.reduce((n, c) => n + c[metric].qualified, 0), missing: selected.reduce((n, c) => n + c[metric].missing, 0),
  };
  return { rows, coverage };
}

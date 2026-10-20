import { exposureNodes, type ExposureNodeInput, type ExposureNodeSummary } from "./marketStructure";
import { matrixLensByStrike, type GexMatrix } from "./gexLadder";
import { qualifiedExposureProjection, projectionNodes, selectedProjectionCells, type ExposureShock, type ExposureLens, type QualifiedProjection } from "./exposureMapProjection";

export type ExposureMapMetric = "gamma" | "vanna" | "charm" | "delta" | "combined";
export interface ExposureMapRead {
  state: "data" | "unavailable" | "wrong_root" | "future" | "malformed";
  session: string | null;
  sourceAsOf: string | null;
  spot: number | null;
  convention: string | null;
  summary: ExposureNodeSummary;
  expiries: string[];
  narrow: boolean;
  missingCells: number | null;
  qualification: "legacy" | "qualified" | "dated" | "unqualified";
  coverage: { expected: number | null; received: number; qualified: number; missing: number } | null;
  sourceRef: string | null;
  clocks: Record<string, string | null> | null;
  selectionKey: string;
}
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const record = (v: unknown): Record<string, unknown> | null => v != null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const day = (v: unknown): string | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(v)) return null;
  const value = v.slice(0, 10), ms = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
};

/** Use already acquired desk bytes. No acquisition, persistence, or invented joint data. */
export function readExposureMap(raw: unknown, root: string, matrix: GexMatrix | null,
  lens: ExposureLens, metric: ExposureMapMetric, today: string, now = Date.now(), shock: ExposureShock = { spotPercent: 0, ivPoints: 0, calendarDays: 0 }): ExposureMapRead {
  return createExposureMapReader(raw, root, matrix, today, now)(lens, metric, shock);
}

/** One immutable source read and clock for all lenses. A large contract book is
 * qualified once, while each view retains its own scope and coverage. No cache
 * crosses a root, source object, or availability-clock boundary. */
export function createExposureMapReader(raw: unknown, root: string, matrix: GexMatrix | null, today: string, now = Date.now()) {
  let validated = false;
  let projection: QualifiedProjection | null = null;
  const resolve = (receipt: unknown, session: string) => {
    if (!validated) {
      projection = qualifiedExposureProjection(receipt, root, session, now);
      validated = true;
    }
    return projection;
  };
  return (lens: ExposureLens, metric: ExposureMapMetric, shock: ExposureShock = { spotPercent: 0, ivPoints: 0, calendarDays: 0 }) =>
    readSource(raw, root, matrix, lens, metric, today, now, shock, resolve);
}

function readSource(raw: unknown, root: string, matrix: GexMatrix | null, lens: ExposureLens,
  metric: ExposureMapMetric, today: string, now: number, shock: ExposureShock,
  resolveProjection: (receipt: unknown, session: string) => QualifiedProjection | null): ExposureMapRead {
  const empty: ExposureMapRead = { state: "unavailable", session: null, sourceAsOf: null, spot: null,
    convention: null, summary: exposureNodes(null, null), expiries: [], narrow: lens.kind !== "all", missingCells: null,
    qualification: "legacy", coverage: null, sourceRef: null, clocks: null, selectionKey: "" };
  const p = record(raw);
  if (!p) return empty;
  if (p.root !== root) return { ...empty, state: "wrong_root" };
  const session = day(p.asof);
  if (!session || !Array.isArray(p.by_strike)) return { ...empty, state: "malformed" };
  if (typeof p.asof === "string" && p.asof.length > 10 && (!/(Z|[+-]\d{2}:\d{2})$/.test(p.asof) || !Number.isFinite(Date.parse(p.asof)))) return { ...empty, state: "malformed" };
  if (session > today || !Number.isFinite(now) || Date.parse(p.asof as string) > now) return { ...empty, state: "future" };
  const spot = finite(p.spot_ref) && p.spot_ref > 0 ? p.spot_ref : null;
  const expiries = Array.isArray(p.by_expiry) ? p.by_expiry.map((r) => day(record(r)?.exp)).filter((v): v is string => v != null && v >= session) : [];
  const out = { ...empty, session, sourceAsOf: p.asof as string, spot, expiries: [...new Set(expiries)].sort(), convention: typeof p.convention === "string" ? p.convention : null };
  const optional = record(p.exposure_projection);
  // An explicitly unavailable additive projection does not erase a separately
  // validated dated reference. A corrupt/foreign receipt is not this fallback.
  const receiptSession = record(optional?.clocks)?.source_session;
  const recognized = ["options_hub.exposure_projection/v1", "options_hub.exposure_projection/v2"].includes(String(optional?.schema));
  const referenceOnly = recognized && optional?.root === root
    && (receiptSession === session || (receiptSession === null && optional.cells_status === "source_unqualified"))
    && ["source_unqualified", "payload_limit"].includes(String(optional.cells_status))
    && Array.isArray(optional.cells) && optional.cells.length === 0;
  if (p.exposure_projection != null && !referenceOnly) {
    const projection = resolveProjection(p.exposure_projection, session);
    if (!projection) return { ...out, qualification: "unqualified" };
    // Delta is published only in the aggregate reference. The additive receipt
    // still has to belong to this source before any metric may use it.
    if (metric !== "delta") {
    const dated = projection.kind === "dated_provider_approximation";
    // A bounded dated capture may coexist with an empty or different legacy
    // chain. Its own uniform source price controls distances; an explicit
    // unknown stays unknown instead of borrowing the aggregate's spot.
    const qualifiedSpot = dated && projection.underlying_reference !== undefined ? projection.underlying_reference.value : spot;
    const metadata = { qualification: dated ? "dated" as const : "qualified" as const,
      spot: qualifiedSpot,
      sourceAsOf: dated ? session : projection.clocks.option_observed_at,
      sourceRef: projection.source_snapshot_ref, clocks: projection.clocks };
    if (dated && metric !== "gamma") return { ...out, ...metadata };
    const { rows, coverage, coveredOnly } = projectionNodes(projection, lens, metric, shock, now);
    const summary = exposureNodes(rows, qualifiedSpot, null, coveredOnly ? "covered" : "complete");
    return { ...out, state: summary.invalid ? "malformed" : rows.length ? "data" : "unavailable",
      ...metadata, summary, coverage,
      selectionKey: [...new Set(selectedProjectionCells(projection, lens, now).map(c => `${c.expiry}|${c.economic_expiry_at}`))].sort().join(","),
      expiries: [...new Set(projection.cells.map((c) => c.expiry))].sort() };
    }
  }
  if (metric === "combined") return out;
  if (lens.kind === "next-live" || lens.kind === "week") return out;
  if (lens.kind !== "all" && metric !== "gamma") return out;
  const input: ExposureNodeInput[] = p.by_strike.map((value) => {
    const r = record(value);
    return { strike: finite(r?.strike) ? r.strike : NaN,
      netMn: finite(r?.[metric + "_net"]) ? r[metric + "_net"] as number : null,
      callMn: metric === "gamma" && finite(r?.gamma_call) ? r.gamma_call : null,
      putMn: metric === "gamma" && finite(r?.gamma_put) ? r.gamma_put : null };
  });
  let missingCells: number | null = null;
  if (lens.kind !== "all") {
    const matrixRoot = record(matrix)?.root;
    if (matrixRoot != null && matrixRoot !== root) return { ...out, state: "wrong_root" };
    if (matrix?.asof && (!Number.isFinite(Date.parse(matrix.asof)) || Date.parse(matrix.asof) > now)) return { ...out, state: "future" };
    const selected = matrixLensByStrike(matrix, lens, session, "coupled-view", {
      strikes: input.map((r) => r.strike), expiries: out.expiries,
    });
    if (selected.reason) return out;
    for (const r of input) {
      r.netMn = selected.byStrike.get(r.strike) ?? null;
      // Net cells cannot identify gross call/put contributions.
      r.callMn = null; r.putMn = null;
    }
    missingCells = selected.unresolvedPairCount;
  }
  const summary = exposureNodes(input, spot, finite(p.by_strike_full_n) ? p.by_strike_full_n : null);
  return { ...out, state: summary.invalid ? "malformed" : "data", summary, missingCells };
}

/** Tiny measured values must not become an apparent zero in the inspector. */
export function exposureValue(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return Math.abs(value) < 10 ** -digits ? value.toExponential(2) : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

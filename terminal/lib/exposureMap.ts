import { exposureNodes, type ExposureNodeInput, type ExposureNodeSummary } from "./marketStructure";
import { matrixLensByStrike, type GexMatrix } from "./gexLadder";
import { qualifiedExposureProjection, projectionNodes, selectedProjectionCells, type ExposureShock, type ExposureLens } from "./exposureMapProjection";

export type ExposureMapMetric = "gamma" | "vanna" | "charm" | "combined";
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
  qualification: "legacy" | "qualified" | "unqualified";
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
  if (p.exposure_projection != null) {
    const projection = qualifiedExposureProjection(p.exposure_projection, root, session, now);
    if (!projection) return { ...out, qualification: "unqualified" };
    const { rows, coverage } = projectionNodes(projection, lens, metric, shock, now);
    const summary = exposureNodes(rows, spot, rows.length);
    return { ...out, state: summary.invalid ? "malformed" : rows.length ? "data" : "unavailable",
      qualification: "qualified", summary, coverage, sourceRef: projection.source_snapshot_ref, clocks: projection.clocks,
      selectionKey: [...new Set(selectedProjectionCells(projection, lens, now).map(c => `${c.expiry}|${c.economic_expiry_at}`))].sort().join(","),
      expiries: [...new Set(projection.cells.map((c) => c.expiry))].sort() };
  }
  if (metric === "charm" || metric === "combined") return out;
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

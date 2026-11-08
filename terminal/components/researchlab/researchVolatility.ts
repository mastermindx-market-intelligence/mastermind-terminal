import { ivPercentToRatio } from "./researchLabAdapter";

export type ResearchVolRow = { key: string; expiry: string; strike: number; side: "call" | "put"; ivRatio: number | null };
export const volatilityMissingInputs = ["product", "exercise_style", "quote_timestamp", "quote_condition", "expiry_timestamp", "forward", "discount_factor", "model", "support"] as const;
export type VolatilityMissingInput = typeof volatilityMissingInputs[number];
export type VolatilityDiagnosticIssue = "invalid_provenance" | "identity_mismatch" | "session_mismatch" | "units_mismatch";
export type VolatilityDiagnostics = {
  status: "raw_only" | "unavailable" | "inconsistent";
  provenance: "legacy_schema" | "producer_declared" | "invalid" | "unavailable";
  unit: "percent" | null; sourceSession: string | null;
  missing: readonly VolatilityMissingInput[]; issues: VolatilityDiagnosticIssue[];
};
export type ResearchVolatility = {
  status: "available" | "unavailable"; session: string | null; rows: ResearchVolRow[];
  fit: null; availableAt: null;
  excluded: { duplicate: number; invalidIdentity: number; invalidMetric: number };
  diagnostics: VolatilityDiagnostics;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !v.startsWith("0000-")
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** Describes this feed, never authorizes a fit or borrows per-quote facts from extras. */
function observationDiagnostics(raw: Record<string, unknown>, root: string, session: string | null): VolatilityDiagnostics {
  const d: VolatilityDiagnostics = { status: "raw_only", provenance: "legacy_schema", unit: "percent",
    sourceSession: session, missing: volatilityMissingInputs, issues: [] };
  if (!Object.hasOwn(raw, "observation_provenance")) return d;
  const p = raw.observation_provenance;
  if (!object(p)) {
    return { ...d, status: "inconsistent", provenance: "invalid", sourceSession: null, issues: ["invalid_provenance"] };
  }
  if (p.root !== root) d.issues.push("identity_mismatch");
  if (!session || p.source_session !== session) d.issues.push("session_mismatch");
  if (p.iv_unit !== "percent") { d.issues.push("units_mismatch"); d.unit = null; }
  if (p.schema !== "options_hub.vol.observation/v1" || p.source_value_field !== "implied_vol"
    || p.source_value_unit !== "ratio" || p.smile_aggregation !== "mean_by_expiry_strike_side"
    || p.smile_round_decimals !== 4 || !Array.isArray(p.smile_value_fields)
    || p.smile_value_fields.length !== 2 || p.smile_value_fields[0] !== "call_iv" || p.smile_value_fields[1] !== "put_iv") {
    d.issues.push("invalid_provenance");
  }
  if (d.issues.length) return { ...d, status: "inconsistent", provenance: "invalid", sourceSession: null };
  return { ...d, provenance: "producer_declared" };
}

/** Existing nightly Vol owner supplies percent numbers, never a model-qualified surface. */
export function adaptResearchVolatility(raw: unknown, expectedRoot: string): ResearchVolatility {
  const root = expectedRoot.trim().toUpperCase();
  const result: ResearchVolatility = { status: "unavailable", session: null, rows: [], fit: null, availableAt: null,
    excluded: { duplicate: 0, invalidIdentity: 0, invalidMetric: 0 },
    diagnostics: { status: "unavailable", provenance: "unavailable", unit: null, sourceSession: null,
      missing: volatilityMissingInputs, issues: [] } };
  if (!object(raw) || raw.schema !== "options_hub.vol/v1" || typeof raw.root !== "string"
    || raw.root.toUpperCase() !== root || !Array.isArray(raw.smile)) return result;
  result.status = "available";
  // compute_vol publishes the greeks reference session as YYYY-MM-DD. A fixture
  // timestamp has no admitted session semantics; truncating it could create a false join.
  result.session = date(raw.asof) ? raw.asof : null;
  result.diagnostics = observationDiagnostics(raw, root, result.session);
  // An explicit incompatible unit must not be interpreted using the legacy percent convention.
  if (result.diagnostics.unit === null) { result.status = "unavailable"; return result; }
  const points: { expiry: string; strike: number; call_iv: unknown; put_iv: unknown }[] = [];
  for (const slice of raw.smile) {
    if (!object(slice) || !date(slice.exp) || !Array.isArray(slice.points)) { result.excluded.invalidIdentity++; continue; }
    for (const point of slice.points) {
      if (!object(point) || typeof point.strike !== "number" || !Number.isFinite(point.strike) || point.strike <= 0) {
        result.excluded.invalidIdentity++; continue;
      }
      points.push({ expiry: slice.exp, strike: point.strike, call_iv: point.call_iv, put_iv: point.put_iv });
    }
  }
  const identity = (p: typeof points[number]) => p.expiry + "|" + p.strike;
  const counts = new Map<string, number>();
  for (const point of points) counts.set(identity(point), (counts.get(identity(point)) ?? 0) + 1);
  for (const point of points) {
    if (counts.get(identity(point))! > 1) { result.excluded.duplicate++; continue; }
    for (const side of ["call", "put"] as const) {
      const supplied = point[`${side}_iv`], ivRatio = ivPercentToRatio(supplied, "percent");
      if (supplied != null && ivRatio === null) result.excluded.invalidMetric++;
      result.rows.push({ key: `${root}|${point.expiry}|${side}|${point.strike}`, expiry: point.expiry, strike: point.strike, side, ivRatio });
    }
  }
  result.rows.sort((a,b) => a.expiry.localeCompare(b.expiry) || a.strike-b.strike || a.side.localeCompare(b.side));
  return result;
}

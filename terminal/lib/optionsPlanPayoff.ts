import { validateOptionsPlanDraft, type OptionsPlanDraft } from "./optionsPlanDraft";

export type PlanExpiryRequest = {
  schema: "options.plan_expiry_request/v1";
  draft: OptionsPlanDraft;
  spots: number[];
  payoff_basis: { kind: "hold_to_expiry_intrinsic"; expiration: string };
};
export type PlanPayoff = {
  schema: "options.plan_expiry_preparation/v1";
  status: "PREPARED_EXPIRY_PAYOFF";
  known_by: string;
  contract_expirations: string[];
  curve: { spots: number[]; pnl: number[]; cost: number; max_gain: number | "UNBOUNDED"; max_loss: number | "UNBOUNDED"; breakevens: number[] };
  source_boundary: { terms: "server_held_qualified_reference"; terms_temporal_basis: "dated_reference";
    reference_as_of: string; current_terms_qualified: false; original_response_bytes_replayed: false;
    installed_observation_sha256: string; discovery_snapshot_authenticated: false; current_quote_eligible: false;
    historical_first_availability_established: false; reference_request_count: 0; reference_sha256: string; reference_observed_at: string };
};
export type PlanPreparation = { ok: true; value: PlanExpiryRequest } | { ok: false; reason: "source" | "assumptions" | "expiry" | "unsupported" };

/** Hypothetical expiry prices only; dated marks never become inputs or entry. */
export function preparePlanExpiryRequest(raw: unknown): PlanPreparation {
  const checked = validateOptionsPlanDraft(raw);
  if (!checked.ok) return { ok: false, reason: "source" };
  const draft = checked.value;
  const expiries = new Set(draft.legs.map(l => l.snapshot.identity.exp));
  if (expiries.size !== 1) return { ok: false, reason: "expiry" };
  if (draft.legs.some(l => !["SPY", "QQQ"].includes(l.snapshot.identity.root) || l.snapshot.identity.adjustedRootHint)) return { ok: false, reason: "unsupported" };
  if (draft.legs.some(l => l.assumptions.side === null || l.assumptions.quantity === null || l.assumptions.entry === null)) return { ok: false, reason: "assumptions" };
  const strikes = draft.legs.map(l => l.snapshot.identity.strike);
  const lo = Math.max(0, Math.min(...strikes) * 0.8), hi = Math.max(...strikes) * 1.2;
  const spots = [...new Set([...Array.from({ length: 101 }, (_, i) => Number((lo + (hi - lo) * i / 100).toFixed(3))), ...strikes])].sort((a, b) => a - b);
  return { ok: true, value: { schema: "options.plan_expiry_request/v1", draft, spots,
    payoff_basis: { kind: "hold_to_expiry_intrinsic", expiration: [...expiries][0] } } };
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every(finite);
const instant = (v: unknown): v is string => typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));

/** Release numeric output only with the actual API source boundary and matching
 * request prices/expiry. Malformed success, partial math and unknown stay closed. */
export function readPlanPayoff(raw: unknown, request: PlanExpiryRequest): PlanPayoff | null {
  if (!object(raw) || raw.schema !== "options.plan_expiry_preparation/v1" || raw.status !== "PREPARED_EXPIRY_PAYOFF"
    || !instant(raw.known_by) || !Array.isArray(raw.contract_expirations) || raw.contract_expirations.length !== 1
    || raw.contract_expirations[0] !== request.payoff_basis.expiration || !Array.isArray(raw.reasons) || raw.reasons.length !== 0
    || !object(raw.curve) || !object(raw.source_boundary)) return null;
  const c = raw.curve, s = raw.source_boundary;
  if (!numbers(c.spots) || !numbers(c.pnl) || c.spots.length !== request.spots.length || c.pnl.length !== c.spots.length
    || c.spots.some((v, i) => v !== request.spots[i]) || !finite(c.cost) || !numbers(c.breakevens)
    || !(finite(c.max_gain) || c.max_gain === "UNBOUNDED") || !(finite(c.max_loss) || c.max_loss === "UNBOUNDED")
    || s.terms !== "server_held_qualified_reference" || s.terms_temporal_basis !== "dated_reference"
    || s.current_terms_qualified !== false || s.original_response_bytes_replayed !== false
    || typeof s.reference_as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.reference_as_of)
    || !Number.isFinite(Date.parse(s.reference_as_of))
    || new Date(s.reference_as_of).toISOString().slice(0, 10) !== s.reference_as_of
    || typeof s.installed_observation_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.installed_observation_sha256) || s.discovery_snapshot_authenticated !== false
    || s.current_quote_eligible !== false || s.historical_first_availability_established !== false
    || s.reference_request_count !== 0 || typeof s.reference_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.reference_sha256)
    || !instant(s.reference_observed_at) || Date.parse(s.reference_observed_at) > Date.parse(raw.known_by)) return null;
  return raw as unknown as PlanPayoff;
}

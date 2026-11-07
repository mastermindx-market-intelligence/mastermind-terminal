import { canonicalJson } from "./investigationEvidenceOptions";
import { preparePlanExpiryRequest, readPlanPayoff, type PlanExpiryRequest, type PlanPayoff } from "./optionsPlanPayoff";

export type PlanExpiryObservation = Readonly<{ request: PlanExpiryRequest; result: PlanPayoff }>;
const captured = new WeakSet<object>();
function freeze(value: object): void {
  for (const child of Object.values(value)) if (child !== null && typeof child === "object") freeze(child);
  Object.freeze(value);
}

/** Capture at the existing request's successful completion, never from a later
 * edited draft. These are owner outputs, not new math, quotes or authorization. */
export function capturePlanExpiryObservation(draft: unknown, raw: unknown): PlanExpiryObservation | null {
  try {
    const request = preparePlanExpiryRequest(draft);
    if (!request.ok) return null;
    const result = readPlanPayoff(raw, request.value);
    if (!result) return null;
    const observation: PlanExpiryObservation = structuredClone({ request: request.value, result });
    freeze(observation);
    captured.add(observation);
    return observation;
  } catch { return null; }
}

export type PlanEntryComparison =
  | { state: "ready"; baseline: PlanExpiryObservation; current: PlanExpiryObservation }
  | { state: "unavailable"; reason: "observation" | "source" | "contracts" | "grid" };

/** Only entry assumptions/research text and calculation time may differ.
 * Complete dated snapshots, side/quantity, source boundary and price grid stay
 * identical. Output is two unmodified owner results; no differences are priced. */
export function comparePlanEntryAssumptions(baseline: PlanExpiryObservation, current: PlanExpiryObservation): PlanEntryComparison {
  if (!captured.has(baseline) || !captured.has(current)) return { state: "unavailable", reason: "observation" };
  if (canonicalJson(baseline.result.source_boundary) !== canonicalJson(current.result.source_boundary)) return { state: "unavailable", reason: "source" };
  const terms = (value: PlanExpiryObservation) => value.request.draft.legs.map(leg => ({
    snapshot: leg.snapshot, side: leg.assumptions.side, quantity: leg.assumptions.quantity,
  }));
  if (canonicalJson(terms(baseline)) !== canonicalJson(terms(current))) return { state: "unavailable", reason: "contracts" };
  if (canonicalJson([baseline.request.payoff_basis, baseline.request.spots]) !== canonicalJson([current.request.payoff_basis, current.request.spots])) return { state: "unavailable", reason: "grid" };
  return { state: "ready", baseline, current };
}

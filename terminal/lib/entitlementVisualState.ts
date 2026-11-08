import type { GateEntitlement } from "./entitlementStore";

/**
 * Presentation only: a server-side denial and an unresolved entitlement are
 * different states. Never replace either with an optimistic paid grant.
 *
 * This selector does NOT authorize a feature: gateEntitlement and the
 * server-side authority still fail closed.
 */
export type EntitlementVisualState = "checking" | "unavailable" | "verified";

export function entitlementVisualState(
  gate: Pick<GateEntitlement, "loading" | "unverified">,
): EntitlementVisualState {
  if (gate.loading) return "checking";
  if (gate.unverified) return "unavailable";
  return "verified";
}

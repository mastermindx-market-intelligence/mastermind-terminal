/** Shared read-access predicate; the server still authenticates and checks the authority.
 * Paid tier alone is not sufficient. The private unlimited overlay is the one exact exception.
 */
export function optionsReadAccess(entitlement: { tier?: unknown; features?: unknown } | null | undefined): boolean {
  if (!entitlement) return false;
  return (Array.isArray(entitlement.features) && entitlement.features.includes("terminal_live_options"))
    || (typeof entitlement.tier === "string" && entitlement.tier.trim().toLowerCase() === "unlimited");
}

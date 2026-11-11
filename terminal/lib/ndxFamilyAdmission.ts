/**
 * Gate combined NDX (AM) + NDXP (PM) source-family candidates before ANY
 * Flow API/stream/cache/identity consumer sees them.
 *
 * Macro's current family_source/v1 is an offline arithmetic candidate only:
 * it has no complete-chain, first-availability or redistribution proof and
 * cannot be represented by the single-root exposure_projection/v2 contract.
 * No self-attested metadata field can grant those rights. A future release
 * requires a separately reviewed positive admission contract.
 *
 * Deliberately reject ANY family_source marker on a GEX payload, including
 * malformed/unknown versions and roots other than NDX. Ordinary single-root
 * GEX payloads without the marker retain their existing behavior.
 */
/** The existing Flow keys that carry a GEX ladder, positioning state, or GEX index. */
export function isGexFamilyFeed(f: string): boolean {
  return f.startsWith("gex:") || f.startsWith("gex_at:") ||
    f.startsWith("gexstate:") || f === "gexstate_index" || f.startsWith("gex_dates:");
}

export function isUnadmittedGexFamilyArtifact(f: string, payload: unknown): boolean {
  if (!isGexFamilyFeed(f)) return false;
  if (Array.isArray(payload)) {
    // Ladder and state documents are objects. Keep existing date-index arrays
    // (strings/normal sessions) working, but reject a marked object inside one.
    if (!(f.startsWith("gex_dates:") || f === "gexstate_index")) return true;
    return payload.some((item) => item !== null && typeof item === "object" &&
      Object.prototype.hasOwnProperty.call(item, "family_source"));
  }
  if (!payload || typeof payload !== "object") return false;
  return Object.prototype.hasOwnProperty.call(payload, "family_source");
}

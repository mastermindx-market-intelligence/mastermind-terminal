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
export function isUnadmittedGexFamilyArtifact(f: string, payload: unknown): boolean {
  if (!(f.startsWith("gex:") || f.startsWith("gex_at:"))) return false;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Object.prototype.hasOwnProperty.call(payload, "family_source");
}

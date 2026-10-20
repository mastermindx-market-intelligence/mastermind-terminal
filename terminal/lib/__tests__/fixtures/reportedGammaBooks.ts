import original from "./exposure-projection-observed-v2.json";

interface FixtureProjection {
  clocks: Record<string, string | null>;
  valuation: Record<string, string | null>;
  underlying_reference: { value: number | null; source_session: string };
  input_sha256: string;
  greek_provenance: { gamma: Record<string, string> };
  contract_identity: { source_session: string; effective_from: string; effective_to: string; input_sha256: string;
    reference_pages: { params: Record<string, string | number> }[]; contract_keys: string[][]; observed_contract_keys: string[][] };
  cells: [number, number, number, unknown[][], unknown[]][];
  expiry_terms: [string, string | null][];
  metrics: { gamma: Record<"net" | "gross" | "known_net" | "known_gross" | "call" | "put", number | null> };
}

// Coherent synthetic source declarations for consumer boundaries, not new
// provider evidence. The retained real pair is supplied separately via env.
export function reportedGammaBook(session: "2026-10-16" | "2026-10-19", scale = 1, sessionZero = false) {
  const p = structuredClone(original) as unknown as FixtureProjection;
  p.clocks.source_session = session; p.clocks.oi_report_date = session;
  p.clocks.available_at = session === "2026-10-16" ? "2026-10-20T10:00:00Z" : "2026-10-20T09:00:00Z";
  p.valuation.source_session = session; p.underlying_reference.source_session = session;
  p.input_sha256 = (session === "2026-10-16" ? "a" : "b").repeat(64);
  const id = p.contract_identity;
  id.source_session = session; id.effective_from = session;
  id.effective_to = session === "2026-10-16" ? "2026-10-17" : "2026-10-20";
  id.input_sha256 = p.input_sha256;
  id.reference_pages[0].params.as_of = session;
  id.reference_pages[0].params["expiration_date.gte"] = session;
  for (const cell of p.cells) {
    const metric = cell[3][0];
    for (const i of [5, 6, 7, 8, 10, 11]) if (typeof metric[i] === "number") (metric as unknown[])[i] = (metric[i] as number) * scale;
  }
  for (const key of ["net", "gross", "known_net", "known_gross", "call", "put"] as const) {
    if (p.metrics.gamma[key] !== null) p.metrics.gamma[key] = p.metrics.gamma[key]! * scale;
  }
  if (sessionZero) {
    const old = p.expiry_terms[0][0]; p.expiry_terms[0][0] = session;
    for (const keys of [id.contract_keys, id.observed_contract_keys]) for (const key of keys) if (key[0] === old) key[0] = session;
  }
  return { schema: "options_hub.gex/v1", root: "SPY", asof: session, spot_ref: 100,
    net_gex_bn: 9.9, by_strike: [], exposure_projection: p };
}

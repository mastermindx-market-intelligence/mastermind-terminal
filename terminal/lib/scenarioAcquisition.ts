import { SCENARIO_VERSION, type ScenarioBasis } from "./exposureScenario";
import { createScenarioCapture, type ScenarioSourceReference } from "./investigationScenario";
import { createExposureMapReader } from "./exposureMap";
import { scenarioBasisFromRead } from "@/components/exposure-map/exposureScenarioBasis";
import type { ExposureLens } from "./exposureMapProjection";

/** Same native basis encoding on client and server; no separate scenario math. */
export const scenarioBasisEncoding = (basis: ScenarioBasis) => JSON.stringify({ model_version: SCENARIO_VERSION, basis });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Acquisition metadata is an expected byte identity, NEVER a retention/rights receipt. */
export function acquiredScenarioBytes(raw: unknown, kind: "gex" | "moves", root: string, session: string) {
  if (!object(raw) || raw.stale === true || raw.schema !== `options_hub.${kind}/v1` || raw.root !== root
    || typeof raw.asof !== "string" || raw.asof.slice(0, 10) !== session) return null;
  const value = raw._scenario_source_identity;
  if (!object(value) || Object.keys(value).sort().join(",") !== "byte_length,kind,root,schema,session,sha256"
    || value.schema !== "options_hub.acquired_bytes/v1" || value.kind !== kind || value.root !== root || value.session !== session
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.byte_length) || Number(value.byte_length) < 1
    || Number(value.byte_length) > (kind === "gex" ? 8*1024*1024 : 1024*1024)) return null;
  return { sha256: value.sha256, byte_length: Number(value.byte_length) };
}

/** Re-read the SAME acquired object at the captured instant/lens using native math.
 * It never hashes browser JSON to invent source identity and never reads a newer head.
 * The server must verify these expected bytes against the actual producer and retained read.
 */
export async function scenarioReferenceFromAcquisition({ source, moves, root, lens, evaluatedAt, stale = false }:
  { source: unknown; moves: unknown; root: string; lens: ExposureLens; evaluatedAt: number; stale?: boolean }): Promise<ScenarioSourceReference | null> {
  if (stale || !Number.isFinite(evaluatedAt) || !object(source) || typeof source.asof !== "string") return null;
  const session = source.asof.slice(0, 10);
  const gex = acquiredScenarioBytes(source, "gex", root, session);
  if (!gex) return null;
  const reader = createExposureMapReader(source, root, null, session, evaluatedAt);
  const read = reader(lens, "gamma");
  if (read.state !== "data" || read.qualification !== "qualified" || read.session !== session) return null;
  const basis = scenarioBasisFromRead(read, reader, lens, root, { root, raw: moves, now: evaluatedAt });
  if (!basis || basis.qualification !== "qualified") return null;
  const movesRef = basis.emPct === null ? null : acquiredScenarioBytes(moves, "moves", root, session);
  if (basis.emPct !== null && !movesRef) return null;
  // If a moves payload is not used, both saved and reopened math explicitly omit it.
  const exactBasis = movesRef ? basis : scenarioBasisFromRead(read, reader, lens, root, null);
  if (!exactBasis) return null;
  let digest: string;
  try {
    digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(scenarioBasisEncoding(exactBasis))))).map(x => x.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
  const value = { owner: "options_hub" as const, root, session, source_as_of: read.sourceAsOf,
    evaluated_at: new Date(evaluatedAt).toISOString(), lens, selection_key: read.selectionKey,
    basis_sha256: digest, gex, moves: movesRef };
  const checked = createScenarioCapture(value, { targetSpot: basis.referenceSpot, deltaSigmaPts: 0, days: 0 });
  return checked.ok ? checked.capture.source : null;
}

import {
  DEFAULT_SECTOR_STATE,
  parseSectorState,
  writeSectorState,
  type SectorState,
} from "@/lib/sectorIntelligence";

/**
 * Bounded native sector depth-return snapshots.
 *
 * A snapshot is the canonical compact query string produced by the incumbent
 * sector serializer (writeSectorState) with every entry identical to the
 * canonical serialization of DEFAULT_SECTOR_STATE omitted — except
 * `sectorWorkspace`, which is always kept so a fully default snapshot still
 * reads back as `sectorWorkspace=discover`. Only rotation/discover/breadth
 * workspaces with sourceFamily="sectors" and sourcesOpen=false are
 * capturable. Decode validates by re-encoding, so only canonical,
 * non-recursive, order-faithful strings are accepted.
 */

export const SECTOR_DEPTH_RETURN_PARAM = "sectorReturn";
export const SECTOR_DEPTH_RETURN_HISTORY_KEY = "mmxSectorDepthReturn";
const PUBLIC_SNAPSHOT_LIMIT = 1024;

/** Fixed workspace key emitted by the incumbent serializer (spec-pinned). */
const SECTOR_WORKSPACE_PARAM = "sectorWorkspace";

/** Maximum serialized snapshot length in characters. */
// All parser-bounded fields, even simultaneously full of percent-encoded CJK,
// fit here. The complete value only travels in same-tab history when it exceeds
// the smaller URL budget, so it cannot inflate an otherwise valid request URL.
const SECTOR_DEPTH_RETURN_MAX_LENGTH = 8192;

/**
 * Inert canonical base used only to drive the incumbent serializer; never
 * accepted from callers and never resolved.
 */
const SECTOR_DEPTH_RETURN_BASE_URL = "https://mastermind.invalid/discover";

const SECTOR_DEPTH_RETURN_WORKSPACES: readonly SectorState["workspace"][] = [
  "rotation",
  "discover",
  "breadth",
];

/**
 * Canonical entries for a state: write through the incumbent serializer,
 * normalize with parseSectorState (restores defaults for out-of-bounds
 * values), then write the normalized state again so caller snapshots and the
 * default baseline share one canonical form and fixed order.
 */
function canonicalSectorEntries(state: SectorState): [string, string][] {
  const written = new URL(SECTOR_DEPTH_RETURN_BASE_URL);
  writeSectorState(written, state);
  const normalized = parseSectorState(written.searchParams);
  const canonical = new URL(SECTOR_DEPTH_RETURN_BASE_URL);
  writeSectorState(canonical, normalized);
  return Array.from(canonical.searchParams.entries());
}

export function encodeSectorDepthReturn(state: SectorState): string | null {
  if (state.sourceFamily !== "sectors") return null;
  if (state.sourcesOpen) return null;
  if (!SECTOR_DEPTH_RETURN_WORKSPACES.includes(state.workspace)) return null;

  const defaultsByKey = new Map(canonicalSectorEntries(DEFAULT_SECTOR_STATE));
  const compact = new URLSearchParams();
  for (const [key, value] of canonicalSectorEntries(state)) {
    const differsFromDefault = defaultsByKey.get(key) !== value;
    if (key === SECTOR_WORKSPACE_PARAM || differsFromDefault) {
      compact.append(key, value);
    }
  }

  const raw = compact.toString();
  if (raw.length === 0 || raw.length > SECTOR_DEPTH_RETURN_MAX_LENGTH) {
    return null;
  }
  return raw;
}

export function parseSectorDepthReturn(raw: string | null): SectorState | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.length > SECTOR_DEPTH_RETURN_MAX_LENGTH) return null;
  // Query-only raw: reject query, path and fragment prefixes.
  if (raw.startsWith("?") || raw.startsWith("/") || raw.startsWith("#")) {
    return null;
  }

  const params = new URLSearchParams(raw);

  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return null; // duplicate keys are noncanonical
    seen.add(key);
  }
  // Never honor a snapshot that itself embeds a sectorReturn parameter.
  if (seen.has(SECTOR_DEPTH_RETURN_PARAM)) return null;

  const state = parseSectorState(params);
  // Round-trip: re-encoding the parsed state must reproduce the raw string
  // byte-for-byte. This subsumes rejection of unknown keys, default-identical
  // padding, aliases, alternate percent-encoding, truncation and noncanonical
  // ordering.
  if (encodeSectorDepthReturn(state) !== raw) return null;
  return state;
}

/** Large shared links retain the actual outer workspace, sector and theme.
 * The exact same-tab selection is retained separately in browser history. */
export function sectorDepthReturnQuery(state: SectorState): string | null {
  const full = encodeSectorDepthReturn(state);
  if (!full || full.length <= PUBLIC_SNAPSHOT_LIMIT) return full;
  return encodeSectorDepthReturn({ ...DEFAULT_SECTOR_STATE,
    workspace: state.workspace, sector: state.sector, theme: state.theme });
}

/** Browser history is advisory navigation state. Validate its bytes and bind it
 * to this entry's public query before using it; it grants no data access. */
export function resolveSectorDepthReturn(raw: string | null, historySnapshot: unknown): SectorState | null {
  if (!raw || raw.length > PUBLIC_SNAPSHOT_LIMIT) return null;
  const retained = parseSectorDepthReturn(typeof historySnapshot === "string" ? historySnapshot : null);
  if (retained && sectorDepthReturnQuery(retained) === raw) return retained;
  return parseSectorDepthReturn(raw);
}

/** R2-PR5 — Discover scan slice. DOM-free: it scans a preset list through the
 * OWNERS — `reduceExposureNodes` + `scannerScore` (lib/exposureNodeReducer.ts) —
 * freezes the ORIGINAL scan as an immutable record, and produces VERSIONED
 * refresh rows whose `node moved` / `contested changed` flags compare against
 * the previous revision. A refresh can never overwrite the original; a null
 * score is a typed reason, never a zero. No React, no fetch, no DOM here. */
import { reduceExposureNodes, type ExpectedMoveInput } from "./exposureNodeReducer";
import { selectedProjectionCells, type ExposureLens, type QualifiedProjection } from "./exposureMapProjection";

export const SCAN_VERSION = "exposure-scan/v1";
/** Books are loaded only for these; every other preset stays unadmitted. */
export const SCAN_ROLLOUT = ["SPY", "QQQ", "SPXW", "IWM", "NDXP"] as const;
export type ScanMetric = "gamma";

export type ScanRowStatus = "candidate" | "contested" | "unscored" | "partial"
  | "metric_not_scanned" | "identity_unadmitted" | "book_unavailable";

export interface ScanIdentity {
  securityId: string; version: string; populationId: string;
  inputSha256: string; sourceSnapshotRef: string; session: string | null;
}

export interface ScanRowInput {
  preset: string; projection: QualifiedProjection | null; spot: number | null;
  expectedMove: ExpectedMoveInput | null; emPct: number | null; fresh: boolean;
  bookStatus: "data" | "loading" | "absent" | "unavailable" | "not_loaded";
}

export interface ScanRow {
  preset: string; status: ScanRowStatus; identity: ScanIdentity | null; metric: ScanMetric;
  scopeLabel: string; dominantStrike: number | null; dominantNetMn: number | null;
  sharePct: number | null; contestedRatio: number | null; contested: boolean | null;
  distancePct: number | null; distanceEm: number | null; distanceFit: number | null;
  score: number | null; candidateScore: number | null; reasons: string[];
  coveragePct: number | null; reductionStatus: string | null;
}

export interface ScanRecord {
  version: typeof SCAN_VERSION;
  /** Deterministic digest of the sorted row identities + statuses. */
  id: string; origin: "original" | "refresh";
  revision: number; scannedAt: number; rows: ScanRow[];
  presets: number; scored: number; unscored: number; unadmitted: number;
}

export interface ScanRowDelta {
  preset: string; nodeMoved: boolean; previousStrike: number | null; currentStrike: number | null;
  contestedChanged: boolean; scoreDelta: number | null; statusChanged: boolean;
}

export interface ScanRefresh {
  original: ScanRecord; latest: ScanRecord;
  /** Every revision, oldest → newest, the original first. */
  history: ScanRecord[]; deltas: ScanRowDelta[];
}

const freeze = <T,>(value: T): T => {
  if (value != null && typeof value === "object") {
    for (const key of Object.keys(value as object)) freeze((value as Record<string, unknown>)[key]);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
};

/** FNV-1a 64-bit over the sorted row keys — the deterministic fallback id used
 * where `crypto.subtle` is absent (jsdom and other non-secure contexts).
 * BigInt is built from hex strings: the ES2017 target forbids BigInt literals. */
const FNV_BASIS = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const FNV_MASK = BigInt("0xffffffffffffffff");
const fnv1a64 = (text: string): string => {
  let hash = FNV_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, "0");
};

/** One row's identity line: preset, status, projection identity and dominant
 * strike. Sorted before digesting so row order never changes a record id. */
const rowKeys = (rows: ScanRow[]): string[] => rows.map((r) => [
  r.preset, r.status, r.identity?.securityId ?? "-", r.identity?.version ?? "-",
  r.identity?.populationId ?? "-", r.identity?.inputSha256 ?? "-",
  r.dominantStrike ?? "-", r.score ?? "-",
].join("|")).sort();

const emptyRow = (preset: string, status: ScanRowStatus): ScanRow => ({
  preset, status, identity: null, metric: "gamma", scopeLabel: "", dominantStrike: null,
  dominantNetMn: null, sharePct: null, contestedRatio: null, contested: null, distancePct: null,
  distanceEm: null, distanceFit: null, score: null, candidateScore: null, reasons: [],
  coveragePct: null, reductionStatus: null,
});

const reasonsOf = (reduction: ReturnType<typeof reduceExposureNodes>): string[] =>
  reduction.scanner.status === "unavailable" ? [...reduction.scanner.reasons] : [];

const UNSCORED_STATUSES = ["empty", "zero", "net_cancelled", "refused"] as const;

/** Scan one preset through the owners. The row's dominant / share / contested
 * values always come from the SAME reduction as its distance and score, and the
 * identity from that reduction's population receipt — never a second payload. */
export function scanPreset(input: ScanRowInput, o: { lens: ExposureLens; now: number }): ScanRow {
  const p = input.projection;
  // Admission first: a preset with no qualified book has no identity to scan,
  // whatever happened to the fetch. Rollout membership is the caller's label.
  if (!p || !p.security_id) return emptyRow(input.preset, "identity_unadmitted");
  if (input.bookStatus !== "data") return emptyRow(input.preset, "book_unavailable");
  const reduction = reduceExposureNodes(p, { metric: "gamma", lens: o.lens, spot: input.spot,
    expectedMove: input.expectedMove, fresh: input.fresh, now: o.now });
  const expiryCount = new Set(selectedProjectionCells(p, o.lens, o.now).map((c) => c.expiry)).size;
  const base: ScanRow = { ...emptyRow(input.preset, "unscored"),
    scopeLabel: `${o.lens.kind === "all" ? "all" : o.lens.kind} ${expiryCount}`,
    identity: { securityId: p.security_id, version: p.population.scope === "observed_population" ? "v2" : "v1",
      populationId: reduction.identity.populationId, inputSha256: reduction.identity.inputSha256,
      sourceSnapshotRef: reduction.identity.sourceSnapshotRef, session: p.clocks.source_session ?? null },
    dominantStrike: reduction.dominantNode?.strike ?? null, dominantNetMn: reduction.dominantNode?.net ?? null,
    sharePct: reduction.concentration?.share != null ? reduction.concentration.share * 100 : null,
    contestedRatio: reduction.contested?.ratio ?? null, contested: reduction.contested?.contested ?? null,
    coveragePct: reduction.status === "partial" && reduction.coverage.expected != null && reduction.coverage.expected > 0
      ? (reduction.coverage.qualified / reduction.coverage.expected) * 100
      : reduction.status === "partial" && reduction.coverage.qualified + reduction.coverage.missing > 0
        ? (reduction.coverage.qualified / (reduction.coverage.qualified + reduction.coverage.missing)) * 100
        : null,
    reductionStatus: reduction.status };
  if ((UNSCORED_STATUSES as readonly string[]).includes(reduction.status))
    return { ...base, status: "unscored", reasons: reasonsOf(reduction) };
  if (reduction.status === "partial") return { ...base, status: "partial", reasons: reasonsOf(reduction) };
  const scanner = reduction.scanner;
  if (scanner.status === "unavailable") return { ...base, status: "unscored", reasons: [...scanner.reasons] };
  const spot = input.spot;
  const distancePct = spot != null && spot > 0 && reduction.dominantNode
    ? (Math.abs(reduction.dominantNode.strike - spot) / spot) * 100 : null;
  // Far nodes stay visible with their dominant / share / contested values (P53)
  // but rank nowhere: outside the candidate gate the score is a reason, not a rank.
  return { ...base, distancePct, distanceEm: scanner.distanceEm, distanceFit: scanner.distanceFit,
    score: scanner.score, candidateScore: scanner.candidateScore,
    status: scanner.candidateEligible ? (base.contested ? "contested" : "candidate") : "unscored",
    reasons: scanner.candidateEligible ? [] : ["outside_horizon"] };
}

/** Static Delta row for the parent: v1 scans gamma only, so Delta is labelled,
 * never scanned and never a silent zero. */
export function metricNotScannedRow(preset: string, identity: ScanIdentity | null): ScanRow {
  return { ...emptyRow(preset, "metric_not_scanned"), identity, reasons: ["metric_not_scanned"] };
}

/** Never claim the preset count as scanned: `scored` counts rows with a finite
 * score, `unscored` the rest WITH identity, `unadmitted` the identity-less rows.
 * The record is deep-frozen: a built scan record is immutable evidence. */
export function buildScanRecord(rows: ScanRow[], scannedAt: number,
  origin: "original" | "refresh" = "original", revision = 1): ScanRecord {
  const scored = rows.filter((r) => r.score != null && Number.isFinite(r.score)).length;
  const unadmitted = rows.filter((r) => r.identity == null).length;
  return freeze({ version: SCAN_VERSION, id: fnv1a64(rowKeys(rows).join("\n")), origin, revision,
    scannedAt, rows: rows.map((r) => ({ ...r, reasons: [...r.reasons] })), presets: rows.length,
    scored, unscored: rows.length - scored - unadmitted, unadmitted });
}

/** sha-256 over the sorted row keys via `globalThis.crypto.subtle` when present,
 * else the documented FNV-1a 64-bit hex fallback (jsdom lacks subtle). */
export async function scanRecordId(rows: ScanRow[]): Promise<string> {
  const payload = rowKeys(rows).join("\n");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fnv1a64(payload);
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function scanRowDelta(before: ScanRow | undefined, after: ScanRow): ScanRowDelta {
  const currentStrike = after.dominantStrike ?? null;
  if (!before) {
    // No previous row — a first appearance is a fact, not a movement.
    return { preset: after.preset, nodeMoved: false, previousStrike: null, currentStrike,
      contestedChanged: false, scoreDelta: null, statusChanged: false };
  }
  const previousStrike = before.dominantStrike ?? null;
  const gone = (v: number | null) => v == null;
  const nodeMoved = gone(previousStrike) !== gone(currentStrike)
    || (previousStrike != null && currentStrike != null && previousStrike !== currentStrike);
  const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  return { preset: after.preset, nodeMoved, previousStrike, currentStrike,
    contestedChanged: (before.contested ?? false) !== (after.contested ?? false),
    scoreDelta: finite(before.score) && finite(after.score) ? after.score - before.score : null,
    statusChanged: before.status !== after.status };
}

/** Append a NEW revision. `original` is returned by reference and is never
 * rebuilt, reordered or rewritten — a refresh can never overwrite it. */
export function refreshScan(previous: ScanRefresh | ScanRecord, rows: ScanRow[], scannedAt: number): ScanRefresh {
  const original = "original" in previous ? previous.original : previous;
  const history = "original" in previous ? previous.history : [previous];
  const latest = buildScanRecord(rows, scannedAt, "refresh", history.length + 1);
  const previousRows = history[history.length - 1].rows;
  const deltas = freeze(latest.rows.map((after) => scanRowDelta(
    previousRows.find((r) => r.preset === after.preset), after)));
  return { original, latest, history: freeze([...history, latest]), deltas };
}

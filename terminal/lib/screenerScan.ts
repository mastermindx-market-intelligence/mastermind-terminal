// ── Screener scan contract (family-neutral) ─────────────────────────────────
// The Screener's own manifest carries only price/identity fields plus a sparse flagship
// verdict for ~1% of the universe. Every additional screenable family (technical state E01,
// period-aware fundamentals E02, cross-market classification E03) arrives as ONE compact,
// producer-built scan document per family, read once per screen — never per ticker. This
// module is the part those families share:
//
//   • the published envelope (`mastermind.screener_scan/v1`) and its validator;
//   • the four coverage populations a requested universe is partitioned into;
//   • three-valued filter logic where an UNKNOWN value never passes a filter by accident;
//   • the publication rule that an incomplete generation never supersedes a complete one.
//
// Pure and dependency-free so it runs in the browser, in vitest (Node) and as the reference
// the Python producer's guard mirrors. Family-specific row shapes live in their own modules
// (lib/technicalScan.ts for E01); nothing here knows about a particular field.

export const SCREENER_SCAN_SCHEMA = "mastermind.screener_scan/v1";

// ── Coverage ────────────────────────────────────────────────────────────────
// Every requested id lands in exactly ONE population. They are disjoint and exhaustive, so
// evaluated + stale + unsupported + unavailable === the requested universe (AC-E01-02).
//
//   evaluated   — the canonical engine/source produced a current value for this id.
//   stale       — a value exists but is not current (older engine, aged cutoff, old
//                 generation…). It is SHOWN with its age; it never satisfies a filter.
//   unsupported — the source cannot produce this field for this id by design (rates series,
//                 a timeframe the producer does not emit, a cutoff it cannot qualify…).
//   unavailable — it should exist but does not (no data, not processed, scan missing or
//                 unreadable, malformed row). Absence of evidence, never a negative signal.
export type CoverageStatus = "evaluated" | "stale" | "unsupported" | "unavailable";
export const COVERAGE_STATUSES: readonly CoverageStatus[] = ["evaluated", "stale", "unsupported", "unavailable"] as const;
const COVERAGE_SET: ReadonlySet<string> = new Set(COVERAGE_STATUSES);
export const isCoverageStatus = (v: unknown): v is CoverageStatus => typeof v === "string" && COVERAGE_SET.has(v);

/** One id's coverage verdict. `reason` is a stable snake_case code ("ok" when evaluated). */
export type Coverage = { status: CoverageStatus; reason: string };

/** Reason codes are stable snake_case tokens so a lexicon can label them in EN/ZH. */
export const REASON_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const isReasonCode = (v: unknown): v is string => typeof v === "string" && REASON_RE.test(v);

// ── Cells and three-valued matching ─────────────────────────────────────────
// A screenable value is a cell: either known, or unknown WITH the reason it is unknown.
// `status` on an unknown cell is the row's coverage population; an evaluated row whose field
// is individually missing yields `{known:false, status:"evaluated", reason:"field_null"}`.
export type ScanCell<T> =
  | { known: true; value: T }
  | { known: false; status: CoverageStatus; reason: string };

export const knownCell = <T>(value: T): ScanCell<T> => ({ known: true, value });
export const unknownCell = <T = never>(status: CoverageStatus, reason: string): ScanCell<T> =>
  ({ known: false, status, reason });

/**
 * Kleene three-valued result of one predicate against one row.
 *   pass    — the value is known and satisfies the predicate (or unknown was opted in).
 *   fail    — the value is known and does not satisfy it.
 *   unknown — the value is unknown; the row is neither included nor called a negative.
 * Only `pass` admits a row to the result set (see `passes`).
 */
export type ScanMatch = "pass" | "fail" | "unknown";

/** The single admission gate. A filter keeps a row iff its combined match is "pass". */
export const passes = (m: ScanMatch): boolean => m === "pass";

/**
 * Per-predicate opt-in. `includeUnknown: true` is the ONLY way an unknown value passes a
 * value predicate — it is an explicit user choice ("include names with no value"), never a
 * default. Absent or false ⇒ unknown stays unknown and the row is excluded.
 */
export type UnknownPolicy = { includeUnknown?: boolean };

/** Apply a value test to a cell under the unknown policy. `test` sees known values only. */
export function matchCell<T>(cell: ScanCell<T>, test: (value: T) => boolean, policy?: UnknownPolicy): ScanMatch {
  if (!cell.known) return policy?.includeUnknown === true ? "pass" : "unknown";
  return test(cell.value) ? "pass" : "fail";
}

/** The explicit "is unknown" predicate: passes exactly the unknown cells. Never "unknown". */
export function matchUnknown<T>(cell: ScanCell<T>): ScanMatch {
  return cell.known ? "fail" : "pass";
}

/**
 * Inclusive numeric range. A known but non-finite number (NaN/±Infinity) is treated as
 * unknown — it can never satisfy a threshold. An empty range ({}) passes any finite value.
 * Units are the caller's job: `gte`/`lte` must already be in the cell's stored units (E02:
 * a fraction field compares against 0.15, not 15 — scale once, at the UI boundary).
 */
export function matchRange(cell: ScanCell<number>, range: { gte?: number; lte?: number }, policy?: UnknownPolicy): ScanMatch {
  if (cell.known && !Number.isFinite(cell.value)) {
    return policy?.includeUnknown === true ? "pass" : "unknown";
  }
  return matchCell(cell, (v) => (range.gte === undefined || v >= range.gte) && (range.lte === undefined || v <= range.lte), policy);
}

/** Membership in a value set (single `eq` is `matchIn(cell, [v])`). */
export function matchIn<T>(cell: ScanCell<T>, values: readonly T[], policy?: UnknownPolicy): ScanMatch {
  return matchCell(cell, (v) => values.includes(v), policy);
}

/**
 * Kleene AND across a row's predicates: any fail ⇒ fail; else any unknown ⇒ unknown; else
 * pass. A known contradiction outranks missing evidence, so a row is called a negative only
 * when some known value actually fails. No predicates ⇒ pass (an empty screen filters nothing).
 */
export function combineAll(matches: Iterable<ScanMatch>): ScanMatch {
  let sawUnknown = false;
  for (const m of matches) {
    if (m === "fail") return "fail";
    if (m !== "pass") sawUnknown = true;
  }
  return sawUnknown ? "unknown" : "pass";
}

// ── Coverage accounting ─────────────────────────────────────────────────────

export type CoverageAccount = {
  /** Distinct requested ids. Always === evaluated + stale + unsupported + unavailable. */
  total: number;
  evaluated: number;
  stale: number;
  unsupported: number;
  unavailable: number;
  /** status → reason → count. Every counted id appears under exactly one reason. */
  byReason: Record<CoverageStatus, Record<string, number>>;
};

/**
 * Partition a requested universe into the four populations. Ids are de-duplicated (the
 * universe is a set of listings, keyed by exact symbol); a classifier that returns anything
 * outside the four statuses is counted as unavailable/`invalid_coverage` rather than dropped,
 * so the sum invariant holds for every input.
 */
export function accountCoverage(requestedIds: Iterable<string>, classify: (id: string) => Coverage): CoverageAccount {
  const acct: CoverageAccount = {
    total: 0, evaluated: 0, stale: 0, unsupported: 0, unavailable: 0,
    byReason: { evaluated: {}, stale: {}, unsupported: {}, unavailable: {} },
  };
  const seen = new Set<string>();
  for (const id of requestedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    let c: Coverage;
    try {
      c = classify(id);
    } catch {
      c = { status: "unavailable", reason: "invalid_coverage" };
    }
    const ok = c != null && isCoverageStatus(c.status) && isReasonCode(c.reason);
    const status: CoverageStatus = ok ? c.status : "unavailable";
    const reason = ok ? c.reason : "invalid_coverage";
    acct.total += 1;
    acct[status] += 1;
    acct.byReason[status][reason] = (acct.byReason[status][reason] ?? 0) + 1;
  }
  return acct;
}

// ── Envelope ────────────────────────────────────────────────────────────────
// Every family document carries this envelope. `rows` is family-shaped; the envelope only
// guarantees each row is an object with a unique, non-empty string `sym` and that the row
// count equals the declared requested universe — a row may be unsupported/unavailable, but
// it may not be missing.

export type ScanUniverse = {
  /** Which universe was requested. v1 has one: the Screener manifest. */
  source: "manifest";
  /** The manifest's own `as_of` the producer enumerated. */
  as_of: string;
  /** Number of requested ids; rows.length must equal it. */
  count: number;
};

export type ScanEnvelope<R> = {
  schema: typeof SCREENER_SCAN_SCHEMA;
  family: string;
  family_version: number;
  /** Publication generation: integer epoch SECONDS, strictly increasing per family. */
  generation: number;
  /** ISO-8601 instant the generation was built (the age clock for generation staleness). */
  generated_at: string;
  /** Parsed `generated_at`, epoch ms. */
  generatedAtMs: number;
  /** True iff every requested id was processed in this generation (see family rules). */
  complete: boolean;
  universe: ScanUniverse;
  rows: R[];
};

export type ScanRawRow = { sym: string } & Record<string, unknown>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Validate the shared envelope. Rejects (never partially accepts) a document that:
 *   • is not `mastermind.screener_scan/v1`, or is another family, or a family_version this
 *     reader does not support — an unknown version is unread, not guessed at;
 *   • lacks an integer generation > 0 or a parseable `generated_at`, or a boolean `complete`;
 *   • declares a universe whose count differs from rows.length (a dropped row);
 *   • has a row that is not an object with a non-empty string `sym`, or repeats a `sym`
 *     (one listing, one row — no ticker-string collision).
 */
export function parseScanEnvelope(
  raw: unknown,
  family: string,
  supportedVersions: readonly number[],
): ParseResult<ScanEnvelope<ScanRawRow>> {
  if (!isObj(raw)) return { ok: false, error: "not_an_object" };
  if (raw.schema !== SCREENER_SCAN_SCHEMA) return { ok: false, error: "schema_unsupported" };
  if (raw.family !== family) return { ok: false, error: "family_mismatch" };
  if (typeof raw.family_version !== "number" || !supportedVersions.includes(raw.family_version)) {
    return { ok: false, error: "family_version_unsupported" };
  }
  if (!isNonNegInt(raw.generation) || raw.generation <= 0) return { ok: false, error: "generation_invalid" };
  const generatedAtMs = typeof raw.generated_at === "string" ? Date.parse(raw.generated_at) : NaN;
  if (!Number.isFinite(generatedAtMs)) return { ok: false, error: "generated_at_invalid" };
  if (typeof raw.complete !== "boolean") return { ok: false, error: "complete_invalid" };
  const u = raw.universe;
  if (!isObj(u) || u.source !== "manifest" || typeof u.as_of !== "string" || !isNonNegInt(u.count)) {
    return { ok: false, error: "universe_invalid" };
  }
  if (!Array.isArray(raw.rows)) return { ok: false, error: "rows_invalid" };
  if (raw.rows.length !== u.count) return { ok: false, error: "row_count_mismatch" };
  const seen = new Set<string>();
  for (const r of raw.rows) {
    if (!isObj(r) || typeof r.sym !== "string" || r.sym.length === 0) return { ok: false, error: "row_identity_invalid" };
    if (seen.has(r.sym)) return { ok: false, error: "row_identity_duplicate" };
    seen.add(r.sym);
  }
  return {
    ok: true,
    value: {
      schema: SCREENER_SCAN_SCHEMA,
      family,
      family_version: raw.family_version,
      generation: raw.generation,
      generated_at: raw.generated_at as string,
      generatedAtMs,
      complete: raw.complete,
      universe: { source: "manifest", as_of: u.as_of, count: u.count },
      rows: raw.rows as ScanRawRow[],
    },
  };
}

// ── Generation adoption (publication + client hold) ─────────────────────────
// One rule, applied twice: by the producer before it atomically replaces the published file,
// and by the client when a revalidation returns a different document than the one it holds.

export type GenerationMeta = { generation: number; complete: boolean };

export type AdoptReason =
  | "invalid_incoming"          // incoming failed validation → keep whatever is held
  | "first"                     // nothing held → adopt (an incomplete first scan is labelled, not hidden)
  | "not_newer"                 // incoming.generation <= held → never move backwards or sideways
  | "newer_complete"            // newer and complete → adopt
  | "incomplete_over_complete"  // newer but incomplete while a complete one is held → HOLD (AC-E01-03)
  | "newer_incomplete";         // newer incomplete replacing an incomplete one → adopt

export type AdoptDecision = { adopt: boolean; reason: AdoptReason };

export function adoptGeneration(current: GenerationMeta | null, incoming: GenerationMeta | null): AdoptDecision {
  if (incoming == null || !isNonNegInt(incoming.generation) || incoming.generation <= 0 || typeof incoming.complete !== "boolean") {
    return { adopt: false, reason: "invalid_incoming" };
  }
  if (current == null) return { adopt: true, reason: "first" };
  if (incoming.generation <= current.generation) return { adopt: false, reason: "not_newer" };
  if (incoming.complete) return { adopt: true, reason: "newer_complete" };
  if (current.complete) return { adopt: false, reason: "incomplete_over_complete" };
  return { adopt: true, reason: "newer_incomplete" };
}

const DAY_MS = 86_400_000;

/** Whole-and-fractional days since the generation was built (negative clamps to 0). */
export function generationAgeDays(env: { generatedAtMs: number }, now: Date | number): number {
  const t = typeof now === "number" ? now : now.getTime();
  return Math.max(0, (t - env.generatedAtMs) / DAY_MS);
}

// ── Classification scan (E03): native taxonomies and listing currency ─────────
// The Screener screens across markets on the classifications each listing's OWNER record
// already states, and labels every money column with that listing's trading currency. The
// producer (ingest/gen_classification_scan.py) copies labels verbatim from `<SYM>.fund.json`
// and attributes a label to a taxonomy only when the record's own provenance proves which one;
// nothing here classifies, infers a currency from a ticker suffix, or converts money.
//
// Contract identity per listing (family "classification" v1, envelope = screenerScan):
//   listing identity   row.sym — the exact manifest key. Two listings of one issuer (0700.HK in
//                      HKD and 80700.HK in CNY; BABA in USD and 9988.HK in HKD) are two rows.
//   venue              row.mkt / row.sec, copied verbatim from the manifest
//   currency           row.currency — the owner record's quote_currency (GBp = pence, kept
//                      exact) or the crypto catalog's USD; indices, rates, FX and futures are
//                      unsupported/currency_not_applicable (their price x volume is not money)
//   classification     row.class[taxonomy] — one cell per NATIVE taxonomy, each naming its
//                      authority in `taxonomies`; `crosswalks` is empty in v1 (there is no
//                      approved mapping between these taxonomies, so none is fabricated)
//   label provenance   cell.as_of (owner record emission date) + cell.source; the manifest's
//                      undated `gics` reference snapshot only ever arrives as stale
//   generation         envelope.generation / generated_at / complete
//
// A taxonomy is chosen per screen; a label is never re-filed under another taxonomy, and a
// stale or missing label never passes as a current one.

import { canonicalChartSymbol } from "./terminalBoot";
import {
  accountCoverage,
  adoptGeneration,
  generationAgeDays,
  isReasonCode,
  knownCell,
  matchCell,
  matchUnknown,
  parseScanEnvelope,
  unknownCell,
  type AdoptDecision,
  type Coverage,
  type CoverageAccount,
  type CoverageStatus,
  type ParseResult,
  type ScanCell,
  type ScanEnvelope,
  type ScanMatch,
} from "./screenerScan";

export const CLASSIFICATION_SCAN_FAMILY = "classification";
export const CLASSIFICATION_SCAN_VERSION = 1;
export const CLASSIFICATION_SCAN_SUPPORTED_VERSIONS: readonly number[] = [CLASSIFICATION_SCAN_VERSION];
/** One bounded read per screen, beside E01's scan/technical.json (gitignored nightly output). */
export const CLASSIFICATION_SCAN_URL = "/data/scan/classification.json";

// Staleness clocks (calendar days). Exported so the UI can state them and tests pin them.
/** A generation older than this makes every evaluated label stale/generation_stale. */
export const CLASSIFICATION_GENERATION_MAX_AGE_DAYS = 4;
/** An owner record whose emission date is older than this is stale/classification_aged: the
 *  lane that writes it has stopped refreshing, so the label is shown with its date and kept
 *  out of a "current" filter. Six weeks absorbs a missed monthly refresh. */
export const CLASSIFICATION_RECORD_MAX_AGE_DAYS = 45;

// ── Taxonomies and closed vocabularies ──────────────────────────────────────
export const TAXONOMY_IDS = ["gics_sector", "yahoo_sector", "yahoo_industry", "cn_profile_sector"] as const;
export type TaxonomyId = (typeof TAXONOMY_IDS)[number];
const TAXONOMY_SET: ReadonlySet<string> = new Set(TAXONOMY_IDS);
export const isTaxonomyId = (v: unknown): v is TaxonomyId => typeof v === "string" && TAXONOMY_SET.has(v);

/** Sector-level taxonomies, in the order the sector column falls back through them. */
export const SECTOR_TAXONOMIES: readonly TaxonomyId[] = ["gics_sector", "yahoo_sector", "cn_profile_sector"];

/** GICS sectors (MSCI / S&P DJI). The labels the producer attributes to `gics_sector`. */
export const GICS_SECTORS = [
  "Communication Services", "Consumer Discretionary", "Consumer Staples", "Energy",
  "Financials", "Health Care", "Industrials", "Information Technology", "Materials",
  "Real Estate", "Utilities",
] as const;

/** Yahoo Finance sectors. The labels the producer attributes to `yahoo_sector`. */
export const YAHOO_SECTORS = [
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive",
  "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology",
  "Utilities",
] as const;

// ── Reason vocabulary ───────────────────────────────────────────────────────
// Producer reasons ride in the document (pinned to ingest/gen_classification_scan.py REASONS
// by tests/test_classification_scan_producer.py — keep each list on one line). Consumer reasons
// are derived here and are RESERVED: a document that emits one is malformed at that row.
export const CLASSIFICATION_PRODUCER_REASONS = {
  stale: ["snapshot_undated", "record_undated"],
  unsupported: ["taxonomy_ambiguous", "taxonomy_not_supplied", "label_outside_vocabulary", "asset_class_not_covered", "lane_unrecognized", "currency_not_applicable"],
  unavailable: ["not_classified", "no_fund_record", "record_unreadable", "currency_missing", "not_in_catalog", "not_processed"],
} as const;

export const CLASSIFICATION_CONSUMER_REASONS = {
  evaluated: ["ok"],
  stale: ["classification_aged", "generation_stale"],
  unavailable: ["scan_absent", "scan_unavailable", "not_in_scan", "malformed_row"],
} as const;

type ProducerStatus = "stale" | "unsupported" | "unavailable";
const PRODUCER_STATUS_OF: ReadonlyMap<string, ProducerStatus> = new Map([
  ...CLASSIFICATION_PRODUCER_REASONS.stale.map((r) => [r, "stale"] as const),
  ...CLASSIFICATION_PRODUCER_REASONS.unsupported.map((r) => [r, "unsupported"] as const),
  ...CLASSIFICATION_PRODUCER_REASONS.unavailable.map((r) => [r, "unavailable"] as const),
]);
const RESERVED_REASONS: ReadonlySet<string> = new Set([
  ...CLASSIFICATION_CONSUMER_REASONS.evaluated,
  ...CLASSIFICATION_CONSUMER_REASONS.stale,
  ...CLASSIFICATION_CONSUMER_REASONS.unavailable,
]);

export const LABEL_SOURCES = ["fund_profile", "manifest_gics"] as const;
export const CURRENCY_SOURCES = ["fund_quote_currency", "crypto_catalog"] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];
export type CurrencySource = (typeof CURRENCY_SOURCES)[number];
const LABEL_SOURCE_SET: ReadonlySet<string> = new Set(LABEL_SOURCES);
const CURRENCY_SOURCE_SET: ReadonlySet<string> = new Set(CURRENCY_SOURCES);

/** ISO 4217 codes plus Yahoo's minor-unit quotes (GBp pence, ZAc cents, ILA agorot). */
export const CURRENCY_RE = /^(?:[A-Z]{3}|[A-Z]{2}[a-z]|ILA)$/;

// ── Document types ──────────────────────────────────────────────────────────

export type Taxonomy = {
  id: TaxonomyId;
  name: string;
  authority: string;
  level: "sector" | "industry";
  /** The authority's published version, when the source states one (none do today). */
  version: string | null;
  /** Closed vocabulary, or null for an open one (industries, the CN profile). */
  labels: readonly string[] | null;
  /** Labels the owner uses to mean "no classification" (the CN profile's "A-share"). */
  unclassifiedSentinels: readonly string[];
  /** Where the producer reads it — shown verbatim as provenance. */
  source: string;
};

export type ClassLabelCell =
  | { status: "evaluated"; reason: "ok"; label: string; as_of: string; source: LabelSource; reclassified_from: string | null }
  | { status: "stale"; reason: string; label: string; as_of: null; source: LabelSource; reclassified_from: string | null }
  | { status: "unsupported" | "unavailable"; reason: string; label: string | null };

export type CurrencyCell =
  | { status: "evaluated"; reason: "ok"; code: string; as_of: string | null; source: CurrencySource }
  | { status: "unsupported" | "unavailable"; reason: string };

export type ClassificationRow =
  | {
      kind: "row"; sym: string; mkt: string | null; sec: string | null;
      /** Owner-record lane (provenance only), e.g. "yfinance_profile". */
      lane: string | null;
      currency: CurrencyCell;
      class: Readonly<Record<TaxonomyId, ClassLabelCell>>;
    }
  | { kind: "malformed"; sym: string; mkt: string | null; sec: string | null; error: string };

export type ClassificationScan = Omit<ScanEnvelope<never>, "rows"> & {
  taxonomies: Readonly<Record<TaxonomyId, Taxonomy>>;
  /** Exact sym → row. Size === universe.count. */
  rows: ReadonlyMap<string, ClassificationRow>;
};

// ── Parsing ─────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);
const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && DATE_RE.test(v) && Number.isFinite(dayMs(v)) && new Date(dayMs(v)).toISOString().slice(0, 10) === v;
const isLabel = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v === v.trim() && v.length <= 160;
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");

function parseTaxonomy(id: TaxonomyId, raw: unknown): Taxonomy | null {
  if (!isObj(raw)) return null;
  const { name, authority, level, version, labels, source } = raw;
  if (!isLabel(name) || !isLabel(authority) || typeof source !== "string") return null;
  if (level !== "sector" && level !== "industry") return null;
  if (version !== null && version !== undefined && !isLabel(version)) return null;
  if (labels !== null && labels !== undefined && !(isStrList(labels) && labels.length > 0)) return null;
  const sentinels = raw.unclassified_sentinels ?? [];
  if (!isStrList(sentinels)) return null;
  return {
    id, name, authority, level, source,
    version: (version as string | null | undefined) ?? null,
    labels: labels ? [...(labels as string[])] : null,
    unclassifiedSentinels: [...sentinels],
  };
}

/** Producer status ↔ reason agreement; null when the pair is acceptable. */
function reasonError(status: ProducerStatus, reason: string): string | null {
  if (RESERVED_REASONS.has(reason)) return "reason_reserved";
  const expected = PRODUCER_STATUS_OF.get(reason);
  if (expected !== undefined && expected !== status) return "reason_status_mismatch";
  return null;
}

function parseLabelCell(raw: unknown, tax: Taxonomy): ClassLabelCell | string {
  if (!isObj(raw)) return "cell_invalid";
  const { status, reason } = raw;
  if (!isReasonCode(reason)) return "reason_invalid";
  const rf = raw.reclassified_from ?? null;
  if (rf !== null && !isLabel(rf)) return "reclassified_from_invalid";
  if (status === "evaluated") {
    if (reason !== "ok") return "reason_status_mismatch";
    if (!isLabel(raw.label)) return "label_invalid";
    if (!isIsoDate(raw.as_of)) return "as_of_invalid";
    if (typeof raw.source !== "string" || !LABEL_SOURCE_SET.has(raw.source)) return "source_invalid";
    // A label filed under a closed taxonomy must be one of that taxonomy's own labels.
    if (tax.labels && !tax.labels.includes(raw.label)) return "label_not_in_taxonomy";
    if (tax.unclassifiedSentinels.includes(raw.label)) return "label_is_sentinel";
    return { status, reason, label: raw.label, as_of: raw.as_of, source: raw.source as LabelSource, reclassified_from: rf };
  }
  if (status !== "stale" && status !== "unsupported" && status !== "unavailable") return "status_invalid";
  const re = reasonError(status, reason);
  if (re) return re;
  const label = raw.label ?? null;
  if (label !== null && !isLabel(label)) return "label_invalid";
  if (status === "stale") {
    // A stale label is SHOWN (with its age), so it must say what it is and where it came from.
    if (label === null) return "label_invalid";
    if ((raw.as_of ?? null) !== null) return "as_of_invalid";
    if (typeof raw.source !== "string" || !LABEL_SOURCE_SET.has(raw.source)) return "source_invalid";
    return { status, reason, label, as_of: null, source: raw.source as LabelSource, reclassified_from: rf };
  }
  return { status, reason, label };
}

function parseCurrencyCell(raw: unknown): CurrencyCell | string {
  if (!isObj(raw)) return "currency_invalid";
  const { status, reason } = raw;
  if (!isReasonCode(reason)) return "currency_reason_invalid";
  if (status === "evaluated") {
    if (reason !== "ok") return "currency_reason_status_mismatch";
    if (typeof raw.code !== "string" || !CURRENCY_RE.test(raw.code)) return "currency_code_invalid";
    const asOf = raw.as_of ?? null;
    if (asOf !== null && !isIsoDate(asOf)) return "currency_as_of_invalid";
    if (typeof raw.source !== "string" || !CURRENCY_SOURCE_SET.has(raw.source)) return "currency_source_invalid";
    return { status, reason, code: raw.code, as_of: asOf, source: raw.source as CurrencySource };
  }
  // A listing's trading currency is a fact or unknown; it is never "stale".
  if (status !== "unsupported" && status !== "unavailable") return "currency_status_invalid";
  const re = reasonError(status, reason);
  if (re) return `currency_${re}`;
  return { status, reason };
}

/**
 * Validate a classification scan document. Whole-document rejections (the reader then has no
 * scan — see ClassificationScanSource "error"): any envelope failure (screenerScan), a taxonomy
 * table that is not exactly the v1 set, a non-empty `crosswalks` (v1 has no approved mapping;
 * one appearing is a contract change, never something to apply silently), or `complete:true`
 * while any cell reports `not_processed`.
 *
 * Row-level problems never drop the row: it is kept as `{kind:"malformed"}` and classified
 * unavailable/malformed_row, so the coverage sum still equals the requested universe.
 */
export function parseClassificationScan(raw: unknown): ParseResult<ClassificationScan> {
  const env = parseScanEnvelope(raw, CLASSIFICATION_SCAN_FAMILY, CLASSIFICATION_SCAN_SUPPORTED_VERSIONS);
  if (!env.ok) return env;
  const doc = raw as Record<string, unknown>;

  if (!isObj(doc.taxonomies)) return { ok: false, error: "taxonomies_invalid" };
  const keys = Object.keys(doc.taxonomies);
  if (keys.length !== TAXONOMY_IDS.length || !keys.every(isTaxonomyId)) return { ok: false, error: "taxonomies_invalid" };
  const taxonomies = {} as Record<TaxonomyId, Taxonomy>;
  for (const id of TAXONOMY_IDS) {
    const t = parseTaxonomy(id, doc.taxonomies[id]);
    if (!t) return { ok: false, error: "taxonomies_invalid" };
    taxonomies[id] = t;
  }
  if (!isObj(doc.crosswalks)) return { ok: false, error: "crosswalks_invalid" };
  if (Object.keys(doc.crosswalks).length > 0) return { ok: false, error: "crosswalks_unsupported" };

  const rows = new Map<string, ClassificationRow>();
  let notProcessed = 0;
  for (const r of env.value.rows) {
    const mkt = typeof r.mkt === "string" && r.mkt ? r.mkt : null;
    const sec = typeof r.sec === "string" && r.sec ? r.sec : null;
    const bad = (error: string) => rows.set(r.sym, { kind: "malformed", sym: r.sym, mkt, sec, error });
    if ((r.mkt != null && typeof r.mkt !== "string") || (r.sec != null && typeof r.sec !== "string")) { bad("identity_invalid"); continue; }
    const lane = r.lane ?? null;
    if (lane !== null && !isReasonCode(lane)) { bad("lane_invalid"); continue; }
    const currency = parseCurrencyCell(r.currency);
    if (typeof currency === "string") { bad(currency); continue; }
    if (!isObj(r.class)) { bad("class_invalid"); continue; }
    const cls = r.class as Record<string, unknown>;
    const cells = {} as Record<TaxonomyId, ClassLabelCell>;
    let error: string | null = null;
    for (const id of TAXONOMY_IDS) {
      const c = parseLabelCell(cls[id], taxonomies[id]);
      if (typeof c === "string") { error = `${id}:${c}`; break; }
      cells[id] = c;
    }
    if (error) { bad(error); continue; }
    if (currency.reason === "not_processed" || TAXONOMY_IDS.some((id) => cells[id].reason === "not_processed")) notProcessed += 1;
    rows.set(r.sym, { kind: "row", sym: r.sym, mkt, sec, lane, currency, class: cells });
  }
  if (env.value.complete && notProcessed > 0) return { ok: false, error: "complete_with_not_processed" };

  const { rows: _drop, ...meta } = env.value;
  void _drop;
  return { ok: true, value: { ...meta, taxonomies, rows } };
}

// ── Reader state ────────────────────────────────────────────────────────────
// What the consumer holds once a read SETTLES. "Loading" is not a population and is rendered
// by the caller (failure-state-truth law: loading, empty, error and stale are distinct).
export type ClassificationScanSource =
  | { kind: "ready"; scan: ClassificationScan; refreshFailed?: boolean }
  | { kind: "absent" }                 // HTTP 404 — no generation has ever been published
  | { kind: "error"; error: string };  // network failure, non-JSON body, or rejected document

/** Adapt one HTTP read to a source. 404 ⇒ absent; 2xx + valid ⇒ ready; anything else ⇒ error. */
export function readClassificationScanResponse(httpStatus: number, body: unknown): ClassificationScanSource {
  if (httpStatus === 404) return { kind: "absent" };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: "error", error: `http_${httpStatus}` };
  const parsed = parseClassificationScan(body);
  return parsed.ok ? { kind: "ready", scan: parsed.value } : { kind: "error", error: parsed.error };
}

/**
 * Fold a revalidation into what the reader holds — E01's one adoption rule: an incomplete
 * generation never displaces a complete one, nothing older or equal replaces what is held, and
 * a failed or absent refresh keeps the held scan flagged `refreshFailed` so the UI labels it.
 */
export function nextClassificationSource(
  held: ClassificationScanSource | null,
  incoming: ClassificationScanSource,
): { source: ClassificationScanSource; decision: AdoptDecision | null } {
  const heldScan = held?.kind === "ready" ? held.scan : null;
  if (incoming.kind !== "ready") {
    if (heldScan) return { source: { kind: "ready", scan: heldScan, refreshFailed: true }, decision: null };
    return { source: incoming, decision: null };
  }
  const decision = adoptGeneration(heldScan, incoming.scan);
  if (decision.adopt || !heldScan) return { source: { kind: "ready", scan: incoming.scan }, decision };
  return { source: { kind: "ready", scan: heldScan }, decision };
}

// ── Classification ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const nowMs = (now: Date | number): number => (typeof now === "number" ? now : now.getTime());

export type LabelClassification = {
  taxonomy: TaxonomyId;
  coverage: Coverage;
  /** The cell as published — present for every row the scan carries, so a stale, ambiguous or
   *  out-of-vocabulary label can still be SHOWN. Only an evaluated coverage ever filters. */
  cell: ClassLabelCell | null;
};

/**
 * Classify one listing under one taxonomy. First matching rule wins:
 *   source absent / error            → unavailable  scan_absent / scan_unavailable
 *   sym not in scan                  → unavailable  not_in_scan
 *   malformed row                    → unavailable  malformed_row
 *   producer stale/unsup./unavail.   → that status  producer reason
 *   evaluated, generation too old    → stale        generation_stale
 *   evaluated, record date too old   → stale        classification_aged
 *   evaluated                        → evaluated    ok
 * `sym` is matched EXACTLY (no case folding, no suffix stripping): one listing, one row.
 */
export function classifyLabel(source: ClassificationScanSource, sym: string, taxonomy: TaxonomyId, now: Date | number): LabelClassification {
  const none = (status: CoverageStatus, reason: string): LabelClassification => ({ taxonomy, coverage: { status, reason }, cell: null });
  if (source.kind === "absent") return none("unavailable", "scan_absent");
  if (source.kind === "error") return none("unavailable", "scan_unavailable");
  const row = source.scan.rows.get(sym);
  if (!row) return none("unavailable", "not_in_scan");
  if (row.kind === "malformed") return none("unavailable", "malformed_row");
  const cell = row.class[taxonomy];
  if (cell.status !== "evaluated") return { taxonomy, coverage: { status: cell.status, reason: cell.reason }, cell };
  const stale = (reason: string): LabelClassification => ({ taxonomy, coverage: { status: "stale", reason }, cell });
  if (generationAgeDays(source.scan, now) > CLASSIFICATION_GENERATION_MAX_AGE_DAYS) return stale("generation_stale");
  if ((nowMs(now) - dayMs(cell.as_of)) / DAY_MS > CLASSIFICATION_RECORD_MAX_AGE_DAYS) return stale("classification_aged");
  return { taxonomy, coverage: { status: "evaluated", reason: "ok" }, cell };
}

/** The label a cell carries for DISPLAY (any status), or null when it carries none. */
export const labelOf = (c: LabelClassification): string | null => (c.cell && c.cell.label) || null;

/** Partition a requested universe under one taxonomy. Sum invariant per accountCoverage. */
export function accountClassificationCoverage(
  requestedIds: Iterable<string>,
  source: ClassificationScanSource,
  taxonomy: TaxonomyId,
  now: Date | number,
): CoverageAccount {
  return accountCoverage(requestedIds, (id) => classifyLabel(source, id, taxonomy, now).coverage);
}

export type CurrencyClassification = { coverage: Coverage; code: string | null; cell: CurrencyCell | null };

/**
 * The listing's trading currency. Known only from the scan's evaluated cell — never from the
 * ticker, the venue or a market default. A listing's currency is an attribute of the listing,
 * so it does not age with the generation; the generation's age is shown separately.
 */
export function classifyCurrency(source: ClassificationScanSource, sym: string): CurrencyClassification {
  const none = (status: CoverageStatus, reason: string): CurrencyClassification => ({ coverage: { status, reason }, code: null, cell: null });
  if (source.kind === "absent") return none("unavailable", "scan_absent");
  if (source.kind === "error") return none("unavailable", "scan_unavailable");
  const row = source.scan.rows.get(sym);
  if (!row) return none("unavailable", "not_in_scan");
  if (row.kind === "malformed") return none("unavailable", "malformed_row");
  const c = row.currency;
  if (c.status !== "evaluated") return { coverage: { status: c.status, reason: c.reason }, code: null, cell: c };
  return { coverage: { status: "evaluated", reason: "ok" }, code: c.code, cell: c };
}

// ── Cells and predicates ────────────────────────────────────────────────────

/** A label as a filterable cell: known ONLY when evaluated under that taxonomy. */
export function labelCellOf(c: LabelClassification): ScanCell<string> {
  if (c.coverage.status !== "evaluated" || !c.cell || !c.cell.label) return unknownCell(c.coverage.status, c.coverage.reason);
  return knownCell(c.cell.label);
}

/**
 * One native-taxonomy predicate. `labels` matches evaluated labels; `includeStale` ALSO
 * matches a stale label by its text (explicit opt-in, shown as such); `unclassified` selects
 * every listing whose read found no label at all in this taxonomy — neither current nor stale.
 * A listing whose record was not read (labelNotRead) matches neither: its label is unknown. So
 * current, stale, unclassified and not-read are four disjoint, countable populations.
 */
export type ClassificationPredicate =
  | { taxonomy: TaxonomyId; op: "in"; labels: string[]; includeStale?: boolean }
  | { taxonomy: TaxonomyId; op: "unclassified" };

/**
 * Reasons that mean a listing's owner record was NOT READ: the scan is absent or unreadable, the
 * listing has no row in it, its row is malformed, or the producer could not read the record or
 * never reached it. Such a listing's label is UNKNOWN — it is not "unclassified" (a read that
 * found no label), so it can neither match a label nor be selected as unclassified.
 * (`no_fund_record` is not here: the owner was read and holds nothing for the listing.)
 */
export const LABEL_NOT_READ_REASONS: ReadonlySet<string> = new Set<string>([
  ...CLASSIFICATION_CONSUMER_REASONS.unavailable,
  "record_unreadable",
  "not_processed",
]);

/** True when this classification stands for a failed or absent read, not for a label's absence. */
export const labelNotRead = (c: LabelClassification): boolean =>
  c.coverage.status === "unavailable" && LABEL_NOT_READ_REASONS.has(c.coverage.reason);

export function matchClassification(c: LabelClassification, p: ClassificationPredicate): ScanMatch {
  if (p.op === "unclassified") {
    // A failed read is not an empty result: an unread label is unknown, never "has no label".
    if (labelNotRead(c)) return "unknown";
    if (c.coverage.status === "stale" && labelOf(c) !== null) return "fail";
    return matchUnknown(labelCellOf(c));
  }
  if (p.includeStale === true && c.coverage.status === "stale") {
    const l = labelOf(c);
    return l !== null && p.labels.includes(l) ? "pass" : "fail";
  }
  return matchCell(labelCellOf(c), (v) => p.labels.includes(v));
}

/** Validate a persisted predicate: unknown taxonomies and empty label sets are rejected, never
 *  dropped (dropping a predicate would widen the screen). */
export function parseClassificationPredicate(raw: unknown): ParseResult<ClassificationPredicate> {
  if (!isObj(raw) || !isTaxonomyId(raw.taxonomy)) return { ok: false, error: "predicate_taxonomy_unknown" };
  if (raw.op === "unclassified") return { ok: true, value: { taxonomy: raw.taxonomy, op: "unclassified" } };
  if (raw.op !== "in" || !Array.isArray(raw.labels) || raw.labels.length === 0 || !raw.labels.every(isLabel)) {
    return { ok: false, error: "predicate_labels_invalid" };
  }
  if (raw.includeStale !== undefined && typeof raw.includeStale !== "boolean") return { ok: false, error: "predicate_include_stale_invalid" };
  return {
    ok: true,
    value: { taxonomy: raw.taxonomy, op: "in", labels: [...(raw.labels as string[])], ...(raw.includeStale === true ? { includeStale: true } : {}) },
  };
}

// ── Navigation (AC-E03-01) ──────────────────────────────────────────────────

/** The chart link for EXACTLY this listing — encoded, never re-derived from an issuer, never
 *  swapped for another listing of the same company. Null when the chart cannot open it. */
export function listingHref(sym: unknown): string | null {
  const symbol = canonicalChartSymbol(sym);
  return symbol ? `/terminal?sym=${encodeURIComponent(symbol)}` : null;
}

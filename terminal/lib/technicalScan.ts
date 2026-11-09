// ── Technical scan (E01): full-universe, timeframe-specific engine state ─────
// The Screener can filter on the canonical signal engine's CURRENT state for every manifest
// symbol — not only the ~1% flagship names whose verdict rides on the manifest. The producer
// (ingest/gen_technical_scan.py, phase 2) projects each per-symbol slice's existing
// `mastermind.indicator/v1` output into one compact document; nothing here computes a
// signal, re-derives a bar phase, or touches OHLC. A name the engine could not qualify is
// carried as unsupported/unavailable coverage, never as a negative signal.
//
// Contract identity per observation (the frozen additive fields):
//   symbol identity        row.sym (exact manifest key) + row.mkt / row.sec (manifest venue
//                          label and asset class, copied verbatim for market grouping)
//   timeframe              the row.tf key, e.g. "3D" (only timeframes in `timeframes` exist)
//   completed-bar cutoff   cutoff.session (last daily session the engine consumed),
//                          cutoff.bar_open (opening session of the bar the state belongs to —
//                          the canonical 3D bar identity), cutoff.bar_closed (published phase)
//   engine version         observation.engine → engines[key] {indicator_id, engine,
//                          signal_era, source_hash}; the current one per timeframe is
//                          timeframes[tf].engine
//   observed state         observation.state — a verbatim allow-list projection of the
//                          engine's `state` block (deprecated `extended` dropped)
//   coverage reason        observation.status + reason (producer) → Coverage (consumer)
//   publication generation envelope.generation / generated_at / complete
//
// The scan never carries flagship track-record statistics (wr/pf/cagr/verdict); the
// manifest compatibility path for those is untouched and is never blended with this.

import { canonicalChartSymbol } from "./terminalBoot";
import { marketOf, type MarketId } from "./markets";
import { TF_CANONICAL_ORDER } from "./startTf";
import {
  adoptGeneration,
  combineAll,
  isReasonCode,
  knownCell,
  matchCell,
  matchIn,
  matchRange,
  matchUnknown,
  parseScanEnvelope,
  unknownCell,
  generationAgeDays,
  type AdoptDecision,
  type Coverage,
  type CoverageAccount,
  type CoverageStatus,
  type ParseResult,
  type ScanCell,
  type ScanEnvelope,
  type ScanMatch,
  accountCoverage,
} from "./screenerScan";

export const TECHNICAL_SCAN_FAMILY = "technical";
export const TECHNICAL_SCAN_VERSION = 1;
export const TECHNICAL_SCAN_SUPPORTED_VERSIONS: readonly number[] = [TECHNICAL_SCAN_VERSION];
/** One bounded read per screen. Lives under /data/scan/ so root-level `*.json` sweeps
 *  (gc_orphans, stamp_session_anchors) never mistake it for a per-symbol slice. */
export const TECHNICAL_SCAN_URL = "/data/scan/technical.json";

// Staleness clocks (calendar days). Exported so the UI can state them and tests pin them.
/** A generation older than this makes every observed row stale/generation_stale. */
export const SCAN_GENERATION_MAX_AGE_DAYS = 4;
/** A cutoff session older than this (vs now) is stale/cutoff_aged — covers long exchange
 *  holidays (Golden Week, Lunar New Year) without calling them current forever. */
export const SCAN_CUTOFF_MAX_AGE_DAYS = 10;
/** A cutoff more than this many days behind the newest observed cutoff in the same market
 *  group (lib/markets marketOf) is stale/cutoff_behind_market — one lagging name. */
export const MARKET_LAG_DAYS = 4;

// ── Reason vocabulary ───────────────────────────────────────────────────────
// Producer reasons ride in the document; consumer reasons are derived here and are RESERVED
// (a document that emits one is malformed at that row). Unknown producer codes that match the
// reason grammar are accepted under the producer's own status (forward compatibility within
// v1); a known code under the wrong status makes that row malformed.
export const TECHNICAL_PRODUCER_REASONS = {
  unsupported: ["rate_series", "single_value_series", "cutoff_unqualified", "not_leakfree"],
  unavailable: ["no_ohlc", "insufficient_history", "no_slice", "slice_unreadable", "not_processed"],
} as const;

export const TECHNICAL_CONSUMER_REASONS = {
  evaluated: ["ok"],
  stale: ["engine_mismatch", "generation_stale", "cutoff_aged", "cutoff_behind_market"],
  unsupported: ["timeframe_not_produced"],
  unavailable: ["scan_absent", "scan_unavailable", "not_in_scan", "malformed_row"],
} as const;

/** Field-level unknown inside an evaluated row (the engine published null for that key). */
export const FIELD_NULL_REASON = "field_null";

const PRODUCER_STATUS_OF: ReadonlyMap<string, "unsupported" | "unavailable"> = new Map([
  ...TECHNICAL_PRODUCER_REASONS.unsupported.map((r) => [r, "unsupported"] as const),
  ...TECHNICAL_PRODUCER_REASONS.unavailable.map((r) => [r, "unavailable"] as const),
]);
const RESERVED_REASONS: ReadonlySet<string> = new Set([
  ...TECHNICAL_CONSUMER_REASONS.evaluated,
  ...TECHNICAL_CONSUMER_REASONS.stale,
  ...TECHNICAL_CONSUMER_REASONS.unsupported,
  ...TECHNICAL_CONSUMER_REASONS.unavailable,
  FIELD_NULL_REASON,
]);

/** The engine's signal vocabulary as of signal_era gc_v2_wo2 (signal_layer/contracts.py).
 *  For UI option lists only — the parser accepts any UPPER_SNAKE token so a new engine type
 *  is shown verbatim rather than rejected. */
export const KNOWN_SIGNAL_TYPES = ["BUY", "REBUY", "RECLAIM", "SELL", "BOTTOM_WATCH"] as const;
const SIGNAL_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

// ── Document types ──────────────────────────────────────────────────────────

export type TechnicalEngine = {
  /** indicator.id, e.g. "confluence_rsimacd_stochrsi_mtf". */
  indicator_id: string;
  /** indicator.engine, e.g. "python:signal_layer.confluence_v2@v2". */
  engine: string;
  /** Contract-level era; a slice without one is the pre-fence "gc_v2". */
  signal_era: string;
  /** indicator.source_hash — provenance only. Flagship and broad slices legitimately differ,
   *  so it is NEVER part of the staleness identity. */
  source_hash: string | null;
};

export type TechnicalCutoff = {
  /** YYYY-MM-DD: the last daily session the engine consumed (the bar's known_ts). */
  session: string;
  /** YYYY-MM-DD: opening session of the bar the state belongs to (indicator `as_of` date). */
  bar_open: string;
  /** Producer-published phase: true = completed bar, false = forming bar, null = phase not
   *  published. Never derived in the browser. */
  bar_closed: boolean | null;
};

/** Verbatim projection of `mastermind.indicator/v1` `state`, minus deprecated `extended`. */
export type TechnicalState = {
  position_hint: "long" | "flat" | null;
  last_signal: string | null;
  last_scored_signal: string | null;
  /** YYYY-MM-DD of the last scored signal's known_ts. */
  last_scored_ts: string | null;
  last_scored_basis: string | null;
  bars_since_signal: number | null;
  strong_bull: boolean | null;
  overbought: boolean | null;
  weeklyBull: boolean | null;
  above200: boolean | null;
};

export const TECHNICAL_STATE_KEYS: readonly (keyof TechnicalState)[] = [
  "position_hint", "last_signal", "last_scored_signal", "last_scored_ts", "last_scored_basis",
  "bars_since_signal", "strong_bull", "overbought", "weeklyBull", "above200",
] as const;

export type TechnicalObserved = {
  status: "observed";
  reason: "ok";
  cutoff: TechnicalCutoff;
  /** Key into TechnicalScan.engines. */
  engine: string;
  /** Slice bar_quality, e.g. "real_ohlc". Provenance; not a coverage input. */
  bar_quality: string | null;
  /** meta.score_basis: "full" | "partial" | null. Provenance; not a coverage input. */
  score_basis: "full" | "partial" | null;
  state: TechnicalState;
};

export type TechnicalNotObserved = { status: "unsupported" | "unavailable"; reason: string };

export type TechnicalObservation = TechnicalObserved | TechnicalNotObserved;

export type TechnicalRow =
  | { kind: "row"; sym: string; mkt: string | null; sec: string | null; tf: Record<string, TechnicalObservation> }
  | { kind: "malformed"; sym: string; mkt: string | null; sec: string | null; error: string };

export type TechnicalScan = Omit<ScanEnvelope<never>, "rows"> & {
  engines: Record<string, TechnicalEngine>;
  /** Timeframes this generation produced, each naming its CURRENT engine key. */
  timeframes: Record<string, { engine: string }>;
  /** Exact sym → row. Size === universe.count. */
  rows: ReadonlyMap<string, TechnicalRow>;
};

// ── Parsing ─────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);
export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && DATE_RE.test(v) && Number.isFinite(dayMs(v)) && new Date(dayMs(v)).toISOString().slice(0, 10) === v;
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isBoolOrNull = (v: unknown): v is boolean | null => v === null || typeof v === "boolean";
const TF_SET: ReadonlySet<string> = new Set(TF_CANONICAL_ORDER);

function parseEngine(raw: unknown): TechnicalEngine | null {
  if (!isObj(raw)) return null;
  const { indicator_id, engine, signal_era, source_hash } = raw;
  if (typeof indicator_id !== "string" || !indicator_id) return null;
  if (typeof engine !== "string" || !engine) return null;
  if (typeof signal_era !== "string" || !signal_era) return null;
  if (source_hash !== undefined && !isStrOrNull(source_hash)) return null;
  return { indicator_id, engine, signal_era, source_hash: (source_hash as string | null | undefined) ?? null };
}

function parseState(raw: unknown): TechnicalState | string {
  if (!isObj(raw)) return "state_invalid";
  const s: TechnicalState = {
    position_hint: null, last_signal: null, last_scored_signal: null, last_scored_ts: null,
    last_scored_basis: null, bars_since_signal: null, strong_bull: null, overbought: null,
    weeklyBull: null, above200: null,
  };
  const ph = raw.position_hint ?? null;
  if (ph !== null && ph !== "long" && ph !== "flat") return "state_position_hint";
  s.position_hint = ph;
  for (const k of ["last_signal", "last_scored_signal"] as const) {
    const v = raw[k] ?? null;
    if (v !== null && !(typeof v === "string" && SIGNAL_RE.test(v))) return `state_${k}`;
    s[k] = v;
  }
  const ts = raw.last_scored_ts ?? null;
  if (ts !== null && !isIsoDate(ts)) return "state_last_scored_ts";
  s.last_scored_ts = ts;
  const basis = raw.last_scored_basis ?? null;
  if (!isStrOrNull(basis)) return "state_last_scored_basis";
  s.last_scored_basis = basis;
  const bss = raw.bars_since_signal ?? null;
  if (bss !== null && !(typeof bss === "number" && Number.isInteger(bss) && bss >= 0)) return "state_bars_since_signal";
  s.bars_since_signal = bss;
  for (const k of ["strong_bull", "overbought", "weeklyBull", "above200"] as const) {
    const v = raw[k] ?? null;
    if (!isBoolOrNull(v)) return `state_${k}`;
    s[k] = v;
  }
  return s;
}

function parseObservation(raw: unknown, engines: Record<string, TechnicalEngine>): TechnicalObservation | string {
  if (!isObj(raw)) return "observation_invalid";
  const { status, reason } = raw;
  if (!isReasonCode(reason)) return "reason_invalid";
  if (status === "unsupported" || status === "unavailable") {
    if (RESERVED_REASONS.has(reason)) return "reason_reserved";
    const expected = PRODUCER_STATUS_OF.get(reason);
    if (expected !== undefined && expected !== status) return "reason_status_mismatch";
    return { status, reason };
  }
  if (status !== "observed") return "status_invalid";
  if (reason !== "ok") return "reason_status_mismatch";
  const c = raw.cutoff;
  if (!isObj(c) || !isIsoDate(c.session) || !isIsoDate(c.bar_open) || !isBoolOrNull(c.bar_closed ?? null)) {
    return "cutoff_invalid";
  }
  // The bar's opening session can never be after the last session the engine consumed —
  // a cutoff that claims otherwise is the future-bar leak the contract exists to exclude.
  if (c.bar_open > c.session) return "cutoff_inverted";
  if (typeof raw.engine !== "string" || !Object.prototype.hasOwnProperty.call(engines, raw.engine)) return "engine_unknown";
  const bq = raw.bar_quality ?? null;
  if (!isStrOrNull(bq)) return "bar_quality_invalid";
  const sb = raw.score_basis ?? null;
  if (sb !== null && sb !== "full" && sb !== "partial") return "score_basis_invalid";
  const state = parseState(raw.state);
  if (typeof state === "string") return state;
  return {
    status: "observed",
    reason: "ok",
    cutoff: { session: c.session, bar_open: c.bar_open, bar_closed: (c.bar_closed ?? null) as boolean | null },
    engine: raw.engine,
    bar_quality: bq,
    score_basis: sb,
    state,
  };
}

/**
 * Validate a technical scan document. Whole-document rejections (the reader then has no
 * scan — see TechnicalScanSource "error"): any envelope failure (screenerScan), a missing or
 * empty engine table, an unknown/non-canonical timeframe, a timeframe naming an unknown
 * engine, or `complete:true` while any row reports `not_processed` (a partial run claiming
 * full coverage — AC-E01-03).
 *
 * Row-level problems never drop the row: it is kept as `{kind:"malformed"}` and classified
 * unavailable/malformed_row, so the coverage sum still equals the requested universe.
 * A row must carry an observation for EVERY produced timeframe.
 */
export function parseTechnicalScan(raw: unknown): ParseResult<TechnicalScan> {
  const env = parseScanEnvelope(raw, TECHNICAL_SCAN_FAMILY, TECHNICAL_SCAN_SUPPORTED_VERSIONS);
  if (!env.ok) return env;
  const doc = raw as Record<string, unknown>;

  if (!isObj(doc.engines)) return { ok: false, error: "engines_invalid" };
  const engines: Record<string, TechnicalEngine> = {};
  for (const [k, v] of Object.entries(doc.engines)) {
    const e = parseEngine(v);
    if (!e || !k) return { ok: false, error: "engines_invalid" };
    engines[k] = e;
  }
  if (Object.keys(engines).length === 0) return { ok: false, error: "engines_invalid" };

  if (!isObj(doc.timeframes)) return { ok: false, error: "timeframes_invalid" };
  const timeframes: Record<string, { engine: string }> = {};
  for (const [tf, spec] of Object.entries(doc.timeframes)) {
    if (!TF_SET.has(tf)) return { ok: false, error: "timeframe_unknown" };
    if (!isObj(spec) || typeof spec.engine !== "string" || !Object.prototype.hasOwnProperty.call(engines, spec.engine)) {
      return { ok: false, error: "timeframe_engine_unknown" };
    }
    timeframes[tf] = { engine: spec.engine };
  }
  const produced = Object.keys(timeframes);

  const rows = new Map<string, TechnicalRow>();
  let notProcessed = 0;
  for (const r of env.value.rows) {
    const mkt = typeof r.mkt === "string" && r.mkt ? r.mkt : null;
    const sec = typeof r.sec === "string" && r.sec ? r.sec : null;
    if ((r.mkt != null && typeof r.mkt !== "string") || (r.sec != null && typeof r.sec !== "string")) {
      rows.set(r.sym, { kind: "malformed", sym: r.sym, mkt, sec, error: "identity_invalid" });
      continue;
    }
    if (!isObj(r.tf)) {
      rows.set(r.sym, { kind: "malformed", sym: r.sym, mkt, sec, error: "tf_invalid" });
      continue;
    }
    const tfObs: Record<string, TechnicalObservation> = {};
    let error: string | null = null;
    for (const tf of produced) {
      const o = parseObservation((r.tf as Record<string, unknown>)[tf], engines);
      if (typeof o === "string") { error = `${tf}:${o}`; break; }
      if (o.status === "unavailable" && o.reason === "not_processed") notProcessed += 1;
      tfObs[tf] = o;
    }
    rows.set(r.sym, error ? { kind: "malformed", sym: r.sym, mkt, sec, error } : { kind: "row", sym: r.sym, mkt, sec, tf: tfObs });
  }
  if (env.value.complete && notProcessed > 0) return { ok: false, error: "complete_with_not_processed" };

  const { rows: _drop, ...meta } = env.value;
  void _drop;
  return { ok: true, value: { ...meta, engines, timeframes, rows } };
}

// ── Reader state ────────────────────────────────────────────────────────────
// What the consumer holds once a read SETTLES. "Loading" is not a coverage population and is
// rendered by the caller before any classification (failure-state-truth law: loading, empty,
// error and stale are distinct UI states).
export type TechnicalScanSource =
  | { kind: "ready"; scan: TechnicalScan; refreshFailed?: boolean }
  | { kind: "absent" }                 // HTTP 404 — no generation has ever been published
  | { kind: "error"; error: string };  // network failure, non-JSON body, or rejected document

/** Adapt one HTTP read to a source. 404 ⇒ absent; 2xx + valid ⇒ ready; anything else ⇒ error. */
export function readTechnicalScanResponse(httpStatus: number, body: unknown): TechnicalScanSource {
  if (httpStatus === 404) return { kind: "absent" };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: "error", error: `http_${httpStatus}` };
  const parsed = parseTechnicalScan(body);
  return parsed.ok ? { kind: "ready", scan: parsed.value } : { kind: "error", error: parsed.error };
}

/**
 * Fold a revalidation into what the reader holds. A ready incoming scan goes through the one
 * adoption rule (`adoptGeneration`): an incomplete generation never displaces a complete one,
 * and nothing older or equal replaces what is held. A failed or absent refresh never erases a
 * held scan; the held copy is kept and flagged `refreshFailed` so the UI labels it.
 */
export function nextTechnicalSource(
  held: TechnicalScanSource | null,
  incoming: TechnicalScanSource,
): { source: TechnicalScanSource; decision: AdoptDecision | null } {
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
const daysBetween = (fromDay: string, toDay: string): number => (dayMs(toDay) - dayMs(fromDay)) / DAY_MS;
const nowMs = (now: Date | number): number => (typeof now === "number" ? now : now.getTime());

const engineIdentityEqual = (a: TechnicalEngine, b: TechnicalEngine): boolean =>
  a.indicator_id === b.indicator_id && a.engine === b.engine && a.signal_era === b.signal_era;

/** Group key for cross-name lag: the manifest venue/asset class through the shared market
 *  model (the same marketOf the Screener's market filter uses). */
export const technicalMarketOf = (row: { sym: string; mkt: string | null; sec: string | null }): MarketId =>
  marketOf(row.sym, { mkt: row.mkt ?? undefined, sec: row.sec ?? undefined });

const marketMaxCache = new WeakMap<TechnicalScan, Map<string, Map<MarketId, string>>>();

/** Newest observed cutoff session per market group for one timeframe (memoized per scan). */
export function marketCutoffMax(scan: TechnicalScan, tf: string): ReadonlyMap<MarketId, string> {
  let perTf = marketMaxCache.get(scan);
  if (!perTf) { perTf = new Map(); marketMaxCache.set(scan, perTf); }
  const hit = perTf.get(tf);
  if (hit) return hit;
  const max = new Map<MarketId, string>();
  for (const row of scan.rows.values()) {
    if (row.kind !== "row") continue;
    const o = row.tf[tf];
    if (!o || o.status !== "observed") continue;
    const m = technicalMarketOf(row);
    const cur = max.get(m);
    if (cur === undefined || o.cutoff.session > cur) max.set(m, o.cutoff.session);
  }
  perTf.set(tf, max);
  return max;
}

export type TechnicalClassification = {
  coverage: Coverage;
  /** Present for evaluated AND stale rows (a stale value is shown with its age). Never used
   *  by a filter unless the coverage is evaluated. */
  observation: TechnicalObserved | null;
  engine: TechnicalEngine | null;
};

/**
 * Classify one symbol at one timeframe. First matching rule wins:
 *   source absent / error              → unavailable  scan_absent / scan_unavailable
 *   tf not in scan.timeframes          → unsupported  timeframe_not_produced
 *   sym not in scan                    → unavailable  not_in_scan
 *   malformed row                      → unavailable  malformed_row
 *   producer unsupported/unavailable   → that status  producer reason
 *   observed, engine ≠ current for tf  → stale        engine_mismatch
 *   observed, generation too old       → stale        generation_stale
 *   observed, cutoff too old vs now    → stale        cutoff_aged
 *   observed, cutoff lags its market   → stale        cutoff_behind_market
 *   observed                           → evaluated    ok
 * `sym` is matched EXACTLY (no case folding, no suffix stripping): one listing, one row.
 */
export function classifyTechnical(source: TechnicalScanSource, sym: string, tf: string, now: Date | number): TechnicalClassification {
  const none = (status: CoverageStatus, reason: string): TechnicalClassification =>
    ({ coverage: { status, reason }, observation: null, engine: null });
  if (source.kind === "absent") return none("unavailable", "scan_absent");
  if (source.kind === "error") return none("unavailable", "scan_unavailable");
  const scan = source.scan;
  const spec = scan.timeframes[tf];
  if (!spec) return none("unsupported", "timeframe_not_produced");
  const row = scan.rows.get(sym);
  if (!row) return none("unavailable", "not_in_scan");
  if (row.kind === "malformed") return none("unavailable", "malformed_row");
  const o = row.tf[tf];
  if (!o) return none("unavailable", "malformed_row");
  if (o.status !== "observed") return none(o.status, o.reason);

  const engine = scan.engines[o.engine];
  const current = scan.engines[spec.engine];
  const stale = (reason: string): TechnicalClassification =>
    ({ coverage: { status: "stale", reason }, observation: o, engine });
  if (!engineIdentityEqual(engine, current)) return stale("engine_mismatch");
  if (generationAgeDays(scan, now) > SCAN_GENERATION_MAX_AGE_DAYS) return stale("generation_stale");
  if ((nowMs(now) - dayMs(o.cutoff.session)) / DAY_MS > SCAN_CUTOFF_MAX_AGE_DAYS) return stale("cutoff_aged");
  const mmax = marketCutoffMax(scan, tf).get(technicalMarketOf(row));
  if (mmax !== undefined && daysBetween(o.cutoff.session, mmax) > MARKET_LAG_DAYS) return stale("cutoff_behind_market");
  return { coverage: { status: "evaluated", reason: "ok" }, observation: o, engine };
}

/** Partition a requested universe at one timeframe. Sum invariant per accountCoverage. */
export function accountTechnicalCoverage(
  requestedIds: Iterable<string>,
  source: TechnicalScanSource,
  tf: string,
  now: Date | number,
): CoverageAccount {
  return accountCoverage(requestedIds, (id) => classifyTechnical(source, id, tf, now).coverage);
}

// ── Fields, cells and predicates ────────────────────────────────────────────
// Stable field ids — persisted by saved screens (E04), so never renamed within v1.

export type TechnicalFieldValues = {
  "tech.position": "long" | "flat";
  "tech.lastSignal": string;
  "tech.lastScoredSignal": string;
  "tech.barsSinceSignal": number;
  "tech.strongBull": boolean;
  "tech.overbought": boolean;
  "tech.weeklyBull": boolean;
  "tech.above200": boolean;
  "tech.barClosed": boolean;
};
export type TechnicalFieldId = keyof TechnicalFieldValues;
export type TechnicalBoolField = "tech.strongBull" | "tech.overbought" | "tech.weeklyBull" | "tech.above200" | "tech.barClosed";
export type TechnicalEnumField = "tech.position" | "tech.lastSignal" | "tech.lastScoredSignal";
export type TechnicalNumberField = "tech.barsSinceSignal";

export const TECHNICAL_FIELD_KIND: Readonly<Record<TechnicalFieldId, "bool" | "enum" | "number">> = {
  "tech.position": "enum",
  "tech.lastSignal": "enum",
  "tech.lastScoredSignal": "enum",
  "tech.barsSinceSignal": "number",
  "tech.strongBull": "bool",
  "tech.overbought": "bool",
  "tech.weeklyBull": "bool",
  "tech.above200": "bool",
  "tech.barClosed": "bool",
};
export const TECHNICAL_FIELD_IDS = Object.keys(TECHNICAL_FIELD_KIND) as TechnicalFieldId[];

const fieldValue = (o: TechnicalObserved, f: TechnicalFieldId): string | number | boolean | null => {
  switch (f) {
    case "tech.position": return o.state.position_hint;
    case "tech.lastSignal": return o.state.last_signal;
    case "tech.lastScoredSignal": return o.state.last_scored_signal;
    case "tech.barsSinceSignal": return o.state.bars_since_signal;
    case "tech.strongBull": return o.state.strong_bull;
    case "tech.overbought": return o.state.overbought;
    case "tech.weeklyBull": return o.state.weeklyBull;
    case "tech.above200": return o.state.above200;
    case "tech.barClosed": return o.cutoff.bar_closed;
  }
};

/** A field as a filterable cell. Known ONLY for an evaluated row with a non-null value; a
 *  stale row's value is unknown here (status "stale") even though it can be displayed. */
export function technicalCellOf<F extends TechnicalFieldId>(c: TechnicalClassification, field: F): ScanCell<TechnicalFieldValues[F]> {
  if (c.coverage.status !== "evaluated" || !c.observation) return unknownCell(c.coverage.status, c.coverage.reason);
  const v = fieldValue(c.observation, field);
  return v === null ? unknownCell("evaluated", FIELD_NULL_REASON) : knownCell(v as TechnicalFieldValues[F]);
}

export type TechnicalPredicate =
  | { field: TechnicalBoolField; op: "is"; value: boolean; includeUnknown?: boolean }
  | { field: TechnicalEnumField; op: "in"; values: string[]; includeUnknown?: boolean }
  | { field: TechnicalNumberField; op: "range"; gte?: number; lte?: number; includeUnknown?: boolean }
  | { field: TechnicalFieldId; op: "unknown" };

/** A technical screen is scoped to exactly one declared timeframe. */
export type TechnicalScreen = { tf: string; predicates: TechnicalPredicate[] };

export function matchTechnicalPredicate(c: TechnicalClassification, p: TechnicalPredicate): ScanMatch {
  if (p.op === "unknown") return matchUnknown(technicalCellOf(c, p.field));
  const policy = { includeUnknown: p.includeUnknown === true };
  switch (p.op) {
    case "is": return matchCell(technicalCellOf(c, p.field), (v) => v === p.value, policy);
    case "in": return matchIn<string>(technicalCellOf(c, p.field), p.values, policy);
    case "range": return matchRange(technicalCellOf(c, p.field), { gte: p.gte, lte: p.lte }, policy);
  }
}

/** Evaluate a screen for one symbol: Kleene AND of its predicates, plus the row's coverage. */
export function evaluateTechnicalScreen(
  source: TechnicalScanSource,
  sym: string,
  screen: TechnicalScreen,
  now: Date | number,
): { match: ScanMatch; coverage: Coverage } {
  const c = classifyTechnical(source, sym, screen.tf, now);
  return { match: combineAll(screen.predicates.map((p) => matchTechnicalPredicate(c, p))), coverage: c.coverage };
}

/**
 * Validate a persisted/serialized screen (E04 presets, URL state). Rejects unknown field ids,
 * ops that do not fit the field's kind, malformed values and non-canonical timeframes rather
 * than silently dropping a predicate — dropping one would widen the screen.
 */
export function parseTechnicalScreen(raw: unknown): ParseResult<TechnicalScreen> {
  if (!isObj(raw)) return { ok: false, error: "screen_invalid" };
  if (typeof raw.tf !== "string" || !TF_SET.has(raw.tf)) return { ok: false, error: "screen_tf_invalid" };
  if (!Array.isArray(raw.predicates)) return { ok: false, error: "screen_predicates_invalid" };
  const out: TechnicalPredicate[] = [];
  for (const p of raw.predicates) {
    if (!isObj(p) || typeof p.field !== "string" || !(p.field in TECHNICAL_FIELD_KIND)) return { ok: false, error: "predicate_field_unknown" };
    const field = p.field as TechnicalFieldId;
    const kind = TECHNICAL_FIELD_KIND[field];
    if (p.includeUnknown !== undefined && typeof p.includeUnknown !== "boolean") return { ok: false, error: "predicate_include_unknown_invalid" };
    const inc = p.includeUnknown === true ? { includeUnknown: true } : {};
    if (p.op === "unknown") { out.push({ field, op: "unknown" }); continue; }
    if (p.op === "is" && kind === "bool" && typeof p.value === "boolean") {
      out.push({ field: field as TechnicalBoolField, op: "is", value: p.value, ...inc });
    } else if (p.op === "in" && kind === "enum" && Array.isArray(p.values) && p.values.length > 0 && p.values.every((v) => typeof v === "string")) {
      out.push({ field: field as TechnicalEnumField, op: "in", values: [...(p.values as string[])], ...inc });
    } else if (p.op === "range" && kind === "number") {
      const okNum = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
      if (!okNum(p.gte) || !okNum(p.lte) || (p.gte === undefined && p.lte === undefined)) return { ok: false, error: "predicate_range_invalid" };
      out.push({ field: field as TechnicalNumberField, op: "range", ...(p.gte !== undefined ? { gte: p.gte as number } : {}), ...(p.lte !== undefined ? { lte: p.lte as number } : {}), ...inc });
    } else {
      return { ok: false, error: "predicate_op_invalid" };
    }
  }
  return { ok: true, value: { tf: raw.tf, predicates: out } };
}

// ── Chart handover (AC-E01-05) ──────────────────────────────────────────────

export type ChartHandover = {
  href: string;
  /** canonicalChartSymbol of the row's sym — the exact listing the chart will open. */
  symbol: string;
  /** The timeframe the link carries, or null when it cannot be honoured. */
  timeframe: string | null;
  /** What the caller asked for, verbatim when it was a string. */
  requested: string | null;
  /** "exact" — the chart opens at the requested timeframe; "unsupported_timeframe" — the
   *  link opens the symbol without a timeframe and the UI must SAY so. */
  support: "exact" | "unsupported_timeframe";
};

/**
 * Build the result → chart link. `functional` is the landing symbol's functional timeframe
 * set, owned by TerminalShell (the one definition); it is passed in so this module stays
 * free of the chart bundle. Returns null for a symbol the chart route cannot open.
 */
export function technicalChartHandover(sym: unknown, tf: unknown, functional: ReadonlySet<string>): ChartHandover | null {
  const symbol = canonicalChartSymbol(sym);
  if (!symbol) return null;
  const requested = typeof tf === "string" ? tf : null;
  const base = `/terminal?sym=${encodeURIComponent(symbol)}`;
  if (requested !== null && TF_SET.has(requested) && functional.has(requested)) {
    return { href: `${base}&tf=${encodeURIComponent(requested)}`, symbol, timeframe: requested, requested, support: "exact" };
  }
  return { href: base, symbol, timeframe: null, requested, support: "unsupported_timeframe" };
}

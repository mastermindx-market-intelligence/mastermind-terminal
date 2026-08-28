/**
 * Verified server-side reader for event_workspace.v1.
 *
 * Mirrors engine.neuralweb.company_intelligence_reader.read_event_workspace:
 * trusted R2 origin → marker → immutable generation → alias resolution →
 * expected object receipt → fetch workspace → verify bytes + SHA → closed-schema
 * normalize. No redirect following, arbitrary source URL, checkout fallback,
 * latest.json, v1 overlay fallback, or client-side R2 fetch.
 */

import { normalizeCompanyIntelligenceSymbol } from "./companyIntelligence";

export { normalizeCompanyIntelligenceSymbol };

export const EVENT_WORKSPACE_SCHEMA = "event_workspace.v1" as const;
export const EVENT_WORKSPACE_MANIFEST_SCHEMA = "event_workspace_manifest.v1" as const;
export const EVENT_WORKSPACE_MANIFEST_SCHEMA_V2 = "event_workspace_manifest.v2" as const;
export const QA_EXCHANGE_SCHEMA = "qa_exchange.v1" as const;
export const QA_TOPIC_VERSION = "qa_topic.v1" as const;
export const QA_TOPIC_HASH = "a928ca72ab2e91bda74bd1e69021e08a5234e501f095610e623655db7e323b5e" as const;
export const QA_UNAVAILABLE_TOPIC = "unavailable" as const;
export const QA_EXTRACTOR_ID = "qa_reconstruction.v1" as const;
export const QA_VALIDATOR_ID = "qa_exchange_validator.v1" as const;
export const SOURCE_CLOCK_SCHEMA = "event_source_clock.v1" as const;
export const EVENT_WORKSPACE_NEST = "event_workspaces";

export type EventWorkspaceAuthority = "context_only";
export type EventWorkspaceReceiptState = "byte_replayed" | "address_only" | "typed_absence";
export type EventWorkspaceLifecycleState = "complete" | "corrected" | "partial" | "empty";
export type EventWorkspaceManifestStatus = "ready" | "degraded" | "partial" | "empty";

export interface EventWorkspaceTypedAbsence {
  schema: "typed_absence.v1";
  authority: EventWorkspaceAuthority;
  reason: string;
  subject: string;
  detail: string;
  event_id: string;
  document_id: string | null;
  missing_fields: string[];
}

export interface EventWorkspaceSpanLocator {
  kind: string;
  sub_kind?: string;
  segment_index?: number;
  span_start_byte?: number;
  span_end_byte?: number;
  speaker?: string | null;
  role?: string | null;
}

export const EVENT_WORKSPACE_RECEIPT_KEYS = [
  "source_sha256",
  "segment_index",
  "segment_sha256",
  "segment_bytes",
  "span_start_byte",
  "span_end_byte",
  "text_sha256",
] as const;

export const EVENT_WORKSPACE_ABSENCE_REASONS = new Set([
  "no_source_document",
  "no_transcript",
  "no_primary_release",
  "no_span_addressable_evidence",
  "document_bytes_not_held",
  "scanned_image_no_text_layer",
  "unjoinable_filing_identity",
  "speaker_unresolvable",
  "slide_family_discontinued",
  "superseded_by_duplicate",
  "missing_basis",
  "missing_units",
  "missing_period",
  "missing_source",
]);

export const EVENT_WORKSPACE_LOCATOR_KINDS = new Set(["text_span", "table_cell", "slide_region"]);
export const EVENT_WORKSPACE_REPLAYABLE_LOCATOR_KINDS = new Set(["text_span"]);
const LOCATOR_ALIASES: Record<string, string> = { transcript_segment: "text_span" };

export interface EventWorkspaceSpanReceipt {
  source_sha256: string;
  segment_index: number;
  segment_sha256: string;
  segment_bytes: number;
  span_start_byte: number;
  span_end_byte: number;
  text_sha256: string;
}

export interface EventWorkspaceSourceSpan {
  schema: "source_span.v1";
  span_id: string;
  document_id: string;
  document_version: number;
  display_excerpt: string | null;
  receipt_state: "byte_replayed" | "address_only";
  locator: EventWorkspaceSpanLocator;
  receipt: EventWorkspaceSpanReceipt | null;
  text_sha256: string | null;
  unreplayable_reason: string | null;
  authority: EventWorkspaceAuthority;
  rights_profile: string | null;
}

export interface EventWorkspaceFact {
  schema: "event_fact.v1";
  fact_id: string;
  event_id: string;
  metric: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  basis: string | null;
  source_span: EventWorkspaceSourceSpan | null;
  typed_absence: EventWorkspaceTypedAbsence | null;
}

export interface EventWorkspaceDeltaValue {
  value: number;
  unit: string | null;
  basis: string | null;
}

export interface EventWorkspaceDelta {
  schema: "metric_delta.v1";
  metric: string;
  current: EventWorkspaceDeltaValue | EventWorkspaceTypedAbsence | null;
  prior: EventWorkspaceDeltaValue | EventWorkspaceTypedAbsence | null;
  consensus: EventWorkspaceTypedAbsence | EventWorkspaceDeltaValue | null;
  basis_match: false;
}

export interface EventWorkspaceGuidance {
  schema: "guidance_item.v1";
  metric: string;
  low: number | null;
  high: number | null;
  unit: string | null;
  horizon: string | null;
  status: string;
  source_span: EventWorkspaceSourceSpan | null;
  typed_absence: EventWorkspaceTypedAbsence | null;
}

export interface EventWorkspaceClaim {
  schema: "event_claim.v1";
  claim_id: string;
  text: string;
  kind: string;
  metric: string | null;
  speaker: string | null;
  role: string | null;
  source_span: EventWorkspaceSourceSpan | null;
  typed_absence: EventWorkspaceTypedAbsence | null;
}

export interface EventWorkspaceSource {
  kind: string;
  receipt_state: EventWorkspaceReceiptState;
  document_id: string | null;
  source_sha256: string | null;
  url: string | null;
  slug: string | null;
  join_status: string | null;
  filing_key: { cik: string; accession: string } | null;
  typed_absence: EventWorkspaceTypedAbsence | null;
  source_clock?: EventWorkspaceSourceClock | null;
}

export interface EventWorkspaceSourceClock {
  schema: typeof SOURCE_CLOCK_SCHEMA;
  document_id: string;
  source_sha256: string;
  source_available_at: string | null;
  system_recorded_at: string;
  clock_state: "known" | "unknown";
  rights_profile: string;
  session_phase: string;
}

export interface EventWorkspaceQaQuestioner {
  name: string;
  affiliation: string;
  name_state: string;
  affiliation_state: string;
}

export interface EventWorkspaceQaRespondent {
  name: string;
  role: string;
  identity_state: string;
  span_indexes: number[];
}

export interface EventWorkspaceQaProvenance {
  extractor_id: string;
  provider: null;
  model: null;
  prompt_version: null;
  validator_id: string;
  run_id: string;
  validation_state: "accepted";
  source_available_at: string | null;
  clock_state: "known" | "unknown";
  rights_profile: string;
}

export interface EventWorkspaceQaValidation {
  replayed: true;
  unique_span: true;
  event_match: true;
  revision_match: true;
  rights_ok: true;
}

export interface EventWorkspaceQaExchange {
  schema: typeof QA_EXCHANGE_SCHEMA;
  exchange_id: string;
  event_id: string;
  ordinal: number;
  document_id: string;
  document_sha256: string;
  question_spans: EventWorkspaceSourceSpan[];
  answer_spans: EventWorkspaceSourceSpan[];
  questioner: EventWorkspaceQaQuestioner;
  respondents: EventWorkspaceQaRespondent[];
  topics: [typeof QA_UNAVAILABLE_TOPIC];
  taxonomy_version: typeof QA_TOPIC_VERSION;
  taxonomy_hash: typeof QA_TOPIC_HASH;
  provenance: EventWorkspaceQaProvenance;
  validation: EventWorkspaceQaValidation;
}

export interface EventWorkspaceCompletenessBlock {
  status: string;
  document_id?: string | null;
  filing_key?: { cik: string; accession: string } | null;
  typed_absence?: EventWorkspaceTypedAbsence | null;
}

export interface EventWorkspace {
  schema: typeof EVENT_WORKSPACE_SCHEMA;
  event_id: string;
  aliases: string[];
  issuer: {
    company_id: string;
    display_name: string;
    listings: Array<{
      ticker: string;
      mic: string;
      security_id: string | null;
      share_class: string | null;
      trading_currency: string | null;
      is_primary: boolean;
      valid_from: string | null;
      valid_to: string | null;
    }>;
  };
  fiscal_period: { year: number; quarter: number; calendar_end: string | null };
  lifecycle: {
    state: EventWorkspaceLifecycleState;
    observed_at: string | null;
    source_available_at: string | null;
  };
  completeness: {
    release: EventWorkspaceCompletenessBlock;
    filing: EventWorkspaceCompletenessBlock;
    transcript: EventWorkspaceCompletenessBlock;
    slides: EventWorkspaceCompletenessBlock;
    consensus: EventWorkspaceCompletenessBlock;
    reaction: EventWorkspaceCompletenessBlock;
  };
  facts: EventWorkspaceFact[];
  deltas: EventWorkspaceDelta[];
  guidance: EventWorkspaceGuidance[];
  claims: EventWorkspaceClaim[];
  sources: EventWorkspaceSource[];
  warnings: string[];
  generation_id: string;
  generated_at: string;
  authority: EventWorkspaceAuthority;
  prophet_flags: {
    may_rank: false;
    may_size: false;
    may_gate: false;
    prophet_authority: false;
  };
  claim_citations_pending: boolean;
  qa_exchanges: EventWorkspaceQaExchange[];
}

export interface EventWorkspaceManifest {
  schema: typeof EVENT_WORKSPACE_MANIFEST_SCHEMA | typeof EVENT_WORKSPACE_MANIFEST_SCHEMA_V2;
  generation_id: string;
  generated_at: string;
  status: EventWorkspaceManifestStatus;
  event_count: number;
  files: Record<string, { sha256: string; bytes: number }>;
  aliases: Record<string, string>;
  authority: EventWorkspaceAuthority;
  warnings: string[];
  previous_generation_id?: string | null;
  previous_manifest_sha256?: string | null;
}

export interface EventWorkspaceVerifiedReceipt {
  generation_id: string;
  workspace_sha256: string;
  marker_sha256: string;
  workspace_url: string;
}

export type EventWorkspaceErrorCode =
  | "invalid_symbol"
  | "not_found"
  | "ambiguous_event"
  | "upstream_unavailable"
  | "invalid_payload";

export type EventWorkspaceResult =
  | {
    ok: true;
    state: "ready" | "partial" | "stale";
    available: true;
    event_id: string;
    workspace: EventWorkspace;
    authority: EventWorkspaceAuthority;
    is_context_only: true;
    display_only: true;
    receipt: EventWorkspaceVerifiedReceipt;
  }
  | {
    ok: false;
    state: "error";
    available: false;
    error: { code: EventWorkspaceErrorCode; message: string; retryable: boolean };
  };

const WORKSPACE_KEYS = [
  "schema", "event_id", "aliases", "issuer", "fiscal_period", "lifecycle",
  "completeness", "facts", "deltas", "guidance", "claims", "sources", "warnings",
  "generation_id", "generated_at", "authority", "prophet_flags",
  "claim_citations_pending", "qa_exchanges",
] as const;

const MANIFEST_KEYS = [
  "schema", "generation_id", "generated_at", "status", "event_count", "files",
  "aliases", "authority", "warnings",
] as const;

const MANIFEST_KEYS_V2 = [
  ...MANIFEST_KEYS,
  "previous_generation_id",
  "previous_manifest_sha256",
] as const;

const QA_EXCHANGE_KEYS = [
  "schema", "exchange_id", "event_id", "ordinal", "document_id", "document_sha256",
  "question_spans", "answer_spans", "questioner", "respondents", "topics",
  "taxonomy_version", "taxonomy_hash", "provenance", "validation",
] as const;
const QA_QUESTIONER_KEYS = ["name", "affiliation", "name_state", "affiliation_state"] as const;
const QA_RESPONDENT_KEYS = ["name", "role", "identity_state", "span_indexes"] as const;
const QA_NAME_STATE_SOURCE_SUPPORTED = "source_supported";
const QA_AFFILIATION_STATES = new Set(["source_supported", "unresolved"]);
const QA_IDENTITY_STATE_SOURCE_SUPPORTED = "source_supported";
const QA_PROVENANCE_KEYS = [
  "extractor_id", "provider", "model", "prompt_version", "validator_id", "run_id",
  "validation_state", "source_available_at", "clock_state", "rights_profile",
] as const;
const QA_VALIDATION_KEYS = ["replayed", "unique_span", "event_match", "revision_match", "rights_ok"] as const;
const SOURCE_CLOCK_KEYS = [
  "schema", "document_id", "source_sha256", "source_available_at", "system_recorded_at",
  "clock_state", "rights_profile", "session_phase",
] as const;
const QA_FORBIDDEN = new Set([
  "rank", "gate", "trade", "prophet", "evasiveness", "sentiment", "deflection",
  "beat", "miss", "candidate_id",
]);

const WORKSPACE_WARNINGS = new Set([
  "wire_record_not_found",
  "collector_filing_unjoinable",
  "consensus_unlicensed",
  "slides_absent",
  "reaction_not_joined",
  "questions_count_unstructured",
]);

const EVENT_ID_RE = /^evt_cik\d{10}_\d{4}(?:q[1-4]|fy)_[a-z0-9]+$/;
const GENERATION_RE = /^[a-f0-9]{24,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PERIOD_ALIAS = /^([A-Z0-9](?:[A-Z0-9.-]{0,14}[A-Z0-9])?)\/(\d{4})Q([1-4])$/;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const COMPANY_INTELLIGENCE_R2_HOST = "pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";
const FETCH_TIMEOUT_MS = 2_500;
const MANIFEST_TTL_MS = 30_000;
const WORKSPACE_TTL_MS = 30_000;
export const EVENT_WORKSPACE_MAX_R2_JSON_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_ALIASES = 64;
const MAX_FACTS = 64;
const MAX_CLAIMS = 64;
const MAX_SOURCES = 24;
const MAX_WARNINGS = 32;
const MAX_CACHE_ENTRIES = 256;
const MAX_TEXT = 4_000;
const MAX_ID = 160;
const USER_AGENT = "MastermindCompanyIntelligence/1.0";

type JsonRecord = Record<string, unknown>;
type ManifestCache = { data: EventWorkspaceManifest; sha256: string; at: number };
type WorkspaceCache = { data: EventWorkspace; receipt: EventWorkspaceVerifiedReceipt; at: number };

let manifestCache: ManifestCache | null = null;
const workspaceCache = new Map<string, WorkspaceCache>();

function object(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function requiredString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && ISO_TIMESTAMP.test(value)
    && Number.isFinite(new Date(value).getTime());
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function finiteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isEventWorkspaceEventId(value: string): boolean {
  return EVENT_ID_RE.test(value);
}

export function isEventWorkspaceGenerationId(value: string): boolean {
  return GENERATION_RE.test(value) && !value.includes("..");
}

export function tickerPeriodAliasPattern(ticker: string): RegExp {
  return new RegExp(`^${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(\\d{4})Q([1-4])$`);
}

export interface SelectedTickerEvent {
  event_id: string;
  ticker: string;
  year: number;
  quarter: number;
  alias: string;
}

/**
 * Derive the current v2 event solely from verified workspace manifest aliases.
 * Admit aliases matching exactly T/YYYYQn, choose the greatest fiscal period,
 * and require an unambiguous canonical owner.
 */
export function selectCurrentEventFromAliases(
  ticker: string,
  aliases: Record<string, string> | Iterable<readonly [string, string]>,
): SelectedTickerEvent | { error: "not_found" | "ambiguous_event" } {
  const symbol = normalizeCompanyIntelligenceSymbol(ticker);
  if (!symbol) return { error: "not_found" };
  const entries: Array<readonly [string, string]> = Array.isArray(aliases)
    ? aliases
    : Object.entries(aliases as Record<string, string>);
  const pattern = tickerPeriodAliasPattern(symbol);
  const matched: SelectedTickerEvent[] = [];
  for (const [alias, canonical] of entries) {
    if (typeof alias !== "string" || typeof canonical !== "string") continue;
    const key = alias.trim();
    if (!pattern.test(key) || !isEventWorkspaceEventId(canonical)) continue;
    const parsed = TICKER_PERIOD_ALIAS.exec(key);
    if (!parsed || parsed[1] !== symbol) continue;
    matched.push({
      event_id: canonical,
      ticker: symbol,
      year: Number(parsed[2]),
      quarter: Number(parsed[3]),
      alias: key,
    });
  }
  if (matched.length === 0) return { error: "not_found" };
  const byPeriod = new Map<string, Set<string>>();
  for (const row of matched) {
    const period = `${row.year}Q${row.quarter}`;
    const owners = byPeriod.get(period) ?? new Set<string>();
    owners.add(row.event_id);
    byPeriod.set(period, owners);
  }
  for (const owners of byPeriod.values()) {
    if (owners.size > 1) return { error: "ambiguous_event" };
  }
  matched.sort((a, b) => (a.year - b.year) || (a.quarter - b.quarter));
  return matched[matched.length - 1];
}

function canonicalJson(value: unknown): string | null {
  try {
    const normalize = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(normalize);
      if (item !== null && typeof item === "object") {
        const source = item as Record<string, unknown>;
        const target: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) target[key] = normalize(source[key]);
        return target;
      }
      if (typeof item === "number" && !Number.isFinite(item)) throw new Error("non-finite");
      return item;
    };
    return `${JSON.stringify(normalize(value))}\n`;
  } catch {
    return null;
  }
}

function validateR2Base(base: string): string | null {
  try {
    const parsed = new URL(base);
    return parsed.protocol === "https:" && parsed.hostname === COMPANY_INTELLIGENCE_R2_HOST && !parsed.port
      && parsed.pathname === "/" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      ? parsed.toString().replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}

function isPinnedR2FinalUrl(requestedUrl: string, finalUrl: string): boolean {
  if (!finalUrl) return true;
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    return final.protocol === "https:" && final.hostname === COMPANY_INTELLIGENCE_R2_HOST && !final.port
      && final.origin === requested.origin && final.pathname === requested.pathname
      && final.search === requested.search && final.hash === "";
  } catch {
    return false;
  }
}

type FetchedJson = { kind: "ok"; raw: unknown; bytes: Uint8Array } | { kind: "missing" } | { kind: "failure" };

async function boundedResponseBytes(response: Response, controller: AbortController, limit: number): Promise<Uint8Array | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const advertised = Number(contentLength);
    if (!Number.isSafeInteger(advertised) || advertised < 0 || advertised > limit) return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) {
        controller.abort();
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchJson(url: string, limit: number, signal?: AbortSignal): Promise<FetchedJson> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
    if (!isPinnedR2FinalUrl(url, response.url)) return { kind: "failure" };
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "failure" };
    try {
      const bytes = await boundedResponseBytes(response, controller, limit);
      if (!bytes) return { kind: "failure" };
      return { kind: "ok", raw: JSON.parse(new TextDecoder().decode(bytes)), bytes };
    } catch {
      return { kind: "failure" };
    }
  } catch {
    return { kind: "failure" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeAbsence(raw: unknown, expectedEventId: string): EventWorkspaceTypedAbsence | null {
  const obj = object(raw);
  if (!obj || obj.schema !== "typed_absence.v1" || obj.authority !== "context_only") return null;
  const reason = requiredString(obj.reason, 80);
  const subject = requiredString(obj.subject, 80);
  const detail = requiredString(obj.detail, MAX_TEXT);
  const eventId = requiredString(obj.event_id, MAX_ID);
  if (!reason || !subject || !detail || !eventId || !isEventWorkspaceEventId(eventId)) return null;
  if (!EVENT_WORKSPACE_ABSENCE_REASONS.has(reason)) return null;
  if (eventId !== expectedEventId) return null;
  const documentId = obj.document_id === null ? null : requiredString(obj.document_id, MAX_ID);
  if (obj.document_id !== null && obj.document_id !== undefined && !documentId) return null;
  if (!Array.isArray(obj.missing_fields) || obj.missing_fields.length > 24) return null;
  const missing: string[] = [];
  for (const item of obj.missing_fields) {
    const field = requiredString(item, 80);
    if (!field) return null;
    missing.push(field);
  }
  return {
    schema: "typed_absence.v1",
    authority: "context_only",
    reason,
    subject,
    detail,
    event_id: eventId,
    document_id: documentId ?? null,
    missing_fields: missing,
  };
}

function locatorKind(raw: unknown): string | null {
  const kind = requiredString(raw, 80);
  if (!kind) return null;
  const normalized = LOCATOR_ALIASES[kind] ?? kind;
  return EVENT_WORKSPACE_LOCATOR_KINDS.has(normalized) ? normalized : null;
}

function exactReceipt(raw: unknown): EventWorkspaceSpanReceipt | null {
  const obj = object(raw);
  if (!obj) return null;
  const keys = Object.keys(obj);
  if (keys.length !== EVENT_WORKSPACE_RECEIPT_KEYS.length || EVENT_WORKSPACE_RECEIPT_KEYS.some((key) => !keys.includes(key))) {
    return null;
  }
  const sourceSha = validSha(obj.source_sha256) ? obj.source_sha256 : null;
  const segmentSha = validSha(obj.segment_sha256) ? obj.segment_sha256 : null;
  const textSha = validSha(obj.text_sha256) ? obj.text_sha256 : null;
  const segmentIndex = boundedInt(obj.segment_index, 0, 1_000_000);
  const segmentBytes = boundedInt(obj.segment_bytes, 0, 50_000_000);
  const start = boundedInt(obj.span_start_byte, 0, 50_000_000);
  const end = boundedInt(obj.span_end_byte, 0, 50_000_000);
  if (!sourceSha || !segmentSha || !textSha || segmentIndex === null || segmentBytes === null || start === null || end === null) {
    return null;
  }
  if (!(start <= end) || end > segmentBytes) return null;
  return {
    source_sha256: sourceSha,
    segment_index: segmentIndex,
    segment_sha256: segmentSha,
    segment_bytes: segmentBytes,
    span_start_byte: start,
    span_end_byte: end,
    text_sha256: textSha,
  };
}

function normalizeSpan(raw: unknown): EventWorkspaceSourceSpan | null {
  const obj = object(raw);
  if (!obj || obj.schema !== "source_span.v1" || obj.authority !== "context_only") return null;
  const spanId = requiredString(obj.span_id, MAX_ID);
  const documentId = requiredString(obj.document_id, MAX_ID);
  const version = boundedInt(obj.document_version, 1, 10_000);
  if (!spanId || !documentId || version === null) return null;
  if (obj.receipt_state !== "byte_replayed" && obj.receipt_state !== "address_only") return null;
  const excerpt = obj.display_excerpt === null || obj.display_excerpt === undefined
    ? null
    : requiredString(obj.display_excerpt, MAX_TEXT);
  if (obj.display_excerpt != null && !excerpt) return null;
  const locatorRaw = object(obj.locator);
  const kind = locatorRaw ? locatorKind(locatorRaw.kind) : null;
  if (!locatorRaw || !kind) return null;
  const locator: EventWorkspaceSpanLocator = { kind };
  if (typeof locatorRaw.sub_kind === "string") locator.sub_kind = locatorRaw.sub_kind.slice(0, 80);
  if (typeof locatorRaw.segment_index === "number" && Number.isInteger(locatorRaw.segment_index)) {
    locator.segment_index = locatorRaw.segment_index;
  }
  if (typeof locatorRaw.span_start_byte === "number" && Number.isInteger(locatorRaw.span_start_byte)) {
    locator.span_start_byte = locatorRaw.span_start_byte;
  }
  if (typeof locatorRaw.span_end_byte === "number" && Number.isInteger(locatorRaw.span_end_byte)) {
    locator.span_end_byte = locatorRaw.span_end_byte;
  }
  if (typeof locatorRaw.speaker === "string") locator.speaker = locatorRaw.speaker.slice(0, 160);
  if (typeof locatorRaw.role === "string") locator.role = locatorRaw.role.slice(0, 80);
  if (obj.receipt_state === "byte_replayed") {
    if (!EVENT_WORKSPACE_REPLAYABLE_LOCATOR_KINDS.has(kind)) return null;
    if (obj.unreplayable_reason != null) return null;
    const receipt = exactReceipt(obj.receipt);
    if (!receipt) return null;
    const textSha = validSha(obj.text_sha256) ? obj.text_sha256 : null;
    if (!textSha || textSha !== receipt.text_sha256) return null;
    if (locator.segment_index !== receipt.segment_index) return null;
    if (locator.span_start_byte !== receipt.span_start_byte) return null;
    if (locator.span_end_byte !== receipt.span_end_byte) return null;
    return {
      schema: "source_span.v1",
      span_id: spanId,
      document_id: documentId,
      document_version: version,
      display_excerpt: excerpt,
      receipt_state: "byte_replayed",
      locator,
      receipt,
      text_sha256: textSha,
      unreplayable_reason: null,
      authority: "context_only",
      rights_profile: obj.rights_profile === null || obj.rights_profile === undefined ? null : requiredString(obj.rights_profile, 80),
    };
  }
  if (EVENT_WORKSPACE_REPLAYABLE_LOCATOR_KINDS.has(kind)) return null;
  if (obj.receipt != null) return null;
  if (obj.text_sha256 != null) return null;
  const reason = requiredString(obj.unreplayable_reason, 240);
  if (!reason) return null;
  return {
    schema: "source_span.v1",
    span_id: spanId,
    document_id: documentId,
    document_version: version,
    display_excerpt: excerpt,
    receipt_state: "address_only",
    locator,
    receipt: null,
    text_sha256: null,
    unreplayable_reason: reason,
    authority: "context_only",
    rights_profile: obj.rights_profile === null || obj.rights_profile === undefined ? null : requiredString(obj.rights_profile, 80),
  };
}

function filingKey(raw: unknown): { cik: string; accession: string } | null | undefined {
  if (raw == null) return null;
  const obj = object(raw);
  if (!obj) return undefined;
  const cik = requiredString(obj.cik, 16);
  const accession = requiredString(obj.accession, 24);
  if (!cik || !accession || !ACCESSION.test(accession)) return undefined;
  return { cik, accession };
}

function normalizeCompletenessBlock(raw: unknown, eventId: string): EventWorkspaceCompletenessBlock | null {
  const obj = object(raw);
  if (!obj) return null;
  const status = requiredString(obj.status, 40);
  if (!status) return null;
  const block: EventWorkspaceCompletenessBlock = { status };
  if ("document_id" in obj) {
    const documentId = obj.document_id === null ? null : requiredString(obj.document_id, MAX_ID);
    if (obj.document_id != null && !documentId) return null;
    block.document_id = documentId ?? null;
  }
  if ("filing_key" in obj) {
    const key = filingKey(obj.filing_key);
    if (key === undefined) return null;
    block.filing_key = key;
  }
  if ("typed_absence" in obj && obj.typed_absence != null) {
    const absence = normalizeAbsence(obj.typed_absence, eventId);
    if (!absence) return null;
    block.typed_absence = absence;
  }
  return block;
}

function spanOrAbsence(obj: JsonRecord, eventId: string): {
  source_span: EventWorkspaceSourceSpan | null;
  typed_absence: EventWorkspaceTypedAbsence | null;
} | null {
  const hasSpan = obj.source_span != null;
  const hasAbsence = obj.typed_absence != null;
  if (hasSpan === hasAbsence) return null;
  if (hasSpan) {
    const span = normalizeSpan(obj.source_span);
    return span ? { source_span: span, typed_absence: null } : null;
  }
  const absence = normalizeAbsence(obj.typed_absence, eventId);
  return absence ? { source_span: null, typed_absence: absence } : null;
}

function normalizeFact(raw: unknown, eventId: string): EventWorkspaceFact | null {
  const obj = object(raw);
  if (!obj || obj.schema !== "event_fact.v1") return null;
  const factId = requiredString(obj.fact_id, MAX_ID);
  const metric = requiredString(obj.metric, 80);
  const boundEvent = requiredString(obj.event_id, MAX_ID);
  if (!factId || !metric || boundEvent !== eventId) return null;
  const evidence = spanOrAbsence(obj, eventId);
  if (!evidence) return null;
  const value = obj.value === undefined ? null : finiteNumber(obj.value);
  if (value === undefined) return null;
  const unit = obj.unit === null || obj.unit === undefined ? null : requiredString(obj.unit, 40);
  if (obj.unit != null && !unit) return null;
  const period = obj.period === null || obj.period === undefined ? null : (validDate(obj.period) ? obj.period : requiredString(obj.period, 40));
  if (obj.period != null && !period) return null;
  const basis = obj.basis === null || obj.basis === undefined ? null : requiredString(obj.basis, 40);
  if (obj.basis != null && !basis) return null;
  return {
    schema: "event_fact.v1",
    fact_id: factId,
    event_id: eventId,
    metric,
    value,
    unit,
    period,
    basis,
    ...evidence,
  };
}

function deltaSide(raw: unknown, eventId: string): EventWorkspaceDeltaValue | EventWorkspaceTypedAbsence | null | undefined {
  if (raw == null) return null;
  const absence = object(raw)?.schema === "typed_absence.v1" ? normalizeAbsence(raw, eventId) : null;
  if (object(raw)?.schema === "typed_absence.v1") return absence ?? undefined;
  const obj = object(raw);
  if (!obj) return undefined;
  const value = finiteNumber(obj.value);
  if (value === undefined || value === null) return undefined;
  const unit = obj.unit === null || obj.unit === undefined ? null : requiredString(obj.unit, 40);
  if (obj.unit != null && !unit) return undefined;
  const basis = obj.basis === null || obj.basis === undefined ? null : requiredString(obj.basis, 40);
  if (obj.basis != null && !basis) return undefined;
  return { value, unit, basis };
}

function normalizeDelta(raw: unknown, eventId: string): EventWorkspaceDelta | null {
  const obj = object(raw);
  if (!obj || obj.schema !== "metric_delta.v1") return null;
  if (obj.basis_match !== false) return null;
  if ("beat" in obj || "miss" in obj || "beat_miss" in obj || "verdict" in obj) return null;
  const metric = requiredString(obj.metric, 80);
  if (!metric) return null;
  const current = deltaSide(obj.current, eventId);
  const prior = deltaSide(obj.prior, eventId);
  const consensus = deltaSide(obj.consensus, eventId);
  if (current === undefined || prior === undefined || consensus === undefined) return null;
  return { schema: "metric_delta.v1", metric, current, prior, consensus, basis_match: false };
}

function normalizeGuidance(raw: unknown, eventId: string): EventWorkspaceGuidance | null {
  const obj = object(raw);
  if (!obj || obj.schema !== "guidance_item.v1") return null;
  const metric = requiredString(obj.metric, 80);
  const status = requiredString(obj.status, 40);
  if (!metric || !status) return null;
  const evidence = spanOrAbsence(obj, eventId);
  if (!evidence) return null;
  const low = finiteNumber(obj.low);
  const high = finiteNumber(obj.high);
  if (low === undefined || high === undefined) return null;
  return {
    schema: "guidance_item.v1",
    metric,
    low,
    high,
    unit: obj.unit === null || obj.unit === undefined ? null : requiredString(obj.unit, 40),
    horizon: obj.horizon === null || obj.horizon === undefined ? null : requiredString(obj.horizon, 80),
    status,
    ...evidence,
  };
}

function normalizeClaim(raw: unknown, eventId: string): EventWorkspaceClaim | null {
  const obj = object(raw);
  if (!obj || obj.schema !== "event_claim.v1") return null;
  const claimId = requiredString(obj.claim_id, MAX_ID);
  const text = requiredString(obj.text, MAX_TEXT);
  const kind = requiredString(obj.kind, 40);
  if (!claimId || !text || !kind) return null;
  const evidence = spanOrAbsence(obj, eventId);
  if (!evidence) return null;
  return {
    schema: "event_claim.v1",
    claim_id: claimId,
    text,
    kind,
    metric: obj.metric === null || obj.metric === undefined ? null : requiredString(obj.metric, 80),
    speaker: obj.speaker === null || obj.speaker === undefined ? null : requiredString(obj.speaker, 160),
    role: obj.role === null || obj.role === undefined ? null : requiredString(obj.role, 80),
    ...evidence,
  };
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || /[\\\r\n]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}


function normalizeSourceClock(
  raw: unknown,
  documentId: string | null,
  sourceSha256: string | null,
): EventWorkspaceSourceClock | null {
  const obj = object(raw);
  if (!obj || !exactKeys(obj, SOURCE_CLOCK_KEYS) || obj.schema !== SOURCE_CLOCK_SCHEMA) return null;
  if (obj.clock_state !== "known" && obj.clock_state !== "unknown") return null;
  const clockDocument = requiredString(obj.document_id, MAX_ID);
  const clockSha = validSha(obj.source_sha256) ? obj.source_sha256 : null;
  const recorded = requiredString(obj.system_recorded_at, 64);
  const rights = requiredString(obj.rights_profile, 80);
  const phase = requiredString(obj.session_phase, 40);
  if (!clockDocument || !clockSha || !recorded || !rights || !phase) return null;
  if (documentId && clockDocument !== documentId) return null;
  if (sourceSha256 && clockSha !== sourceSha256) return null;
  if (obj.clock_state === "unknown" && obj.source_available_at != null) return null;
  if (obj.clock_state === "known") {
    const available = requiredString(obj.source_available_at, 64);
    if (!available) return null;
    return {
      schema: SOURCE_CLOCK_SCHEMA,
      document_id: clockDocument,
      source_sha256: clockSha,
      source_available_at: available,
      system_recorded_at: recorded,
      clock_state: "known",
      rights_profile: rights,
      session_phase: phase,
    };
  }
  return {
    schema: SOURCE_CLOCK_SCHEMA,
    document_id: clockDocument,
    source_sha256: clockSha,
    source_available_at: null,
    system_recorded_at: recorded,
    clock_state: "unknown",
    rights_profile: rights,
    session_phase: phase,
  };
}

function normalizeQaQuestioner(raw: unknown): EventWorkspaceQaQuestioner | null {
  const obj = object(raw);
  if (!obj || !exactKeys(obj, QA_QUESTIONER_KEYS)) return null;
  const name = requiredString(obj.name, 160);
  if (!name) return null;
  const affiliation = obj.affiliation == null ? "" : requiredString(obj.affiliation, 160);
  if (obj.affiliation != null && affiliation == null) return null;
  const nameState = requiredString(obj.name_state, 40);
  const affiliationState = requiredString(obj.affiliation_state, 40);
  if (nameState !== QA_NAME_STATE_SOURCE_SUPPORTED || !affiliationState || !QA_AFFILIATION_STATES.has(affiliationState)) return null;
  if (affiliationState === QA_NAME_STATE_SOURCE_SUPPORTED && !affiliation?.trim()) return null;
  if (affiliationState === "unresolved" && affiliation?.trim()) return null;
  return { name, affiliation: affiliation ?? "", name_state: nameState, affiliation_state: affiliationState };
}

function normalizeQaRespondent(raw: unknown, answerCount: number): EventWorkspaceQaRespondent | null {
  const obj = object(raw);
  if (!obj || !exactKeys(obj, QA_RESPONDENT_KEYS)) return null;
  const name = requiredString(obj.name, 160);
  const role = requiredString(obj.role, 80);
  const identity = requiredString(obj.identity_state, 40);
  if (!name || !role || !identity || identity !== QA_IDENTITY_STATE_SOURCE_SUPPORTED || !Array.isArray(obj.span_indexes) || obj.span_indexes.length === 0) return null;
  const indexes: number[] = [];
  for (const value of obj.span_indexes) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= answerCount) return null;
    indexes.push(value);
  }
  if (indexes.join(",") !== [...new Set(indexes)].sort((a, b) => a - b).join(",")) return null;
  return { name, role, identity_state: identity, span_indexes: indexes };
}

function normalizeQaExchange(raw: unknown, eventId: string): EventWorkspaceQaExchange | null {
  const obj = object(raw);
  if (!obj || !exactKeys(obj, QA_EXCHANGE_KEYS) || obj.schema !== QA_EXCHANGE_SCHEMA) return null;
  for (const key of Object.keys(obj)) {
    if (QA_FORBIDDEN.has(key.toLowerCase())) return null;
  }
  if (obj.event_id !== eventId) return null;
  const ordinal = typeof obj.ordinal === "number" && Number.isInteger(obj.ordinal) && obj.ordinal >= 0 ? obj.ordinal : null;
  const documentId = requiredString(obj.document_id, MAX_ID);
  const documentSha = validSha(obj.document_sha256) ? obj.document_sha256 : null;
  if (ordinal == null || !documentId || !documentSha) return null;
  const expectedId = `qx_${eventId}_${documentSha.slice(0, 12)}_${String(ordinal).padStart(2, "0")}`;
  if (obj.exchange_id !== expectedId) return null;
  if (!Array.isArray(obj.topics) || obj.topics.length !== 1 || obj.topics[0] !== QA_UNAVAILABLE_TOPIC) return null;
  if (obj.taxonomy_version !== QA_TOPIC_VERSION || obj.taxonomy_hash !== QA_TOPIC_HASH) return null;
  if (!Array.isArray(obj.question_spans) || !obj.question_spans.length || !Array.isArray(obj.answer_spans) || !obj.answer_spans.length) return null;
  const questionSpans: EventWorkspaceSourceSpan[] = [];
  for (const span of obj.question_spans) {
    const normalized = normalizeSpan(span);
    if (!normalized || normalized.document_id !== documentId) return null;
    if (normalized.receipt_state === "byte_replayed" && normalized.receipt?.source_sha256 !== documentSha) return null;
    questionSpans.push(normalized);
  }
  const answerSpans: EventWorkspaceSourceSpan[] = [];
  for (const span of obj.answer_spans) {
    const normalized = normalizeSpan(span);
    if (!normalized || normalized.document_id !== documentId) return null;
    if (normalized.receipt_state === "byte_replayed" && normalized.receipt?.source_sha256 !== documentSha) return null;
    answerSpans.push(normalized);
  }
  if (!qaSpansUniqueAndDisjoint(questionSpans, answerSpans)) return null;
  const questioner = normalizeQaQuestioner(obj.questioner);
  if (!questioner) return null;
  if (!Array.isArray(obj.respondents) || !obj.respondents.length) return null;
  const respondents: EventWorkspaceQaRespondent[] = [];
  const owned: number[] = [];
  for (const row of obj.respondents) {
    const respondent = normalizeQaRespondent(row, answerSpans.length);
    if (!respondent) return null;
    owned.push(...respondent.span_indexes);
    respondents.push(respondent);
  }
  if (owned.join(",") !== [...Array(answerSpans.length).keys()].join(",")) return null;
  const provenance = object(obj.provenance);
  if (!provenance || !exactKeys(provenance, QA_PROVENANCE_KEYS)) return null;
  if (provenance.extractor_id !== QA_EXTRACTOR_ID || provenance.validator_id !== QA_VALIDATOR_ID) return null;
  if (provenance.provider != null || provenance.model != null || provenance.prompt_version != null) return null;
  if (provenance.validation_state !== "accepted") return null;
  if (provenance.clock_state !== "known" && provenance.clock_state !== "unknown") return null;
  const runId = requiredString(provenance.run_id, 80);
  const rights = requiredString(provenance.rights_profile, 80);
  if (!runId || !rights) return null;
  const available = provenance.source_available_at == null ? null : requiredString(provenance.source_available_at, 64);
  if (provenance.source_available_at != null && !available) return null;
  if (provenance.clock_state === "unknown" && available != null) return null;
  if (provenance.clock_state === "known" && !available) return null;
  const validation = object(obj.validation);
  if (!validation || !exactKeys(validation, QA_VALIDATION_KEYS)) return null;
  if (validation.replayed !== true || validation.unique_span !== true || validation.event_match !== true || validation.revision_match !== true || validation.rights_ok !== true) return null;
  return {
    schema: QA_EXCHANGE_SCHEMA,
    exchange_id: expectedId,
    event_id: eventId,
    ordinal,
    document_id: documentId,
    document_sha256: documentSha,
    question_spans: questionSpans,
    answer_spans: answerSpans,
    questioner,
    respondents,
    topics: [QA_UNAVAILABLE_TOPIC],
    taxonomy_version: QA_TOPIC_VERSION,
    taxonomy_hash: QA_TOPIC_HASH,
    provenance: {
      extractor_id: QA_EXTRACTOR_ID,
      provider: null,
      model: null,
      prompt_version: null,
      validator_id: QA_VALIDATOR_ID,
      run_id: runId,
      validation_state: "accepted",
      source_available_at: available,
      clock_state: provenance.clock_state,
      rights_profile: rights,
    },
    validation: {
      replayed: true,
      unique_span: true,
      event_match: true,
      revision_match: true,
      rights_ok: true,
    },
  };
}

function normalizeQaExchanges(raw: unknown, eventId: string): EventWorkspaceQaExchange[] {
  if (!Array.isArray(raw) || raw.length > MAX_CLAIMS) return [];
  if (raw.length === 0) return [];
  const exchanges: EventWorkspaceQaExchange[] = [];
  for (const [index, item] of raw.entries()) {
    const exchange = normalizeQaExchange(item, eventId);
    if (!exchange || exchange.ordinal !== index) return [];
    exchanges.push(exchange);
  }
  const ids = exchanges.map((item) => item.exchange_id);
  if (new Set(ids).size !== ids.length) return [];
  const documents = new Set(exchanges.map((item) => `${item.document_id}:${item.document_sha256}`));
  if (documents.size !== 1) return [];
  return exchanges;
}

function qaSpanIdentity(span: EventWorkspaceSourceSpan): string | null {
  const start = span.locator.span_start_byte;
  const end = span.locator.span_end_byte;
  const segment = span.locator.segment_index;
  const sha = span.receipt?.source_sha256 ?? "";
  if (segment == null || start == null || end == null || start >= end) return null;
  return `${span.document_id}:${sha}:${segment}:${start}:${end}`;
}

function qaSpansUniqueAndDisjoint(
  questionSpans: EventWorkspaceSourceSpan[],
  answerSpans: EventWorkspaceSourceSpan[],
): boolean {
  const all = [...questionSpans, ...answerSpans];
  const keys = all.map(qaSpanIdentity);
  if (keys.some((key) => !key)) return false;
  if (new Set(keys).size !== keys.length) return false;
  for (let i = 0; i < all.length; i += 1) {
    const left = all[i]!;
    for (let j = i + 1; j < all.length; j += 1) {
      const right = all[j]!;
      if (left.document_id !== right.document_id) continue;
      if (left.locator.segment_index !== right.locator.segment_index) continue;
      const leftStart = left.locator.span_start_byte ?? 0;
      const leftEnd = left.locator.span_end_byte ?? 0;
      const rightStart = right.locator.span_start_byte ?? 0;
      const rightEnd = right.locator.span_end_byte ?? 0;
      if (leftStart < rightEnd && rightStart < leftEnd) return false;
    }
  }
  return true;
}

function bindQaExchangesToTranscript(
  exchanges: EventWorkspaceQaExchange[],
  sources: EventWorkspaceSource[],
): EventWorkspaceQaExchange[] {
  if (exchanges.length === 0) return [];
  const transcript = sources.find((source) => source.kind === "transcript" && source.receipt_state === "byte_replayed");
  if (!transcript?.document_id || !transcript.source_sha256) return [];
  const clock = transcript.source_clock;
  for (const exchange of exchanges) {
    if (exchange.document_id !== transcript.document_id || exchange.document_sha256 !== transcript.source_sha256) {
      return [];
    }
    for (const span of [...exchange.question_spans, ...exchange.answer_spans]) {
      if (span.document_id !== transcript.document_id) return [];
      if (span.receipt?.source_sha256 !== transcript.source_sha256) return [];
    }
    if (clock) {
      if (exchange.provenance.clock_state !== clock.clock_state) return [];
      if (exchange.provenance.source_available_at !== clock.source_available_at) return [];
    } else if (exchange.provenance.clock_state !== "unknown" || exchange.provenance.source_available_at != null) {
      return [];
    }
  }
  return exchanges;
}

function normalizeSource(raw: unknown, eventId: string): EventWorkspaceSource | null {
  const obj = object(raw);
  if (!obj) return null;
  const kind = requiredString(obj.kind, 40);
  if (!kind) return null;
  if (obj.receipt_state !== "byte_replayed" && obj.receipt_state !== "address_only" && obj.receipt_state !== "typed_absence") {
    return null;
  }
  const absence = obj.typed_absence == null ? null : normalizeAbsence(obj.typed_absence, eventId);
  if (obj.typed_absence != null && !absence) return null;
  if (obj.receipt_state === "typed_absence" && !absence) return null;
  const key = "filing_key" in obj ? filingKey(obj.filing_key) : null;
  if (key === undefined) return null;
  const url = obj.url == null ? null : isSafeHttpsUrl(obj.url) ? obj.url : undefined;
  if (url === undefined) return null;
  const documentId = obj.document_id == null ? null : requiredString(obj.document_id, MAX_ID);
  const sourceSha = obj.source_sha256 == null ? null : validSha(obj.source_sha256) ? obj.source_sha256 : null;
  const clockPresent = Object.prototype.hasOwnProperty.call(obj, "source_clock") && obj.source_clock != null;
  let clock: EventWorkspaceSourceClock | undefined;
  if (clockPresent) {
    if (obj.receipt_state === "typed_absence") return null;
    const normalizedClock = normalizeSourceClock(obj.source_clock, documentId, sourceSha);
    if (!normalizedClock) return null;
    clock = normalizedClock;
  }
  return {
    kind,
    receipt_state: obj.receipt_state,
    document_id: documentId,
    source_sha256: sourceSha,
    url,
    slug: obj.slug == null ? null : requiredString(obj.slug, 120),
    join_status: obj.join_status == null ? null : requiredString(obj.join_status, 40),
    filing_key: key,
    typed_absence: absence,
    ...(clock ? { source_clock: clock } : {}),
  };
}

export function normalizeEventWorkspace(
  raw: unknown,
  expectedEventId?: string,
  expectedGenerationId?: string,
): EventWorkspace | null {
  const obj = object(raw);
  if (!obj || !exactKeys(obj, WORKSPACE_KEYS) || obj.schema !== EVENT_WORKSPACE_SCHEMA || obj.authority !== "context_only") {
    return null;
  }
  const eventId = requiredString(obj.event_id, MAX_ID);
  const generationId = typeof obj.generation_id === "string" ? obj.generation_id : "";
  if (!eventId || !isEventWorkspaceEventId(eventId) || !isEventWorkspaceGenerationId(generationId) || !validTimestamp(obj.generated_at)) {
    return null;
  }
  if (expectedEventId && eventId !== expectedEventId) return null;
  if (expectedGenerationId && generationId !== expectedGenerationId) return null;
  const flags = object(obj.prophet_flags);
  if (!flags || flags.may_rank !== false || flags.may_size !== false || flags.may_gate !== false || flags.prophet_authority !== false) {
    return null;
  }
  if (typeof obj.claim_citations_pending !== "boolean") return null;
  if (!Array.isArray(obj.aliases) || obj.aliases.length > MAX_ALIASES) return null;
  const aliases: string[] = [];
  for (const alias of obj.aliases) {
    const safe = requiredString(alias, MAX_ID);
    if (!safe) return null;
    aliases.push(safe);
  }
  const issuerRaw = object(obj.issuer);
  const displayName = issuerRaw ? requiredString(issuerRaw.display_name, 240) : null;
  const companyId = issuerRaw ? requiredString(issuerRaw.company_id, 32) : null;
  if (!issuerRaw || !displayName || !companyId || !Array.isArray(issuerRaw.listings) || issuerRaw.listings.length > 8) return null;
  const listings: EventWorkspace["issuer"]["listings"] = [];
  for (const listingRaw of issuerRaw.listings) {
    const listing = object(listingRaw);
    const ticker = listing && typeof listing.ticker === "string" ? normalizeCompanyIntelligenceSymbol(listing.ticker) : null;
    if (!listing || !ticker) return null;
    listings.push({
      ticker,
      mic: requiredString(listing.mic, 16) ?? "",
      security_id: listing.security_id == null ? null : requiredString(listing.security_id, 40),
      share_class: listing.share_class == null ? null : requiredString(listing.share_class, 40),
      trading_currency: listing.trading_currency == null ? null : requiredString(listing.trading_currency, 8),
      is_primary: listing.is_primary === true,
      valid_from: listing.valid_from == null ? null : (validDate(listing.valid_from) ? listing.valid_from : null),
      valid_to: listing.valid_to == null ? null : (validDate(listing.valid_to) ? listing.valid_to : null),
    });
  }
  const fiscal = object(obj.fiscal_period);
  const year = fiscal ? boundedInt(fiscal.year, 2000, 2100) : null;
  const quarter = fiscal ? boundedInt(fiscal.quarter, 1, 4) : null;
  if (!fiscal || year === null || quarter === null) return null;
  const lifecycle = object(obj.lifecycle);
  if (!lifecycle || (lifecycle.state !== "complete" && lifecycle.state !== "corrected" && lifecycle.state !== "partial" && lifecycle.state !== "empty")) {
    return null;
  }
  const completenessRaw = object(obj.completeness);
  if (!completenessRaw) return null;
  const release = normalizeCompletenessBlock(completenessRaw.release, eventId);
  const filing = normalizeCompletenessBlock(completenessRaw.filing, eventId);
  const transcript = normalizeCompletenessBlock(completenessRaw.transcript, eventId);
  const slides = normalizeCompletenessBlock(completenessRaw.slides, eventId);
  const consensus = normalizeCompletenessBlock(completenessRaw.consensus, eventId);
  const reaction = normalizeCompletenessBlock(completenessRaw.reaction, eventId);
  if (!release || !filing || !transcript || !slides || !consensus || !reaction) return null;
  if (!Array.isArray(obj.facts) || obj.facts.length > MAX_FACTS) return null;
  const facts: EventWorkspaceFact[] = [];
  for (const item of obj.facts) {
    const fact = normalizeFact(item, eventId);
    if (!fact) return null;
    facts.push(fact);
  }
  if (!Array.isArray(obj.deltas) || obj.deltas.length > MAX_FACTS) return null;
  const deltas: EventWorkspaceDelta[] = [];
  for (const item of obj.deltas) {
    const delta = normalizeDelta(item, eventId);
    if (!delta) return null;
    deltas.push(delta);
  }
  if (!Array.isArray(obj.guidance) || obj.guidance.length > MAX_FACTS) return null;
  const guidance: EventWorkspaceGuidance[] = [];
  for (const item of obj.guidance) {
    const row = normalizeGuidance(item, eventId);
    if (!row) return null;
    guidance.push(row);
  }
  if (!Array.isArray(obj.claims) || obj.claims.length > MAX_CLAIMS) return null;
  const claims: EventWorkspaceClaim[] = [];
  for (const item of obj.claims) {
    const claim = normalizeClaim(item, eventId);
    if (!claim) return null;
    claims.push(claim);
  }
  if (!Array.isArray(obj.sources) || obj.sources.length > MAX_SOURCES) return null;
  const sources: EventWorkspaceSource[] = [];
  for (const item of obj.sources) {
    const source = normalizeSource(item, eventId);
    if (!source) return null;
    sources.push(source);
  }
  if (!Array.isArray(obj.warnings) || obj.warnings.length > MAX_WARNINGS) return null;
  const warnings: string[] = [];
  for (const warning of obj.warnings) {
    if (typeof warning !== "string" || !WORKSPACE_WARNINGS.has(warning)) return null;
    warnings.push(warning);
  }
  if (warnings.join("\0") !== [...new Set(warnings)].sort().join("\0")) return null;
  const qaExchanges = bindQaExchangesToTranscript(normalizeQaExchanges(obj.qa_exchanges, eventId), sources);
  return {
    schema: EVENT_WORKSPACE_SCHEMA,
    event_id: eventId,
    aliases,
    issuer: { company_id: companyId, display_name: displayName, listings },
    fiscal_period: {
      year,
      quarter,
      calendar_end: fiscal.calendar_end == null ? null : (validDate(fiscal.calendar_end) ? fiscal.calendar_end : null),
    },
    lifecycle: {
      state: lifecycle.state,
      observed_at: lifecycle.observed_at == null ? null : (validTimestamp(lifecycle.observed_at) ? lifecycle.observed_at : null),
      source_available_at: lifecycle.source_available_at == null ? null : (validTimestamp(lifecycle.source_available_at) ? lifecycle.source_available_at : null),
    },
    completeness: { release, filing, transcript, slides, consensus, reaction },
    facts,
    deltas,
    guidance,
    claims,
    sources,
    warnings,
    generation_id: generationId,
    generated_at: obj.generated_at,
    authority: "context_only",
    prophet_flags: { may_rank: false, may_size: false, may_gate: false, prophet_authority: false },
    claim_citations_pending: obj.claim_citations_pending,
    qa_exchanges: qaExchanges,
  };
}

export function normalizeEventWorkspaceManifest(raw: unknown): EventWorkspaceManifest | null {
  const obj = object(raw);
  if (!obj || obj.authority !== "context_only") return null;
  const isV1 = obj.schema === EVENT_WORKSPACE_MANIFEST_SCHEMA && exactKeys(obj, MANIFEST_KEYS);
  const isV2 = obj.schema === EVENT_WORKSPACE_MANIFEST_SCHEMA_V2 && exactKeys(obj, MANIFEST_KEYS_V2);
  if (!isV1 && !isV2) return null;
  const generationId = typeof obj.generation_id === "string" ? obj.generation_id : "";
  if (!isEventWorkspaceGenerationId(generationId) || !validTimestamp(obj.generated_at)) return null;
  if (obj.status !== "ready" && obj.status !== "degraded" && obj.status !== "partial" && obj.status !== "empty") return null;
  const eventCount = boundedInt(obj.event_count, 0, 20_000);
  if (eventCount === null) return null;
  const filesRaw = object(obj.files);
  if (!filesRaw || Object.keys(filesRaw).length !== eventCount) return null;
  const files: Record<string, { sha256: string; bytes: number }> = {};
  for (const [key, rawFile] of Object.entries(filesRaw)) {
    if (!key.startsWith("workspaces/") || !key.endsWith(".json") || key.includes("..")) return null;
    const eventId = key.slice("workspaces/".length, -".json".length);
    if (!isEventWorkspaceEventId(eventId)) return null;
    const file = object(rawFile);
    const bytes = file ? boundedInt(file.bytes, 1, EVENT_WORKSPACE_MAX_R2_JSON_BYTES) : null;
    if (!file || !validSha(file.sha256) || bytes === null) return null;
    files[key] = { sha256: file.sha256, bytes };
  }
  const aliasesRaw = object(obj.aliases);
  if (!aliasesRaw) return null;
  const aliases: Record<string, string> = {};
  for (const [alias, canonical] of Object.entries(aliasesRaw)) {
    if (typeof alias !== "string" || alias.length === 0 || alias.length > MAX_ID || typeof canonical !== "string" || !isEventWorkspaceEventId(canonical)) {
      return null;
    }
    aliases[alias] = canonical;
  }
  if (!Array.isArray(obj.warnings)) return null;
  const warnings: string[] = [];
  for (const warning of obj.warnings) {
    if (typeof warning !== "string" || warning.length > 120) return null;
    warnings.push(warning);
  }
  if (warnings.join("\0") !== [...new Set(warnings)].sort().join("\0")) return null;
  let previousGenerationId: string | null | undefined;
  let previousManifestSha: string | null | undefined;
  if (isV2) {
    const previousId = obj.previous_generation_id;
    const previousSha = obj.previous_manifest_sha256;
    const idOk = previousId === null || (typeof previousId === "string" && isEventWorkspaceGenerationId(previousId));
    const shaOk = previousSha === null || (typeof previousSha === "string" && validSha(previousSha));
    if (!idOk || !shaOk) return null;
    if ((previousId == null) !== (previousSha == null)) return null;
    if (typeof previousId === "string" && previousId === generationId) return null;
    previousGenerationId = previousId;
    previousManifestSha = previousSha;
  }
  return {
    schema: isV2 ? EVENT_WORKSPACE_MANIFEST_SCHEMA_V2 : EVENT_WORKSPACE_MANIFEST_SCHEMA,
    generation_id: generationId,
    generated_at: obj.generated_at,
    status: obj.status,
    event_count: eventCount,
    files,
    aliases,
    authority: "context_only",
    warnings,
    ...(isV2 ? { previous_generation_id: previousGenerationId ?? null, previous_manifest_sha256: previousManifestSha ?? null } : {}),
  };
}

export function resolveWorkspaceEventId(eventId: string, aliases: Record<string, string>): string | null {
  const text = eventId.trim();
  if (!text || text.length > 128) return null;
  if (aliases[text]) return aliases[text];
  if (isEventWorkspaceEventId(text)) return text;
  return null;
}

export function tickerPeriodAliasFromWorkspace(workspace: EventWorkspace, ticker: string): string | null {
  const symbol = normalizeCompanyIntelligenceSymbol(ticker);
  if (!symbol) return null;
  const pattern = tickerPeriodAliasPattern(symbol);
  return workspace.aliases.find((alias) => pattern.test(alias)) ?? null;
}

export function transcriptIdFromWorkspace(workspace: EventWorkspace): string | null {
  const fromDoc = workspace.completeness.transcript.document_id;
  const match = typeof fromDoc === "string" ? /\/(\d{4}Q[1-4])$/.exec(fromDoc) : null;
  if (match) return match[1];
  for (const alias of workspace.aliases) {
    const period = TICKER_PERIOD_ALIAS.exec(alias);
    if (period) return `${period[2]}Q${period[3]}`;
  }
  return null;
}

function error(code: EventWorkspaceErrorCode, message: string, retryable: boolean): EventWorkspaceResult {
  return { ok: false, state: "error", available: false, error: { code, message, retryable } };
}

function workspaceResult(workspace: EventWorkspace, receipt: EventWorkspaceVerifiedReceipt, stale = false): EventWorkspaceResult {
  return {
    ok: true,
    state: stale ? "stale" : workspace.lifecycle.state === "partial" ? "partial" : "ready",
    available: true,
    event_id: workspace.event_id,
    workspace,
    authority: "context_only",
    is_context_only: true,
    display_only: true,
    receipt,
  };
}

async function loadManifest(base: string, signal?: AbortSignal): Promise<{ manifest: EventWorkspaceManifest; sha256: string; stale: boolean } | null | "invalid"> {
  const now = Date.now();
  if (manifestCache && now - manifestCache.at < MANIFEST_TTL_MS) {
    return { manifest: manifestCache.data, sha256: manifestCache.sha256, stale: false };
  }
  const markerUrl = `${base}/company_intelligence/${EVENT_WORKSPACE_NEST}/manifest.json`;
  const fetched = await fetchJson(markerUrl, MAX_MANIFEST_BYTES, signal);
  if (fetched.kind !== "ok") return manifestCache ? { manifest: manifestCache.data, sha256: manifestCache.sha256, stale: true } : fetched.kind === "missing" ? null : null;
  const marker = normalizeEventWorkspaceManifest(fetched.raw);
  if (!marker) return manifestCache ? { manifest: manifestCache.data, sha256: manifestCache.sha256, stale: true } : "invalid";
  const immutableUrl = `${base}/company_intelligence/${EVENT_WORKSPACE_NEST}/generations/${marker.generation_id}/manifest.json`;
  const immutableFetched = await fetchJson(immutableUrl, MAX_MANIFEST_BYTES, signal);
  if (immutableFetched.kind !== "ok") return "invalid";
  const immutable = normalizeEventWorkspaceManifest(immutableFetched.raw);
  const markerCanonical = canonicalJson(fetched.raw);
  const immutableCanonical = canonicalJson(immutableFetched.raw);
  if (!immutable || !markerCanonical || markerCanonical !== immutableCanonical || immutable.generation_id !== marker.generation_id) {
    return "invalid";
  }
  const sha = await sha256Hex(fetched.bytes);
  manifestCache = { data: marker, sha256: sha, at: now };
  return { manifest: marker, sha256: sha, stale: false };
}

/**
 * Server-only R2 resolver. `base` must be the trusted R2_BASE from upstreams.ts.
 * Current-event selection uses only verified manifest aliases of the form T/YYYYQn.
 */
export async function resolveCurrentEventWorkspaceFromR2(
  symbol: string,
  base: string,
  options: { signal?: AbortSignal } = {},
): Promise<EventWorkspaceResult> {
  const ticker = normalizeCompanyIntelligenceSymbol(symbol);
  if (!ticker) return error("invalid_symbol", "Invalid ticker", false);
  const safeBase = validateR2Base(base);
  if (!safeBase) return error("upstream_unavailable", "Event workspace is unavailable", true);
  const manifestRead = await loadManifest(safeBase, options.signal);
  if (manifestRead === "invalid") return error("invalid_payload", "Event workspace manifest is invalid", true);
  if (!manifestRead) return error("not_found", "Event workspace is not covered", false);
  const selected = selectCurrentEventFromAliases(ticker, manifestRead.manifest.aliases);
  if ("error" in selected) {
    return selected.error === "ambiguous_event"
      ? error("ambiguous_event", "Event workspace period is ambiguous", false)
      : error("not_found", "Event workspace is not covered", false);
  }
  return resolveEventWorkspaceFromR2(selected.event_id, safeBase, options, manifestRead);
}

export async function resolveEventWorkspaceFromR2(
  eventId: string,
  base: string,
  options: { signal?: AbortSignal } = {},
  preloaded?: { manifest: EventWorkspaceManifest; sha256: string; stale: boolean },
): Promise<EventWorkspaceResult> {
  const safeBase = validateR2Base(base);
  if (!safeBase) return error("upstream_unavailable", "Event workspace is unavailable", true);
  const manifestRead = preloaded ?? await loadManifest(safeBase, options.signal);
  if (manifestRead === "invalid") return error("invalid_payload", "Event workspace manifest is invalid", true);
  if (!manifestRead) return error("not_found", "Event workspace is not covered", false);
  const { manifest, sha256: markerSha, stale } = manifestRead;
  const canonicalId = resolveWorkspaceEventId(eventId, manifest.aliases);
  if (!canonicalId) return error("not_found", "Event workspace alias could not be resolved", false);
  const relative = `workspaces/${canonicalId}.json`;
  const file = manifest.files[relative];
  if (!file) return error("not_found", "Event workspace does not cover this event", false);
  const cacheKey = `${manifest.generation_id}:${canonicalId}`;
  const cached = workspaceCache.get(cacheKey);
  const now = Date.now();
  if (stale) return cached ? workspaceResult(cached.data, cached.receipt, true) : error("upstream_unavailable", "Event workspace is temporarily unavailable", true);
  if (cached && now - cached.at < WORKSPACE_TTL_MS) return workspaceResult(cached.data, cached.receipt);
  const workspaceUrl = `${safeBase}/company_intelligence/${EVENT_WORKSPACE_NEST}/generations/${manifest.generation_id}/${relative}`;
  const fetched = await fetchJson(workspaceUrl, EVENT_WORKSPACE_MAX_R2_JSON_BYTES, options.signal);
  if (fetched.kind !== "ok") {
    return cached ? workspaceResult(cached.data, cached.receipt, true) : error("upstream_unavailable", "Event workspace is temporarily unavailable", true);
  }
  const contentHash = await sha256Hex(fetched.bytes);
  if (fetched.bytes.byteLength !== file.bytes || contentHash !== file.sha256.toLowerCase()) {
    return cached ? workspaceResult(cached.data, cached.receipt, true) : error("invalid_payload", "Event workspace failed its manifest receipt", true);
  }
  const workspace = normalizeEventWorkspace(fetched.raw, canonicalId, manifest.generation_id);
  if (!workspace) {
    return cached ? workspaceResult(cached.data, cached.receipt, true) : error("invalid_payload", "Event workspace payload is invalid", true);
  }
  const receipt: EventWorkspaceVerifiedReceipt = {
    generation_id: manifest.generation_id,
    workspace_sha256: file.sha256,
    marker_sha256: markerSha,
    workspace_url: workspaceUrl,
  };
  if (!workspaceCache.has(cacheKey) && workspaceCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = workspaceCache.keys().next().value as string | undefined;
    if (oldest) workspaceCache.delete(oldest);
  }
  workspaceCache.set(cacheKey, { data: workspace, receipt, at: now });
  return workspaceResult(workspace, receipt);
}

export async function getCurrentEventWorkspace(
  symbol: string,
  options: { signal?: AbortSignal; retryNonce?: number } = {},
): Promise<EventWorkspaceResult> {
  const ticker = normalizeCompanyIntelligenceSymbol(symbol);
  if (!ticker) return error("invalid_symbol", "Invalid ticker", false);
  const suffix = options.retryNonce === undefined ? "" : `?retry=${encodeURIComponent(String(options.retryNonce))}`;
  try {
    const response = await fetch(`/api/event-workspace/${encodeURIComponent(ticker)}${suffix}`, {
      cache: "no-store",
      signal: options.signal,
      headers: { accept: "application/json", "cache-control": "no-store" },
    });
    let raw: unknown;
    try { raw = await response.json(); } catch {
      return error("upstream_unavailable", "Event workspace returned malformed JSON", true);
    }
    const payload = object(raw);
    if (!payload) return error("upstream_unavailable", "Event workspace returned malformed JSON", true);
    if (payload.ok === false && payload.state === "error") {
      const err = object(payload.error);
      const code = err?.code;
      const message = requiredString(err?.message, 300);
      const retryable = err?.retryable;
      if (
        (code === "invalid_symbol" || code === "not_found" || code === "ambiguous_event"
          || code === "upstream_unavailable" || code === "invalid_payload")
        && message && typeof retryable === "boolean"
      ) return error(code, message, retryable);
    }
    if (payload.ok === true && payload.available === true && (payload.state === "ready" || payload.state === "partial" || payload.state === "stale")) {
      const eventId = requiredString(payload.event_id, MAX_ID);
      const workspace = eventId ? normalizeEventWorkspace(payload.workspace, eventId) : null;
      const receiptRaw = object(payload.receipt);
      const generationId = receiptRaw && typeof receiptRaw.generation_id === "string" ? receiptRaw.generation_id : "";
      const workspaceSha = receiptRaw && validSha(receiptRaw.workspace_sha256) ? receiptRaw.workspace_sha256 : null;
      const markerSha = receiptRaw && validSha(receiptRaw.marker_sha256) ? receiptRaw.marker_sha256 : null;
      const workspaceUrl = receiptRaw && requiredString(receiptRaw.workspace_url, 2_048);
      if (
        workspace && eventId && workspace.event_id === eventId && isEventWorkspaceGenerationId(generationId)
        && workspace.generation_id === generationId && workspaceSha && markerSha && workspaceUrl
        && payload.authority === "context_only"
      ) {
        return workspaceResult(workspace, {
          generation_id: generationId,
          workspace_sha256: workspaceSha,
          marker_sha256: markerSha,
          workspace_url: workspaceUrl,
        }, payload.state === "stale");
      }
    }
    return error(response.status === 404 ? "not_found" : "upstream_unavailable", "Event workspace returned an invalid response", response.status !== 404);
  } catch {
    return error("upstream_unavailable", "Event workspace could not be reached", true);
  }
}

/** Test-only cache reset; production paths never call this. */
export function __resetEventWorkspaceCacheForTests(): void {
  manifestCache = null;
  workspaceCache.clear();
}

/** Test-only: expire TTLs so the next read must re-fetch while last-good remains. */
export function __expireEventWorkspaceCacheForTests(): void {
  if (manifestCache) manifestCache.at = 0;
  for (const entry of workspaceCache.values()) entry.at = 0;
}

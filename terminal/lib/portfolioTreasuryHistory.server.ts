// Server-side consumer for the same-box Treasury daily-history producer
// (GET /api/internal/treasury-history on the local flow sidecar). Typed envelope
// validation plus one bounded fetch; no identity resolution, no cookies, no
// account/position/ticker input is ever accepted by this module.
//
// Authority boundary: this module only relays what the producer already asserted.
// `read_at` is a read time, never release freshness; release/knowledge/vintage
// clocks are preserved verbatim (null means unknown). The FRED-cached DGS3MO
// series stays publication_status "not_qualified" — nothing here qualifies,
// transforms rates, fills missing dates or substitutes another series.
import { FLOW_BACKEND } from "./upstreams";

export const TREASURY_DAILY_HISTORY_SCHEMA = "treasury.daily_history.v1";
export const TREASURY_HISTORY_PATH = "/api/internal/treasury-history";
const TREASURY_HISTORY_TIMEOUT_MS = 2500;
const MAX_BODY_BYTES = 1024 * 1024;

/** Raw-literal sidecar origins this consumer may ever contact. Exact match only. */
const ALLOWED_FLOW_BASES: readonly string[] = ["http://127.0.0.1:8000", "http://[::1]:8000"];

/** Pinned producer identity (lib/treasury_daily_history.py); no relabel tolerated. */
const EXPECTED_SOURCE = {
  source_id: "DGS3MO",
  native_alias: "us3m",
  origin: "FRED",
  native_path: "data/fred/DGS3MO.parquet",
  citation:
    "Board of Governors of the Federal Reserve System (US), H.15, via FRED",
  source_url: "https://fred.stlouisfed.org/series/DGS3MO",
  publication_status: "not_qualified",
} as const;

const ENVELOPE_KEYS = [
  "schema", "status", "reason", "unit", "basis", "points", "requested",
  "coverage", "clocks", "source",
] as const;
const REQUESTED_KEYS = ["start", "end", "expected_through"] as const;
const COVERAGE_KEYS = ["observation_count", "requested_calendar_days", "first", "last"] as const;
const CLOCKS_KEYS = ["read_at", "release_at", "knowledge_at", "vintage_at"] as const;
const SOURCE_KEYS = [
  "source_id", "native_alias", "origin", "native_path", "last_observation_date",
  "sha256", "citation", "source_url", "publication_status",
] as const;
const POINT_KEYS = ["date", "value"] as const;

export interface TreasuryHistoryWindow {
  readonly start: string;
  readonly end: string;
  readonly expected_through: string;
}

export interface TreasuryHistoryRequested {
  readonly start: string;
  readonly end: string;
  readonly expected_through: string;
}

/** Mapped point — produced only after the raw envelope validated. */
export interface TreasuryHistoryPoint {
  readonly date: string;
  readonly close: number;
}

export interface TreasuryHistoryCoverage {
  readonly observation_count: number;
  readonly requested_calendar_days: number;
  readonly first: string | null;
  readonly last: string | null;
}

/** Producer clocks; release/knowledge/vintage null means unknown, never invented. */
export interface TreasuryHistoryClocks {
  readonly read_at: string;
  readonly release_at: string | null;
  readonly knowledge_at: string | null;
  readonly vintage_at: string | null;
}

export interface TreasuryHistorySource {
  readonly source_id: string;
  readonly native_alias: string;
  readonly origin: string;
  readonly native_path: string;
  readonly last_observation_date: string | null;
  readonly sha256: string | null;
  readonly citation: string;
  readonly source_url: string;
  readonly publication_status: string;
}

/** Producer said data was observed in the window (read) or dated-but-stale. */
export interface TreasuryHistoryReadResult {
  readonly schema: typeof TREASURY_DAILY_HISTORY_SCHEMA;
  readonly status: "read" | "stale";
  readonly reason: null;
  readonly unit: "percent_per_annum";
  readonly basis: "investment";
  readonly requested: TreasuryHistoryRequested;
  readonly points: readonly TreasuryHistoryPoint[];
  readonly coverage: TreasuryHistoryCoverage;
  readonly clocks: TreasuryHistoryClocks;
  readonly source: TreasuryHistorySource;
}

/** Producer had no window observations (missing/empty/no_coverage). */
export interface TreasuryHistoryMissingResult {
  readonly schema: typeof TREASURY_DAILY_HISTORY_SCHEMA;
  readonly status: "missing";
  readonly reason: null;
  readonly producer_status: "unavailable";
  readonly producer_reason: "missing" | "empty" | "no_coverage";
  readonly unit: "percent_per_annum";
  readonly basis: "investment";
  readonly requested: TreasuryHistoryRequested;
  readonly points: readonly [];
  readonly coverage: TreasuryHistoryCoverage;
  readonly clocks: TreasuryHistoryClocks;
  readonly source: TreasuryHistorySource;
}

export type TreasuryHistoryUnreadableReason =
  | "invalid_request"
  | "invalid_token"
  | "untrusted_origin"
  | "timeout"
  | "transport_error"
  | "redirect_response"
  | "http_error"
  | "body_limit_exceeded"
  | "encoding_error"
  | "schema_mismatch"
  | "malformed_envelope";

/** Sanitized failure: reason class only, never exception text or response bodies. */
export interface TreasuryHistoryUnreadableResult {
  readonly schema: typeof TREASURY_DAILY_HISTORY_SCHEMA;
  readonly status: "unreadable";
  readonly reason: TreasuryHistoryUnreadableReason;
  readonly detail: null;
  readonly http_status: number | null;
  readonly requested: TreasuryHistoryRequested | null;
}

export type TreasuryHistoryResult =
  | TreasuryHistoryReadResult
  | TreasuryHistoryMissingResult
  | TreasuryHistoryUnreadableResult;

const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const RFC3339 = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DAY_MS = 86400000;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Strict real ISO calendar date (YYYY-MM-DD, true calendar); returns input or null. */
function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const limit = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= limit ? value : null;
}

/** Strict RFC3339 UTC-offset timestamp; returns input or null. */
function rfc3339(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = RFC3339.exec(value);
  if (match === null || isoDate(`${match[1]}-${match[2]}-${match[3]}`) === null) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  if (Number.isNaN(Date.parse(value))) return null;
  return value;
}

/** UTC calendar day of a validated RFC3339 instant, matching the producer's now.date(). */
function utcDay(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dayNumber(iso: string): number {
  // Date.UTC maps years 0..99 into 1900..1999; ISO parsing preserves the year.
  return Date.parse(`${iso}T00:00:00.000Z`);
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) return null;
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return null;
  }
  return record;
}

/**
 * Pure structural window validation: strict real dates, start <= expected_through
 * <= end, span 1..3660 calendar days. Deliberately no "not in the future" check —
 * that is the producer's clock, never invented here.
 */
export function validateTreasuryHistoryWindow(
  window: TreasuryHistoryWindow,
): TreasuryHistoryRequested | null {
  const start = isoDate(window?.start);
  const end = isoDate(window?.end);
  const expectedThrough = isoDate(window?.expected_through);
  if (start === null || end === null || expectedThrough === null) return null;
  const span = (dayNumber(end) - dayNumber(start)) / DAY_MS;
  if (span < 0 || span >= 3660) return null;
  if (dayNumber(expectedThrough) < dayNumber(start) || dayNumber(expectedThrough) > dayNumber(end)) return null;
  return { start, end, expected_through: expectedThrough };
}

/**
 * Resolve the sidecar origin from its raw literal. Exact allowlist match after
 * stripping at most one trailing slash; no URL parsing, no host normalization,
 * no numeric-alias or DNS forms, whitespace/backslash rejected outright.
 */
export function resolveFlowBase(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (/[\s\\]/.test(raw)) return null;
  const candidate = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return ALLOWED_FLOW_BASES.includes(candidate) ? candidate : null;
}

function unreadable(
  reason: TreasuryHistoryUnreadableReason,
  requested: TreasuryHistoryRequested | null,
  httpStatus: number | null = null,
): TreasuryHistoryUnreadableResult {
  return { schema: TREASURY_DAILY_HISTORY_SCHEMA, status: "unreadable", reason, detail: null, http_status: httpStatus, requested };
}

function clocksFrom(record: Record<string, unknown>): TreasuryHistoryClocks | null {
  const clocks = exactObject(record.clocks, CLOCKS_KEYS);
  if (clocks === null) return null;
  const readAt = rfc3339(clocks.read_at);
  if (readAt === null) return null;
  const releaseAt = clocks.release_at === null ? null : rfc3339(clocks.release_at);
  const knowledgeAt = clocks.knowledge_at === null ? null : rfc3339(clocks.knowledge_at);
  const vintageAt = clocks.vintage_at === null ? null : rfc3339(clocks.vintage_at);
  if (
    (clocks.release_at !== null && releaseAt === null) ||
    (clocks.knowledge_at !== null && knowledgeAt === null) ||
    (clocks.vintage_at !== null && vintageAt === null)
  ) {
    return null;
  }
  return { read_at: readAt, release_at: releaseAt, knowledge_at: knowledgeAt, vintage_at: vintageAt };
}

function sourceFrom(record: Record<string, unknown>, readAtDay: string | null): TreasuryHistorySource | null {
  const source = exactObject(record.source, SOURCE_KEYS);
  if (source === null) return null;
  for (const [key, expected] of Object.entries(EXPECTED_SOURCE)) {
    if (source[key] !== expected) return null;
  }
  const lastObservation = source.last_observation_date === null ? null : isoDate(source.last_observation_date);
  if (source.last_observation_date !== null && lastObservation === null) return null;
  const sha256 = source.sha256 === null ? null : source.sha256;
  if (sha256 !== null && (typeof sha256 !== "string" || !SHA256.test(sha256))) return null;
  if (readAtDay !== null && lastObservation !== null && dayNumber(lastObservation) > dayNumber(readAtDay)) return null;
  return {
    source_id: EXPECTED_SOURCE.source_id,
    native_alias: EXPECTED_SOURCE.native_alias,
    origin: EXPECTED_SOURCE.origin,
    native_path: EXPECTED_SOURCE.native_path,
    last_observation_date: lastObservation,
    sha256,
    citation: EXPECTED_SOURCE.citation,
    source_url: EXPECTED_SOURCE.source_url,
    publication_status: EXPECTED_SOURCE.publication_status,
  };
}

/**
 * Pure parser/validator for one producer envelope JSON value against the exact
 * request. Returns a typed read/stale result, a missing result (only for a
 * structurally valid empty envelope) or a sanitized unreadable result. Anything
 * malformed, partially valid or unrequested is rejected, never repaired.
 */
export function parseTreasuryHistoryEnvelope(
  raw: unknown,
  request: TreasuryHistoryWindow,
): TreasuryHistoryResult {
  const requested = validateTreasuryHistoryWindow(request);
  if (requested === null) return unreadable("invalid_request", null);

  const envelope = exactObject(raw, ENVELOPE_KEYS);
  if (envelope === null) return unreadable("malformed_envelope", requested);
  if (envelope.schema !== TREASURY_DAILY_HISTORY_SCHEMA) return unreadable("schema_mismatch", requested);
  if (envelope.unit !== "percent_per_annum" || envelope.basis !== "investment") {
    return unreadable("malformed_envelope", requested);
  }
  const requestField = exactObject(envelope.requested, REQUESTED_KEYS);
  if (
    requestField === null ||
    requestField.start !== requested.start ||
    requestField.end !== requested.end ||
    requestField.expected_through !== requested.expected_through
  ) {
    return unreadable("malformed_envelope", requested);
  }
  const clocks = clocksFrom(envelope);
  if (clocks === null) return unreadable("malformed_envelope", requested);
  const readAtDay = utcDay(clocks.read_at);
  // This checks the producer's own clock, never an invented local freshness floor.
  if (isoDate(readAtDay) === null || dayNumber(requested.end) > dayNumber(readAtDay)) {
    return unreadable("malformed_envelope", requested);
  }

  const status = envelope.status;
  if (status === "unavailable") {
    return parseUnavailableEnvelope(envelope, requested, clocks, readAtDay);
  }
  if (status !== "read" && status !== "stale") return unreadable("malformed_envelope", requested);

  const coverage = exactObject(envelope.coverage, COVERAGE_KEYS);
  if (coverage === null || !Array.isArray(envelope.points) || envelope.points.length === 0) {
    return unreadable("malformed_envelope", requested);
  }
  const source = sourceFrom(envelope, readAtDay);
  if (source === null) return unreadable("malformed_envelope", requested);

  const points: TreasuryHistoryPoint[] = [];
  let previous = "";
  for (const entry of envelope.points) {
    const point = exactObject(entry, POINT_KEYS);
    const date = point === null ? null : isoDate(point.date);
    const value = point === null ? null : point.value;
    if (
      date === null ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (points.length > 0 && dayNumber(date) <= dayNumber(previous))
    ) {
      return unreadable("malformed_envelope", requested);
    }
    if (dayNumber(date) < dayNumber(requested.start) || dayNumber(date) > dayNumber(requested.end)) {
      return unreadable("malformed_envelope", requested);
    }
    if (dayNumber(date) > dayNumber(readAtDay)) return unreadable("malformed_envelope", requested);
    previous = date;
    points.push({ date, close: value });
  }

  const last = points[points.length - 1];
  const span = (dayNumber(requested.end) - dayNumber(requested.start)) / DAY_MS + 1;
  if (
    typeof coverage.observation_count !== "number" ||
    coverage.observation_count !== points.length ||
    coverage.first !== points[0].date ||
    coverage.last !== last.date ||
    coverage.requested_calendar_days !== span
  ) {
    return unreadable("malformed_envelope", requested);
  }
  if (source.last_observation_date === null || source.sha256 === null) {
    return unreadable("malformed_envelope", requested);
  }
  if (dayNumber(source.last_observation_date) < dayNumber(last.date)) {
    return unreadable("malformed_envelope", requested);
  }

  const stale = dayNumber(last.date) < dayNumber(requested.expected_through);
  if ((status === "stale") !== stale) return unreadable("malformed_envelope", requested);
  if (stale && envelope.reason !== "before_expected_through") return unreadable("malformed_envelope", requested);
  if (!stale && envelope.reason !== null) return unreadable("malformed_envelope", requested);

  return {
    schema: TREASURY_DAILY_HISTORY_SCHEMA,
    status,
    reason: null,
    unit: "percent_per_annum",
    basis: "investment",
    requested,
    points,
    coverage: {
      observation_count: points.length,
      requested_calendar_days: span,
      first: points[0].date,
      last: last.date,
    },
    clocks,
    source,
  };
}

function parseUnavailableEnvelope(
  envelope: Record<string, unknown>,
  requested: TreasuryHistoryRequested,
  clocks: TreasuryHistoryClocks,
  readAtDay: string,
): TreasuryHistoryResult {
  const producerReason = envelope.reason;
  if (producerReason !== "missing" && producerReason !== "empty" && producerReason !== "no_coverage") {
    return unreadable("malformed_envelope", requested);
  }
  if (!Array.isArray(envelope.points) || envelope.points.length !== 0) {
    return unreadable("malformed_envelope", requested);
  }
  const coverage = exactObject(envelope.coverage, COVERAGE_KEYS);
  const span = (dayNumber(requested.end) - dayNumber(requested.start)) / DAY_MS + 1;
  if (
    coverage === null ||
    coverage.observation_count !== 0 ||
    coverage.first !== null ||
    coverage.last !== null ||
    coverage.requested_calendar_days !== span
  ) {
    return unreadable("malformed_envelope", requested);
  }
  const source = sourceFrom(envelope, readAtDay);
  if (source === null) return unreadable("malformed_envelope", requested);
  if (producerReason === "no_coverage") {
    // Observations exist but none inside the window, so the latest one must be
    // dated, real and outside [start, end] — never inside it.
    if (
      source.last_observation_date === null ||
      (dayNumber(source.last_observation_date) >= dayNumber(requested.start) &&
        dayNumber(source.last_observation_date) <= dayNumber(requested.end))
    ) {
      return unreadable("malformed_envelope", requested);
    }
  } else if (source.last_observation_date !== null) {
    return unreadable("malformed_envelope", requested);
  }
  return {
    schema: TREASURY_DAILY_HISTORY_SCHEMA,
    status: "missing",
    reason: null,
    producer_status: "unavailable",
    producer_reason: producerReason,
    unit: "percent_per_annum",
    basis: "investment",
    requested,
    points: [],
    coverage: { observation_count: 0, requested_calendar_days: span, first: null, last: null },
    clocks,
    source,
  };
}

export interface TreasuryHistoryFetchOptions {
  /** Injectable transport for tests; defaults to global fetch. No retries anywhere. */
  readonly fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  /** Injectable raw sidecar base literal for tests; defaults to FLOW_BACKEND. */
  readonly baseUrl?: string;
}

async function readBoundedBody(response: Response): Promise<Uint8Array | null> {
  const stream = response.body;
  if (stream !== null && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  }
  const text = await response.text();
  const bytes = new TextEncoder().encode(text);
  return bytes.byteLength > MAX_BODY_BYTES ? null : bytes;
}

/**
 * One GET of the producer window over the local sidecar. The raw base literal is
 * allowlisted before the Authorization header is ever constructed; the bearer
 * token arrives pre-verified from the route. Single attempt, no redirects
 * followed, no cookies, no body, 2500ms timeout, 1MiB bounded read; every
 * transport/HTTP/schema/encoding failure collapses to a sanitized unreadable.
 */
export async function fetchTreasuryHistory(
  request: TreasuryHistoryWindow,
  token: string,
  options: TreasuryHistoryFetchOptions = {},
): Promise<TreasuryHistoryResult> {
  const requested = validateTreasuryHistoryWindow(request);
  if (requested === null) return unreadable("invalid_request", null);
  if (typeof token !== "string" || token.length === 0 || /\s/.test(token)) {
    return unreadable("invalid_token", requested);
  }
  const base = resolveFlowBase(options.baseUrl ?? FLOW_BACKEND);
  if (base === null) return unreadable("untrusted_origin", requested);

  const query = `start=${encodeURIComponent(requested.start)}&end=${encodeURIComponent(requested.end)}&expected_through=${encodeURIComponent(requested.expected_through)}`;
  const url = `${base}${TREASURY_HISTORY_PATH}?${query}`;
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(TREASURY_HISTORY_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    return unreadable(name === "AbortError" || name === "TimeoutError" ? "timeout" : "transport_error", requested);
  }

  const status = response.status;
  if ((status >= 300 && status < 400) || response.type === "opaqueredirect") {
    return unreadable("redirect_response", requested, status);
  }
  if (status !== 200) return unreadable("http_error", requested, status);

  let body: Uint8Array;
  try {
    const bounded = await readBoundedBody(response);
    if (bounded === null) return unreadable("body_limit_exceeded", requested, status);
    body = bounded;
  } catch {
    return unreadable("transport_error", requested, status);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return unreadable("encoding_error", requested, status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return unreadable("malformed_envelope", requested, status);
  }
  return parseTreasuryHistoryEnvelope(parsed, request);
}

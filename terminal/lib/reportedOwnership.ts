/**
 * `mastermind.reported-ownership/v1` — the Terminal-side reader for provider-reported institutional
 * holders, built from `ingest/reported_ownership.py` in the same repository.
 *
 * WHAT THIS IS NOT
 *   This is not Company Intelligence and it is not 13F. It is a separate, independently validated
 *   snapshot of what one data provider said about one listing. Nothing here may qualify, authorize
 *   or stand in for a verified CI event — an invalid CI block does not hide a valid reported block,
 *   and a valid reported block does not rescue an invalid CI one. The two are read separately and
 *   gated separately, and this file deliberately does not import the CI reader.
 *
 *   `raw_input_sha256` + `content_sha256` are an internal integrity receipt: they prove the block
 *   was not corrupted or edited between the collector cache and this screen. They are not a
 *   signature, not a CI manifest verification, and not evidence that the provider said what it said.
 *
 * WHY IT IS STRICT
 *   The payload arrives as untrusted JSON. Every field is re-checked here — listing scope, schema,
 *   population, the fixed source label, timestamps, calendar dates, per-row bounds and the absence
 *   of any JSON number — and the content hash is recomputed with WebCrypto before a single row is
 *   allowed to render. Anything that fails is dropped, not repaired: a wrong symbol, a non-finite
 *   number, an out-of-unit percentage, a future-dated report or a corrupted hash all fail closed.
 *
 * DATES
 *   Reported dates are the provider's own and are shown as stated. How old a report date is says
 *   nothing about whether the upstream feed is healthy, so report-date age is never treated as
 *   staleness here. Only the acquisition timestamp can mark the block stale, and an unknown date
 *   stays unknown — it is never back-filled from the report dates, the clock, or each other.
 */

export const REPORTED_OWNERSHIP_SCHEMA = "mastermind.reported-ownership/v1";
export const REPORTED_OWNERSHIP_POPULATION = "vendor_institutional_holders";
export const REPORTED_OWNERSHIP_PERCENTAGE_BASIS = "provider_reported_unspecified";
export const REPORTED_OWNERSHIP_NORMALIZER_VERSION = "1";

export const REPORTED_OWNERSHIP_SOURCE_NAME = "Yahoo Finance";
export const REPORTED_OWNERSHIP_SOURCE_ADAPTER = "yfinance";
export const REPORTED_OWNERSHIP_SOURCE_FIELD = "institutional_holders";

export type ReportedOwnershipMarket = "ca" | "hk";
export type ReportedOwnershipAvailability = "available" | "partial" | "unavailable" | "source_error";

/** Stable machine reasons emitted by the normalizer. The panel maps these to localized copy and
 *  falls back to the raw code for one it does not know, so an old client never invents a reason. */
export type ReportedOwnershipReason =
  | "raw_unavailable"
  | "raw_unparsable"
  | "raw_ticker_mismatch"
  | "acquired_at_missing"
  | "market_unsupported"
  | "fetch_field_error"
  | "no_dated_rows"
  | "rows_dropped_unqualified"
  | "retained_after_failure";

export const REPORTED_OWNERSHIP_REASONS: readonly ReportedOwnershipReason[] = [
  "raw_unavailable",
  "raw_unparsable",
  "raw_ticker_mismatch",
  "acquired_at_missing",
  "market_unsupported",
  "fetch_field_error",
  "no_dated_rows",
  "rows_dropped_unqualified",
  "retained_after_failure",
];

export interface ReportedOwnershipRow {
  holder_name: string;
  /** YYYY-MM-DD exactly as the provider stated it. */
  reported_date: string;
  /** Decimal integer string, or null when the provider did not state one. Never 0 for "unknown". */
  shares: string | null;
  /** Plain decimal string in [0,1], or null. Display only; the denominator is unspecified. */
  reported_fraction: string | null;
}

export interface ReportedOwnershipBlock {
  schema: string;
  listing: { ticker: string; market: ReportedOwnershipMarket };
  population: string;
  source: { name: string; adapter: string; field: string; url: string };
  acquired_at: string | null;
  latest_attempt_at: string | null;
  /** This adapter never establishes a publication time, so this is always null. */
  publication_time: null;
  percentage_basis: string;
  availability: ReportedOwnershipAvailability;
  unavailable_reason: ReportedOwnershipReason | null;
  normalizer_version: string;
  /** SHA-256 of the exact raw collector bytes; null only when there are no rows to describe. */
  raw_input_sha256: string | null;
  rows: ReportedOwnershipRow[];
  content_sha256: string;
}

const AVAILABILITIES: readonly string[] = ["available", "partial", "unavailable", "source_error"];

const MARKET_SUFFIXES: Record<string, ReportedOwnershipMarket> = { ".TO": "ca", ".V": "ca", ".HK": "hk" };

/** Listings the panel renders for. CN suffixes are included on purpose: CN must be able to show an
 *  explicit absence, and must never fall back to the legacy undated `top_inst` field instead. */
const PANEL_SUFFIXES = [".TO", ".V", ".HK", ".SS", ".SZ", ".BJ"] as const;

const PLAIN_DECIMAL_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9][0-9]*)$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const UTC_INSTANT_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const REASON_RE = /^[a-z0-9_]{1,64}$/;

// ─────────────────────────────────────────────────────────────────────────────
// listing scope
// ─────────────────────────────────────────────────────────────────────────────

/** True when the panel should render the reported-ownership surface for this symbol. */
export function isReportedOwnershipSymbol(symbol: string | null | undefined): boolean {
  if (typeof symbol !== "string") return false;
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return false;
  return PANEL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** ca|hk for a listing this adapter qualifies, else null. A US symbol is out of scope, not absent. */
export function reportedOwnershipMarket(symbol: string | null | undefined): ReportedOwnershipMarket | null {
  if (typeof symbol !== "string") return null;
  const normalized = symbol.trim().toUpperCase();
  for (const suffix of Object.keys(MARKET_SUFFIXES)) {
    if (normalized.endsWith(suffix)) return MARKET_SUFFIXES[suffix];
  }
  return null;
}

/** The fixed provider URL for a listing. Never derived from provider HTML or a link in the feed. */
export function reportedOwnershipSourceUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol.trim().toUpperCase())}/holders/`;
}

// ─────────────────────────────────────────────────────────────────────────────
// scalar checks — all of these avoid binary floating point on purpose
// ─────────────────────────────────────────────────────────────────────────────

export function isPlainDecimal(text: unknown): text is string {
  return typeof text === "string" && PLAIN_DECIMAL_RE.test(text);
}

/** True for a canonical plain decimal in [0,1], compared as text rather than as a float. */
export function isUnitFraction(text: unknown): text is string {
  if (!isPlainDecimal(text)) return false;
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  const frac = dot === -1 ? "" : text.slice(dot + 1);
  // The regex forbids leading zeros, so `whole` is "0" or a canonical positive integer.
  if (whole.length > 1) return false; // >= 10, unambiguously out of range
  if (whole === "1") return frac.replace(/0/g, "") === ""; // only 1.000… exactly
  return whole === "0"; // 2..9 are single digits and still out of range
}

export function isDecimalInteger(text: unknown): text is string {
  return typeof text === "string" && DECIMAL_INTEGER_RE.test(text);
}

function isRealCalendarDate(text: unknown): text is string {
  if (typeof text !== "string" || !DATE_RE.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of month index `month` (0-based, so one past this month) IS this month's last day,
  // which gets leap years exactly right without a special case.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

export function isUtcInstant(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const match = UTC_INSTANT_RE.exec(text);
  if (!match) return false;
  if (!isRealCalendarDate(text.slice(0, 10))) return false;
  return Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 60;
}

/** Day number for a validated YYYY-MM-DD. */
function dayOrdinal(dateText: string): number {
  const year = Number(dateText.slice(0, 4));
  const month = Number(dateText.slice(5, 7));
  const day = Number(dateText.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * A block is stale only by its ACQUISITION time. Report-date age is deliberately not used: a
 * provider that has not filed this quarter is not a broken feed, and marking it stale would make
 * a correct record look like a fault.
 */
export function isAcquisitionStale(acquiredAt: string | null, nowMs: number, thresholdDays: number): boolean {
  if (!isUtcInstant(acquiredAt)) return false;
  const acquired = Date.parse(acquiredAt);
  if (!Number.isFinite(acquired)) return false;
  return nowMs - acquired > thresholdDays * 86_400_000;
}

/** Any JSON number anywhere in the block is disqualifying: the hashed form is strings only. */
function hasJsonNumber(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.some((item) => hasJsonNumber(item, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasJsonNumber(item, depth + 1));
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// canonical form + hash — must agree byte-for-byte with ingest/reported_ownership.py
// ─────────────────────────────────────────────────────────────────────────────

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      const source = item as Record<string, unknown>;
      const target: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) target[key] = normalize(source[key]);
      return target;
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Content hash of the block, excluding `content_sha256` itself. */
export function contentDigestInput(block: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (key !== "content_sha256") payload[key] = value;
  }
  return canonicalJson(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// structural validation
// ─────────────────────────────────────────────────────────────────────────────

export type ReportedOwnershipReject = { ok: false; code: string };
export type ReportedOwnershipAccepted = { ok: true; block: ReportedOwnershipBlock };
export type ReportedOwnershipResult = ReportedOwnershipAccepted | ReportedOwnershipReject;

function reject(code: string): ReportedOwnershipReject {
  return { ok: false, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate everything that does not need async hashing: schema, listing scope, the fixed source
 * label, timestamps, calendar dates, row bounds, the availability state and the absence of numbers.
 */
export function validateReportedOwnershipStructure(
  value: unknown,
  expected: { ticker: string; nowMs?: number },
): ReportedOwnershipResult {
  if (!isRecord(value)) return reject("not_an_object");
  if (hasJsonNumber(value)) return reject("numeric_leaf_in_hashed_block");

  const ticker = expected.ticker.trim().toUpperCase();
  const market = reportedOwnershipMarket(ticker);
  if (!market) return reject("market_unsupported");

  if (value.schema !== REPORTED_OWNERSHIP_SCHEMA) return reject("schema_mismatch");
  if (value.population !== REPORTED_OWNERSHIP_POPULATION) return reject("population_mismatch");
  if (value.percentage_basis !== REPORTED_OWNERSHIP_PERCENTAGE_BASIS) return reject("percentage_basis_mismatch");
  if (value.normalizer_version !== REPORTED_OWNERSHIP_NORMALIZER_VERSION) return reject("normalizer_version_mismatch");
  // This adapter never establishes a publication time. A value here means a different producer.
  if (value.publication_time !== null) return reject("publication_time_not_established");
  if (typeof value.availability !== "string" || !AVAILABILITIES.includes(value.availability)) {
    return reject("availability_invalid");
  }

  if (!isRecord(value.listing)) return reject("listing_missing");
  if (value.listing.ticker !== ticker) return reject("listing_ticker_mismatch");
  if (value.listing.market !== market) return reject("listing_market_mismatch");

  if (!isRecord(value.source)) return reject("source_missing");
  if (value.source.name !== REPORTED_OWNERSHIP_SOURCE_NAME) return reject("source_name_mismatch");
  if (value.source.adapter !== REPORTED_OWNERSHIP_SOURCE_ADAPTER) return reject("source_adapter_mismatch");
  if (value.source.field !== REPORTED_OWNERSHIP_SOURCE_FIELD) return reject("source_field_mismatch");
  // Exact match against the one URL this adapter publishes: an arbitrary or harvested link fails.
  if (value.source.url !== reportedOwnershipSourceUrl(ticker)) return reject("source_url_mismatch");

  const acquiredAt = value.acquired_at;
  const latestAttemptAt = value.latest_attempt_at;
  if (acquiredAt !== null && !isUtcInstant(acquiredAt)) return reject("acquired_at_invalid");
  if (latestAttemptAt !== null && !isUtcInstant(latestAttemptAt)) return reject("latest_attempt_at_invalid");

  const nowMs = expected.nowMs ?? Date.now();
  // A block cannot have been acquired in the future. Report dates are checked per row below.
  for (const stamp of [acquiredAt, latestAttemptAt]) {
    if (isUtcInstant(stamp) && Date.parse(stamp) - 86_400_000 > nowMs) return reject("timestamp_in_future");
  }

  if (!Array.isArray(value.rows)) return reject("rows_missing");
  const rows: ReportedOwnershipRow[] = [];
  for (const raw of value.rows) {
    if (!isRecord(raw)) return reject("row_not_an_object");
    if (typeof raw.holder_name !== "string" || raw.holder_name.trim() === "") return reject("row_holder_missing");
    const holderName = raw.holder_name;
    const reportedDate = raw.reported_date;
    const shares = raw.shares;
    const fraction = raw.reported_fraction;
    if (!isRealCalendarDate(reportedDate)) return reject("row_date_invalid");
    if (dayOrdinal(reportedDate) > Math.floor(nowMs / 86_400_000)) return reject("row_date_in_future");
    if (shares !== null && !isDecimalInteger(shares)) return reject("row_shares_invalid");
    if (fraction !== null && !isUnitFraction(fraction)) return reject("row_fraction_out_of_bounds");
    rows.push({
      holder_name: holderName,
      reported_date: reportedDate,
      shares,
      reported_fraction: fraction,
    });
  }

  const reason = value.unavailable_reason;
  if (reason !== null && (typeof reason !== "string" || !REASON_RE.test(reason))) {
    return reject("unavailable_reason_invalid");
  }
  // Availability and rows have to agree: a complete-looking status with no rows, or rows with no
  // stated status, is a contradiction this reader refuses to resolve in the block's favour.
  if (rows.length === 0) {
    if (value.availability === "available") return reject("available_without_rows");
    if (reason === null) return reject("absent_without_reason");
  }
  if (value.availability === "available" && reason !== null) return reject("available_with_reason");
  if (value.availability !== "available" && reason === null) return reject("degraded_without_reason");
  // Rows are a receipt of raw bytes; without one there is nothing that was actually observed.
  const rawReceipt = value.raw_input_sha256;
  if (rows.length > 0 && rawReceipt === null) return reject("raw_input_sha256_missing");
  if (rawReceipt !== null && (typeof rawReceipt !== "string" || !HEX64_RE.test(rawReceipt))) {
    return reject("raw_input_sha256_invalid");
  }
  if (typeof value.content_sha256 !== "string" || !HEX64_RE.test(value.content_sha256)) {
    return reject("content_sha256_invalid");
  }

  return { ok: true, block: value as unknown as ReportedOwnershipBlock };
}

/**
 * Structural validation plus the WebCrypto content-hash check. Abortable, so a caller that has
 * already moved to another listing can stop paying for the digest of a block it will not render.
 */
export async function verifyReportedOwnership(
  value: unknown,
  expected: { ticker: string; nowMs?: number; signal?: AbortSignal },
): Promise<ReportedOwnershipResult> {
  const structural = validateReportedOwnershipStructure(value, expected);
  if (!structural.ok) return structural;
  if (expected.signal?.aborted) return reject("aborted");

  let computed: string;
  try {
    computed = await sha256Hex(contentDigestInput(value as Record<string, unknown>));
  } catch {
    // A missing or restricted SubtleCrypto is a verification failure, never a bypass.
    return reject("hash_unavailable");
  }
  if (expected.signal?.aborted) return reject("aborted");
  if (computed !== structural.block.content_sha256) return reject("content_hash_mismatch");
  return structural;
}

// ─────────────────────────────────────────────────────────────────────────────
// display derivation
// ─────────────────────────────────────────────────────────────────────────────

const EM_DASH = "—";

/**
 * Percent label derived for display only, from the bounded fraction, by decimal string arithmetic.
 *
 * The provider does not state a denominator, so this is presented as a reported figure and never
 * summed, ranked, or compared across listings. Anything outside [0,1] renders as unknown.
 */
export function deriveReportedPercent(fraction: string | null | undefined): string | null {
  if (!isUnitFraction(fraction)) return null;
  const dot = fraction.indexOf(".");
  const whole = dot === -1 ? fraction : fraction.slice(0, dot);
  const frac = dot === -1 ? "" : fraction.slice(dot + 1);
  // ×100 shifts the decimal point two places right, in exact decimal arithmetic.
  const digits = whole + frac;
  const point = whole.length + 2;
  let intPart: string;
  let decPart: string;
  if (point >= digits.length) {
    intPart = digits + "0".repeat(point - digits.length);
    decPart = "";
  } else {
    intPart = digits.slice(0, point);
    decPart = digits.slice(point);
  }

  let keep = decPart.slice(0, 2).padEnd(2, "0");
  const third = decPart[2];
  if (third !== undefined && Number(third) >= 5) {
    // Round half-up across the integer/fraction boundary, in exact decimal string arithmetic.
    const digits = (intPart + keep).split("");
    let index = digits.length - 1;
    let carry = 1;
    while (index >= 0 && carry > 0) {
      const sum = Number(digits[index]) + carry;
      digits[index] = String(sum % 10);
      carry = sum >= 10 ? 1 : 0;
      index -= 1;
    }
    const rounded = (carry > 0 ? "1" : "") + digits.join("");
    intPart = rounded.slice(0, Math.max(1, intPart.length));
    keep = rounded.slice(intPart.length);
  }

  intPart = intPart.replace(/^0+(?=[0-9])/, "");
  keep = keep.replace(/0+$/, "");
  return keep ? `${intPart}.${keep}` : intPart;
}

/** Percent label for a row, or an em dash when the provider stated no usable figure. */
export function formatReportedPercent(fraction: string | null | undefined): string {
  const derived = deriveReportedPercent(fraction);
  return derived === null ? EM_DASH : `${derived}%`;
}

/** Grouped share count for display, or an em dash when the provider stated none. */
export function formatReportedShares(shares: string | null | undefined): string {
  if (!isDecimalInteger(shares)) return EM_DASH;
  return shares.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export { EM_DASH as REPORTED_OWNERSHIP_EM_DASH };
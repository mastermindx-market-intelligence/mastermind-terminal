/**
 * Verified Company Theme Context transport.
 *
 * The browser only speaks to the same-origin BFF. The BFF proves the public
 * R2 publication in this order: mutable marker -> immutable manifest ->
 * generation-addressed company object. This is a curated-membership context
 * plane, never a theme score, causal claim, or trade recommendation.
 */

import { normalizeCompanyIntelligenceSymbol } from "./companyIntelligence";

export const COMPANY_THEME_EXPOSURE_SCHEMA = "company_theme_exposure.v1" as const;
export const COMPANY_THEME_EXPOSURE_MANIFEST_SCHEMA = "company_theme_exposure_manifest.v1" as const;
export const COMPANY_THEME_EXPOSURE_MAX_R2_JSON_BYTES = 2 * 1024 * 1024;

export type CompanyThemeExposureWireStatus = "ready" | "partial";
export type CompanyThemeExposureState = CompanyThemeExposureWireStatus | "stale" | "not_covered";
export type CompanyThemeExposureWarning =
  | "theme_state_missing"
  | "theme_state_invalid"
  | "theme_state_stale"
  | "theme_state_future"
  | "active_membership_unmapped"
  | "active_memberships_unmapped";

export interface CompanyThemeExposureItem {
  theme_id: string;
  name_en: string;
  name_zh: string;
  basket_id: string;
  /** Curated crosswalk quality; never a claim about the company itself. */
  mapping_qualifier: "direct" | "proxy" | "curated";
}

export interface CompanyThemeCoverage {
  status: "no_active_membership" | "mapped" | "unmapped_only" | "mixed";
  active_basket_count: number;
  mapped_basket_count: number;
  unmapped_basket_count: number;
}

export interface CompanyThemeStateReceipt {
  status: "fresh" | "stale" | "missing" | "invalid";
  as_of: string | null;
  sha256: string | null;
}

export interface CompanyThemeExposure {
  schema: typeof COMPANY_THEME_EXPOSURE_SCHEMA;
  authority: "context_only";
  is_context_only: true;
  generated_at: string;
  generation_id: string;
  status: CompanyThemeExposureWireStatus;
  company: { ticker: string };
  company_intelligence: {
    generation_id: string;
    context_sha256: string;
    latest_event_id: string | null;
    latest_event_call_date: string | null;
  };
  exposures: CompanyThemeExposureItem[];
  coverage: CompanyThemeCoverage;
  theme_state: CompanyThemeStateReceipt;
  warnings: CompanyThemeExposureWarning[];
}

export interface CompanyThemeExposureManifest {
  schema: typeof COMPANY_THEME_EXPOSURE_MANIFEST_SCHEMA;
  generation_id: string;
  generated_at: string;
  company_count: number;
  exposure_count: number;
  coverage: {
    active_membership_count: number;
    mapped_membership_count: number;
    unmapped_membership_count: number;
    active_member_ticker_count: number;
    unmapped_only_ticker_count: number;
    active_member_tickers_without_company_context: number;
  };
  source: {
    company_intelligence: { generation_id: string; sha256: string };
    membership: { sha256: string };
    crosswalk: { sha256: string };
    theme_state: CompanyThemeStateReceipt;
    builder: "company_theme_exposure.v1";
  };
  files: Record<string, { sha256: string; bytes: number }>;
  status: "ready" | "partial" | "empty";
  warnings: CompanyThemeExposureWarning[];
}

export type CompanyThemeExposureErrorCode =
  | "invalid_symbol"
  | "not_found"
  | "unauthorized"
  | "upstream_unavailable"
  | "invalid_payload";

/** Consumer evaluation; never part of the immutable producer context or its hash. */
export interface CompanyThemeExposureFreshness {
  policy: "company_theme_exposure.v1/five_calendar_days";
  evaluated_at: string;
  status: CompanyThemeStateReceipt["status"] | "future";
  reason: "source_status" | "expired" | "future_clock" | null;
  source_as_of: string | null;
  age_days: number | null;
  expires_at: string | null;
}

export type CompanyThemeExposureResult =
  | { ok: true; state: CompanyThemeExposureState; context: CompanyThemeExposure; freshness: CompanyThemeExposureFreshness }
  | { ok: false; state: "error"; error: { code: CompanyThemeExposureErrorCode; message: string; retryable: boolean } };

export interface CompanyThemeExposureLineageExpectation {
  /** Current, independently verified Company Intelligence identity. */
  generation_id: string;
  latest_event_id: string | null;
}

type JsonObject = Record<string, unknown>;
type FetchedJson = { kind: "ok"; raw: unknown; bytes: Uint8Array } | { kind: "missing" } | { kind: "failure" };
type ManifestSnapshot = { manifest: CompanyThemeExposureManifest; at: number };
type ContextSnapshot = { context: CompanyThemeExposure; at: number };

const R2_HOST = "pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";
const SHA256 = /^[a-f0-9]{64}$/;
const GENERATION = /^[a-f0-9]{24,64}$/;
const THEME_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/;
const BASKET_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MANIFEST_FILES = 20_000;
const MANIFEST_TTL_MS = 30_000;
const CONTEXT_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 2_500;
const MAX_CONTEXT_CACHE_ENTRIES = 256;
const WARNING_CODES = new Set<CompanyThemeExposureWarning>([
  "theme_state_missing", "theme_state_invalid", "theme_state_stale", "theme_state_future",
  "active_membership_unmapped", "active_memberships_unmapped",
]);

let manifestCache: ManifestSnapshot | null = null;
const contextCache = new Map<string, ContextSnapshot>();
const lastGoodByTicker = new Map<string, ContextSnapshot>();

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function validGeneration(value: unknown): value is string {
  return typeof value === "string" && GENERATION.test(value) && !value.includes("..");
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && ISO_TIMESTAMP.test(value) && Number.isFinite(new Date(value).getTime());
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function string(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0") ? value : null;
}

function nonNegativeInt(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function normalizedWarnings(value: unknown, allowed: ReadonlySet<CompanyThemeExposureWarning>): CompanyThemeExposureWarning[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const out: CompanyThemeExposureWarning[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !allowed.has(entry as CompanyThemeExposureWarning)) return null;
    out.push(entry as CompanyThemeExposureWarning);
  }
  return [...out].sort().every((entry, index) => entry === out[index]) && new Set(out).size === out.length ? out : null;
}

function normalizeThemeState(raw: unknown): CompanyThemeStateReceipt | null {
  const value = object(raw);
  if (!value || !exactKeys(value, ["status", "as_of", "sha256"])) return null;
  if (value.status !== "fresh" && value.status !== "stale" && value.status !== "missing" && value.status !== "invalid") return null;
  if (value.status === "missing") return value.as_of === null && value.sha256 === null
    ? { status: "missing", as_of: null, sha256: null }
    : null;
  const stamp = value.as_of;
  const sha = value.sha256;
  if (!validSha(sha)) return null;
  if (value.status === "invalid") {
    if (stamp !== null && !validDate(stamp) && !validTimestamp(stamp)) return null;
    return { status: "invalid", as_of: stamp as string | null, sha256: sha };
  }
  if (!validDate(stamp)) return null;
  return { status: value.status, as_of: stamp, sha256: sha };
}

function normalizeCoverage(raw: unknown): CompanyThemeCoverage | null {
  const value = object(raw);
  if (!value || !exactKeys(value, ["status", "active_basket_count", "mapped_basket_count", "unmapped_basket_count"])) return null;
  const active = nonNegativeInt(value.active_basket_count, 64);
  const mapped = nonNegativeInt(value.mapped_basket_count, 64);
  const unmapped = nonNegativeInt(value.unmapped_basket_count, 64);
  if (active === null || mapped === null || unmapped === null || active !== mapped + unmapped) return null;
  const expected = active === 0 ? "no_active_membership" : mapped === active ? "mapped" : unmapped === active ? "unmapped_only" : "mixed";
  return value.status === expected ? {
    status: expected,
    active_basket_count: active,
    mapped_basket_count: mapped,
    unmapped_basket_count: unmapped,
  } : null;
}

function normalizeExposureItem(raw: unknown): CompanyThemeExposureItem | null {
  const value = object(raw);
  if (!value || !exactKeys(value, ["theme_id", "name_en", "name_zh", "basket_id", "mapping_qualifier"])) return null;
  const theme = value.theme_id;
  const basket = value.basket_id;
  const nameEn = string(value.name_en, 240);
  const nameZh = string(value.name_zh, 240);
  if (typeof theme !== "string" || !THEME_ID.test(theme) || typeof basket !== "string" || !BASKET_ID.test(basket)
    || !nameEn || !nameZh
    || (value.mapping_qualifier !== "direct" && value.mapping_qualifier !== "proxy" && value.mapping_qualifier !== "curated")) return null;
  return { theme_id: theme, name_en: nameEn, name_zh: nameZh, basket_id: basket, mapping_qualifier: value.mapping_qualifier };
}

/** Build an owned, exact context object. Never expose unknown producer fields. */
export function normalizeCompanyThemeExposure(raw: unknown, expectedTicker?: string, expectedGeneration?: string): CompanyThemeExposure | null {
  const value = object(raw);
  const expected = ["schema", "authority", "generated_at", "generation_id", "status", "company", "company_intelligence", "exposures", "coverage", "theme_state", "warnings"];
  // The producer does not emit `is_context_only`; the BFF deliberately adds
  // that consumer guard. Accept only that exact derived field on the return
  // trip from same-origin JSON, never arbitrary producer extras.
  const acceptsDerivedGuard = exactKeys(value ?? {}, [...expected, "is_context_only"]) && value?.is_context_only === true;
  if (!value || (!exactKeys(value, expected) && !acceptsDerivedGuard) || value.schema !== COMPANY_THEME_EXPOSURE_SCHEMA || value.authority !== "context_only"
    || !validTimestamp(value.generated_at) || !validGeneration(value.generation_id)
    || (value.status !== "ready" && value.status !== "partial")) return null;
  if (expectedGeneration && value.generation_id !== expectedGeneration) return null;
  const company = object(value.company);
  if (!company || !exactKeys(company, ["ticker"]) || typeof company.ticker !== "string") return null;
  const ticker = normalizeCompanyIntelligenceSymbol(company.ticker);
  if (!ticker || ticker !== company.ticker || (expectedTicker && ticker !== expectedTicker)) return null;
  const intelligence = object(value.company_intelligence);
  if (!intelligence || !exactKeys(intelligence, ["generation_id", "context_sha256", "latest_event_id", "latest_event_call_date"])
    || !validGeneration(intelligence.generation_id) || !validSha(intelligence.context_sha256)) return null;
  const latestEventId = intelligence.latest_event_id;
  const latestEventDate = intelligence.latest_event_call_date;
  if ((latestEventId === null) !== (latestEventDate === null)
    // Company Intelligence's event identity is a calendar call date today. A
    // future producer may retain a full timestamp, so accept either exact
    // calendar form while still rejecting arbitrary display strings.
    || (latestEventId !== null && (!string(latestEventId, 128) || (!validDate(latestEventDate) && !validTimestamp(latestEventDate))))) return null;
  if (!Array.isArray(value.exposures) || value.exposures.length > 64) return null;
  const exposures: CompanyThemeExposureItem[] = [];
  for (const rawExposure of value.exposures) {
    const item = normalizeExposureItem(rawExposure);
    if (!item) return null;
    exposures.push(item);
  }
  const identities = exposures.map((item) => `${item.theme_id}\u0000${item.basket_id}`);
  if (new Set(identities).size !== identities.length || identities.some((entry, index) => index > 0 && entry <= identities[index - 1])) return null;
  const coverage = normalizeCoverage(value.coverage);
  const themeState = normalizeThemeState(value.theme_state);
  const warnings = normalizedWarnings(value.warnings, WARNING_CODES);
  if (!coverage || !themeState || !warnings || exposures.length !== coverage.mapped_basket_count) return null;
  const expectedWarnings: CompanyThemeExposureWarning[] = [];
  if (themeState.status === "missing") expectedWarnings.push("theme_state_missing");
  if (themeState.status === "invalid") expectedWarnings.push("theme_state_invalid");
  if (themeState.status === "stale") expectedWarnings.push("theme_state_stale");
  if (coverage.unmapped_basket_count) expectedWarnings.push("active_membership_unmapped");
  if (warnings.join("|") !== expectedWarnings.sort().join("|") || (value.status === "ready") !== (warnings.length === 0)) return null;
  return {
    schema: COMPANY_THEME_EXPOSURE_SCHEMA,
    authority: "context_only",
    is_context_only: true,
    generated_at: value.generated_at,
    generation_id: value.generation_id,
    status: value.status,
    company: { ticker },
    company_intelligence: {
      generation_id: intelligence.generation_id,
      context_sha256: intelligence.context_sha256,
      latest_event_id: latestEventId as string | null,
      latest_event_call_date: latestEventDate as string | null,
    },
    exposures,
    coverage,
    theme_state: themeState,
    warnings,
  };
}

/** Normalize the marker or immutable manifest before it can steer a fetch path. */
export function normalizeCompanyThemeExposureManifest(raw: unknown): CompanyThemeExposureManifest | null {
  const value = object(raw);
  const expected = ["schema", "generation_id", "generated_at", "company_count", "exposure_count", "coverage", "source", "files", "status", "warnings"];
  if (!value || !exactKeys(value, expected) || value.schema !== COMPANY_THEME_EXPOSURE_MANIFEST_SCHEMA
    || !validGeneration(value.generation_id) || !validTimestamp(value.generated_at)
    || (value.status !== "ready" && value.status !== "partial" && value.status !== "empty")) return null;
  const companyCount = nonNegativeInt(value.company_count, MAX_MANIFEST_FILES);
  const exposureCount = nonNegativeInt(value.exposure_count);
  const warnings = normalizedWarnings(value.warnings, WARNING_CODES);
  if (companyCount === null || exposureCount === null || !warnings || (value.status === "empty" && (companyCount !== 0 || exposureCount !== 0))
    || (value.status !== "empty" && companyCount === 0) || (value.status === "ready" && warnings.length > 0) || (value.status === "partial" && warnings.length === 0)) return null;
  const coverageRaw = object(value.coverage);
  const coverageKeys = ["active_membership_count", "mapped_membership_count", "unmapped_membership_count", "active_member_ticker_count", "unmapped_only_ticker_count", "active_member_tickers_without_company_context"];
  if (!coverageRaw || !exactKeys(coverageRaw, coverageKeys)) return null;
  const coverageValues = Object.fromEntries(coverageKeys.map((key) => [key, nonNegativeInt(coverageRaw[key])])) as Record<string, number | null>;
  if (Object.values(coverageValues).some((item) => item === null)
    || coverageValues.active_membership_count !== coverageValues.mapped_membership_count! + coverageValues.unmapped_membership_count!
    || coverageValues.unmapped_only_ticker_count! > coverageValues.active_member_ticker_count!
    || coverageValues.active_member_tickers_without_company_context! > coverageValues.active_member_ticker_count!) return null;
  const source = object(value.source);
  if (!source || !exactKeys(source, ["company_intelligence", "membership", "crosswalk", "theme_state", "builder"]) || source.builder !== "company_theme_exposure.v1") return null;
  const ci = object(source.company_intelligence);
  const membership = object(source.membership);
  const crosswalk = object(source.crosswalk);
  const themeState = normalizeThemeState(source.theme_state);
  if (!ci || !exactKeys(ci, ["generation_id", "sha256"]) || !validGeneration(ci.generation_id) || !validSha(ci.sha256)
    || !membership || !exactKeys(membership, ["sha256"]) || !validSha(membership.sha256)
    || !crosswalk || !exactKeys(crosswalk, ["sha256"]) || !validSha(crosswalk.sha256) || !themeState) return null;
  const expectedWarnings: CompanyThemeExposureWarning[] = [];
  if (themeState.status === "missing") expectedWarnings.push("theme_state_missing");
  if (themeState.status === "invalid") expectedWarnings.push("theme_state_invalid");
  if (themeState.status === "stale") expectedWarnings.push("theme_state_stale");
  if (coverageValues.unmapped_membership_count) expectedWarnings.push("active_memberships_unmapped");
  if (warnings.join("|") !== expectedWarnings.sort().join("|")) return null;
  const filesRaw = object(value.files);
  if (!filesRaw || Object.keys(filesRaw).length !== companyCount) return null;
  const files: Record<string, { sha256: string; bytes: number }> = {};
  for (const [path, rawReceipt] of Object.entries(filesRaw)) {
    if (!/^companies\/[A-Z0-9](?:[A-Z0-9.-]{0,14}[A-Z0-9])?\.json$/.test(path)) return null;
    const ticker = normalizeCompanyIntelligenceSymbol(path.slice("companies/".length, -".json".length));
    const receipt = object(rawReceipt);
    const bytes = receipt ? nonNegativeInt(receipt.bytes) : null;
    if (!ticker || !receipt || !exactKeys(receipt, ["sha256", "bytes"]) || !validSha(receipt.sha256) || bytes === null || bytes < 1) return null;
    files[path] = { sha256: receipt.sha256, bytes };
  }
  return {
    schema: COMPANY_THEME_EXPOSURE_MANIFEST_SCHEMA,
    generation_id: value.generation_id,
    generated_at: value.generated_at,
    company_count: companyCount,
    exposure_count: exposureCount,
    coverage: coverageValues as CompanyThemeExposureManifest["coverage"],
    source: {
      company_intelligence: { generation_id: ci.generation_id, sha256: ci.sha256 },
      membership: { sha256: membership.sha256 },
      crosswalk: { sha256: crosswalk.sha256 },
      theme_state: themeState,
      builder: "company_theme_exposure.v1",
    },
    files,
    status: value.status,
    warnings,
  };
}

function error(code: CompanyThemeExposureErrorCode, message: string, retryable: boolean): CompanyThemeExposureResult {
  return { ok: false, state: "error", error: { code, message, retryable } };
}

/**
 * Mirrors Macro views.py's existing v1 predicate: calendar-date difference > 5.
 * as_of is a UTC calendar date, so expiration starts on day six at 00:00Z.
 * Fetch/cache timestamps and generated_at never renew the source receipt.
 */
export function evaluateCompanyThemeExposureFreshness(context: CompanyThemeExposure, now = Date.now()): CompanyThemeExposureFreshness {
  const receipt = context.theme_state;
  const out: CompanyThemeExposureFreshness = {
    policy: "company_theme_exposure.v1/five_calendar_days",
    evaluated_at: new Date(now).toISOString(),
    status: receipt.status,
    reason: receipt.status === "fresh" ? null : "source_status",
    source_as_of: receipt.as_of,
    age_days: null,
    expires_at: null,
  };
  // Unknown or invalid source clocks have no inferred age or expiration.
  if (receipt.status === "missing" || receipt.status === "invalid" || !validDate(receipt.as_of)) return out;
  const dayMs = 86_400_000;
  const sourceDay = Date.parse(`${receipt.as_of}T00:00:00.000Z`);
  const currentDay = Math.floor(now / dayMs) * dayMs;
  const age = (currentDay - sourceDay) / dayMs;
  if (age < 0) return { ...out, status: "future", reason: "future_clock" };
  out.age_days = age;
  out.expires_at = new Date(sourceDay + 6 * dayMs).toISOString();
  if (receipt.status === "fresh" && age > 5) {
    out.status = "stale";
    out.reason = "expired";
  }
  return out;
}

function ready(context: CompanyThemeExposure, state: CompanyThemeExposureState = context.status, now = Date.now()): CompanyThemeExposureResult {
  if (Date.parse(context.generated_at) > now) {
    return error("invalid_payload", "Company theme context has a future publication clock", true);
  }
  const freshness = evaluateCompanyThemeExposureFreshness(context, now);
  const effective = state === "stale" || freshness.status === "stale" ? "stale"
    : freshness.status === "fresh" ? state : "partial";
  return { ok: true, state: effective, context, freshness };
}

/** Re-evaluate an already verified result without mutating its source context. */
export function ageCompanyThemeExposureResult(result: CompanyThemeExposureResult, now = Date.now()): CompanyThemeExposureResult {
  return result.ok ? ready(result.context, result.state, now) : result;
}

function sameThemeState(left: CompanyThemeStateReceipt, right: CompanyThemeStateReceipt): boolean {
  return left.status === right.status && left.as_of === right.as_of && left.sha256 === right.sha256;
}

function matchesLineage(
  context: CompanyThemeExposure,
  manifest: CompanyThemeExposureManifest,
  expected?: CompanyThemeExposureLineageExpectation,
): boolean {
  return context.generation_id === manifest.generation_id
    && context.generated_at === manifest.generated_at
    && context.company_intelligence.generation_id === manifest.source.company_intelligence.generation_id
    && sameThemeState(context.theme_state, manifest.source.theme_state)
    && (!expected || (
      context.company_intelligence.generation_id === expected.generation_id
      && context.company_intelligence.latest_event_id === expected.latest_event_id
    ));
}

function validR2Base(base: string): string | null {
  try {
    const parsed = new URL(base);
    return parsed.protocol === "https:" && parsed.hostname === R2_HOST && !parsed.port && parsed.pathname === "/"
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      ? parsed.toString().replace(/\/$/, "")
      : null;
  } catch { return null; }
}

function pinnedFinalUrl(requestedUrl: string, finalUrl: string): boolean {
  // In-memory Response fixtures have an empty URL. Production fetch plus
  // redirect:error always gives a final URL, which must be byte-for-byte same path.
  if (!finalUrl) return true;
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    return final.protocol === "https:" && final.hostname === R2_HOST && !final.port && final.origin === requested.origin
      && final.pathname === requested.pathname && final.search === requested.search && !final.hash && !final.username && !final.password;
  } catch { return false; }
}

async function readBounded(response: Response, controller: AbortController): Promise<Uint8Array | null> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null) {
    const count = Number(advertised);
    if (!Number.isSafeInteger(count) || count < 0 || count > COMPANY_THEME_EXPOSURE_MAX_R2_JSON_BYTES) return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > COMPANY_THEME_EXPOSURE_MAX_R2_JSON_BYTES) {
        controller.abort();
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch { return null; } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<FetchedJson> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: controller.signal, headers: { accept: "application/json", "cache-control": "no-store" } });
    if (response.redirected || !pinnedFinalUrl(url, response.url)) return { kind: "failure" };
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "failure" };
    const bytes = await readBounded(response, controller);
    if (!bytes) return { kind: "failure" };
    try { return { kind: "ok", raw: JSON.parse(new TextDecoder().decode(bytes)), bytes }; } catch { return { kind: "failure" }; }
  } catch { return { kind: "failure" }; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}

/** Mirrors the producer's sorted, no-whitespace canonical JSON identity. */
function canonicalJson(value: unknown): string | null {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : null;
  if (Array.isArray(value)) {
    const entries = value.map(canonicalJson);
    return entries.some((entry) => entry === null) ? null : `[${entries.join(",")}]`;
  }
  const record = object(value);
  if (!record) return null;
  const entries: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const serialized = canonicalJson(record[key]);
    if (serialized === null) return null;
    entries.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${entries.join(",")}}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(source).set(bytes);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function remember(key: string, ticker: string, context: CompanyThemeExposure, at: number): void {
  if (!contextCache.has(key) && contextCache.size >= MAX_CONTEXT_CACHE_ENTRIES) {
    const oldest = contextCache.keys().next().value as string | undefined;
    if (oldest) contextCache.delete(oldest);
  }
  contextCache.set(key, { context, at });
  if (!lastGoodByTicker.has(ticker) && lastGoodByTicker.size >= MAX_CONTEXT_CACHE_ENTRIES) {
    const oldest = lastGoodByTicker.keys().next().value as string | undefined;
    if (oldest) lastGoodByTicker.delete(oldest);
  }
  lastGoodByTicker.set(ticker, { context, at });
}

async function loadVerifiedManifest(base: string, signal?: AbortSignal): Promise<{ manifest: CompanyThemeExposureManifest; stale: boolean } | "invalid" | null> {
  const now = Date.now();
  if (manifestCache && now - manifestCache.at < MANIFEST_TTL_MS) return { manifest: manifestCache.manifest, stale: false };
  const marker = await fetchJson(`${base}/company_theme_exposure/manifest.json`, signal);
  if (marker.kind !== "ok") return manifestCache ? { manifest: manifestCache.manifest, stale: true } : null;
  const markerManifest = normalizeCompanyThemeExposureManifest(marker.raw);
  if (!markerManifest) return manifestCache ? { manifest: manifestCache.manifest, stale: true } : "invalid";
  const immutable = await fetchJson(`${base}/company_theme_exposure/generations/${markerManifest.generation_id}/manifest.json`, signal);
  if (immutable.kind !== "ok") return manifestCache ? { manifest: manifestCache.manifest, stale: true } : immutable.kind === "missing" ? "invalid" : null;
  const immutableManifest = normalizeCompanyThemeExposureManifest(immutable.raw);
  const markerCanonical = canonicalJson(marker.raw);
  const immutableCanonical = canonicalJson(immutable.raw);
  if (!immutableManifest || !markerCanonical || !immutableCanonical || markerCanonical !== immutableCanonical
    || immutableManifest.generation_id !== markerManifest.generation_id) return manifestCache ? { manifest: manifestCache.manifest, stale: true } : "invalid";
  manifestCache = { manifest: markerManifest, at: now };
  return { manifest: markerManifest, stale: false };
}

/** Server-only resolver. `base` is always re-validated so test injection cannot widen the read boundary. */
export async function resolveCompanyThemeExposureFromR2(
  symbol: string,
  base: string,
  options: { signal?: AbortSignal; expectedCompanyIntelligence?: CompanyThemeExposureLineageExpectation } = {},
): Promise<CompanyThemeExposureResult> {
  const ticker = normalizeCompanyIntelligenceSymbol(symbol);
  if (!ticker) return error("invalid_symbol", "Invalid ticker", false);
  const expected = options.expectedCompanyIntelligence;
  if (expected && (!validGeneration(expected.generation_id)
    || (expected.latest_event_id !== null && !string(expected.latest_event_id, 128)))) {
    return error("invalid_payload", "Current Company Intelligence identity is invalid", true);
  }
  const safeBase = validR2Base(base);
  if (!safeBase) return error("upstream_unavailable", "Company theme context is unavailable", true);
  const manifestRead = await loadVerifiedManifest(safeBase, options.signal);
  if (manifestRead === "invalid") return error("invalid_payload", "Company theme context publication is invalid", true);
  if (!manifestRead) return error("upstream_unavailable", "Company theme context is unavailable", true);
  const { manifest, stale } = manifestRead;
  if (expected && manifest.source.company_intelligence.generation_id !== expected.generation_id) {
    return error("invalid_payload", "Company theme context is not aligned with current Company Intelligence", true);
  }
  const receipt = manifest.files[`companies/${ticker}.json`];
  const cached = contextCache.get(`${manifest.generation_id}:${ticker}`);
  const lastGood = lastGoodByTicker.get(ticker);
  const cachedContext = cached && matchesLineage(cached.context, manifest, expected) ? cached.context : null;
  const lastGoodContext = lastGood && matchesLineage(lastGood.context, manifest, expected) ? lastGood.context : null;
  if (stale) return cachedContext ? ready(cachedContext, "stale") : lastGoodContext ? ready(lastGoodContext, "stale")
    : error("upstream_unavailable", "Company theme context is temporarily unavailable", true);
  if (!receipt) return error("not_found", "Company theme context is not covered", false);
  const now = Date.now();
  if (cachedContext && cached && now - cached.at < CONTEXT_TTL_MS) return ready(cachedContext);
  const url = `${safeBase}/company_theme_exposure/generations/${manifest.generation_id}/companies/${ticker}.json`;
  const fetched = await fetchJson(url, options.signal);
  if (fetched.kind === "missing") return lastGoodContext ? ready(lastGoodContext, "stale")
    : error("invalid_payload", "Company theme context publication is incomplete", true);
  if (fetched.kind !== "ok") return cachedContext ? ready(cachedContext, "stale") : lastGoodContext ? ready(lastGoodContext, "stale")
    : error("upstream_unavailable", "Company theme context is temporarily unavailable", true);
  const hash = await sha256Hex(fetched.bytes);
  if (fetched.bytes.byteLength !== receipt.bytes || hash !== receipt.sha256) return cachedContext ? ready(cachedContext, "stale") : lastGoodContext ? ready(lastGoodContext, "stale")
    : error("invalid_payload", "Company theme context failed its manifest receipt", true);
  const context = normalizeCompanyThemeExposure(fetched.raw, ticker, manifest.generation_id);
  if (!context || !matchesLineage(context, manifest, expected)) return cachedContext ? ready(cachedContext, "stale") : lastGoodContext ? ready(lastGoodContext, "stale")
    : error("invalid_payload", "Company theme context payload is invalid", true);
  const result = ready(context);
  if (result.ok) remember(`${manifest.generation_id}:${ticker}`, ticker, context, now);
  return result;
}

/** Client-side same-origin call; public R2 never enters a client bundle. */
export async function getCompanyThemeExposure(symbol: string, options: { signal?: AbortSignal; retryNonce?: number } = {}): Promise<CompanyThemeExposureResult> {
  const ticker = normalizeCompanyIntelligenceSymbol(symbol);
  if (!ticker) return error("invalid_symbol", "Invalid ticker", false);
  const suffix = options.retryNonce === undefined ? "" : `?retry=${encodeURIComponent(String(options.retryNonce))}`;
  try {
    const response = await fetch(`/api/company-theme-context/${encodeURIComponent(ticker)}${suffix}`, {
      cache: "no-store", signal: options.signal, headers: { accept: "application/json", "cache-control": "no-store" },
    });
    let raw: unknown;
    try { raw = await response.json(); } catch { return error("upstream_unavailable", "Company theme context returned malformed JSON", true); }
    const payload = object(raw);
    if (!payload) return error("upstream_unavailable", "Company theme context returned malformed JSON", true);
    if (payload.ok === false && payload.state === "error") {
      const issue = object(payload.error);
      const code = issue?.code;
      const message = string(issue?.message, 300);
      if ((code === "invalid_symbol" || code === "not_found" || code === "unauthorized" || code === "upstream_unavailable" || code === "invalid_payload")
        && message && typeof issue?.retryable === "boolean") return error(code, message, issue.retryable);
    }
    if (payload.ok === true && (payload.state === "ready" || payload.state === "partial" || payload.state === "stale" || payload.state === "not_covered")) {
      const context = normalizeCompanyThemeExposure(payload.context, ticker);
      if (context) {
        // The BFF may derive partial for an unusable source clock while the
        // immutable publication still says ready. Admit that override only
        // when our own source-clock evaluation independently derives partial.
        const derived = ready(context);
        if (payload.state === "stale" || context.status === payload.state
          || (payload.state === "partial" && derived.ok && derived.state === "partial")) {
          return ready(context, payload.state);
        }
      }
    }
    return error(response.status === 404 ? "not_found" : "upstream_unavailable", "Company theme context returned an invalid response", response.status !== 404);
  } catch { return error("upstream_unavailable", "Company theme context could not be reached", true); }
}

export function __resetCompanyThemeExposureCacheForTests(): void {
  manifestCache = null;
  contextCache.clear();
  lastGoodByTicker.clear();
}

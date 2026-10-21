/**
 * Read-only adapter for the immutable Company historical context reference.
 *
 * A page URL may carry a retained pin (`ci_event`, `ci_generation`,
 * `ci_company`, `ci_fingerprint`) pointing at one immutable historical event
 * workspace revision. Loading replays that exact pin against the existing
 * authenticated `/api/investigations/baseline` GET endpoint and never falls
 * back to the current/latest view. This module owns no store, no endpoint and
 * no policy: identity validation reuses the event-workspace owner validators,
 * and availability/rights are decided only by the same-origin server response
 * on a per-request basis.
 */

import {
  isEventWorkspaceEventId,
  isEventWorkspaceGenerationId,
  normalizeCompanyIntelligenceSymbol,
  normalizeEventWorkspace,
  type EventWorkspace,
  type RetainedEventWorkspacePin,
  type RetainedEventWorkspaceReceipt,
} from '@/lib/eventWorkspace';

/** Pin bound to exactly one immutable historical workspace revision. */
export type CompanyRetainedPin = Required<RetainedEventWorkspacePin>;

type CompanyRetainedContextFailure = {
  ok: false;
  code: 'HISTORICAL_UNAVAILABLE';
  reason: string;
};

type CompanyRetainedContextParseResult =
  | { ok: true; pin: CompanyRetainedPin | null }
  | CompanyRetainedContextFailure;

type CompanyRetainedContextLoadResult =
  | { ok: true; workspace: EventWorkspace; receipt: RetainedEventWorkspaceReceipt }
  | CompanyRetainedContextFailure;

const BASELINE_ENDPOINT = '/api/investigations/baseline';

const CI_EVENT_KEY = 'ci_event';
const CI_GENERATION_KEY = 'ci_generation';
const CI_COMPANY_KEY = 'ci_company';
const CI_FINGERPRINT_KEY = 'ci_fingerprint';

// Only these four owned keys are read; every unrelated query field
// (page, ci_lens, ...) is ignored.
const OWNED_PIN_KEYS = [
  CI_EVENT_KEY,
  CI_GENERATION_KEY,
  CI_COMPANY_KEY,
  CI_FINGERPRINT_KEY,
] as const;

const COMPANY_ID_PATTERN = /^cik:[0-9]{10}$/;
const HASH_64_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const REASON_PATTERN = /^[\w.: -]+$/;
const REASON_MAX_LENGTH = 64;

const RECEIPT_SCHEMA = 'earnings.retained_baseline.v1';
const RECEIPT_OWNER = 'earnings.workspace_generation';
const WORKSPACE_SCHEMA = 'event_workspace.v1';
const CONTEXT_AUTHORITY = 'context_only';

function unavailable(reason: string): CompanyRetainedContextFailure {
  return { ok: false, code: 'HISTORICAL_UNAVAILABLE', reason };
}

function invalidReference(detail: string): CompanyRetainedContextFailure {
  return unavailable(`invalid_reference:${detail}`);
}

function normalizeFailureReason(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > REASON_MAX_LENGTH) return fallback;
  return REASON_PATTERN.test(trimmed) ? trimmed : fallback;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

/**
 * Parse the retained Company context pin out of page query parameters.
 *
 * Only the four owned `ci_*` keys are considered; any other field is ignored.
 * No owned key at all yields a null pin (current view). A duplicate owned
 * key, an incomplete tuple, a malformed event/generation/company/fingerprint
 * value, or a `symbol` that is not already the canonical form is rejected as
 * an invalid reference.
 */
export function parseCompanyRetainedContext(
  params: URLSearchParams,
  symbol: string,
): CompanyRetainedContextParseResult {
  if (normalizeCompanyIntelligenceSymbol(symbol) !== symbol) return invalidReference('symbol_not_canonical');
  const entries = OWNED_PIN_KEYS.map((key) => ({ key, values: params.getAll(key) }));

  if (entries.every((entry) => entry.values.length === 0)) {
    return { ok: true, pin: null };
  }

  for (const entry of entries) {
    if (entry.values.length > 1) {
      return invalidReference(`duplicate_${entry.key}`);
    }
  }

  const missing = entries.find((entry) => entry.values.length === 0);
  if (missing) {
    return invalidReference(`missing_${missing.key}`);
  }

  const [eventId, generationId, companyId, fingerprint] = entries.map(
    (entry) => entry.values[0] ?? '',
  );

  if (!isEventWorkspaceEventId(eventId)) {
    return invalidReference('malformed_ci_event');
  }
  if (!isEventWorkspaceGenerationId(generationId)) {
    return invalidReference('malformed_ci_generation');
  }
  if (!COMPANY_ID_PATTERN.test(companyId)) {
    return invalidReference('malformed_ci_company');
  }
  if (!HASH_64_PATTERN.test(fingerprint)) {
    return invalidReference('malformed_ci_fingerprint');
  }
  // The caller owns symbol identity: the page symbol must already be the
  // canonical form so a pin can never be re-normalized onto another company.
  if (normalizeCompanyIntelligenceSymbol(symbol) !== symbol) {
    return invalidReference('symbol_not_canonical');
  }

  const pin: CompanyRetainedPin = {
    event_id: eventId,
    generation_id: generationId,
    company_id: companyId,
    fingerprint,
  };
  return { ok: true, pin };
}

function pinToSearchParams(pin: CompanyRetainedPin): URLSearchParams {
  const params = new URLSearchParams();
  params.set(CI_EVENT_KEY, pin.event_id);
  params.set(CI_GENERATION_KEY, pin.generation_id);
  params.set(CI_COMPANY_KEY, pin.company_id);
  params.set(CI_FINGERPRINT_KEY, pin.fingerprint);
  return params;
}

/**
 * Validate the retained baseline receipt emitted by the same-origin endpoint.
 * Every identity field, hash, byte count, schema, authority and the rights
 * block are checked; the rights decision itself is enforced by callers so a
 * denied receipt stays distinguishable from a malformed one.
 */
function validateRetainedReceipt(value: unknown): RetainedEventWorkspaceReceipt | null {
  if (!isPlainObject(value)) return null;
  if (value.schema !== RECEIPT_SCHEMA) return null;
  if (value.owner !== RECEIPT_OWNER) return null;
  if (value.authority !== CONTEXT_AUTHORITY) return null;
  if (value.workspace_schema !== WORKSPACE_SCHEMA) return null;
  if (!['event_workspace_manifest.v1', 'event_workspace_manifest.v2', 'event_workspace_manifest.v3'].includes(value.manifest_schema as string)) return null;
  if (typeof value.company_id !== 'string' || !COMPANY_ID_PATTERN.test(value.company_id)) {
    return null;
  }
  if (typeof value.event_id !== 'string' || !isEventWorkspaceEventId(value.event_id)) return null;
  if (
    typeof value.generation_id !== 'string' ||
    !isEventWorkspaceGenerationId(value.generation_id)
  ) {
    return null;
  }
  if (typeof value.manifest_sha256 !== 'string' || !HASH_64_PATTERN.test(value.manifest_sha256)) {
    return null;
  }
  if (!isPositiveCount(value.manifest_bytes)) return null;
  if (typeof value.workspace_sha256 !== 'string' || !HASH_64_PATTERN.test(value.workspace_sha256)) {
    return null;
  }
  if (!isPositiveCount(value.workspace_bytes)) return null;
  if (typeof value.fingerprint !== 'string' || !HASH_64_PATTERN.test(value.fingerprint)) {
    return null;
  }
  if (!isNullableIsoTimestamp(value.public_known_at)) return null;
  if (!isNullableIsoTimestamp(value.platform_known_at)) return null;
  if (!isIsoTimestamp(value.generation_emitted_at)) return null;
  const rights = value.rights;
  if (!isPlainObject(rights)) return null;
  if (typeof rights.allowed !== 'boolean') return null;
  if (!isNonEmptyString(rights.policy_version)) return null;
  if (!isIsoTimestamp(rights.checked_at)) return null;
  return value as unknown as RetainedEventWorkspaceReceipt;
}

/**
 * Emit the shareable page parameters for a successful retained receipt. The
 * receipt is validated in full first so a malformed or denied receipt can
 * never be turned into a manufactured historical pin.
 */
export function companyRetainedContextParams(
  receipt: RetainedEventWorkspaceReceipt,
): URLSearchParams {
  const validated = validateRetainedReceipt(receipt);
  if (!validated) {
    throw new TypeError('companyRetainedContextParams requires a complete retained baseline receipt');
  }
  if (!validated.rights.allowed) {
    throw new TypeError('companyRetainedContextParams requires a receipt with allowed retained rights');
  }
  const params = new URLSearchParams();
  params.set(CI_EVENT_KEY, validated.event_id);
  params.set(CI_GENERATION_KEY, validated.generation_id);
  params.set(CI_COMPANY_KEY, validated.company_id);
  params.set(CI_FINGERPRINT_KEY, validated.fingerprint);
  return params;
}

/**
 * Load the Company historical context for a symbol.
 *
 * Without a pin this performs the current baseline query (`?symbol=...`).
 * With a pin the pin is re-validated through the URL parser first and the
 * exact four identity keys are sent; any response other than the matching
 * retained workspace is an explicit `HISTORICAL_UNAVAILABLE` failure. There
 * is exactly one request and never a current/latest fallback.
 */
export async function loadCompanyRetainedContext({
  symbol,
  pin,
  signal,
  fetchImpl,
}: {
  symbol: string;
  pin?: CompanyRetainedPin | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CompanyRetainedContextLoadResult> {
  if (signal?.aborted) return unavailable('aborted');
  if (normalizeCompanyIntelligenceSymbol(symbol) !== symbol) return invalidReference('symbol_not_canonical');

  const endpointParams = new URLSearchParams();
  if (pin) {
    // Re-validate the caller-supplied pin so a partially built or malformed
    // pin can never reach the endpoint.
    const parsed = parseCompanyRetainedContext(pinToSearchParams(pin), symbol);
    if (!parsed.ok || !parsed.pin) {
      return unavailable(parsed.ok ? 'invalid_reference' : parsed.reason);
    }
    endpointParams.set('event_id', parsed.pin.event_id);
    endpointParams.set('generation_id', parsed.pin.generation_id);
    endpointParams.set('company_id', parsed.pin.company_id);
    endpointParams.set('fingerprint', parsed.pin.fingerprint);
  } else {
    endpointParams.set('symbol', symbol);
  }

  const doFetch =
    fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let response: Response;
  try {
    response = await doFetch(`${BASELINE_ENDPOINT}?${endpointParams.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (error) {
    return unavailable(isAbortError(error) ? 'aborted' : 'unreachable');
  }
  if (signal?.aborted) return unavailable('aborted');

  // An unauthenticated same-origin session is an explicit failure, never a
  // fallback to the current view.
  if (response.status === 401) return unavailable('unauthenticated');
  if (!response.ok) return unavailable(`http_${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return unavailable(isAbortError(error) ? 'aborted' : 'invalid_response');
  }
  if (signal?.aborted) return unavailable('aborted');

  if (!isPlainObject(payload)) return unavailable('invalid_response');

  // The server owns the historical decision: a structured unavailable answer
  // is surfaced as-is, with the reason restricted to a short known status.
  if (payload.ok === false) {
    return unavailable(normalizeFailureReason(payload.reason, 'unavailable'));
  }
  if (payload.ok !== true) return unavailable('invalid_response');

  const receipt = validateRetainedReceipt(payload.receipt);
  if (!receipt) return unavailable('malformed_receipt');
  // Per-request server-side rights decision only; persisted or cached rights
  // are never treated as permission here.
  if (!receipt.rights.allowed) return unavailable('rights_denied');

  if (pin) {
    if (receipt.event_id !== pin.event_id) return unavailable('event_mismatch');
    if (receipt.generation_id !== pin.generation_id) return unavailable('generation_mismatch');
    if (receipt.company_id !== pin.company_id) return unavailable('company_mismatch');
    if (receipt.fingerprint !== pin.fingerprint) return unavailable('fingerprint_mismatch');
  }

  const workspace = normalizeEventWorkspace(
    payload.workspace,
    receipt.event_id,
    receipt.generation_id,
  );
  if (!workspace) return unavailable('normalize');

  const workspaceIdentity = workspace as { event_id?: unknown; generation_id?: unknown };
  if (
    workspaceIdentity.event_id !== receipt.event_id ||
    workspaceIdentity.generation_id !== receipt.generation_id
  ) {
    return unavailable('workspace_mismatch');
  }

  const issuer = (workspace as { issuer?: unknown }).issuer;
  if (
    !isPlainObject(issuer) ||
    typeof issuer.company_id !== 'string' ||
    !Array.isArray(issuer.listings)
  ) {
    return unavailable('workspace_mismatch');
  }
  if (issuer.company_id !== receipt.company_id) {
    return unavailable('company_mismatch');
  }
  const hasRequestedListing = (issuer.listings as unknown[]).some(
    (listing) => isPlainObject(listing) && listing.ticker === symbol,
  );
  if (!hasRequestedListing) {
    return unavailable('symbol_mismatch');
  }

  return { ok: true, workspace, receipt };
}

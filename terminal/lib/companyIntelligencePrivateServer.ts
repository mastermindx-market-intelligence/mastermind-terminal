/**
 * Server half of the Company Intelligence private read.
 *
 * The order is fixed and fails closed: authenticate through the incumbent session
 * authority, read the actual entitlement row freshly from the billing authority, require
 * the exact company_intelligence_private_read feature, validate the request input, and
 * only then perform the one fixed owner GET. Nothing here accepts a caller-supplied
 * origin, upstream path, token, purpose, audience, Admission, CIK or as-of, and no
 * entitlement is cached across requests.
 *
 * gateway.forward() is deliberately not used: it pipes unbounded upstream detail
 * (including upstream error text) straight back to the browser. This module reads a
 * bounded byte stream instead, decodes it through the closed contract in
 * ./companyIntelligencePrivate, and re-serializes only that sanitized representation.
 * Neither the billing gateway nor entitlement.ts is modified.
 */

import 'server-only';

import { BILLING_BASE, billingAuth } from '@/app/api/billing/gateway';
import {
  PrivateDecodeError,
  decodePrivateError,
  decodePrivateIssuerSelections,
  decodePrivateProductIntegration,
  isCanonicalIssuerShape,
  isFactIdShape,
  privateErrorPayload,
  type PrivateErrorCode,
  type PrivateIssuerSelections,
  type PrivateProductIntegration,
} from './companyIntelligencePrivate';

/**
 * OWNER_PROJECTION_MAX_BYTES = 32 KiB is a consumer resource policy for the fixed owner
 * projection response. It is not the native 1 MiB source retrieval cap and it grants
 * nothing. Derivation from the closed field limits the decoder admits:
 *
 *   generation / identity-snapshot schema / subject / object identifiers: 256 ASCII each
 *   issuer id: 128 ASCII; evidenced CIK: exactly 10 digits
 *   each reference: fixed native schema name (about 52 ASCII) + 64-char SHA-256 +
 *     byte_length at most 16384 (5 digits) + 3 key names
 *   up to 16 entries: fact id 76 bytes (integration: + 64 lowercase hex) + two fixed
 *     native references + the closed kind/lifecycle keys: roughly 700 bytes each with
 *     key overhead, so about 11.2 KiB for a full selection
 *   fact product / platform: at most 256 UTF-8 bytes each, whose worst-case JSON
 *     escaping is 6 bytes per character, so at most 1.5 KiB each
 *
 * A compact serialization of the largest admitted projection therefore stays under
 * 16 KiB; 32 KiB leaves room for serializer spacing without widening what the contract
 * allows. The counted stream read below is the real enforcement.
 */
export const OWNER_PROJECTION_MAX_BYTES = 32 * 1024;

/** Separately, a consumer resource policy for the /api/me authority read. */
export const ENTITLEMENT_MAX_BYTES = 64 * 1024;

/** One finite budget per inbound call, covering both upstream fetches and both stream reads. */
export const PRIVATE_REQUEST_DEADLINE_MS = 10_000;

/** The exact feature the entitlement authority must carry. A tier label is not a feature. */
export const PRIVATE_ISSUER_FEATURE = 'company_intelligence_private_read';

/** Applied to every outcome, success or refusal. No upstream header is ever copied. */
export const PRIVATE_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization, Cookie',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, noarchive',
});

export type PrivateRequestTarget =
  | { readonly kind: 'issuer_selections'; readonly issuerId: string }
  | { readonly kind: 'product_integration'; readonly factId: string };

export async function handlePrivateIssuerRequest(request: Request, issuerId: string): Promise<Response> {
  return handlePrivateRequest(request, { kind: 'issuer_selections', issuerId });
}

export async function handlePrivateFactRequest(request: Request, factId: string): Promise<Response> {
  return handlePrivateRequest(request, { kind: 'product_integration', factId });
}

async function handlePrivateRequest(request: Request, target: PrivateRequestTarget): Promise<Response> {
  // BILLING_BASE is trusted server config, never the caller's Host, origin or URL.
  const origin = trustedBillingOrigin();
  if (origin === null) return privateRefusal('PRIVATE_SERVICE_UNAVAILABLE', 503);

  const controller = new AbortController();
  const callerSignal = request.signal;
  const abortForCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  let linked = false;
  try {
    callerSignal?.addEventListener('abort', abortForCaller, { once: true });
    linked = true;
  } catch {
    linked = false;
  }
  const timer = setTimeout(() => controller.abort(), PRIVATE_REQUEST_DEADLINE_MS);
  try {
    return await privateExchange(request, target, origin, controller);
  } catch {
    // Last resort: a bug must never surface raw detail, and must never widen the read.
    return privateRefusal('PRIVATE_SERVICE_UNAVAILABLE', 503);
  } finally {
    clearTimeout(timer);
    if (linked) {
      try {
        callerSignal?.removeEventListener('abort', abortForCaller);
      } catch {
        // The signal is already gone; nothing to detach.
      }
    }
  }
}

async function privateExchange(
  request: Request,
  target: PrivateRequestTarget,
  origin: string,
  controller: AbortController,
): Promise<Response> {
  let session: { token: string } | null;
  try {
    session = await withAbort(controller.signal, billingAuth);
  } catch {
    return privateRefusal('AUTHENTICATION_UNAVAILABLE', 502);
  }
  const token = session === null ? '' : session.token;
  // No authenticated session: refuse before any network call at all.
  if (token === '') return privateRefusal('AUTHENTICATION_REQUIRED', 401);

  const entitlement = await authorizedGet(origin + '/api/me', token, controller, ENTITLEMENT_MAX_BYTES);
  if (entitlement.kind === 'unavailable') return privateRefusal('AUTHENTICATION_UNAVAILABLE', 502);
  if (entitlement.status === 401) return privateRefusal('AUTHENTICATION_REQUIRED', 401);
  if (entitlement.status === 403) return privateRefusal('ENTITLEMENT_REQUIRED', 403);
  // An abnormal authority response is an unavailable authority read, distinct from a
  // denial: it must never be reported as a verified entitlement refusal.
  if (entitlement.status !== 200) return privateRefusal('AUTHENTICATION_UNAVAILABLE', 502);

  const decision = entitlementDecision(entitlement.payload);
  if (decision === 'unavailable') return privateRefusal('AUTHENTICATION_UNAVAILABLE', 502);
  if (decision === 'denied') return privateRefusal('ENTITLEMENT_REQUIRED', 403);

  // Path/query validation happens after the grant and before the owner fetch, so an
  // invalid caller input can never reach private storage.
  const invalid = refusalForInvalidInput(request, target);
  if (invalid !== null) return invalid;

  const path = target.kind === 'issuer_selections'
    ? issuerSelectionsPath(target.issuerId)
    : productIntegrationPath(target.factId);
  const owner = await authorizedGet(origin + path, token, controller, OWNER_PROJECTION_MAX_BYTES);
  if (owner.kind === 'unavailable') return privateRefusal('PRIVATE_SERVICE_UNAVAILABLE', 503);
  if (owner.status !== 200) {
    try {
      return privateJson(decodePrivateError(owner.payload, owner.status), owner.status);
    } catch (error) {
      if (!(error instanceof PrivateDecodeError)) throw error;
      return privateRefusal('PRIVATE_SERVICE_UNAVAILABLE', 503);
    }
  }
  try {
    const projection: PrivateIssuerSelections | PrivateProductIntegration = target.kind === 'issuer_selections'
      ? decodePrivateIssuerSelections(owner.payload, target.issuerId)
      : decodePrivateProductIntegration(owner.payload, target.factId);
    // The decoded closed representation is re-serialized: arbitrary upstream JSON can
    // never be piped through, and only granted fields survive.
    return privateJson(projection, 200);
  } catch (error) {
    if (!(error instanceof PrivateDecodeError)) throw error;
    return privateRefusal('PRIVATE_SERVICE_UNAVAILABLE', 503);
  }
}

function refusalForInvalidInput(request: Request, target: PrivateRequestTarget): Response | null {
  // This slice is current-only, so it carries no query controls at all: every parameter
  // is refused, including mode and as_of, rather than silently ignored. The request URL
  // is read for its parameter count only; it can never choose an upstream origin, path
  // or token.
  let query: string;
  try {
    query = new URL(request.url).searchParams.toString();
  } catch {
    return privateRefusal('REQUEST_INVALID', 400);
  }
  if (query !== '') return privateRefusal('REQUEST_INVALID', 400);
  if (hasRequestBody(request)) return privateRefusal('REQUEST_INVALID', 400);
  if (target.kind === 'issuer_selections') {
    // Canonical issuer shape only. The owner endpoint stays the authority for semantic
    // issuer binding; a well-formed id is not a binding assertion.
    if (!isCanonicalIssuerShape(target.issuerId)) return privateRefusal('REQUEST_INVALID', 400);
    return null;
  }
  if (!isFactIdShape(target.factId)) return privateRefusal('REQUEST_INVALID', 400);
  return null;
}

function hasRequestBody(request: Request): boolean {
  if (request.body !== null && request.body !== undefined) return true;
  const length = request.headers.get('content-length');
  if (length !== null && length !== '0') return true;
  return request.headers.get('transfer-encoding') !== null;
}

/**
 * Mirrors the source predicate exactly: a non-empty, non-free tier string, an
 * active/trialing status, a genuine list of strings, and the exact feature as issued.
 * Unknown extra /api/me fields are permitted. No tier label, no other feature, no dev
 * fixture and no options cache can substitute for that membership test.
 *
 * A row that omits or mistypes the documented shape is an unreadable authority read
 * (unavailable), never a silently verified denial.
 */
function entitlementDecision(row: unknown): 'granted' | 'denied' | 'unavailable' {
  if (!isRecord(row)) return 'unavailable';
  const tier = row.tier;
  const status = row.status;
  const features = row.features;
  if (typeof tier !== 'string' || typeof status !== 'string' || !Array.isArray(features)) return 'unavailable';
  for (const feature of features) {
    if (typeof feature !== 'string') return 'unavailable';
  }
  const normalizedTier = tier.trim().toLowerCase();
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedTier === '' || normalizedTier === 'free') return 'denied';
  if (normalizedStatus !== 'active' && normalizedStatus !== 'trialing') return 'denied';
  return features.includes(PRIVATE_ISSUER_FEATURE) ? 'granted' : 'denied';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trustedBillingOrigin(): string | null {
  try {
    const parsed = new URL(BILLING_BASE);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username !== '' || parsed.password !== '') return null;
    if (parsed.search !== '' || parsed.hash !== '') return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    if (parsed.hostname === '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Two fixed owner path templates; only the validated id varies, in one encoded segment. */
function issuerSelectionsPath(issuerId: string): string {
  return '/api/company-intelligence/private/issuers/' + encodeURIComponent(issuerId) + '/product-integrations';
}

function productIntegrationPath(factId: string): string {
  return '/api/company-intelligence/private/product-integrations/' + encodeURIComponent(factId);
}

type UpstreamOutcome =
  | { readonly kind: 'http'; readonly status: number; readonly payload: unknown }
  | { readonly kind: 'unavailable' };

async function authorizedGet(
  url: string,
  token: string,
  controller: AbortController,
  maxBytes: number,
): Promise<UpstreamOutcome> {
  let response: Response;
  try {
    response = await withAbort(controller.signal, () => fetch(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
    }));
  } catch {
    return { kind: 'unavailable' };
  }
  if (response.redirected === true || (response.status >= 300 && response.status < 400) || !declaresJson(response)) {
    if (response.body) abortAndCancel(response.body, controller);
    return { kind: 'unavailable' };
  }
  const bytes = await readBoundedBytes(response, maxBytes, controller);
  if (bytes === null) return { kind: 'unavailable' };
  const text = decodeUtf8(bytes);
  if (text === null) return { kind: 'unavailable' };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { kind: 'unavailable' };
  }
  if (!isRecord(payload)) return { kind: 'unavailable' };
  return { kind: 'http', status: response.status, payload };
}

function declaresJson(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType?.split(';')[0].trim().toLowerCase() === 'application/json';
}

/** A finite read budget does not depend on an upstream promise honoring abort. */
async function withAbort<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error('private_read_aborted');
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('private_read_aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, work()]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Bounds the actual response stream in bytes before buffering. A declared
 * Content-Length is only a cheap early reject: it can be misreported, so every chunk is
 * counted and the stream is aborted and cancelled the moment the real total exceeds the
 * cap. There is no response.text()/json() fallback, and a missing stream is a failure.
 */
async function readBoundedBytes(response: Response, maxBytes: number, controller: AbortController): Promise<Uint8Array | null> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      if (response.body !== null) abortAndCancel(response.body, controller);
      return null;
    }
  }
  const stream = response.body;
  if (stream === null || stream === undefined) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await withAbort(controller.signal, () => reader.read());
      if (next.done === true) break;
      const chunk = next.value;
      size += chunk.byteLength;
      if (size > maxBytes) {
        abortAndCancel(reader, controller);
        return null;
      }
      chunks.push(chunk);
    }
  } catch {
    abortAndCancel(reader, controller);
    return null;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released by a cancellation.
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function abortAndCancel(
  target: { cancel(reason?: unknown): Promise<unknown> },
  controller: AbortController,
): void {
  controller.abort();
  try {
    // Cancellation is best effort: a non-cooperating producer cannot keep the
    // refused request open by leaving its cancellation promise unsettled.
    void target.cancel('company_intelligence_private_read_stopped').catch(() => {});
  } catch {
    // Already torn down; the cap was still enforced.
  }
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function privateJson(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: Object.assign({}, PRIVATE_RESPONSE_HEADERS, { 'Content-Type': 'application/json' }),
  });
}

function privateRefusal(code: PrivateErrorCode, status: number): Response {
  return privateJson(privateErrorPayload(code), status);
}

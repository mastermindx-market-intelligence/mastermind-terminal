/**
 * Authenticated GET-only BFF proxy for the reading/research gateway.
 *
 * Identity is established exclusively from the server-side Supabase session
 * (getUser, then getSession). Request-supplied Authorization/Cookie headers,
 * host and path are never read, trusted or forwarded. The upstream origin is
 * a fixed configured base; paths and query parameters come from the strict
 * allowlists below. Every response - success or failure - carries
 * private/no-store and no-index headers, and upstream Set-Cookie, Location,
 * CORS and cache headers are never forwarded.
 */
import 'server-only';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { isDocId, isSha256Hex, isUuid } from './readingContracts';

export type ReadingResource = 'catalog' | 'search' | 'read' | 'today';

const DEFAULT_BASE = 'https://www.mastermind-x.com';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNSIGNED_INT_RE = /^\d+$/;
const JSON_CONTENT_TYPE_RE = /^application\/(?:[\w.+-]+\+)?json(?:\s*;|\s*$)/i;

const TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_RETRY_AFTER_SECONDS = 86_400;

/** Fixed upstream route per resource; never derived from the request. */
const RESOURCE_PATH: Record<ReadingResource, string> = {
  catalog: '/api/research/catalog',
  search: '/api/research/search',
  read: '/api/research/read',
  today: '/api/macro/command',
};

/** Applied to every response, including every error path. */
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Cache-Control', 'private,no-store'],
  ['Vary', 'Cookie'],
  ['X-Robots-Tag', 'noindex,noarchive'],
  ['X-Content-Type-Options', 'nosniff'],
];

type AuthResult = { ok: true; token: string } | { ok: false; status: 401 | 503 };

type UpstreamResult = {
  status: number;
  body: unknown;
  retryAfterSeconds: number | null;
};

const ABORTED: unique symbol = Symbol('client-aborted');

function respond(
  status: number,
  body: unknown,
  extra?: ReadonlyArray<readonly [string, string]>,
): NextResponse {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const [name, value] of SECURITY_HEADERS) headers.set(name, value);
  if (extra) for (const [name, value] of extra) headers.set(name, value);
  return new NextResponse(JSON.stringify(body), { status, headers });
}

const badRequest = (): NextResponse => respond(400, { error: 'bad_request' });
const unauthorized = (): NextResponse => respond(401, { error: 'unauthorized' });
const badGateway = (): NextResponse => respond(502, { error: 'bad_gateway' });
const serviceUnavailable = (): NextResponse => respond(503, { error: 'service_unavailable' });

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIntInRange(value: string, min: number, max: number): boolean {
  return UNSIGNED_INT_RE.test(value) && Number(value) >= min && Number(value) <= max;
}

const SEARCH_PARAMS: Readonly<Record<string, (value: string) => boolean>> = {
  q: (value) => value.length >= 1 && value.length <= 200,
  institution: (value) => value.length >= 1 && value.length <= 100,
  from: isValidIsoDate,
  to: isValidIsoDate,
  limit: (value) => isIntInRange(value, 1, 50),
};

const READ_PARAMS: Readonly<Record<string, (value: string) => boolean>> = {
  source_pdf_sha256: (value) => isSha256Hex(value),
  extracted_text_sha256: (value) => isSha256Hex(value),
  segment_start: (value) => UNSIGNED_INT_RE.test(value) && Number.isSafeInteger(Number(value)),
  max_segments: (value) => isIntInRange(value, 1, 4),
};

/** Allowlist-only query validation; null for anything unknown, duplicated or malformed. */
function validateQuery(resource: ReadingResource, incoming: URLSearchParams): URLSearchParams | null {
  if (resource === 'catalog' || resource === 'today') {
    return incoming.keys().next().done ? new URLSearchParams() : null;
  }
  const allowed = resource === 'search' ? SEARCH_PARAMS : READ_PARAMS;
  const validated = new URLSearchParams();
  for (const key of [...incoming.keys()]) {
    const values = incoming.getAll(key);
    const check = allowed[key];
    if (values.length !== 1 || check === undefined || !check(values[0])) return null;
    validated.set(key, values[0]);
  }
  if (resource === 'read') {
    const hasPdfPin = validated.has('source_pdf_sha256');
    const hasTextPin = validated.has('extracted_text_sha256');
    if (hasPdfPin !== hasTextPin) return null; // continuation pins travel as a pair or not at all
    const start = validated.get('segment_start');
    if (start !== null && Number(start) > 0 && !(hasPdfPin && hasTextPin)) return null;
  }
  return validated;
}

/** Fixed configured origin only. Plain HTTP is accepted solely for loopback dev/test bases. */
function resolveGatewayBase(): string | null {
  const raw = process.env.BRAIN_GATEWAY_URL || DEFAULT_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) return null;
  if (url.username || url.password) return null;
  if (url.pathname !== '' && url.pathname !== '/') return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

/** Reads identity only from the server-side Supabase session; never from the request. */
async function authenticate(): Promise<AuthResult> {
  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch {
    return { ok: false, status: 503 };
  }
  try {
    const { data, error } = await client.auth.getUser();
    if (error) return { ok: false, status: error.name === 'AuthSessionMissingError' || [401,403].includes(error.status ?? 0) ? 401 : 503 };
    const userId = data?.user?.id ?? '';
    if (!isUuid(userId)) return { ok: false, status: 401 };
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) return { ok: false, status: 503 };
    const session = sessionData?.session;
    if (!session || session.user?.id !== userId || !session.access_token) {
      return { ok: false, status: 401 };
    }
    return { ok: true, token: session.access_token };
  } catch {
    return { ok: false, status: 503 };
  }
}

async function readUpstream(
  req: Request,
  target: string,
  token: string,
): Promise<UpstreamResult | null | typeof ABORTED> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onClientAbort = () => controller.abort();
  req.signal.addEventListener('abort', onClientAbort);
  if (req.signal.aborted) controller.abort(); // request already cancelled before dispatch
  try {
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      // Timeout, refused redirect or connection failure; a client abort is rethrown by the caller.
      return req.signal.aborted ? ABORTED : null;
    }
    if (upstream.redirected || upstream.status >= 300 && upstream.status < 400) return null; // never pass redirects through
    if (!JSON_CONTENT_TYPE_RE.test(upstream.headers.get('content-type') ?? '')) return null;
    const declaredLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
    if (!upstream.body) return null;
    const reader = upstream.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return null;
    }
    const rawRetryAfter = upstream.headers.get('retry-after');
    const retryAfterSeconds =
      rawRetryAfter !== null &&
      UNSIGNED_INT_RE.test(rawRetryAfter.trim()) &&
      Number(rawRetryAfter) <= MAX_RETRY_AFTER_SECONDS
        ? Number(rawRetryAfter)
        : null;
    return { status: upstream.status, body, retryAfterSeconds };
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', onClientAbort);
  }
}

/**
 * Proxies one authenticated GET to the fixed gateway route for `resource`.
 * `docId` is required only for 'read', must be a bare ASCII identifier, and is
 * appended to the fixed path - never parsed from the request URL.
 */
async function proxyReadingWithinBudget(
  req: Request,
  resource: ReadingResource,
  docId?: string,
): Promise<Response> {
  const auth = await authenticate();
  if (!auth.ok) return auth.status === 401 ? unauthorized() : serviceUnavailable();

  if (req.signal.aborted) return badGateway();
  const base = resolveGatewayBase();
  if (base === null) return badGateway();

  if (resource === 'read') {
    if (docId === undefined || !isDocId(docId)) return badRequest();
  } else if (docId !== undefined) {
    return badRequest();
  }

  let incoming: URLSearchParams;
  try {
    incoming = new URL(req.url).searchParams;
  } catch {
    return badRequest();
  }
  const query = validateQuery(resource, incoming);
  if (query === null) return badRequest();

  const path = resource === 'read' ? `${RESOURCE_PATH.read}/${docId}` : RESOURCE_PATH[resource];
  const search = query.toString();
  const target = `${base}${path}${search ? `?${search}` : ''}`;

  const outcome = await readUpstream(req, target, auth.token);
  if (outcome === ABORTED) {
    return badGateway();
  }
  if (outcome === null) return badGateway();

  const extra: ReadonlyArray<readonly [string, string]> | undefined =
    outcome.retryAfterSeconds === null ? undefined : [['Retry-After', String(outcome.retryAfterSeconds)]];
  return respond(outcome.status, outcome.body, extra);
}

/** The deadline includes server identity, response headers and the complete bounded body. */
export async function proxyReading(req: Request, resource: ReadingResource, docId?: string): Promise<Response> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const boundary = new Promise<never>((_resolve, reject) => {
    stop = () => { controller.abort(); reject(Error('read stopped')); };
    req.signal.addEventListener('abort', stop, { once: true });
    timer = setTimeout(stop, TIMEOUT_MS);
  });
  try {
    if (req.signal.aborted) return badGateway();
    return await Promise.race([boundary, proxyReadingWithinBudget(new Request(req, { signal: controller.signal }), resource, docId)]);
  } catch { return badGateway(); }
  finally { clearTimeout(timer); req.signal.removeEventListener('abort', stop); controller.abort(); }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api/billing/gateway', () => {
  return { BILLING_BASE: 'https://billing.example', billingAuth: vi.fn() };
});

import { billingAuth } from '@/app/api/billing/gateway';
import {
  PRIVATE_EDITION_SCHEMA,
  PRIVATE_ERROR_SCHEMA,
  PRIVATE_FACT_SCHEMA,
  PRIVATE_ISSUER_SELECTIONS_SCHEMA,
  PRIVATE_PRODUCT_INTEGRATION_SCHEMA,
} from '@/lib/companyIntelligencePrivate';
import {
  ENTITLEMENT_MAX_BYTES,
  OWNER_PROJECTION_MAX_BYTES,
  PRIVATE_REQUEST_DEADLINE_MS,
  PRIVATE_RESPONSE_HEADERS,
} from '@/lib/companyIntelligencePrivateServer';
import * as issuerRoute from '@/app/api/company-intelligence/private/issuers/[issuerId]/product-integrations/route';
import * as factRoute from '@/app/api/company-intelligence/private/product-integrations/[factId]/route';

const BASE = 'https://billing.example';
const ME_URL = BASE + '/api/me';
const SECRET = 'LEAKED_UPSTREAM_DETAIL';
const ISSUER = 'ISS:US-XNYS-MMC';
const FACT_ID = 'integration:' + 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const ISSUER_OWNER_URL = BASE + '/api/company-intelligence/private/issuers/' + encodeURIComponent(ISSUER) + '/product-integrations';
const FACT_OWNER_URL = BASE + '/api/company-intelligence/private/product-integrations/' + encodeURIComponent(FACT_ID);

const session = vi.mocked(billingAuth);
const encoder = new TextEncoder();

function issuerRequest(url = 'https://app.mastermind-x.com/api/company-intelligence/private/issuers/' + ISSUER + '/product-integrations') {
  return new Request(url);
}

function factRequest(url = 'https://evil-origin.example:9999/api/company-intelligence/private/product-integrations/' + FACT_ID) {
  return new Request(url);
}

function issuerGet(request: Request, issuerId = ISSUER): Promise<Response> {
  return issuerRoute.GET(request, { params: Promise.resolve({ issuerId }) });
}

function factGet(request: Request, factId = FACT_ID): Promise<Response> {
  return factRoute.GET(request, { params: Promise.resolve({ factId }) });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'content-type': 'application/json' }, headers),
  });
}

function grantedRow(features: string[] = [PRIVATE_KEY], tier = 'pro', status = 'active') {
  return { tier, features, status, current_period_end: '2026-11-01T00:00:00Z' };
}

const PRIVATE_KEY = 'company_intelligence_private_read';

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

function stubFetch(...responders: Responder[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    const responder = responders[Math.min(calls.length, responders.length) - 1];
    return responder(url, init ?? {});
  });
  vi.stubGlobal('fetch', impl);
  return { impl, calls };
}

function reference(schema: string, sha256: string, byteLength: number) {
  return { schema, sha256, byte_length: byteLength };
}

function selectionFixture() {
  return {
    schema: PRIVATE_ISSUER_SELECTIONS_SCHEMA,
    generation: 'gen-2026-10-11',
    identity_mode: 'current',
    issuer_role: 'subject_disclosing_company',
    issuer_binding: {
      issuer_id: ISSUER,
      evidenced_cik: '0000000001',
      identity_snapshot_reference: reference('dataos.issuer_identity_receipt/v2', HASH_C, 256),
    },
    selections: [],
  };
}

function factFixture() {
  return {
    schema: PRIVATE_PRODUCT_INTEGRATION_SCHEMA,
    fact: { fact_id: FACT_ID, kind: 'product_integration', lifecycle: 'planned', subject_id: ISSUER, revision: 2 },
    reference: reference(PRIVATE_FACT_SCHEMA, HASH_B, 512),
    edition: reference(PRIVATE_EDITION_SCHEMA, HASH_C, 480),
    generation: 'gen-2026-10-11',
    authority: 'context_only',
  };
}

function expectPrivateHeaders(response: Response) {
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toBe('Authorization, Cookie');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, noarchive');
  expect(response.headers.get('set-cookie')).toBeNull();
}

async function errorPayload(response: Response) {
  const payload = await response.json() as Record<string, unknown>;
  expect(Object.keys(payload).sort()).toEqual(['automatic_retry_permitted', 'code', 'schema']);
  expect(payload.schema).toBe(PRIVATE_ERROR_SCHEMA);
  expect(payload.automatic_retry_permitted).toBe(false);
  return payload;
}

beforeEach(() => {
  session.mockReset();
  session.mockResolvedValue({ token: 'verified-token' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('authentication and actual-feature gate', () => {
  it('does not start network reads for an already aborted inbound request', async () => {
    const caller = new AbortController();
    caller.abort();
    const probe = stubFetch(() => jsonResponse(grantedRow()), () => jsonResponse(selectionFixture()));
    const response = await issuerGet(new Request('https://app.mastermind-x.com/api/x', { signal: caller.signal }));
    expect(response.status).toBe(502);
    expect(probe.calls).toHaveLength(0);
    expectPrivateHeaders(response);
  });

  it('settles a body deadline even if its underlying stream ignores the fetch signal', async () => {
    vi.useFakeTimers();
    let source: ReadableStreamDefaultController<Uint8Array>;
    let canceled = false;
    stubFetch(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) { source = controller; },
      cancel() { canceled = true; },
    }), { headers: { 'content-type': 'application/json' } }));
    let response: Response | undefined;
    const pending = issuerGet(issuerRequest()).then(value => { response = value; });
    try {
      await vi.advanceTimersByTimeAsync(PRIVATE_REQUEST_DEADLINE_MS + 1);
      expect(response?.status).toBe(502);
      expect(canceled).toBe(true);
    } finally {
      source!.error(new Error('fixture cleanup'));
      await pending;
    }
  });

  it('does not await an unresponsive cancellation after exceeding the byte cap', async () => {
    vi.useFakeTimers();
    let releaseCancel: (() => void) | undefined;
    stubFetch(() => jsonResponse(grantedRow()), () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(OWNER_PROJECTION_MAX_BYTES + 1)); },
      cancel() { return new Promise<void>(resolve => { releaseCancel = resolve; }); },
    }), { headers: { 'content-type': 'application/json' } }));
    let response: Response | undefined;
    const pending = issuerGet(issuerRequest()).then(value => { response = value; });
    try {
      await vi.advanceTimersByTimeAsync(PRIVATE_REQUEST_DEADLINE_MS + 1);
      expect(response?.status).toBe(503);
      expect(releaseCancel).toBeTypeOf('function');
    } finally {
      releaseCancel?.();
      await pending;
    }
  });

  it('refuses absent or misleading owner JSON media types', async () => {
    for (const contentType of [null, 'application/notjson']) {
      const probe = stubFetch(() => jsonResponse(grantedRow()), () => new Response(
        encoder.encode(JSON.stringify(selectionFixture())),
        { headers: contentType === null ? {} : { 'content-type': contentType } },
      ));
      const response = await issuerGet(issuerRequest());
      expect(response.status).toBe(503);
      expect(probe.calls).toHaveLength(2);
      expectPrivateHeaders(response);
    }
  });

  it('refuses an unauthenticated caller before any network call, for both routes', async () => {
    session.mockResolvedValue(null);
    const probe = stubFetch(() => jsonResponse(grantedRow()));
    const issuer = await issuerGet(issuerRequest(), ISSUER);
    const fact = await factGet(factRequest(), FACT_ID);
    expect(issuer.status).toBe(401);
    expect(fact.status).toBe(401);
    expect(await errorPayload(issuer)).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(probe.calls).toHaveLength(0);
    expectPrivateHeaders(issuer);
    expectPrivateHeaders(fact);
  });

  it('treats a throwing session authority as unavailable, never as a denial', async () => {
    session.mockRejectedValue(new Error(SECRET));
    const probe = stubFetch(() => jsonResponse(grantedRow()));
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(502);
    expect(await errorPayload(response)).toMatchObject({ code: 'AUTHENTICATION_UNAVAILABLE' });
    expect(probe.calls).toHaveLength(0);
    expectPrivateHeaders(response);
  });

  it('refuses a baseline pro row that carries only the three old keys, with zero owner fetch', async () => {
    const probe = stubFetch(() => jsonResponse(grantedRow(['options_suite', 'flow_score', 'dislocations'])));
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(403);
    expect(await errorPayload(response)).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0].url).toBe(ME_URL);
  });

  it('refuses a near-miss or mis-cased feature, not a substring of one', async () => {
    const candidates = [
      ['company_intelligence_read'],
      ['company_intelligence_private_read_v2'],
      ['xcompany_intelligence_private_read'],
      ['company_intelligence_private_read '],
      ['COMPANY_INTELLIGENCE_PRIVATE_READ'],
      ['company_intelligence_private_readx'],
      [],
    ];
    for (const features of candidates) {
      const probe = stubFetch(() => jsonResponse(grantedRow(features)));
      const response = await factGet(factRequest(), FACT_ID);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
      expect(probe.calls).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it('refuses free, empty and inactive rows even when the exact feature is present', async () => {
    const rows = [
      { tier: 'free', features: [PRIVATE_KEY], status: 'active' },
      { tier: '', features: [PRIVATE_KEY], status: 'active' },
      { tier: '  FREE  ', features: [PRIVATE_KEY], status: 'active' },
      { tier: 'pro', features: [PRIVATE_KEY], status: 'canceled' },
      { tier: 'pro', features: [PRIVATE_KEY], status: 'past_due' },
      { tier: 'pro', features: [PRIVATE_KEY], status: '' },
    ];
    for (const row of rows) {
      const probe = stubFetch(() => jsonResponse(row));
      const response = await issuerGet(issuerRequest(), ISSUER);
      expect(response.status).toBe(403);
      expect(probe.calls).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it('passes the exact feature with active and trialing on any paid tier', async () => {
    for (const tier of ['pro', 'essential', 'unlimited']) {
      for (const status of ['active', 'trialing', ' ACTIVE ']) {
        stubFetch(() => jsonResponse(grantedRow([PRIVATE_KEY], tier, status)), () => jsonResponse(selectionFixture()));
        const response = await issuerGet(issuerRequest(), ISSUER);
        expect(response.status).toBe(200);
        vi.unstubAllGlobals();
      }
    }
  });

  it('ignores tier labels and other keys entirely', async () => {
    const probe = stubFetch(() => jsonResponse({
      tier: 'free',
      status: 'active',
      features: [PRIVATE_KEY],
      is_pro: true,
      options_suite: true,
      company_intelligence_private_read: true,
      dev_fixture: 'unlimited',
    }));
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(403);
    expect(probe.calls).toHaveLength(1);
  });

  it('maps an unreadable authority row to unavailable, distinct from a denial', async () => {
    const rows: unknown[] = [
      [],
      'pro',
      null,
      {},
      { tier: 'pro', status: 'active' },
      { tier: 1, status: 'active', features: [PRIVATE_KEY] },
      { tier: 'pro', status: true, features: [PRIVATE_KEY] },
      { tier: 'pro', status: 'active', features: PRIVATE_KEY },
      { tier: 'pro', status: 'active', features: ['ok', 7] },
    ];
    for (const row of rows) {
      const probe = stubFetch(() => jsonResponse(row));
      const response = await issuerGet(issuerRequest(), ISSUER);
      expect(response.status).toBe(502);
      expect(await errorPayload(response)).toMatchObject({ code: 'AUTHENTICATION_UNAVAILABLE' });
      expect(probe.calls).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it('maps a malformed, empty, non-JSON or abnormal authority response to unavailable', async () => {
    const responders: Responder[] = [
      () => new Response('{ not json', { status: 200, headers: { 'content-type': 'application/json' } }),
      () => new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
      () => new Response('<html>' + SECRET + '</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => new Response(null, { status: 200, headers: { 'content-type': 'application/json' } }),
      () => jsonResponse(grantedRow(), 503),
      () => jsonResponse(grantedRow(), 404),
      () => new Response('', { status: 302, headers: { location: 'https://evil.example/api/me' } }),
      () => { throw new Error(SECRET); },
    ];
    for (const responder of responders) {
      stubFetch(responder);
      const response = await issuerGet(issuerRequest(), ISSUER);
      expect(response.status).toBe(502);
      const payload = await errorPayload(response);
      expect(payload.code).toBe('AUTHENTICATION_UNAVAILABLE');
      expect(JSON.stringify(payload)).not.toContain(SECRET);
      vi.unstubAllGlobals();
    }
  });

  it('passes through the authority own authentication and grant statuses', async () => {
    stubFetch(() => jsonResponse(grantedRow(), 401));
    const expired = await issuerGet(issuerRequest(), ISSUER);
    expect(expired.status).toBe(401);
    expect(await errorPayload(expired)).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    vi.unstubAllGlobals();

    stubFetch(() => jsonResponse(grantedRow(), 403));
    const refused = await issuerGet(issuerRequest(), ISSUER);
    expect(refused.status).toBe(403);
    expect(await errorPayload(refused)).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
  });

  it('re-reads the entitlement on every request, so a revocation is caught with no cache', async () => {
    const probe = stubFetch(
      () => jsonResponse(grantedRow()),
      () => jsonResponse(selectionFixture()),
      () => jsonResponse(grantedRow([])),
    );
    const first = await issuerGet(issuerRequest(), ISSUER);
    expect(first.status).toBe(200);
    const second = await issuerGet(issuerRequest(), ISSUER);
    expect(second.status).toBe(403);
    expect(await errorPayload(second)).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
    // /api/me, owner, /api/me again: the authority row is read fresh each time.
    expect(probe.calls.map((call) => call.url)).toEqual([ME_URL, ISSUER_OWNER_URL, ME_URL]);
  });

  it('bounds the authority read with its own larger consumer cap', async () => {
    const filler = 'f'.repeat(40_000);
    stubFetch(() => jsonResponse(Object.assign(grantedRow(), { watermark: filler })), () => jsonResponse(selectionFixture()));
    const accepted = await issuerGet(issuerRequest(), ISSUER);
    expect(accepted.status).toBe(200);
    vi.unstubAllGlobals();

    const tooBig = 'f'.repeat(ENTITLEMENT_MAX_BYTES + 1_000);
    stubFetch(() => jsonResponse(Object.assign(grantedRow(), { watermark: tooBig })));
    const refused = await issuerGet(issuerRequest(), ISSUER);
    expect(refused.status).toBe(502);
    expect(ENTITLEMENT_MAX_BYTES).toBeGreaterThan(OWNER_PROJECTION_MAX_BYTES);
  });
});

describe('input validation after the entitlement grant', () => {
  beforeEach(() => {
    stubFetch(() => jsonResponse(grantedRow()));
  });

  it('rejects every query control, including mode and as_of, with zero owner fetch', async () => {
    const probe = stubFetch(() => jsonResponse(grantedRow()));
    const queries = ['?mode=current', '?mode=historical', '?as_of=2026-10-01T00:00:00Z', '?mode=historical&as_of=2026-10-01T00:00:00Z', '?anything=1', '?as_of=', '?mode=current&mode=current'];
    for (const query of queries) {
      const response = await issuerGet(issuerRequest('https://app.mastermind-x.com/api/company-intelligence/private/issuers/' + ISSUER + '/product-integrations' + query), ISSUER);
      expect(response.status).toBe(400);
      const payload = await errorPayload(response);
      expect(payload.code).toBe('REQUEST_INVALID');
    }
    expect(probe.calls).toHaveLength(queries.length);
    expect(probe.calls.every(call => call.url === ME_URL)).toBe(true);
    expect(probe.calls[0].url).toBe(ME_URL);
  });

  it('rejects a GET body with zero owner fetch', async () => {
    const probe = stubFetch(() => jsonResponse(grantedRow()));
    const withBody = { url: 'https://app.mastermind-x.com/api/x', method: 'GET', headers: new Headers({ 'content-length': '13' }) } as unknown as Request;
    const response = await issuerGet(withBody, ISSUER);
    expect(response.status).toBe(400);
    expect(await errorPayload(response)).toMatchObject({ code: 'REQUEST_INVALID' });
    expect(probe.calls).toHaveLength(1);
  });

  it('rejects path tricks before the owner fetch', async () => {
    const probe = stubFetch(() => jsonResponse(grantedRow()));
    const badIssuers = ['ISS:US-XNYS-MMC/../x', 'ISS:US-XNYS-MMC%2F..', 'iss:US-XNYS-MMC', 'ISS:US-XXXX-MMC', 'MMC', 'ISS:US-XNYS-MMC ', 'ISS:US-XNYS-MMC\\ops'];
    for (const issuerId of badIssuers) {
      const response = await issuerGet(issuerRequest(), issuerId);
      expect(response.status).toBe(400);
      expect(await errorPayload(response)).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(probe.calls).toHaveLength(badIssuers.length);
    expect(probe.calls.every(call => call.url === ME_URL)).toBe(true);
  });

  it('rejects a noncanonical fact id before the owner fetch', async () => {
    const probe = stubFetch(() => jsonResponse(grantedRow()));
    const badFacts = ['integration:' + 'A'.repeat(64), 'integration:' + 'a'.repeat(63), 'disclosure:' + 'a'.repeat(64), 'integration:' + 'g'.repeat(64), FACT_ID + '/../../x', '  ' + FACT_ID];
    for (const factId of badFacts) {
      const response = await factGet(factRequest(), factId);
      expect(response.status).toBe(400);
      expect(await errorPayload(response)).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(probe.calls).toHaveLength(badFacts.length);
    expect(probe.calls.every(call => call.url === ME_URL)).toBe(true);
  });
});

describe('fixed owner request shape', () => {
  it('forwards the issuer selection GET to one fixed path with the bearer and no-store', async () => {
    const probe = stubFetch(() => jsonResponse(grantedRow()), () => jsonResponse(selectionFixture()));
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(200);
    expect(probe.calls.map((call) => call.url)).toEqual([ME_URL, ISSUER_OWNER_URL]);
    for (const call of probe.calls) {
      expect(call.init.method).toBe('GET');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.redirect).toBe('error');
      expect(call.init.body).toBeUndefined();
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(call.init.headers);
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('authorization')).toBe('Bearer verified-token');
    }
  });

  it('forwards the fact GET to the fixed fact path, ignoring the caller origin and host', async () => {
    const probe = stubFetch(() => jsonResponse(grantedRow()), () => jsonResponse(factFixture()));
    const response = await factGet(factRequest('https://evil-origin.example:9999/api/company-intelligence/private/product-integrations/' + FACT_ID + '?mode=historical'), FACT_ID);
    // The hostile query is refused before the owner call; the origin still cannot steer it.
    expect(response.status).toBe(400);
    expect(probe.calls.map((call) => call.url)).toEqual([ME_URL]);
    vi.unstubAllGlobals();

    const clean = stubFetch(() => jsonResponse(grantedRow()), () => jsonResponse(factFixture()));
    const ok = await factGet(factRequest(), FACT_ID);
    expect(ok.status).toBe(200);
    expect(clean.calls[1].url).toBe(FACT_OWNER_URL);
    expect(clean.calls[1].url).toContain(encodeURIComponent(FACT_ID));
    expect(clean.calls[1].url.startsWith(BASE)).toBe(true);
  });

  it('never trusts a misreported or absent Content-Length and enforces the projection cap on the counted stream', async () => {
    let pulled = 0;
    let canceled: unknown = 'not canceled';
    const chunk = new Uint8Array(16 * 1024).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled >= 6) controller.close(); else controller.enqueue(chunk);
      },
      cancel(reason) { canceled = reason; },
    });
    let ownerSignal: AbortSignal | undefined;
    const probe = stubFetch(
      () => jsonResponse(grantedRow()),
      (_url, init) => {
        ownerSignal = init.signal as AbortSignal;
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
      },
    );
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(503);
    expect(await errorPayload(response)).toMatchObject({ code: 'PRIVATE_SERVICE_UNAVAILABLE' });
    expect(pulled).toBeGreaterThan(1);
    expect(canceled).not.toBe('not canceled');
    expect(ownerSignal?.aborted).toBe(true);
    expect(probe.calls).toHaveLength(2);
  });

  it('rejects an over-cap advertised length without pulling the stream at all', async () => {
    let pulled = 0;
    let canceled: unknown = 'not canceled';
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(encoder.encode('{}')); },
      cancel(reason) { canceled = reason; },
    }, { highWaterMark: 0 });
    stubFetch(
      () => jsonResponse(grantedRow()),
      () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(OWNER_PROJECTION_MAX_BYTES + 1) } }),
    );
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(503);
    expect(pulled).toBe(0);
    expect(canceled).not.toBe('not canceled');
  });

  it('rejects a body larger than the cap when the advertised length is a lie', async () => {
    const body = JSON.stringify(selectionFixture()) + ' '.repeat(OWNER_PROJECTION_MAX_BYTES);
    stubFetch(
      () => jsonResponse(grantedRow()),
      () => new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'content-length': '8' } }),
    );
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(503);
    expect(await errorPayload(response)).toMatchObject({ code: 'PRIVATE_SERVICE_UNAVAILABLE' });
  });

  it('rejects invalid UTF-8, a missing stream and a stalled body read', async () => {
    stubFetch(
      () => jsonResponse(grantedRow()),
      () => new Response(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect((await issuerGet(issuerRequest(), ISSUER)).status).toBe(503);
    vi.unstubAllGlobals();

    stubFetch(
      () => jsonResponse(grantedRow()),
      () => new Response(null, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect((await issuerGet(issuerRequest(), ISSUER)).status).toBe(503);
    vi.unstubAllGlobals();

    let stalledSignal: AbortSignal | undefined;
    stubFetch(
      () => jsonResponse(grantedRow()),
      (_url, init) => {
        stalledSignal = init.signal as AbortSignal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            stalledSignal?.addEventListener('abort', () => controller.error(new Error(SECRET)), { once: true });
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    );
    vi.useFakeTimers();
    const pending = issuerGet(issuerRequest(), ISSUER);
    await vi.advanceTimersByTimeAsync(PRIVATE_REQUEST_DEADLINE_MS + 50);
    const stalled = await pending;
    expect(stalled.status).toBe(503);
    expect(await errorPayload(stalled)).toMatchObject({ code: 'PRIVATE_SERVICE_UNAVAILABLE' });
    expect(stalledSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('aborts a stalled authority read at the deadline as an unavailable authority', async () => {
    vi.useFakeTimers();
    let stalledSignal: AbortSignal | undefined;
    stubFetch((_url, init) => {
      stalledSignal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          stalledSignal?.addEventListener('abort', () => controller.error(new Error(SECRET)), { once: true });
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const pending = issuerGet(issuerRequest(), ISSUER);
    await vi.advanceTimersByTimeAsync(PRIVATE_REQUEST_DEADLINE_MS + 50);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(await errorPayload(response)).toMatchObject({ code: 'AUTHENTICATION_UNAVAILABLE' });
    expect(stalledSignal?.aborted).toBe(true);
  });

  it('stops reading as soon as the inbound caller aborts', async () => {
    const caller = new AbortController();
    let internalSignal: AbortSignal | undefined;
    stubFetch((_url, init) => {
      internalSignal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          internalSignal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const request = new Request('https://app.mastermind-x.com/api/x', { signal: caller.signal });
    const pending = issuerGet(request, ISSUER);
    await vi.waitFor(() => expect(internalSignal).toBeInstanceOf(AbortSignal));
    expect(internalSignal?.aborted).toBe(false);
    caller.abort();
    const response = await pending;
    expect(response.status).toBe(502);
    expect(internalSignal?.aborted).toBe(true);
  });

  it('never pipes arbitrary 200 JSON and never copies upstream headers', async () => {
    const leaked = Object.assign(selectionFixture(), { reviewer_narrative: SECRET });
    stubFetch(
      () => jsonResponse(grantedRow()),
      () => jsonResponse(leaked, 200, { 'set-cookie': 'session=' + SECRET, 'x-upstream-secret': SECRET }),
    );
    const refused = await issuerGet(issuerRequest(), ISSUER);
    expect(refused.status).toBe(503);
    expect(JSON.stringify(await errorPayload(refused))).not.toContain(SECRET);
    vi.unstubAllGlobals();

    stubFetch(
      () => jsonResponse(grantedRow()),
      () => jsonResponse(selectionFixture(), 200, { 'set-cookie': 'session=should-not-appear', 'x-upstream': 'should-not-appear' }),
    );
    const accepted = await issuerGet(issuerRequest(), ISSUER);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('set-cookie')).toBeNull();
    expect(accepted.headers.get('x-upstream')).toBeNull();
    expect(Object.keys(await accepted.json() as Record<string, unknown>).sort()).toEqual(['generation', 'identity_mode', 'issuer_binding', 'issuer_role', 'schema', 'selections']);
    vi.unstubAllGlobals();

    stubFetch(
      () => jsonResponse(grantedRow()),
      () => jsonResponse(factFixture(), 200, { 'set-cookie': 'session=should-not-appear' }),
    );
    const factAccepted = await factGet(factRequest(), FACT_ID);
    expect(factAccepted.status).toBe(200);
    expect(Object.keys(await factAccepted.json() as Record<string, unknown>).sort()).toEqual(['authority', 'edition', 'fact', 'generation', 'reference', 'schema']);
  });

  it('sanitizes a projection that names another issuer or another fact than requested', async () => {
    stubFetch(
      () => jsonResponse(grantedRow()),
      () => jsonResponse(Object.assign(selectionFixture(), { issuer_binding: Object.assign({}, selectionFixture().issuer_binding, { issuer_id: 'ISS:US-XNAS-AAPL' }) })),
    );
    const foreignIssuer = await issuerGet(issuerRequest(), ISSUER);
    expect(foreignIssuer.status).toBe(503);
    expect(await errorPayload(foreignIssuer)).toMatchObject({ code: 'PRIVATE_SERVICE_UNAVAILABLE' });
    vi.unstubAllGlobals();

    stubFetch(
      () => jsonResponse(grantedRow()),
      () => jsonResponse(Object.assign(factFixture(), { fact: Object.assign({}, factFixture().fact, { fact_id: 'integration:' + 'e'.repeat(64) }) })),
    );
    const foreignFact = await factGet(factRequest(), FACT_ID);
    expect(foreignFact.status).toBe(503);
    expect(await errorPayload(foreignFact)).toMatchObject({ code: 'PRIVATE_SERVICE_UNAVAILABLE' });
  });
});

describe('owner HTTP error handling', () => {
  it('passes a valid closed source error through with retry prohibited', async () => {
    for (const code of ['SOURCE_NOT_ADMITTED', 'SOURCE_RUNTIME_UNAVAILABLE', 'PRIVATE_SOURCE_UNAVAILABLE']) {
      stubFetch(
        () => jsonResponse(grantedRow()),
        () => jsonResponse({ schema: PRIVATE_ERROR_SCHEMA, code, automatic_retry_permitted: false }, 503),
      );
      const response = await issuerGet(issuerRequest(), ISSUER);
      expect(response.status).toBe(503);
      expect(await errorPayload(response)).toMatchObject({ code, automatic_retry_permitted: false });
      expectPrivateHeaders(response);
      vi.unstubAllGlobals();
    }
  });

  it('passes a valid grant denial through without inventing retryability', async () => {
    stubFetch(
      () => jsonResponse(grantedRow()),
      () => jsonResponse({ schema: PRIVATE_ERROR_SCHEMA, code: 'ENTITLEMENT_REQUIRED', automatic_retry_permitted: false }, 403),
    );
    const response = await factGet(factRequest(), FACT_ID);
    expect(response.status).toBe(403);
    expect(await errorPayload(response)).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
  });

  it('sanitizes an unknown code, a status mismatch, a retry grant and a non-schema body', async () => {
    const cases: Array<[number, unknown]> = [
      [503, { schema: PRIVATE_ERROR_SCHEMA, code: 'GRANT_RETRACTED', automatic_retry_permitted: false }],
      [401, { schema: PRIVATE_ERROR_SCHEMA, code: 'SOURCE_NOT_ADMITTED', automatic_retry_permitted: false }],
      [500, { schema: PRIVATE_ERROR_SCHEMA, code: 'PRIVATE_SERVICE_UNAVAILABLE', automatic_retry_permitted: false }],
      [403, { schema: PRIVATE_ERROR_SCHEMA, code: 'ENTITLEMENT_REQUIRED', automatic_retry_permitted: true }],
      [503, { schema: 'billing.error/v1', code: 'PRIVATE_SERVICE_UNAVAILABLE', automatic_retry_permitted: false }],
      [503, { schema: PRIVATE_ERROR_SCHEMA, code: 'SOURCE_NOT_ADMITTED' }],
      [503, { detail: SECRET }],
      [404, {}],
      [429, {}],
    ];
    for (const [status, body] of cases) {
      stubFetch(
        () => jsonResponse(grantedRow()),
        () => jsonResponse(body, status),
      );
      const response = await issuerGet(issuerRequest(), ISSUER);
      expect(response.status).toBe(503);
      const payload = await errorPayload(response);
      expect(payload.code).toBe('PRIVATE_SERVICE_UNAVAILABLE');
      expect(payload.automatic_retry_permitted).toBe(false);
      expect(JSON.stringify(payload)).not.toContain(SECRET);
      expectPrivateHeaders(response);
      vi.unstubAllGlobals();
    }
  });

  it('sanitizes an HTML owner error page without echoing its text', async () => {
    stubFetch(
      () => jsonResponse(grantedRow()),
      () => new Response('<!doctype html><pre>Traceback: ' + SECRET + '</pre>', { status: 500, headers: { 'content-type': 'text/html' } }),
    );
    const response = await issuerGet(issuerRequest(), ISSUER);
    expect(response.status).toBe(503);
    const payload = await errorPayload(response);
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(payload.code).toBe('PRIVATE_SERVICE_UNAVAILABLE');
  });
});

describe('private response headers on every outcome', () => {
  it('marks successes and all refusals private, no-store, unindexable', async () => {
    const outcomes: Array<Promise<Response>> = [];
    session.mockResolvedValue(null);
    outcomes.push(issuerGet(issuerRequest(), ISSUER));
    session.mockResolvedValue({ token: 'verified-token' });
    stubFetch(() => jsonResponse(grantedRow([])));
    outcomes.push(issuerGet(issuerRequest(), ISSUER));
    const denied = await outcomes[1];
    expectPrivateHeaders(denied);
    vi.unstubAllGlobals();

    session.mockRejectedValue(new Error('unavailable'));
    const authUnavailable = await issuerGet(issuerRequest(), ISSUER);
    expectPrivateHeaders(authUnavailable);
    session.mockResolvedValue({ token: 'verified-token' });

    stubFetch(() => jsonResponse(grantedRow()), () => jsonResponse(selectionFixture()));
    const success = await issuerGet(issuerRequest(), ISSUER);
    expectPrivateHeaders(success);
    vi.unstubAllGlobals();

    stubFetch(() => jsonResponse(grantedRow()), () => jsonResponse({ schema: PRIVATE_ERROR_SCHEMA, code: 'SOURCE_NOT_ADMITTED', automatic_retry_permitted: false }, 503));
    const sourceError = await issuerGet(issuerRequest(), ISSUER);
    expectPrivateHeaders(sourceError);
    vi.unstubAllGlobals();

    stubFetch(() => jsonResponse(grantedRow()));
    const invalid = await issuerGet(issuerRequest('https://app.mastermind-x.com/api/x?mode=historical'), ISSUER);
    expectPrivateHeaders(invalid);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('content-type')).toBe('application/json');
  });
});

describe('route module surface', () => {
  it('exposes only a GET handler pinned to a dynamic render on both routes', () => {
    expect(Object.keys(issuerRoute).sort()).toEqual(['GET', 'dynamic', 'runtime']);
    expect(Object.keys(factRoute).sort()).toEqual(['GET', 'dynamic', 'runtime']);
    expect(issuerRoute.runtime).toBe('nodejs');
    expect(factRoute.runtime).toBe('nodejs');
    expect(issuerRoute.dynamic).toBe('force-dynamic');
    expect(factRoute.dynamic).toBe('force-dynamic');
    expect(typeof issuerRoute.GET).toBe('function');
    expect(typeof factRoute.GET).toBe('function');
  });

  it('awaits the Next 16 params promise rather than reading a plain object', async () => {
    stubFetch(() => jsonResponse(grantedRow()), () => jsonResponse(selectionFixture()));
    const context = { params: Promise.resolve({ issuerId: ISSUER }) };
    const response = await issuerRoute.GET(issuerRequest(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(selectionFixture());
  });
});

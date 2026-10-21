import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { proxyReading } from '@/lib/shared-shell/readingProxy';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const SERVER_TOKEN = 'server-side-session-token';
const DEFAULT_BASE = 'https://www.mastermind-x.com';
const PDF_SHA = 'a'.repeat(64);
const TEXT_SHA = 'b'.repeat(64);
const SAVED_BASE = process.env.BRAIN_GATEWAY_URL;

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: supabase.getUser, getSession: supabase.getSession },
  }),
}));

const fetchMock = vi.fn();

it('bounds an unavailable server identity before any Macro request', async () => {
  vi.useFakeTimers(); supabase.getUser.mockImplementation(() => new Promise(() => {}));
  const pending = proxyReading(bffRequest(), 'today');
  await vi.advanceTimersByTimeAsync(12_000);
  const response = await pending; expect(response.status).toBe(502); await expectSecureHeaders(response);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('bounds a stalled JSON stream after headers arrived', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }));
  const pending = proxyReading(bffRequest(), 'today'); await vi.advanceTimersByTimeAsync(12_000);
  const response = await pending; expect(response.status).toBe(502); await expectSecureHeaders(response);
});
it('classifies an actually missing Supabase session as unauthenticated', async () => {
  supabase.getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400 } });
  const response = await proxyReading(bffRequest(), 'catalog'); expect(response.status).toBe(401); await expectSecureHeaders(response); expect(fetchMock).not.toHaveBeenCalled();
});
it('refuses newline identifiers, newline pins, and unsafe integer continuation bounds', async () => {
  expect((await proxyReading(bffRequest(), 'read', 'report-one\n')).status).toBe(400);
  expect((await proxyReading(bffRequest(`https://app.test/bff?source_pdf_sha256=${PDF_SHA}%0A&extracted_text_sha256=${TEXT_SHA}`), 'read', 'report-one')).status).toBe(400);
  expect((await proxyReading(bffRequest(`https://app.test/bff?segment_start=${Number.MAX_SAFE_INTEGER+1}&source_pdf_sha256=${PDF_SHA}&extracted_text_sha256=${TEXT_SHA}`), 'read', 'report-one')).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function bffRequest(
  url = 'https://app.internal.test/bff/reading',
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request(url, { headers, signal });
}

function lastCall(): { url: string; init: RequestInit; headers: Headers } {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit] | undefined;
  expect(call, 'expected an upstream fetch call').toBeDefined();
  return { url: call![0], init: call![1], headers: new Headers(call![1].headers as HeadersInit) };
}

async function expectSecureHeaders(res: Response): Promise<void> {
  expect(res.headers.get('cache-control')).toBe('private,no-store');
  expect(res.headers.get('vary')).toBe('Cookie');
  expect(res.headers.get('x-robots-tag')).toBe('noindex,noarchive');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
}

/** fetch double that never resolves unless its own signal aborts (timeout / client abort paths). */
function hangUpOnFetch(): void {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  });
}

function setBase(value: string | undefined): void {
  if (value === undefined) delete process.env.BRAIN_GATEWAY_URL;
  else process.env.BRAIN_GATEWAY_URL = value;
}

beforeEach(() => {
  supabase.getUser.mockReset();
  supabase.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  supabase.getSession.mockReset();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: USER_ID }, access_token: SERVER_TOKEN } },
    error: null,
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  setBase(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setBase(SAVED_BASE);
});

describe('authentication', () => {
  it('returns 401 when there is no authenticated user', async () => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    await expectSecureHeaders(res);
  });

  it('returns 401 for a non-UUID user id', async () => {
    supabase.getUser.mockResolvedValue({ data: { user: { id: 'not-a-uuid' } }, error: null });
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(401);
    supabase.getUser.mockResolvedValue({ data: { user: { id: undefined } }, error: null });
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the session user id does not match the authenticated user', async () => {
    supabase.getSession.mockResolvedValue({
      data: { session: { user: { id: '99999999-9999-9999-9999-999999999999' }, access_token: SERVER_TOKEN } },
      error: null,
    });
    const res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    await expectSecureHeaders(res);
  });

  it('returns 401 when the session is missing or has no access token', async () => {
    supabase.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(401);
    supabase.getSession.mockResolvedValue({
      data: { session: { user: { id: USER_ID }, access_token: '' } },
      error: null,
    });
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 on auth service failure and never touches the gateway', async () => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'auth down' } });
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(503);
    supabase.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    supabase.getSession.mockRejectedValue(new Error('session lookup crashed'));
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(503);
    supabase.getSession.mockReset();
    supabase.getSession.mockResolvedValue({
      data: { session: { user: { id: USER_ID }, access_token: SERVER_TOKEN } },
      error: null,
    });
    supabase.getUser.mockRejectedValue(new Error('getUser crashed'));
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    await expectSecureHeaders(await proxyReading(bffRequest(), 'catalog'));
  });

  it('ignores forged client credentials and forwards only the server session token', async () => {
    const res = await proxyReading(
      bffRequest('https://app.internal.test/bff/reading', {
        authorization: 'Bearer forged-client-token',
        cookie: 'sb-access-token=forged',
      }),
      'catalog',
    );
    expect(res.status).toBe(200);
    const { init, headers } = lastCall();
    expect(init).toEqual({
      method: 'GET',
      headers: { Authorization: `Bearer ${SERVER_TOKEN}`, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(headers.get('authorization')).toBe(`Bearer ${SERVER_TOKEN}`);
    expect(headers.get('cookie')).toBeNull();
  });
});

describe('fixed upstream paths', () => {
  it.each([
    ['catalog', '/api/research/catalog'],
    ['search', '/api/research/search'],
    ['today', '/api/macro/command'],
  ] as const)('maps %s to its fixed gateway route', async (resource, path) => {
    const res = await proxyReading(bffRequest(), resource);
    expect(res.status).toBe(200);
    expect(lastCall().url).toBe(`${DEFAULT_BASE}${path}`);
  });

  it('maps read to /api/research/read/{docId} with the validated continuation', async () => {
    const res = await proxyReading(
      bffRequest(
        `https://app.internal.test/bff/reading?source_pdf_sha256=${PDF_SHA}&extracted_text_sha256=${TEXT_SHA}&segment_start=2&max_segments=2`,
      ),
      'read',
      'doc-1_A',
    );
    expect(res.status).toBe(200);
    expect(lastCall().url).toBe(
      `${DEFAULT_BASE}/api/research/read/doc-1_A?source_pdf_sha256=${PDF_SHA}&extracted_text_sha256=${TEXT_SHA}&segment_start=2&max_segments=2`,
    );
  });

  it('never adopts the request host, path or unvalidated query', async () => {
    const res = await proxyReading(bffRequest('https://attacker.test/steal?q=alpha'), 'search');
    expect(res.status).toBe(200);
    expect(lastCall().url).toBe(`${DEFAULT_BASE}/api/research/search?q=alpha`);
  });

  it('rejects a docId supplied for a resource that takes none', async () => {
    expect((await proxyReading(bffRequest(), 'catalog', 'doc-1_A')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('query validation', () => {
  const url = (query: string) => bffRequest(`https://app.internal.test/bff/reading?${query}`);

  it('rejects unknown and duplicated parameters', async () => {
    expect((await proxyReading(url('q=alpha&bogus=1'), 'search')).status).toBe(400);
    expect((await proxyReading(url('q=alpha&q=beta'), 'search')).status).toBe(400);
    expect((await proxyReading(url('version=2'), 'search')).status).toBe(400);
    expect((await proxyReading(url('q=anything'), 'catalog')).status).toBe(400);
    expect((await proxyReading(url('limit=5'), 'today')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces search parameter bounds', async () => {
    expect((await proxyReading(url('q='), 'search')).status).toBe(400);
    expect((await proxyReading(url(`q=${'x'.repeat(201)}`), 'search')).status).toBe(400);
    expect((await proxyReading(url(`institution=${'x'.repeat(101)}`), 'search')).status).toBe(400);
    expect((await proxyReading(url('limit=0'), 'search')).status).toBe(400);
    expect((await proxyReading(url('limit=51'), 'search')).status).toBe(400);
    expect((await proxyReading(url('limit=abc'), 'search')).status).toBe(400);
    expect((await proxyReading(url('limit=1.5'), 'search')).status).toBe(400);
    expect((await proxyReading(url('from=2026-13-01'), 'search')).status).toBe(400);
    expect((await proxyReading(url('from=20260101'), 'search')).status).toBe(400);
    const ok = await proxyReading(
      url('q=alpha&institution=uni&from=2026-01-01&to=2026-02-02&limit=50'),
      'search',
    );
    expect(ok.status).toBe(200);
    expect(lastCall().url).toBe(
      `${DEFAULT_BASE}/api/research/search?q=alpha&institution=uni&from=2026-01-01&to=2026-02-02&limit=50`,
    );
  });

  it('rejects malformed, traversal and overlong docId values', async () => {
    for (const docId of ['../secret', '..', 'a/b', 'a%2Fb', '', `${'x'.repeat(129)}`, 'bad!id']) {
      expect((await proxyReading(bffRequest(), 'read', docId)).status).toBe(400);
    }
    expect((await proxyReading(bffRequest(), 'read')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await proxyReading(bffRequest(), 'read', 'a'.repeat(128))).status).toBe(200);
  });

  it('requires paired sha256 pins for read continuations', async () => {
    const onlyPdf = `source_pdf_sha256=${PDF_SHA}`;
    const onlyText = `extracted_text_sha256=${TEXT_SHA}`;
    expect((await proxyReading(url('segment_start=1'), 'read', 'doc')).status).toBe(400);
    expect((await proxyReading(url(`${onlyPdf}&segment_start=1`), 'read', 'doc')).status).toBe(400);
    expect((await proxyReading(url(onlyPdf), 'read', 'doc')).status).toBe(400);
    expect((await proxyReading(url(onlyText), 'read', 'doc')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces read pin format and range rules', async () => {
    expect((await proxyReading(url(`source_pdf_sha256=${PDF_SHA.toUpperCase()}`), 'read', 'doc')).status).toBe(400);
    expect((await proxyReading(url(`source_pdf_sha256=${'a'.repeat(63)}`), 'read', 'doc')).status).toBe(400);
    expect((await proxyReading(url('segment_start=-1'), 'read', 'doc')).status).toBe(400);
    expect((await proxyReading(url('max_segments=0'), 'read', 'doc')).status).toBe(400);
    expect((await proxyReading(url('max_segments=5'), 'read', 'doc')).status).toBe(400);
    const ok = await proxyReading(
      url(`source_pdf_sha256=${PDF_SHA}&extracted_text_sha256=${TEXT_SHA}&segment_start=0&max_segments=4`),
      'read',
      'doc',
    );
    expect(ok.status).toBe(200);
    expect(lastCall().url).toContain('segment_start=0&max_segments=4');
  });
});

describe('upstream handling', () => {
  it('returns validated JSON with the upstream status', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ items: [1, 2] }, 200));
    const res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [1, 2] });
    await expectSecureHeaders(res);
  });

  it('refuses redirect responses as 502', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ok: true }, 302, { location: 'https://evil.test/x' }));
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(502);
    fetchMock.mockRejectedValue(new TypeError('unexpected redirect')); // redirect: 'error' failure mode
    const res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('evil.test');
    await expectSecureHeaders(res);
  });

  it('refuses non-JSON and malformed JSON bodies as 502', async () => {
    fetchMock.mockImplementation(async () =>
      new Response('plain', { status: 200, headers: { 'content-type': 'text/plain' } }));
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(502);
    fetchMock.mockImplementation(async () =>
      new Response('{oops', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(502);
  });

  it('refuses oversized bodies as 502', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ok: true }, 200, { 'content-length': String(4 * 1024 * 1024 + 1) }));
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(502);
    fetchMock.mockImplementation(async () =>
      new Response(`"${'x'.repeat(4 * 1024 * 1024)}"`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    expect((await proxyReading(bffRequest(), 'catalog')).status).toBe(502);
  });

  it('maps connection failures to a generic 502 with no internal detail', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED 10.0.0.1:443'));
    const res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain(SERVER_TOKEN);
    expect(text).not.toContain(DEFAULT_BASE);
    await expectSecureHeaders(res);
  });

  it('aborts the upstream request after 12 seconds and returns 502', async () => {
    hangUpOnFetch();
    vi.useFakeTimers();
    try {
      const pending = proxyReading(bffRequest(), 'catalog');
      await vi.advanceTimersByTimeAsync(12_000);
      expect((await pending).status).toBe(502);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles a client abort with private failure headers', async () => {
    hangUpOnFetch();
    const controller = new AbortController();
    const pending = proxyReading(
      bffRequest('https://app.internal.test/x', {}, controller.signal),
      'catalog',
    );
    controller.abort();
    const response = await pending; expect(response.status).toBe(502); await expectSecureHeaders(response);
  });

  it('propagates upstream status and numeric Retry-After without upstream cookies, redirects, CORS or cache headers', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: 'slow down' }, 429, {
        'retry-after': '120',
        'set-cookie': 'upstream=1; Path=/',
        location: 'https://upstream.test/elsewhere',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=3600',
      }));
    const res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'slow down' });
    expect(res.headers.get('retry-after')).toBe('120');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('private,no-store');
    await expectSecureHeaders(res);
  });

  it('drops non-numeric and excessive Retry-After but keeps a valid one', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: 'x' }, 503, { 'retry-after': 'Wed, 21 Oct 2026 05:00:00 GMT' }));
    let res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeNull();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: 'x' }, 503, { 'retry-after': String(86_400 + 1) }));
    res = await proxyReading(bffRequest(), 'catalog');
    expect(res.headers.get('retry-after')).toBeNull();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: 'x' }, 503, { 'retry-after': '86400' }));
    res = await proxyReading(bffRequest(), 'catalog');
    expect(res.headers.get('retry-after')).toBe('86400');
    await expectSecureHeaders(res);
  });

  it('marks every failure response private/no-store', async () => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expectSecureHeaders(await proxyReading(bffRequest(), 'catalog')); // 401
    supabase.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    setBase('http://public.example.com');
    await expectSecureHeaders(await proxyReading(bffRequest(), 'catalog')); // 502 bad base
    setBase(undefined);
    await expectSecureHeaders(await proxyReading(bffRequest('https://app.internal.test/x?weird=1'), 'catalog')); // 400
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expectSecureHeaders(await proxyReading(bffRequest(), 'catalog')); // 502 upstream
  });
});

describe('gateway base configuration', () => {
  it('uses the configured HTTPS origin, never a request-supplied one', async () => {
    setBase('https://gw.custom.test');
    await proxyReading(bffRequest(), 'catalog');
    expect(lastCall().url).toBe('https://gw.custom.test/api/research/catalog');
  });

  it.each(['http://localhost:4000', 'http://127.0.0.1:8081'])(
    'allows plain HTTP only for loopback dev bases (%s)',
    async (base) => {
      setBase(base);
      const res = await proxyReading(bffRequest(), 'catalog');
      expect(res.status).toBe(200);
      expect(lastCall().url).toBe(`${base}/api/research/catalog`);
    },
  );

  it.each([
    'http://insecure.example.com',
    'https://user:pass@gw.test',
    'https://gw.test/subpath',
    'https://gw.test/?x=1',
    'https://gw.test/#frag',
    'not-a-url',
    'ftp://gw.test',
  ])('refuses unsafe gateway base %s', async (base) => {
    setBase(base);
    const res = await proxyReading(bffRequest(), 'catalog');
    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    await expectSecureHeaders(res);
  });
});

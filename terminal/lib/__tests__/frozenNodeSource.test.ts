// terminal/lib/__tests__/frozenNodeSource.test.ts
//
// Synthetic-only tests: every transport is an injected fake; ambient fetch is
// never touched. The fake Response objects deliberately expose only the
// surface the source may use (status/redirected/url/headers/body) and have no
// json()/text()/arrayBuffer() methods, so a bodyless fallback could not pass.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FROZEN_NODE_MAX_SOURCE_BYTES,
  readFrozenNodeDatedGex,
  type FrozenNodeFetcher,
  type FrozenNodeSourceResult,
} from '../frozenNodeSource';

// Immutable excerpt of terminal/lib/upstreams.ts — restated literally so the
// exact-URL assertions are independent of the module under test.
const R2_BASE = 'https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev';

function expectedUrl(root: string, session: string): string {
  return (
    R2_BASE +
    '/options_hub/gex_history/' +
    encodeURIComponent(root) +
    '/' +
    encodeURIComponent(session) +
    '.json'
  );
}

const ROOT = 'AAPL';
const SESSION = '2024-02-15';
const URL = expectedUrl(ROOT, SESSION);

type Chunk = Uint8Array;

interface Harness {
  calls: Array<{ url: string; init: RequestInit | undefined }>;
  state: { reads: number; cancels: number; releases: number };
}

function textChunk(text: string): Chunk {
  return new TextEncoder().encode(text);
}

interface FakeResponseOpts {
  status?: number;
  url?: string;
  redirected?: boolean;
  headers?: Record<string, string>;
  chunks?: Chunk[];
  /** Allocate real byte chunks of these sizes for bound tests. */
  syntheticSizes?: number[];
  /** read() hangs forever until this signal aborts, then rejects. */
  hangReadOnSignal?: AbortSignal | null;
  /** Omit body entirely (null) to prove there is no bodyless fallback. */
  nullBody?: boolean;
}

function fakeResponse(
  opts: FakeResponseOpts = {},
  shared?: Harness,
): { response: Response; harness: Harness } {
  const harness: Harness = shared ?? { calls: [], state: { reads: 0, cancels: 0, releases: 0 } };
  const chunks = opts.chunks ?? [];
  const sizes = opts.syntheticSizes ?? [];
  const total = chunks.length + sizes.length;
  let index = 0;
  const headers: Record<string, string> = {};
  for (const key of Object.keys(opts.headers ?? {})) headers[key.toLowerCase()] = (opts.headers as Record<string, string>)[key];
  const reader = {
    async read(): Promise<{ done: boolean; value?: Uint8Array }> {
      harness.state.reads++;
      if (opts.hangReadOnSignal) {
        const signal = opts.hangReadOnSignal;
        if (signal.aborted) throw new Error('aborted');
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      if (index < total) {
        const i = index++;
        if (i < chunks.length) return { done: false, value: chunks[i] };
        // Bound tests exercise real byte accumulation.
        return { done: false, value: new Uint8Array(sizes[i - chunks.length]) };
      }
      return { done: true };
    },
    async cancel(): Promise<void> {
      harness.state.cancels++;
    },
    releaseLock(): void {
      harness.state.releases++;
    },
  };
  const response = {
    status: opts.status === undefined ? 200 : opts.status,
    ok: opts.status === undefined ? true : opts.status === 200,
    redirected: opts.redirected === undefined ? false : opts.redirected,
    url: opts.url === undefined ? URL : opts.url,
    headers: {
      get: (name: string): string | null => {
        const key = name.toLowerCase();
        return Object.prototype.hasOwnProperty.call(headers, key) ? headers[key] : null;
      },
    },
    body: opts.nullBody
      ? null
      : {
          getReader: () => reader,
          // Faithful to ReadableStream: the source cancels unread bodies.
          cancel: async (): Promise<void> => {
            harness.state.cancels++;
          },
        },
  } as unknown as Response;
  return { response, harness };
}

function fetcherReturning(response: Response, harness: Harness): FrozenNodeFetcher {
  return (url, init) => {
    harness.calls.push({ url, init });
    return Promise.resolve(response);
  };
}

function fetcherFailing(harness: Harness, err: Error): FrozenNodeFetcher {
  return (url, init) => {
    harness.calls.push({ url, init });
    return Promise.reject(err);
  };
}

function read(
  fetcher: FrozenNodeFetcher,
  extra?: { baseUrl?: string; signal?: AbortSignal },
): Promise<FrozenNodeSourceResult> {
  return readFrozenNodeDatedGex({ root: ROOT, session: SESSION }, { fetcher, baseUrl: extra?.baseUrl, signal: extra?.signal });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FROZEN_NODE_MAX_SOURCE_BYTES', () => {
  it('is the 8 MiB source bound without BigInt literals', () => {
    expect(FROZEN_NODE_MAX_SOURCE_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('exact synthetic read', () => {
  it('reads the one exact frozen object URL once, with redirect/cache policy', async () => {
    const payload = '{"ok":true}';
    const { response, harness } = fakeResponse({
      headers: { 'content-length': String(payload.length) },
      chunks: [textChunk(payload)],
    });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('data');
    if (result.kind !== 'data') return;
    expect(result.raw).toEqual({ ok: true });
    expect(Array.from(result.bytes)).toEqual(Array.from(textChunk(payload)));
    expect(harness.calls.length).toBe(1);
    expect(harness.calls[0].url).toBe('https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev/options_hub/gex_history/AAPL/2024-02-15.json');
    expect(harness.calls[0].init?.redirect).toBe('error');
    expect(harness.calls[0].init?.cache).toBe('no-store');
    expect(harness.calls[0].init?.signal).toBeDefined();
    expect(harness.state.reads).toBe(2); // one payload chunk + done
    expect(harness.state.releases).toBe(1);
  });

  it('keeps dotted canonical roots verbatim in the exact URL', async () => {
    const { response, harness } = fakeResponse({ url: expectedUrl('BRK.B', SESSION), chunks: [textChunk('1')] });
    const result = await readFrozenNodeDatedGex({ root: 'BRK.B', session: SESSION }, { fetcher: fetcherReturning(response, harness) });
    expect(result.kind).toBe('data');
    expect(harness.calls[0].url).toBe(R2_BASE + '/options_hub/gex_history/BRK.B/2024-02-15.json');
  });

  it('accepts a leap day and a trailing-slash baseUrl, still one exact fetch', async () => {
    const session = '2024-02-29';
    const { response, harness } = fakeResponse({ url: expectedUrl(ROOT, session), chunks: [textChunk('{"a":1}')] });
    const result = await readFrozenNodeDatedGex({ root: ROOT, session }, { fetcher: fetcherReturning(response, harness), baseUrl: R2_BASE + '/' });
    expect(result.kind).toBe('data');
    expect(harness.calls.length).toBe(1);
    expect(harness.calls[0].url).toBe(expectedUrl(ROOT, session));
  });
});

describe('missing and status handling', () => {
  it('maps exact 404 to missing with no fallback read', async () => {
    const { response, harness } = fakeResponse({ status: 404 });
    const result = await read(fetcherReturning(response, harness));
    expect(result).toEqual({ kind: 'missing' });
    expect(harness.calls.length).toBe(1); // one direct read at most
    expect(harness.state.reads).toBe(0); // nothing streamed, nothing re-fetched
  });

  it('refuses non-200/non-404 statuses without retry', async () => {
    for (const status of [204, 301, 403, 500]) {
      const { response, harness } = fakeResponse({ status });
      const result = await read(fetcherReturning(response, harness));
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') expect(result.reason).toContain('status ' + status);
      expect(harness.calls.length).toBe(1);
    }
  });
});

describe('coordinate validation before any fetch', () => {
  const cases: Array<{ root: string; session: string }> = [
    { root: 'AAPL\n', session: SESSION },
    { root: 'aapl', session: SESSION }, // correctable case
    { root: ' AAPL', session: SESSION },
    { root: 'AAPL ', session: SESSION },
    { root: 'aapl.us', session: SESSION },
    { root: 'AA PL', session: SESSION },
    { root: 'AAPL!', session: SESSION },
    { root: 'ABCDEFGHIJKLM', session: SESSION }, // 13 chars
    { root: '', session: SESSION },
    { root: ROOT, session: '2024-2-15' },
    { root: ROOT, session: '2023-02-29' }, // not a leap year
    { root: ROOT, session: '2100-02-29' }, // century non-leap
    { root: ROOT, session: '2024-13-01' },
    { root: ROOT, session: '2024-00-10' },
    { root: ROOT, session: '2024-04-31' },
    { root: ROOT, session: '2024-02-30' },
    { root: ROOT, session: '2024-02-15T00:00' },
    { root: ROOT, session: '20240215' },
    { root: ROOT, session: ' 2024-02-15' },
    { root: ROOT, session: '15-02-2024' },
    { root: ROOT, session: '0000-01-01' },
  ];

  it('rejects every invalid or correctable pair before fetching', async () => {
    for (const coords of cases) {
      const { response, harness } = fakeResponse({});
      const result = await readFrozenNodeDatedGex(coords, { fetcher: fetcherReturning(response, harness) });
      expect(result.kind, JSON.stringify(coords)).toBe('unavailable');
      expect(harness.calls.length, JSON.stringify(coords)).toBe(0);
    }
  });

  it('rejects non-string coordinates and a missing fetcher without throwing', async () => {
    const badCoords = [
      { root: 123 as unknown as string, session: SESSION },
      { root: ROOT, session: 20240215 as unknown as string },
      { root: undefined as unknown as string, session: SESSION },
      null as unknown as { root: string; session: string },
    ];
    for (const coords of badCoords) {
      const { response, harness } = fakeResponse({});
      const result = await readFrozenNodeDatedGex(coords, { fetcher: fetcherReturning(response, harness) });
      expect(result.kind).toBe('unavailable');
      expect(harness.calls.length).toBe(0);
    }
    const { response, harness } = fakeResponse({});
    const missingFetcher = await readFrozenNodeDatedGex({ root: ROOT, session: SESSION }, {
      fetcher: undefined as unknown as FrozenNodeFetcher,
    });
    const emptyOpts = await readFrozenNodeDatedGex({ root: ROOT, session: SESSION }, {} as { fetcher: FrozenNodeFetcher });
    expect(missingFetcher.kind).toBe('unavailable');
    expect(emptyOpts.kind).toBe('unavailable');
    expect(harness.calls.length).toBe(0);
    void response;
  });
});

describe('explicit origin validation', () => {
  const rejected = [
    'https://evil.example.com',
    R2_BASE + '/sub',
    R2_BASE + '?x=1',
    R2_BASE + '#frag',
    R2_BASE + ':443',
    R2_BASE.replace('https://', 'https://user:pw@'),
    R2_BASE.replace('https://', 'http://'),
    // (R2_BASE + '/' is deliberately NOT here: it is an accepted form and is
    // covered by the accepting tests below.)
    'not a url',
    'pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev',
  ];

  it('refuses every other origin/path/userinfo/query/fragment/port form before fetching', async () => {
    for (const baseUrl of rejected) {
      const { response, harness } = fakeResponse({});
      const result = await read(fetcherReturning(response, harness), { baseUrl });
      expect(result.kind, baseUrl).toBe('unavailable');
      expect(harness.calls.length, baseUrl).toBe(0);
    }
  });

  it('accepts exactly R2_BASE itself', async () => {
    const { response, harness } = fakeResponse({ chunks: [textChunk('{"ok":1}')] });
    const result = await read(fetcherReturning(response, harness), { baseUrl: R2_BASE });
    expect(result.kind).toBe('data');
    expect(harness.calls.length).toBe(1);
  });
});

describe('final URL and redirect refusal', () => {
  it('refuses redirected=true even with a 200 exact URL', async () => {
    const { response, harness } = fakeResponse({ redirected: true, chunks: [textChunk('{}')] });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('redirect');
    expect(harness.calls.length).toBe(1);
    expect(harness.state.reads).toBe(0);
  });

  it('refuses an empty final URL', async () => {
    const { response, harness } = fakeResponse({ url: '', chunks: [textChunk('{}')] });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('final URL');
    expect(harness.state.reads).toBe(0);
  });

  it('refuses a final URL that is not the exact requested object URL', async () => {
    for (const url of [
      R2_BASE + '/options_hub/gex_history/AAPL/2024-02-16.json',
      URL + '/',
      R2_BASE + '/options_hub/gex_history/MSFT/2024-02-15.json',
      R2_BASE.replace('pub-', 'other-') + '/options_hub/gex_history/AAPL/2024-02-15.json',
    ]) {
      const { response, harness } = fakeResponse({ url, chunks: [textChunk('{}')] });
      const result = await read(fetcherReturning(response, harness));
      expect(result.kind, url).toBe('unavailable');
      expect(harness.state.reads, url).toBe(0);
    }
  });
});

describe('advertised content-length bound', () => {
  it('refuses oversize, malformed, negative and junk lengths before reading', async () => {
    const cases = [
      String(FROZEN_NODE_MAX_SOURCE_BYTES + 1),
      '99999999999999999999999999',
      'abc',
      '12.5',
      '-1',
      '+5',
      ' 10',
      '0x10',
      '',
    ];
    for (const len of cases) {
      const { response, harness } = fakeResponse({ headers: { 'content-length': len }, chunks: [textChunk('{}')] });
      const result = await read(fetcherReturning(response, harness));
      expect(result.kind, 'content-length=' + JSON.stringify(len)).toBe('unavailable');
      expect(harness.state.reads, 'content-length=' + JSON.stringify(len)).toBe(0);
      expect(harness.state.cancels, 'content-length=' + JSON.stringify(len)).toBe(1);
    }
  });

  it('streams on when the length header is absent (actual bound still applies)', async () => {
    const { response, harness } = fakeResponse({ chunks: [textChunk('{"ok":true}')] });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('data');
    expect(harness.state.reads).toBe(2);
  });
});

describe('actual streamed byte bound', () => {
  const overSizes = [FROZEN_NODE_MAX_SOURCE_BYTES, 1]; // synthetic sizes totalling bound+1

  it('refuses an actual oversize stream when the advertised length is absent', async () => {
    const { response, harness } = fakeResponse({ syntheticSizes: overSizes });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('bound');
    expect(harness.calls.length).toBe(1);
    expect(harness.state.reads).toBe(2);
    expect(harness.state.cancels).toBe(1);
    expect(harness.state.releases).toBe(1);
  });

  it('refuses an actual oversize stream when the advertised length is falsely small', async () => {
    const { response, harness } = fakeResponse({ headers: { 'content-length': '2' }, syntheticSizes: overSizes });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('bound');
    expect(harness.state.cancels).toBe(1);
  });

  it('still streams a source of exactly the bound (then fails JSON, never the bound)', async () => {
    const { response, harness } = fakeResponse({ syntheticSizes: [FROZEN_NODE_MAX_SOURCE_BYTES] });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('JSON');
    expect(harness.state.cancels).toBe(0);
  });
});

describe('body decoding', () => {
  it('refuses a null body and never falls back to json()/text()/arrayBuffer()', async () => {
    const { response, harness } = fakeResponse({ nullBody: true, headers: { 'content-length': '2' } });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('body');
    expect(harness.state.reads).toBe(0);
  });

  it('refuses invalid UTF-8', async () => {
    const bad = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    const { response, harness } = fakeResponse({ headers: { 'content-length': String(bad.byteLength) }, chunks: [bad] });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('UTF-8');
  });

  it('refuses malformed JSON over valid UTF-8', async () => {
    const { response, harness } = fakeResponse({ chunks: [textChunk('{"gex":')] });
    const result = await read(fetcherReturning(response, harness));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('JSON');
  });
});

describe('abort and transport failure', () => {
  it('refuses an already-aborted caller signal before any fetch', async () => {
    const controller = new AbortController();
    controller.abort();
    const { response, harness } = fakeResponse({});
    const result = await read(fetcherReturning(response, harness), { signal: controller.signal });
    expect(result.kind).toBe('unavailable');
    expect(harness.calls.length).toBe(0);
  });

  it('honours a caller abort raised mid-stream through the internal controller', async () => {
    const caller = new AbortController();
    const harness: Harness = { calls: [], state: { reads: 0, cancels: 0, releases: 0 } };
    // The fake body hangs on the very signal the source handed to fetch, so
    // the caller abort must propagate: caller signal -> internal controller
    // abort -> pending read() rejection.
    const fetcher: FrozenNodeFetcher = (url, init) => {
      harness.calls.push({ url, init });
      // Share the outer harness so reader cancel/release counts are visible.
      const built = fakeResponse({ chunks: [textChunk('{}')], hangReadOnSignal: init?.signal ?? null }, harness);
      return Promise.resolve(built.response);
    };
    const pending = read(fetcher, { signal: caller.signal });
    await flush();
    caller.abort();
    const result = await pending;
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('aborted');
    expect(harness.calls.length).toBe(1);
    expect(harness.state.releases).toBe(1);
  });

  it('reports a transport error from the injected fetcher', async () => {
    const harness: Harness = { calls: [], state: { reads: 0, cancels: 0, releases: 0 } };
    const result = await read(fetcherFailing(harness, new Error('boom')), {});
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('boom');
    expect(harness.calls.length).toBe(1);
  });

  it('times out the single fetch after 2500ms', async () => {
    vi.useFakeTimers();
    const harness: Harness = { calls: [], state: { reads: 0, cancels: 0, releases: 0 } };
    const fetcher: FrozenNodeFetcher = (url, init) => {
      harness.calls.push({ url, init });
      const built = fakeResponse({ chunks: [textChunk('{}')], hangReadOnSignal: init?.signal ?? null });
      return Promise.resolve(built.response);
    };
    const pending = read(fetcher);
    await vi.advanceTimersByTimeAsync(2500);
    const result = await pending;
    expect(result.kind).toBe('unavailable');
    expect(harness.calls.length).toBe(1);
  });
});


describe('hard deadline and late completion regressions', () => {
  it('bounds a fetch promise that ignores abort forever', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let result: FrozenNodeSourceResult | undefined;
    void read(() => { calls++; return new Promise<Response>(() => {}); }).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(2500);
    expect(result?.kind).toBe('unavailable');
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a read promise that ignores abort forever and releases its reader', async () => {
    vi.useFakeTimers();
    let cancels = 0, releases = 0;
    const { response } = fakeResponse();
    Object.defineProperty(response, 'body', { value: { getReader: () => ({
      read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
      cancel: () => { cancels++; return Promise.resolve(); },
      releaseLock: () => { releases++; },
    }) } });
    let result: FrozenNodeSourceResult | undefined;
    void read(() => Promise.resolve(response)).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(2500);
    expect(result?.kind).toBe('unavailable');
    expect(cancels).toBe(1);
    expect(releases).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not await unread-body cancellation that ignores abort forever', async () => {
    vi.useFakeTimers();
    const { response } = fakeResponse({ redirected: true });
    Object.defineProperty(response, 'body', { value: { cancel: () => new Promise<void>(() => {}) } });
    let result: FrozenNodeSourceResult | undefined;
    void read(() => Promise.resolve(response)).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(2500);
    expect(result?.kind).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not await reader cancellation that never settles on oversize', async () => {
    vi.useFakeTimers();
    let releases = 0;
    const { response } = fakeResponse();
    Object.defineProperty(response, 'body', { value: { getReader: () => ({
      read: () => Promise.resolve({ done: false, value: new Uint8Array(FROZEN_NODE_MAX_SOURCE_BYTES + 1) }),
      cancel: () => new Promise<void>(() => {}),
      releaseLock: () => { releases++; },
    }) } });
    let result: FrozenNodeSourceResult | undefined;
    void read(() => Promise.resolve(response)).then(value => { result = value; });
    await vi.advanceTimersByTimeAsync(2500);
    expect(result?.kind).toBe('unavailable');
    expect(releases).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('withholds after caller abort and cancels a fetch response fulfilled later', async () => {
    const caller = new AbortController();
    const { response, harness } = fakeResponse({ chunks: [textChunk('{}')] });
    let resolve!: (response: Response) => void;
    const pending = read(() => new Promise<Response>(done => { resolve = done; }), { signal: caller.signal });
    caller.abort(); resolve(response);
    expect((await pending).kind).toBe('unavailable');
    await Promise.resolve();
    expect(harness.state.cancels).toBe(1);
    expect(harness.state.reads).toBe(0);
  });

  it('withholds when an ignoring stream fulfills its pending read after caller abort', async () => {
    const caller = new AbortController();
    const { response } = fakeResponse();
    let resolve!: (step: ReadableStreamReadResult<Uint8Array>) => void;
    let reads = 0, cancels = 0, releases = 0;
    Object.defineProperty(response, 'body', { value: { getReader: () => ({
      read: () => ++reads === 1 ? new Promise<ReadableStreamReadResult<Uint8Array>>(done => { resolve = done; }) : Promise.resolve({ done: true }),
      cancel: () => { cancels++; return Promise.resolve(); },
      releaseLock: () => { releases++; },
    }) } });
    const pending = read(() => Promise.resolve(response), { signal: caller.signal });
    await flush(); caller.abort(); resolve({ done: false, value: textChunk('{}') });
    expect((await pending).kind).toBe('unavailable');
    expect(reads).toBe(1);
    expect(cancels).toBe(1);
    expect(releases).toBe(1);
  });
});

describe('real streamed byte boundaries', () => {
  it('counts actual Uint8Array bytes crossing 8MiB despite a false-small header', async () => {
    let index = 0, cancels = 0;
    const chunks = [new Uint8Array(FROZEN_NODE_MAX_SOURCE_BYTES), new Uint8Array(1)];
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); },
      cancel() { cancels++; },
    }), { headers: { 'content-length': '2' } });
    Object.defineProperty(response, 'url', { value: URL });
    const result = await read(() => Promise.resolve(response));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toContain('bound');
    expect(cancels).toBe(1);
  });

  it('decodes actual streamed UTF8 JSON without a response convenience fallback', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(textChunk('{"label":"標的"}')); controller.close(); },
    }));
    Object.defineProperty(response, 'url', { value: URL });
    const result = await read(() => Promise.resolve(response));
    expect(result.kind).toBe('data');
    if (result.kind === 'data') expect(result.raw).toEqual({ label: '標的' });
  });

  it('refuses a terminal newline in advertised length', async () => {
    const { response, harness } = fakeResponse({ headers: { 'content-length': '2\n' }, chunks: [textChunk('{}')] });
    expect((await read(fetcherReturning(response, harness))).kind).toBe('unavailable');
    expect(harness.state.reads).toBe(0);
  });
});


describe('await-continuation and monotonic-deadline regressions', () => {
  it('cancels an unread response when abort wins after fetch fulfillment but before await continuation', async () => {
    const caller = new AbortController();
    const { response, harness } = fakeResponse({ chunks: [textChunk('{}')] });
    const pending = read(() => {
      const fetched = Promise.resolve(response);
      void fetched.then(() => queueMicrotask(() => caller.abort()));
      return fetched;
    }, { signal: caller.signal });
    expect((await pending).kind).toBe('unavailable');
    expect(harness.state.cancels).toBe(1);
    expect(harness.state.reads).toBe(0);
  });

  it('checks monotonic elapsed time even when immediate zero-byte reads starve timers', async () => {
    vi.useFakeTimers();
    let clock = 0, reads = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      const { response } = fakeResponse();
      Object.defineProperty(response, 'body', { value: { getReader: () => ({
        read: () => {
          reads++; clock += 1000;
          return Promise.resolve(reads < 10 ? { done: false, value: new Uint8Array(0) }
            : reads === 10 ? { done: false, value: textChunk('{}') } : { done: true });
        },
        cancel: () => Promise.resolve(), releaseLock: () => {},
      }) } });
      expect((await read(() => Promise.resolve(response))).kind).toBe('unavailable');
      expect(reads).toBeLessThan(10);
    } finally { spy.mockRestore(); }
  });
});

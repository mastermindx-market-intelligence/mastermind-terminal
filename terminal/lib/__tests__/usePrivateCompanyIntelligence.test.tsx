// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountIdentity } from '@/lib/accountIdentity';
import { decodePrivateCompanyContext } from '@/lib/companyIntelligencePrivate';
import type { PrivateCompanyViewState } from '@/lib/companyIntelligencePrivateView';
import { usePrivateCompanyIntelligence } from '@/lib/usePrivateCompanyIntelligence';
import CompanyIntelligencePrivate from '@/components/fin/CompanyIntelligencePrivate';

// Localization is an ambient host input; the real hook, wrapper, presenter and decoders run.
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The receipt fixture bytes were serialized independently in Python (sorted keys,
// compact separators, no ASCII escaping): 629 bytes, SHA-256 starting b94c.
const PYTHON_RECEIPT_BYTES = 629;
const PYTHON_RECEIPT_SHA = 'b94c988b5b1463c0e57f8d83b74be7f87fc4715efa418470fcf5e1f74fedce90';
const RECEIPT_SCHEMA = 'company_intelligence.current_issuer_identity/v1';
const CONTEXT_SCHEMA = 'company_intelligence.private_company_context/v1';
const SELECTIONS_SCHEMA = 'company_intelligence.private_issuer_selections/v1';
const PRODUCT_SCHEMA = 'company_intelligence.private_product_integration/v2';
const ERROR_SCHEMA = 'company_intelligence.private_error/v1';
const FACT_SCHEMA = 'company_intelligence.product_integration_fact/v1';
const EDITION_SCHEMA = 'company_intelligence.issuer_disclosure_edition/v1';
const CONTEXT_ISSUER = 'ISS:US-XNAS-TEST';
const OTHER_ISSUER = 'ISS:US-XNAS-OTHER';
const HASH_A = 'a'.repeat(64);
const HASH_E = 'e'.repeat(64);
const GENERATION = 'gen-2026-10-11';

const OWNER_A: AccountIdentity = { kind: 'account', userId: 'user-aaa', email: 'a@one.example' };
const GUEST: AccountIdentity = { kind: 'guest' };

const CONTEXT_URL = (symbol: string): string =>
  '/api/company-intelligence/private/company-context?symbol=' + encodeURIComponent(symbol);
const SELECTIONS_URL = (issuer: string): string =>
  '/api/company-intelligence/private/issuers/' + encodeURIComponent(issuer) + '/product-integrations';
const FACT_URL = (factId: string): string =>
  '/api/company-intelligence/private/product-integrations/' + encodeURIComponent(factId);

function canonicalJson(value: Record<string, unknown>): string {
  return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + encode(value[key]))
    .join(',') + '}';
}

function encode(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return canonicalJson(value as Record<string, unknown>);
  }
  return JSON.stringify(value);
}

function receiptBody(issuerId: string): Record<string, unknown> {
  return {
    schema: RECEIPT_SCHEMA, identity_mode: 'current',
    issuer_id: issuerId, evidenced_cik: '0000000001', source_commit: 'b'.repeat(40),
    sources: {
      security_master: { sha256: '1'.repeat(64), byte_length: 512 },
      vendor_aliases: { sha256: '2'.repeat(64), byte_length: 512 },
      issuer_master: { sha256: '3'.repeat(64), byte_length: 512 },
    },
    evidence_source: 'sec_company_tickers', evidence_snapshot: '2026-10-10',
  };
}

function receiptReference(issuerId: string): { sha: string; length: number } {
  const bytes = Buffer.from(canonicalJson(receiptBody(issuerId)), 'utf8');
  return { sha: createHash('sha256').update(bytes).digest('hex'), length: bytes.length };
}

function contextFixture(symbol = 'GOOG', issuerId = CONTEXT_ISSUER): unknown {
  const mic = issuerId === CONTEXT_ISSUER ? 'XNAS' : issuerId === OTHER_ISSUER ? 'XNAS' : 'XNYS';
  const reference = receiptReference(issuerId);
  return {
    schema: CONTEXT_SCHEMA, identity_mode: 'current',
    query: { namespace: 'store', symbol },
    security_id: 'SEC:US-' + mic + '-' + symbol,
    issuer_binding: {
      issuer_id: issuerId, evidenced_cik: '0000000001',
      identity_snapshot_reference: { schema: RECEIPT_SCHEMA, sha256: reference.sha, byte_length: reference.length },
    },
    identity_receipt: receiptBody(issuerId),
  };
}

function factIdAt(index: number): string {
  return 'integration:' + index.toString(16).padStart(64, '0');
}

function selectionEntryFixture(factId: string): Record<string, unknown> {
  return {
    fact_id: factId,
    fact_reference: { schema: FACT_SCHEMA, sha256: HASH_A, byte_length: 512 },
    edition_reference: { schema: EDITION_SCHEMA, sha256: HASH_E, byte_length: 480 },
    kind: 'product_integration', lifecycle: 'planned',
  };
}

function selectionsFixture(issuerBinding: unknown, entries: readonly Record<string, unknown>[], generation = GENERATION): Record<string, unknown> {
  return {
    schema: SELECTIONS_SCHEMA, generation, identity_mode: 'current',
    issuer_role: 'subject_disclosing_company',
    issuer_binding: JSON.parse(JSON.stringify(issuerBinding)) as unknown,
    selections: [...entries],
  };
}

function factFixture(factId: string, subjectId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: PRODUCT_SCHEMA,
    fact: {
      fact_id: factId, kind: 'product_integration', lifecycle: 'planned',
      subject_id: subjectId, revision: 3, product: 'HBM3e memory module', platform: 'Vera Rubin NVL144',
      ...fields,
    },
    reference: { schema: FACT_SCHEMA, sha256: HASH_A, byte_length: 512 },
    edition: { schema: EDITION_SCHEMA, sha256: HASH_E, byte_length: 480 },
    source_timing: { published_date: '2024-02-26', published_at: null, publication_precision: 'date', known_at: '2024-02-26T09:05:30.123456+08:00' },
    generation: GENERATION, authority: 'context_only',
  };
}

function errorPayload(code: string): Record<string, unknown> {
  return { schema: ERROR_SCHEMA, code, automatic_retry_permitted: false };
}

interface ChainFixture {
  readonly symbol: string;
  readonly issuerId: string;
  readonly context: unknown;
  readonly selections: unknown;
  readonly facts: Map<string, unknown>;
  readonly ids: string[];
  readonly chosen: string;
}

async function happyFixtures(symbol = 'GOOG', entryCount = 1, issuerId = CONTEXT_ISSUER, idBase = 0): Promise<ChainFixture> {
  const context = contextFixture(symbol, issuerId);
  const decoded = await decodePrivateCompanyContext(JSON.parse(JSON.stringify(context)), symbol);
  const ids = Array.from({ length: entryCount }, (_unused, index) => factIdAt(index + 1 + idBase));
  const entries = ids.map(selectionEntryFixture);
  const selections = selectionsFixture(decoded.issuer_binding, entries);
  const facts = new Map<string, unknown>();
  ids.forEach((id, index) => facts.set(id, factFixture(id, decoded.issuer_binding.issuer_id, {
    product: 'HBM3e memory module ' + String(index + 1),
  })));
  return { symbol, issuerId, context, selections, facts, ids, chosen: ids[0] };
}

interface Deferred { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void; }

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface RouteState { cancelled: boolean; reads: number; }

function jsonResponse(
  status: number,
  value: unknown,
  options: { declared?: string | null; chunks?: number; hang?: boolean; raw?: string } = {},
): { response: unknown; state: RouteState } {
  const state: RouteState = { cancelled: false, reads: 0 };
  const bytes = new TextEncoder().encode(options.raw !== undefined ? options.raw : JSON.stringify(value));
  const size = options.chunks === undefined ? 4096 : options.chunks;
  const declared = options.declared === undefined ? String(bytes.length) : options.declared;
  const reader = () => {
    let index = 0;
    return {
      read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (options.hang === true) return await new Promise(() => {});
        state.reads += 1;
        if (index >= bytes.length) return { done: true };
        const end = Math.min(index + size, bytes.length);
        const chunk = bytes.slice(index, end);
        index = end;
        return { done: false, value: chunk };
      },
      cancel: async (): Promise<void> => { state.cancelled = true; },
    };
  };
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? declared : null) },
    body: { getReader: reader },
  };
  return { response, state };
}

type Responder = (url: string, init: RequestInit) => unknown;

let fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let abortSignals: AbortSignal[] = [];
let responder: Responder | null = null;
const mounted: Harness[] = [];

function wireAbort(signal: AbortSignal | null | undefined, gate: Deferred): void {
  if (!signal) return;
  const fail = (): void => gate.reject(new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) fail();
  else signal.addEventListener('abort', fail, { once: true });
}

function installFetch(): void {
  fetchCalls = [];
  abortSignals = [];
  responder = null;
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const requestInit = init ?? {};
    fetchCalls.push({ url, init: requestInit });
    if (requestInit.signal) abortSignals.push(requestInit.signal);
    if (responder === null) throw new Error('unplanned request ' + url);
    return await responder(url, requestInit);
  }));
}

function routeTable(table: Record<string, () => unknown>): Responder {
  return (url) => {
    const handler = table[url];
    if (handler === undefined) throw new Error('unplanned request ' + url);
    return handler();
  };
}

function chainRoutes(
  fx: ChainFixture,
  gates: { context?: Deferred; selections?: Deferred; fact?: Deferred } = {},
  bodies: { context?: unknown; selections?: unknown; fact?: unknown } = {},
): Responder {
  const table: Record<string, () => unknown> = {};
  table[CONTEXT_URL(fx.symbol)] = () => (gates.context
    ? gates.context.promise
    : jsonResponse(200, bodies.context === undefined ? fx.context : bodies.context).response);
  table[SELECTIONS_URL(fx.issuerId)] = () => (gates.selections
    ? gates.selections.promise
    : jsonResponse(200, bodies.selections === undefined ? fx.selections : bodies.selections).response);
  for (const id of fx.ids) {
    table[FACT_URL(id)] = () => (gates.fact
      ? gates.fact.promise
      : jsonResponse(200, bodies.fact === undefined ? fx.facts.get(id) : bodies.fact).response);
  }
  return routeTable(table);
}

interface MountProps { identity: AccountIdentity; symbol: string | null; enabled: boolean; }

interface Harness {
  readonly states: PrivateCompanyViewState[];
  readonly renderTrace: Array<{ status: string; fetches: number; signals: number }>;
  last(): PrivateCompanyViewState;
  set(next: Partial<MountProps>): void;
  select(factId: string): void;
  selectWith(callbackIndex: number, factId: string): void;
  unmount(): void;
}

function mountHarness(initial: { identity: AccountIdentity; symbol: string | null; enabled?: boolean }, strict = false): Harness {
  const props: MountProps = { identity: initial.identity, symbol: initial.symbol, enabled: initial.enabled === undefined ? true : initial.enabled };
  const states: PrivateCompanyViewState[] = [];
  const renderTrace: Harness['renderTrace'] = [];
  const controllers: Array<{ selectFact: (factId: string) => void }> = [];
  function Host(): null {
    const controller = usePrivateCompanyIntelligence(props.identity, props.symbol, props.enabled);
    states.push(controller.state);
    renderTrace.push({ status: controller.state.status, fetches: fetchCalls.length, signals: abortSignals.length });
    controllers.push(controller);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const element = (tree: React.ReactElement): React.ReactElement => (strict ? React.createElement(React.StrictMode, null, tree) : tree);
  act(() => { root.render(element(React.createElement(Host))); });
  let unmounted = false;
  let currentProps = props;
  const api: Harness = {
    states,
    renderTrace,
    last() { return states[states.length - 1]; },
    set(next) {
      currentProps = { ...currentProps, ...next };
      Object.assign(props, currentProps);
      act(() => { root.render(element(React.createElement(Host))); });
    },
    select(factId) {
      const controller = controllers[controllers.length - 1];
      act(() => { controller.selectFact(factId); });
    },
    selectWith(callbackIndex, factId) {
      const controller = controllers[callbackIndex];
      act(() => { controller.selectFact(factId); });
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      act(() => { root.unmount(); });
      container.remove();
    },
  };
  mounted.push(api);
  return api;
}

// A real WebCrypto digest completes on a thread-pool macrotask, so settling this
// suite must pump both micro- and macrotasks; microtask-only flushing would make the
// chain race the unmount between tests.
async function settle(times = 40): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); });
  }
}

async function advance(fakeMs: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(fakeMs); });
}

function urlsOf(): string[] {
  return fetchCalls.map(call => call.url);
}

beforeEach(() => {
  // jsdom's own crypto lacks the parts this flow needs: provide the real WebCrypto
  // surface so the actual async receipt decoder digest runs.
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    subtle: webcrypto.subtle,
    randomUUID: () => webcrypto.randomUUID(),
  } });
  installFetch();
});

afterEach(() => {
  for (const harness of mounted.splice(0)) harness.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('input gating and passive states', () => {
  it('decodes the independently serialized 629-byte b94 receipt fixture with the real decoder', async () => {
    const bytes = Buffer.from(canonicalJson(receiptBody(CONTEXT_ISSUER)), 'utf8');
    expect(bytes.length).toBe(PYTHON_RECEIPT_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PYTHON_RECEIPT_SHA);
    const decoded = await decodePrivateCompanyContext(JSON.parse(JSON.stringify(contextFixture('GOOG'))), 'GOOG');
    expect(decoded.identity_receipt.issuer_id).toBe(CONTEXT_ISSUER);
    expect(decoded.issuer_binding.identity_snapshot_reference.byte_length).toBe(PYTHON_RECEIPT_BYTES);
  });

  it('renders loading in the pre-effect snapshot, then reads once with the fixed same-origin GET policy', async () => {
    installFetch();
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    expect(harness.renderTrace[0]).toEqual({ status: 'loading', fetches: 0, signals: 0 });
    expect(harness.last().status).toBe('loading');
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe(CONTEXT_URL('GOOG'));
    const init = fetchCalls[0].init;
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['guest', GUEST, 'GOOG', true, 'guest', 'GOOG'],
    ['guest disabled', GUEST, 'GOOG', false, 'guest', 'GOOG'],
    ['account disabled', OWNER_A, 'GOOG', false, 'unselected', 'GOOG'],
    ['null symbol', OWNER_A, null, true, 'unselected', null],
    ['lowercase query', OWNER_A, 'goog', true, 'unsupported', 'goog'],
    ['padded query', OWNER_A, 'MU ', true, 'unsupported', 'MU '],
    ['caret index', OWNER_A, '^NDX', true, 'unsupported', '^NDX'],
    ['slash alias', OWNER_A, 'A/B', true, 'unsupported', 'A/B'],
    ['25 characters', OWNER_A, 'A'.repeat(25), true, 'unsupported', 'A'.repeat(25)],
  ])('keeps %s passive with no fetch and the supplied query echoed', async (_label, identity, symbol, enabled, status, query) => {
    installFetch();
    const harness = mountHarness({ identity, symbol, enabled });
    expect(harness.renderTrace.length).toBe(1);
    expect(harness.renderTrace.every(entry => entry.fetches === 0 && entry.signals === 0)).toBe(true);
    expect(fetchCalls.length).toBe(0);
    const view = harness.last();
    expect(Object.keys(view).sort()).toEqual(['query', 'status', 'viewKey']);
    expect(view.status).toBe(status);
    expect(view.query).toBe(query);
    expect(view.viewKey).toMatch(/^pki-[0-9]+$/);
  });

  it('moves guest to a fresh owner read only when the identity actually changes', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: GUEST, symbol: 'GOOG' });
    expect(fetchCalls.length).toBe(0);
    harness.set({ identity: OWNER_A });
    expect(fetchCalls.length).toBe(1);
    await settle();
    expect(harness.last().status).toBe('ready');
  });
});

describe('the three-read chain', () => {
  it('reads context, then selections, then the first selected fact, and publishes READY', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(urlsOf()).toEqual([CONTEXT_URL('GOOG'), SELECTIONS_URL(CONTEXT_ISSUER), FACT_URL(fx.chosen)]);
    const view = harness.last();
    expect(Object.keys(view).sort()).toEqual(['context', 'fact', 'query', 'selectedFactId', 'selection', 'status', 'viewKey']);
    expect(view.status).toBe('ready');
    if (view.status === 'ready') {
      expect(view.query).toBe('GOOG');
      expect(view.selectedFactId).toBe(fx.chosen);
      expect(view.fact.fact.product).toBe('HBM3e memory module 1');
      expect(view.fact.authority).toBe('context_only');
      expect(view.selection.selections).toHaveLength(1);
      expect(view.context.security_id).toBe('SEC:US-XNAS-GOOG');
    }
  });

  it('keeps BRK-B and BRK.B distinct: exact query, no normalization, server alias echo refused', async () => {
    installFetch();
    const dash = await happyFixtures('BRK-B', 1, 'ISS:US-XNYS-BRK-B');
    responder = chainRoutes(dash);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'BRK-B' });
    await settle();
    expect(harness.last().status).toBe('ready');
    expect(urlsOf()[0]).toBe('/api/company-intelligence/private/company-context?symbol=BRK-B');
    expect(urlsOf()[1]).toBe('/api/company-intelligence/private/issuers/' + encodeURIComponent('ISS:US-XNYS-BRK-B') + '/product-integrations');

    installFetch();
    // A BFF that alias-normalizes BRK.B to a BRK-B context echo is a BINDING refusal,
    // never a silent owner-side normalization: no selection request may follow.
    responder = routeTable({
      [CONTEXT_URL('BRK.B')]: () => jsonResponse(200, contextFixture('BRK-B', 'ISS:US-XNYS-BRK-B')).response,
    });
    const dot = mountHarness({ identity: OWNER_A, symbol: 'BRK.B' });
    await settle();
    expect(dot.renderTrace.every(entry => entry.status !== 'ready')).toBe(true);
    expect(dot.last().status).toBe('source_unavailable');
    expect(dot.last().query).toBe('BRK.B');
    expect(fetchCalls.length).toBe(1);

    installFetch();
    responder = routeTable({ [CONTEXT_URL('BRK.B')]: () => jsonResponse(400, errorPayload('REQUEST_INVALID')).response });
    const refused = mountHarness({ identity: OWNER_A, symbol: 'BRK.B' });
    await settle();
    expect(refused.last().status).toBe('unsupported');
    expect(refused.last().query).toBe('BRK.B');
  });

  it('treats a qualified empty generation as empty, not metadata_only, and stops', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG', 0);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(urlsOf()).toEqual([CONTEXT_URL('GOOG'), SELECTIONS_URL(CONTEXT_ISSUER)]);
    expect(harness.last().status).toBe('empty');
    expect(Object.keys(harness.last()).sort()).toEqual(['query', 'status', 'viewKey']);
  });

  it('publishes ready for a fact missing every optional granted field except the composition subject', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const minimal = {
      schema: PRODUCT_SCHEMA,
      fact: { fact_id: fx.chosen, kind: 'product_integration', lifecycle: 'planned', subject_id: CONTEXT_ISSUER },
      reference: { schema: FACT_SCHEMA, sha256: HASH_A, byte_length: 512 },
      edition: { schema: EDITION_SCHEMA, sha256: HASH_E, byte_length: 480 },
    source_timing: { published_date: '2024-02-26', published_at: null, publication_precision: 'date', known_at: '2024-02-26T09:05:30.123456+08:00' },
      generation: GENERATION, authority: 'context_only',
    };
    responder = chainRoutes(fx, {}, { fact: minimal });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    const view = harness.last();
    expect(view.status).toBe('ready');
    if (view.status === 'ready') {
      expect('product' in view.fact.fact).toBe(false);
      expect('platform' in view.fact.fact).toBe(false);
      expect('amount' in view.fact.fact).toBe(false);
    }
  });
});

describe('classification of closed refusals', () => {
  it.each([
    [401, 'AUTHENTICATION_REQUIRED', 'guest'],
    [403, 'ENTITLEMENT_REQUIRED', 'missing_feature'],
    [502, 'AUTHENTICATION_UNAVAILABLE', 'access_unknown'],
    [400, 'REQUEST_INVALID', 'unsupported'],
    [503, 'PRIVATE_SERVICE_UNAVAILABLE', 'source_unavailable'],
    [503, 'GRANT_RETRACTED', 'source_unavailable'],
    [401, 'ENTITLEMENT_REQUIRED', 'source_unavailable'],
    [500, 'SOURCE_NOT_ADMITTED', 'source_unavailable'],
  ])('classifies a context-stage %i %s as %s with exactly one read and no retry', async (status, code, expected) => {
    installFetch();
    responder = routeTable({ [CONTEXT_URL('GOOG')]: () => jsonResponse(status, errorPayload(code)).response });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(fetchCalls.length).toBe(1);
    const view = harness.last();
    expect(view.status).toBe(expected);
    expect(Object.keys(view).sort()).toEqual(['query', 'status', 'viewKey']);
    expect(JSON.stringify(view)).not.toContain(code);
    expect(JSON.stringify(view)).not.toContain('LEAK');
  });

  it('refuses an error payload that is not closed, without misclassifying it', async () => {
    installFetch();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(401, { ...errorPayload('AUTHENTICATION_REQUIRED'), detail: 'LEAKED' }).response,
    });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('source_unavailable');

    installFetch();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(403, { ...errorPayload('ENTITLEMENT_REQUIRED'), automatic_retry_permitted: true }).response,
    });
    const retry = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(retry.last().status).toBe('source_unavailable');
    expect(fetchCalls.length).toBe(1);

    installFetch();
    responder = routeTable({ [CONTEXT_URL('GOOG')]: () => jsonResponse(403, '<html>not json</html>', { raw: '<html>not json</html>' }).response });
    const raw = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(raw.last().status).toBe('source_unavailable');
  });

  it('maps the 503 source trio by stage: before context unavailable, after context metadata_only, at fact unavailable', async () => {
    for (const code of ['SOURCE_NOT_ADMITTED', 'SOURCE_RUNTIME_UNAVAILABLE', 'PRIVATE_SOURCE_UNAVAILABLE']) {
      installFetch();
      responder = routeTable({ [CONTEXT_URL('GOOG')]: () => jsonResponse(503, errorPayload(code)).response });
      const before = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
      await settle();
      expect(before.last().status).toBe('source_unavailable');

      installFetch();
      const fx = await happyFixtures('GOOG');
      responder = routeTable({
        [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response,
        [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(503, errorPayload(code)).response,
      });
      const middle = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
      await settle();
      expect(middle.last().status).toBe('metadata_only');
      expect(urlsOf()).toEqual([CONTEXT_URL('GOOG'), SELECTIONS_URL(CONTEXT_ISSUER)]);

      installFetch();
      responder = routeTable({
        [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response,
        [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(200, fx.selections).response,
        [FACT_URL(fx.chosen)]: () => jsonResponse(503, errorPayload(code)).response,
      });
      const last = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
      await settle();
      expect(last.last().status).toBe('source_unavailable');
      expect(urlsOf()).toHaveLength(3);
    }
  });

  it('reports selection_changed only for context/selection binding and selection/fact drift', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const driftedCik = JSON.parse(JSON.stringify(fx.selections)) as { issuer_binding: { evidenced_cik: string } };
    driftedCik.issuer_binding.evidenced_cik = '0000000002';
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response,
      [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(200, driftedCik).response,
    });
    const cikDrift = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(cikDrift.last().status).toBe('selection_changed');
    expect(urlsOf()).toHaveLength(2);

    installFetch();
    const foreign = JSON.parse(JSON.stringify(fx.selections)) as { issuer_binding: { issuer_id: string } };
    foreign.issuer_binding.issuer_id = OTHER_ISSUER;
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response,
      [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(200, foreign).response,
      [SELECTIONS_URL(OTHER_ISSUER)]: () => jsonResponse(200, fx.selections).response,
    });
    const otherIssuer = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(otherIssuer.last().status).toBe('selection_changed');
    expect(urlsOf()).toEqual([CONTEXT_URL('GOOG'), SELECTIONS_URL(CONTEXT_ISSUER)]);

    installFetch();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response,
      [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(200, fx.selections).response,
      [FACT_URL(fx.chosen)]: () => jsonResponse(200, {
        ...(factFixture(fx.chosen, CONTEXT_ISSUER) as Record<string, unknown>), generation: 'gen-2026-10-09',
      }).response,
    });
    const staleGeneration = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(staleGeneration.last().status).toBe('selection_changed');

    installFetch();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response,
      [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(200, fx.selections).response,
      [FACT_URL(fx.chosen)]: () => jsonResponse(200, factFixture(fx.chosen, OTHER_ISSUER)).response,
    });
    const counterparty = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(counterparty.last().status).toBe('selection_changed');

    installFetch();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response,
      [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(200, { ...(fx.selections as object), reviewer_note: 'LEAKED' }).response,
    });
    const malformed = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(malformed.last().status).toBe('source_unavailable');

    installFetch();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(200, contextFixture('GOOGL')).response,
    });
    const echoMismatch = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(echoMismatch.last().status).toBe('source_unavailable');
    expect(echoMismatch.last().query).toBe('GOOG');
  });

  it('maps any raw transport failure to source_unavailable, once, terminal', async () => {
    installFetch();
    responder = () => { throw new Error('network down LEAKED'); };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(fetchCalls.length).toBe(1);
    expect(harness.last().status).toBe('source_unavailable');
    expect(JSON.stringify(harness.last())).not.toContain('LEAKED');
    await settle();
    expect(fetchCalls.length).toBe(1);
  });
});

describe('bounded streamed responses', () => {
  it('refuses early on a declared Content-Length above 32768 without touching the body', async () => {
    installFetch();
    let bodyReads = 0;
    let cancelled = false;
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => {
        const built = jsonResponse(200, { blob: 'x'.repeat(40000) }, { declared: '40000' });
        const original = (built.response as { body: { getReader: () => { read: () => Promise<unknown>; cancel: () => Promise<void> } } }).body.getReader;
        (built.response as { body: { getReader: () => { read: () => Promise<unknown>; cancel: () => Promise<void> } } }).body.getReader = () => {
          const reader = original();
          return {
            read: async () => { bodyReads += 1; return reader.read(); },
            cancel: async () => { cancelled = true; return reader.cancel(); },
          };
        };
        return built.response;
      },
    });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('source_unavailable');
    expect(bodyReads).toBe(0);
    expect(cancelled).toBe(false);
    expect(fetchCalls.length).toBe(1);
  });

  it('refuses a streamed body that exceeds 32768 bytes incrementally and cancels', async () => {
    installFetch();
    const built = jsonResponse(200, { blob: 'x'.repeat(40000) }, { declared: null, chunks: 8192 });
    responder = routeTable({ [CONTEXT_URL('GOOG')]: () => built.response });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('source_unavailable');
    expect(built.state.cancelled).toBe(true);
    expect(built.state.reads).toBeLessThanOrEqual(5);
  });

  it('bounds error bodies the same way', async () => {
    installFetch();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => jsonResponse(401, errorPayload('AUTHENTICATION_REQUIRED'), { declared: '70000' }).response,
    });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('source_unavailable');
  });
});

describe('publication guards under ABA replacement', () => {
  it('drops a stale context continuation (and its late error) when the query goes A -> B -> A', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const fxB = await happyFixtures('NVDA', 1, OTHER_ISSUER);
    const gates: Deferred[] = [];
    responder = (url) => {
      if (url === CONTEXT_URL('GOOG') || url === CONTEXT_URL('NVDA')) {
        const gate = deferred(); // ignores abort: proves the guards alone are sufficient
        gates.push(gate);
        return gate.promise;
      }
      if (url === SELECTIONS_URL(CONTEXT_ISSUER)) return jsonResponse(200, fx.selections).response;
      if (url === SELECTIONS_URL(OTHER_ISSUER)) return jsonResponse(200, fxB.selections).response;
      if (url === FACT_URL(fx.chosen)) return jsonResponse(200, fx.facts.get(fx.chosen)).response;
      throw new Error('unplanned request ' + url);
    };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    harness.set({ symbol: 'NVDA' });
    harness.set({ symbol: 'GOOG' });
    expect(gates.length).toBe(3);
    expect(harness.last().status).toBe('loading');
    // Stage-one late resolution of the first chain must publish nothing and open no
    // selection read: the second A is the only live lane.
    gates[0].reject(new Error('stale late error')); // stale error path
    await settle();
    expect(harness.last().status).toBe('loading');
    expect(urlsOf().filter(u => u.includes('/issuers/'))).toHaveLength(0);
    gates[0].resolve(jsonResponse(200, fx.context).response); // stale success path
    await settle();
    expect(harness.last().status).toBe('loading');
    expect(urlsOf().filter(u => u.includes('/issuers/'))).toHaveLength(0);
    gates[2].resolve(jsonResponse(200, fx.context).response);
    await settle();
    expect(harness.last().status).toBe('ready');
    expect(harness.last().query).toBe('GOOG');
    expect(urlsOf().filter(u => u.includes('/issuers/'))).toEqual([SELECTIONS_URL(CONTEXT_ISSUER)]);
    expect(harness.renderTrace.slice(1, 4).every(entry => entry.status === 'loading')).toBe(true);
  });

  it('drops a late selection answer after the lane moved on', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const fxB = await happyFixtures('NVDA', 1, OTHER_ISSUER, 100);
    const selectionsGate = deferred();
    responder = (url) => {
      if (url === CONTEXT_URL('GOOG')) return jsonResponse(200, fx.context).response;
      if (url === CONTEXT_URL('NVDA')) return jsonResponse(200, fxB.context).response;
      if (url === SELECTIONS_URL(CONTEXT_ISSUER)) return selectionsGate.promise;
      if (url === SELECTIONS_URL(OTHER_ISSUER)) return jsonResponse(200, fxB.selections).response;
      if (url === FACT_URL(fxB.chosen)) return jsonResponse(200, fxB.facts.get(fxB.chosen)).response;
      throw new Error('unplanned request ' + url);
    };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    harness.set({ symbol: 'NVDA' });
    await settle();
    expect(harness.last().status).toBe('ready');
    selectionsGate.resolve(jsonResponse(200, fx.selections).response);
    await settle(20);
    expect(harness.last().status).toBe('ready');
    expect((harness.last() as { query: string | null }).query).toBe('NVDA');
    expect(urlsOf().filter(u => u === FACT_URL(fx.chosen))).toHaveLength(0);
  });

  it('drops a stale asynchronous receipt digest that finishes after the owner moved on', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const fxB = await happyFixtures('NVDA', 1, OTHER_ISSUER, 100);
    const digests: Deferred[] = [];
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      subtle: { digest: (algorithm: string, data: BufferSource) => {
        const source = new Uint8Array((data as Uint8Array).byteLength);
        source.set(data as Uint8Array);
        const gate = deferred();
        digests.push(gate);
        return gate.promise.then(() => webcrypto.subtle.digest(algorithm, source));
      } },
    } });
    responder = (url) => {
      if (url === CONTEXT_URL('GOOG')) return jsonResponse(200, fx.context).response;
      if (url === CONTEXT_URL('NVDA')) return jsonResponse(200, fxB.context).response;
      if (url === SELECTIONS_URL(OTHER_ISSUER)) return jsonResponse(200, fxB.selections).response;
      if (url === FACT_URL(fxB.chosen)) return jsonResponse(200, fxB.facts.get(fxB.chosen)).response;
      throw new Error('unplanned request ' + url);
    };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(digests.length).toBe(1);
    harness.set({ symbol: 'NVDA' });
    await settle();
    expect(digests.length).toBe(2);
    digests[1].resolve(undefined); // the new owner's digest completes first
    await settle();
    expect(harness.last().status).toBe('ready');
    digests[0].resolve(undefined); // the old lifetime's digest completes late
    await settle(20);
    expect(harness.last().status).toBe('ready');
    expect(urlsOf().filter(u => u === SELECTIONS_URL(CONTEXT_ISSUER))).toHaveLength(0);
  });

  it('a stale fact-stage error or a stale timeout finalizer cannot downgrade the newer lane', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const fxB = await happyFixtures('NVDA', 1, OTHER_ISSUER, 100);
    const factGate = deferred(); // never resolves: its timeout finalizer runs late
    responder = (url) => {
      if (url === CONTEXT_URL('GOOG')) return jsonResponse(200, fx.context).response;
      if (url === CONTEXT_URL('NVDA')) return jsonResponse(200, fxB.context).response;
      if (url === SELECTIONS_URL(CONTEXT_ISSUER)) return jsonResponse(200, fx.selections).response;
      if (url === SELECTIONS_URL(OTHER_ISSUER)) return jsonResponse(200, fxB.selections).response;
      if (url === FACT_URL(fx.chosen)) return factGate.promise;
      if (url === FACT_URL(fxB.chosen)) return jsonResponse(200, fxB.facts.get(fxB.chosen)).response;
      throw new Error('unplanned request ' + url);
    };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    harness.set({ symbol: 'NVDA' });
    await settle();
    expect(harness.last().status).toBe('ready');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await advance(11_000); // the abandoned first-chain fact deadline fires now
    vi.useRealTimers();
    await settle(10);
    expect(harness.last().status).toBe('ready');
    expect((harness.last() as { query: string | null }).query).toBe('NVDA');
    factGate.resolve(jsonResponse(503, errorPayload('PRIVATE_SERVICE_UNAVAILABLE')).response);
    await settle(20);
    expect(harness.last().status).toBe('ready');
  });
});

describe('selection is bound to the current decoded options', () => {
  it('resets synchronously to selecting with no old fact, then composes the newly chosen fact', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG', 2);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('ready');
    const readyBefore = harness.last();
    if (readyBefore.status !== 'ready') throw new Error('unreachable');
    harness.select(fx.ids[1]);
    const selecting = harness.last();
    expect(Object.keys(selecting).sort()).toEqual(['context', 'query', 'selectedFactId', 'selection', 'status', 'viewKey']);
    expect(selecting.status).toBe('selecting');
    if (selecting.status === 'selecting') {
      expect(selecting.selectedFactId).toBe(fx.ids[1]);
      expect(selecting.context).toBe(readyBefore.context);
      expect(selecting.selection).toBe(readyBefore.selection);
      expect(selecting.viewKey).not.toBe(readyBefore.viewKey);
    }
    await settle();
    const readyAfter = harness.last();
    expect(readyAfter.status).toBe('ready');
    if (readyAfter.status === 'ready') {
      expect(readyAfter.fact.fact.product).toBe('HBM3e memory module 2');
      expect(readyAfter.selectedFactId).toBe(fx.ids[1]);
    }
    expect(urlsOf()).toContain(FACT_URL(fx.ids[1]));
    // Selecting again is an explicit ordinary input transition: one new fact read.
    const before = fetchCalls.length;
    harness.select(fx.ids[0]);
    await settle();
    expect(harness.last().status).toBe('ready');
    expect(fetchCalls.length).toBe(before + 1);
    if (harness.last().status === 'ready') {
      expect((harness.last() as { selectedFactId: string }).selectedFactId).toBe(fx.ids[0]);
    }
  });

  it('ignores arbitrary, injected, wrong-species and stale-render selection callbacks', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG', 1);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    const readyView = harness.last();
    const callsBefore = fetchCalls.length;
    harness.select('integration:' + 'f'.repeat(64)); // injected current-shape but not selected
    harness.select(fx.ids[0] + 'x'); // arbitrary malformed id
    harness.select('');
    expect(harness.last()).toBe(readyView);
    expect(fetchCalls.length).toBe(callsBefore);
  });

  it('ignores a callback captured by an older render once that lane is gone', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('ready');
    const staleIndex = harness.renderTrace.length - 1;
    const gates: Deferred[] = [];
    responder = (url, init) => {
      if (url === CONTEXT_URL('GOOG') || url === CONTEXT_URL('NVDA')) {
        const gate = deferred();
        wireAbort(init.signal, gate);
        gates.push(gate);
        return gate.promise;
      }
      throw new Error('unplanned request ' + url);
    };
    harness.set({ symbol: 'NVDA' });
    harness.set({ symbol: 'GOOG' });
    expect(harness.last().status).toBe('loading');
    const callsBefore = fetchCalls.length;
    // The old render's callback carries the same A inputs, but the fresh A lane has no
    // selection epoch yet: the callback must be inert until the reload republishes one.
    harness.selectWith(staleIndex, fx.chosen);
    expect(fetchCalls.length).toBe(callsBefore);
    expect(harness.last().status).toBe('loading');
  });

  it('ignores selection attempts while no current selection exists', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG', 0);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('empty');
    const callsBefore = fetchCalls.length;
    harness.select(factIdAt(1));
    expect(fetchCalls.length).toBe(callsBefore);
    expect(harness.last().status).toBe('empty');
  });
});

describe('identity and query transitions', () => {
  it('keeps the projection for the same UUID with a changed email and issues no second read', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('ready');
    const before = fetchCalls.length;
    harness.set({ identity: { kind: 'account', userId: 'user-aaa', email: 'renamed@two.example' } });
    expect(harness.last().status).toBe('ready');
    expect(fetchCalls.length).toBe(before);
    await settle();
    expect(fetchCalls.length).toBe(before);
  });

  it('clears the old fact synchronously at the render snapshot for the same email with a new UUID', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('ready');
    const boundary = harness.renderTrace.length;
    const fetchesBefore = fetchCalls.length;
    harness.set({ identity: { kind: 'account', userId: 'user-bbb', email: 'a@one.example' } });
    // The pre-derivation pass is discarded before commit; every render shown from the
    // committed pass on hides the old fact synchronously, before any new publish.
    const afterSwitch = harness.renderTrace.slice(boundary);
    expect(afterSwitch[afterSwitch.length - 1].status).toBe('loading');
    expect(harness.renderTrace.slice(boundary).every(entry => entry.status !== 'ready')).toBe(true);
    expect(harness.last().status).toBe('loading');
    expect(fetchCalls.length).toBe(fetchesBefore + 1);
    await settle();
    expect(harness.last().status).toBe('ready');
  });

  it('drops the projection synchronously when the query clears and re-reads only on the explicit return', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('ready');
    const boundary = harness.renderTrace.length;
    harness.set({ symbol: null });
    expect(harness.last().status).toBe('unselected');
    expect(harness.renderTrace.slice(boundary).every(entry => entry.status !== 'ready')).toBe(true);
    const before = fetchCalls.length;
    harness.set({ symbol: 'GOOG' });
    expect(fetchCalls.length).toBe(before + 1);
    await settle();
    expect(harness.last().status).toBe('ready');
  });

  it('disabling during a read hides synchronously and cancels the owned transport', async () => {
    installFetch();
    const gate = deferred();
    responder = (url, init) => {
      if (url === CONTEXT_URL('GOOG')) {
        wireAbort(init.signal, gate);
        return gate.promise;
      }
      throw new Error('unplanned request ' + url);
    };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    const boundary = harness.renderTrace.length;
    harness.set({ enabled: false });
    expect(harness.last().status).toBe('unselected');
    expect(harness.renderTrace.slice(boundary).every(entry => entry.status !== 'ready' && entry.status !== 'selecting')).toBe(true);
    expect(abortSignals[0].aborted).toBe(true);
    gate.resolve(jsonResponse(200, (await happyFixtures('GOOG')).context).response);
    await settle();
    expect(harness.last().status).toBe('unselected');
    expect(fetchCalls.length).toBe(1);
  });
});

describe('mount lifetime and finite deadlines', () => {
  it('unmounting cancels owned work; a late completion publishes nothing; remounting reads fresh', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const gates: Deferred[] = [];
    responder = (url, init) => {
      if (url === CONTEXT_URL('GOOG')) {
        const gate = deferred();
        wireAbort(init.signal, gate);
        gates.push(gate);
        return gate.promise;
      }
      throw new Error('unplanned request ' + url);
    };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    const statesAtUnount = harness.states.length;
    harness.unmount();
    expect(abortSignals[0].aborted).toBe(true);
    responder = chainRoutes(fx);
    gates[0].resolve(jsonResponse(200, fx.context).response);
    await settle(20);
    expect(harness.states.length).toBe(statesAtUnount);
    const second = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(second.last().status).toBe('ready');
  });

  it('StrictMode simulated remount does not publish the first lifetime and keeps one READY', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const gates: Deferred[] = [];
    responder = (url, init) => {
      if (url === CONTEXT_URL('GOOG')) {
        const gate = deferred();
        wireAbort(init.signal, gate);
        gates.push(gate);
        return gate.promise;
      }
      if (url === SELECTIONS_URL(CONTEXT_ISSUER)) return jsonResponse(200, fx.selections).response;
      if (url === FACT_URL(fx.chosen)) return jsonResponse(200, fx.facts.get(fx.chosen)).response;
      throw new Error('unplanned request ' + url);
    };
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' }, true);
    await settle();
    expect(gates.length).toBe(2);
    expect(abortSignals[0].aborted).toBe(true);
    gates[1].resolve(jsonResponse(200, fx.context).response);
    await settle();
    expect(harness.last().status).toBe('ready');
    const readyKeys = new Set(harness.states.filter(state => state.status === 'ready').map(state => state.viewKey));
    expect(readyKeys.size).toBe(1);
  });

  it('settles a never-resolving fetch to source_unavailable at the finite 10-second deadline, exactly once', async () => {
    installFetch();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    responder = () => new Promise(() => {});
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await advance(9_000);
    expect(harness.last().status).toBe('loading');
    await advance(1_500);
    expect(harness.last().status).toBe('source_unavailable');
    expect(fetchCalls.length).toBe(1);
    await advance(60_000);
    expect(fetchCalls.length).toBe(1);
    expect(harness.last().status).toBe('source_unavailable');
  });

  it('settles a never-resolving asynchronous digest within the bounded context chain', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      subtle: { digest: () => new Promise(() => {}) },
    } });
    responder = routeTable({ [CONTEXT_URL('GOOG')]: () => jsonResponse(200, fx.context).response });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await advance(9_000);
    expect(harness.last().status).toBe('loading');
    await advance(1_000);
    expect(harness.last().status).toBe('source_unavailable');
    expect(fetchCalls.length).toBe(1);
  });

  it('a late answer after a terminal timeout cannot revive or retry the lane', async () => {
    installFetch();
    const fx = await happyFixtures('GOOG');
    const late = deferred();
    responder = routeTable({
      [CONTEXT_URL('GOOG')]: () => late.promise,
      [SELECTIONS_URL(CONTEXT_ISSUER)]: () => jsonResponse(200, fx.selections).response,
      [FACT_URL(fx.chosen)]: () => jsonResponse(200, fx.facts.get(fx.chosen)).response,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await advance(10_500);
    const terminalKey = harness.last().viewKey;
    expect(harness.last().status).toBe('source_unavailable');
    late.resolve(jsonResponse(200, fx.context).response);
    await advance(60_000);
    expect(harness.last().status).toBe('source_unavailable');
    expect(harness.last().viewKey).toBe(terminalKey);
    expect(fetchCalls.length).toBe(1);
  });
});

describe('no ambient side channels', () => {
  it('never writes browser storage and only ever requests the fixed private paths', async () => {
    // Node 26 does not expose jsdom storage as a bare global. Supply scoped stores
    // explicitly so unexpected browser storage access is still observable.
    const stores = [new Map<string, string>(), new Map<string, string>()];
    const storage = stores.map(values => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn((key: string) => { values.delete(key); }),
      clear: vi.fn(() => values.clear()),
      get length() { return values.size; },
    }));
    vi.stubGlobal('localStorage', storage[0]);
    vi.stubGlobal('sessionStorage', storage[1]);
    stores.forEach(values => values.set('pki-preexisting', 'keep'));
    installFetch();
    const fx = await happyFixtures('GOOG', 2);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    harness.select(fx.ids[1]);
    await settle();
    expect(harness.last().status).toBe('ready');
    for (const call of fetchCalls) {
      expect(call.url.startsWith('/api/company-intelligence/private/')).toBe(true);
      expect(call.url).not.toContain('public');
      expect(call.url).not.toContain('/api/me');
      expect(call.url).not.toContain('as_of');
      expect(call.url).not.toContain('http:');
      expect(call.url).not.toContain('https:');
    }
    expect(localStorage.getItem('pki-preexisting')).toBe('keep');
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.getItem('pki-preexisting')).toBe('keep');
    expect(sessionStorage.length).toBe(1);
    storage.forEach(store => {
      expect(store.setItem).not.toHaveBeenCalled();
      expect(store.removeItem).not.toHaveBeenCalled();
      expect(store.clear).not.toHaveBeenCalled();
    });
  });
});


describe('independent commissioned lifecycle falsifiers', () => {
  it('uses one 10-second initial budget including a deferred digest and selection', async () => {
    const fx = await happyFixtures();
    const digestGate = deferred();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      subtle: { digest: () => digestGate.promise },
    } });
    const selectionGate = deferred();
    responder = chainRoutes(fx, { selections: selectionGate });
    vi.useFakeTimers();
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await advance(9000);
    await act(async () => { digestGate.resolve(Uint8Array.from(Buffer.from(PYTHON_RECEIPT_SHA, 'hex')).buffer); });
    await advance(1000);
    expect(harness.last().status).toBe('source_unavailable');
    expect(urlsOf()).toEqual([CONTEXT_URL('GOOG'), SELECTIONS_URL(fx.issuerId)]);
  });

  it('bounds a non-cooperating digest itself to the same initial 10-second budget', async () => {
    const fx = await happyFixtures();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      subtle: { digest: () => new Promise(() => {}) },
    } });
    responder = chainRoutes(fx);
    vi.useFakeTimers();
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await advance(10000);
    expect(harness.last().status).toBe('source_unavailable');
    expect(urlsOf()).toEqual([CONTEXT_URL('GOOG')]);
  });

  it('uses a unique selection epoch for fact A -> B -> A even when abort is ignored', async () => {
    const fx = await happyFixtures('GOOG', 2);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('ready');
    const gates = [deferred(), deferred(), deferred()];
    let call = 0;
    responder = () => gates[call++].promise;
    harness.select(fx.ids[1]); harness.select(fx.ids[0]); harness.select(fx.ids[1]);
    await act(async () => { gates[0].reject(new Error('STALE_FACT')); });
    await settle();
    expect(harness.last().status).toBe('selecting');
    await act(async () => { gates[2].resolve(jsonResponse(200, fx.facts.get(fx.ids[1])).response); });
    await settle();
    expect(harness.last().status).toBe('ready');
    const current = harness.last();
    if (current.status === 'ready') expect(current.fact.fact.product).not.toBe('STALE_FACT');
  });

  it('cannot use a captured callback after owner/query ABA has returned to READY', async () => {
    const a = await happyFixtures('GOOG', 2);
    const b = await happyFixtures('NVDA', 2, OTHER_ISSUER, 10);
    responder = chainRoutes(a);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    const captured = harness.states.length - 1;
    responder = chainRoutes(b); harness.set({ symbol: 'NVDA' }); await settle();
    responder = chainRoutes(a); harness.set({ symbol: 'GOOG' }); await settle();
    expect(harness.last().status).toBe('ready');
    const reads = fetchCalls.length;
    harness.selectWith(captured, a.ids[1]);
    await settle();
    expect(fetchCalls.length).toBe(reads);
  });
});


describe('independent committed lifetime and budget boundaries', () => {
  it('keeps guest query changes and null versus empty input distinct without fetching', () => {
    const guest = mountHarness({ identity: GUEST, symbol: 'GOOG' });
    guest.set({ symbol: 'AAPL' });
    expect(guest.last().query).toBe('AAPL');
    const account = mountHarness({ identity: OWNER_A, symbol: null });
    account.set({ symbol: '' });
    expect(account.last().status).toBe('unsupported');
    expect(account.last().query).toBe('');
    expect(fetchCalls).toHaveLength(0);
  });

  it('includes the first fact in the original budget and never waits for cleanup', async () => {
    const fx = await happyFixtures();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      subtle: { digest: async () => Uint8Array.from(Buffer.from(PYTHON_RECEIPT_SHA, 'hex')).buffer },
    } });
    const selection = deferred();
    const fact = deferred();
    responder = chainRoutes(fx, { selections: selection, fact });
    vi.useFakeTimers();
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await advance(9_000);
    await act(async () => { selection.resolve(jsonResponse(200, fx.selections).response); });
    expect(harness.last().status).toBe('selecting');
    await advance(1_000);
    expect(harness.last().status).toBe('source_unavailable');
    expect(urlsOf()).toEqual([CONTEXT_URL('GOOG'), SELECTIONS_URL(fx.issuerId), FACT_URL(fx.chosen)]);
    await act(async () => { fact.resolve(jsonResponse(200, fx.facts.get(fx.chosen)).response); });
    expect(harness.last().status).toBe('source_unavailable');
  });

  it('gives an explicit later selection its own finite 10-second budget', async () => {
    const fx = await happyFixtures('GOOG', 2);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe('ready');
    responder = () => new Promise(() => {});
    vi.useFakeTimers();
    harness.select(fx.ids[1]);
    await advance(9_999);
    expect(harness.last().status).toBe('selecting');
    await advance(1);
    expect(harness.last().status).toBe('source_unavailable');
    expect(fetchCalls).toHaveLength(4);
    await advance(60_000);
    expect(fetchCalls).toHaveLength(4);
  });

  it('cancels a body read that never settles without awaiting a hung cancel promise', async () => {
    let cancelled = false;
    responder = () => ({ status: 200, ok: true, headers: { get: () => null }, body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel: () => { cancelled = true; return new Promise(() => {}); },
      }),
    } });
    vi.useFakeTimers();
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await advance(9_999);
    expect(cancelled).toBe(false);
    await advance(1);
    expect(cancelled).toBe(true);
    expect(harness.last().status).toBe('source_unavailable');
    expect(fetchCalls).toHaveLength(1);
  });

  it.each(['selection', 'fact'] as const)('fences query ABA at %s despite ignored abort and stale rejection', async stage => {
    const a = await happyFixtures('GOOG');
    const b = await happyFixtures('NVDA', 1, OTHER_ISSUER, 20);
    const old = deferred();
    responder = chainRoutes(a, stage === 'selection' ? { selections: old } : { fact: old });
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' });
    await settle();
    expect(harness.last().status).toBe(stage === 'fact' ? 'selecting' : 'loading');
    responder = chainRoutes(b);
    harness.set({ symbol: 'NVDA' }); await settle();
    responder = chainRoutes(a);
    harness.set({ symbol: 'GOOG' }); await settle();
    expect(harness.last().status).toBe('ready');
    const before = fetchCalls.length;
    old.reject(new Error('OLD_A_PRIVATE_ERROR'));
    await settle();
    expect(harness.last().status).toBe('ready');
    expect(harness.last().query).toBe('GOOG');
    expect(fetchCalls).toHaveLength(before);
  });

  it('fences async digest ABA after the fresh A generation is ready', async () => {
    const a = await happyFixtures('GOOG');
    const b = await happyFixtures('NVDA', 1, OTHER_ISSUER, 20);
    const first = deferred();
    let reads = 0;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      subtle: { digest: (algorithm: string, bytes: BufferSource) => {
        if (reads++ === 0) return first.promise;
        return webcrypto.subtle.digest(algorithm, bytes);
      } },
    } });
    responder = chainRoutes(a);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' }); await settle();
    responder = chainRoutes(b); harness.set({ symbol: 'NVDA' }); await settle();
    responder = chainRoutes(a); harness.set({ symbol: 'GOOG' }); await settle();
    expect(harness.last().status).toBe('ready');
    const before = fetchCalls.length;
    first.resolve(Uint8Array.from(Buffer.from(PYTHON_RECEIPT_SHA, 'hex')).buffer);
    await settle();
    expect(harness.last().status).toBe('ready');
    expect(fetchCalls).toHaveLength(before);
  });

  it('does not cancel committed work when a different query render suspends and is discarded', async () => {
    const fx = await happyFixtures();
    const context = deferred();
    responder = chainRoutes(fx, { context });
    const suspended = new Promise(() => {});
    function Host({ symbol }: { symbol: string }) {
      const { state } = usePrivateCompanyIntelligence(OWNER_A, symbol);
      if (symbol === 'NVDA') throw suspended;
      return <p>{state.status}:{state.query}</p>;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<React.Suspense fallback={<p>fallback</p>}><Host symbol="GOOG" /></React.Suspense>));
      const committedSignal = abortSignals[0];
      act(() => React.startTransition(() => root.render(<React.Suspense fallback={<p>fallback</p>}><Host symbol="NVDA" /></React.Suspense>)));
      expect(committedSignal.aborted).toBe(false);
      expect(fetchCalls).toHaveLength(1);
      context.resolve(jsonResponse(200, fx.context).response);
      await settle();
      expect(container.textContent).toBe('ready:GOOG');
      expect(committedSignal.aborted).toBe(true); // normal chain release after READY
      expect(urlsOf()).not.toContain(CONTEXT_URL('NVDA'));
    } finally {
      act(() => root.unmount()); container.remove();
    }
  });
});

describe('real private wrapper, hook, decoder and presenter composition', () => {
  it('hides old details on selection, resets disclosure state, and clears a new UUID before its response', async () => {
    const fx = await happyFixtures('GOOG', 2);
    responder = chainRoutes(fx);
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const render = (identity: AccountIdentity, enabled = true) => act(() => root.render(
      <CompanyIntelligencePrivate identity={identity} symbol="GOOG" enabled={enabled} />));
    try {
      render(OWNER_A); await settle();
      expect(container.textContent).toContain('HBM3e memory module 1');
      const details = container.querySelector('details')!;
      details.open = true;
      const gate = deferred();
      responder = () => gate.promise;
      const selector = container.querySelector('select')!;
      act(() => { selector.value = fx.ids[1]; selector.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(container.textContent).not.toContain('HBM3e memory module 1');
      expect(container.querySelector('details')).toBeNull();
      expect(container.querySelectorAll('option')).toHaveLength(2);
      gate.resolve(jsonResponse(200, fx.facts.get(fx.ids[1])).response); await settle();
      expect(container.textContent).toContain('HBM3e memory module 2');
      expect(container.querySelector('details')!.open).toBe(false);
      const before = fetchCalls.length;
      render({ ...OWNER_A, email: 'renamed@example.test' });
      expect(fetchCalls).toHaveLength(before);
      expect(container.textContent).toContain('HBM3e memory module 2');
      responder = () => new Promise(() => {});
      render({ kind: 'account', userId: 'user-bbb', email: OWNER_A.kind === 'account' ? OWNER_A.email : '' });
      expect(container.textContent).not.toContain('HBM3e memory module');
      expect(container.textContent).not.toContain(HASH_A);
      expect(container.querySelector('select')).toBeNull();
      render(OWNER_A, false);
      expect(container.textContent).toBe('');
      expect(abortSignals[abortSignals.length - 1].aborted).toBe(true);
    } finally {
      act(() => root.unmount()); container.remove();
    }
  });
});


describe('selected-fact body ABA publication and release', () => {
  it.each(['success', 'error'] as const)('ignores old first-A body %s and preserves the third-A owned slot', async outcome => {
    const fx = await happyFixtures('GOOG', 2);
    responder = chainRoutes(fx);
    const harness = mountHarness({ identity: OWNER_A, symbol: 'GOOG' }); await settle();
    const oldBody = deferred();
    const latest = deferred();
    let reads = 0;
    let calls = 0;
    responder = () => {
      const call = calls++;
      if (call === 2) return latest.promise;
      if (call === 1) return new Promise(() => {});
      return { status: 200, ok: true, headers: { get: () => null }, body: { getReader: () => ({
        read: () => reads++ === 0 ? oldBody.promise : Promise.resolve({ done: true }),
        cancel: async () => {}, // explicitly ignores abort; publication must remain fenced
      }) } };
    };
    harness.select(fx.ids[1]); await settle(5); // first A enters a real deferred body read
    harness.select(fx.ids[0]); harness.select(fx.ids[1]);
    if (outcome === 'error') oldBody.reject(new Error('OLD_PRIVATE_BODY'));
    else oldBody.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(fx.facts.get(fx.ids[1]))) });
    await settle();
    expect(harness.last().status).toBe('selecting');
    expect((harness.last() as { selectedFactId: string }).selectedFactId).toBe(fx.ids[1]);
    latest.resolve(jsonResponse(200, fx.facts.get(fx.ids[1])).response); await settle();
    expect(harness.last().status).toBe('ready');
    expect((harness.last() as { selectedFactId: string }).selectedFactId).toBe(fx.ids[1]);
    expect(calls).toBe(3);
  });
});

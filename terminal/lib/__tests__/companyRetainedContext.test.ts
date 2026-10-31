import { describe, expect, it, vi } from 'vitest';
import type { RetainedEventWorkspaceReceipt } from '@/lib/eventWorkspace';
import {
  companyRetainedContextParams,
  loadCompanyRetainedContext,
  parseCompanyRetainedContext,
  type CompanyRetainedPin,
} from '../companyRetainedContext';

// Identity + normalize fixtures stand in for the event-workspace owner
// validators; the production module is exercised against them unchanged.
vi.mock('@/lib/eventWorkspace', () => ({
  normalizeCompanyIntelligenceSymbol: (raw: string): string | null => {
    if (typeof raw !== 'string') return null;
    const canonical = raw.trim().toUpperCase();
    if (canonical.length === 0 || canonical.length > 12) return null;
    return /^[A-Z0-9._-]+$/.test(canonical) ? canonical : null;
  },
  isEventWorkspaceEventId: (raw: unknown): boolean =>
    typeof raw === 'string' && /^ev_[0-9a-z]{6,64}$/.test(raw),
  isEventWorkspaceGenerationId: (raw: unknown): boolean =>
    typeof raw === 'string' && /^gw_[0-9a-z]{6,64}$/.test(raw),
  normalizeEventWorkspace: (
    raw: unknown,
    expectedEventId?: string,
    expectedGenerationId?: string,
  ): unknown => {
    if (typeof raw !== 'object' || raw === null) return null;
    const candidate = raw as { event_id?: unknown; generation_id?: unknown };
    if (typeof candidate.event_id !== 'string' || typeof candidate.generation_id !== 'string') {
      return null;
    }
    if (expectedEventId !== undefined && candidate.event_id !== expectedEventId) return null;
    if (
      expectedGenerationId !== undefined &&
      candidate.generation_id !== expectedGenerationId
    ) {
      return null;
    }
    return raw;
  },
}));

const SYMBOL = 'ACME';
const EVENT_ID = 'ev_9f2c41d8aa21';
const GENERATION_ID = 'gw_71b3e5c9024d';
const COMPANY_ID = 'cik:0000320193';
const FINGERPRINT = 'a1b2c3d4'.repeat(8);
const MANIFEST_SHA = '0123456789abcdef'.repeat(4);
const WORKSPACE_SHA = 'fedcba9876543210'.repeat(4);
const OTHER_EVENT_ID = 'ev_00000000dead';
const OTHER_GENERATION_ID = 'gw_00000000beef';
const OTHER_COMPANY_ID = 'cik:0000038777';
const CHECKED_AT = '2026-10-20T14:05:00.000Z';
const ENDPOINT_PATH = '/api/investigations/baseline';

function makePin(overrides: Partial<CompanyRetainedPin> = {}): CompanyRetainedPin {
  return {
    event_id: EVENT_ID,
    generation_id: GENERATION_ID,
    company_id: COMPANY_ID,
    fingerprint: FINGERPRINT,
    ...overrides,
  };
}

function makeReceipt(overrides: Record<string, unknown> = {}): RetainedEventWorkspaceReceipt {
  return {
    schema: 'earnings.retained_baseline.v1',
    owner: 'earnings.workspace_generation',
    company_id: COMPANY_ID,
    event_id: EVENT_ID,
    generation_id: GENERATION_ID,
    workspace_schema: 'event_workspace.v1',
    manifest_schema: 'event_workspace_manifest.v1',
    authority: 'context_only',
    manifest_sha256: MANIFEST_SHA,
    manifest_bytes: 2048,
    workspace_sha256: WORKSPACE_SHA,
    workspace_bytes: 4096,
    fingerprint: FINGERPRINT,
    public_known_at: '2026-10-20T14:00:00.000Z',
    platform_known_at: null,
    generation_emitted_at: '2026-10-20T13:30:00.000Z',
    rights: { allowed: true, policy_version: 'retained-context.v1', checked_at: CHECKED_AT },
    ...overrides,
  } as RetainedEventWorkspaceReceipt;
}

function makeWorkspace(
  eventId: string = EVENT_ID,
  generationId: string = GENERATION_ID,
): Record<string, unknown> {
  return {
    event_id: eventId,
    generation_id: generationId,
    authority: 'context_only',
    issuer: { company_id: COMPANY_ID, listings: [{ ticker: SYMBOL, exchange: 'NASDAQ' }] },
  };
}

function okPayload(
  receipt: RetainedEventWorkspaceReceipt = makeReceipt(),
  workspace: Record<string, unknown> = makeWorkspace(),
): Record<string, unknown> {
  return {
    ok: true,
    workspace,
    receipt,
    reference: {
      event_id: receipt.event_id,
      generation_id: receipt.generation_id,
      company_id: receipt.company_id,
      fingerprint: receipt.fingerprint,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function fetchReturning(payload: unknown, status = 200) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input; void _init; void _input; void _init; return jsonResponse(status, payload); });
}

function requestedCall(fetchImpl: ReturnType<typeof fetchReturning>) {
  const call = fetchImpl.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined] | undefined;
  if (!call) throw new Error('expected fetch to have been called');
  return { url: new URL(String(call[0]), 'https://same.origin.test'), init: call[1] ?? {} };
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

type LoadResult = Awaited<ReturnType<typeof loadCompanyRetainedContext>>;

function expectUnavailable(result: LoadResult, reason?: string): void {
  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ code: 'HISTORICAL_UNAVAILABLE' });
  if (!result.ok && reason !== undefined) {
    expect(result.reason).toBe(reason);
  }
}

describe('parseCompanyRetainedContext', () => {
  it('returns a null pin when no owned key is present, ignoring unrelated fields', () => {
    const params = new URLSearchParams('page=2&ci_lens=1h&symbol=ACME');
    expect(parseCompanyRetainedContext(params, SYMBOL)).toEqual({ ok: true, pin: null });
  });

  it('parses a complete valid tuple and ignores unrelated query fields', () => {
    const params = new URLSearchParams({
      page: '3',
      ci_lens: '1h',
      ci_event: EVENT_ID,
      ci_generation: GENERATION_ID,
      ci_company: COMPANY_ID,
      ci_fingerprint: FINGERPRINT,
    });
    expect(parseCompanyRetainedContext(params, SYMBOL)).toEqual({ ok: true, pin: makePin() });
  });

  it.each([
    ['ci_event', EVENT_ID],
    ['ci_generation', GENERATION_ID],
    ['ci_company', COMPANY_ID],
    ['ci_fingerprint', FINGERPRINT],
  ])('rejects a duplicated %s', (key, value) => {
    const params = new URLSearchParams({
      ci_event: EVENT_ID,
      ci_generation: GENERATION_ID,
      ci_company: COMPANY_ID,
      ci_fingerprint: FINGERPRINT,
    });
    params.append(key, value);
    const parsed = parseCompanyRetainedContext(params, SYMBOL);
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({
      code: 'HISTORICAL_UNAVAILABLE',
      reason: expect.stringContaining('invalid_reference'),
    });
  });

  it.each([
    ['ci_event missing', { ci_generation: GENERATION_ID, ci_company: COMPANY_ID, ci_fingerprint: FINGERPRINT }],
    ['ci_generation missing', { ci_event: EVENT_ID, ci_company: COMPANY_ID, ci_fingerprint: FINGERPRINT }],
    ['ci_company missing', { ci_event: EVENT_ID, ci_generation: GENERATION_ID, ci_fingerprint: FINGERPRINT }],
    ['ci_fingerprint missing', { ci_event: EVENT_ID, ci_generation: GENERATION_ID, ci_company: COMPANY_ID }],
  ])('rejects an incomplete tuple (%s)', (_name, fields) => {
    const params = new URLSearchParams(fields as Record<string, string>);
    const parsed = parseCompanyRetainedContext(params, SYMBOL);
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ code: 'HISTORICAL_UNAVAILABLE' });
  });

  it.each([
    ['a traversal event id', { ci_event: '../../etc/passwd' }],
    ['a malformed generation id', { ci_generation: 'not-a-generation' }],
    ['a short company id', { ci_company: 'cik:000032019' }],
    ['a non-canonical company prefix', { ci_company: 'CIK:0000320193' }],
    ['a truncated hash', { ci_fingerprint: FINGERPRINT.slice(0, 63) }],
    ['an uppercase hash', { ci_fingerprint: FINGERPRINT.toUpperCase() }],
    ['an empty owned value', { ci_event: '' }],
  ])('rejects %s', (_name, overrides) => {
    const params = new URLSearchParams({
      ci_event: EVENT_ID,
      ci_generation: GENERATION_ID,
      ci_company: COMPANY_ID,
      ci_fingerprint: FINGERPRINT,
      ...(overrides as Record<string, string>),
    });
    const parsed = parseCompanyRetainedContext(params, SYMBOL);
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ code: 'HISTORICAL_UNAVAILABLE' });
  });

  it('rejects a symbol that is not already the canonical form', () => {
    const params = new URLSearchParams({
      ci_event: EVENT_ID,
      ci_generation: GENERATION_ID,
      ci_company: COMPANY_ID,
      ci_fingerprint: FINGERPRINT,
    });
    const parsed = parseCompanyRetainedContext(params, 'acme ');
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({
      code: 'HISTORICAL_UNAVAILABLE',
      reason: expect.stringContaining('invalid_reference'),
    });
  });
});

describe('companyRetainedContextParams', () => {
  it('emits exactly the four owned keys from a successful receipt', () => {
    const params = companyRetainedContextParams(makeReceipt());
    expect([...params.keys()]).toEqual(['ci_event', 'ci_generation', 'ci_company', 'ci_fingerprint']);
    expect(params.get('ci_event')).toBe(EVENT_ID);
    expect(params.get('ci_generation')).toBe(GENERATION_ID);
    expect(params.get('ci_company')).toBe(COMPANY_ID);
    expect(params.get('ci_fingerprint')).toBe(FINGERPRINT);
  });

  it('roundtrips through parseCompanyRetainedContext', () => {
    const parsed = parseCompanyRetainedContext(companyRetainedContextParams(makeReceipt()), SYMBOL);
    expect(parsed).toEqual({ ok: true, pin: makePin() });
  });

  it.each([
    ['a wrong schema', { schema: 'earnings.retained_baseline.v2' }],
    ['a wrong owner', { owner: 'other.owner' }],
    ['a wrong authority', { authority: 'system_of_record' }],
    ['a malformed manifest hash', { manifest_sha256: 'zzzz' }],
    ['zero manifest bytes', { manifest_bytes: 0 }],
    ['a malformed workspace hash', { workspace_sha256: 'short' }],
    ['zero workspace bytes', { workspace_bytes: 0 }],
    ['a malformed fingerprint', { fingerprint: 'a1b2c3d4' }],
    ['missing rights', { rights: undefined }],
    ['denied rights', { rights: { allowed: false, policy_version: 'retained-context.v1', checked_at: CHECKED_AT } }],
    ['malformed rights', { rights: { allowed: 'yes' } }],
    ['a malformed checked_at', { rights: { allowed: true, policy_version: 'p', checked_at: 'now' } }],
  ])('throws TypeError on %s to prevent manufacturing a pin', (_name, overrides) => {
    expect(() => companyRetainedContextParams(makeReceipt(overrides as Record<string, unknown>))).toThrow(
      TypeError,
    );
  });
});

describe('loadCompanyRetainedContext', () => {
  it('performs the current load with only the symbol when no pin is given', async () => {
    const controller = new AbortController();
    const fetchImpl = fetchReturning(okPayload());
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      signal: controller.signal,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = requestedCall(fetchImpl);
    expect(url.pathname).toBe(ENDPOINT_PATH);
    expect([...url.searchParams.keys()]).toEqual(['scope', 'symbol']);
    expect(url.searchParams.get('scope')).toBe('company_context');
    expect(url.searchParams.get('symbol')).toBe(SYMBOL);
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(controller.signal);
    expect(result.ok).toBe(true);
  });

  it('sends the exact four identity keys and explicit Company scope for a retained pin', async () => {
    const fetchImpl = fetchReturning(okPayload());
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, pin: makePin(), fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url } = requestedCall(fetchImpl);
    expect(url.pathname).toBe(ENDPOINT_PATH);
    expect([...url.searchParams.keys()].sort()).toEqual([
      'company_id',
      'event_id',
      'fingerprint',
      'generation_id',
      'scope',
    ]);
    expect(url.searchParams.get('scope')).toBe('company_context');
    expect(url.searchParams.get('event_id')).toBe(EVENT_ID);
    expect(url.searchParams.get('generation_id')).toBe(GENERATION_ID);
    expect(url.searchParams.get('company_id')).toBe(COMPANY_ID);
    expect(url.searchParams.get('fingerprint')).toBe(FINGERPRINT);
    expect(result.ok).toBe(true);
  });

  it('returns the normalized workspace and the receipt on success', async () => {
    const receipt = makeReceipt();
    const workspace = makeWorkspace();
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      pin: makePin(),
      fetchImpl: fetchReturning(okPayload(receipt, workspace)),
    });
    expect(result).toEqual({ ok: true, workspace, receipt });
  });

  it('does not fetch when the pin is invalid', async () => {
    const fetchImpl = fetchReturning(okPayload());
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      pin: makePin({ event_id: '../../etc/passwd' }),
      fetchImpl,
    });
    expectUnavailable(result);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fetch when the requested symbol is not canonical', async () => {
    const fetchImpl = fetchReturning(okPayload());
    const result = await loadCompanyRetainedContext({ symbol: 'acme', pin: makePin(), fetchImpl });
    expectUnavailable(result);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails without fetching when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = fetchReturning(okPayload());
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      pin: makePin(),
      signal: controller.signal,
      fetchImpl,
    });
    expectUnavailable(result, 'aborted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails when the request is aborted in flight', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      controller.abort();
      if (init?.signal?.aborted) throw abortError();
      return jsonResponse(200, okPayload());
    });
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      pin: makePin(),
      signal: controller.signal,
      fetchImpl,
    });
    expectUnavailable(result, 'aborted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails when aborted between the response and the parsed body', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input; void _init;
      return {
        ok: true,
        status: 200,
        json: async () => {
          controller.abort();
          throw abortError();
        },
      } as unknown as Response;
    });
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      signal: controller.signal,
      fetchImpl,
    });
    expectUnavailable(result, 'aborted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns the server unavailable decision with no fallback request', async () => {
    const fetchImpl = fetchReturning({
      ok: false,
      code: 'HISTORICAL_UNAVAILABLE',
      reason: 'historical_unavailable',
    });
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl });
    expectUnavailable(result, 'historical_unavailable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('normalizes a non-string unavailable reason', async () => {
    const fetchImpl = fetchReturning({
      ok: false,
      code: 'HISTORICAL_UNAVAILABLE',
      reason: { detail: 'x'.repeat(200) },
    });
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl });
    expectUnavailable(result, 'unavailable');
  });

  it('maps unauthenticated responses to an explicit failure with no fallback', async () => {
    const fetchImpl = fetchReturning({ status: 'unauthenticated' }, 401);
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl });
    expectUnavailable(result, 'unauthenticated');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails on an unexpected http status', async () => {
    const fetchImpl = fetchReturning({ message: 'nope' }, 500);
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl });
    expectUnavailable(result, 'http_500');
  });

  it('fails on a non-JSON body', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input; void _init;
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response;
    });
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl });
    expectUnavailable(result, 'invalid_response');
  });

  it('fails on an unrecognized payload shape', async () => {
    const fetchImpl = fetchReturning({ nope: true });
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl });
    expectUnavailable(result, 'invalid_response');
  });

  it.each([
    ['event', { event_id: OTHER_EVENT_ID }],
    ['generation', { generation_id: OTHER_GENERATION_ID }],
    ['company', { company_id: OTHER_COMPANY_ID }],
    ['fingerprint', { fingerprint: 'b2c3d4e5'.repeat(8) }],
  ])('fails when the receipt %s does not match the requested pin', async (_name, overrides) => {
    const receipt = makeReceipt(overrides);
    const fetchImpl = fetchReturning(
      okPayload(receipt, makeWorkspace(receipt.event_id, receipt.generation_id)),
    );
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, pin: makePin(), fetchImpl });
    expectUnavailable(result);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails when the workspace issuer is a different company', async () => {
    const workspace = makeWorkspace();
    (workspace.issuer as { company_id: string }).company_id = OTHER_COMPANY_ID;
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      pin: makePin(),
      fetchImpl: fetchReturning(okPayload(makeReceipt(), workspace)),
    });
    expectUnavailable(result, 'company_mismatch');
  });

  it('fails when no issuer listing matches the requested symbol', async () => {
    const workspace = makeWorkspace();
    (workspace.issuer as { listings: Array<{ ticker: string }> }).listings = [{ ticker: 'OTHER' }];
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      fetchImpl: fetchReturning(okPayload(makeReceipt(), workspace)),
    });
    expectUnavailable(result, 'symbol_mismatch');
  });

  it('fails when the owner normalizer rejects the workspace', async () => {
    const workspace = makeWorkspace(OTHER_EVENT_ID, GENERATION_ID);
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      fetchImpl: fetchReturning(okPayload(makeReceipt(), workspace)),
    });
    expectUnavailable(result, 'normalize');
  });

  it.each([
    ['schema', { schema: 'earnings.retained_baseline.v2' }],
    ['owner', { owner: 'other.owner' }],
    ['authority', { authority: 'system_of_record' }],
    ['workspace schema', { workspace_schema: 'event_workspace.v2' }],
    ['company id', { company_id: 'cik:123' }],
    ['event id', { event_id: '../../etc/passwd' }],
    ['generation id', { generation_id: '' }],
    ['manifest hash', { manifest_sha256: 'ZZZ' }],
    ['manifest bytes', { manifest_bytes: 0 }],
    ['workspace hash', { workspace_sha256: 'nope' }],
    ['workspace bytes', { workspace_bytes: -1 }],
    ['fingerprint', { fingerprint: FINGERPRINT.slice(0, 32) }],
    ['generation emitted at', { generation_emitted_at: 'long ago' }],
    ['missing rights', { rights: undefined }],
    ['malformed rights', { rights: { allowed: 1 } }],
  ])('fails on a malformed receipt (%s)', async (_name, overrides) => {
    const fetchImpl = fetchReturning(okPayload(makeReceipt(overrides as Record<string, unknown>)));
    const result = await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl });
    expectUnavailable(result, 'malformed_receipt');
  });

  it('fails when the server rights decision is denied', async () => {
    const receipt = makeReceipt({
      rights: { allowed: false, policy_version: 'retained-context.v1', checked_at: CHECKED_AT },
    });
    const result = await loadCompanyRetainedContext({
      symbol: SYMBOL,
      fetchImpl: fetchReturning(okPayload(receipt, makeWorkspace())),
    });
    expectUnavailable(result, 'rights_denied');
  });
});

// Parent integration repairs: bootstrap reads need the same closed identity checks as pins.
describe('bootstrap identity boundaries', () => {
  it('rejects a noncanonical symbol before a no-pin request or empty-pin parse', async () => {
    const fetchImpl = fetchReturning(okPayload());
    expect(parseCompanyRetainedContext(new URLSearchParams(), 'acme').ok).toBe(false);
    expectUnavailable(await loadCompanyRetainedContext({ symbol: 'acme', fetchImpl }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('binds bootstrap issuer to its retained receipt even without a supplied pin', async () => {
    const workspace = makeWorkspace();
    (workspace.issuer as { company_id: string }).company_id = OTHER_COMPANY_ID;
    expectUnavailable(await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl: fetchReturning(okPayload(makeReceipt(), workspace)) }), 'company_mismatch');
  });
  it('refuses an unknown manifest receipt schema', async () => {
    const receipt = makeReceipt({ manifest_schema: 'unknown_schema' });
    expect(() => companyRetainedContextParams(receipt)).toThrow(TypeError);
    expectUnavailable(await loadCompanyRetainedContext({ symbol: SYMBOL, fetchImpl: fetchReturning(okPayload(receipt)) }), 'malformed_receipt');
  });
});

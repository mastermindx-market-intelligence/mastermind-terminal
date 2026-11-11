// @vitest-environment jsdom
/**
 * Focused lifecycle test for the sector constituent evidence surface.
 *
 * The real component, the real private host and the real private controller run here; only the
 * network boundary is replaced. Every assertion below is about an observable effect — which
 * URL was read, whether a read happened at all, what the reader can see afterwards — so a
 * mutation that reintroduced a pre-open read, revived a retired panel or renamed the supplied
 * symbol would fail here.
 */
import { createHash, webcrypto } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountIdentity } from '@/lib/accountIdentity';
import type { FeedPayload } from '@/lib/sectorIntelligence';
import type { SectorHoldingsFund } from '@/lib/sectorHoldingsCoverage';
import SectorConstituentEvidence from '@/components/sector-intelligence/SectorConstituentEvidence';
import { applyLang, LangProvider } from '@/lib/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECEIPT_SCHEMA = 'company_intelligence.current_issuer_identity/v1';
const CONTEXT_SCHEMA = 'company_intelligence.private_company_context/v1';
const SELECTIONS_SCHEMA = 'company_intelligence.private_issuer_selections/v1';
const PRODUCT_SCHEMA = 'company_intelligence.private_product_integration/v2';
const ERROR_SCHEMA = 'company_intelligence.private_error/v1';
const FACT_SCHEMA = 'company_intelligence.product_integration_fact/v1';
const EDITION_SCHEMA = 'company_intelligence.issuer_disclosure_edition/v1';
const GENERATION = 'gen-2026-10-11';

const OWNER_A: AccountIdentity = { kind: 'account', userId: 'owner-a', email: 'a@one.example' };
const OWNER_B: AccountIdentity = { kind: 'account', userId: 'owner-b', email: 'a@one.example' };
const GUEST: AccountIdentity = { kind: 'guest' };

const MU_FACT_ID = 'integration:' + '1'.padStart(64, '0');
const NVDA_FACT_ID = 'integration:' + '2'.padStart(64, '0');
const BRKB_FACT_ID = 'integration:' + '3'.padStart(64, '0');

const CONTEXT_URL = (symbol: string): string =>
  '/api/company-intelligence/private/company-context?symbol=' + encodeURIComponent(symbol);
const SELECTIONS_URL = (issuer: string): string =>
  '/api/company-intelligence/private/issuers/' + encodeURIComponent(issuer) + '/product-integrations';
const FACT_URL = (factId: string): string =>
  '/api/company-intelligence/private/product-integrations/' + encodeURIComponent(factId);

/* ── Owner holdings fixture ─────────────────────────────────────────────────────────── */

const XLK: SectorHoldingsFund = {
  fund: 'XLK',
  asOf: '2026-10-15',
  listed: [
    { ticker: 'NVDA', weightPct: 8.13, rank: 1 },
    { ticker: 'MU', weightPct: 1.51, rank: 2 },
    { ticker: 'BRK.B', weightPct: 0.4, rank: 3 },
  ],
  count: { listed: 3, total: 68 },
  weightPct: 10.04,
  concentration: { top3OfFundPct: 10.04, top3OfSamplePct: 100 },
};

const HOLDINGS_FEED: FeedPayload = {
  data: null,
  receipt: {
    source: 'holdings',
    path: '/sectordata/sector_holdings_coverage.json',
    status: 'ready',
    asOf: '2026-10-16',
    observedAt: '2026-10-16T09:00:00Z',
    stale: false,
    contentHash: null,
  },
};

/* ── Private chain fixtures (the same closed shapes the owner publishes) ─────────────── */

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
    schema: RECEIPT_SCHEMA,
    identity_mode: 'current',
    issuer_id: issuerId,
    evidenced_cik: '0000000001',
    source_commit: 'b'.repeat(40),
    sources: {
      security_master: { sha256: '1'.repeat(64), byte_length: 512 },
      vendor_aliases: { sha256: '2'.repeat(64), byte_length: 512 },
      issuer_master: { sha256: '3'.repeat(64), byte_length: 512 },
    },
    evidence_source: 'sec_company_tickers',
    evidence_snapshot: '2026-10-10',
  };
}

function receiptReference(issuerId: string): { sha: string; length: number } {
  const bytes = Buffer.from(canonicalJson(receiptBody(issuerId)), 'utf8');
  return { sha: createHash('sha256').update(bytes).digest('hex'), length: bytes.length };
}

/** The owner's issuer identity is its own namespace. It is never derived from the ticker. */
const ISSUER_BY_SYMBOL: Record<string, string> = {
  MU: 'ISS:US-XNAS-FIXTUREA',
  NVDA: 'ISS:US-XNAS-FIXTUREB',
  'BRK.B': 'ISS:US-XNAS-FIXTUREC',
};

function issuerFor(symbol: string): string {
  const issuer = ISSUER_BY_SYMBOL[symbol];
  if (issuer === undefined) throw new Error('no fixture issuer for ' + symbol);
  return issuer;
}

function contextFixture(symbol: string): Record<string, unknown> {
  const issuerId = issuerFor(symbol);
  const reference = receiptReference(issuerId);
  return {
    schema: CONTEXT_SCHEMA,
    identity_mode: 'current',
    query: { namespace: 'store', symbol },
    // The security keeps the exact listed ticker, punctuation included.
    security_id: 'SEC:US-XNAS-' + symbol,
    issuer_binding: {
      issuer_id: issuerId,
      evidenced_cik: '0000000001',
      identity_snapshot_reference: { schema: RECEIPT_SCHEMA, sha256: reference.sha, byte_length: reference.length },
    },
    identity_receipt: receiptBody(issuerId),
  };
}

function selectionEntry(factId: string): Record<string, unknown> {
  return {
    fact_id: factId,
    fact_reference: { schema: FACT_SCHEMA, sha256: 'a'.repeat(64), byte_length: 512 },
    edition_reference: { schema: EDITION_SCHEMA, sha256: 'e'.repeat(64), byte_length: 480 },
    kind: 'product_integration',
    lifecycle: 'planned',
  };
}

function selectionsFixture(symbol: string, factIds: readonly string[]): Record<string, unknown> {
  const context = contextFixture(symbol);
  const issuerBinding = context.issuer_binding;
  return {
    schema: SELECTIONS_SCHEMA,
    generation: GENERATION,
    identity_mode: 'current',
    issuer_role: 'subject_disclosing_company',
    issuer_binding: JSON.parse(JSON.stringify(issuerBinding)) as unknown,
    selections: factIds.map(selectionEntry),
  };
}

function factFixture(factId: string, symbol: string): Record<string, unknown> {
  return {
    schema: PRODUCT_SCHEMA,
    fact: {
      fact_id: factId,
      kind: 'product_integration',
      lifecycle: 'planned',
      subject_id: issuerFor(symbol),
      revision: 3,
      product: '24GB 8H HBM3E',
      platform: 'NVIDIA H200',
    },
    reference: { schema: FACT_SCHEMA, sha256: 'a'.repeat(64), byte_length: 512 },
    edition: { schema: EDITION_SCHEMA, sha256: 'e'.repeat(64), byte_length: 480 },
    source_timing: {
      published_date: '2024-02-26',
      published_at: null,
      publication_precision: 'date',
      known_at: '2024-02-26T09:05:30.123456+08:00',
    },
    generation: GENERATION,
    authority: 'context_only',
  };
}

function errorPayload(code: string): Record<string, unknown> {
  return { schema: ERROR_SCHEMA, code, automatic_retry_permitted: false };
}

/* ── Harness ─────────────────────────────────────────────────────────────────────────── */

interface Routed { readonly status: number; readonly body: unknown; }

let fetchCalls: string[] = [];
let routes: Map<string, Routed> = new Map();
let root: Root;
let container: HTMLDivElement;

function jsonResponse(status: number, value: unknown): unknown {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(bytes.length) : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= bytes.length) return { done: true };
          const chunk = bytes.slice(index, index + 4096);
          index += chunk.length;
          return { done: false, value: chunk };
        },
        cancel: async () => undefined,
      }),
    },
  };
}

function defaultRoutes(): Map<string, Routed> {
  const table = new Map<string, Routed>();
  for (const [symbol, factId] of [['MU', MU_FACT_ID], ['NVDA', NVDA_FACT_ID], ['BRK.B', BRKB_FACT_ID]] as const) {
    table.set(CONTEXT_URL(symbol), { status: 200, body: contextFixture(symbol) });
    table.set(SELECTIONS_URL(issuerFor(symbol)), { status: 200, body: selectionsFixture(symbol, [factId]) });
    table.set(FACT_URL(factId), { status: 200, body: factFixture(factId, symbol) });
  }
  return table;
}

interface View {
  readonly identity: AccountIdentity;
  readonly coverage: SectorHoldingsFund | null;
  readonly feed: FeedPayload | null;
  readonly onSignIn?: () => void;
}

async function render(view: View): Promise<void> {
  await act(async () => {
    root.render(
      <LangProvider>
        <SectorConstituentEvidence
          fund="XLK"
          coverage={view.coverage}
          feed={view.feed}
          identity={view.identity}
          onSignIn={view.onSignIn}
        />
      </LangProvider>,
    );
  });
}

/** A real WebCrypto digest lands on a thread-pool macrotask, so settle both task queues. */
async function settle(times = 30): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); });
  }
}

function text(): string {
  return container.textContent ?? '';
}

function select(value: string): void {
  const element = container.querySelector('select');
  if (element === null) throw new Error('member picker is absent');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function click(label: string): void {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => (candidate.textContent ?? '').trim() === label);
  if (button === undefined) throw new Error('no button named ' + label);
  act(() => { button.click(); });
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { subtle: webcrypto.subtle, randomUUID: () => webcrypto.randomUUID() },
  });
  fetchCalls = [];
  routes = defaultRoutes();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    const route = routes.get(url);
    if (route === undefined) throw new Error('unplanned request ' + url);
    return jsonResponse(route.status, route.body);
  }));
  document.documentElement.setAttribute('data-lang', 'en');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container, { onCaughtError: () => {} });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.documentElement.setAttribute('data-lang', 'en');
  vi.unstubAllGlobals();
});

describe('sector constituent evidence surface', () => {
  it('reads nothing until the reader opens the company evidence explicitly', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    await settle(4);
    expect(fetchCalls).toEqual([]);
    expect(text()).not.toContain('Private company context');

    select('MU');
    await settle(4);
    expect(fetchCalls).toEqual([]);

    click('Open company evidence');
    await settle();
    expect(fetchCalls[0]).toBe(CONTEXT_URL('MU'));
    expect(text()).toContain('Private company context');
  });

  it('passes the exact supplied symbol to the existing private host', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('BRK.B');
    click('Open company evidence');
    await settle();
    expect(fetchCalls[0]).toBe(CONTEXT_URL('BRK.B'));
    expect(fetchCalls.some(url => url.includes('BRK-B'))).toBe(false);
    expect(fetchCalls.some(url => url.includes('BRK.B'))).toBe(true);
  });

  it('keeps the membership record separate from the company disclosure clocks', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();

    const membership = container.querySelector('[data-testid="sector-constituent-membership"]');
    const panel = container.querySelector('[data-testid="sector-constituent-evidence-panel"]');
    expect(membership?.textContent).toContain('2026-10-15');
    expect(membership?.textContent).toContain('#2');
    expect(membership?.textContent).toContain('1.51%');
    expect(membership?.textContent).not.toContain('2024-02-26');
    expect(panel?.textContent).toContain('2024-02-26');
    expect(panel?.textContent).toContain('24GB 8H HBM3E');
    expect(panel?.textContent).toContain('NVIDIA H200');
  });

  it('never revives a retired panel across A to B to A', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(text()).toContain('24GB 8H HBM3E');

    select('NVDA');
    await settle();
    expect(text()).not.toContain('24GB 8H HBM3E');
    expect(text()).not.toContain('Private company context');
    const readsAfterSwitch = fetchCalls.length;

    select('MU');
    await settle();
    expect(text()).not.toContain('24GB 8H HBM3E');
    expect(fetchCalls.length).toBe(readsAfterSwitch);
  });

  it('unmounts the old panel when the served source changes', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(text()).toContain('24GB 8H HBM3E');

    await render({
      identity: OWNER_A,
      coverage: XLK,
      feed: { ...HOLDINGS_FEED, receipt: { ...HOLDINGS_FEED.receipt, contentHash: 'f'.repeat(64) } },
    });
    await settle();
    expect(text()).not.toContain('24GB 8H HBM3E');
    expect(text()).not.toContain('Private company context');
  });

  it('unmounts the old panel when the coverage is withdrawn', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(text()).toContain('24GB 8H HBM3E');

    await render({ identity: OWNER_A, coverage: null, feed: HOLDINGS_FEED });
    await settle();
    expect(text()).not.toContain('24GB 8H HBM3E');
    expect(text()).not.toContain('Private company context');
    expect(text()).toContain('This sector has no listed fund holdings.');
  });

  it('unmounts the old panel when the account changes', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(text()).toContain('24GB 8H HBM3E');

    await render({ identity: OWNER_B, coverage: XLK, feed: HOLDINGS_FEED });
    await settle();
    expect(text()).not.toContain('24GB 8H HBM3E');
    expect(text()).not.toContain('Private company context');
  });

  it('reads nothing for a guest and keeps the truthful sign-in state', async () => {
    await render({ identity: GUEST, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(fetchCalls).toEqual([]);
    expect(text()).toContain('Sign in to view private company context.');
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('keeps the refusal, the entitled empty and the metadata-only states truthful', async () => {
    routes.set(CONTEXT_URL('MU'), { status: 403, body: errorPayload('ENTITLEMENT_REQUIRED') });
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(text()).toContain('Private context is unavailable for this account.');

    routes = defaultRoutes();
    routes.set(SELECTIONS_URL(issuerFor('MU')), { status: 200, body: selectionsFixture('MU', []) });
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(text()).toContain('No product integrations in the current selection.');

    routes = defaultRoutes();
    routes.set(SELECTIONS_URL(issuerFor('MU')), { status: 503, body: errorPayload('SOURCE_NOT_ADMITTED') });
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    select('MU');
    click('Open company evidence');
    await settle();
    expect(text()).toContain('Company identity is available; private disclosures are unavailable.');
  });

  it('shows the served receipt without inventing a body hash', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    expect(text()).toContain('/sectordata/sector_holdings_coverage.json');
    expect(text()).toContain('2026-10-16');
    expect(text()).toContain('Not supplied by this source');
    expect(text()).not.toMatch(/[0-9a-f]{64}/);
  });

  it('does not claim a complete constituent list', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    expect(text()).toContain('not a complete constituent list');
  });

  it('answers in Chinese for the same membership record', async () => {
    await render({ identity: OWNER_A, coverage: XLK, feed: HOLDINGS_FEED });
    await act(async () => { applyLang('zh'); });
    await settle(4);
    expect(text()).toContain('成分股公司证据');
    expect(text()).toContain('所列样本中的顺序');
    expect(text()).toContain('持仓截至');
  });
});

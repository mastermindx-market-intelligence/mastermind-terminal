/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import MonitorWorkspace from '@/components/workspaces/MonitorWorkspace';

type ShellIdentity = { kind: 'guest' } | { kind: 'account'; userId: string; email: string };

const shellState = vi.hoisted(() => ({
  identity: { kind: 'guest' } as { kind: 'guest' } | { kind: 'account'; userId: string; email: string },
  lang: 'en' as 'en' | 'zh',
}));

vi.mock('@/components/chrome/AppShell', () => ({
  useShellIdentity: () => shellState.identity,
}));

vi.mock('@/lib/i18n', () => ({
  useLang: () => ({ lang: shellState.lang }),
}));

vi.mock('next/link', () => ({
  default: function FakeLink(props: { href: string; children?: ReactNode }) {
    return createElement('a', { href: props.href }, props.children);
  },
}));

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type GateKey = 'watchlist' | 'alerts';

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function gateKey(url: string): GateKey {
  return url.includes('/api/watchlist') ? 'watchlist' : 'alerts';
}

const fetchControl: {
  calls: string[];
  options: RequestInit[];
  impl: null | ((url: string) => Promise<FakeResponse>);
  gates: Record<GateKey, Array<(response: FakeResponse) => void>>;
} = {
  calls: [],
  options: [],
  impl: null,
  gates: { watchlist: [], alerts: [] },
};

function stubFetch(): void {
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    fetchControl.calls.push(method + ' ' + url);
    fetchControl.options.push(init ?? {});
    if (fetchControl.impl) return fetchControl.impl(url);
    return new Promise<FakeResponse>((resolve) => {
      fetchControl.gates[gateKey(url)].push(resolve);
    });
  };
  (globalThis as { fetch: unknown }).fetch = stub as typeof fetch;
}

const originalFetch = globalThis.fetch;

const ACCOUNT_A: ShellIdentity = { kind: 'account', userId: 'uuid-a', email: 'a@example.com' };
const ACCOUNT_B: ShellIdentity = { kind: 'account', userId: 'uuid-b', email: 'b@example.com' };

const WATCHLISTS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Core',
    position: 0,
    symbols: [
      { symbol: 'AAPL', section: 'Tech', position: 0 },
      { symbol: 'MSFT', section: 'Tech', position: 1 },
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Watch',
    position: 1,
    symbols: [{ symbol: 'NVDA', section: 'Chips', position: 0 }],
  },
];

const ALERTS = [
  { id: 'alert-1', symbol: 'AAPL', active: true, created_at: '2026-01-05T00:00:00.000Z' },
  {
    id: 'alert-2',
    symbol: 'MSFT',
    active: false,
    created_at: '2026-02-01T00:00:00.000Z',
    condition: { type: 'price', op: 'above', value: 400, triggered: true },
  },
  {
    id: 'alert-3',
    symbol: 'NVDA',
    active: false,
    created_at: '2026-03-01T00:00:00.000Z',
    condition: { type: 'price', op: 'below', value: 90 },
  },
];

let container: HTMLDivElement;
let workspaceRoot: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/monitor?list=core&view=watchlists#saved');
  shellState.identity = { kind: 'guest' };
  shellState.lang = 'en';
  fetchControl.calls = [];
  fetchControl.options = [];
  fetchControl.impl = null;
  fetchControl.gates = { watchlist: [], alerts: [] };
  stubFetch();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (workspaceRoot) {
    const root = workspaceRoot;
    workspaceRoot = null;
    await act(async () => {
      root.unmount();
    });
  }
  container.remove();
  (globalThis as { fetch: unknown }).fetch = originalFetch;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderWorkspace(): Promise<void> {
  const root = createRoot(container);
  workspaceRoot = root;
  await act(async () => {
    root.render(createElement(MonitorWorkspace));
  });
}

async function rerenderWorkspace(): Promise<void> {
  await act(async () => {
    workspaceRoot?.render(createElement(MonitorWorkspace));
  });
}

async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function text(): string {
  return container.textContent ?? '';
}

function links(): string[] {
  return Array.from(container.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href') ?? '');
}

function expectCurrentChart(symbol: string, returnHref = window.location.href): void {
  const href = links().find(candidate => {
    const url = new URL(candidate, window.location.origin);
    return url.pathname === '/terminal' && url.searchParams.get('symbol') === symbol;
  });
  expect(href).toBeDefined();
  const params = new URL(href!, window.location.origin).searchParams;
  expect(params.get('ret')).toBe(returnHref);
  expect(params.get('from')).toBe('macro');
}

function okBoth(): (url: string) => Promise<FakeResponse> {
  return async (url: string) =>
    gateKey(url) === 'watchlist'
      ? jsonResponse({ lists: WATCHLISTS, sharedWithMe: [{ id: 'shared-1', name: 'SharedList' }] })
      : jsonResponse({ alerts: ALERTS });
}

describe('MonitorWorkspace', () => {
  it('guest renders a sign-in link and never requests private APIs', async () => {
    await renderWorkspace();
    await settle();
    expect(fetchControl.calls).toEqual([]);
    expect(text()).toContain('Sign in to see your Monitor');
    expect(links()).toContain('/login');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps alerts usable when the watchlist inventory fails', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url: string) =>
      gateKey(url) === 'watchlist' ? jsonResponse({}, 503) : jsonResponse({ alerts: ALERTS });
    await renderWorkspace();
    await settle();
    expect(text()).toContain('Watchlist inventory is unavailable right now.');
    expect(text()).toContain('AAPL');
    expect(text()).toContain('Active');
    expect(text()).toContain('Triggered (recorded)');
    expect(links()).toContain('/alerts');
  });

  it('keeps watchlists usable when the alert inventory fails', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url: string) =>
      gateKey(url) === 'alerts' ? jsonResponse({}, 503) : jsonResponse({ lists: WATCHLISTS });
    await renderWorkspace();
    await settle();
    expect(text()).toContain('Saved alert conditions are unavailable right now.');
    expect(text()).toContain('Your lists (2)');
    expect(text()).toContain('Core');
  });

  it('renders genuinely empty inventories as empty, not unavailable', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url: string) =>
      gateKey(url) === 'watchlist' ? jsonResponse({ lists: [] }) : jsonResponse({ alerts: [] });
    await renderWorkspace();
    await settle();
    expect(text()).toContain('You have no watchlists yet.');
    expect(text()).toContain('No saved alert conditions.');
    expect(text()).toContain('Choose a price or event to follow in Alerts.');
    expect(text()).not.toContain('unavailable right now');
    expect(text()).not.toContain('distinct symbols');
  });

  it('renders exact lists, symbol order, links, counts and badges', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = okBoth();
    await renderWorkspace();
    await settle();

    expect(text()).toContain('Your lists (2)');
    expect(text()).toContain('3 distinct symbols');
    expect(text().indexOf('Core')).toBeGreaterThanOrEqual(0);
    expect(text().indexOf('Core')).toBeLessThan(text().indexOf('Watch'));
    const aapl = text().indexOf('AAPL');
    const msft = text().indexOf('MSFT');
    const nvda = text().indexOf('NVDA');
    expect(aapl).toBeLessThan(msft);
    expect(msft).toBeLessThan(nvda);
    expect(text()).not.toContain('SharedList');

    expect(container.querySelectorAll('details')).toHaveLength(2);

    const hrefs = links();
    expectCurrentChart('AAPL');
    expect(hrefs).toContain('/analysis?symbol=AAPL&page=overview');
    expectCurrentChart('MSFT');
    expect(hrefs).toContain('/analysis?symbol=MSFT&page=overview');
    expectCurrentChart('NVDA');
    expect(hrefs).toContain('/analysis?symbol=NVDA&page=overview');
    expect(hrefs).toContain('/alerts');
    expect(hrefs).toContain('/portfolio');

    expect(text()).toContain('Created 2026-01-05');
    expect(text()).toContain('Paused');
    expect(fetchControl.calls).toHaveLength(2);
  });

  it('maps 401 to restricted without deleting the other section', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url: string) =>
      gateKey(url) === 'watchlist' ? jsonResponse({}, 401) : jsonResponse({ alerts: [] });
    await renderWorkspace();
    await settle();
    expect(text()).toContain('Watchlist inventory is restricted for this account.');
    expect(text()).toContain('No saved alert conditions.');
  });

  it('treats a malformed watchlist payload as unavailable, never empty', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url: string) =>
      gateKey(url) === 'watchlist'
        ? jsonResponse({ lists: [{ id: 'row-1' }] })
        : jsonResponse({ alerts: [] });
    await renderWorkspace();
    await settle();
    expect(text()).toContain('Watchlist inventory is unavailable right now.');
    expect(text()).not.toContain('You have no watchlists yet.');
  });

  it('treats a malformed alert payload as unavailable, never empty', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url: string) =>
      gateKey(url) === 'watchlist'
        ? jsonResponse({ lists: [] })
        : jsonResponse({ alerts: 'nope' });
    await renderWorkspace();
    await settle();
    expect(text()).toContain('Saved alert conditions are unavailable right now.');
    expect(text()).not.toContain('No saved alert conditions.');
  });

  it('refresh retries both GETs only, with no polling', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = okBoth();
    await renderWorkspace();
    await settle();
    expect(fetchControl.calls).toHaveLength(2);

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Refresh',
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
    await settle();

    expect(fetchControl.calls).toHaveLength(4);
    expect(fetchControl.options.every(options => options.credentials === 'same-origin' && options.cache === 'no-store')).toBe(true);
    for (const call of fetchControl.calls) {
      expect(call.startsWith('GET ')).toBe(true);
      const url = call.slice(4);
      expect(url === '/api/watchlist' || url === '/api/alerts').toBe(true);
    }
    expect(text()).toContain('Your lists (2)');
    expect(text()).toContain('3 distinct symbols');
  });

  it('never renders a late old-account payload after an account switch', async () => {
    shellState.identity = ACCOUNT_A;
    await renderWorkspace();
    await settle();
    expect(fetchControl.calls).toHaveLength(2);

    shellState.identity = ACCOUNT_B;
    await rerenderWorkspace();
    await settle();
    expect(fetchControl.calls).toHaveLength(4);

    await act(async () => {
      fetchControl.gates.watchlist[0](
        jsonResponse({
          lists: [{ id: 'old-list', name: 'OLD-LIST', position: 0, symbols: [] }],
        }),
      );
      fetchControl.gates.alerts[0](
        jsonResponse({
          alerts: [{ id: 'old-alert', symbol: 'OLDX', active: true, created_at: '2026-01-01T00:00:00.000Z' }],
        }),
      );
    });
    await settle();
    expect(text()).not.toContain('OLD-LIST');
    expect(text()).not.toContain('OLDX');
    expect(text()).toContain('Checking your watchlists');

    await act(async () => {
      fetchControl.gates.watchlist[1](
        jsonResponse({
          lists: [
            {
              id: 'new-list',
              name: 'NEW-LIST',
              position: 0,
              symbols: [{ symbol: 'TSLA', section: 'Auto', position: 0 }],
            },
          ],
        }),
      );
      fetchControl.gates.alerts[1](jsonResponse({ alerts: [] }));
    });
    await settle();
    expect(text()).toContain('NEW-LIST');
    expect(text()).not.toContain('OLD-LIST');
    expect(text()).not.toContain('OLDX');
  });

  it('clears the payload on logout', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = okBoth();
    await renderWorkspace();
    await settle();
    expect(text()).toContain('Core');

    shellState.identity = { kind: 'guest' };
    await rerenderWorkspace();
    await settle();
    expect(text()).not.toContain('Core');
    expect(text()).not.toContain('AAPL');
    expect(links()).toContain('/login');
  });

  it('limits the first-level alerts to eight and names the complete inventory landing', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url) => gateKey(url) === 'watchlist'
      ? jsonResponse({ lists: [] })
      : jsonResponse({ alerts: Array.from({ length: 12 }, (_, index) => ({
        id: 'alert-' + index, symbol: 'SYM' + index, active: true, created_at: '2026-01-01',
      })) });
    await renderWorkspace();
    await settle();
    expect(text()).toContain('SYM7');
    expect(text()).not.toContain('SYM8');
    const all = [...container.querySelectorAll('a')].find(a => a.textContent === 'See all 12 saved alerts');
    expect(all?.getAttribute('href')).toBe('/alerts');
  });

  it('does not revive an earlier account payload on logout and sign-in with the same UUID', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = okBoth();
    await renderWorkspace();
    await settle();
    expect(text()).toContain('Core');
    shellState.identity = { kind: 'guest' };
    await rerenderWorkspace();
    fetchControl.impl = null;
    shellState.identity = ACCOUNT_A;
    await rerenderWorkspace();
    expect(text()).not.toContain('Core');
    expect(text()).not.toContain('AAPL');
    expect(text()).toContain('Checking your watchlists');
  });

  it.each([
    ['watchlist', 'response'], ['watchlist', 'body'],
    ['alerts', 'response'], ['alerts', 'body'],
  ] as const)('bounds a hanging %s %s, preserves the other owner and allows Refresh', async (owner, stage) => {
    vi.useFakeTimers();
    shellState.identity = ACCOUNT_A;
    let releaseLate!: () => void;
    const payload = owner === 'watchlist' ? { lists: WATCHLISTS } : { alerts: ALERTS };
    fetchControl.impl = async (url) => {
      if (gateKey(url) !== owner) return okBoth()(url);
      if (stage === 'response') return new Promise(resolve => {
        releaseLate = () => resolve(jsonResponse(payload));
      });
      return { ok: true, status: 200, json: () => new Promise(resolve => {
        releaseLate = () => resolve(payload);
      }) };
    };
    await renderWorkspace();
    await settle();
    const unavailable = owner === 'watchlist'
      ? 'Watchlist inventory is unavailable right now.'
      : 'Saved alert conditions are unavailable right now.';
    expect(text()).not.toContain(unavailable);
    expect(text()).toContain(owner === 'watchlist' ? 'Active' : 'Core');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(text()).toContain(unavailable);
    expect(text()).toContain(owner === 'watchlist' ? 'Active' : 'Core');
    const requestIndex = fetchControl.calls.findIndex(call => gateKey(call) === owner);
    expect(fetchControl.options[requestIndex].signal?.aborted).toBe(true);
    // A body/transport that ignores cancellation must not revive a timed-out read.
    await act(async () => { releaseLate(); });
    await settle();
    expect(text()).toContain(unavailable);
    fetchControl.impl = okBoth();
    await act(async () => { container.querySelector('button')?.click(); });
    await settle();
    expect(text()).not.toContain(unavailable);
    expect(text()).toContain('Core');
    expect(text()).toContain('Active');
    expect(fetchControl.calls).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a hanging body and its deadline when the account changes', async () => {
    vi.useFakeTimers();
    shellState.identity = ACCOUNT_A;
    let releaseOldBody!: (body: unknown) => void;
    fetchControl.impl = async (url) => gateKey(url) === 'watchlist'
      ? { ok: true, status: 200, json: () => new Promise(resolve => { releaseOldBody = resolve; }) }
      : jsonResponse({ alerts: [] });
    await renderWorkspace();
    await settle();
    const oldSignal = fetchControl.options[0].signal;
    shellState.identity = ACCOUNT_B;
    fetchControl.impl = okBoth();
    await rerenderWorkspace();
    await settle();
    expect(oldSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      releaseOldBody({ lists: [{ id: 'old-list', name: 'OLD-LIST', position: 0, symbols: [] }] });
      await vi.advanceTimersByTimeAsync(10_001);
    });
    expect(text()).toContain('Core');
    expect(text()).not.toContain('OLD-LIST');
    expect(text()).not.toContain('unavailable right now.');
  });

  it('hydrates consistently and preserves exact Monitor origin, query and hash for current charts', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = okBoth();
    const messages: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { messages.push(args.map(String).join(' ')); });
    container.innerHTML = renderToString(createElement(MonitorWorkspace));
    expect(fetchControl.calls).toHaveLength(0);
    await act(async () => {
      workspaceRoot = hydrateRoot(container, createElement(MonitorWorkspace), {
        onRecoverableError: error => { messages.push(String(error)); },
      });
    });
    await settle();
    expectCurrentChart('AAPL');
    expect(text()).toContain('Open current chart');
    expect(messages.filter(message => /hydrat|did not match|didn't match/i.test(message))).toEqual([]);
    await act(async () => {
      window.history.replaceState({}, '', '/monitor?list=next&filter=a%2Fb#alerts');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expectCurrentChart('MSFT');
    await act(async () => {
      window.history.replaceState({}, '', '/monitor?list=next&filter=a%2Fb#watchlists');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expectCurrentChart('NVDA');
  });

  it('keeps incumbent listing eligibility and refuses unsafe chart return context', async () => {
    shellState.identity = ACCOUNT_A;
    fetchControl.impl = async (url) => gateKey(url) === 'alerts' ? jsonResponse({ alerts: [] })
      : jsonResponse({ lists: [{ ...WATCHLISTS[0], symbols: [
        { symbol: ' aapl ', section: '', position: 0 },
        { symbol: 'not a listing?', section: '', position: 1 },
      ] }] });
    await renderWorkspace();
    await settle();
    expectCurrentChart('AAPL');
    expect(links().filter(href => href.startsWith('/terminal?'))).toHaveLength(1);
    await act(async () => {
      window.history.replaceState({}, '', '/monitor?access_token=fixture-private-value#saved');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(links().some(href => href.startsWith('/terminal?'))).toBe(false);
    expect(links().some(href => href.includes('fixture-private-value'))).toBe(false);
  });

  it('renders Chinese copy when lang is zh', async () => {
    shellState.identity = ACCOUNT_A;
    shellState.lang = 'zh';
    fetchControl.impl = okBoth();
    await renderWorkspace();
    await settle();
    expect(text()).toContain('你的关注列表与已保存的预警条件。');
    expect(text()).toContain('预警条件');
    expect(text()).toContain('你的列表 (2)');
    expect(text()).toContain('刷新');
    expect(text()).toContain('打开当前图表');
    expect(text()).not.toContain('Open current chart');
    expect(text()).not.toContain('Your watchlists and saved alert conditions.');
    expectCurrentChart('AAPL');
  });
});

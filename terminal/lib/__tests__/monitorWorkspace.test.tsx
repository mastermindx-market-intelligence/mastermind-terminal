/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
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
    expect(hrefs).toContain('/terminal?sym=AAPL');
    expect(hrefs).toContain('/analysis?symbol=AAPL&page=overview');
    expect(hrefs).toContain('/terminal?sym=MSFT');
    expect(hrefs).toContain('/analysis?symbol=MSFT&page=overview');
    expect(hrefs).toContain('/terminal?sym=NVDA');
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
    expect(text()).not.toContain('Your watchlists and saved alert conditions.');
    expect(links()).toContain('/terminal?sym=AAPL');
  });
});

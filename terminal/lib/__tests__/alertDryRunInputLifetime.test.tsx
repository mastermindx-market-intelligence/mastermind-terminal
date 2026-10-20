// @vitest-environment jsdom
// Real AlertsView form, real dry-run panel, catalog, contract reader and EN/ZH lexicons.
// Account/store adapters and HTTP replies are synthetic; no browser/market acceptance claimed.
import React, { act, StrictMode, Suspense, startTransition, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import AlertsView from '@/components/AlertsView';
import AlertDryRunPanel from '@/components/alerts/AlertDryRunPanel';
import { applyLang, LangProvider, LEX } from '@/lib/i18n';
import { ALERT_DRY_RUN_LEX } from '@/lib/alertDryRunLex';
import { dryRunResult, type DryRunResult } from '@/lib/alertDryRunContract';
import type { SuiteAlertCondition, SuiteSequenceCondition } from '@/lib/suiteAlerts';

vi.mock('@/lib/dataCache', () => ({ getJSON: async () => ({ symbols: { NVDA: {}, AAPL: {} } }) }));
vi.mock('@/lib/suites/registry', () => ({ SUITE_DEFS: {} }));
vi.mock('@/lib/entitlementStore', () => ({ useGateEntitlement: () => ({ tier: 'pro' }) }));
vi.mock('@/components/chrome/AppShell', () => ({ useShellIdentity: () => ({ kind: 'guest' }) }));
vi.mock('@/lib/optionsAlerts', () => ({
  optAlertPreview: () => '', buildOptCondition: () => ({}), canonicalizeOptAlertIdentity: () => null,
  isMarketWideOptKind: () => false, normalizeOptAlertRoot: (s: string) => s,
}));
vi.mock('@/lib/alertsView', () => ({ ALERTS_CHANGED_EVENT: 'test:alerts-changed', conditionText: () => '', firedEventTextZh: () => '' }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Condition = SuiteAlertCondition | SuiteSequenceCondition;
type Pending = { body: { symbol: string; condition: Condition }; signal: AbortSignal; resolve: (r: Response) => void; reject: (reason: unknown) => void };
const A: SuiteAlertCondition = { type: 'suite_event', suite: 'structure', event: 'bos' };
const B: SuiteAlertCondition = { ...A, event: 'choch' };
let host: HTMLDivElement, root: Root, pending: Pending[], requests: Array<{ url: string; method: string }>;
const panel = () => host.querySelector<HTMLElement>('[data-testid="alert-dry-run"]')!;
const go = () => host.querySelector<HTMLButtonElement>('[data-testid="alert-dry-run-go"]')!;
const state = () => panel().dataset.dryRunState;
const text = (key: string, lang: 'en' | 'zh') => (LEX[key] || ALERT_DRY_RUN_LEX[key])[lang === 'zh' ? 1 : 0];
const select = (key: string, lang: 'en' | 'zh') => host.querySelector<HTMLSelectElement>(`select[aria-label="${text(key, lang)}"]`)!;
async function change(el: HTMLSelectElement, value: string) {
  await act(async () => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function run() { await act(async () => go().click()); }
function response(body: unknown, status = 200): Response { return { ok: status < 400, status, json: async () => body } as Response; }
function result(p: Pending, evaluatedAt = '2026-10-10T12:00:00.000Z', verdict: 'would_trigger' | 'not_met' = 'would_trigger'): DryRunResult {
  const condition = p.body.condition;
  return dryRunResult(verdict, {
    symbol: p.body.symbol, timeframe: '1D', basis: 'daily_bars_module_defaults',
    condition: { type: condition.type, suite: condition.suite, key: `${condition.suite}:fixture`,
      steps: condition.type === 'suite_event' ? [{ event: condition.event, label: condition.event }]
        : condition.steps.map(step => ({ ...step, label: step.event })), tier: 'free' },
    clocks: { evaluatedAt, lastBarDate: evaluatedAt.slice(0, 10), barCount: 100, sourceAsOf: evaluatedAt,
      freshFrom: '2026-10-08', freshTo: evaluatedAt.slice(0, 10), creationFloorDate: evaluatedAt.slice(0, 10) },
    decision: { fired: verdict === 'would_trigger', value: 182.5, confirmedDate: evaluatedAt.slice(0, 10) }, trace: [], recent: [],
  });
}
async function settle(p: Pending, body: unknown = result(p), status = 200) {
  await act(async () => { p.resolve(response(body, status)); });
}
async function renderChild(condition: Condition | null = A, symbol = 'NVDA', strict = false) {
  const node = <LangProvider><AlertDryRunPanel symbol={symbol} condition={condition} signedIn locked={false} /></LangProvider>;
  await act(async () => root.render(strict ? <StrictMode>{node}</StrictMode> : node));
}
async function renderParent(lang: 'en' | 'zh', strict: boolean) {
  const node = <LangProvider><AlertsView email="fixture@example.invalid" panelOnly /></LangProvider>;
  await act(async () => root.render(strict ? <StrictMode>{node}</StrictMode> : node));
  await change(select('newAlert', lang), 'suite');
  await change(select('condCatSuite', lang), 'structure');
  await change(select('suiteEventLabel', lang), 'bos');
}

beforeEach(() => {
  pending = []; requests = [];
  window.history.replaceState(null, '', '/alerts');
  document.documentElement.setAttribute('data-lang', 'en');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'; requests.push({ url, method });
    if (url === '/api/alerts' && method === 'GET') return Promise.resolve(response({ alerts: [] }));
    if (url !== '/api/alerts/dry-run' || method !== 'POST') throw new Error(`Unexpected request: ${method} ${url}`);
    return new Promise<Response>((resolve, reject) => pending.push({ body: JSON.parse(String(init?.body)), signal: init!.signal as AbortSignal, resolve, reject }));
  }));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(requests.filter(r => r.method !== 'GET').every(r => r.url === '/api/alerts/dry-run' && r.method === 'POST')).toBe(true);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe.each(['en', 'zh'] as const)('dry-run committed input lifetime (%s)', lang => {
  it.each([false, true])('real parent does not revive a completed verdict or its old clock after symbol A→B→A (StrictMode=%s)', async strict => {
    document.documentElement.setAttribute('data-lang', lang); await renderParent(lang, strict);
    const symbolControl = select('symbol', lang); symbolControl.focus(); await run();
    expect(pending[0].body).toEqual({ symbol: 'NVDA', condition: A });
    await settle(pending[0]);
    expect(state()).toBe('result'); expect(panel().textContent).toContain(text('drVerdict.would_trigger', lang));
    expect(panel().textContent).toContain('2026-10-10 12:00 UTC');
    await change(select('symbol', lang), 'AAPL');
    expect(select('symbol', lang)).toBe(symbolControl); expect(document.activeElement).toBe(symbolControl); expect(state()).toBe('idle');
    await change(select('symbol', lang), 'NVDA');
    expect(select('symbol', lang)).toBe(symbolControl); expect(document.activeElement).toBe(symbolControl); expect(pending).toHaveLength(1);
    expect(state()).toBe('idle'); expect(panel().textContent).not.toContain('2026-10-10 12:00 UTC');
    expect(panel().querySelector('[data-verdict]')).toBeNull();
    // Only a new explicit read may produce a new verdict/current clock.
    await run(); expect(pending).toHaveLength(2);
    await settle(pending[1], result(pending[1], '2026-10-15T12:00:00.000Z', 'not_met'));
    expect(state()).toBe('result'); expect(panel().textContent).toContain(text('drVerdict.not_met', lang));
    expect(panel().textContent).toContain('2026-10-15 12:00 UTC');
    expect(panel().textContent).not.toContain('2026-10-10 12:00 UTC');
  });

  it.each([false, true])('real parent forgets completed event A after event B is selected (StrictMode=%s)', async strict => {
    document.documentElement.setAttribute('data-lang', lang); await renderParent(lang, strict); await run(); await settle(pending[0]);
    const eventControl = select('suiteEventLabel', lang); eventControl.focus();
    await change(select('suiteEventLabel', lang), 'choch'); expect(state()).toBe('idle');
    await change(select('suiteEventLabel', lang), 'bos');
    expect(select('suiteEventLabel', lang)).toBe(eventControl); expect(document.activeElement).toBe(eventControl); expect(state()).toBe('idle'); expect(pending).toHaveLength(1);
  });

  it('does not revive an aborted pending run after A→B→A, even when transport settles late', async () => {
    document.documentElement.setAttribute('data-lang', lang); await renderParent(lang, false); await run();
    const old = pending[0]; await change(select('suiteEventLabel', lang), 'choch');
    expect(old.signal.aborted).toBe(true); expect(state()).toBe('idle');
    await change(select('suiteEventLabel', lang), 'bos');
    expect(state()).toBe('idle'); expect(go().disabled).toBe(false);
    await settle(old); expect(state()).toBe('idle'); expect(pending).toHaveLength(1);
  });

  it('a late old result cannot replace a newer explicit run', async () => {
    document.documentElement.setAttribute('data-lang', lang); await renderParent(lang, false); await run();
    const old = pending[0]; await change(select('suiteEventLabel', lang), 'choch'); await run();
    const fresh = pending[1]; expect(fresh.body.condition).toEqual(B);
    await settle(fresh, result(fresh, '2026-10-15T12:00:00.000Z', 'not_met'));
    await settle(old); expect(state()).toBe('result'); expect(panel().dataset.dryRunVerdict).toBe('not_met');
    expect(panel().textContent).toContain('2026-10-15 12:00 UTC');
  });
});

it('same-value new condition object and language rerenders retain a legitimate completed result', async () => {
  await renderChild(); await run(); await settle(pending[0]); const mountedPanel = panel();
  await renderChild({ ...A }); expect(panel()).toBe(mountedPanel); expect(state()).toBe('result');
  await act(async () => applyLang('zh'));
  expect(state()).toBe('result'); expect(panel().textContent).toContain(text('drVerdict.would_trigger', 'zh'));
  expect(pending).toHaveLength(1);
});

it('same-input rerender does not abort an in-flight request', async () => {
  await renderChild(); await run(); const old = pending[0]; await renderChild({ ...A });
  expect(old.signal.aborted).toBe(false); expect(state()).toBe('running');
  await settle(old); expect(state()).toBe('result');
});

it('null condition invalidates the prior result even when the component stays mounted', async () => {
  await renderChild(); await run(); await settle(pending[0]);
  await renderChild(null); expect(panel()).toBeNull();
  await renderChild(); expect(state()).toBe('idle'); expect(pending).toHaveLength(1);
});

it('an intermediate unavailable result is also retired across A→B→A', async () => {
  await renderChild(); await run(); await settle(pending[0], '<gateway>', 500); expect(state()).toBe('unavailable');
  await renderChild(B); await renderChild(A); expect(state()).toBe('idle');
});

it('Cancel still produces cancelled without a verdict and explicit retry succeeds', async () => {
  await renderChild(); await run();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="alert-dry-run-cancel"]')!.click());
  expect(pending[0].signal.aborted).toBe(true); await settle(pending[0]);
  expect(state()).toBe('cancelled'); expect(panel().dataset.dryRunVerdict).toBe('');
  await run(); await settle(pending[1]); expect(state()).toBe('result');
});

it('unmount aborts the current read and later remount starts idle', async () => {
  await renderChild(); await run(); const old = pending[0];
  await act(async () => root.render(null)); expect(old.signal.aborted).toBe(true);
  await settle(old); await renderChild(); expect(state()).toBe('idle'); expect(pending).toHaveLength(1);
});


it.each(['before-return', 'after-return'] as const)('aborted fetch rejection %s does not resurrect a retired cancellation', async order => {
  await renderChild(); await run(); const old = pending[0];
  await renderChild(B); expect(old.signal.aborted).toBe(true);
  if (order === 'before-return') await act(async () => old.reject(new DOMException('aborted', 'AbortError')));
  await renderChild(A);
  if (order === 'after-return') await act(async () => old.reject(new DOMException('aborted', 'AbortError')));
  expect(state()).toBe('idle'); expect(go().disabled).toBe(false);
  expect(panel().querySelector('[data-verdict]')).toBeNull(); expect(pending).toHaveLength(1);
});

it('old A settlement cannot cancel a new A run after A→B→A', async () => {
  await renderChild(); await run(); const old = pending[0];
  await renderChild(B); await renderChild(A); await run(); const fresh = pending[1];
  expect(fresh).toBeDefined(); expect(fresh.signal.aborted).toBe(false);
  await act(async () => old.reject(new DOMException('aborted', 'AbortError')));
  expect(state()).toBe('running'); expect(fresh.signal.aborted).toBe(false);
  await settle(fresh, result(fresh, '2026-10-15T12:00:00.000Z', 'not_met'));
  expect(state()).toBe('result'); expect(panel().dataset.dryRunVerdict).toBe('not_met');
});

it('a network error is retired across input changes and the next explicit run can succeed', async () => {
  await renderChild(); await run(); await act(async () => pending[0].reject(new TypeError('fixture network error')));
  expect(state()).toBe('unavailable'); await renderChild(B); await renderChild(A);
  expect(state()).toBe('idle'); await run(); await settle(pending[1]); expect(state()).toBe('result');
});

it('same-key invalid response stays unavailable and does not become a not-met result', async () => {
  await renderChild(); await run(); await settle(pending[0], { schema: 'alert-dry-run/1', readOnly: true, verdict: 'not_met' });
  expect(state()).toBe('unavailable'); await renderChild({ ...A }); expect(state()).toBe('unavailable');
  expect(panel().dataset.dryRunVerdict).toBe(''); expect(pending).toHaveLength(1);
});


it('a sequence window edit retires its result without changing the sequence payload', async () => {
  const sequence: SuiteSequenceCondition = { type: 'suite_sequence', suite: 'structure',
    steps: [{ event: 'bos', dir: 'bull' }, { event: 'choch', dir: 'bear' }], maxBarsBetween: 10 };
  await renderChild(sequence); await run(); expect(pending[0].body.condition).toEqual(sequence); await settle(pending[0]);
  await renderChild({ ...sequence, maxBarsBetween: 20 }); await renderChild(sequence);
  expect(state()).toBe('idle'); expect(pending).toHaveLength(1);
  await run(); expect(pending[1].body.condition).toEqual(sequence); await settle(pending[1]); expect(state()).toBe('result');
});

it('an abandoned transition to another input does not invalidate the still-committed result', async () => {
  const never = new Promise<void>(() => {});
  function Suspend({ enabled }: { enabled: boolean }) { if (enabled) throw never; return null; }
  function Tree({ condition, suspend }: { condition: Condition; suspend: boolean }) {
    return <LangProvider><Suspense fallback={<span>Waiting</span>}>
      <AlertDryRunPanel symbol="NVDA" condition={condition} signedIn locked={false} />
      <Suspend enabled={suspend} />
    </Suspense></LangProvider>;
  }
  await act(async () => root.render(<Tree condition={A} suspend={false} />)); await run(); await settle(pending[0]);
  const mountedPanel = panel();
  await act(async () => startTransition(() => root.render(<Tree condition={B} suspend />)));
  expect(panel()).toBe(mountedPanel); expect(state()).toBe('result'); expect(pending[0].signal.aborted).toBe(false);
  await act(async () => root.render(<Tree condition={{ ...A }} suspend={false} />));
  expect(panel()).toBe(mountedPanel); expect(state()).toBe('result'); expect(pending).toHaveLength(1);
});


// Regression found independently while reviewing the render-time-reset candidate.
// A speculative B must not consume valid updates for A while A is still committed.
describe.each([false, true])('pending A during suspended B (StrictMode=%s)', strict => {
  it.each(['fetch-success', 'json-success', 'fetch-error'] as const)('retains %s when B never commits', async ending => {
    const never = new Promise<void>(() => {});
    const commits: Condition[] = [];
    function Hold({ enabled }: { enabled: boolean }) { if (enabled) throw never; return null; }
    function Commit({ condition }: { condition: Condition }) {
      useLayoutEffect(() => { commits.push(condition); }, [condition]); return null;
    }
    function Tree({ condition, suspend = false }: { condition: Condition; suspend?: boolean }) {
      const tree = <LangProvider><Suspense fallback={<span>Waiting</span>}>
        <AlertDryRunPanel symbol="NVDA" condition={condition} signedIn locked={false} />
        <Hold enabled={suspend} /><Commit condition={condition} />
      </Suspense></LangProvider>;
      return strict ? <StrictMode>{tree}</StrictMode> : tree;
    }
    await act(async () => root.render(<Tree condition={A} />)); await run();
    const old = pending[0]; const mountedPanel = panel();
    let resolveBody!: (body: unknown) => void;
    if (ending === 'json-success') {
      const body = new Promise<unknown>(resolve => { resolveBody = resolve; });
      await act(async () => old.resolve({ status: 200, json: () => body } as Response));
    }
    await act(async () => startTransition(() => root.render(<Tree condition={B} suspend />)));
    expect(commits).not.toContain(B); expect(old.signal.aborted).toBe(false); expect(state()).toBe('running');
    if (ending === 'fetch-success') await settle(old);
    else if (ending === 'json-success') await act(async () => resolveBody(result(old)));
    else await act(async () => old.reject(new TypeError('current A failed')));
    const expected = ending === 'fetch-error' ? 'unavailable' : 'result';
    expect(panel()).toBe(mountedPanel); expect(state()).toBe(expected); expect(commits).not.toContain(B);
    await act(async () => root.render(<Tree condition={{ ...A }} />));
    expect(panel()).toBe(mountedPanel); expect(state()).toBe(expected);
    expect(old.signal.aborted).toBe(false); expect(pending).toHaveLength(1);
  });
});

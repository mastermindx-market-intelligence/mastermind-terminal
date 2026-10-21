/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import golden from './fixtures/aapl-event-workspace.json';
import MonitorEventAttention from '@/components/workspaces/MonitorEventAttention';
vi.mock('next/link', () => ({default: ({children, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props, children)}));
const { load, openSignin } = vi.hoisted(() => ({load: vi.fn(), openSignin: vi.fn()}));
vi.mock('@/components/onboarding/OnboardingProvider', () => ({useOnboarding: () => ({open: openSignin})}));
vi.mock('@/lib/companyRetainedContext', async () => ({
  ...await vi.importActual<typeof import('@/lib/companyRetainedContext')>('@/lib/companyRetainedContext'),
  loadCompanyRetainedContext: load,
}));
const receipt = {
  schema: 'earnings.retained_baseline.v1', owner: 'earnings.workspace_generation',
  company_id: golden.issuer.company_id, event_id: golden.event_id, generation_id: golden.generation_id,
  workspace_schema: golden.schema, manifest_schema: 'event_workspace_manifest.v1', authority: 'context_only',
  manifest_sha256: 'a'.repeat(64), manifest_bytes: 2048, workspace_sha256: 'b'.repeat(64), workspace_bytes: 4096,
  fingerprint: 'c'.repeat(64), public_known_at: golden.lifecycle.source_available_at,
  platform_known_at: golden.lifecycle.observed_at, generation_emitted_at: '2026-10-21T12:00:00Z',
  rights: {allowed: true, policy_version: 'fixture-retained-context.v1', checked_at: '2026-10-21T12:00:00Z'},
};
const success = (name = golden.issuer.display_name, symbol = 'AAPL') => ({ok: true,
  workspace: {...golden, issuer: {...golden.issuer, display_name: name, listings: [{...golden.issuer.listings[0], ticker: symbol}]}}, receipt});
type Props = Parameters<typeof MonitorEventAttention>[0];
let props: Props;
let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  openSignin.mockReset(); load.mockReset(); load.mockResolvedValue(success());
  props = {subjectId: '6ed52847-3cbe-49d2-b54d-33d39ef482cf', selection: {listId: 'owned-list', symbol: 'AAPL'}, lang: 'en'};
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); }); root = null; host.remove(); vi.useRealTimers();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
});
async function render(change: Partial<Props> = {}) {
  props = {...props, ...change}; const active = root ?? (root = createRoot(host));
  await act(async () => { active.render(createElement(MonitorEventAttention, props)); });
}
const text = () => host.textContent ?? '';
const phase = () => host.querySelector('[data-event-attention-state]')?.getAttribute('data-event-attention-state');
const target = () => host.querySelector<HTMLAnchorElement>('a[href^="/analysis?"]');
const failure = (reason: string) => ({ok: false, code: 'HISTORICAL_UNAVAILABLE', reason});

describe('Monitor event evidence lifetime and target contract', () => {
  it('does not read until one saved membership is explicitly selected', async () => {
    await render({selection: null}); expect(phase()).toBe('idle'); expect(load).not.toHaveBeenCalled();
    await render({selection: {listId: 'owned-list', symbol: 'AAPL'}});
    expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0][0].symbol).toBe('AAPL');
  });
  it('shows the source clock and exports the exact immutable four-pin sources target', async () => {
    await render(); expect(phase()).toBe('ready');
    const query = new URL(target()!.href).searchParams;
    expect([...query.keys()].sort()).toEqual(['ci_company','ci_event','ci_fingerprint','ci_generation','ci_lens','page','symbol']);
    // MegaPane mounts the retained Company consumer only on its intelligence page.
    expect(query.get('page')).toBe('intelligence');
    expect(query.get('symbol')).toBe('AAPL'); expect(query.get('ci_event')).toBe(golden.event_id);
    expect(query.get('ci_generation')).toBe(golden.generation_id); expect(query.get('ci_company')).toBe(receipt.company_id);
    expect(query.get('ci_fingerprint')).toBe(receipt.fingerprint); expect(query.get('ci_lens')).toBe('sources');
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe(receipt.public_known_at);
    expect(text()).toContain('2026-07-30'); expect(text()).not.toContain('2026-10-21');
    expect(text()).toContain('Fiscal Q3 2026'); expect(text()).not.toMatch(/new since|urgent/i);
  });
  it('preserves an unknown source date and the owner partial-coverage qualification', async () => {
    const value = success(); load.mockResolvedValue({...value, receipt: {...receipt, public_known_at: null},
      workspace: {...value.workspace, lifecycle: {...golden.lifecycle, state: 'partial'}}});
    await render(); expect(phase()).toBe('ready'); expect(text()).toContain('Source date unavailable');
    expect(text()).toContain('Some event coverage is incomplete'); expect(host.querySelector('time')).toBeNull();
  });
  it('keeps quiet source coverage distinct from missing or failed reads', async () => {
    const value = success(); load.mockResolvedValue({...value, workspace: {...value.workspace, sources: []}});
    await render(); expect(phase()).toBe('quiet'); expect(target()?.textContent).toBe('Inspect source coverage');
    expect(text()).toContain('No byte-replayed source evidence is available');
    expect(text()).not.toMatch(/nothing happened|no changes/i);
  });
  it.each([
    ['unauthenticated','restricted'], ['rights_denied','restricted'], ['missing_generation','missing'],
    ['invalid_reference:symbol_not_canonical','missing'], ['rights_unavailable','unavailable'], ['unreachable','unavailable'],
  ])('keeps %s as %s with no manufactured target', async (reason, expected) => {
    load.mockResolvedValue(failure(reason)); await render(); expect(phase()).toBe(expected); expect(target()).toBeNull();
    expect(host.querySelector('a[href="/login"]')).toBeNull();
  });
  it('keeps source addresses inspectable without claiming byte-replayed coverage', async () => {
    const value = success(); load.mockResolvedValue({...value, workspace: {...value.workspace,
      sources: golden.sources.map(source => ({...source, receipt_state: 'address_only'}))}});
    await render(); expect(phase()).toBe('quiet'); expect(text()).toContain('Any source addresses remain inspectable.');
    expect(target()?.textContent).toBe('Inspect source coverage');
  });
  it('recovers sign-in in place, retaining the selection until an explicit recheck', async () => {
    load.mockResolvedValue(failure('unauthenticated')); await render();
    const location = window.location.href;
    await act(async () => {Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Sign in')?.click();});
    expect(openSignin).toHaveBeenCalledWith('signin'); expect(window.location.href).toBe(location);
    expect(phase()).toBe('restricted'); expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValue(success('AFTER-SIGNIN'));
    await act(async () => {Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Check again')?.click();});
    expect(phase()).toBe('ready'); expect(load.mock.calls[1][0].symbol).toBe('AAPL'); expect(text()).toContain('AFTER-SIGNIN');
  });
  it('does not request an unsupported symbol', async () => {
    await render({selection: {listId: 'owned-list', symbol: 'not a listing?'}});
    expect(phase()).toBe('missing'); expect(load).not.toHaveBeenCalled(); expect(target()).toBeNull();
  });
  it.each(['listing','company','event','generation'] as const)('rejects a response for the wrong %s', async mismatch => {
    const value = success();
    if (mismatch === 'listing') value.workspace.issuer.listings[0].ticker = 'MSFT';
    if (mismatch === 'company') value.workspace.issuer.company_id = 'cik:0000000001';
    if (mismatch === 'event') value.workspace.event_id = 'evt_wrong_event';
    if (mismatch === 'generation') value.workspace.generation_id = 'different-generation';
    load.mockResolvedValue(value); await render(); expect(phase()).toBe('unavailable'); expect(target()).toBeNull();
  });
  it('rejects an invalid receipt instead of constructing its pins', async () => {
    load.mockResolvedValue({...success(), receipt: {...receipt, fingerprint: 'invalid'}});
    await render(); expect(phase()).toBe('unavailable'); expect(target()).toBeNull();
  });
  it('bounds a hanging helper, ignores its late completion and permits an explicit retry', async () => {
    vi.useFakeTimers(); let finish!: (value: unknown) => void;
    load.mockReturnValue(new Promise(resolve => {finish = resolve;}));
    await render(); const signal = load.mock.calls[0][0].signal as AbortSignal;
    expect(phase()).toBe('loading');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(phase()).toBe('timeout'); expect(signal.aborted).toBe(true); expect(target()).toBeNull();
    await act(async () => { finish(success('LATE')); });
    expect(phase()).toBe('timeout'); expect(text()).not.toContain('LATE');
    load.mockResolvedValue(success('RETRIED'));
    await act(async () => { host.querySelector('button')?.click(); });
    expect(phase()).toBe('ready'); expect(text()).toContain('RETRIED'); expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not revive an earlier account result on A→B→A', async () => {
    let oldA!: (value: unknown) => void, newA!: (value: unknown) => void;
    load.mockReturnValueOnce(new Promise(resolve => {oldA = resolve;})); await render();
    const firstSignal = load.mock.calls[0][0].signal as AbortSignal;
    load.mockResolvedValueOnce(success('CURRENT-B')); await render({subjectId: 'other-owner'});
    expect(firstSignal.aborted).toBe(true); expect(text()).toContain('CURRENT-B');
    load.mockReturnValueOnce(new Promise(resolve => {newA = resolve;}));
    await render({subjectId: '6ed52847-3cbe-49d2-b54d-33d39ef482cf'});
    await act(async () => {oldA(success('OLD-A'));});
    expect(phase()).toBe('loading'); expect(text()).not.toContain('OLD-A'); expect(target()).toBeNull();
    await act(async () => {newA(success('NEW-A'));}); expect(text()).toContain('NEW-A');
  });
  it('clears the old target while a different selected symbol is checked', async () => {
    let old!: (value: unknown) => void;
    load.mockReturnValueOnce(new Promise(resolve => {old = resolve;})); await render();
    load.mockResolvedValueOnce(success('MICROSOFT-FIXTURE', 'MSFT'));
    await render({selection: {listId: 'second-list', symbol: 'MSFT'}});
    await act(async () => {old(success('OLD-AAPL'));});
    expect(text()).not.toContain('OLD-AAPL'); expect(new URL(target()!.href).searchParams.get('symbol')).toBe('MSFT');
  });
  it('aborts and clears its deadline when unmounted', async () => {
    vi.useFakeTimers(); load.mockReturnValue(new Promise(() => {})); await render();
    const signal = load.mock.calls[0][0].signal as AbortSignal;
    await act(async () => {root?.unmount();}); root = null;
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('switches locale without another source request', async () => {
    await render(); await render({lang: 'zh'});
    expect(load).toHaveBeenCalledTimes(1); expect(text()).toContain('事件证据'); expect(text()).toContain('打开已保留事件证据');
    expect(text()).not.toContain('Available retained event version'); expect(text()).not.toContain('Open retained event evidence');
  });
});

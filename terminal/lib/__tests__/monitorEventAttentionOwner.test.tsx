/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import golden from './fixtures/aapl-event-workspace.json';
import MonitorEventAttention from '@/components/workspaces/MonitorEventAttention';
vi.mock('next/link', () => ({default: ({children, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props, children)}));

vi.mock('@/components/onboarding/OnboardingProvider', () => ({useOnboarding: () => ({open: vi.fn()})}));
const receipt = {
  schema: 'earnings.retained_baseline.v1', owner: 'earnings.workspace_generation',
  company_id: golden.issuer.company_id, event_id: golden.event_id, generation_id: golden.generation_id,
  workspace_schema: golden.schema, manifest_schema: 'event_workspace_manifest.v1', authority: 'context_only',
  manifest_sha256: 'a'.repeat(64), manifest_bytes: 2048, workspace_sha256: 'b'.repeat(64), workspace_bytes: 4096,
  fingerprint: 'c'.repeat(64), public_known_at: golden.lifecycle.source_available_at,
  platform_known_at: golden.lifecycle.observed_at, generation_emitted_at: golden.generated_at,
  rights: { allowed: true, policy_version: 'fixture-retained-context.v1', checked_at: '2026-10-21T12:00:00Z' },
};
let root: Root | null;
let host: HTMLDivElement;
const requests: string[] = [];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  requests.length = 0;
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null; host.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});
async function mount(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    requests.push(String(url));
    return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
  }));
  root = createRoot(host);
  await act(async () => { root!.render(createElement(MonitorEventAttention, {
    subjectId: '6ed52847-3cbe-49d2-b54d-33d39ef482cf', selection: {listId: 'owned-list', symbol: 'AAPL'}, lang: 'en',
  })); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
async function mountTransport(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl); root = createRoot(host);
  await act(async () => { root!.render(createElement(MonitorEventAttention, {
    subjectId: '6ed52847-3cbe-49d2-b54d-33d39ef482cf', selection: {listId: 'owned-list', symbol: 'AAPL'}, lang: 'en',
  })); });
}
describe('Monitor composed with the real retained Company client at the HTTP boundary', () => {
  it.each(['fetch', 'success-body', 'failure-body'] as const)('bounds an actual helper hung at %s through the consumer deadline', async boundary => {
    vi.useFakeTimers(); let signal: AbortSignal | null | undefined;
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      if (boundary === 'fetch') return await new Promise<Response>(() => {});
      if (boundary === 'success-body') return {ok: true, status: 200, json: () => new Promise(() => {})} as Response;
      return new Response(new ReadableStream<Uint8Array>({start() {}}), {status: 503});
    });
    await mountTransport(transport);
    expect(host.querySelector('[data-event-attention-state="loading"]')).not.toBeNull();
    await act(async () => {await vi.advanceTimersByTimeAsync(10_001);});
    expect(signal?.aborted).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-event-attention-state="timeout"]')).not.toBeNull();
    expect(host.querySelector('a[href^="/analysis?"]')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps an owner departure closed while the actual helper awaits a response body', async () => {
    let finish!: (body: unknown) => void; let signal: AbortSignal | null | undefined;
    await mountTransport(vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return {ok: true, status: 200, json: () => new Promise(resolve => {finish = resolve;})} as Response;
    }));
    await act(async () => {root!.render(createElement(MonitorEventAttention, {
      subjectId: 'another-owner', selection: null, lang: 'en',
    }));});
    expect(signal?.aborted).toBe(true);
    await act(async () => {finish({ok: true, workspace: golden, receipt});});
    expect(host.querySelector('[data-event-attention-state="idle"]')).not.toBeNull();
    expect(host.querySelector('a[href^="/analysis?"]')).toBeNull();
  });
  it.each([
    ['denied', 'restricted'], ['missing_generation', 'missing'], ['rights_unavailable', 'unavailable'],
  ])('preserves typed HTTP503 %s as %s without an investigation target', async (reason, expected) => {
    await mount({ok: false, code: 'HISTORICAL_UNAVAILABLE', reason}, 503);
    expect(host.querySelector('[data-event-attention-state]')?.getAttribute('data-event-attention-state')).toBe(expected);
    expect(host.querySelector('a[href^="/analysis?"]')).toBeNull();
    expect(requests).toEqual(['/api/investigations/baseline?scope=company_context&symbol=AAPL']);
  });
  it('never promotes an ok:true response at HTTP503 into available evidence', async () => {
    await mount({ok: true, workspace: golden, receipt}, 503);
    expect(host.querySelector('[data-event-attention-state="unavailable"]')).not.toBeNull();
    expect(host.querySelector('a[href^="/analysis?"]')).toBeNull();
  });
  it('binds the displayed source date and exact destination through the actual successful helper', async () => {
    await mount({ok: true, workspace: golden, receipt});
    expect(host.querySelector('[data-event-attention-state="ready"]')).not.toBeNull();
    const href = host.querySelector('a[href^="/analysis?"]')?.getAttribute('href');
    expect(href).toBeTruthy();
    const query = new URL(href!, 'https://terminal.test').searchParams;
    // MegaPane mounts the retained Company consumer only on its intelligence page.
    expect(query.get('page')).toBe('intelligence');
    expect(query.get('symbol')).toBe('AAPL'); expect(query.get('ci_lens')).toBe('sources');
    expect(query.get('ci_event')).toBe(golden.event_id); expect(query.get('ci_generation')).toBe(golden.generation_id);
    expect(query.get('ci_company')).toBe(receipt.company_id); expect(query.get('ci_fingerprint')).toBe(receipt.fingerprint);
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe(receipt.public_known_at);
    expect(requests).toHaveLength(1);
  });
  it('does not expose a source target when a valid receipt answers for another listing', async () => {
    await mount({ok: true, workspace: {...golden, issuer: {...golden.issuer, listings: [{...golden.issuer.listings[0], ticker: 'MSFT'}]}}, receipt});
    expect(host.querySelector('[data-event-attention-state="unavailable"]')).not.toBeNull();
    expect(host.querySelector('a[href^="/analysis?"]')).toBeNull();
  });
});

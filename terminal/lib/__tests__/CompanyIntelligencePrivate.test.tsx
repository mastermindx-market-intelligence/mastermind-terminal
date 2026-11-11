// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountIdentity } from '@/lib/accountIdentity';
import CompanyIntelligencePrivate from '@/components/fin/CompanyIntelligencePrivate';
import { applyLang, LangProvider } from '@/lib/i18n';

const probe = vi.hoisted(() => ({
  fail: false,
  mounted: [] as string[],
  unmounted: [] as string[],
  renders: 0,
}));

vi.mock('@/lib/usePrivateCompanyIntelligence', () => ({
  usePrivateCompanyIntelligence(identity: AccountIdentity, symbol: string | null) {
    const key = `${identity.kind === 'account' ? identity.userId : 'guest'}:${symbol}`;
    const initialKey = useRef(key);
    useEffect(() => {
      const mountedKey = initialKey.current;
      probe.mounted.push(mountedKey);
      return () => { probe.unmounted.push(mountedKey); };
    }, []);
    return { state: { status: 'loading', query: symbol, viewKey: key }, selectFact: vi.fn() };
  },
}));

vi.mock('@/components/fin/CompanyIntelligencePrivatePanel', () => ({
  default() {
    probe.renders += 1;
    if (probe.fail) throw new Error('PRIVATE_EXCEPTION_SENTINEL');
    return <div data-testid="private-content">PRIVATE_CONTENT_SENTINEL</div>;
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const owner: AccountIdentity = { kind: 'account', userId: 'owner-a', email: 'same@example.test' };

async function render(identity: AccountIdentity = owner, symbol: string | null = 'GOOG', enabled = true) {
  await act(async () => {
    root.render(<LangProvider>
      <p data-testid="public-sibling">PUBLIC_CONTENT_SENTINEL</p>
      <CompanyIntelligencePrivate identity={identity} symbol={symbol} enabled={enabled} />
    </LangProvider>);
  });
}

beforeEach(() => {
  probe.fail = false;
  probe.mounted = [];
  probe.unmounted = [];
  probe.renders = 0;
  document.documentElement.setAttribute('data-lang', 'en');
  container = document.createElement('div');
  document.body.appendChild(container);
  // React's test root owns the caught-error diagnostic; the feature forwards none.
  root = createRoot(container, { onCaughtError: () => {} });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.documentElement.setAttribute('data-lang', 'en');
});

describe('isolated private host composition', () => {
  it('does not mount its controller while hidden and unmounts when leaving', async () => {
    await render(owner, 'GOOG', false);
    expect(probe.mounted).toEqual([]);
    await render();
    expect(probe.mounted).toEqual(['owner-a:GOOG']);
    await render(owner, 'GOOG', false);
    expect(probe.unmounted).toEqual(['owner-a:GOOG']);
    expect(container.textContent).not.toContain('PRIVATE_CONTENT_SENTINEL');
    expect(container.textContent).toContain('PUBLIC_CONTENT_SENTINEL');
  });

  it('keeps a same-UUID email edit in the same private lifetime', async () => {
    await render();
    await render({ ...owner, email: 'changed@example.test' });
    expect(probe.mounted).toEqual(['owner-a:GOOG']);
    expect(probe.unmounted).toEqual([]);
  });

  it('uses a fresh lifetime for a different UUID even with the same email', async () => {
    await render();
    await render({ ...owner, userId: 'owner-b' });
    expect(probe.unmounted).toEqual(['owner-a:GOOG']);
    expect(probe.mounted).toEqual(['owner-a:GOOG', 'owner-b:GOOG']);
  });

  it('unmounts each query lifetime across A to B to A', async () => {
    await render();
    await render(owner, 'GOOGL');
    await render();
    expect(probe.mounted).toEqual(['owner-a:GOOG', 'owner-a:GOOGL', 'owner-a:GOOG']);
    expect(probe.unmounted).toEqual(['owner-a:GOOG', 'owner-a:GOOGL']);
  });

  it('contains render failure with constant copy and preserves the public sibling', async () => {
    await render();
    probe.fail = true;
    await render();
    expect(container.textContent).toContain('Private company context is unavailable.');
    expect(container.textContent).toContain('PUBLIC_CONTENT_SENTINEL');
    expect(container.textContent).not.toMatch(/PRIVATE_(?:CONTENT|EXCEPTION)_SENTINEL/);
    expect(probe.unmounted).toEqual(['owner-a:GOOG']);
  });

  it('never retries a render failure on locale, email or unchanged host renders', async () => {
    probe.fail = true;
    await render();
    const attempts = probe.renders;
    probe.fail = false;
    await render({ ...owner, email: 'changed@example.test' });
    await act(async () => { applyLang('zh'); });
    expect(probe.renders).toBe(attempts);
    expect(container.textContent).toContain('私有公司背景暂不可用。');
    expect(container.textContent).not.toContain('Private company context is unavailable.');
    expect(container.textContent).not.toContain('PRIVATE_CONTENT_SENTINEL');
  });

  it('permits a later intentional query navigation to start a new lifetime', async () => {
    probe.fail = true;
    await render();
    probe.fail = false;
    await render(owner, 'GOOGL');
    expect(container.textContent).toContain('PRIVATE_CONTENT_SENTINEL');
    expect(probe.mounted).toEqual(['owner-a:GOOGL']);
  });
});

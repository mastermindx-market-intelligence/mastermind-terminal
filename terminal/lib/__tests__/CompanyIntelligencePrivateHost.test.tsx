// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountIdentity } from '@/lib/accountIdentity';
import MegaPane from '@/components/fin/MegaPane';
import AnalysisWorkspace from '@/components/workspaces/AnalysisWorkspace';

const probe = vi.hoisted(() => ({
  identity: { kind: 'account', userId: 'owner-a', email: 'same@example.test' } as AccountIdentity,
  cursor: 'SMR' as string | null,
  reads: [] as { identity: AccountIdentity; symbol: string | null }[],
  publicState: 'loading',
  privateFailure: false,
}));

// Exercise the real host and private wrapper. Controller/decoder behavior has its
// own accepted suite; this probe observes whether hosts actually enable it.
vi.mock('@/lib/usePrivateCompanyIntelligence', () => ({
  usePrivateCompanyIntelligence(identity: AccountIdentity, symbol: string | null) {
    probe.reads.push({ identity, symbol });
    return { state: { query: symbol }, selectFact: vi.fn() };
  },
}));
vi.mock('@/components/fin/CompanyIntelligencePrivatePanel', () => ({
  default({ state }: { state: { query: string | null } }) {
    if (probe.privateFailure) throw new Error('PRIVATE_HOST_ERROR');
    return <div data-private>{state.query}</div>;
  },
}));
vi.mock('@/components/fin/CompanyIntelligencePage', () => ({
  default() { return <div data-public>{probe.publicState}<button>Public retry</button></div>; },
}));
vi.mock('@/components/chrome/AppShell', () => ({ useShellIdentity: () => probe.identity }));
vi.mock('@/lib/i18n', () => ({
  useLang: () => ({ lang: 'en' }),
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('next/link', () => ({
  default({ children, ...props }: ComponentProps<'a'>) { return <a {...props}>{children}</a>; },
}));
vi.mock('@/lib/activeSymbol', () => ({ readActiveSymbol: () => probe.cursor, writeActiveSymbol: vi.fn() }));
vi.mock('@/lib/shellBrainSymbol', () => ({ announceShellBrainSymbol: vi.fn() }));
vi.mock('@/lib/fund', () => ({ getFund: () => new Promise(() => {}), getBars: () => new Promise(() => {}) }));
vi.mock('@/lib/dataCache', () => ({ getJSON: () => new Promise(() => {}) }));
vi.mock('@/components/SymbolPicker', () => ({ default: () => null }));
vi.mock('@/components/workspaces/MarketOntologyContextStrip', () => ({ default: () => null }));
vi.mock('@/components/fin/OverviewPage', () => ({ default: () => <p>Public overview</p> }));
vi.mock('@/components/fin/StatementsPage', () => ({ default: () => null }));
vi.mock('@/components/fin/StatisticsPage', () => ({ default: () => null }));
vi.mock('@/components/fin/DividendsPage', () => ({ default: () => null }));
vi.mock('@/components/fin/EarningsPage', () => ({ default: () => null }));
vi.mock('@/components/fin/RevenuePage', () => ({ default: () => null }));
vi.mock('@/components/fin/ForecastPage', () => ({ default: () => null }));
vi.mock('@/components/fin/TechnicalsPage', () => ({ default: () => null }));
vi.mock('@/components/fin/SeasonalsPage', () => ({ default: () => null }));
vi.mock('@/components/fin/OwnershipPage', () => ({ default: () => null }));
vi.mock('@/components/fin/InsiderPage', () => ({ default: () => null }));
vi.mock('@/components/fin/TechLabPanel', () => ({ default: () => null }));
vi.mock('@/components/fin/TranscriptDrawer', () => ({ default: () => null }));
vi.mock('@/components/fin/TranscriptsPage', () => ({ default: () => null }));
vi.mock('@/components/fin/FinComparePage', () => ({ default: () => null }));
vi.mock('@/components/fin/ResearchWorkspaceNav', () => ({ default: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function pane(overrides: Partial<ComponentProps<typeof MegaPane>> = {}) {
  await act(async () => {
    root.render(<MegaPane sym="GOOG" fund={null} page="intelligence"
      onPage={() => {}} onClose={() => {}} mode="workspace" {...overrides} />);
  });
}

beforeEach(() => {
  probe.identity = { kind: 'account', userId: 'owner-a', email: 'same@example.test' };
  probe.cursor = 'SMR';
  probe.reads = [];
  probe.publicState = 'loading';
  probe.privateFailure = false;
  window.history.replaceState(null, '', '/analysis');
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container, { onCaughtError: () => {} });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe('private intelligence in existing shared hosts', () => {
  it('defaults disabled and preserves public intelligence with missing identity/readiness', async () => {
    await pane();
    await pane({ identity: probe.identity });
    expect(probe.reads).toEqual([]);
    expect(container.querySelector('[data-private]')).toBeNull();
    expect(container.querySelector('[data-public]')).not.toBeNull();
  });

  it('passes canonical ownership and exact symbols independently of public loading and error', async () => {
    await pane({ identity: probe.identity, privateEnabled: true, sym: 'BRK.B' });
    expect(probe.reads.at(-1)).toEqual({ identity: probe.identity, symbol: 'BRK.B' });
    expect(container.querySelector('[data-private]')?.textContent).toBe('BRK.B');
    probe.publicState = 'error';
    await pane({ identity: probe.identity, privateEnabled: true, sym: 'BRK-B' });
    expect(probe.reads.at(-1)?.symbol).toBe('BRK-B');
    expect(container.querySelector('[data-public]')?.textContent).toContain('error');
    expect(container.querySelector('[data-private]')?.textContent).toBe('BRK-B');
  });

  it('clears the private subtree when readiness is revoked or intelligence is left', async () => {
    await pane({ identity: probe.identity, privateEnabled: true });
    expect(container.querySelector('[data-private]')).not.toBeNull();
    const before = probe.reads.length;
    await pane({ identity: probe.identity, privateEnabled: false });
    expect(container.querySelector('[data-private]')).toBeNull();
    expect(probe.reads).toHaveLength(before);
    await pane({ identity: probe.identity, privateEnabled: true, page: 'overview' });
    expect(container.textContent).toContain('Public overview');
    expect(probe.reads).toHaveLength(before);
  });

  it('passes UUID replacement and sign-out without substituting the display email', async () => {
    await pane({ identity: probe.identity, privateEnabled: true });
    const next: AccountIdentity = { kind: 'account', userId: 'owner-b', email: 'same@example.test' };
    await pane({ identity: next, privateEnabled: true });
    expect(probe.reads.at(-1)?.identity).toEqual(next);
    await pane({ identity: { kind: 'guest' }, privateEnabled: true });
    expect(probe.reads.at(-1)?.identity).toEqual({ kind: 'guest' });
  });

  it('keeps public content and retry available when the private subtree fails', async () => {
    probe.privateFailure = true;
    await pane({ identity: probe.identity, privateEnabled: true });
    expect(container.textContent).toContain('Private company context is unavailable.');
    expect(container.textContent).toContain('Public retry');
    expect(container.textContent).not.toContain('PRIVATE_HOST_ERROR');
  });

  it('uses Analysis identity and settled cursor without a private default-company request', async () => {
    await act(async () => { root.render(<AnalysisWorkspace initialPage="intelligence" />); });
    expect(probe.reads.length).toBeGreaterThan(0);
    expect(probe.reads.every(x => x.symbol === 'SMR' && x.identity === probe.identity)).toBe(true);
    expect(container.querySelector('[data-private]')?.textContent).toBe('SMR');
  });

  it('does not mount private intelligence for a malformed Analysis symbol', async () => {
    await act(async () => { root.render(<AnalysisWorkspace initialSymbol="GOOG/GOOGL" initialPage="intelligence" />); });
    expect(probe.reads).toEqual([]);
    expect(container.querySelector('[data-private]')).toBeNull();
    expect(container.textContent).toContain('not a supported symbol format');
  });

  // The two heavy chart compositions share one host component but are distinct
  // call sites. Inspect their actual JSX, alongside the host behavior above, so
  // omitting the identity/readiness input from either is a failing contract.
  it('binds both actual chart call sites to canonical identity and preference hydration', () => {
    const source = ts.createSourceFile('TerminalShell.tsx', readFileSync('components/TerminalShell.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: ts.JsxAttributes[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'MegaPane') calls.push(node.attributes);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(calls).toHaveLength(2);
    for (const attrs of calls) {
      const values = Object.fromEntries(attrs.properties.filter(ts.isJsxAttribute).map(attr => [
        attr.name.getText(source), attr.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression?.getText(source) : undefined,
      ]));
      expect(values).toMatchObject({ identity: 'identity', privateEnabled: 'prefsHydrated', sym: 'active' });
    }
  });
});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CompanyIntelligencePrivatePanel from '@/components/fin/CompanyIntelligencePrivatePanel';
import { PRIVATE_COMPANY_LEX } from '@/lib/companyIntelligencePrivateLex';
import type { PrivateCompanyPassiveStatus, PrivateCompanyReadyState, PrivateCompanyViewState } from '@/lib/companyIntelligencePrivateView';
import { applyLang, LangProvider } from '@/lib/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Synthetic typed presentation inputs. These grant no identity or disclosure authority.
function ready(): PrivateCompanyReadyState {
  const identityReceipt = {
    schema: 'company_intelligence.current_issuer_identity/v1', identity_mode: 'current',
    issuer_id: 'ISS:US-XNAS-TEST', evidenced_cik: '0000000001', source_commit: 'b'.repeat(40),
    sources: {
      security_master: { sha256: '1'.repeat(64), byte_length: 512 },
      vendor_aliases: { sha256: '2'.repeat(64), byte_length: 512 },
      issuer_master: { sha256: '3'.repeat(64), byte_length: 512 },
    },
    evidence_source: 'sec_company_tickers', evidence_snapshot: '2026-10-10',
  } as const;
  const issuerBinding = {
    issuer_id: identityReceipt.issuer_id, evidenced_cik: identityReceipt.evidenced_cik,
    identity_snapshot_reference: {
      schema: identityReceipt.schema,
      sha256: 'b94c988b5b1463c0e57f8d83b74be7f87fc4715efa418470fcf5e1f74fedce90', byte_length: 629,
    },
  };
  const factId = 'integration:' + 'a'.repeat(64);
  const reference = { schema: 'company_intelligence.product_integration_fact/v1', sha256: 'a'.repeat(64), byte_length: 512 };
  const edition = { schema: 'company_intelligence.issuer_disclosure_edition/v1', sha256: 'e'.repeat(64), byte_length: 1024 };
  return {
    status: 'ready', viewKey: 'synthetic-lifetime-1', query: 'GOOG', selectedFactId: factId,
    context: {
      schema: 'company_intelligence.private_company_context/v1', identity_mode: 'current',
      query: { namespace: 'store', symbol: 'GOOG' }, security_id: 'SEC:US-XNAS-GOOG',
      issuer_binding: issuerBinding, identity_receipt: identityReceipt,
    },
    selection: {
      schema: 'company_intelligence.private_issuer_selections/v1', generation: 'synthetic-generation',
      identity_mode: 'current', issuer_role: 'subject_disclosing_company', issuer_binding: issuerBinding,
      selections: [{ fact_id: factId, fact_reference: reference, edition_reference: edition, kind: 'product_integration', lifecycle: 'planned' }],
    },
    fact: {
      schema: 'company_intelligence.private_product_integration/v2', generation: 'synthetic-generation',
      authority: 'context_only', reference, edition,
      source_timing: { published_date: '2024-02-26', published_at: null, publication_precision: 'date', known_at: '2024-02-26T09:05:30.123456+08:00' },
      fact: { fact_id: factId, kind: 'product_integration', lifecycle: 'planned', subject_id: issuerBinding.issuer_id, product: 'PRIVATE_PRODUCT_SENTINEL', platform: 'PRIVATE_PLATFORM_SENTINEL' },
    },
  };
}

let root: Root;
let container: HTMLDivElement;
const select = vi.fn();
const signIn = vi.fn();

async function render(state: PrivateCompanyViewState, presentation: 'dark' | 'light' = 'dark') {
  await act(async () => {
    root.render(<LangProvider><CompanyIntelligencePrivatePanel state={state} onSelectFact={select} onSignIn={signIn} presentation={presentation} /></LangProvider>);
  });
}

beforeEach(() => {
  select.mockClear(); signIn.mockClear();
  document.documentElement.setAttribute('data-lang', 'en');
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); document.documentElement.setAttribute('data-lang', 'en');
});

describe('private presentation', () => {
  it('keeps one live status node across loading and ready settlement', async () => {
    await render({ status: 'loading', query: 'GOOG', viewKey: 'loading' });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe(PRIVATE_COMPANY_LEX.loading[0]);
    await render(ready());
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe(PRIVATE_COMPANY_LEX.currentSelection[0]);
  });
  it('renders the pinned EN and ZH copy without cross-locale fallback', async () => {
    await render(ready());
    expect(container.textContent).toContain('Product integrations');
    expect(container.textContent).toContain('Disclosed as planned on 2024-02-26');
    expect(container.textContent).toContain('Source announcement timing only. No delivery schedule or commercial figures.');
    expect(container.textContent).not.toContain('no timing');
    expect(container.textContent).not.toMatch(/[\u3400-\u9fff]/);
    await act(async () => applyLang('zh'));
    expect(container.textContent).toContain('产品整合');
    expect(container.textContent).toContain('2024-02-26披露时为计划');
    expect(container.textContent).toContain('仅含来源公告时间，不含交付计划或商业规模数据。');
    expect(container.textContent).not.toContain('Product integrations');
    expect(container.textContent).not.toContain('Research context only.');
    expect(container.querySelector('section')?.getAttribute('lang')).toBe('zh');
  });

  const passive: PrivateCompanyPassiveStatus[] = ['guest', 'unselected', 'unsupported', 'access_unknown', 'missing_feature', 'loading', 'metadata_only', 'source_unavailable', 'selection_changed', 'empty'];
  it.each(passive)('removes all old fact and reference DOM on %s, even if stale properties are supplied', async status => {
    const previous = ready();
    await render(previous);
    expect(container.textContent).toContain('PRIVATE_PRODUCT_SENTINEL');
    await render({ ...previous, status, viewKey: 'next' });
    expect(container.textContent).not.toMatch(/PRIVATE_(?:PRODUCT|PLATFORM)_SENTINEL/);
    expect(container.textContent).not.toContain(previous.fact.reference.sha256);
    expect(container.textContent).not.toContain(previous.context.issuer_binding.issuer_id);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('keeps the current selector during a fact read while removing prior fields and references', async () => {
    const previous = ready();
    await render(previous);
    await render({ ...previous, status: 'selecting', viewKey: 'next-selection' });
    expect(container.querySelector('select')).not.toBeNull();
    expect(container.textContent).toContain('Reading private company context…');
    expect(container.textContent).not.toContain('PRIVATE_PRODUCT_SENTINEL');
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('preserves a ready fact with both optional labels absent', async () => {
    const state = ready();
    const fact = { ...state.fact.fact, product: undefined, platform: undefined };
    await render({ ...state, fact: { ...state.fact, fact } });
    expect(container.textContent?.split('Not included in this view')).toHaveLength(3);
    expect(container.textContent).not.toContain(PRIVATE_COMPANY_LEX.qualifiedEmpty[0]);
    expect(container.querySelector('details')).not.toBeNull();
  });

  it('renders source strings as escaped text without creating markup or links', async () => {
    const state = ready();
    const payload = '<img src=x onerror="alert(1)">';
    await render({ ...state, fact: { ...state.fact, fact: { ...state.fact.fact, product: payload } } });
    expect(container.textContent).toContain(payload);
    expect(container.querySelector('img,script,a')).toBeNull();
  });

  it('uses sixteen ordinal choices and forwards only the actual chosen ID', async () => {
    const state = ready();
    const entries = Array.from({ length: 16 }, (_, i) => ({ ...state.selection.selections[0], fact_id: 'integration:' + i.toString(16).padStart(64, '0') }));
    await render({ ...state, selectedFactId: entries[0].fact_id, selection: { ...state.selection, selections: entries } });
    const field = container.querySelector('select')!;
    expect(field.options).toHaveLength(16);
    expect(field.options[15].textContent).toBe('Integration 16');
    await act(async () => { field.value = entries[15].fact_id; field.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(entries[15].fact_id);
    expect(field.getAttribute('aria-describedby')).toBe(container.querySelector('[class*="footer"]')?.id);
  });

  it('closes details on a new view epoch or fact, preserving unrelated locale renders', async () => {
    const state = ready();
    await render(state);
    const details = container.querySelector('details')!;
    details.open = true;
    await act(async () => applyLang('zh'));
    expect(container.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
    await render({ ...state, viewKey: 'new-owner-epoch' });
    expect(container.querySelector('details')?.open).toBe(false);
    container.querySelector('details')!.open = true;
    await render({ ...state, viewKey: 'new-owner-epoch', selectedFactId: 'integration:' + '2'.repeat(64) });
    expect(container.querySelector('details')?.open).toBe(false);
  });

  it('uses a caller-owned sign-in action without an invented navigation URL', async () => {
    await render({ status: 'guest', query: null, viewKey: 'guest' });
    await act(async () => container.querySelector('button')!.click());
    expect(signIn).toHaveBeenCalledOnce();
    expect(container.querySelector('a')).toBeNull();
  });

  it('omits a sign-in control when the host supplies no action', async () => {
    await act(async () => root.render(<CompanyIntelligencePrivatePanel state={{ status: 'guest', query: null, viewKey: 'guest' }} onSelectFact={select} />));
    expect(container.textContent).toContain(PRIVATE_COMPANY_LEX.guest[0]);
    expect(container.querySelector('button,a')).toBeNull();
  });

  it('keeps labels and description targets unique across two simultaneous panels', async () => {
    await act(async () => root.render(<LangProvider>
      <CompanyIntelligencePrivatePanel state={ready()} onSelectFact={select} />
      <CompanyIntelligencePrivatePanel state={ready()} onSelectFact={select} />
    </LangProvider>));
    const ids = [...container.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of container.querySelectorAll('select')) {
      expect([...container.querySelectorAll('label')].some(label => label.htmlFor === field.id)).toBe(true);
      expect(document.getElementById(field.getAttribute('aria-describedby')!)).not.toBeNull();
    }
  });

  it('preserves maximum accepted field strings and full reference hashes without truncating', async () => {
    const state = ready();
    const product = 'X'.repeat(256);
    const platform = '文'.repeat(84);
    await render({ ...state, fact: { ...state.fact, fact: { ...state.fact.fact, product, platform } } });
    expect(container.textContent).toContain(product);
    expect(container.textContent).toContain(platform);
    expect(container.textContent).toContain(state.fact.reference.sha256);
    expect(container.textContent).toContain(state.fact.edition.sha256);
  });

  it('keeps metadata unavailability distinct from a qualified empty selection', async () => {
    await render({ status: 'metadata_only', query: 'GOOG', viewKey: 'metadata' });
    expect(container.textContent).toContain(PRIVATE_COMPANY_LEX.metadataOnly[0]);
    expect(container.textContent).not.toContain(PRIVATE_COMPANY_LEX.qualifiedEmpty[0]);
    await render({ status: 'empty', query: 'GOOG', viewKey: 'empty' });
    expect(container.textContent).toContain(PRIVATE_COMPANY_LEX.qualifiedEmpty[0]);
    expect(container.textContent).not.toContain(PRIVATE_COMPANY_LEX.metadataOnly[0]);
  });
  it('keeps the original instant precision visible for an instant announcement', async () => {
    const state = ready();
    await render({ ...state, fact: { ...state.fact, source_timing: { published_date: '2024-02-26', published_at: '2024-02-26T23:30:00.123456-05:00', publication_precision: 'instant', known_at: '2024-02-27T12:30:00.123456+08:00' } } });
    expect(container.textContent).toContain('Disclosed as planned on 2024-02-26');
    expect(container.textContent).toContain('2024-02-26T23:30:00.123456-05:00');
    expect(container.textContent).toContain('2024-02-27T12:30:00.123456+08:00');
    expect(container.textContent).toContain('Source observation');
  });
  it('never synthesizes midnight for a date-only announcement', async () => {
    await render(ready());
    expect(container.textContent).not.toContain('00:00:00');
  });
});

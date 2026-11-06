// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const env = vi.hoisted(() => ({ lang: 'en', payload: {} as Record<string, unknown> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('@/lib/flowClientCache', () => ({ flowGet: vi.fn(async (key: string) => key === 'prophet_idx' ? env.payload : null) }));
vi.mock('@/lib/i18n', () => ({ useLang: () => ({lang:env.lang}) }));
vi.mock('../../components/prophet/SelectionCohortCard', () => ({ SelectionCohortCard: () => null, SelectionCohortMastheadTile: () => null, useSelectionCohort: () => ({view:null}) }));
vi.mock('../../components/prophet/SignalCard', () => ({ SignalCard: () => null, phaseTone: () => '', planAsof: () => '', planConfidence: () => 0, planOriginationNote: () => '', planPhase: () => '', planRecommendedAction: () => '' }));
vi.mock('../../components/prophet/ConfidencePanel', () => ({ ConfidencePanel: () => null }));
vi.mock('../../components/prophet/GeometryRail', () => ({ GeometryRail: () => null }));
vi.mock('../../components/prophet/OptionCard', () => ({ OptionCard: () => null }));
import { ProphetView } from '../../components/prophet/ProphetView';

describe('WP05 actual mounted bilingual masthead', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
  async function mount(lang: string, source: Record<string, unknown>) {
    env.lang = lang; env.payload = {asof:'2026-10-23', plans:[], ...source};
    await act(async () => root.render(<ProphetView />));
    const tile = host.querySelector('[data-testid="prophet-source-vintage"]')!;
    expect(tile).toBeTruthy();
    expect(tile.textContent).toContain(lang === 'en' ? 'Data through' : '数据截至');
    const published = [...host.querySelectorAll('.obs-prophet-stat')].find(x => x.textContent?.includes(lang === 'en' ? 'Model close' : '模型收盘'))!;
    expect(published.textContent).toContain('23');
    expect(published.textContent).not.toContain('22');
    return tile;
  }
  for (const lang of ['en','zh']) {
    it(`${lang}: old source and independent warnings survive actual render`, async () => {
      const tile = await mount(lang, {source_asof:'2026-10-20',source_delayed:true,source_mixed_vintage:true});
      expect(tile.querySelector('b')?.textContent).toContain('20');
      expect(tile.querySelector('[role="status"]')?.textContent).toBe(lang === 'en' ? 'Delayed · Mixed vintages' : '数据延迟 · 数据时点不一致');
    });
    for (const [name,source] of Object.entries({
      absent:{}, null:{source_asof:null}, impossible:{source_asof:'2026-02-30'},
      future:{source_asof:'2026-10-24'}, explicitUnknown:{source_asof:'2026-10-20',source_unknown:true},
    })) it(`${lang}: ${name} is visibly unknown`, async () => {
      const tile = await mount(lang,source);
      expect(tile.querySelector('b')?.textContent).toBe('—');
      expect(tile.querySelector('[role="status"]')?.textContent).toContain(lang === 'en'?'Source date unknown':'来源日期未知');
    });
    it(`${lang}: valid source has date without false freshness badge`, async () => {
      const tile = await mount(lang,{source_asof:'2026-10-23'});
      expect(tile.querySelector('b')?.textContent).toContain('23');
      expect(tile.querySelector('[role="status"]')).toBeNull();
    });
    it(`${lang}: unknown retains independent delayed/mixed warnings`, async () => {
      const tile = await mount(lang,{source_asof:null,source_unknown:true,source_delayed:true,source_mixed_vintage:true});
      expect(tile.querySelector('b')?.textContent).toBe('—');
      expect(tile.querySelector('[role="status"]')?.textContent).toBe(lang==='en'?'Source date unknown · Delayed · Mixed vintages':'来源日期未知 · 数据延迟 · 数据时点不一致');
    });
    for (const raw of ['2026-10-20Tgarbage','2026-10-20T99:99:99Z','2026-10-20 not-a-time','2026-10-20T12:00:00Ztrailing']) {
      it(`${lang}: malformed full source value ${raw} is unknown`, async () => {
        const tile = await mount(lang,{source_asof:raw});
        expect(tile.querySelector('b')?.textContent).toBe('—');
        expect(tile.querySelector('[role="status"]')?.textContent).toContain(lang==='en'?'Source date unknown':'来源日期未知');
      });
    }
  }
});

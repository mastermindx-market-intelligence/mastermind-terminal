// @vitest-environment jsdom
// Mounted production component; synthetic DOM/IME events, not native-IME/browser proof.
import React, { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChartObjectTree, { type OTEntry } from '@/components/ChartObjectTree';

const locale = vi.hoisted(() => ({ lang: 'en' as 'en' | 'zh' }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => {
  const copy: Record<string, [string, string]> = {
    objectTree: ['Object tree', '对象树'], drawSearch: ['Search', '搜索'], smIndicators: ['Indicators', '指标'],
    smClose: ['Close', '关闭'], lgShow: ['Show', '显示'], lgHide: ['Hide', '隐藏'], remove: ['Remove', '移除'],
    clearFilter: ['Clear filter', '清除筛选'], scr2EmptyTitle: ['No matches', '无匹配结果'],
    ctvMainSeries: ['Main series', '主序列'], ctvOverlays: ['Overlays', '叠加指标'],
    ctvSubPanes: ['Sub-pane indicators', '副图指标'], ctvNoIndicators: ['No indicators active.', '无活动指标'],
    isTabVisibility: ['Visibility', '可见性'],
  };
  return copy[key]?.[locale.lang === 'zh' ? 1 : 0] ?? key;
} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const entries: OTEntry[] = [
  { key: 'ema', label: 'Moving Averages', tag: 'EMA', kind: 'overlay', hidden: false },
  { key: 'rsi', label: 'Relative Strength', tag: 'RSI', kind: 'pane', hidden: true },
];
let host: HTMLDivElement, opener: HTMLButtonElement, root: Root;
const eye = vi.fn(), remove = vi.fn(), close = vi.fn(), outsideKey = vi.fn();

function Harness() {
  const [open, setOpen] = useState(true);
  return <div onKeyDown={outsideKey}>{open && <ChartObjectTree symbol='NVDA' entries={entries}
    onEye={eye} onRemove={remove} onClose={() => { close(); setOpen(false); }} />}</div>;
}
const input = () => host.querySelector<HTMLInputElement>('input[type="search"]')!;
const rowKeys = () => [...host.querySelectorAll<HTMLElement>('[data-layer-key]')].map(x => x.dataset.layerKey);
async function mount(strict = false) {
  await act(async () => root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />));
}
async function search(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(key: string, isComposing: boolean) {
  const event = new KeyboardEvent('keydown', { key, isComposing, bubbles: true, cancelable: true });
  await act(async () => { input().dispatchEvent(event); });
  return event;
}
async function composition(type: 'compositionstart' | 'compositionend') {
  await act(async () => { input().dispatchEvent(new CompositionEvent(type, { bubbles: true, data: '' })); });
}

describe.each(['en', 'zh'] as const)('study-manager composition interruption (%s)', lang => {
  beforeEach(() => {
    vi.clearAllMocks(); locale.lang = lang;
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is outside this mounted proof'); }));
    opener = document.createElement('button'); opener.textContent = 'Open studies';
    host = document.createElement('div'); document.body.append(opener, host); opener.focus(); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove(); opener.remove();
    expect(fetch).not.toHaveBeenCalled(); expect(eye).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([false, true])('retains the current filter when composing Escape is dispatched (StrictMode=%s)', async strict => {
    await mount(strict); await search('RSI'); await composition('compositionstart');
    const before = input();
    const event = await key('Escape', true);
    expect(input()).toBe(before);
    expect(input().value).toBe('RSI');
    expect(rowKeys()).toEqual(['rsi']);
    expect(document.activeElement).toBe(before);
    expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(outsideKey).toHaveBeenCalledTimes(1);
  });

  it('does not close an empty-filter panel when Escape cancels composition', async () => {
    await mount(); await composition('compositionstart');
    const before = input(); const event = await key('Escape', true);
    expect(host.querySelector('.ot-root')).not.toBeNull();
    expect(input()).toBe(before); expect(input().value).toBe(''); expect(rowKeys()).toEqual(['ema', 'rsi']);
    expect(document.activeElement).toBe(before); expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('preserves two-stage Escape after composition ends, with focus returning to the opener', async () => {
    await mount(); await search('RSI'); await composition('compositionstart'); await composition('compositionend');
    const first = await key('Escape', false);
    expect(input().value).toBe(''); expect(rowKeys()).toEqual(['ema', 'rsi']);
    expect(document.activeElement).toBe(input()); expect(close).not.toHaveBeenCalled();
    expect(first.defaultPrevented).toBe(true); expect(outsideKey).not.toHaveBeenCalled();
    const second = await key('Escape', false);
    expect(close).toHaveBeenCalledTimes(1); expect(host.querySelector('.ot-root')).toBeNull();
    expect(document.activeElement).toBe(opener); expect(second.defaultPrevented).toBe(true);
  });

  it('leaves other composing keys to their existing owner', async () => {
    await mount(); await search('RSI');
    const event = await key('Enter', true);
    expect(input().value).toBe('RSI'); expect(rowKeys()).toEqual(['rsi']);
    expect(close).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
    expect(outsideKey).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit clear and close controls working', async () => {
    await mount(); await search('RSI');
    const clearName = lang === 'zh' ? '清除筛选' : 'Clear filter';
    await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${clearName}"]`)!.click());
    expect(input().value).toBe(''); expect(document.activeElement).toBe(input());
    const closeName = lang === 'zh' ? '关闭' : 'Close';
    await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${closeName}"]`)!.click());
    expect(close).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(opener);
  });
});

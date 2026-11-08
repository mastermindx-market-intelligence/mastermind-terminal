// @vitest-environment jsdom
// Mount the actual SymbolPicker and real dataCache. The lazy SearchModal boundary is a
// presentation probe, not a claim of full SearchModal/browser or authenticated acceptance.
import React, { act, StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import SymbolPicker from '@/components/SymbolPicker';
import { getJSONResult, invalidate, peek, _neg404Has } from '@/lib/dataCache';

vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => "guest" }));
vi.mock("@/lib/useMarketPrefs", () => ({ useMarketPrefs: () => ({ prefs: {}, ready: true, enableAll: () => {} }) }));
vi.mock("next/dynamic", () => ({
 default: () => function SearchBoundary(props: { universeState: string; manifest: unknown; onRetryUniverse: () => void }) {
  return <section data-universe-state={props.universeState}>
   <output>{JSON.stringify(props.manifest)}</output>
   {props.universeState === "unavailable" && <button onClick={props.onRetryUniverse}>Retry symbols</button>}
  </section>;
 },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const URL = '/data/manifest.json';
const good = {as_of: '2026-10-09', symbols: { AAPL: {name: 'Apple', col: '#888', verdict: null} }};
const plain = {symbols: { '0700.HK': {name: 'Tencent', col: '#08f', mkt: 'HKEX', zh: '腾讯', sec: 'Equities', gics: 'Communication Services', mcap: null} }};
const response = (body: unknown, status = 200) => Promise.resolve({ok: status === 200, status, json: async () => body} as Response);
const deferred = () => {let resolve!: (value: Response) => void; const promise = new Promise<Response>(r => resolve = r); return {promise, resolve};};
let host: HTMLDivElement, root: Root, fetcher: ReturnType<typeof vi.fn>;
let idle: (() => void) | undefined;
beforeEach(() => {
 invalidate();
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 fetcher = vi.fn(() => response(good)); vi.stubGlobal('fetch', fetcher);
 idle = undefined;
 window.requestIdleCallback = ((cb: () => void) => {idle = cb; return 1;}) as any;
 window.cancelIdleCallback = vi.fn();
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); invalidate(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (window as any).requestIdleCallback; delete (window as any).cancelIdleCallback;});
async function mount(strict = false) {
 const node = <SymbolPicker symbol="AAPL" onPick={() => {}} open onOpenChange={() => {}} eyebrow="Company" label="Pick company" />;
 await act(async () => root.render(strict ? <StrictMode>{node}</StrictMode> : node));
}
async function start() {await act(async () => {host.querySelector<HTMLButtonElement>('button.sym-pick')!.click();});}
async function retry() {await act(async () => {host.querySelector<HTMLButtonElement>('section button')!.click();});}
function state() {return host.querySelector('section')?.getAttribute('data-universe-state');}
function visible() {return JSON.parse(host.querySelector('output')!.textContent!);}

describe('SymbolPicker malformed universe recovery', () => {
 for (const [label, body] of Object.entries({missing:{}, nullSymbols:{symbols:null}, falseSymbols:{symbols:false}, arraySymbols:{symbols:[]}, textSymbols:{symbols:'broken'}, numericSymbols:{symbols:1}, nullRow:{symbols:{AAPL:null}}, arrayRow:{symbols:{AAPL:[]}}, numericRow:{symbols:{AAPL:42}}, badName:{symbols:{AAPL:{name:123}}}, badMarket:{symbols:{AAPL:{mkt:{bad:true}}}}, badVerdict:{symbols:{AAPL:{verdict:{bad:true}}}}})) {
  it(`malformed ${label} settles as unavailable, not loading or empty market`, async () => {
   fetcher.mockImplementation(() => response(body)); await mount(); await start();
   expect(state()).toBe('unavailable'); expect(visible()).toEqual({});
   expect(host.querySelector('section button')?.textContent).toBe('Retry symbols');
  });
 }
 it('accepts the checked-in producer fixture unchanged', async () => {const payload=JSON.parse(readFileSync(path.resolve(process.cwd(),'public/data/manifest.json'),'utf8')); expect(Object.keys(payload.symbols).length).toBeGreaterThan(0); fetcher.mockImplementation(() => response(payload)); await mount(); await start(); expect(state()).toBe('ready'); expect(visible()).toEqual(payload.symbols);});
 it('accepts a genuine empty symbol map', async () => {fetcher.mockImplementation(() => response({symbols:{}})); await mount(); await start(); expect(state()).toBe('ready'); expect(visible()).toEqual({});});
 it('accepts producer plain-search rows with no verdict and preserves rich metadata', async () => {fetcher.mockImplementation(() => response(plain)); await mount(); await start(); expect(state()).toBe('ready'); expect(visible()).toEqual(plain.symbols);});
 it('retains valid optional null fields and ignores unrelated metadata', async () => {
  const payload = {symbols:{AAPL:{name:'Apple', col:'#fff', verdict:null, vts:null, mkt:null, zh:null, sec:null, last:null, chg:null, source:{owner:'publisher'}}}};
  fetcher.mockImplementation(() => response(payload)); await mount(); await start(); expect(state()).toBe('ready'); expect(visible()).toEqual(payload.symbols);
 });
 it('explicit retry clears a fresh malformed cache and recovers without reload', async () => {
  fetcher.mockImplementationOnce(() => response({})).mockImplementation(() => response(good)); await mount(); await start(); expect(state()).toBe('unavailable');
  expect(fetcher).toHaveBeenCalledTimes(1); await retry(); expect(fetcher).toHaveBeenCalledTimes(2); expect(state()).toBe('ready'); expect(visible()).toEqual(good.symbols);
 });
 it('explicit retry clears 404 negative cache and recovers newly available universe', async () => {
  fetcher.mockImplementationOnce(() => response({},404)).mockImplementation(() => response(good)); await mount(); await start(); expect(state()).toBe('unavailable'); expect(_neg404Has(URL)).toBe(true);
  await retry(); expect(fetcher).toHaveBeenCalledTimes(2); expect(state()).toBe('ready'); expect(_neg404Has(URL)).toBe(false);
 });
 for(const status of [403,429,500,503]) it(`transient ${status} remains retryable`, async () => {
  fetcher.mockImplementationOnce(() => response({},status)).mockImplementation(() => response(good)); await mount(); await start(); expect(state()).toBe('unavailable'); await retry(); expect(state()).toBe('ready'); expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('network rejection remains retryable', async () => {fetcher.mockRejectedValueOnce(new Error('offline')); await mount(); await start(); expect(state()).toBe('unavailable'); await retry(); expect(state()).toBe('ready');});
 it('StrictMode replay and repeated intent keep one pending request', async () => {
  const pending = deferred(); fetcher.mockReturnValue(pending.promise); await mount(true); await start(); await start(); await act(async () => idle?.()); expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(await response(good))); expect(state()).toBe('ready');
 });
 it('repeated retry intent keeps one pending request', async () => {
  const pending = deferred(); fetcher.mockImplementationOnce(() => response({},404)).mockReturnValue(pending.promise); await mount(); await start();
  const button=host.querySelector<HTMLButtonElement>('section button')!; await act(async () => {button.click(); button.click();}); expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(await response(good))); expect(state()).toBe('ready'); expect(peek(URL)).toEqual(good);
 });
 it('does not mutate shared valid cache on ordinary repeated intent', async () => {
  await getJSONResult(URL); await mount(); await start(); await start(); expect(fetcher).toHaveBeenCalledTimes(1); expect(peek(URL)).toEqual(good); expect(state()).toBe('ready');
 });
 it('valid stale data survives malformed SWR refresh and later valid refresh replaces it', async () => {
  const clock=vi.spyOn(Date,'now').mockReturnValue(100000); await getJSONResult(URL); clock.mockReturnValue(200000);
  fetcher.mockImplementationOnce(() => response({symbols:[]})).mockImplementationOnce(() => response(plain)); await mount(); await start(); expect(state()).toBe('ready'); expect(visible()).toEqual(good.symbols);
  // The malformed refresh makes a new intent eligible, while the old usable map stays visible.
  clock.mockReturnValue(300000); await start(); expect(state()).toBe('ready'); expect(visible()).toEqual(plain.symbols);
 });
 it('an old SWR result cannot overwrite a later explicit-retry result', async () => {
  const clock=vi.spyOn(Date,'now').mockReturnValue(100000); fetcher.mockImplementationOnce(() => response({})); await getJSONResult(URL); clock.mockReturnValue(200000);
  const old=deferred(); fetcher.mockReturnValueOnce(old.promise).mockImplementation(() => response(good)); await mount(); await start(); expect(state()).toBe('unavailable'); await retry(); expect(visible()).toEqual(good.symbols);
  await act(async () => old.resolve(await response(plain))); expect(visible()).toEqual(good.symbols);
 });
 it('unmounted request does not apply to a replacement picker', async () => {
  const old=deferred(); fetcher.mockReturnValueOnce(old.promise).mockImplementation(() => response(plain)); await mount(); await start(); await act(async () => root.render(null)); invalidate(URL);
  await mount(); await start(); expect(visible()).toEqual(plain.symbols); await act(async () => old.resolve(await response(good))); expect(visible()).toEqual(plain.symbols);
 });
});

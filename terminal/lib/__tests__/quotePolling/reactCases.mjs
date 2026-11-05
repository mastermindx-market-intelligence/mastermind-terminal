import React, { act, StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTypeScript, readPollingSource, sliceLane, slicePublication, boatsQuote, DAY_EPOCH } from './harness.mjs';

export function registerReactPollingCases(planQuoteBatch, dependencies) {
const source = readPollingSource();
const eqStart = source.indexOf('const QUOTE_EQ_IGNORE ='), eqEnd = source.indexOf('// Overlay a live quote', eqStart);
const quoteEq = new Function(`return ${compileTypeScript(`(()=>{${source.slice(eqStart, eqEnd)};return quoteEq;})()`)}`)();
const components = {};
for (const lane of ['wide', 'extended']) {
  const poll = lane === 'wide' ? 'pollQuotes' : 'pollExtQuotes';
  // Only the actual production lane is compiled. React hooks, scheduling, StrictMode effect
  // replay, functional state updaters and the DOM commit are real React 19 behavior.
  components[lane] = new Function('React', 'hooks', 'planQuoteBatch', 'quoteEq', 'dependencies', 'return ' + compileTypeScript(`(()=>{
    const {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState}=hooks;
    const {mergeFormingQuote,isPublicBoatsQuote,isExtQuoteCurrent,extQuotePollMs}=dependencies;
    return function Probe({ symbols = ['NVDA'], startInLayout = false }) {
      const quotePriority = useMemo(() => symbols.map(s => ({key:s,symbols:[s]})), [symbols]);
      const quoteRotating = useMemo(() => [], []);
      const extSymsKey = symbols.join(',');
      const [quotes,setQuotes]=useState({});
      const [extQuotes,setExtQuotes]=useState({});
      const [extClockMs,setExtClockMs]=useState(() => Date.now());
      ${lane === 'wide' ? slicePublication(source) : ''}
      ${sliceLane(source, lane)}
      useLayoutEffect(() => { if (startInLayout) ${poll}(); }, []);
      return React.createElement('pre', null, JSON.stringify(${lane === 'wide' ? 'quotes' : 'extQuotes'}));
    };})()`))(React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState }, planQuoteBatch, quoteEq, dependencies);
}

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
let requests, root, container;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(DAY_EPOCH);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  requests = [];
  vi.stubGlobal('fetch', vi.fn((url) => { const head = deferred(), body = deferred(); requests.push({ url, head, body }); return head.promise; }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(() => root.unmount());
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
const tick = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const mount = async (lane, props = {}) => { await act(async () => root.render(React.createElement(StrictMode, null, React.createElement(components[lane], props)))); };
const finish = async (i, data) => { await act(async () => { requests[i].head.resolve({ ok: true, json: () => requests[i].body.promise }); requests[i].body.resolve(data); }); };
const state = () => JSON.parse(container.querySelector('pre').textContent);
const quoteFor = (lane, price) => lane === 'extended'
  ? boatsQuote(Date.now(), price) : { last: price, basis: 'REALTIME', live: true };

for (const lane of ['wide', 'extended']) describe(`${lane} with real React StrictMode`, () => {
  const first = lane === 'wide' ? 250 : 500;
  const cadence = lane === 'wide' ? 6000 : 30000;
  it('keeps a stalled JSON body single-flight, then paints the result and latest demand', async () => {
    await mount(lane); await tick(first); expect(requests).toHaveLength(1);
    await act(async () => requests[0].head.resolve({ ok: true, json: () => requests[0].body.promise }));
    await mount(lane, { symbols: ['MSFT'] }); await tick(120000); expect(requests).toHaveLength(1);
    const received = lane === 'wide' ? { last: 17, basis: 'DELAYED', live: false } : quoteFor(lane, 17);
    await finish(0, { quotes: { NVDA: received } }); await tick(0);
    expect(requests).toHaveLength(2); expect(requests[1].url).toContain('MSFT');
    expect(state().NVDA).toEqual(received);
    await finish(1, { quotes: { MSFT: quoteFor(lane, 23) } }); await tick(0);
    expect(requests).toHaveLength(2); expect(state().MSFT[lane === 'wide' ? 'last' : 'extPrice']).toBe(23);
  });
  it('fences a request started before actual StrictMode cleanup/setup replay', async () => {
    await mount(lane, { startInLayout: true }); await tick(first); expect(requests).toHaveLength(1);
    await finish(0, { quotes: { NVDA: quoteFor(lane, 1) } }); await tick(0);
    expect(state()).toEqual({}); expect(requests).toHaveLength(2);
    await finish(1, { quotes: { NVDA: quoteFor(lane, 2) } }); expect(state().NVDA[lane === 'wide' ? 'last' : 'extPrice']).toBe(2);
  });
  it('uses latest demand after repeated re-renders and visibility events', async () => {
    await mount(lane); await tick(first);
    for (const symbol of ['AAPL', 'MSFT', 'LATEST']) {
      await mount(lane, { symbols: [symbol] });
      document.dispatchEvent(new Event('visibilitychange')); await tick(first);
    }
    expect(requests).toHaveLength(1); await finish(0, { quotes: {} }); await tick(0);
    expect(requests).toHaveLength(2); expect(requests[1].url).toContain('LATEST');
  });
  it('does not poll or repaint after real unmount', async () => {
    await mount(lane); await tick(first); await tick(cadence);
    await act(() => root.unmount()); root = null;
    await finish(0, { quotes: { NVDA: quoteFor(lane, 17) } }); await tick(120000);
    expect(requests).toHaveLength(1); expect(container.textContent).toBe(''); expect(vi.getTimerCount()).toBe(0);
  });
  it('resumes from hidden settlement on visibility return', async () => {
    await mount(lane); await tick(first); await tick(cadence);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange')); await finish(0, { quotes: {} }); await tick(0);
    expect(requests).toHaveLength(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange')); expect(requests).toHaveLength(2);
  });
  it('does not count StrictMode double invocation as multiple null responses', async () => {
    await mount(lane); await tick(first);
    await finish(0, { quotes: { NVDA: lane === 'wide' ? { last: 17 } : quoteFor(lane, 17) } });
    for (let i = 1; i <= 3; i++) {
      await tick(cadence); await finish(i, { quotes: { NVDA: null } });
      if (lane === 'wide') expect(state().NVDA).toEqual(i < 3 ? { last: 17 } : undefined);
      else expect(state().NVDA).toBeNull();
    }
  });
});

describe('extended current cadence and expiry owners with real React', () => {
  it('uses the overnight five-second schedule', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 6, 2));
    await mount('extended'); await tick(500);
    await finish(0, { quotes: { NVDA: quoteFor('extended', 17) } });
    await tick(4499); expect(requests).toHaveLength(1);
    await tick(1); expect(requests).toHaveLength(2);
  });
  it('expires the rendered BOATS packet while the next request remains unresolved', async () => {
    await mount('extended'); await tick(500);
    await finish(0, { quotes: { NVDA: quoteFor('extended', 17) } });
    expect(state().NVDA.extPrice).toBe(17);
    await tick(30500);
    expect(requests).toHaveLength(2);
    expect(state().NVDA).toBeNull();
  });
});

}

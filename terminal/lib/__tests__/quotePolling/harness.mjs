import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
// The existing TypeScript dependency works in both Node and jsdom without changing globals.
export const compileTypeScript = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

export const gitBlob = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex');
export const groups = names => names.map(name => ({ key: name, symbols: [name] }));
export const symbols = request => new URL(request.url, 'https://fixture.invalid').searchParams.get('syms').split(',');
export async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const cuts = {
  wide: ['  const quoteCursorRef = useRef(0);', '  // Visible-chart fast lane.'],
  extended: ['  const extSymsKeyRef = useRef(extSymsKey);', '  // Read the saved-workspace library.'],
  chart: ['  const chartQuoteSymsKeyRef = useRef(chartQuoteSymsKey);', '  // item-26/27: extended/overnight poll'],
};
export function sliceLane(source, lane) {
  const [start, end] = cuts[lane];
  assert.equal(source.split(start).length, 2, `${lane} extraction start must be unique`);
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(b > a, `${lane} extraction end must exist`);
  return source.slice(a, b);
}

// Read the repository's source, never a copied implementation or a frozen fixture.
// Polling callbacks are source-extracted; this does not import or mount TerminalShell.
export const readPollingSource = () => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../components/TerminalShell.tsx'), 'utf8');
export function loadHarness(planQuoteBatch) {
  const source = readPollingSource();
  const eqStart = source.indexOf('const QUOTE_EQ_IGNORE =');
  const eqEnd = source.indexOf('// Overlay a live quote', eqStart);
  assert(eqStart >= 0 && eqEnd > eqStart);
  const quoteEq = vm.runInNewContext(compileTypeScript(`(()=>{${source.slice(eqStart, eqEnd)};return quoteEq;})()`));

  function make(lane, { priority = groups(['NVDA']), rotating = [], key = 'NVDA', initialState = {}, deferredUpdates = false, fetchThrows = 0 } = {}) {
    let now = 0, nextId = 0, hookIndex = 0, state = initialState, writes = 0, rendered = 0, mounted = true;
    let current = { priority, rotating, key };
    const hooks = [], tasks = new Map(), listeners = new Map(), requests = [], pendingUpdates = [];
    const same = (a, b) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
    const useRef = value => { const i = hookIndex++; return hooks[i] ??= { current: value }; };
    const useMemo = (fn, deps) => {
      const i = hookIndex++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { value: fn(), deps };
      return hooks[i].value;
    };
    const useCallback = (fn, deps) => useMemo(() => fn, deps);
    const useEffect = (fn, deps) => {
      const i = hookIndex++, previous = hooks[i];
      if (!previous || !same(previous.deps, deps)) hooks[i] = { effect: fn, deps, cleanup: previous?.cleanup, pending: true };
    };
    const runEffects = () => {
      for (const h of hooks) if (h?.pending) { h.cleanup?.(); h.pending = false; h.cleanup = h.effect(); }
    };
    const schedule = (fn, delay, interval = false) => {
      const id = ++nextId; tasks.set(id, { fn, at: now + delay, delay, interval }); return id;
    };
    const document = {
      hidden: false,
      addEventListener(name, fn) { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    };
    const fetch = (url, opts) => {
      if (fetchThrows > 0) { fetchThrows--; throw new Error('fixture synchronous fetch failure'); }
      const request = { url, opts, at: now, head: deferred(), body: deferred(), settled: false };
      requests.push(request); return request.head.promise;
    };
    const applyUpdate = update => {
      const next = typeof update === 'function' ? update(state) : update;
      writes++; if (next !== state) rendered++; state = next;
    };
    const setState = update => deferredUpdates ? pendingUpdates.push(update) : applyUpdate(update);
    const env = { useRef, useMemo, useCallback, useEffect, document, fetch, quoteEq, planQuoteBatch,
      setQuotes: setState, setExtQuotes: setState, setTimeout: (fn, delay) => schedule(fn, delay),
      clearTimeout: id => tasks.delete(id), setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => tasks.delete(id), encodeURIComponent };
    const result = lane === 'wide' ? '{poll:pollQuotes,cursor:quoteCursorRef,misses:quoteMissRef}' : lane === 'extended' ? '{poll:pollExtQuotes}' : '{poll:pollChartQuotes}';
    const code = compileTypeScript(`(()=>{${sliceLane(source, lane)};return ${result};})()`);
    const context = vm.createContext(env);
    let handle;
    function render(update = {}) {
      current = { ...current, ...update }; hookIndex = 0;
      Object.assign(env, { quotePriority: current.priority, quoteRotating: current.rotating, extSymsKey: current.key, chartQuoteSymsKey: current.key });
      handle = vm.runInContext(code, context); runEffects(); return handle;
    }
    render();
    async function advance(target) {
      assert(target >= now);
      for (let steps = 0; ; steps++) {
        assert(steps < 10000, 'timer runaway');
        const due = [...tasks].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [id, task] = due[0]; now = task.at;
        if (task.interval) task.at += task.delay; else tasks.delete(id);
        task.fn(); await flush();
      }
      now = target; await flush();
    }
    async function headers(index, ok = true) { const r = requests[index]; r.head.resolve({ ok, json: () => r.body.promise }); if (!ok) r.settled = true; await flush(); }
    async function settle(index, data = { quotes: { NVDA: { last: 100, basis: 'REALTIME', live: true } } }) {
      await headers(index); requests[index].settled = true; requests[index].body.resolve(data); await flush();
    }
    async function fail(index, phase = 'headers') {
      if (phase === 'json') await headers(index);
      requests[index].settled = true; requests[index][phase === 'json' ? 'body' : 'head'].reject(new Error(`fixture ${phase} failure`)); await flush();
    }
    function cleanup() { mounted = false; for (const h of hooks) if (h?.effect) { h.cleanup?.(); h.cleanup = undefined; } }
    function replay() { cleanup(); mounted = true; for (const h of hooks) if (h?.effect) h.cleanup = h.effect(); }
    function visibility(hidden) { document.hidden = hidden; for (const fn of listeners.get('visibilitychange') ?? []) fn(); }
    return { requests, render, get handle() { return handle; }, document, advance, headers, settle, fail, cleanup, replay, visibility,
      state: () => state, writes: () => writes, rendered: () => rendered, now: () => now,
      runUpdates: () => { for (const update of pendingUpdates.splice(0)) applyUpdate(update); },
      tasks: () => [...tasks.values()], listeners: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
      mounted: () => mounted, unresolved: () => requests.filter(r => !r.settled).length };
  }
  return { source, make };
}

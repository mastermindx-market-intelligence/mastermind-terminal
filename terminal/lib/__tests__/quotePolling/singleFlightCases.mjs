import assert from 'node:assert/strict';
import { loadHarness, groups, symbols, boatsQuote, DAY_EPOCH } from './harness.mjs';

// Register each retained case directly with Vitest. No custom runner, process exit,
// subprocess, swallowed assertion failure, or console-result parser is involved.
export function registerPollingCases(test, planQuoteBatch, dependencies) {
  const { make } = loadHarness(planQuoteBatch, dependencies);
for (const lane of ['wide', 'extended']) {
  const first = lane === 'wide' ? 250 : 500, interval = lane === 'wide' ? 6000 : 30000;
  const prefix = name => `${lane}: ${name}`;
  test(prefix('initial delay and healthy cadence unchanged'), async () => {
    const h = make(lane); await h.advance(first - 1); assert.equal(h.requests.length, 0);
    await h.advance(first); assert.equal(h.requests.length, 1); await h.settle(0);
    await h.advance(interval - 1); assert.equal(h.requests.length, 1);
    await h.advance(interval); assert.equal(h.requests.length, 2); await h.settle(1);
    await h.advance(2 * interval); assert.deepEqual(h.requests.map(r => r.at), [first, interval, 2 * interval]); h.cleanup();
  });
  test(prefix('held headers remain one request after 120 seconds'), async () => {
    const h = make(lane); await h.advance(120000); assert.equal(h.requests.length, 1); assert.equal(h.unresolved(), 1); h.cleanup();
  });
  test(prefix('held JSON body retains ownership'), async () => {
    const h = make(lane); await h.advance(first); await h.headers(0); await h.advance(120000);
    assert.equal(h.requests.length, 1); assert.equal(h.writes(), 0); h.cleanup();
  });
  for (const failure of ['URL encoding', 'synchronous fetch']) test(prefix(`${failure} failure releases ownership without advancing an unrequested batch`), async () => {
    const invalid = failure === 'URL encoding';
    const h = make(lane, { priority: groups([invalid ? '\ud800' : 'NVDA']), key: invalid ? '\ud800' : 'NVDA',
      rotating: groups(Array.from({ length: 500 }, (_, i) => `S${i}`)), fetchThrows: invalid ? 0 : 1 });
    try { await h.advance(first); } catch (error) { assert.match(error.message, /URI malformed|synchronous fetch failure/); }
    assert.equal(h.requests.length, 0);
    if (lane === 'wide') assert.equal(h.handle.cursor.current, 0, 'no fetch started, so no rotation was consumed');
    h.render({ priority: groups(['NVDA']), key: 'NVDA' }); await h.advance(interval);
    assert.equal(h.requests.length, 1, 'valid demand must recover after a synchronous failure'); h.cleanup();
  });
  test(prefix('cadence visibility and demand changes coalesce to one latest catch-up'), async () => {
    const h = make(lane); await h.advance(first);
    for (let i = 0; i < 6; i++) { h.visibility(true); h.visibility(false); h.render({ priority: groups([`NEW${i}`]), key: `NEW${i}` }); await h.advance(h.now() + first); }
    await h.advance(120000); assert.equal(h.requests.length, 1);
    await h.settle(0); await h.advance(h.now()); assert.equal(h.requests.length, 2);
    assert.deepEqual(symbols(h.requests[1]), ['NEW5']); await h.settle(1); await h.advance(h.now()); assert.equal(h.requests.length, 2); h.cleanup();
  });
  test(prefix('new direct trigger consumes an already queued trailing timer'), async () => {
    const h = make(lane); await h.advance(first); h.handle.poll(); await h.settle(0);
    h.handle.poll(); assert.equal(h.requests.length, 2); await h.advance(h.now());
    await h.settle(1); await h.advance(h.now()); assert.equal(h.requests.length, 2); h.cleanup();
  });
  for (const mode of ['hidden', 'no demand']) test(prefix(`${mode} at settlement suppresses trailing request`), async () => {
    const h = make(lane); await h.advance(first); h.handle.poll();
    if (mode === 'hidden') h.visibility(true); else h.render({ priority: [], rotating: [], key: '' });
    await h.settle(0); await h.advance(h.now()); assert.equal(h.requests.length, 1);
    h.render({ priority: groups(['LATEST']), key: 'LATEST' }); h.visibility(false);
    await h.advance(h.now()); assert.equal(h.requests.length, 2); assert.deepEqual(symbols(h.requests[1]), ['LATEST']); h.cleanup();
  });
  test(prefix('hidden initial mount and empty demand do not fetch'), async () => {
    const h = make(lane); h.visibility(true); await h.advance(120000); assert.equal(h.requests.length, 0); h.cleanup();
    const empty = make(lane, { priority: [], rotating: [], key: '' }); await empty.advance(120000); assert.equal(empty.requests.length, 0); empty.cleanup();
  });
  for (const failure of ['non-OK', 'headers', 'json']) {
    test(prefix(`${failure} releases flight and coalesces one pending trigger`), async () => {
      const h = make(lane); await h.advance(first); for (let i = 0; i < 7; i++) h.handle.poll();
      if (failure === 'non-OK') await h.headers(0, false); else await h.fail(0, failure);
      await h.advance(h.now()); assert.equal(h.requests.length, 2); assert.equal(h.writes(), 0);
      await h.settle(1); await h.advance(h.now()); assert.equal(h.requests.length, 2); h.cleanup();
    });
    test(prefix(`${failure} without a pending trigger does not self-retry`), async () => {
      const h = make(lane); await h.advance(first);
      if (failure === 'non-OK') await h.headers(0, false); else await h.fail(0, failure);
      await h.advance(interval - 1); assert.equal(h.requests.length, 1);
      await h.advance(interval); assert.equal(h.requests.length, 2); h.cleanup();
    });
  }
  for (const phase of ['headers', 'JSON']) test(prefix(`unmount during ${phase} forbids commit timers and subsequent polls`), async () => {
    const h = make(lane); await h.advance(first); if (phase === 'JSON') await h.headers(0); h.handle.poll(); h.cleanup();
    h.handle.poll(); await h.settle(0); await h.advance(120000);
    assert.equal(h.requests.length, 1); assert.equal(h.writes(), 0); assert.equal(h.tasks().length, 0); assert.equal(h.listeners(), 0);
  });
  test(prefix('unmount cancels already scheduled trailing timer'), async () => {
    const h = make(lane); await h.advance(first); h.handle.poll(); await h.settle(0); h.cleanup(); await h.advance(120000);
    assert.equal(h.requests.length, 1); assert.equal(h.tasks().length, 0);
  });
  for (const phase of ['headers', 'JSON']) test(prefix(`StrictMode effect replay fences old ${phase} completion and keeps the sole flight`), async () => {
    const h = make(lane); await h.advance(first); if (phase === 'JSON') await h.headers(0); h.replay();
    h.render({ priority: groups(['MSFT']), key: 'MSFT' }); await h.advance(h.now() + first);
    assert.equal(h.requests.length, 1); await h.settle(0, { quotes: { NVDA: { last: 1 }, MSFT: null } });
    assert.equal(h.writes(), 0); await h.advance(h.now()); assert.equal(h.requests.length, 2);
    assert.deepEqual(symbols(h.requests[1]), ['MSFT']); if (lane === 'wide') assert.deepEqual(Object.keys(h.handle.misses.current), []);
    h.handle.poll(); assert.equal(h.requests.length, 2); await h.settle(1, { quotes: { MSFT: h.quote(2) } });
    assert.equal(h.state().MSFT[lane === 'wide' ? 'last' : 'extPrice'], 2); assert.equal(h.state().NVDA, undefined); h.cleanup();
  });
  test(prefix(lane === 'wide' ? 'valid publication before cleanup remains accepted' : 'queued React updater from old effect generation is fenced'), async () => {
    const h = make(lane, { deferredUpdates: true }); await h.advance(first); await h.settle(0); h.replay(); h.runUpdates();
    // Wide updateQuotes already published a concrete snapshot before cleanup.
    // Extended polling still defers a functional updater and must fence its epoch.
    if (lane === 'wide') assert.equal(h.state().NVDA.last, 100);
    else assert.deepEqual(Object.keys(h.state()), []);
    h.cleanup();
  });
  test(prefix('unchanged quote reuses state and authority fields remain verbatim'), async () => {
    const q = lane === 'wide'
      ? { last: 10, basis: 'DELAYED', live: false, asOfMs: 42, lagMs: 12345, source: 'fixture', regularSession: 'rth' }
      : boatsQuote(DAY_EPOCH, 10);
    const initial = { NVDA: q }; const h = make(lane, { initialState: initial }); await h.advance(first); await h.settle(0, { quotes: { NVDA: { ...q } } });
    assert.equal(h.state(), initial); assert.equal(h.rendered(), 0);
    if (lane === 'wide') assert.equal(h.writes(), 0, 'publication owner rejects no-ops before React work');
    h.handle.poll(); const fresh = lane === 'wide'
      ? { ...q, last: 11, basis: 'REALTIME', live: true } : { ...q, extPrice: 11, extGeneration: 2 };
    await h.settle(1, { quotes: { NVDA: fresh } });
    assert.equal(h.state().NVDA, fresh); h.cleanup();
  });
}

test('wide: suppressed cadence visibility and demand triggers never advance cursor', async () => {
  const h = make('wide', { rotating: groups(Array.from({ length: 500 }, (_, i) => `S${i}`)) });
  await h.advance(250); const cursor = h.handle.cursor.current; assert(cursor > 0);
  for (let i = 0; i < 10; i++) h.visibility(false); await h.advance(120000);
  assert.equal(h.handle.cursor.current, cursor); assert.equal(h.requests.length, 1);
  await h.settle(0); await h.advance(h.now()); assert.notEqual(h.handle.cursor.current, cursor); assert.equal(h.requests.length, 2); h.cleanup();
});
for (const size of [300, 500]) test(`wide: complete ${size}-symbol rotating coverage with whole composites and 200 cap`, async () => {
  const singles = Array.from({ length: size }, (_, i) => `S${i}`);
  const rotating = groups(singles); rotating.splice(198, 0, { key: 'LEG1+LEG2', symbols: ['LEG1', 'LEG2'] });
  const h = make('wide', { rotating }); await h.advance(250);
  for (let i = 0; i < 5; i++) { for (let n = 0; n < 9; n++) h.handle.poll(); await h.settle(i); await h.advance(h.now()); }
  const batches = h.requests.map(symbols); const seen = new Set(batches.flat());
  assert(singles.every(s => seen.has(s))); assert(seen.has('LEG1')); assert(batches.every(b => b.length <= 200 && b.includes('NVDA')));
  assert(batches.every(b => b.includes('LEG1') === b.includes('LEG2'))); h.cleanup();
});
test('wide: eviction requires three actual null responses, never failed or suppressed calls', async () => {
  const h = make('wide', { initialState: { NVDA: { last: 7 }, OMITTED: { last: 8 } } }); await h.advance(250);
  for (let i = 0; i < 20; i++) h.handle.poll(); await h.settle(0, { quotes: { NVDA: null } }); await h.advance(h.now());
  assert.equal(h.handle.misses.current.NVDA, 1); assert.equal(h.state().NVDA.last, 7); assert.equal(h.handle.misses.current.OMITTED, undefined);
  await h.fail(1); h.handle.poll(); await h.fail(2, 'json'); h.handle.poll(); await h.headers(3, false);
  assert.equal(h.handle.misses.current.NVDA, 1); h.handle.poll(); await h.settle(4, { quotes: { NVDA: null } });
  assert.equal(h.state().NVDA.last, 7); assert.equal(h.handle.misses.current.NVDA, 2);
  h.handle.poll(); await h.settle(5, { quotes: { NVDA: null } }); assert.equal(h.state().NVDA, undefined); assert.equal(h.state().OMITTED.last, 8); h.cleanup();
});
test('wide: successful result resets miss count and composite-leg prune follows demand', async () => {
  const h = make('wide', { priority: [{ key: 'A+B', symbols: ['A', 'B'] }], initialState: { A: { last: 1 } } }); await h.advance(250);
  await h.settle(0, { quotes: { A: null, B: null } });
  h.render({ priority: [{ key: 'A+B', symbols: ['A', 'B'] }, ...groups(['C'])] }); assert.equal(h.handle.misses.current.A, 1);
  await h.advance(500); await h.settle(1, { quotes: { A: { last: 2 } } }); assert.equal(h.handle.misses.current.A, undefined);
  h.render({ priority: groups(['C']) }); assert.equal(h.handle.misses.current.B, undefined); h.cleanup();
});
test('extended: null retains existing packet semantics', async () => {
  const h = make('extended', { initialState: { NVDA: boatsQuote(DAY_EPOCH, 7) } }); await h.advance(500); await h.settle(0, { quotes: { NVDA: null } });
  assert.equal(h.state().NVDA, null); h.cleanup();
});
test('chart reference lane remains single-flight', async () => {
  const h = make('chart'); await h.advance(120000); assert.equal(h.requests.length, 1); h.render({ key: 'MSFT' });
  await h.settle(0); await h.advance(h.now()); assert.equal(h.requests.length, 2); assert.deepEqual(symbols(h.requests[1]), ['MSFT']); h.cleanup();
});

test('extended: overnight cadence remains five seconds with the same single-flight guard', async () => {
  const h = make('extended', { epochMs: Date.UTC(2026, 10, 6, 2) });
  await h.advance(500); await h.settle(0);
  await h.advance(4999); assert.equal(h.requests.length, 1);
  await h.advance(5000); assert.equal(h.requests.length, 2); await h.settle(1);
  await h.advance(10000); assert.deepEqual(h.requests.map(r => r.at), [500, 5000, 10000]); h.cleanup();
});
test('extended: the one-second expiry owner keeps running while the next flight stalls', async () => {
  const h = make('extended'); await h.advance(500); await h.settle(0);
  assert.equal(h.state().NVDA.extPrice, 100);
  h.handle.poll(); await h.advance(31500);
  assert.equal(h.requests.length, 2); assert.equal(h.unresolved(), 1);
  assert.equal(h.state().NVDA, null); assert(h.clockWrites() >= 30); h.cleanup();
});
test('extended: BOATS freshness is checked when a deferred updater actually applies', async () => {
  const h = make('extended', { deferredUpdates: true });
  await h.advance(500); await h.settle(0);
  await h.advance(31000); h.runUpdates();
  assert.equal(h.state().NVDA, null, 'an expired packet cannot become live after React deferral'); h.cleanup();
});
test('extended: authoritative null fences an older queued value and later failure cannot undo it', async () => {
  const h = make('extended', { deferredUpdates: true });
  await h.advance(500); await h.settle(0);
  h.handle.poll(); await h.settle(1, { quotes: { NVDA: null } });
  assert.equal(h.handle.accepted.current, 2);
  h.runUpdates(); assert.equal(h.state().NVDA, null);
  h.handle.poll(); await h.headers(2, false); h.runUpdates();
  assert.equal(h.handle.accepted.current, 2); assert.equal(h.state().NVDA, null); h.cleanup();
});
test('extended: accepted null survives a later different-demand response before React applies either', async () => {
  const h = make('extended', { initialState: { NVDA: boatsQuote(DAY_EPOCH, 7) }, deferredUpdates: true });
  await h.advance(500); await h.settle(0, { quotes: { NVDA: null } });
  h.render({ key: 'MSFT' }); h.handle.poll();
  await h.settle(1, { quotes: { MSFT: h.quote(23) } });
  h.runUpdates();
  assert.equal(h.state().NVDA, null, 'the accepted null is not superseded by a disjoint response');
  assert.equal(h.state().MSFT.extPrice, 23); h.cleanup();
});
test('extended: non-BOATS input is an authoritative null, never a revived provider packet', async () => {
  const h = make('extended', { initialState: { NVDA: boatsQuote(DAY_EPOCH, 7) } });
  await h.advance(500);
  await h.settle(0, { quotes: { NVDA: h.quote(8, { extSource: 'other_provider' }) } });
  assert.equal(h.state().NVDA, null); assert.equal(h.handle.accepted.current, 1); h.cleanup();
});
test('wide: older forming generation/revision cannot erase the current chart snapshot', async () => {
  const forming = { source: 'polygon-live-second', generation: 'current', generationStartedMs: 1000,
    revision: 4, timeframes: '1m', series: {} };
  const old = { last: 100, asOfMs: 2000, basis: 'REALTIME', source: forming.source, formingCandles: forming };
  const h = make('wide', { initialState: { NVDA: old } }); await h.advance(250);
  await h.settle(0, { quotes: { NVDA: { ...old, last: 99, asOfMs: 1999,
    formingCandles: { ...forming, revision: 3 } } } });
  assert.equal(h.state().NVDA, old); assert.equal(h.writes(), 0);
  h.handle.poll(); await h.settle(1, { quotes: { NVDA: { last: 101, asOfMs: 2010, basis: 'REALTIME', source: forming.source } } });
  assert.equal(h.state().NVDA.last, 101); assert.equal(h.state().NVDA.formingCandles, forming);
  const newer = { ...forming, generation: 'next', generationStartedMs: 2000, revision: 1 };
  h.handle.poll(); await h.settle(2, { quotes: { NVDA: { ...old, asOfMs: 2020, formingCandles: newer } } });
  assert.equal(h.state().NVDA.formingCandles, newer); h.cleanup();
});

}

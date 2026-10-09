import assert from 'node:assert/strict';
import { loadHarness, groups, symbols } from './harness.mjs';

// Register each retained case directly with Vitest. No custom runner, process exit,
// subprocess, swallowed assertion failure, or console-result parser is involved.
export function registerPollingCases(test, planQuoteBatch) {
  const { make } = loadHarness(planQuoteBatch);
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
    h.handle.poll(); assert.equal(h.requests.length, 2); await h.settle(1, { quotes: { MSFT: { last: 2 } } });
    assert.equal(h.state().MSFT.last, 2); assert.equal(h.state().NVDA, undefined); h.cleanup();
  });
  test(prefix('queued React updater from old effect generation is fenced'), async () => {
    const h = make(lane, { deferredUpdates: true }); await h.advance(first); await h.settle(0); h.replay(); h.runUpdates();
    assert.deepEqual(Object.keys(h.state()), []); h.cleanup();
  });
  test(prefix('unchanged quote reuses state and authority fields remain verbatim'), async () => {
    const q = { last: 10, basis: 'DELAYED', live: false, asOfMs: 42, lagMs: 12345, source: 'fixture', regularSession: 'rth' };
    const initial = { NVDA: q }; const h = make(lane, { initialState: initial }); await h.advance(first); await h.settle(0, { quotes: { NVDA: { ...q } } });
    assert.equal(h.state(), initial); assert.equal(h.rendered(), 0);
    h.handle.poll(); const fresh = { ...q, last: 11, basis: 'REALTIME', live: true }; await h.settle(1, { quotes: { NVDA: fresh } });
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
  const h = make('extended', { initialState: { NVDA: { last: 7 } } }); await h.advance(500); await h.settle(0, { quotes: { NVDA: null } });
  assert.equal(h.state().NVDA, null); h.cleanup();
});
test('chart reference lane remains single-flight', async () => {
  const h = make('chart'); await h.advance(120000); assert.equal(h.requests.length, 1); h.render({ key: 'MSFT' });
  await h.settle(0); await h.advance(h.now()); assert.equal(h.requests.length, 2); assert.deepEqual(symbols(h.requests[1]), ['MSFT']); h.cleanup();
});

}

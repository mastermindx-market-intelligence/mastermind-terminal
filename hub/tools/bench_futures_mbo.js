'use strict';
/** Synthetic kernel smoke benchmark, not measured CME end-to-end latency/capacity. */
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { FuturesMboBook, FLAGS } = require('../lib/futuresMbo');
const count = 10000, iterations = 10000;
const context = { contract: 'ESZ6', publisherId: 1, instrumentId: 42, sessionId: 'synthetic-benchmark' };
const book = new FuturesMboBook(context), baselineHeap = process.memoryUsage().heapUsed;
const base = 1791568800000000000n;
function row(action, id, step, flags) {
  const side = id % 2 ? 'B' : 'A';
  const ticks = side === 'B' ? 30000 - Math.floor(id / 2) : 30001 + Math.floor(id / 2);
  return { action, side, order_id: String(id), price: (BigInt(ticks) * 250000000n).toString(),
    size: 100 + step % 10, publisher_id: 1, instrument_id: 42,
    ts_event: (base + BigInt(step)).toString(), ts_recv: (base + BigInt(step)).toString(), flags };
}
const snapshot = [{ action: 'R', side: 'N', publisher_id: 1, instrument_id: 42,
  flags: FLAGS.SNAPSHOT, ts_event: base.toString(), ts_recv: base.toString() }];
for (let id = 1; id <= count; id++) snapshot.push(row('A', id, 0, FLAGS.SNAPSHOT | (id === count ? FLAGS.LAST : 0)));
let start = performance.now();
assert.equal(book.applyBatch({ ...context, cursor: 's', previousCursor: null, continuity: 'verified',
  availableAtNs: base.toString(), records: snapshot }).status, 'applied');
const snapshotMs = performance.now() - start;
start = performance.now();
for (let step = 1; step <= iterations; step++) {
  const result = book.applyBatch({ ...context, cursor: String(step), previousCursor: step === 1 ? 's' : String(step - 1),
    continuity: 'verified', availableAtNs: (base + BigInt(step)).toString(),
    records: [row('M', 1 + step % count, step, FLAGS.LAST)] });
  assert.equal(result.status, 'applied');
}
const updateMs = performance.now() - start;
start = performance.now();
for (let n = 0; n < 100; n++) assert.equal(book.view({ decisionTimeNs: (base + BigInt(iterations)).toString(),
  maxAgeNs: '1000000000', marketStatus: 'continuous' }).status, 'ok');
const viewsMs = performance.now() - start;
console.log(JSON.stringify({ schema: 'futures.synthetic_kernel_benchmark/v1', generatedAt: new Date().toISOString(),
  node: process.version, platform: process.platform, arch: process.arch, synthetic: true,
  disclaimer: 'Single local sample; excludes live ingestion, decoding, network, archival, browser rendering and concurrent market load.',
  restingOrders: count, modifications: iterations, views: 100,
  snapshotMs, updateMs, modificationsPerSecond: iterations / updateMs * 1000,
  viewsMs, meanViewMs: viewsMs / 100,
  heapDeltaBytes: process.memoryUsage().heapUsed - baselineHeap,
  heapNote: 'Heap delta includes GC timing and temporary allocations; not a steady-state memory estimate.'
}, null, 2));

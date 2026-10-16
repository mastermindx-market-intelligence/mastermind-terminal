'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareBbo, compareSamples } = require('../tools/compare_futures_sample');
const base = 1758499200000000000n, ns = n => (base + BigInt(n)).toString();
const identity = [{ publisherId: 1, instrumentId: 42, symbol: 'ESZ5' }];
const raw = (action, patch = {}) => ({ rtype: 160, publisher_id: 1, instrument_id: 42, channel_id: 0,
  ts_event: ns(0), ts_recv: ns(0), flags: 128, sequence: 10,
  action, side: 'B', order_id: '1', price: '6700000000000', size: 5, ...patch });
function sample() {
  const records = [
    raw('R', { flags: 40, side: 'N', order_id: '0', size: 0, price: '9223372036854775807' }),
    raw('A', { flags: 40 }),
    raw('A', { side: 'A', order_id: '2', price: '6700250000000', size: 9, flags: 168 }),
    // Two separate LAST events share the same packet sequence and receive time.
    raw('A', { ts_event: ns(1), ts_recv: ns(10), sequence: 20, order_id: '3', price: '6699750000000' }),
    raw('A', { ts_event: ns(2), ts_recv: ns(10), sequence: 20, order_id: '4', size: 4 }),
    raw('T', { ts_event: ns(19), ts_recv: ns(20), sequence: 21, side: 'B', size: 2, price: '6700250000000' }),
  ];
  const sourceId = 'sha256:' + 'a'.repeat(64);
  const ref = (at, sequence, bidSize, bidCount) => ({ receiveTimeNs: ns(at), sequence, flags: 128,
    publisherId: 1, instrumentId: 42, symbol: 'ESZ5', bidPrice: '6700000000000', askPrice: '6700250000000',
    bidSize, bidCount, askSize: 9, askCount: 1 });
  const receipt = { instruments: identity, firstReceiveNs: ns(0), lastReceiveNs: ns(20),
    rawPrefixSha256: 'a'.repeat(64), normalizedSha256: 'b'.repeat(64), sourceUrl: 'synthetic:no-network' };
  return {
    mbo: { metadata: { sourceId }, receipt: { ...receipt, sourceSchema: 'mbo' },
      rows: records.map((record, ordinal) => ({ sourceId, ordinal, availableAtNs: record.ts_recv, record })) },
    reference: { receipt: { ...receipt, sourceSchema: 'mbp-1' },
      rows: [ref(0, 10, 5, 1), ref(10, 20, 9, 2)].map(record => ({ record })) },
  };
}
test('BBO checks price, quantity and count independently', () => {
  const view = { bids: [{ priceTicks: 26800, size: 5, orderCount: 1 }], asks: [{ priceTicks: 26801, size: 9, orderCount: 1 }] };
  const expected = sample().reference.rows[0].record;
  assert.deepEqual(compareBbo(view, expected), []);
  assert.deepEqual(compareBbo(view, { ...expected, bidSize: 6, askCount: 2 }), ['bidSize', 'askCount']);
});
test('joins final complete packet states instead of assuming one LAST per packet sequence', () => {
  const { mbo, reference } = sample(); const { report } = compareSamples(mbo, reference);
  assert.equal(report.result, 'historical_displayed_bbo_agrees'); assert.equal(report.compared, 2);
  assert.equal(report.exact, 2); assert.equal(report.mismatches, 0);
  assert.equal(report.rawTradeCount, 1); assert.equal(report.admittedTradeVolume, 2);
  assert.equal(report.tradeConservation, true); assert.equal(report.authenticatedVenueDefinition, false);
  assert.equal(report.fullBookOracle, false);
});
test('multiple BBO changes in the same group use the final source-order BBO', () => {
  const { mbo, reference } = sample();
  reference.rows.splice(1, 0, { record: { ...reference.rows[1].record, bidSize: 5, bidCount: 1 } });
  const { report } = compareSamples(mbo, reference);
  assert.equal(report.result, 'historical_displayed_bbo_agrees'); assert.equal(report.repeatedReferenceGroups, 1);
  assert.equal(report.eligibleReferences, 3); assert.equal(report.uniqueReferenceGroups, 2);
});
test('wrong quantities do not pass because prices agree', () => {
  const { mbo, reference } = sample(); reference.rows[1].record.askSize = 8;
  const { report } = compareSamples(mbo, reference);
  assert.equal(report.result, 'comparison_incomplete_or_mismatched'); assert.equal(report.mismatches, 1);
  assert.equal(report.mismatchFields.askSize, 1);
});
test('unmatched reference is visible and cannot earn a success result', () => {
  const { mbo, reference } = sample(); reference.rows[1].record.sequence = 999;
  const { report } = compareSamples(mbo, reference);
  assert.equal(report.result, 'comparison_incomplete_or_mismatched'); assert.equal(report.unmatchedReferences, 1);
});
test('wrong source identity cannot share a comparator', () => {
  const { mbo, reference } = sample(); reference.receipt.instruments = [{ ...identity[0], symbol: 'NQZ5' }];
  assert.throws(() => compareSamples(mbo, reference), /identity/);
});
test('comparison report never exports raw book levels or execution records', () => {
  const { mbo, reference } = sample(); const { report, privateData } = compareSamples(mbo, reference);
  assert.equal(JSON.stringify(report).includes('6700'), false); assert.equal('trades' in report, false);
  assert.equal(privateData.trades.length, 1); assert.ok(privateData.samples.length > 0);
});

test('unfinished next event at packet tail does not hide its preceding completed state', () => {
  const { mbo, reference } = sample();
  const pending = raw('T', { ts_event: ns(3), ts_recv: ns(10), flags: 0, sequence: 20, size: 2, price: '6700250000000' });
  const end = raw('F', { ts_event: ns(3), ts_recv: ns(20), flags: 128, sequence: 21, side: 'A', size: 2, price: '6700250000000' });
  mbo.rows[5] = { sourceId: mbo.metadata.sourceId, ordinal: 5, availableAtNs: ns(10), record: pending };
  mbo.rows.push({ sourceId: mbo.metadata.sourceId, ordinal: 6, availableAtNs: ns(20), record: end });
  const { report } = compareSamples(mbo, reference);
  assert.equal(report.unmatchedReferences, 0); assert.equal(report.result, 'historical_displayed_bbo_agrees');
  assert.equal(report.admittedTradeVolume, 2);
});

test('top-ten comparison checks every rank, not only the best quotes', () => {
  const { compareDepth10 } = require('../tools/compare_futures_sample');
  const bids = Array.from({ length: 10 }, (_, i) => ({ priceTicks: 26800 - i, size: 10 + i, orderCount: 2 + i }));
  const asks = Array.from({ length: 10 }, (_, i) => ({ priceTicks: 26801 + i, size: 20 + i, orderCount: 3 + i }));
  const levels = bids.map((bid, i) => ({ bidPrice: (BigInt(bid.priceTicks) * 250000000n).toString(),
    askPrice: (BigInt(asks[i].priceTicks) * 250000000n).toString(), bidSize: bid.size, askSize: asks[i].size,
    bidCount: bid.orderCount, askCount: asks[i].orderCount }));
  assert.deepEqual(compareDepth10({ bids, asks }, { levels }), []);
  levels[8].askSize++;
  assert.deepEqual(compareDepth10({ bids, asks }, { levels }), ['level9:askSize']);
  assert.throws(() => compareDepth10({ bids, asks }, { levels: levels.slice(0, 9) }), /invalid_depth_reference/);
});
test('full source replay compares deeper displayed liquidity against MBP-10', () => {
  const { mbo, reference } = sample(); reference.receipt.sourceSchema = 'mbp-10';
  for (const [i, row] of reference.rows.entries()) {
    const empty = { bidPrice: '9223372036854775807', askPrice: '9223372036854775807',
      bidSize: 0, askSize: 0, bidCount: 0, askCount: 0 };
    row.record.levels = [row.record, ...Array.from({ length: 9 }, () => ({ ...empty }))];
    // Avoid a circular fixture; the reference level only contains scalar book fields.
    row.record.levels[0] = { bidPrice: row.record.bidPrice, askPrice: row.record.askPrice,
      bidSize: row.record.bidSize, askSize: row.record.askSize, bidCount: row.record.bidCount, askCount: row.record.askCount };
    if (i === 1) row.record.levels[1] = { ...empty, bidPrice: '6699750000000', bidSize: 5, bidCount: 1 };
  }
  const { report } = compareSamples(mbo, reference);
  assert.equal(report.result, 'historical_displayed_depth10_agrees'); assert.equal(report.comparisonDepth, 10);
  reference.rows[1].record.levels[1].bidSize = 4;
  const bad = compareSamples(mbo, reference).report;
  assert.equal(bad.result, 'comparison_incomplete_or_mismatched'); assert.equal(bad.mismatchFields['level2:bidSize'], 1);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregateFootprint } = require('../lib/futuresMbo');
const identity = { contract: 'NQZ6', publisherId: 1, instrumentId: 43, sessionId: '2026-10-09' };
const base = 1791547200000000000n, ns = n => (base + BigInt(n)).toString();
const options = { ...identity, startNs: ns(0), endNs: ns(1000), decisionTimeNs: ns(2000),
  intervalNs: '100', sourceId: 'synthetic:aggregation', coverage: 'complete' };
const trade = (id, priceTicks, size, aggressor, at = 50) => ({ ...identity, id, priceTicks, size, aggressor,
  eventTimeNs: ns(at), receiveTimeNs: ns(at + 1), availableAtNs: ns(at + 2) });

test('price/time coarsening conserves executed volume and raw-price OHLC', () => {
  const trades = Array.from({ length: 1000 }, (_, i) => trade(String(i), 102001 + i % 15, i % 10 + 1,
    i % 7 === 0 ? 'unknown' : i % 2 ? 'buy' : 'sell', i % 900));
  const exact = aggregateFootprint(trades, options);
  for (const priceStepTicks of [1, 2, 4, 8, 16]) for (const intervalNs of ['100', '500', '1000']) {
    const result = aggregateFootprint(trades, { ...options, priceStepTicks, intervalNs });
    assert.equal(result.status, 'ok'); assert.equal(result.observedVolume, exact.observedVolume);
    assert.equal(result.bars.reduce((s, b) => s + b.deltaKnown, 0), exact.bars.reduce((s, b) => s + b.deltaKnown, 0));
    assert.equal(result.volumeProfile.reduce((s, c) => s + c.total, 0), exact.observedVolume);
    for (const bar of result.bars) for (const cell of bar.cells) assert.equal(cell.priceTicks % priceStepTicks, 0);
    assert.equal(Math.max(...result.bars.map(b => b.highTicks)), 102015);
    assert.equal(Math.min(...result.bars.map(b => b.lowTicks)), 102001);
  }
});
test('diagonal imbalances compare adjacent selected price buckets, not single ticks', () => {
  const trades = [trade('a', 102001, 10, 'sell'), trade('b', 102005, 40, 'buy')];
  const result = aggregateFootprint(trades, { ...options, priceStepTicks: 4 });
  assert.equal(result.bars[0].cells[1].buyImbalance, true);
  assert.equal(result.bars[0].cells[1].priceTicks, 102004);
  assert.equal(result.bars[0].pocTicks, 102004);
  assert.equal(result.bars[0].openTicks, 102001);
  assert.equal(result.bars[0].closeTicks, 102005);
});
test('later knowledge remains excluded after coarsening', () => {
  const rows = [trade('a', 102001, 3, 'buy'), { ...trade('late', 102002, 100, 'sell'), availableAtNs: ns(3000) }];
  const result = aggregateFootprint(rows, { ...options, priceStepTicks: 4, intervalNs: '1000' });
  assert.equal(result.observedVolume, 3); assert.equal(result.bars[0].delta, 3);
});
for (const priceStepTicks of [0, -1, 1.5, 257, Infinity, '4']) test(`invalid price step ${priceStepTicks}`, () => {
  assert.equal(aggregateFootprint([], { ...options, priceStepTicks }).reason, 'invalid_price_step');
});

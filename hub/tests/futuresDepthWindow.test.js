'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectDepthWindow, buildLiquidityTiles } = require('../lib/futuresMbo');
const identity = { contract: 'ESZ5', publisherId: 1, instrumentId: 42, sessionId: '2025-09-22' };
const view = { ...identity, status: 'ok', coverage: 'full_order_book', liquidityScope: 'displayed_orders_excludes_implied',
  receiveTimeNs: '1000', availableAtNs: '1000',
  bids: [{ priceTicks: 100, size: 10, orderCount: 2 }, { priceTicks: 90, size: 9, orderCount: 1 }],
  asks: [{ priceTicks: 101, size: 20, orderCount: 3 }, { priceTicks: 110, size: 99, orderCount: 8 }] };
const options = { ...identity, startNs: '1000', endNs: '2000', decisionTimeNs: '2000', intervalNs: '1000',
  lowTick: 99, highTick: 102, maxAgeNs: '10000' };
test('price cropping never calls the reduced representation full depth', () => {
  const result = projectDepthWindow(view, 99, 102);
  assert.equal(result.coverage, 'displayed_price_window'); assert.equal(result.coveredLowTick, 99);
  assert.equal(result.bids.length, 1); assert.equal(result.asks.length, 1);
  assert.equal(view.bids.length, 2);
});
test('cropped exact window retains identical time-weighted quantities', () => {
  const whole = buildLiquidityTiles([{ availableAtNs: '1000', view }], options);
  const cropped = buildLiquidityTiles([{ availableAtNs: '1000', view: projectDepthWindow(view, 99, 102) }], options);
  assert.deepEqual(cropped, whole);
  assert.equal(cropped.columns[0].levels[0].bidMean, 0);
});
test('requesting one missing price outside the retained window is refused, not zero filled', () => {
  const result = buildLiquidityTiles([{ availableAtNs: '1000', view: projectDepthWindow(view, 100, 102) }], options);
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'sample_identity_or_coverage');
});
test('a cropped window cannot be expanded without the original book', () => {
  assert.equal(projectDepthWindow(projectDepthWindow(view, 99, 102), 90, 110).reason, 'uncovered_price_window');
});
test('a feed gap stays unavailable after window projection', () => {
  assert.deepEqual(projectDepthWindow({ status: 'unavailable', reason: 'source_gap' }, 99, 102),
    { status: 'unavailable', reason: 'source_gap' });
});
for (const range of [[0, 100], [102, 100], [1, 3000], [NaN, 10]]) test(`invalid price window ${range}`, () => {
  assert.equal(projectDepthWindow(view, ...range).status, 'unavailable');
});

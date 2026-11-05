'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { FuturesMboBook, aggregateFootprint, FLAGS } = require('../lib/futuresMbo');
const BASE = 1791568800000000000n;
const ns = n => (BASE + BigInt(n)).toString();
const context = { contract: 'ESZ6', publisherId: 1, instrumentId: 42, sessionId: '2026-10-09' };
const px = ticks => (BigInt(ticks) * 250000000n).toString();
function record(action, opts = {}) { return { action, side: 'N', order_id: '0', price: '0', size: 0,
  publisher_id: 1, instrument_id: 42, flags: 0, ts_recv: ns(100), ts_event: ns(90), ...opts }; }
function batch(cursor, previousCursor, records, opts = {}) { return { cursor, previousCursor, ...context,
  continuity: 'verified', availableAtNs: ns(200), records: records.map((r, i) =>
    ({ ...r, flags: r.flags | (i === records.length - 1 ? FLAGS.LAST : 0) })), ...opts }; }
function seed(cursor = 's1') { return batch(cursor, null, [
  record('R', { flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS, ts_event: '1' }),
  record('A', { side: 'B', flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS, order_id: '9007199254740992', price: px(30000), size: 20 }),
  record('A', { side: 'B', flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS, order_id: '9007199254740993', price: px(30000), size: 30 }),
  record('A', { side: 'A', flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS, order_id: '3', price: px(30001), size: 40 }),
]); }
function ready() { const b = new FuturesMboBook(context); assert.equal(b.applyBatch(seed()).status, 'applied'); return b; }
function view(book) { return book.view({ decisionTimeNs: ns(1000), maxAgeNs: '1000' }); }
function expectFailure(book, b, reason) { assert.equal(book.applyBatch(b).reason, reason); assert.equal(view(book).status, 'unavailable'); }

describe('MBO atomic event and lossless identity', () => {
  it('retains adjacent uint64 IDs that collide as JS Numbers and aggregates resting size', () => {
    const v = view(ready()); assert.equal(v.status, 'ok');
    assert.equal(v.bids[0].size, 50); assert.equal(v.bids[0].orderCount, 2); assert.equal(v.asks[0].size, 40);
    assert.equal(JSON.stringify(v).includes('900719925474099'), false);
  });
  it('keeps T, F and C distinct: one buy execution and one residual-size update', () => {
    const book = ready(), b = batch('e2', 's1', [
      record('T', { side: 'B', price: px(30001), size: 10 }),
      record('F', { side: 'A', order_id: '3', price: px(30001), size: 10 }),
      record('C', { side: 'A', order_id: '3', price: px(30001), size: 10 }),
    ]);
    const r = book.applyBatch(b); assert.equal(r.trades.length, 1); assert.equal(r.trades[0].aggressor, 'buy');
    assert.equal(view(book).asks[0].size, 30);
  });
  it('maps sell and unknown trade sides without counting passive fills', () => {
    const book = ready(), r = book.applyBatch(batch('e2', 's1', [
      record('T', { side: 'A', price: px(30000), size: 7 }),
      record('T', { side: 'N', price: px(30000), size: 5 }), record('F', { side: 'B' }), record('N'),
    ]));
    assert.deepEqual(r.trades.map(t => t.aggressor), ['sell', 'unknown']); assert.equal(view(book).bids[0].size, 50);
  });
  it('moves an order on Modify and fully removes it on Cancel', () => {
    const book = ready();
    book.applyBatch(batch('e2', 's1', [record('M', { side: 'B', order_id: '9007199254740992', price: px(29999), size: 15 })]));
    assert.deepEqual(view(book).bids.map(x => x.size), [30, 15]);
    book.applyBatch(batch('e3', 'e2', [record('C', { side: 'B', order_id: '9007199254740992', price: px(29999), size: 15 })]));
    assert.equal(view(book).bids.length, 1);
  });
  it('returns an idempotent duplicate with no repeated trades', () => {
    const book = ready(), b = batch('e2', 's1', [record('T', { side: 'B', price: px(30001), size: 10 })]);
    assert.equal(book.applyBatch(b).trades.length, 1);
    assert.deepEqual(book.applyBatch(structuredClone(b)), { status: 'duplicate', cursor: 'e2', trades: [] });
  });
  it('refuses a conflicting repeat of the last immutable cursor', () => {
    const book = ready(), b = seed(); b.records[1].size++;
    expectFailure(book, b, 'cursor_conflict');
  });
  it('does not publish a trade or partial book from an invalid later row', () => {
    const book = ready(), before = [...book.orders];
    const r = book.applyBatch(batch('e2', 's1', [record('T', { side: 'B', price: px(30001), size: 10 }),
      record('A', { side: 'A', order_id: '4', price: px(30002), size: 7 }),
      record('C', { side: 'A', order_id: '3', price: px(30001), size: 41 })]));
    assert.equal(r.reason, 'over_cancel'); assert.deepEqual(r.trades, []); assert.deepEqual([...book.orders], before);
  });
  it('requires a new complete snapshot after a gap and retains historical gap truth', () => {
    const book = ready(); expectFailure(book, batch('e2', 'wrong', [record('N')]), 'cursor_gap');
    expectFailure(book, batch('e2', 's1', [record('N')]), 'snapshot_required');
    assert.equal(book.applyBatch(seed('recovery')).status, 'applied'); assert.equal(view(book).status, 'ok');
  });
  it('will not create an initial book from isolated increments', () => {
    expectFailure(new FuturesMboBook(context), batch('e1', null, [record('N')]), 'snapshot_required');
  });
  it('permits a real Clear to empty the initialized book', () => {
    const book = ready(); assert.equal(book.applyBatch(batch('e2', 's1', [record('R')])).status, 'applied');
    assert.deepEqual(view(book).bids, []); assert.deepEqual(view(book).asks, []);
  });
  it('does not expose a generated snapshot before its capture availability', () => {
    const book = ready(); assert.equal(book.view({ decisionTimeNs: ns(199), maxAgeNs: '1000' }).reason, 'not_yet_available');
    assert.equal(book.view({ decisionTimeNs: ns(200), maxAgeNs: '100' }).status, 'ok');
    assert.equal(book.view({ decisionTimeNs: ns(201), maxAgeNs: '100' }).reason, 'stale_book');
  });
  const flagCases = [[FLAGS.TOB, 'unsupported_or_bad_book'], [FLAGS.MBP, 'unsupported_or_bad_book'],
    [FLAGS.BAD_BOOK, 'unsupported_or_bad_book'], [FLAGS.SPECIFIC, 'unsupported_or_bad_book'], [FLAGS.BAD_TS, 'bad_receive_clock']];
  for (const [flag, reason] of flagCases) it(`refuses unsupported/corrupt flag ${flag}`, () => {
    expectFailure(ready(), batch('e2', 's1', [record('N', { flags: flag })]), reason);
  });
  const cases = [
    ['unknown cancel', { action: 'C', side: 'B', order_id: '999', price: px(30000), size: 1 }, 'unknown_cancel'],
    ['overcancel', { action: 'C', side: 'A', order_id: '3', price: px(30001), size: 41 }, 'over_cancel'],
    ['changed side', { action: 'M', side: 'B', order_id: '3', price: px(30000), size: 1 }, 'unknown_or_changed_order'],
    ['duplicate order', { action: 'A', side: 'A', order_id: '3', price: px(30002), size: 1 }, 'duplicate_order'],
    ['unsafe numeric ID', { action: 'A', side: 'B', order_id: 9007199254740992, price: px(30000), size: 1 }, 'invalid_order_id'],
    ['offtick', { action: 'T', side: 'B', price: '7500100000000', size: 1 }, 'invalid_price'],
    ['sentinel price', { action: 'T', side: 'B', price: '9223372036854775807', size: 1 }, 'invalid_price'],
    ['zero quantity', { action: 'T', side: 'B', price: px(30000), size: 0 }, 'invalid_quantity'],
    ['fractional quantity', { action: 'T', side: 'B', price: px(30000), size: .5 }, 'invalid_quantity'],
    ['foreign instrument', { instrument_id: 43 }, 'instrument_mismatch'],
    ['foreign publisher', { publisher_id: 2 }, 'instrument_mismatch'],
    ['receive regression', { ts_recv: ns(99) }, 'receive_order_or_availability'],
    ['unavailable receive', { ts_recv: ns(201) }, 'receive_order_or_availability'],
    ['unsafe numeric timestamp', { ts_recv: Number(BASE) }, 'invalid_receive_clock'],
    ['unknown action', { action: 'X' }, 'unknown_action_or_side'],
    ['unknown side', { side: 'X' }, 'unknown_action_or_side'],
  ];
  for (const [name, fields, reason] of cases) it(`refuses ${name}`, () => expectFailure(ready(), batch('e2', 's1', [record('N', fields)]), reason));
  it('rejects incomplete and internally split source events', () => {
    const a = batch('e2', 's1', [record('N')]); a.records[0].flags = 0;
    expectFailure(ready(), a, 'incomplete_event');
    expectFailure(ready(), batch('e2', 's1', [record('N', { flags: FLAGS.LAST }), record('N')]), 'incomplete_event');
  });
  it('rejects a snapshot without Clear and mixed snapshot records', () => {
    expectFailure(ready(), batch('e2', null, [record('N', { flags: FLAGS.SNAPSHOT })]), 'snapshot_reset_required');
    const b = seed('s2'); b.records[1].flags = 0; expectFailure(ready(), b, 'mixed_snapshot');
  });
  it('refuses unverified continuity and wrong batch identities', () => {
    expectFailure(ready(), batch('e2', 's1', [record('N')], { continuity: 'gap' }), 'source_gap');
    expectFailure(ready(), batch('e2', 's1', [record('N')], { sessionId: '2026-10-10' }), 'batch_identity');
  });
  it('bounds order capacity without partially installing a snapshot', () => {
    const b = new FuturesMboBook({ ...context, maxOrders: 2 }); expectFailure(b, seed(), 'order_capacity'); assert.equal(b.orders.size, 0);
  });
  it('does not render a crossed complete book as valid liquidity', () => {
    const b = ready(); b.applyBatch(batch('e2', 's1', [record('M', { side: 'B', order_id: '9007199254740992', price: px(30002), size: 20 })]));
    assert.equal(view(b).reason, 'crossed_or_locked_book');
  });
});
function trade(id, ticks, size, aggressor, time = 100) { return { id, ...context, priceTicks: ticks, size, aggressor,
  eventTimeNs: ns(time), receiveTimeNs: ns(time + 5), availableAtNs: ns(time + 10) }; }
const opts = (patch = {}) => ({ ...context, startNs: ns(0), endNs: ns(1000), decisionTimeNs: ns(2000),
  intervalNs: '500', coverage: 'complete', sourceId: 'synthetic:trade-population:v1', ...patch });
describe('footprint conservation, interpretation and causal replay', () => {
  it('keeps observed volume equal to buy+sell+unknown and refuses complete delta with unknown side', () => {
    const r = aggregateFootprint([trade('a', 30000, 30, 'buy'), trade('b', 30000, 10, 'sell'), trade('c', 30000, 5, 'unknown')], opts());
    assert.equal(r.observedVolume, 45); assert.equal(r.bars[0].deltaKnown, 20);
    assert.equal(r.bars[0].delta, null); assert.equal(r.bars[0].cvd, null); assert.equal(r.bars[0].cells[0].total, 45);
  });
  it('derives candles in event order, known CVD across intervals and deterministic lower-price POC ties', () => {
    const r = aggregateFootprint([trade('b', 30001, 10, 'sell', 200), trade('a', 30000, 10, 'buy', 100), trade('c', 30002, 4, 'buy', 600)], opts());
    assert.equal(r.bars.length, 2); assert.equal(r.bars[0].openTicks, 30000); assert.equal(r.bars[0].closeTicks, 30001);
    assert.equal(r.bars[0].pocTicks, 30000); assert.equal(r.bars[1].cvd, 4);
  });
  it('marks diagonal ratios only with known, nonzero adjacent denominators and minimum numerator size', () => {
    const r = aggregateFootprint([trade('a', 30000, 10, 'sell'), trade('b', 30001, 30, 'buy'), trade('c', 30003, 100, 'buy')], opts());
    assert.equal(r.bars[0].cells[1].buyImbalance, true); assert.equal(r.bars[0].cells[2].buyImbalance, false);
    const u = aggregateFootprint([trade('a', 30000, 10, 'sell'), trade('b', 30001, 30, 'buy'), trade('c', 30000, 1, 'unknown')], opts());
    assert.equal(u.bars[0].cells[1].buyImbalance, false);
  });
  it('deduplicates identical executions but fails on unadjudicated revisions', () => {
    const t = trade('a', 30000, 10, 'buy');
    assert.equal(aggregateFootprint([t, structuredClone(t)], opts()).observedVolume, 10);
    assert.equal(aggregateFootprint([t, { ...t, size: 20 }], opts()).reason, 'trade_revision_conflict');
  });
  it('excludes not-yet-available corrections without leaking them through dedupe', () => {
    const t = trade('a', 30000, 10, 'buy');
    const r = aggregateFootprint([t, { ...t, size: 20, availableAtNs: ns(3000) }], opts());
    assert.equal(r.status, 'ok'); assert.equal(r.observedVolume, 10);
  });
  it('uses start-inclusive/end-exclusive event windows and availability cutoff', () => {
    const r = aggregateFootprint([trade('a', 30000, 1, 'buy', 0), trade('b', 30000, 2, 'buy', 1000),
      { ...trade('c', 30000, 4, 'buy', 500), availableAtNs: ns(2100) }], opts());
    assert.equal(r.observedVolume, 1);
  });
  it('never paints partial coverage as complete delta or imbalance', () => {
    const r = aggregateFootprint([trade('a', 30000, 10, 'sell'), trade('b', 30001, 30, 'buy')], opts({ coverage: 'gap' }));
    assert.equal(r.status, 'partial'); assert.equal(r.bars[0].delta, null);
    assert.equal(r.bars[0].cvd, null); assert.equal(r.bars[0].cells[1].buyImbalance, false);
  });
  it('does not fill unobserved empty intervals with fabricated zero candles', () => {
    assert.deepEqual(aggregateFootprint([], opts()).bars, []);
  });
  for (const [name, patch, reason] of [
    ['wrong instrument', { instrumentId: 2 }, 'trade_identity'],
    ['wrong contract', { contract: 'NQZ6' }, 'trade_identity'],
    ['wrong session', { sessionId: '2026-10-10' }, 'trade_identity'],
    ['unknown aggressor label', { aggressor: 'B' }, 'invalid_trade'],
    ['negative size', { size: -1 }, 'invalid_quantity'],
    ['inverted capture clock', { availableAtNs: ns(1) }, 'invalid_trade_clock'],
  ]) it(`refuses ${name}`, () => assert.equal(aggregateFootprint([{ ...trade('a', 30000, 10, 'buy'), ...patch }], opts()).reason, reason));
  it('conserves a 10,000-record generated tape exactly through bars and profile', () => {
    const tape = Array.from({ length: 10000 }, (_, i) => trade(String(i), 29950 + (i % 101), 1 + (i % 9), ['buy', 'sell', 'unknown'][i % 3], i));
    const r = aggregateFootprint(tape, opts({ endNs: ns(11000), decisionTimeNs: ns(12000) }));
    const expected = tape.reduce((s, t) => s + t.size, 0);
    assert.equal(r.observedVolume, expected);
    assert.equal(r.bars.reduce((s, b) => s + b.total, 0), expected);
    assert.equal(r.volumeProfile.reduce((s, c) => s + c.total, 0), expected);
  });
  it('does not mutate caller events or options', () => {
    const t = [trade('a', 30000, 1, 'buy')], o = opts(), before = structuredClone([t, o]);
    aggregateFootprint(t, o); assert.deepEqual([t, o], before);
  });
});
const { buildLiquidityTiles } = require('../lib/futuresMbo');
function sample(time, size, status = 'ok') { return { availableAtNs: ns(time), view: status === 'ok' ? {
  status, ...context, coverage: 'full_order_book', liquidityScope: 'displayed_orders_excludes_implied', availableAtNs: ns(time), receiveTimeNs: ns(time),
  bids: [{ priceTicks: 30000, size, orderCount: 1 }], asks: [{ priceTicks: 30001, size: 20, orderCount: 1 }],
} : { status: 'unavailable', reason: 'source_gap' } }; }
const tileOpts = patch => ({ ...opts(), lowTick: 29999, highTick: 30002, maxAgeNs: '10000', ...patch });
describe('liquidity heat tiles preserve coverage and historical knowability', () => {
  it('weights resting liquidity by known duration, not event count', () => {
    const r = buildLiquidityTiles([sample(0, 10), sample(100, 20)], tileOpts());
    assert.equal(r.columns[0].coverage, 'full'); assert.equal(r.columns[0].levels[1].bidMean, 18);
    assert.equal(r.columns[1].levels[1].bidMean, 20);
  });
  it('renders unknown duration as a gap, not a zero or a forward-filled book', () => {
    const r = buildLiquidityTiles([sample(0, 10), sample(250, 0, 'unavailable')], tileOpts());
    assert.equal(r.columns[0].coverage, 'partial'); assert.equal(r.columns[0].coverageFraction, .5);
    assert.equal(r.columns[0].levels[1].bidMean, 10);
    assert.equal(r.columns[1].coverage, 'gap'); assert.equal(r.columns[1].levels[1].bidMean, null);
  });
  it('distinguishes observed zero at a covered price from unknown depth', () => {
    const r = buildLiquidityTiles([sample(0, 10)], tileOpts());
    assert.equal(r.columns[0].levels[0].bidMean, 0);
  });
  it('expires stale book state at the precise receive-clock age boundary', () => {
    const r = buildLiquidityTiles([sample(0, 10)], tileOpts({ maxAgeNs: '250' }));
    assert.equal(r.columns[0].coverageFraction, .5); assert.equal(r.columns[1].coverage, 'gap');
  });
  it('does not paint snapshot state before availability or backward-fill the first column', () => {
    const r = buildLiquidityTiles([sample(600, 10)], tileOpts());
    assert.equal(r.columns[0].coverage, 'gap'); assert.equal(r.columns[1].coverageFraction, .8);
  });
  it('does not erase historical gaps when a later complete snapshot arrives', () => {
    const r = buildLiquidityTiles([sample(0, 10), sample(250, 0, 'unavailable'), sample(750, 30)], tileOpts());
    assert.equal(r.columns[0].coverageFraction, .5); assert.equal(r.columns[1].coverageFraction, .5);
    assert.equal(r.columns[1].levels[1].bidMean, 30);
  });
  it('will not project a future window or top-ten coverage as full depth', () => {
    assert.equal(buildLiquidityTiles([], tileOpts({ decisionTimeNs: ns(999) })).reason, 'invalid_window');
    const s = sample(0, 10); s.view.coverage = 'top10';
    assert.equal(buildLiquidityTiles([s], tileOpts()).reason, 'sample_identity_or_coverage');
  });
  it('bounds malformed, out-of-order and excessive tile requests', () => {
    assert.equal(buildLiquidityTiles([sample(10, 10), sample(0, 10)], tileOpts()).reason, 'sample_order');
    assert.equal(buildLiquidityTiles([], tileOpts({ highTick: 99999 })).reason, 'invalid_price_window');
    assert.equal(buildLiquidityTiles([], tileOpts({ intervalNs: '0' })).reason, 'invalid_window');
  });
});

describe('venue-supplement edge cases', () => {
  it('finishes a snapshot with the first live F_LAST record without exposing interim state', () => {
    const book = new FuturesMboBook(context), b = seed();
    b.records[b.records.length - 1].flags &= ~FLAGS.LAST;
    b.records.push(record('N', { flags: FLAGS.LAST }));
    assert.equal(book.applyBatch(b).status, 'applied'); assert.equal(view(book).bids[0].size, 50);
  });
  it('discloses non-trading crossed depth rather than confusing it with executable quotes', () => {
    const book = ready(); book.applyBatch(batch('e2', 's1', [record('M', { side: 'B', order_id: '9007199254740992', price: px(30002), size: 20 })]));
    const v = book.view({ decisionTimeNs: ns(1000), maxAgeNs: '1000', marketStatus: 'non_trading' });
    assert.equal(v.status, 'ok'); assert.equal(v.bookState, 'crossed_non_trading');
    assert.equal(v.marketStatus, 'non_trading'); assert.equal(v.liquidityScope, 'displayed_orders_excludes_implied');
  });
  it('does not call a future footprint window complete or silently use session-wide CVD', () => {
    assert.equal(aggregateFootprint([], opts({ decisionTimeNs: ns(999) })).reason, 'invalid_window');
    assert.equal(aggregateFootprint([], opts()).cvdBasis, 'selected_window_start');
  });
});

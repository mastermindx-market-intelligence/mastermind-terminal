'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMboRecord, bindFuturesDefinition, FuturesEventAssembler } = require('../lib/futuresSource');
const { FLAGS, aggregateFootprint } = require('../lib/futuresMbo');
const base = 1791547200000000000n;
const ns = n => (base + BigInt(n)).toString();
const identity = { contract: 'ESZ6', publisherId: 1, instrumentId: 42, sessionId: '2026-10-09',
  validFromNs: ns(-10000), validUntilNs: ns(100000000), definitionId: 'synthetic:def:ESZ6', definitionAvailableAtNs: ns(-1000) };
const nq = { ...identity, contract: 'NQZ6', instrumentId: 43, definitionId: 'synthetic:def:NQZ6' };
const raw = (action = 'A', patch = {}) => ({ rtype: 160, publisher_id: 1, instrument_id: 42,
  channel_id: 0, sequence: 10, ts_event: ns(0), ts_recv: ns(1),
  order_id: '9007199254740993', price: '7500000000000', size: 5, action, side: 'B', flags: FLAGS.LAST, ...patch });
const envelope = (ordinal, record, patch = {}) => ({ sourceId: 'test:source', ordinal, availableAtNs: ns(10 + ordinal), record, ...patch });
const create = (extra = {}) => new FuturesEventAssembler({ sourceId: 'test:source', bindings: [identity, nq],
  availabilityBasis: 'vendor_capture_retrospective', ...extra });
const view = (s, id = 42, patch = {}) => s.view({ publisherId: 1, instrumentId: id,
  decisionTimeNs: ns(1000), maxAgeNs: '100000', marketStatus: 'continuous', ...patch });
const reset = patch => raw('R', { size: 0, price: '9223372036854775807', side: 'N', order_id: '0', sequence: 0,
  flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS, ...patch });
function seed(s) {
  assert.equal(s.push(envelope(0, reset())).status, 'buffered');
  assert.equal(s.push(envelope(1, raw('A', { flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS | FLAGS.LAST }))).bookStatus, 'applied');
}

describe('lossless normalized source boundary', () => {
  test('keeps uint64 IDs and ns clocks as strings', () => {
    const value = normalizeMboRecord(raw());
    assert.equal(value.order_id, '9007199254740993'); assert.equal(value.ts_event, base.toString());
  });
  for (const [field, value] of [
    ['order_id', 9007199254740993], ['ts_recv', Number(base)], ['price', 7500],
    ['price', '7500000000001'], ['price', '-250000000'], ['size', 0], ['size', 1.5],
    ['rtype', 10], ['flags', 256], ['channel_id', -1], ['sequence', 0x100000000],
    ['action', 'X'], ['side', 'X'], ['order_id', '18446744073709551615'], ['publisher_id', 1.1],
  ]) test(`rejects invalid ${field}:${value}`, () => assert.throws(() => normalizeMboRecord(raw('A', { [field]: value }))));
  test('allows unset price/size on reset/no-op records only', () => {
    assert.equal(normalizeMboRecord(reset()).size, 0);
    assert.throws(() => normalizeMboRecord(raw('T', { price: '9223372036854775807' })));
  });
});

describe('complete instrument event assembly', () => {
  test('publishes snapshot only after LAST; duplicate last input is idempotent', () => {
    const s = create();
    s.push(envelope(0, reset())); assert.equal(view(s).status, 'unavailable');
    const row = envelope(1, raw('A', { flags: FLAGS.SNAPSHOT | FLAGS.LAST | FLAGS.BAD_TS }));
    assert.equal(s.push(row).bookStatus, 'applied'); assert.equal(view(s).bids[0].size, 5);
    assert.equal(s.push(row).status, 'duplicate'); assert.equal(view(s).bids[0].size, 5);
  });
  test('does not mingle interleaved ES and NQ snapshot records', () => {
    const s = create();
    s.push(envelope(0, reset())); s.push(envelope(1, reset({ instrument_id: 43, channel_id: 1 })));
    s.push(envelope(2, raw('A', { instrument_id: 43, channel_id: 1, price: '25500000000000', flags: FLAGS.SNAPSHOT | FLAGS.LAST | FLAGS.BAD_TS })));
    assert.equal(view(s).status, 'unavailable'); assert.equal(view(s, 43).bids[0].priceTicks, 102000);
    s.push(envelope(3, raw('A', { flags: FLAGS.SNAPSHOT | FLAGS.LAST | FLAGS.BAD_TS })));
    assert.equal(view(s).bids[0].priceTicks, 30000);
  });
  test('can complete a snapshot using the first live LAST no-op', () => {
    const s = create(); s.push(envelope(0, reset()));
    s.push(envelope(1, raw('A', { flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS })));
    assert.equal(view(s).status, 'unavailable');
    const end = s.push(envelope(2, raw('N', { size: 0, price: '9223372036854775807', side: 'N' })));
    assert.equal(end.bookStatus, 'applied'); assert.equal(view(s).bids[0].size, 5);
  });
  test('count trades once without subtracting fills from resting orders', () => {
    const s = create(); seed(s);
    s.push(envelope(2, raw('T', { side: 'A', flags: 0, size: 2 })));
    const out = s.push(envelope(3, raw('F', { flags: FLAGS.LAST, size: 2 })));
    assert.equal(out.trades.length, 1); assert.equal(out.trades[0].aggressor, 'sell');
    assert.equal(out.trades[0].id, 'test:source:2'); assert.equal(view(s).bids[0].size, 5);
    s.push(envelope(4, raw('C', { size: 2 }))); assert.equal(view(s).bids[0].size, 3);
  });
  test('a missing depth snapshot does not discard actual executed volume', () => {
    const s = create(); const out = s.push(envelope(0, raw('T', { side: 'N', size: 7 })));
    assert.equal(out.bookStatus, 'unavailable'); assert.equal(out.trades.length, 1);
    assert.equal(out.executionCoverage, 'partial'); assert.equal(out.trades[0].aggressor, 'unknown');
    const fp = aggregateFootprint(out.trades, { ...identity, startNs: ns(-100), endNs: ns(100), decisionTimeNs: ns(1000),
      intervalNs: '200', sourceId: 'test:source', coverage: 'partial' });
    assert.equal(fp.observedVolume, 7); assert.equal(fp.bars[0].delta, null);
  });
  test('ignores unselected instruments but consumes their source ordinals', () => {
    const s = create(); assert.equal(s.push(envelope(0, raw('A', { instrument_id: 99 }))).status, 'ignored');
    assert.equal(s.push(envelope(1, reset({ flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS | FLAGS.LAST }))).bookStatus, 'applied');
  });
  test('consumes reserved bit without dropping LAST', () => {
    const s = create(); seed(s); assert.equal(s.push(envelope(2, raw('M', { flags: FLAGS.LAST | 1 }))).bookStatus, 'applied');
  });
});

describe('gaps, event bounds and validity', () => {
  test('venue sequence jumps are allowed; repeats and uint32 wrapping are allowed', () => {
    const s = create(); seed(s);
    for (const [i, sequence] of [100, 10000, 10000].entries())
      assert.equal(s.push(envelope(i + 2, raw('M', { sequence }))).bookStatus, 'applied');
    const wrap = create(); seed(wrap);
    assert.equal(wrap.push(envelope(2, raw('M', { sequence: 0xfffffffe }))).bookStatus, 'applied');
    assert.equal(wrap.push(envelope(3, raw('M', { sequence: 2 }))).bookStatus, 'applied');
  });
  test('regression invalidates rather than double applying an old event', () => {
    const s = create(); seed(s); s.push(envelope(2, raw('M', { sequence: 20 })));
    assert.equal(s.push(envelope(3, raw('M', { sequence: 10 }))).reason, 'venue_sequence_regression');
    assert.equal(view(s).status, 'unavailable');
  });
  test('missing source ordinal is not disguised as continuous source', () => {
    const s = create(); seed(s); assert.equal(s.push(envelope(3, raw('M'))).reason, 'source_ordinal_gap_or_reorder');
    assert.equal(view(s).status, 'unavailable');
  });
  test('vendor channel gap affects all bound books and recovery preserves gap evidence', () => {
    const s = create(); seed(s);
    const gap = s.push(envelope(2, raw('N', { instrument_id: 99, flags: FLAGS.LAST | FLAGS.BAD_BOOK })));
    assert.equal(gap.reason, 'vendor_channel_gap'); assert.equal(view(s).status, 'unavailable');
    s.push(envelope(3, reset({ flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS | FLAGS.LAST })));
    assert.equal(view(s).status, 'ok'); assert.equal(s.finish().gapCount, 1);
  });
  for (const flag of [FLAGS.TOB, FLAGS.MBP, FLAGS.SPECIFIC, FLAGS.BAD_TS])
    test(`unsupported/inaccurate flag ${flag} cannot produce healthy depth`, () => {
      const s = create(); seed(s); assert.equal(s.push(envelope(2, raw('M', { flags: FLAGS.LAST | flag }))).status, 'unavailable');
      assert.equal(view(s).status, 'unavailable');
    });
  test('bounds pending event memory and refuses partial EOF', () => {
    const s = create({ maxPendingRecords: 1 }); s.push(envelope(0, reset()));
    assert.equal(s.push(envelope(1, raw('A', { flags: FLAGS.SNAPSHOT | FLAGS.LAST }))).reason, 'pending_event_capacity');
    const t = create(); t.push(envelope(0, reset())); assert.equal(t.finish().reason, 'incomplete_final_event');
    assert.equal(t.push(envelope(1, raw())).reason, 'source_finished');
  });
  test('current depth cannot use a definition published in the future', () => {
    const s = create({ bindings: [{ ...identity, definitionAvailableAtNs: ns(9999) }] });
    assert.equal(s.push(envelope(0, reset())).reason, 'inactive_or_unavailable_definition');
  });
  test('expired contract and future/retrograde availability are rejected', () => {
    const s = create({ bindings: [{ ...identity, validUntilNs: ns(0) }] });
    assert.equal(s.push(envelope(0, reset())).status, 'unavailable');
    const t = create(); assert.equal(t.push(envelope(0, raw(), { availableAtNs: ns(0) })).reason, 'receive_after_availability');
    const u = create(); seed(u); assert.equal(u.push(envelope(2, raw(), { availableAtNs: ns(1) })).reason, 'availability_regression');
  });
});

describe('SDK definition binding', () => {
  const def = { rtype: 19, publisher_id: 1, instrument_id: 42, raw_symbol: 'ESZ6', instrument_class: 'F',
    min_price_increment: '250000000', activation: ns(-10000), expiration: ns(10000), ts_recv: ns(-10) };
  const ctx = { sourceId: 'test:def', sessionId: '2026-10-09', availableAtNs: ns(0) };
  test('derives identity and explicit valid interval from a definition', () => {
    const b = bindFuturesDefinition(def, ctx); assert.equal(b.contract, 'ESZ6');
    assert.equal(b.validUntilNs, ns(10000)); assert.match(b.definitionId, /^test:def:[a-f0-9]{64}$/);
  });
  for (const patch of [{ instrument_class: 'K' }, { raw_symbol: 'ESZ6-ESH7' }, { raw_symbol: 'ES.c.0' },
    { min_price_increment: '10000000' }, { expiration: '18446744073709551615' }, { activation: ns(20000) }])
    test(`refuses unverified/non-outright definition ${JSON.stringify(patch)}`, () => assert.throws(() => bindFuturesDefinition({ ...def, ...patch }, ctx)));
});

describe('venue status and chart decision validity', () => {
  const { selectFuturesStatus } = require('../lib/futuresSource');
  const status = (at, trading, patch = {}) => ({ availableAtNs: ns(at + 1),
    record: { rtype: 18, publisher_id: 1, instrument_id: 42, ts_event: ns(at - 1), ts_recv: ns(at),
      is_trading: trading, is_quoting: 'Y', ...patch } });
  test('uses the latest AVAILABLE status rather than the event date or local clock', () => {
    const items = [status(1, 'Y'), status(100, 'N')];
    assert.equal(selectFuturesStatus(items, identity, ns(100), '1000').marketStatus, 'continuous');
    assert.equal(selectFuturesStatus(items, identity, ns(101), '1000').marketStatus, 'non_trading');
  });
  test('does not substitute a different instrument status or invent unknown as open', () => {
    assert.equal(selectFuturesStatus([status(1, 'N', { instrument_id: 99 })], identity, ns(10), '1000').reason, 'status_unavailable');
    assert.equal(selectFuturesStatus([status(1, '~')], identity, ns(10), '1000').marketStatus, 'unknown');
  });
  test('stale or contradictory status records refuse', () => {
    assert.equal(selectFuturesStatus([status(1, 'Y')], identity, ns(10), '1').reason, 'stale_status');
    assert.equal(selectFuturesStatus([status(1, 'Y'), status(1, 'N')], identity, ns(10), '1000').reason, 'conflicting_status_revision');
  });
  test('contract validity also applies when viewing an already reconstructed book', () => {
    const s = create(); seed(s);
    assert.equal(view(s, 42, { decisionTimeNs: identity.validUntilNs, maxAgeNs: '999999999999' }).reason, 'contract_inactive');
  });
});

'use strict';
const assert = require('node:assert/strict');
const { FuturesEventAssembler, bindFuturesDefinition } = require('../../lib/futuresSource');
const BASE = Date.parse('2026-10-09T14:00:00Z');
const ns = ms => String(BigInt(BASE + ms) * 1000000n);
function fixture(pair = 'ES') {
  const sourceId = `fixture:${pair}:capture`;
  const binding = bindFuturesDefinition({ rtype: 19, publisher_id: 1, instrument_id: 42,
    instrument_class: 'F', raw_symbol: `${pair}Z6`, min_price_increment: '250000000',
    activation: ns(-86400000), expiration: ns(86400000), ts_recv: ns(-86400000) },
  { sourceId, sessionId: '2026-10-09', availableAtNs: ns(-86400000) });
  const assembler = new FuturesEventAssembler({ sourceId, bindings: [binding], availabilityBasis: 'recorded_receipt' });
  let ordinal = 0; const trades = [], depthSamples = [];
  const send = (at, records) => {
    records.forEach((patch, i) => {
      const record = { rtype: 160, publisher_id: 1, instrument_id: 42, ts_event: ns(at), ts_recv: ns(at),
        action: 'N', side: 'N', order_id: '0', price: '0', size: 0, channel_id: 0, sequence: ordinal,
        ...patch, flags: (patch.flags || 0) | (i === records.length - 1 ? 128 : 0) };
      const result = assembler.push({ sourceId, ordinal: ordinal++, availableAtNs: ns(at), record });
      if (result.status === 'event') { assert.equal(result.bookStatus, 'applied'); trades.push(...result.trades); }
    });
    depthSamples.push({ availableAtNs: ns(at), view: assembler.view({ publisherId: 1, instrumentId: 42,
      decisionTimeNs: ns(at), maxAgeNs: '120000000000', marketStatus: 'continuous' }) });
  };
  send(0, [{ action: 'R', flags: 40 }, { action: 'A', side: 'B', order_id: '1', price: '7500000000000', size: 40, flags: 40 },
    { action: 'A', side: 'A', order_id: '2', price: '7500250000000', size: 60, flags: 40 }]);
  send(1000, [{ action: 'T', side: 'B', order_id: '0', price: '7500250000000', size: 12 }]);
  send(61000, [{ action: 'T', side: 'A', order_id: '0', price: '7500000000000', size: 8 }]);
  return { capture: { binding, sourceId, availabilityBasis: 'recorded_receipt', windowStartMs: BASE,
    trades, depthSamples, tradeCoverage: 'partial', publication: { basis: 'historical', sourceAsOfMs: BASE + 120000,
      publishedAtMs: BASE + 120100, freshUntilMs: BASE + 125000 } },
    selection: { intervalMinutes: 1, priceStepTicks: 1, lowTick: 29999, highTick: 30002,
      maxBookAgeNs: '120000000000', cutoffsMs: [BASE + 60000, BASE + 120000] } };
}

module.exports = { fixture, BASE, ns };

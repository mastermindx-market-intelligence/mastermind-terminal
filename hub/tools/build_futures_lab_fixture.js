'use strict';
/** Synthetic development fixture through the REAL hub reducers; not market data. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { FuturesMboBook, aggregateFootprint, buildLiquidityTiles, FLAGS } = require('../lib/futuresMbo');
const baseMs = Date.parse('2026-10-09T14:00:00Z'), base = BigInt(baseMs) * 1000000n;
const at = seconds => (base + BigInt(seconds) * 1000000000n).toString();
const context = { contract: 'ESZ6', sessionId: '2026-10-09', publisherId: 1, instrumentId: 42 };
const book = new FuturesMboBook(context), samples = [], trades = [], lastPrices = [];
let previous = null;
const record = (action, second, patch = {}) => ({ action, side: 'N', order_id: '0', price: '0', size: 0,
  publisher_id: 1, instrument_id: 42, ts_event: at(second), ts_recv: at(second), flags: 0, ...patch });
function send(cursor, second, rows) {
  rows[rows.length - 1].flags |= FLAGS.LAST;
  const r = book.applyBatch({ ...context, cursor, previousCursor: previous,
    continuity: 'verified', availableAtNs: at(second), records: rows });
  assert.equal(r.status, 'applied'); previous = cursor; trades.push(...r.trades);
  samples.push({ availableAtNs: at(second), view: book.view({ decisionTimeNs: at(second),
    maxAgeNs: '120000000000', marketStatus: 'continuous' }) });
}
for (let minute = 0; minute < 24; minute++) {
  const center = 30000 + Math.round(minute * .58 + Math.sin(minute / 2) * 6);
  const second = minute * 60;
  // Each synthetic minute begins with a generated complete book snapshot.
  const rows = [record('R', second, { flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS })];
  for (let tick = 29980; tick <= 30040; tick++) {
    const side = tick <= center ? 'B' : 'A';
    const size = 30 + (tick * 7 + minute * 13) % 80 + (tick % 20 === 0 ? 230 : 0);
    rows.push(record('A', second, { side, flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS,
      order_id: String(tick), price: (BigInt(tick) * 250000000n).toString(), size }));
  }
  send(`synthetic:snapshot:${minute}`, second, rows);
  for (let j = 0; j < 8; j++) {
    const tick = center + (j % 3) - 1, when = second + 5 + j * 6;
    send(`synthetic:trade:${minute}:${j}`, when, [record('T', when, {
      side: minute === 12 && j === 0 ? 'N' : j % 3 === 0 ? 'A' : 'B',
      price: (BigInt(tick) * 250000000n).toString(), size: 5 + (minute * 3 + j * 7) % 35,
    })]);
  }
  lastPrices.push(center / 4);
}
const options = { ...context, startNs: at(0), endNs: at(1440), decisionTimeNs: at(1440), intervalNs: '60000000000',
  sourceId: 'synthetic:futures-lab:v1', coverage: 'complete', lowTick: 29980, highTick: 30040, maxAgeNs: '120000000000' };
const footprint = aggregateFootprint(trades, options);
const depth = buildLiquidityTiles(samples, options);
const gapSamples = samples.filter(s => {
  const sec = Number((BigInt(s.availableAtNs) - base) / 1000000000n); return sec < 600 || sec >= 720;
});
gapSamples.push({ availableAtNs: at(600), view: { status: 'unavailable', reason: 'synthetic_feed_gap' } });
gapSamples.sort((a, b) => BigInt(a.availableAtNs) < BigInt(b.availableAtNs) ? -1 : 1);
const depthGap = buildLiquidityTiles(gapSamples, options);
assert.equal(footprint.status, 'ok'); assert.equal(depth.status, 'ok'); assert.equal(depthGap.status, 'ok');
assert.equal(footprint.bars.length, 24); assert.equal(depthGap.columns[10].coverage, 'gap');
const fixture = { schema: 'terminal.futures_lab_fixture/v1', synthetic: true,
  warning: 'Synthetic research laboratory. Not live market data, investment evidence, or a production feature.',
  baseMs, ...context, lastPrices, footprint, depth, depthGap };
const output = path.resolve(__dirname, '../../terminal/fixtures/futures-microstructure.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(fixture) + '\n');
console.log(JSON.stringify({ output, bytes: fs.statSync(output).size, trades: trades.length,
  observedVolume: footprint.observedVolume, bars: footprint.bars.length, depthColumns: depth.columns.length }));

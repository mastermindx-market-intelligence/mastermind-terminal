'use strict';
/** Synthetic ES/NQ development fixtures through the SAME source and domain adapters. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { aggregateFootprint, buildLiquidityTiles, FLAGS } = require('../lib/futuresMbo');
const { FuturesEventAssembler } = require('../lib/futuresSource');
const baseMs = Date.parse('2026-10-09T14:00:00Z'), base = BigInt(baseMs) * 1000000n;
const at = seconds => (base + BigInt(seconds) * 1000000000n).toString();

function build({ pair, indexRoot, instrumentId, baseTick, basis, strikes, filename }) {
  const context = { contract: `${pair}Z6`, sessionId: '2026-10-09', publisherId: 1, instrumentId };
  const binding = { ...context, validFromNs: at(-86400), validUntilNs: at(86400),
    definitionId: `synthetic:${pair}:definition`, definitionAvailableAtNs: at(-86400) };
  const sourceId = `synthetic:${pair}:source:v2`;
  const source = new FuturesEventAssembler({ sourceId, bindings: [binding], availabilityBasis: 'recorded_receipt' });
  const samples = [], trades = [], lastPrices = [], frameInputs = [];
  let ordinal = 0;
  const record = (action, second, patch = {}) => ({ rtype: 160, action, side: 'N', order_id: '0', price: '0', size: 0,
    publisher_id: 1, instrument_id: instrumentId, channel_id: pair === 'ES' ? 0 : 1,
    sequence: ordinal, ts_event: at(second), ts_recv: at(second), flags: 0, ...patch });
  function send(second, rows) {
    rows[rows.length - 1].flags |= FLAGS.LAST;
    let result;
    for (const row of rows) result = source.push({ sourceId, ordinal: ordinal++, availableAtNs: at(second), record: row });
    assert.equal(result.status, 'event'); assert.equal(result.bookStatus, 'applied');
    trades.push(...result.trades);
    samples.push({ availableAtNs: at(second), view: source.view({ publisherId: 1, instrumentId,
      decisionTimeNs: at(second), maxAgeNs: '120000000000', marketStatus: 'continuous' }) });
  }
  const lowTick = baseTick - 20, highTick = baseTick + 60;
  for (let minute = 0; minute < 24; minute++) {
    const center = baseTick + Math.round(minute * (pair === 'ES' ? .58 : .91) + Math.sin(minute / 2) * (pair === 'ES' ? 6 : 10));
    const second = minute * 60;
    const rows = [record('R', second, { flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS })];
    for (let tick = lowTick; tick <= highTick; tick++) {
      const side = tick <= center ? 'B' : 'A';
      const size = 30 + (tick * 7 + minute * 13) % 80 + (tick % 20 === 0 ? 230 : 0);
      rows.push(record('A', second, { side, flags: FLAGS.SNAPSHOT | FLAGS.BAD_TS,
        order_id: String(tick), price: (BigInt(tick) * 250000000n).toString(), size }));
    }
    send(second, rows);
    for (let j = 0; j < 8; j++) {
      const tick = center + (j % 3) - 1, when = second + 5 + j * 6;
      send(when, [record('T', when, { side: minute === 12 && j === 0 ? 'N' : j % 3 === 0 ? 'A' : 'B',
        price: (BigInt(tick) * 250000000n).toString(), size: 5 + (minute * 3 + j * 7 + (pair === 'ES' ? 0 : 2)) % 35 })]);
    }
    const future = center / 4, index = future - basis + (minute % 3) * .04;
    const time = baseMs + (minute + 1) * 60000;
    lastPrices.push(future);
    const gamma = pair === 'ES' ? [65 + minute, -180 - minute * 3, 95 + minute * 2]
      : [45 + minute * 2, -140 - minute * 2, 80 + minute * 3];
    const byStrike = strikes.map((strike, n) => ({ strike, gamma_net: gamma[n] }));
    const matrix = { schema: 'options_structure.matrix/v1', root: indexRoot, asof: '2026-10-09',
      session: '2026-10-09', _build_meta: { asof_date: '2026-10-09' }, strikes,
      expiries: ['2026-10-09', '2026-10-16'], cells: strikes.flatMap((strike, n) => [
        { strike, expiry: '2026-10-09', gex: gamma[n] * .6 * 1e6 },
        { strike, expiry: '2026-10-16', gex: gamma[n] * .4 * 1e6 }]) };
    const receipt = { sessionDate: '2026-10-09', sourceAsOfMs: time - 5000, availableAtMs: time - 4000 };
    frameInputs.push({ quotes: { pair, indexRoot, futuresContract: context.contract,
      indexPrice: index, futuresPrice: future, indexTimestampMs: time - 1000, futuresTimestampMs: time - 500 },
      quoteAvailability: { indexAvailableAtMs: time - 900, futuresAvailableAtMs: time - 400,
        indexFeedBasis: 'realtime', futuresFeedBasis: 'realtime' },
      contract: { symbol: context.contract, definitionId: binding.definitionId,
        validFromMs: baseMs - 86400000, validUntilMs: baseMs + 86400000 },
      source: { schema: 'options_hub.gex/v1', root: indexRoot, asof: '2026-10-09', spot_ref: index,
        call_wall: strikes[2], put_wall: strikes[0], gamma_flip: strikes[1],
        coverage: { oi_date: 't-1' }, by_strike: byStrike },
      sourceReceipt: { ...receipt, artifactId: `synthetic:${pair}:gex:${minute}` },
      matrix: { payload: matrix, receipt: { ...receipt, artifactId: `synthetic:${pair}:matrix:${minute}` } },
      policy: { decisionTimeMs: time, maxQuoteAgeMs: 5000, maxExposureAgeMs: 60000, maxClockSkewMs: 2000, method: 'ratio' } });
  }
  const options = { ...context, startNs: at(0), endNs: at(1440), decisionTimeNs: at(1440),
    sourceId, coverage: 'complete', lowTick, highTick, maxAgeNs: '120000000000' };
  const gapSamples = samples.filter(s => {
    const sec = Number((BigInt(s.availableAtNs) - base) / 1000000000n); return sec < 600 || sec >= 720;
  });
  gapSamples.push({ availableAtNs: at(600), view: { status: 'unavailable', reason: 'synthetic_feed_gap' } });
  gapSamples.sort((a, b) => BigInt(a.availableAtNs) < BigInt(b.availableAtNs) ? -1 : 1);
  const footprints = {}, depthByInterval = {}, gapByInterval = {};
  for (const interval of [1, 5]) {
    const intervalNs = String(BigInt(interval) * 60000000000n);
    for (const priceStepTicks of [1, 4, 8]) {
      const footprint = aggregateFootprint(trades, { ...options, intervalNs, priceStepTicks });
      assert.equal(footprint.status, 'ok');
      footprints[`${interval}:${priceStepTicks}`] = footprint;
    }
    depthByInterval[interval] = buildLiquidityTiles(samples, { ...options, intervalNs });
    gapByInterval[interval] = buildLiquidityTiles(gapSamples, { ...options, intervalNs });
    assert.equal(depthByInterval[interval].status, 'ok');
  }
  assert.equal(source.finish().status, 'finished');
  const fixture = { schema: 'terminal.futures_lab_fixture/v2', synthetic: true,
    warning: 'Synthetic research laboratory. No live CME feed or predictive evidence.',
    baseMs, ...context, pair, indexRoot, lowTick, highTick, lastPrices, frameInputs,
    footprints, depthByInterval, gapByInterval };
  const output = path.resolve(__dirname, '../../terminal/fixtures', filename);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(fixture) + '\n');
  console.log(JSON.stringify({ output, bytes: fs.statSync(output).size, trades: trades.length,
    volume: footprints['1:1'].observedVolume, normalizedRecords: ordinal, variants: Object.keys(footprints).length }));
}
build({ pair: 'ES', indexRoot: 'SPX', instrumentId: 42, baseTick: 30000, basis: 20,
  strikes: [7475, 7480, 7485], filename: 'futures-microstructure.json' });
build({ pair: 'NQ', indexRoot: 'NDX', instrumentId: 43, baseTick: 102000, basis: 50,
  strikes: [25445, 25450, 25455], filename: 'futures-microstructure-nq.json' });

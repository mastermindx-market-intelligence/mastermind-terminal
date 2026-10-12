'use strict';
/** Internal historical sample comparison, never a production feed-admission receipt. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FuturesEventAssembler } = require('../lib/futuresSource');
const { aggregateFootprint, projectDepthWindow, FLAGS } = require('../lib/futuresMbo');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const key = (time, sequence) => `${time}:${sequence}`;
const check = (ok, why) => { if (!ok) throw new Error(why); };

function load(prefix) {
  const receipt = JSON.parse(fs.readFileSync(path.join(prefix, 'receipt.json'), 'utf8'));
  check(receipt.schema === 'futures.public_sample_acquisition/v1' && receipt.recordCount <= 250000, 'receipt');
  for (const [name, expected] of [['prefix.csv', receipt.rawPrefixSha256], ['normalized.jsonl', receipt.normalizedSha256]]) {
    const file = path.join(prefix, name); check(fs.statSync(file).size <= 256 * 1024 * 1024, 'file_capacity');
    check(hash(fs.readFileSync(file)) === expected, 'sample_digest_mismatch');
  }
  const rows = fs.readFileSync(path.join(prefix, 'normalized.jsonl'), 'utf8').trimEnd().split('\n').map(JSON.parse);
  const metadata = rows.shift();
  check(metadata.sourceId === `sha256:${receipt.rawPrefixSha256}` && rows.length === receipt.recordCount, 'source_integrity');
  return { metadata, rows, receipt };
}
function compareBbo(view, expected) {
  const changes = [];
  for (const [side, levels] of [['bid', view.bids], ['ask', view.asks]]) {
    const level = levels?.[0];
    const observed = { Price: level ? (BigInt(level.priceTicks) * 250000000n).toString() : '9223372036854775807',
      Size: level?.size ?? 0, Count: level?.orderCount ?? 0 };
    for (const field of ['Price', 'Size', 'Count'])
      if (observed[field] !== expected[`${side}${field}`]) changes.push(`${side}${field}`);
  }
  return changes;
}

function compareDepth10(view, expected) {
  check(Array.isArray(expected.levels) && expected.levels.length === 10, 'invalid_depth_reference');
  return expected.levels.flatMap((level, index) => compareBbo({
    bids: view.bids?.slice(index, index + 1), asks: view.asks?.slice(index, index + 1),
  }, level).map(field => `level${index + 1}:${field}`));
}

/** Two independent SOURCE SCHEMAS, not an independent exchange or counterparty. */
function compareSamples(mbo, reference, { retainEveryEventWindow = null } = {}) {
  check(mbo.receipt.sourceSchema === 'mbo' && ['mbp-1', 'mbp-10'].includes(reference.receipt.sourceSchema), 'sample_schemas');
  check(mbo.receipt.instruments.length === 1 && reference.receipt.instruments.length === 1 &&
    JSON.stringify(mbo.receipt.instruments) === JSON.stringify(reference.receipt.instruments), 'sample_identity_mismatch');
  const instrument = mbo.receipt.instruments[0];
  check(/^(ES|NQ)[HMUZ]\d{1,4}$/.test(instrument.symbol), 'non_index_sample');
  const start = BigInt(mbo.receipt.firstReceiveNs), referenceStart = BigInt(reference.receipt.firstReceiveNs);
  check(start === referenceStart, 'sample_start_mismatch');
  const end = BigInt(mbo.receipt.lastReceiveNs) < BigInt(reference.receipt.lastReceiveNs)
    ? BigInt(mbo.receipt.lastReceiveNs) : BigInt(reference.receipt.lastReceiveNs);
  // This binding scopes an offline math comparison to the observed sample window.
  // It is NOT an authenticated venue definition or an assertion of actual expiry.
  const binding = { ...instrument, contract: instrument.symbol,
    sessionId: new Date(Number(start / 1000000n)).toISOString().slice(0, 10),
    validFromNs: start.toString(), validUntilNs: (end + 1n).toString(),
    definitionId: `diagnostic-sample-window:${mbo.receipt.rawPrefixSha256}`,
    definitionAvailableAtNs: start.toString() };
  const assembler = new FuturesEventAssembler({ sourceId: mbo.metadata.sourceId, bindings: [binding],
    availabilityBasis: 'vendor_capture_retrospective' });
  const references = new Map(), repeatedReferenceGroups = new Set();
  let eligibleReferences = 0, referenceNonFinal = 0;
  for (const row of reference.rows) {
    const r = row.record;
    if (BigInt(r.receiveTimeNs) > end) continue;
    if (!(r.flags & FLAGS.LAST)) { referenceNonFinal++; continue; }
    check(r.publisherId === binding.publisherId && r.instrumentId === binding.instrumentId && r.symbol === binding.contract, 'reference_identity');
    const k = key(r.receiveTimeNs, r.sequence);
    if (references.has(k) && JSON.stringify(references.get(k)) !== JSON.stringify(r)) repeatedReferenceGroups.add(k);
    references.set(k, r); eligibleReferences++;
  }
  const trades = [], samples = [], seen = new Set(), mismatchExamples = [], failures = {}, mismatchFields = {};
  let completedEvents = 0, compared = 0, exact = 0, unavailable = 0, rawTradeCount = 0, rawTradeVolume = 0;
  let firstSnapshotOrders = null, initialSnapshotRows = 0;
  const lastCompletedIndex = new Map();
  for (let i = 0; i < mbo.rows.length; i++) {
    const row = mbo.rows[i], r = row.record;
    if (BigInt(row.availableAtNs) <= end && r.flags & FLAGS.LAST)
      lastCompletedIndex.set(key(r.ts_recv, r.sequence), i);
  }
  const timeStarted = performance.now();
  for (let ordinal = 0; ordinal < mbo.rows.length; ordinal++) {
    const row = mbo.rows[ordinal];
    if (BigInt(row.availableAtNs) > end) break;
    const r = row.record;
    if (r.action === 'T') { rawTradeCount++; rawTradeVolume += r.size; }
    if (r.flags & FLAGS.SNAPSHOT) initialSnapshotRows++;
    const result = assembler.push(row);
    if (result.status === 'unavailable' || (result.status === 'event' && result.bookStatus !== 'applied')) {
      unavailable++; const why = result.reason || result.bookReason; failures[why] = (failures[why] || 0) + 1;
    }
    trades.push(...result.trades);
    if (result.status !== 'event') continue;
    completedEvents++;
    const k = key(r.ts_recv, r.sequence);
    // A packet sequence + receive timestamp can carry MULTIPLE instrument events.
    // MBP emits only BBO-changing rows; their counts need not equal MBO event counts.
    // Compare the FINAL complete state of each shared packet/time group, in source order.
    // A packet can end with the START of the next unfinished event. Compare its
    // last completed state, not an uncommitted suffix or a future packet.
    const groupComplete = lastCompletedIndex.get(k) === ordinal;
    const expected = groupComplete ? references.get(k) : null;
    // Preserve source-time depth views for the actual internal browser proof, but
    // bound samples to once per second plus reference comparisons. No public export.
    const needsDepthSample = retainEveryEventWindow !== null || !samples.length || BigInt(row.availableAtNs) - BigInt(samples.at(-1).availableAtNs) >= 1000000000n;
    if (!expected && !needsDepthSample) continue;
    const view = assembler.view({ publisherId: binding.publisherId, instrumentId: binding.instrumentId,
      decisionTimeNs: row.availableAtNs, maxAgeNs: '1000000000', marketStatus: 'unknown' });
    if (firstSnapshotOrders === null && view.status === 'ok')
      firstSnapshotOrders = [...view.bids, ...view.asks].reduce((sum, l) => sum + l.orderCount, 0);
    if (needsDepthSample) samples.push({ availableAtNs: row.availableAtNs, view: retainEveryEventWindow === null ? view
      : projectDepthWindow(view, retainEveryEventWindow.lowTick, retainEveryEventWindow.highTick) });
    if (!expected) continue;
    seen.add(k);
    compared++;
    const different = view.status === 'ok' ? (reference.receipt.sourceSchema === 'mbp-10' ? compareDepth10 : compareBbo)(view, expected) : [`book:${view.reason}`];
    if (!different.length) exact++;
    else {
      for (const field of different) mismatchFields[field] = (mismatchFields[field] || 0) + 1;
      if (mismatchExamples.length < 12) mismatchExamples.push({ sequence: r.sequence, receiveTimeNs: r.ts_recv,
        fields: different, expected, observed: { status: view.status, bid: view.bids?.[0], ask: view.asks?.[0] } });
    }
  }
  const finish = assembler.finish();
  const unmatched = [...references.keys()].filter(k => !seen.has(k)).length;
  const tradeVolume = trades.reduce((sum, t) => sum + t.size, 0);
  const footprint = aggregateFootprint(trades, { ...binding, startNs: start.toString(), endNs: (end + 1n).toString(),
    decisionTimeNs: (end + 1n).toString(), intervalNs: '60000000000', sourceId: mbo.metadata.sourceId,
    // Availability and venue normalization established, but no independent raw trade tape yet.
    coverage: unavailable ? 'gap' : 'partial' });
  check(['ok', 'partial'].includes(footprint.status), `footprint_failed:${footprint.reason}; source_failures:${JSON.stringify(failures)}; compared:${compared}; exact:${exact}; unmatched:${unmatched}`);
  const report = { schema: 'futures.public_sample_comparison/v1', generatedAt: new Date().toISOString(),
    sourceUrl: mbo.receipt.sourceUrl, referenceUrl: reference.receipt.sourceUrl,
    sourceRawSha256: mbo.receipt.rawPrefixSha256, referenceRawSha256: reference.receipt.rawPrefixSha256,
    sourceNormalizedSha256: mbo.receipt.normalizedSha256, referenceNormalizedSha256: reference.receipt.normalizedSha256,
    referenceSchema: reference.receipt.sourceSchema, comparisonDepth: reference.receipt.sourceSchema === 'mbp-10' ? 10 : 1,
    contract: instrument.symbol, startNs: start.toString(), endNs: end.toString(),
    sourceRecords: mbo.rows.length, referenceRecords: reference.rows.length, initialSnapshotRows, firstSnapshotOrders,
    completedEvents, eligibleReferences, referenceNonFinal, compared, exact, mismatches: compared - exact,
    unmatchedReferences: unmatched, uniqueReferenceGroups: references.size, repeatedReferenceGroups: repeatedReferenceGroups.size,
    comparisonBoundary: 'final_instrument_state_per_receive_timestamp_and_packet_sequence', unavailableEvents: unavailable,
    reasons: failures, mismatchFields, rawTradeCount, admittedTradeCount: trades.length,
    rawTradeVolume, admittedTradeVolume: tradeVolume, footprintVolume: footprint.observedVolume,
    tradeConservation: rawTradeCount === trades.length && rawTradeVolume === tradeVolume && footprint.observedVolume === tradeVolume,
    elapsedMs: performance.now() - timeStarted,
    result: compared > 0 && exact === compared && !unmatched && !unavailable && finish.status === 'finished'
      ? (reference.receipt.sourceSchema === 'mbp-10' ? 'historical_displayed_depth10_agrees' : 'historical_displayed_bbo_agrees') : 'comparison_incomplete_or_mismatched',
    fullBookOracle: false, fullSession: false, live: false, authenticatedVenueDefinition: false,
    availabilityBasis: 'vendor_capture_retrospective', subscriberDisplayRights: 'not_established',
    interpretation: `Reconstructed displayed ${reference.receipt.sourceSchema === 'mbp-10' ? 'top-ten depth' : 'BBO'} vs separately supplied vendor ${reference.receipt.sourceSchema} schema, not proof of full-book queues or production admission.` };
  return { report, privateData: { binding, samples, trades, footprint, mismatchExamples, endNs: end.toString(), startNs: start.toString() } };
}
module.exports = { compareBbo, compareDepth10, compareSamples, load };
if (require.main === module) {
  const root = path.resolve(__dirname, '../../.local-futures');
  const [mboFolder = 'public-mbo-300s', bboFolder = 'public-mbp-1-300s'] = process.argv.slice(2);
  check(/^[a-z0-9-]+$/.test(mboFolder) && /^[a-z0-9-]+$/.test(bboFolder), 'invalid_local_sample_directory');
  const result = compareSamples(load(path.join(root, mboFolder)), load(path.join(root, bboFolder)));
  const label = result.report.comparisonDepth === 10 ? 'depth10-comparison' : 'comparison';
  fs.writeFileSync(path.join(root, label + '-private.json'), JSON.stringify(result.privateData));
  fs.writeFileSync(path.join(root, label + '-report.json'), JSON.stringify(result.report, null, 2) + '\n');
  console.log(JSON.stringify(result.report, null, 2));
  if (!['historical_displayed_bbo_agrees', 'historical_displayed_depth10_agrees'].includes(result.report.result) || !result.report.tradeConservation) process.exitCode = 2;
}

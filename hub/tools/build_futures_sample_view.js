'use strict';
/** Build an INTERNAL development view of the verified public historical prefix.
 * It never pairs generated GEX with real prices or publishes vendor sample rows.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { compareSamples, load } = require('./compare_futures_sample');
const { buildLiquidityTiles, aggregateFootprint } = require('../lib/futuresMbo');
const root = path.resolve(__dirname, '../../.local-futures');
const mbo = load(path.join(root, 'public-mbo-300s'));
const bbo = load(path.join(root, 'public-mbp-1-300s'));
const firstReference = bbo.rows[0].record;
const anchorTick = Number(BigInt(firstReference.bidPrice) / 250000000n);
// Window fixed from the INITIAL observable quote, not future session extremes.
const lowTick = anchorTick - 24, highTick = anchorTick + 24;
const { report, privateData } = compareSamples(mbo, bbo, { retainEveryEventWindow: { lowTick, highTick } });
if (report.result !== 'historical_displayed_bbo_agrees' || !report.tradeConservation)
  throw new Error('source_comparison_not_accepted');
const start = BigInt(privateData.startNs), end = BigInt(privateData.endNs);
const framesByCutoff = [], totals = [];
for (let minute = 1; minute <= 5; minute++) {
  const cutoff = start + BigInt(minute) * 60000000000n;
  if (cutoff > end) break;
  const common = { ...privateData.binding, startNs: start.toString(), endNs: cutoff.toString(),
    decisionTimeNs: cutoff.toString(), intervalNs: '60000000000', sourceId: mbo.metadata.sourceId,
    coverage: 'partial', lowTick, highTick, maxAgeNs: '120000000000' };
  const footprint = aggregateFootprint(privateData.trades, common);
  const depth = buildLiquidityTiles(privateData.samples, common);
  if (footprint.status === 'unavailable' || depth.status !== 'ok') throw new Error('sample_projection_failed');
  const columns = new Map(depth.columns.map(c => [c.startNs, c]));
  const frames = footprint.bars.map(bar => ({ endMs: Number(BigInt(bar.endNs) / 1000000n), bar,
    depth: columns.get(bar.startNs) ?? null,
    // There is NO contemporaneous SPX exposure/quote pair in this sample.
    gex: { status: 'unavailable', reason: 'source_unavailable' } }));
  framesByCutoff.push(frames);
  totals.push({ cutoffMs: Number(cutoff / 1000000n), observedContracts: footprint.observedVolume,
    bars: footprint.bars.length, depthCoverage: depth.columns.map(c => c.coverageFraction) });
}
const bundle = { schema: 'terminal.futures_public_sample_view/v1', live: false, synthetic: false,
  contract: report.contract, source: 'Databento public CME historical CSV sample',
  availabilityBasis: 'vendor_capture_retrospective', referenceDefinition: 'diagnostic_sample_window_only',
  gammaAvailability: 'not_in_source_sample', subscriberDisplayRights: 'not_established',
  baseMs: Number(start / 1000000n), lowTick, highTick, framesByCutoff,
  sourceRawSha256: report.sourceRawSha256, referenceRawSha256: report.referenceRawSha256,
  comparison: { compared: report.compared, exact: report.exact, mismatches: report.mismatches,
    unmatched: report.unmatchedReferences, tradeConservation: report.tradeConservation },
  depthSampling: 'every_completed_source_event', depthPriceWindow: 'initial_quote_plus_minus_24_ticks', totals };
const data = JSON.stringify(bundle) + '\n';
const sha256 = createHash('sha256').update(data).digest('hex');
fs.writeFileSync(path.join(root, 'browser-canary.json'), data);
const receipt = { schema: 'futures.private_view_receipt/v1', sha256, bytes: Buffer.byteLength(data),
  sourceRecords: report.sourceRecords, exactSourceEventViews: privateData.samples.length,
  replayCutoffs: framesByCutoff.length, live: false, synthetic: false, sourceRawSha256: report.sourceRawSha256,
  bboAgreement: `${report.exact}/${report.compared}`, totals,
  noGamma: true, noPublicMarketRows: true, depthSampling: bundle.depthSampling };
fs.writeFileSync(path.join(root, 'browser-canary-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));

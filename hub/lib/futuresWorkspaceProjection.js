'use strict';
/**
 * Compose an existing capture owner's admitted events into its workspace publication.
 * Pure projection: no socket, clock issuer, archive, permission grant, file writer or scheduler.
 * The caller retains capture continuity, definition admission and distribution authority.
 */
const { createHash } = require('node:crypto');
const { aggregateFootprint, buildLiquidityTiles } = require('./futuresMbo');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const reference = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v);
const clock = v => Number.isSafeInteger(v) && v > 0 && v <= 8640000000000000;
const ns = v => typeof v === 'string' && /^(0|[1-9]\d{0,19})$/.test(v) && BigInt(v) < (1n << 64n) - 1n;
const check = (condition, reason) => { if (!condition) throw Error(reason); };
const hash = value => createHash('sha256').update(value).digest('hex');
const nanos = ms => BigInt(ms) * 1000000n;

function buildFuturesWorkspacePublication(capture, selection) {
  try {
    check(object(capture) && object(selection) && object(capture.binding) && object(capture.publication), 'invalid_capture');
    const b = capture.binding, p = capture.publication;
    check(/^(ES|NQ)[HMUZ]\d{1,4}$/.test(b.contract) && reference(b.definitionId) && reference(b.sessionId) &&
      Number.isSafeInteger(b.publisherId) && b.publisherId >= 0 && Number.isSafeInteger(b.instrumentId) && b.instrumentId >= 0 &&
      ns(b.validFromNs) && ns(b.validUntilNs) && ns(b.definitionAvailableAtNs), 'invalid_binding');
    const pair = b.contract.startsWith('ES') ? 'ES' : 'NQ';
    check(reference(capture.sourceId) && ['recorded_receipt', 'vendor_capture_retrospective'].includes(capture.availabilityBasis), 'invalid_source');
    check(['historical', 'delayed', 'realtime'].includes(p.basis) && (p.basis === 'historical' || capture.availabilityBasis === 'recorded_receipt'), 'invalid_time_basis');
    check(clock(capture.windowStartMs) && clock(p.sourceAsOfMs) && clock(p.publishedAtMs) && clock(p.freshUntilMs) &&
      p.publishedAtMs >= p.sourceAsOfMs && p.freshUntilMs >= p.sourceAsOfMs &&
      p.freshUntilMs - p.sourceAsOfMs <= (p.basis === 'realtime' ? 15000 : 900000), 'invalid_publication_clock');
    check(nanos(capture.windowStartMs) >= BigInt(b.validFromNs) && nanos(capture.windowStartMs) >= BigInt(b.definitionAvailableAtNs) &&
      BigInt(b.validFromNs) < BigInt(b.validUntilNs), 'definition_unavailable');
    check(['complete', 'partial', 'gap'].includes(capture.tradeCoverage), 'missing_execution_coverage');
    check(Array.isArray(capture.trades) && capture.trades.length <= 100000 && Array.isArray(capture.depthSamples) && capture.depthSamples.length <= 100000, 'capture_capacity');
    check([1, 5].includes(selection.intervalMinutes) && [1, 4, 8].includes(selection.priceStepTicks), 'unsupported_variant');
    check(Number.isSafeInteger(selection.lowTick) && selection.lowTick > 0 && Number.isSafeInteger(selection.highTick) &&
      selection.highTick >= selection.lowTick && selection.highTick - selection.lowTick < 2048, 'invalid_price_window');
    check(Array.isArray(selection.cutoffsMs) && selection.cutoffsMs.length >= 1 && selection.cutoffsMs.length <= 32 &&
      selection.cutoffsMs.every((v, i, a) => clock(v) && v > capture.windowStartMs && v <= p.sourceAsOfMs &&
        v - capture.windowStartMs <= 4 * 3600000 && nanos(v) <= BigInt(b.validUntilNs) && (!i || v > a[i - 1])), 'invalid_cutoffs');
    check(ns(selection.maxBookAgeNs) && BigInt(selection.maxBookAgeNs) <= 900000000000n, 'invalid_book_age');
    const distribution = capture.distribution ?? { audience: 'internal_only' };
    check(object(distribution) && ['internal_only', 'subscriber_display'].includes(distribution.audience), 'invalid_distribution');
    // Preserve an existing publisher decision; this function never creates or verifies a license.
    check(distribution.audience !== 'subscriber_display' || reference(distribution.evidenceRef), 'missing_distribution_decision');
    const gammaAttachments = Object.create(null), views = [];
    let retainedCells = 0, gammaBytes = 0;
    for (const cutoffMs of selection.cutoffsMs) {
      const common = { ...b, sourceId: capture.sourceId, startNs: nanos(capture.windowStartMs).toString(),
        endNs: nanos(cutoffMs).toString(), decisionTimeNs: nanos(cutoffMs).toString(),
        intervalNs: String(selection.intervalMinutes * 60000000000), priceStepTicks: selection.priceStepTicks,
        coverage: capture.tradeCoverage, lowTick: selection.lowTick, highTick: selection.highTick, maxAgeNs: selection.maxBookAgeNs };
      const footprint = aggregateFootprint(capture.trades, common), depth = buildLiquidityTiles(capture.depthSamples, common);
      check(footprint.status !== 'unavailable' && depth.status === 'ok', 'projection_unavailable');
      check(footprint.bars.length <= 240, 'frame_capacity');
      retainedCells += footprint.bars.reduce((n, b) => n + b.cells.length, 0) + depth.columns.reduce((n, c) => n + c.levels.length, 0);
      check(retainedCells <= 80000, 'publication_cell_capacity');
      const columns = new Map(depth.columns.map(column => [column.startNs, column]));
      const frames = footprint.bars.map(bar => {
        check(BigInt(bar.endNs) % 1000000n === 0n, 'submillisecond_bar_end');
        const endMs = Number(BigInt(bar.endNs) / 1000000n);
        const frame = { endMs, bar, depth: columns.get(bar.startNs) ?? null };
        const attachment = capture.gammaByEndMs?.[String(endMs)];
        if (attachment !== undefined) {
          check(object(attachment), 'invalid_gamma_attachment');
          const json = JSON.stringify(attachment); check(Buffer.byteLength(json) <= 1048576, 'gamma_capacity');
          const id = hash(json);
          if (!(id in gammaAttachments)) { gammaBytes += Buffer.byteLength(json); check(gammaBytes <= 3 * 1024 * 1024, 'gamma_capacity'); gammaAttachments[id] = JSON.parse(json); }
          frame.gammaAttachmentRef = id;
        }
        return frame;
      });
      views.push({ cutoffMs, intervalMinutes: selection.intervalMinutes, priceStepTicks: selection.priceStepTicks,
        tradeCoverage: capture.tradeCoverage, frames });
    }
    check(Object.keys(gammaAttachments).length <= 240, 'gamma_frame_capacity');
    const source = { schema: 'hub.futures_workspace_source/v1', pair, contract: b.contract, sessionId: b.sessionId,
      audience: distribution.audience, distributionEvidenceRef: distribution.evidenceRef ?? null,
      definition: { id: b.definitionId, contract: b.contract, validFromNs: b.validFromNs,
        validUntilNs: b.validUntilNs, availableAtNs: b.definitionAvailableAtNs },
      sourceId: capture.sourceId, basis: p.basis,
      availabilityBasis: capture.availabilityBasis === 'recorded_receipt' ? 'source_observed' : 'vendor_capture_retrospective',
      sourceAsOfMs: p.sourceAsOfMs, publishedAtMs: p.publishedAtMs, freshUntilMs: p.freshUntilMs,
      lowTick: selection.lowTick, highTick: selection.highTick, gammaAttachments, views };
    const payloadJson = JSON.stringify(source); check(Buffer.byteLength(payloadJson) <= 4 * 1024 * 1024, 'publication_capacity');
    return { status: 'ok', leaf: `${pair}-${selection.intervalMinutes}-${selection.priceStepTicks}.json`, source,
      envelope: { schema: 'hub.futures_publication/v1', payloadJson, payloadSha256: hash(payloadJson) },
      interpretation: 'caller_owned_publication_projection_not_a_license_or_live_installation' };
  } catch (error) { return { status: 'unavailable', reason: error instanceof Error ? error.message : 'invalid_capture' }; }
}
module.exports = { buildFuturesWorkspacePublication };

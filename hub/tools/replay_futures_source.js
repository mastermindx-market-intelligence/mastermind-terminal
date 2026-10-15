'use strict';
/** Offline source canary, not a stream server. No purchases, sockets or publication. */
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const readline = require('node:readline');
const { FuturesEventAssembler } = require('../lib/futuresSource');

async function replayNormalizedSource(file, { sha256, bindings, decisionTimeNs, maxAgeNs, maxRecords = 1000000 }) {
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(maxRecords) || maxRecords < 1)
    throw new Error('invalid_canary_policy');
  if (typeof decisionTimeNs !== 'string' || !/^[0-9]{1,20}$/.test(decisionTimeNs)) throw new Error('decision_time_required');
  const cutoff = BigInt(decisionTimeNs);
  const handle = await fs.promises.open(file, 'r');
  const before = await handle.stat();
  if (!before.isFile() || before.size > 512 * 1024 * 1024) { await handle.close(); throw new Error('source_file_capacity'); }
  let assembler, metadata, rows = 0, events = 0, buffered = 0, trades = 0, volume = 0, unavailableEvents = 0;
  let lastAvailable = null, deferredRows = 0;
  const reasons = {}, hash = createHash('sha256');
  const stream = handle.createReadStream({ autoClose: false, highWaterMark: 65536 });
  stream.on('data', data => hash.update(data));
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line) > 2 * 1024 * 1024) throw new Error('line_capacity');
      const row = JSON.parse(line);
      if (!metadata) {
        if (row.kind !== 'metadata' || row.schema !== 'hub.futures_source_records/v1' ||
            row.dataset !== 'GLBX.MDP3' || row.sourceSchema !== 'mbo' ||
            row.sourceId !== `sha256:${row.inputSha256}` || !/^[a-f0-9]{64}$/.test(row.inputSha256))
          throw new Error('invalid_source_metadata');
        metadata = row;
        assembler = new FuturesEventAssembler({ sourceId: row.sourceId, bindings,
          availabilityBasis: row.availabilityBasis });
        continue;
      }
      if (row.kind !== 'record' || rows >= maxRecords) throw new Error('invalid_record_or_capacity');
      if (row.ordinal !== rows || typeof row.availableAtNs !== 'string' || !/^[0-9]{1,20}$/.test(row.availableAtNs))
        throw new Error('invalid_source_ordinal_or_clock');
      const available = BigInt(row.availableAtNs);
      if (lastAvailable !== null && available < BigInt(lastAvailable)) throw new Error('source_clock_regression');
      rows++; lastAvailable = row.availableAtNs;
      if (available > cutoff) { deferredRows++; continue; }
      const result = assembler.push(row);
      if (result.status === 'event') events++;
      if (result.status === 'buffered') buffered++;
      if (result.status === 'unavailable' || result.bookStatus === 'unavailable') {
        unavailableEvents++;
        const reason = result.reason || result.bookReason || 'unknown'; reasons[reason] = (reasons[reason] || 0) + 1;
      }
      for (const trade of result.trades) {
        trades++; volume += trade.size;
        if (!Number.isSafeInteger(volume)) throw new Error('volume_overflow');
      }
    }
    if (!assembler) throw new Error('missing_metadata');
    const after = await handle.stat(), digest = hash.digest('hex');
    if (digest !== sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('normalized_source_changed_or_digest_mismatch');
    // A historical cutoff is not a truncated physical file. Retain the last
    // completed event at the cutoff; never process a later event merely to finish it.
    const finish = deferredRows ? { status: 'cutoff', recordCount: rows - deferredRows, gapCount: assembler.gaps } : assembler.finish();
    const views = bindings.map(b => {
      const v = assembler.view({ publisherId: b.publisherId, instrumentId: b.instrumentId,
        decisionTimeNs, maxAgeNs, marketStatus: 'unknown' });
      return { contract: b.contract, status: v.status, reason: v.reason ?? null,
        bestBid: v.bids?.[0] ?? null, bestAsk: v.asks?.[0] ?? null,
        bidLevels: v.bids?.length ?? null, askLevels: v.asks?.length ?? null };
    });
    return { schema: 'hub.futures_source_canary/v1', sourceId: metadata.sourceId,
      normalizedSha256: digest, decoder: metadata.decoder, normalizationIntegrity: 'verified',
      availabilityBasis: metadata.availabilityBasis, rows, deferredRows, decisionTimeNs, events, buffered, observedTrades: trades,
      observedContracts: volume, unavailableEvents, reasons, finish, views,
      live: false, comparison: 'no_independent_full_book_reference',
      acceptance: finish.status === 'unavailable' || views.some(v => v.status !== 'ok')
        ? 'source_not_ready_for_depth' : 'replayed_requires_external_book_comparison' };
  } finally {
    lines.close(); stream.destroy(); await handle.close();
  }
}
module.exports = { replayNormalizedSource };

if (require.main === module) {
  // A binding file comes from the existing reference/receipt owner. This CLI does
  // not issue definitions or interpret a user-supplied object as authenticated.
  const [file, digest, bindingsFile, decision, maxAge] = process.argv.slice(2);
  if (!file || !digest || !bindingsFile || !decision || !maxAge) {
    console.error('Usage: node replay_futures_source.js INPUT.jsonl SHA256 BINDINGS.json DECISION_NS MAX_AGE_NS');
    process.exitCode = 2;
  } else {
    Promise.resolve().then(() => JSON.parse(fs.readFileSync(bindingsFile, 'utf8')))
      .then(bindings => replayNormalizedSource(file, { sha256: digest, bindings, decisionTimeNs: decision, maxAgeNs: maxAge }))
      .then(result => { console.log(JSON.stringify(result, null, 2)); if (result.acceptance === 'source_not_ready_for_depth') process.exitCode = 2; })
      .catch(error => { console.error(JSON.stringify({ status: 'refused', reason: error.message })); process.exitCode = 2; });
  }
}

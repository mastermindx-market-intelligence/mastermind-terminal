#!/usr/bin/env node
/**
 * Bounded, explicit-file verification of the real IEX historical cohort.
 * Loads the actual TypeScript engine with the existing esbuild dependency.
 * No acquisition, fixture fallback, publisher, server, or persistent watcher.
 */
import { createHash } from 'node:crypto';
import { readFile, stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..');
const SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'AMD', 'INTC', 'MU', 'ARM'];
// Reviewed source pins include every local module that supplies engine behavior.
// Update these together after review; old receipts keep their original source identities.
const ENGINE_SOURCE_SHA256 = {
  'terminal/lib/largeTrades/engine.ts': 'e3edcfc728778340bc9eb5c14b627974c85006f8d930d1ad6071a682303ba5c6',
  'terminal/lib/largeTrades/types.ts': '46697ecd6f1ab5354c363ec16e1f1d8fce062a5a518c1d1e213c43329c67dcb3',
  'terminal/lib/largeTrades/accounting.ts': '4fa4542dc6d50d294837b629e98b4bed1bb5a1335b5da95a6a7f8513e064b48b',
};
const SOURCE_FILES = [
  ...Object.keys(ENGINE_SOURCE_SHA256),
  'ingest/iex_deep_trades.py',
  'docs/LARGE_TRADES_ABSORPTION.md',
  'terminal/package-lock.json',
  'terminal/scripts/verify-large-trades.mjs',
];
const INPUT_FILES = [...SYMBOLS.map(symbol => symbol + '.json'),
  'decode-receipt.json', 'native-record-provenance.json'];
const HEX256 = /^[a-f0-9]{64}$/;
const NS = /^(0|[1-9][0-9]{0,19})$/;
const MAX_REPLAY_WORK = 2_000_000;

class VerificationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function ensure(condition, code, message) {
  if (!condition) throw new VerificationError(code, message);
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sum = values => values.reduce((total, value) => total + BigInt(value), 0n);
const compareNs = (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
function exactNumber(value, label) {
  ensure(value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER),
    'QUANTITY_OVERFLOW', 'Unsafe aggregate integer: ' + label);
  return Number(value);
}
function integer(value, label) {
  ensure(Number.isSafeInteger(value) && value >= 0, 'INVALID_RECEIPT', 'Invalid count: ' + label);
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function utc(ns) {
  ensure(typeof ns === 'string' && NS.test(ns), 'INVALID_CLOCK', 'Invalid nanosecond clock');
  const value = BigInt(ns);
  const wholeSeconds = value / 1_000_000_000n;
  return new Date(Number(wholeSeconds * 1000n)).toISOString().slice(0, 19)
    + '.' + (value % 1_000_000_000n).toString().padStart(9, '0') + 'Z';
}
function clockRange(values) {
  const sorted = [...values].sort(compareNs);
  ensure(sorted.length > 0, 'EMPTY_COHORT', 'No observations in required cohort');
  return { firstNs: sorted[0], lastNs: sorted.at(-1),
    firstUtc: utc(sorted[0]), lastUtc: utc(sorted.at(-1)) };
}
async function requiredFile(fullPath, label, limit = 16 * 1024 * 1024) {
  let info, bytes;
  try {
    info = await stat(fullPath);
    ensure(info.isFile() && info.size <= limit, 'INPUT_SIZE', 'Invalid or oversized file: ' + label);
    bytes = await readFile(fullPath);
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError('INPUT_UNAVAILABLE',
      'Required authorized file is missing or unreadable: ' + label
      + '. Supply an explicit existing input directory and installed project dependencies.');
  }
  return { file: label, bytes: bytes.length, sha256: sha256(bytes), content: bytes };
}
function parseJson(file) {
  try { return JSON.parse(file.content.toString('utf8')); }
  catch { throw new VerificationError('INVALID_JSON', 'Invalid JSON: ' + file.file); }
}
const fileIdentity = file => ({ file: file.file, bytes: file.bytes, sha256: file.sha256 });
function argumentsFor(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    console.log('Usage: node terminal/scripts/verify-large-trades.mjs --input-dir <authorized-decode-directory> --output <sanitized-receipt.json>');
    console.log('Run from the repository root or use absolute paths. Both arguments are required.');
    return null;
  }
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    ensure(['--input-dir', '--output'].includes(key) && value && !value.startsWith('--')
      && !options[key], 'USAGE', 'Use --input-dir <directory> --output <receipt.json>, once each.');
    options[key] = value;
  }
  ensure(options['--input-dir'] && options['--output'], 'USAGE',
    'Both --input-dir and --output are required; no default feed or fixture is selected.');
  const inputDir = path.resolve(options['--input-dir']);
  const output = path.resolve(options['--output']);
  const relativeOutput = path.relative(inputDir, output);
  ensure(relativeOutput.startsWith('..' + path.sep) || path.isAbsolute(relativeOutput),
    'OUTPUT_BOUNDARY', 'The receipt must be outside the authorized input directory.');
  ensure(output.endsWith('.json') && !SOURCE_FILES.some(file => output === path.join(REPO_ROOT, file)),
    'OUTPUT_BOUNDARY', 'Choose a separate JSON receipt file.');
  return { inputDir, output };
}
function noUnsupportedEvidence(snapshot) {
  ensure(snapshot.dataMode === 'historical' && snapshot.evidenceMode === 'HISTORICAL_REPLAY',
    'MODE_MISMATCH', 'Historical input lost its historical mode');
  ensure(snapshot.accounting.quantityBasis === 'net_of_observed_cancels'
    && snapshot.accounting.correctionCoverage === 'unknown'
    && snapshot.accounting.correctionEvidence === null,
  'UNSUPPORTED_CORRECTION_AUTHORITY', 'Legacy archive acquired unsupported correction authority');
  for (const cluster of snapshot.clusters) {
    const response = cluster.response;
    ensure(cluster.orderCount === null, 'UNSUPPORTED_ORDER_COUNT', 'Execution reports became an order count');
    ensure(['pending', 'unobservable'].includes(response.state)
      && response.absorption === 'unavailable' && response.evidence === 'unavailable'
      && response.predictiveSignal === false && response.responseTicks === null
      && (response.maxExcursionTicks ?? null) === null
      && (response.pathEvidence ?? 'unavailable') === 'unavailable',
    'UNSUPPORTED_INFERENCE', 'Partial historical data produced unsupported response or absorption evidence');
  }
}
async function loadActualEngine(sourceFiles) {
  for (const [file, expected] of Object.entries(ENGINE_SOURCE_SHA256)) {
    const actual = sourceFiles.find(source => source.file === file);
    ensure(actual?.sha256 === expected, file.endsWith('/engine.ts')
      ? 'ENGINE_HASH_MISMATCH' : 'ENGINE_DEPENDENCY_HASH_MISMATCH',
    'Actual reviewed source SHA256 differs for ' + file + '. Expected ' + expected
      + ', observed ' + String(actual?.sha256));
  }
  let bundle;
  try {
    bundle = await esbuild.build({
      absWorkingDir: PACKAGE_ROOT,
      entryPoints: [path.join(REPO_ROOT, SOURCE_FILES[0])],
      bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
      metafile: true, logLevel: 'silent',
      tsconfigRaw: { compilerOptions: { target: 'ES2022' } },
    });
  } finally {
    esbuild.stop();
  }
  const bundledInputs = Object.keys(bundle.metafile.inputs).map(file =>
    path.relative(REPO_ROOT, path.resolve(PACKAGE_ROOT, file)).split(path.sep).join('/')).sort();
  ensure(canonical(bundledInputs) === canonical(Object.keys(ENGINE_SOURCE_SHA256).sort()),
    'ENGINE_DEPENDENCIES_CHANGED', 'The reviewed engine dependency boundary changed');
  ensure(bundle.outputFiles.length === 1
    && Object.values(bundle.metafile.outputs).every(output => output.imports.length === 0),
    'ENGINE_BUNDLE', 'Engine bundle must be self-contained');
  const bytes = bundle.outputFiles[0].contents;
  const engine = await import('data:text/javascript;base64,' + Buffer.from(bytes).toString('base64'));
  ensure(typeof engine.buildLargeTradesSnapshot === 'function'
    && typeof engine.validateLargeTradesEnvelope === 'function'
    && typeof engine.settingsFromParams === 'function', 'ENGINE_API', 'Required actual engine exports missing');
  return { engine, bundledModuleSha256: sha256(bytes), bundledInputs };
}
async function main(options) {
  const [sourceFiles, inputFiles] = await Promise.all([
    Promise.all(SOURCE_FILES.map(file => requiredFile(path.join(REPO_ROOT, file), file))),
    Promise.all(INPUT_FILES.map(file => requiredFile(path.join(options.inputDir, file), file))),
  ]);
  const sources = new Map(sourceFiles.map(file => [file.file, file]));
  const inputs = new Map(inputFiles.map(file => [file.file, file]));
  const decoder = parseJson(inputs.get('decode-receipt.json'));
  ensure(decoder.schema === 'mastermind.iex_large_trades_decode.v1',
    'DECODE_SCHEMA', 'Unsupported decode receipt schema');
  ensure(HEX256.test(decoder.decoderSourceSha256)
    && decoder.decoderSourceSha256 === sources.get('ingest/iex_deep_trades.py').sha256, 'DECODER_HASH_MISMATCH',
    'Decode receipt source SHA256 ' + String(decoder.decoderSourceSha256)
    + ' differs from current decoder source SHA256 ' + sources.get('ingest/iex_deep_trades.py').sha256
    + '. Reconcile the exact decoder and explicitly regenerate the authorized cohort before replacing evidence.');
  ensure(canonical([...decoder.symbols].sort()) === canonical([...SYMBOLS].sort()),
    'COHORT_SCOPE', 'This verifier requires the seven declared IEX symbols');
  ensure(decoder.coverage === 'partial' && decoder.responseCoverage === 'unavailable'
    && decoder.consolidatedNbboAvailable === false
    && decoder.originalIntradayMastermindAvailabilityProven === false
    && decoder.predictiveValidation === false && decoder.archiveExhausted === false,
    'COHORT_SCOPE', 'Unexpected completeness, quote, clock, or predictive assertion in decoder receipt');
  ensure(HEX256.test(decoder.recordedArchiveSha256)
    && decoder.recordedArchiveSha256 === decoder.acquisitionReceipt.sha256
    && HEX256.test(decoder.acquisitionReceiptSha256)
    && HEX256.test(decoder.decompressedPrefixSha256),
    'SOURCE_HASH', 'Invalid recorded acquisition or decompressed-prefix identity');
  const artifactMap = new Map();
  ensure(Array.isArray(decoder.artifacts), 'ARTIFACT_MANIFEST', 'Decoder artifact manifest missing');
  for (const artifact of decoder.artifacts) {
    ensure(INPUT_FILES.includes(artifact.file) && artifact.file !== 'decode-receipt.json'
      && !artifactMap.has(artifact.file), 'ARTIFACT_MANIFEST', 'Unexpected or duplicate decoder artifact');
    artifactMap.set(artifact.file, artifact);
  }
  for (const file of inputFiles.filter(file => file.file !== 'decode-receipt.json')) {
    const recorded = artifactMap.get(file.file);
    ensure(recorded && recorded.sha256 === file.sha256 && recorded.bytes === file.bytes,
      'ARTIFACT_HASH_MISMATCH', 'Decoder artifact bytes or SHA256 mismatch: ' + file.file);
  }
  const native = parseJson(inputs.get('native-record-provenance.json'));
  ensure(Array.isArray(native) && native.length > 0 && native.length <= 10000,
    'NATIVE_PROVENANCE', 'Native provenance must be a bounded nonempty record array');
  const nativeById = new Map();
  for (const record of native) {
    ensure(typeof record.printId === 'string' && !nativeById.has(record.printId)
      && SYMBOLS.includes(record.symbol) && record.source
      && HEX256.test(record.source.rawMessageSha256),
    'NATIVE_PROVENANCE', 'Invalid or duplicate native provenance identity');
    const source = record.source;
    for (const key of ['captureTimestampNs', 'sendTimestampNs', 'messageSequence']) {
      ensure(typeof source[key] === 'string' && NS.test(source[key]),
        'NATIVE_CLOCK', 'Native provenance clock or sequence is invalid');
    }
    ensure(typeof source.captureTicks === 'string' && NS.test(source.captureTicks)
      && typeof source.captureTicksPerSecond === 'string' && NS.test(source.captureTicksPerSecond)
      && BigInt(source.captureTicksPerSecond) > 0n
      && typeof source.captureOffsetSeconds === 'string'
      && /^-?[0-9]+$/.test(source.captureOffsetSeconds),
    'CAPTURE_CLOCK', 'Native capture clock basis is invalid');
    const recomputedCapture = BigInt(source.captureTicks) * 1_000_000_000n
      / BigInt(source.captureTicksPerSecond) + BigInt(source.captureOffsetSeconds) * 1_000_000_000n;
    ensure(recomputedCapture.toString() === source.captureTimestampNs,
      'CAPTURE_CLOCK', 'Native capture clock disagrees with its preserved PCAPNG basis');
    nativeById.set(record.printId, record);
  }
  const { engine, bundledModuleSha256, bundledInputs } = await loadActualEngine(sourceFiles);
  const settings = {
    accounting: engine.settingsFromParams({ minQuantity: 1, aggregate: false, adaptive: false, maxMarkers: 1000 }),
    display: engine.settingsFromParams({}),
  };
  const envelopes = SYMBOLS.map(symbol => parseJson(inputs.get(symbol + '.json')));
  const usedNativeIds = new Set();
  const resultBySymbol = [];
  const totalTypes = { L: { records: 0, shares: 0n }, T: { records: 0, shares: 0n } };
  const totals = { records: 0, shares: 0n, buy: 0n, sell: 0n, unknown: 0n, prefixComparisons: 0 };
  const archiveClocks = new Set(), generatedClocks = new Set(), dates = new Set();
  let replayWork = 0;
  for (let index = 0; index < envelopes.length; index++) {
    const envelope = envelopes[index], symbol = SYMBOLS[index];
    ensure(engine.validateLargeTradesEnvelope(envelope), 'ENVELOPE_VALIDATION',
      'Actual engine rejected envelope: ' + symbol);
    const provenance = envelope.provenance;
    ensure(envelope.instrument.symbol === symbol && envelope.instrument.assetClass === 'equity'
      && envelope.instrument.quantityUnit === 'shares' && envelope.instrument.priceScale === 10000
      && envelope.instrument.tickSizeInt === null && provenance.provider === 'IEX'
      && provenance.venue === 'IEX' && provenance.scope === 'venue'
      && provenance.dataMode === 'historical' && provenance.evidenceMode === 'HISTORICAL_REPLAY'
      && provenance.receiptBasis === 'archive_acquisition' && provenance.coverage === 'partial'
      && provenance.sourceSha256 === decoder.recordedArchiveSha256
      && provenance.sequenceGaps === 0 && envelope.responses.length === 0
      && envelope.responseCoverage === 'unavailable' && envelope.responseKnownAtNs === null
      && envelope.accounting === undefined,
    'ENVELOPE_SCOPE', 'Unexpected data provenance or response scope: ' + symbol);
    archiveClocks.add(provenance.acquiredAtNs); generatedClocks.add(provenance.generatedAtNs);
    ensure(envelope.prints.length === decoder.rowsBySymbol[symbol] && envelope.prints.length > 0,
      'ROW_CONSERVATION', 'Envelope report count disagrees with decoder: ' + symbol);
    const types = { L: { records: 0, shares: 0n }, T: { records: 0, shares: 0n } };
    const sides = { buy: 0n, sell: 0n, unknown: 0n };
    const ownNative = [];
    for (const print of envelope.prints) {
      ensure(print.kind === 'trade' && print.eligible && ['L', 'T'].includes(print.sourceRecordType),
        'COHORT_SCOPE', 'This bounded cohort verifier requires eligible L/T executions without observed breaks');
      ensure(print.availableNs === provenance.acquiredAtNs, 'KNOWLEDGE_CLOCK',
        'Historical execution is not gated at the declared archive acquisition');
      const record = nativeById.get(print.id);
      ensure(record && record.symbol === symbol && record.source.messageSequence === print.sourceSequence
        && !usedNativeIds.has(print.id), 'NATIVE_LINKAGE', 'Native identity, symbol, or sequence mismatch');
      usedNativeIds.add(print.id); ownNative.push(record);
      ensure(BigInt(record.source.captureTimestampNs) <= BigInt(provenance.acquiredAtNs)
        && BigInt(record.source.sendTimestampNs) <= BigInt(provenance.acquiredAtNs),
        'NATIVE_CLOCK', 'Native capture or send clock is later than archive acquisition');
      if (record.sideInferenceQualified) {
        ensure(print.sourceRecordType === 'L' && print.sideMethod === 'resting_order'
          && ['buy', 'sell'].includes(record.restingSideBefore)
          && print.side === (record.restingSideBefore === 'buy' ? 'sell' : 'buy'),
        'SIDE_PROVENANCE', 'Side inference is not supported by native resting-order provenance');
      } else {
        ensure(print.side === 'unknown' && print.sideMethod === 'unknown',
          'SIDE_PROVENANCE', 'Unqualified native record acquired a directional side');
      }
      const quantity = BigInt(print.quantity);
      types[print.sourceRecordType].records++; types[print.sourceRecordType].shares += quantity;
      totalTypes[print.sourceRecordType].records++; totalTypes[print.sourceRecordType].shares += quantity;
      sides[print.side] += quantity;
      dates.add(utc(print.eventNs).slice(0, 10));
    }
    const quantity = sum(envelope.prints.map(print => print.quantity));
    const fullClock = { marketCutoffNs: envelope.range.endNs, knowledgeCutoffNs: provenance.generatedAtNs };
    const accounting = engine.buildLargeTradesSnapshot(envelope, settings.accounting, fullClock);
    const display = engine.buildLargeTradesSnapshot(envelope, settings.display, fullClock);
    for (const snapshot of [accounting, display]) {
      noUnsupportedEvidence(snapshot);
      ensure(BigInt(snapshot.diagnostics.eligibleQuantity) === quantity
        && snapshot.diagnostics.eligibleTrades === envelope.prints.length
        && snapshot.diagnostics.unknownQuantity === exactNumber(sides.unknown, 'unknown shares')
        && snapshot.diagnostics.excludedRecords === 0 && snapshot.diagnostics.cancellations === 0
        && snapshot.diagnostics.unmatchedCancels === 0 && snapshot.diagnostics.duplicateRecords === 0
        && snapshot.diagnostics.conflictingIds === 0,
      'ENGINE_CONSERVATION', 'Engine diagnostics disagree with independent native share totals: ' + symbol);
    }
    ensure(!accounting.diagnostics.markerLimitApplied
      && accounting.clusters.length === envelope.prints.length
      && sum(accounting.clusters.map(cluster => cluster.quantity)) === quantity,
    'ACCOUNTING_MARKERS', 'Unaggregated one-share-threshold markers lost execution quantity: ' + symbol);
    const beforeAcquisitionClock = { ...fullClock,
      knowledgeCutoffNs: (BigInt(provenance.acquiredAtNs) - 1n).toString() };
    const beforeAcquisition = engine.buildLargeTradesSnapshot(envelope, settings.accounting, beforeAcquisitionClock);
    noUnsupportedEvidence(beforeAcquisition);
    ensure(beforeAcquisition.visiblePrints.length === 0 && beforeAcquisition.clusters.length === 0
      && beforeAcquisition.diagnostics.eligibleQuantity === 0, 'ARCHIVE_LOOKAHEAD',
    'Executions became available before archive acquisition: ' + symbol);

    // Every distinct event cutoff in this bounded cohort, plus an empty prefix and range end.
    const cutoffs = [...new Set([
      (BigInt(envelope.range.startNs) - 1n).toString(),
      ...envelope.prints.map(print => print.eventNs), envelope.range.endNs,
    ])].sort(compareNs);
    replayWork += cutoffs.length * envelope.prints.length;
    ensure(replayWork <= MAX_REPLAY_WORK, 'REPLAY_BUDGET',
      'Explicit cohort exceeds the bounded exhaustive-prefix verification budget');
    const replayDigest = createHash('sha256');
    for (const cutoff of cutoffs) {
      const clock = { marketCutoffNs: cutoff, knowledgeCutoffNs: provenance.generatedAtNs };
      const prefix = { ...envelope, prints: envelope.prints.filter(print =>
        BigInt(print.eventNs) <= BigInt(cutoff) && BigInt(print.availableNs) <= BigInt(clock.knowledgeCutoffNs)) };
      for (const mode of ['accounting', 'display']) {
        const fromFull = engine.buildLargeTradesSnapshot(envelope, settings[mode], clock);
        const fromPrefix = engine.buildLargeTradesSnapshot(prefix, settings[mode], clock);
        noUnsupportedEvidence(fromFull);
        const fullDigest = sha256(canonical(fromFull)), prefixDigest = sha256(canonical(fromPrefix));
        ensure(fullDigest === prefixDigest, 'PREFIX_DIVERGENCE',
          'Actual engine full-input and explicit-prefix replay disagree: ' + symbol + ', ' + mode);
        replayDigest.update(canonical({ cutoff, mode, snapshotSha256: fullDigest }) + '\n');
        totals.prefixComparisons++;
      }
    }
    const responseStates = {};
    for (const cluster of display.clusters) {
      responseStates[cluster.response.state] = (responseStates[cluster.response.state] ?? 0) + 1;
    }
    totals.records += envelope.prints.length; totals.shares += quantity;
    for (const side of ['buy', 'sell', 'unknown']) totals[side] += sides[side];
    resultBySymbol.push({
      symbol, envelope: fileIdentity(inputs.get(symbol + '.json')), executionReports: envelope.prints.length,
      executedShares: exactNumber(quantity, 'symbol shares'),
      nativeExecutions: Object.fromEntries(Object.entries(types).map(([type, value]) =>
        [type, { reports: value.records, shares: exactNumber(value.shares, type) }])),
      sideShares: Object.fromEntries(Object.entries(sides).map(([side, value]) => [side, exactNumber(value, side)])),
      nativeEvidenceRecordsMatched: ownNative.length,
      nativeRestingOrderInferenceRecords: ownNative.filter(record => record.sideInferenceQualified).length,
      exchangeEventClock: clockRange(envelope.prints.map(print => print.eventNs)),
      nativeCaptureClock: clockRange(ownNative.map(record => record.source.captureTimestampNs)),
      nativeTransportSendClock: clockRange(ownNative.map(record => record.source.sendTimestampNs)),
      preAcquisition: { knowledgeCutoffNs: beforeAcquisitionClock.knowledgeCutoffNs,
        visibleReports: 0, executedShares: 0, markers: 0, status: 'PASS' },
      accounting: { markers: accounting.clusters.length,
        quantityBasis: accounting.accounting.quantityBasis,
        correctionCoverage: accounting.accounting.correctionCoverage,
        correctionEvidence: accounting.accounting.correctionEvidence,
        snapshotSha256: sha256(canonical(accounting)), quantityReconciled: true },
      display: { retainedMarkers: display.clusters.length,
        qualifyingClusters: display.diagnostics.qualifyingClusters,
        markerLimitApplied: display.diagnostics.markerLimitApplied, responseStates,
        snapshotSha256: sha256(canonical(display)) },
      prefixReplay: { distinctCutoffs: cutoffs.length, settingsModes: 2,
        comparisons: cutoffs.length * 2, comparisonDigestSha256: replayDigest.digest('hex'), status: 'PASS' },
    });
  }
  ensure(archiveClocks.size === 1 && generatedClocks.size === 1 && dates.size === 1,
    'COHORT_CLOCK', 'This proof requires one acquisition and one partial trading date');
  ensure(usedNativeIds.size === native.length && totals.records === native.length,
    'NATIVE_CONSERVATION', 'Native provenance and normalized envelope records are not one-to-one');
  const acquiredAtNs = [...archiveClocks][0];
  const acquiredMs = Date.parse(decoder.acquisitionReceipt.acquired_at_utc);
  ensure(Number.isSafeInteger(acquiredMs) && BigInt(acquiredMs) * 1_000_000n === BigInt(acquiredAtNs),
    'ACQUISITION_CLOCK', 'Acquisition receipt and envelopes disagree on archive availability');
  ensure(totals.shares === BigInt(integer(decoder.conservation.grossExecutedShares, 'gross executed shares'))
    && totals.shares === BigInt(integer(decoder.conservation.netUnbrokenShares, 'net unbroken shares'))
    && decoder.conservation.matchedBrokenShares === 0
    && totals.shares === BigInt(integer(decoder.counters.gross_executed_shares, 'decoder gross shares'))
    && totalTypes.L.records === decoder.counters.native_L_executions
    && totalTypes.T.records === decoder.counters.native_T_executions,
  'DECODE_CONSERVATION', 'Actual engine, normalized records, and native decoder receipt do not reconcile');
  ensure(Array.isArray(decoder.gapExamples) && decoder.gapExamples.length === 0,
    'GAP_SCOPE', 'This proof expects zero observed gaps within the bounded prefix');

  // Re-read identities before writing to avoid binding results to changed source or input files.
  const finalFiles = await Promise.all([
    ...SOURCE_FILES.map(file => requiredFile(path.join(REPO_ROOT, file), file)),
    ...INPUT_FILES.map(file => requiredFile(path.join(options.inputDir, file), file)),
  ]);
  const originalFiles = [...sourceFiles, ...inputFiles];
  const changedFiles = finalFiles.filter((file, index) => file.sha256 !== originalFiles[index].sha256);
  ensure(changedFiles.length === 0, 'FILES_CHANGED_DURING_VERIFICATION',
    'Source or authorized inputs changed during verification: '
    + changedFiles.map(file => file.file + ' (current SHA256 ' + file.sha256 + ')').join(', '));
  const receipt = {
    schema: 'mastermind.large_trades.real_data_verification.v1',
    status: 'PASS',
    verifiedAtUtc: new Date().toISOString(),
    proofScope: 'BOUNDED_HISTORICAL_NATIVE_TO_ENGINE_REPLAY',
    runtime: { node: process.version, loader: 'esbuild in-memory bundle of actual TypeScript source',
      esbuild: esbuild.version, bundledInputs, bundledModuleSha256, watchersStarted: false },
    sourceCode: sourceFiles.map(fileIdentity),
    inputs: { decoderReceipt: fileIdentity(inputs.get('decode-receipt.json')),
      nativeProvenance: fileIdentity(inputs.get('native-record-provenance.json')) },
    source: {
      provider: 'IEX', dataset: 'HIST DEEP+ 1.0', venue: 'IEX', scope: 'venue',
      quantityUnit: 'shares', dataMode: 'historical', evidenceMode: 'HISTORICAL_REPLAY',
      tradingDates: [...dates].sort(), receiptBasis: 'archive_acquisition',
      recordedArchiveSha256: decoder.recordedArchiveSha256,
      recordedArchiveBytes: integer(decoder.acquisitionReceipt.actual_size_bytes, 'recorded archive bytes'),
      recordedAcquisitionReceiptSha256: decoder.acquisitionReceiptSha256,
      acquisitionReceiptHashIndependentlyRecomputed: false,
      archiveSha256IndependentlyRecomputed: false,
      fullArchiveReopenedByThisVerifier: false, archiveExhausted: false, gzipFullIntegrityChecked: false,
      decoderSourceSha256: decoder.decoderSourceSha256, decoderSourceMatchesWorktree: true,
      decompressedPrefixSha256: decoder.decompressedPrefixSha256,
      decompressedPrefixRecomputedByThisVerifier: false,
      decompressedBytesReadByDecoder: integer(decoder.decompressedBytesRead, 'decompressed prefix bytes'),
      decoderStopReason: decoder.stopReason,
      packetsExaminedByDecoder: integer(decoder.counters.packets, 'decoder packets'),
      uniqueNativeMessagesExaminedByDecoder: integer(decoder.counters.unique_messages, 'unique messages'),
      coverage: 'partial', observedGapExamples: 0, completeSessionClaim: false,
      originalIntradayMastermindAvailabilityProven: false,
      sourceAuthenticationAndNetworkChecksumsVerified: false,
      nativeSpecifications: {
        deepPlus: 'https://www.iex.io/documents/iex-deep-plus-specification',
        transport: 'https://www.iex.io/documents/iex-tp-v1',
        pcapng: 'https://www.ietf.org/ietf-ftp/internet-drafts/draft-ietf-opsawg-pcapng-06.html',
      },
    },
    clocks: {
      archiveAcquiredAtNs: acquiredAtNs, archiveAcquiredAtUtc: utc(acquiredAtNs),
      envelopesGeneratedAtNs: [...generatedClocks][0],
      marketClock: 'Native execution eventNs; original archive event ordering.',
      knowledgeClock: 'Archive acquisition availableNs; never original intraday Mastermind availability.',
      nativeCaptureClock: 'Preserved PCAPNG capture clock; independently reconciled to ticks, resolution, and offset.',
      nativeTransportSendClock: 'Preserved IEX-TP send clock; separate from execution and capture clocks.',
      liveOrDelayedFeedProven: false,
    },
    settings,
    verification: {
      executionReports: totals.records, nativeEvidenceRecordsMatched: usedNativeIds.size,
      grossExecutedShares: exactNumber(totals.shares, 'total shares'),
      matchedBrokenShares: 0, netUnbrokenShares: exactNumber(totals.shares, 'total shares'),
      nativeExecutions: Object.fromEntries(Object.entries(totalTypes).map(([type, value]) =>
        [type, { reports: value.records, shares: exactNumber(value.shares, type) }])),
      sideShares: { buy: exactNumber(totals.buy, 'buy'), sell: exactNumber(totals.sell, 'sell'),
        unknown: exactNumber(totals.unknown, 'unknown') },
      sideMethod: 'Opposite of qualified native resting-order chain for L; unqualified L and T remain unknown.',
      orderCount: null, exactIntegerQuantityReconciliation: 'PASS',
      legacyCorrectionAccounting: {
        quantityBasis: 'net_of_observed_cancels', correctionCoverage: 'unknown',
        correctionEvidence: null, checkedAtEveryReplayCutoff: true,
        beforeAcquisitionChecked: true, status: 'PASS',
      },
      beforeAcquisitionKnowledgeGate: 'PASS',
      prefixReplay: {
        strategy: 'Every distinct eventNs, empty prefix, and range end; full input versus explicit filtered prefix at identical market and archive-knowledge cutoffs.',
        settingsModes: ['accounting', 'display'], comparisons: totals.prefixComparisons,
        status: 'PASS', originalIntradayAsSeenProof: false,
      },
      responseEvidence: 'unavailable', qualifiedQuoteObservations: 0, tickMetadataAvailable: false,
      absorptionClaims: 0, failedContinuationClaims: 0, predictiveClaims: 0,
      evidenceAbstention: 'PASS', realBreakCasesObserved: 0,
    },
    bySymbol: resultBySymbol,
    outOfSampleResearch: {
      status: 'NOT_ESTIMABLE', protocol: 'docs/LARGE_TRADES_ABSORPTION.md',
      protocolSha256: sources.get('docs/LARGE_TRADES_ABSORPTION.md').sha256,
      reasons: ['Single partial trading session', 'No qualified response quotes', 'No verified tick metadata',
        'No independent held-out sessions or response outcomes'],
      parameterSearchTrials: 0, fittedParameters: false, heldOutSessionsEvaluated: 0,
      predictiveSuccessRate: null, predictiveEffectEstimate: null,
    },
    limitations: [
      'Venue-only equity executions; no consolidated market, CME/MNQ contracts, or distinct-order-count claim.',
      'Packet-limited historical prefix; later corrections and the complete session were not examined.',
      'Net-of-observed-cancels quantity is not final exchange accounting; correction coverage remains unknown.',
      'Recorded archive and decompressed-prefix hashes are receipt evidence, not a fresh full-archive verification.',
      'Native capture timestamps do not establish original intraday Mastermind receipt or latency.',
      'Unknown side remains unknown. No quote, absorption, trapped-position, alpha, or performance estimate is established.',
      'This CLI verifies native-to-engine data behavior; it does not establish chart, deployment, or production acceptance.',
    ],
  };
  // Explicit whitelist above prevents native payloads, print IDs, IPs, sourceRef, and private paths entering Git evidence.
  const outputText = JSON.stringify(receipt, null, 2) + '\n';
  ensure(!/\/(?:Volumes|Users|workspace)\/|"(?:prints|rawMessageSha256|printId|sourceRef|archivePath|local_path|ipSource|ipDestination)"\s*:/.test(outputText),
    'RECEIPT_SANITIZATION', 'Receipt contains a prohibited raw or private field');
  await mkdir(path.dirname(options.output), { recursive: true });
  const temporary = options.output + '.tmp-' + process.pid;
  try {
    await writeFile(temporary, outputText, { flag: 'wx' });
    await rename(temporary, options.output);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  console.log(JSON.stringify({ status: 'PASS', executionReports: totals.records,
    executedShares: exactNumber(totals.shares, 'total shares'),
    prefixComparisons: totals.prefixComparisons, outOfSample: 'NOT_ESTIMABLE',
    engineSha256: sourceFiles[0].sha256, decoderReceiptSha256: inputs.get('decode-receipt.json').sha256,
    receiptSha256: sha256(outputText) }));
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options) await main(options);
} catch (error) {
  // Sanitized errors only; no raw execution records, absolute paths, or stack trace.
  console.error(JSON.stringify({
    status: 'FAIL',
    code: error instanceof VerificationError ? error.code : 'VERIFIER_ERROR',
    message: error instanceof VerificationError ? error.message
      : 'Verification could not complete. Inspect the explicit inputs and installed project dependencies locally.',
  }));
  process.exitCode = 1;
} finally {
  esbuild.stop();
}

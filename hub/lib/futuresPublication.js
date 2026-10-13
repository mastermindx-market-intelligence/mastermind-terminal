'use strict';
/** Existing Quote Hub read adapter for capture-owner publications; never starts a feed or writes data. */
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_FILE_BYTES = 8 * 1024 * 1024, MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const ref = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(x);
const hash = x => createHash('sha256').update(x).digest('hex');

async function readFuturesPublication(pair, { root = '', nowMs = Date.now() } = {}) {
  if (pair !== 'ES' && pair !== 'NQ') return { status: 'unavailable', reason: 'bad_request' };
  if (!root) return { status: 'unavailable', reason: 'source_unavailable' };
  if (!path.isAbsolute(root) || !Number.isSafeInteger(nowMs)) return { status: 'unavailable', reason: 'source_invalid' };
  let file;
  try {
    // Only two fixed leaves; no arbitrary URL, contract, source path, or symlink from a caller.
    file = await fs.open(path.join(root, pair + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await file.stat();
    if (!before.isFile() || before.size < 2 || before.size > MAX_FILE_BYTES) throw Error('size');
    const bytes = Buffer.alloc(before.size + 1); let read = 0;
    while (read < bytes.length) {
      const result = await file.read(bytes, read, bytes.length - read, null);
      if (!result.bytesRead) break; read += result.bytesRead;
    }
    const after = await file.stat();
    if (read !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('changed');
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read)));
    if (!object(envelope) || envelope.schema !== 'hub.futures_publication/v1' ||
        typeof envelope.payloadJson !== 'string' || Buffer.byteLength(envelope.payloadJson) > MAX_PAYLOAD_BYTES ||
        envelope.payloadSha256 !== hash(envelope.payloadJson)) throw Error('digest');
    const source = JSON.parse(envelope.payloadJson);
    if (!object(source) || source.schema !== 'hub.futures_workspace_source/v1' || source.pair !== pair ||
        !Number.isSafeInteger(source.publishedAtMs) || source.publishedAtMs > nowMs) throw Error('identity');
    if (source.audience !== 'subscriber_display' || !ref(source.distributionEvidenceRef))
      return { status: 'unavailable', reason: 'source_restricted' };
    // Hash is a byte-binding witness only. The configured capture publisher must already
    // hold the applicable rights and grant; writing an arbitrary ID is not license assent.
    return { status: 'data', raw: envelope.payloadJson, sha256: envelope.payloadSha256 };
  } catch (error) {
    return { status: 'unavailable', reason: error?.code === 'ENOENT' ? 'source_unavailable' : 'source_invalid' };
  } finally { if (file) await file.close(); }
}
async function handleFuturesRequest(res, url, options) {
  const fail = reason => {
    const body = JSON.stringify({ error: reason });
    res.writeHead(reason === 'bad_request' ? 400 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }); res.end(body);
  };
  if ([...url.searchParams.keys()].some(k => k !== 'pair') || url.searchParams.getAll('pair').length !== 1) return fail('bad_request');
  const result = await readFuturesPublication(url.searchParams.get('pair'), options);
  if (result.status !== 'data') return fail(result.reason);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
    'Content-Length': Buffer.byteLength(result.raw), 'X-Futures-Source-SHA256': result.sha256 }); res.end(result.raw);
}
module.exports = { readFuturesPublication, handleFuturesRequest, MAX_FILE_BYTES, MAX_PAYLOAD_BYTES };

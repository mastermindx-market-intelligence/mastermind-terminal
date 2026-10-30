'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readFuturesPublication, handleFuturesRequest } = require('../lib/futuresPublication');
const nowMs = 1791583200000;
const source = () => ({ schema: 'hub.futures_workspace_source/v1', pair: 'ES', publishedAtMs: nowMs - 1,
  audience: 'subscriber_display', distributionEvidenceRef: 'fixture:simulated-grant', views: [] });
const envelope = s => { const payloadJson = JSON.stringify(s); return JSON.stringify({ schema: 'hub.futures_publication/v1',
  payloadJson, payloadSha256: createHash('sha256').update(payloadJson).digest('hex') }); };
async function temp(fn) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'futures-publication-test-'));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); } }
test('default source read is inert and no file or vendor is contacted', async () => {
  assert.deepEqual(await readFuturesPublication('ES'), { status: 'unavailable', reason: 'source_unavailable' });
});
test('reads a publisher-bound payload from one fixed leaf', async () => temp(async root => {
  await fs.writeFile(path.join(root, 'ES-1-1.json'), envelope(source()));
  const r = await readFuturesPublication('ES', { root, nowMs }); assert.equal(r.status, 'data');
  assert.deepEqual(JSON.parse(r.raw), source()); assert.match(r.sha256, /^[a-f0-9]{64}$/);
}));
for (const pair of ['../ES', 'ESZ6', 'NQ/../ES', 'ES?pair=NQ', '', null]) test(`rejects non-pair request ${pair}`, async () =>
  assert.deepEqual(await readFuturesPublication(pair), { status: 'unavailable', reason: 'bad_request' }));
for (const [name, change] of [
  ['wrong root', s => { s.pair = 'NQ'; }], ['future publication', s => { s.publishedAtMs = nowMs + 1; }],
  ['schema', s => { s.schema = 'other'; }],
]) test(`fails closed for ${name}`, async () => temp(async root => {
  const s = source(); change(s); await fs.writeFile(path.join(root, 'ES-1-1.json'), envelope(s));
  assert.equal((await readFuturesPublication('ES', { root, nowMs })).reason, 'source_invalid');
}));
test('internal-only data cannot pass the publisher distribution boundary', async () => temp(async root => {
  const s = source(); s.audience = 'internal_only'; await fs.writeFile(path.join(root, 'ES-1-1.json'), envelope(s));
  assert.equal((await readFuturesPublication('ES', { root, nowMs })).reason, 'source_restricted');
}));
test('modified bytes, symlinked leaves and missing files never fall back to samples', async () => temp(async root => {
  const file = path.join(root, 'ES-1-1.json'); await fs.writeFile(file, envelope(source()).replace('simulated-grant', 'altered-grant'));
  assert.equal((await readFuturesPublication('ES', { root, nowMs })).reason, 'source_invalid');
  await fs.unlink(file); await fs.symlink(path.join(root, 'outside.json'), file);
  assert.equal((await readFuturesPublication('ES', { root, nowMs })).reason, 'source_invalid');
  await fs.unlink(file); assert.equal((await readFuturesPublication('ES', { root, nowMs })).reason, 'source_unavailable');
}));
test('oversized and invalid-UTF8 publications fail before interpretation', async () => temp(async root => {
  const file = path.join(root, 'ES-1-1.json'); await fs.writeFile(file, Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.equal((await readFuturesPublication('ES', { root, nowMs })).reason, 'source_invalid');
  await fs.writeFile(file, Buffer.from([0xff, 0xff])); assert.equal((await readFuturesPublication('ES', { root, nowMs })).reason, 'source_invalid');
}));
test('HTTP route returns the exact digest-bound bytes and private no-store', async () => temp(async root => {
  await fs.writeFile(path.join(root, 'ES-1-1.json'), envelope(source()));
  const result = {}; const res = { writeHead(code, headers) { result.code = code; result.headers = headers; }, end(body) { result.body = body; } };
  await handleFuturesRequest(res, new URL('http://127.0.0.1/futures?pair=ES'), { root, nowMs });
  assert.equal(result.code, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(createHash('sha256').update(result.body).digest('hex'), result.headers['X-Futures-Source-SHA256']);
  await handleFuturesRequest(res, new URL('http://127.0.0.1/futures?pair=ES&pair=NQ'), { root, nowMs }); assert.equal(result.code, 400);
  await handleFuturesRequest(res, new URL('http://127.0.0.1/futures?pair=ES&url=http://other'), { root, nowMs }); assert.equal(result.code, 400);
}));

test('a named pipe is refused without waiting for a writer', { skip: process.platform === 'win32' }, async () => temp(async root => {
  const { execFileSync } = require('node:child_process');
  execFileSync('mkfifo', [path.join(root, 'ES-1-1.json')]);
  // A regressed blocking open is contained in this child, not the whole test runner.
  const output = execFileSync(process.execPath, ['-e',
    "require(process.argv[1]).readFuturesPublication('ES',{root:process.argv[2],nowMs:Number(process.argv[3])}).then(x=>console.log(JSON.stringify(x)))",
    require.resolve('../lib/futuresPublication'), root, String(nowMs)], { encoding: 'utf8', timeout: 3000 });
  assert.deepEqual(JSON.parse(output), { status: 'unavailable', reason: 'source_invalid' });
}));

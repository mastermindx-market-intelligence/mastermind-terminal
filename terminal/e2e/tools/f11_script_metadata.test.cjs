/* eslint-disable @typescript-eslint/no-require-imports -- Pure Node metadata controls. */
'use strict';

/*
 * Synthetic, offline controls for the F11 script metadata projector.
 * node:test only; no network, filesystem, browser, or process side effects.
 * Every fixture below is a locally constructed buffer or string.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');

const { scriptMetadata, ScriptMetadataError } = require('./f11_script_metadata.cjs');

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const PATH_CODE = 'F11_SCRIPT_METADATA_PATH';
const BODY_CODE = 'F11_SCRIPT_METADATA_BODY';
const BODY_SIZE_CODE = 'F11_SCRIPT_METADATA_BODY_SIZE';
const TIME_CODE = 'F11_SCRIPT_METADATA_TIME';
const INPUT_CODE = 'F11_SCRIPT_METADATA_INPUT';
const MIME_WHITELIST = [
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/octet-stream',
  'text/html',
  'text/plain',
];
const PROJECTED_KEYS = [
  'pathname',
  'bytes',
  'sha256',
  'mime',
  'fetchMs',
  'bodyMs',
  'fulfillMs',
];

const BASE = () => ({
  pathname: '/_next/static/chunks/main.9f4a1b.js',
  contentType: 'application/javascript; charset=utf-8',
  body: Buffer.from('hello'),
  fetchMs: 3,
  bodyMs: 5,
  fulfillMs: 7,
});

const ok = (overrides) => scriptMetadata({ ...BASE(), ...overrides });

function throws(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ScriptMetadataError, 'throws ScriptMetadataError');
    assert.equal(err.code, code);
    assert.ok(err.message.startsWith(code), 'message is prefixed by the fixed code');
    return true;
  });
}

test('projects exact sha256, byte count, mime, and durations for a known buffer', () => {
  const m = ok();
  assert.deepEqual(m, {
    pathname: '/_next/static/chunks/main.9f4a1b.js',
    bytes: 5,
    sha256: HELLO_SHA,
    mime: 'application/javascript',
    fetchMs: 3,
    bodyMs: 5,
    fulfillMs: 7,
  });
  assert.deepEqual(Object.keys(m), PROJECTED_KEYS);
});

test('empty body is a valid observable with zero bytes and the empty digest', () => {
  const m = ok({ body: Buffer.alloc(0) });
  assert.equal(m.bytes, 0);
  assert.equal(m.sha256, EMPTY_SHA);
});

test('binary buffer keeps its exact byte count and digest without interpretation', () => {
  const body = Buffer.from([0x00, 0x01, 0x02, 0xfa, 0xff, 0x0a, 0x0d, 0xe2, 0x28, 0xa1]);
  const m = ok({ body });
  assert.equal(m.bytes, body.length);
  assert.equal(m.sha256, nodeCrypto.createHash('sha256').update(body).digest('hex'));
  assert.ok(!('body' in m) && !('contentType' in m) && !('header' in m));
});

test('mime whitelist maps exact tokens and normalizes case, spaces, parameters', () => {
  for (const token of MIME_WHITELIST) {
    assert.equal(ok({ contentType: token }).mime, token);
    assert.equal(ok({ contentType: token.toUpperCase() }).mime, token);
    assert.equal(ok({ contentType: token + '; charset=UTF-8' }).mime, token);
    assert.equal(ok({ contentType: '  ' + token + '  ' }).mime, token);
  }
});

test('hostile free-form content types sanitize to other and never echo input', () => {
  const hostile = [
    'application/javascript\r\nSet-Cookie: x=1',
    'application/javascript\nX-Evil: y',
    'image/png',
    'application/x-javascript',
    'text/jsx',
    '',
    '   ',
    ';',
    'text/plain\x00',
    'application/javascript\x00',
    'APPLICATION/JAVASCRIPT-PARTIAL',
    'image/png; charset=utf-8;base64',
    '../application/javascript',
    'application/javascript\rX-Evil: y',
  ];
  for (const value of hostile) {
    const m = ok({ contentType: value });
    assert.equal(m.mime, 'other', JSON.stringify(value));
  }
  // Text after the first ";" and trailing HTTP whitespace are not hostile:
  // the token survives parameter stripping and trimming.
  assert.equal(
    ok({ contentType: 'application/javascript;charset=utf-8;base64' }).mime,
    'application/javascript',
  );
  assert.equal(ok({ contentType: 'application/javascript\r' }).mime, 'application/javascript');
  assert.equal(ok({ contentType: 'application/javascript \t' }).mime, 'application/javascript');
  assert.equal(ok({ contentType: 'application/javascript\r\nX: y' }).mime, 'other');

  for (const value of [42, 0, true, false, {}, [], () => {}, Symbol('x'), 10n]) {
    assert.equal(ok({ contentType: value }).mime, 'other');
  }
});

test('absent content type projects missing', () => {
  const m = ok({ contentType: undefined });
  assert.equal(m.mime, 'missing');
  const bare = scriptMetadata({
    pathname: '/_next/static/a.js',
    body: Buffer.alloc(1, 7),
    fetchMs: 0,
    bodyMs: 0,
    fulfillMs: 0,
  });
  assert.equal(bare.mime, 'missing');
  assert.equal(ok({ contentType: null }).mime, 'missing');
});

test('unknown caller fields are never projected and input is never mutated', () => {
  const input = BASE();
  input.header = { 'set-cookie': 'a=b' };
  input.extra = 'unknown';
  input.url = 'https://evil.test/_next/static/a.js';
  input.internal = { note: 'secret' };
  const snapshot = Buffer.from(input.body);
  const m = scriptMetadata(input);
  assert.deepEqual(Object.keys(m), PROJECTED_KEYS);
  assert.equal(input.extra, 'unknown');
  assert.deepEqual(input.header, { 'set-cookie': 'a=b' });
  assert.deepEqual(input.body, snapshot);
  assert.ok(!('header' in m) && !('extra' in m) && !('url' in m) && !('internal' in m));
});

test('pure: repeated calls are deterministic fresh objects', () => {
  const a = ok();
  const b = ok();
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  assert.notEqual(a.sha256, b.body);
});

test('public pathnames including encoded brackets and parens are accepted', () => {
  const good = [
    '/_next/static/a.js',
    '/_next/static/chunks/main.9f4a1b.js',
    '/_next/static/chunks/%5Bslug%5D/page.abc123.js',
    '/_next/static/chunks/%5bslug%5d/app.def456.js',
    '/_next/static/chunks/%5B...slug%5D/catchall.aaa.js',
    '/_next/static/(group)/route.111222.js',
    '/_next/static/a_b-c.d.e.js',
    '/_next/static/media/%5Bid%5D/logo.999.js',
  ];
  for (const pathname of good) {
    const m = ok({ pathname });
    assert.equal(m.pathname, pathname, pathname);
  }
});

test('non-public pathnames: origins, queries, fragments, case, prefix', () => {
  const bad = [
    '',
    'not-a-path',
    '/_next/dynamic/a.js',
    '/_next/staticx/a.js',
    '/_NEXT/static/a.js',
    '/_next/static/',
    '/_next/static//a.js',
    '/_next/static/a.js/',
    '/_next/static/chunks//x.js',
    '/_next/static/a.js?x=1',
    '/_next/static/a.js#frag',
    '/_next/static/a.js?%2f',
    'https://evil.test/_next/static/a.js',
    'http://x/_next/static/a.js',
    '//evil.test/_next/static/a.js',
    '/_next/static/a.js:',
    '/_next/static/a.js+x',
    '/_next/static/a b.js',
    '/_next/static/a\tb.js',
    '/_next/static/a\nb.js',
    '/_next/static/a\x01b.js',
    '/_next/static/a\\b.js',
    '/_next/static\\evil.js',
    '/_next/static/naivé.js',
    '/_next/static/éè.js',
    '/_next/static/中文.js',
    42,
    null,
    undefined,
    true,
    {},
    ['/​_next/static/a.js'],
    Buffer.from('/_next/static/a.js'),
  ];
  for (const value of bad) {
    throws(() => ok({ pathname: value }), PATH_CODE);
  }
});

test('traversal and encoded-separator ambiguity is rejected, raw and encoded', () => {
  const bad = [
    '/_next/static/../secret.js',
    '/_next/static/chunks/../../../../etc/passwd',
    '/_next/static/./a.js',
    '/_next/static/chunks/./x.js',
    '/_next/static/..',
    '/_next/static/.',
    '/_next/static/%2e%2e/secret.js',
    '/_next/static/%2E%2E/secret.js',
    '/_next/static/%2fetc/passwd.js',
    '/_next/static/%2Fetc.js',
    '/_next/static/chunks%2fx.js',
    '/_next/static/%5cevil.js',
    '/_next/static/%5Cevil.js',
    '/_next/static/..%5c..%5cwin.js',
    '/_next/static/%252e%252e%252fsecret.js',
    '/_next/static/a%00.js',
    '/_next/static/a%0a.js',
    '/_next/static/a%0d.js',
    '/_next/static/a%09.js',
    '/_next/static/a%20b.js',
    '/_next/static/a%2b.js',
    '/_next/static/a%3f.js',
    '/_next/static/a%23.js',
    '/_next/static/a%zz.js',
    '/_next/static/a%.js',
    '/_next/static/a%G1.js',
    '/_next/static/%',
  ];
  for (const pathname of bad) {
    throws(() => ok({ pathname }), PATH_CODE);
  }
});

test('pathname length bound is 240 characters', () => {
  const prefix = '/_next/static/';
  const at240 = prefix + 'a'.repeat(240 - prefix.length);
  assert.equal(at240.length, 240);
  assert.equal(ok({ pathname: at240 }).pathname, at240);
  const at241 = prefix + 'a'.repeat(240 - prefix.length + 1);
  throws(() => ok({ pathname: at241 }), PATH_CODE);
});

test('body must be a Buffer; other typed bodies are rejected', () => {
  const bad = [
    'hello',
    '',
    null,
    undefined,
    0,
    true,
    {},
    [],
    new Uint8Array([1, 2, 3]),
    new ArrayBuffer(8),
    { length: 3 },
    Buffer,
  ];
  for (const value of bad) {
    throws(() => ok({ body: value }), BODY_CODE);
  }
  const converted = Buffer.from(new Uint8Array([1, 2, 3]));
  assert.equal(ok({ body: converted }).bytes, 3);
  const view = Buffer.from('abcdefgh').subarray(2, 5);
  assert.equal(ok({ body: view }).bytes, 3);
  assert.equal(ok({ body: view }).sha256, nodeCrypto.createHash('sha256').update(view).digest('hex'));
});

test('body size bound is 32 MiB inclusive', () => {
  const atLimit = Buffer.alloc(32 * 1024 * 1024, 0x41);
  const m = ok({ body: atLimit });
  assert.equal(m.bytes, 33554432);
  assert.equal(m.sha256, nodeCrypto.createHash('sha256').update(atLimit).digest('hex'));
  const over = Buffer.alloc(32 * 1024 * 1024 + 1, 0x41);
  throws(() => ok({ body: over }), BODY_SIZE_CODE);
});

test('each duration is independently typed and bounded to [0, 600000]', () => {
  const fields = ['fetchMs', 'bodyMs', 'fulfillMs'];
  const badValues = [
    -1,
    -0.0001,
    NaN,
    Infinity,
    -Infinity,
    600000.5,
    600001,
    1e21,
    Number.MAX_VALUE,
    '5',
    '',
    null,
    undefined,
    true,
    false,
    {},
    [],
    () => {},
    10n,
  ];
  for (const field of fields) {
    for (const value of badValues) {
      const overrides = {};
      overrides[field] = value;
      throws(() => ok(overrides), TIME_CODE);
    }
  }
  for (const field of fields) {
    for (const value of [0, 1.5, 599999.999, 600000]) {
      const overrides = {};
      overrides[field] = value;
      const m = ok(overrides);
      assert.equal(m[field], value);
    }
  }
});

test('a valid sibling duration does not rescue an invalid one', () => {
  const good = { fetchMs: 600000, bodyMs: 0, fulfillMs: 42 };
  const m = ok(good);
  assert.equal(m.fetchMs, 600000);
  assert.equal(m.bodyMs, 0);
  throws(() => ok({ ...good, bodyMs: -2 }), TIME_CODE);
  throws(() => ok({ ...good, fulfillMs: '42' }), TIME_CODE);
  throws(() => ok({ ...good, fetchMs: NaN }), TIME_CODE);
});

test('input must be one plain object of named fields', () => {
  const bad = [null, undefined, 42, 'x', true, [], () => {}, Symbol('x')];
  for (const value of bad) {
    throws(() => scriptMetadata(value), INPUT_CODE);
  }
});

test('byte-0 observable record carries no boot or success signal', () => {
  const m = ok({ body: Buffer.from('eval("x")') });
  assert.deepEqual(Object.keys(m), PROJECTED_KEYS);
  for (const key of ['ok', 'status', 'boot', 'booted', 'valid', 'ready']) {
    assert.ok(!(key in m), 'no ' + key + ' field');
  }
  assert.equal(m.bytes, 9);
});

test('parent: residual nested percent traversal refuses; normal encoded brackets remain valid', () => {
  const base = { body: Buffer.from('x'), fetchMs: 0, bodyMs: 0, fulfillMs: 0 };
  for (const pathname of ['/_next/static/%252e%252e/chunk.js','/_next/static/%25252e%25252e/chunk.js']) {
    assert.throws(() => scriptMetadata({...base,pathname}), {code:'F11_SCRIPT_METADATA_PATH'});
  }
  assert.equal(scriptMetadata({...base,pathname:'/_next/static/chunks/%5Broute%5D.js'}).bytes,1);
});

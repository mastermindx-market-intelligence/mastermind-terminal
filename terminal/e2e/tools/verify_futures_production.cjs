'use strict';
/** Verify an already-built, already-running LOCAL production server. Never deploys or starts a feed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const base = 'http://127.0.0.1:3597';
const evidence = process.env.FUTURES_PRODUCTION_EVIDENCE_DIR
  ? path.resolve(process.env.FUTURES_PRODUCTION_EVIDENCE_DIR)
  : path.resolve(root, '../docs/evidence/futures-production-build-20261013');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  assert.ok(fs.existsSync(path.join(root, '.next/BUILD_ID')), 'run the normal production build first');
  const traces = [];
  function collect(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) collect(file);
      else if (file.endsWith('.nft.json')) traces.push(file);
    }
  }
  collect(path.join(root, '.next/server'));
  const privateFiles = traces.flatMap(file => (JSON.parse(fs.readFileSync(file, 'utf8')).files || [])
    .filter(name => name.includes('.local-futures')).map(name => ({ trace: path.relative(root, file), name })));
  assert.deepEqual(privateFiles, [], 'private historical samples must not enter production traces');
  const paths = ['/api/futures?pair=ES', '/api/futures?pair=NQ&FLOW_FIXTURE=1',
    '/dev/futures', '/dev/futures-sample', '/.local-futures/browser-canary.json'];
  const http = [];
  for (const pathname of paths) {
    const response = await fetch(base + pathname, { redirect: 'manual', signal: AbortSignal.timeout(12000) });
    const body = await response.text();
    const expected = pathname.startsWith('/api/') ? 403 : 404;
    assert.equal(response.status, expected, pathname);
    if (expected === 403) {
      assert.deepEqual(JSON.parse(body), { error: 'access_required' });
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    assert.ok(!body.includes('"framesByCutoff"') && !body.includes('"sourceRawSha256"'), 'private data absent');
    http.push({ path: pathname, status: response.status, cacheControl: response.headers.get('cache-control'), bodySha256: hash(body) });
  }
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const checks = [], images = [];
  try {
    for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage(); const errors = [], futuresRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (new URL(request.url()).pathname === '/api/futures') futuresRequests.push(request.url()); });
      const response = await page.goto(base + '/options/futures', { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200, 'guest gets the existing paywall, not data');
      await page.getByRole('heading', { name: 'Unlock the Options desk', exact: true }).waitFor();
      assert.equal(await page.getByTestId('futures-workspace').count(), 0);
      assert.equal(await page.getByTestId('futures-chart').count(), 0);
      assert.equal(await page.getByTestId('mapped-level').count(), 0);
      assert.equal(futuresRequests.length, 0, 'denied page must not mount its data consumer');
      assert.deepEqual(errors, [], 'fresh production-page browser errors');
      const image = path.join(evidence, `${name}-production-guest.png`);
      await page.screenshot({ path: image, fullPage: true });
      images.push({ name: path.basename(image), sha256: hash(fs.readFileSync(image)) });
      checks.push({ viewport: [width, height], paywall: true, futuresComponentAbsent: true, upstreamClientRequests: 0, pageErrors: 0 });
      await context.close();
    }
  } finally { await browser.close(); }
  const receipt = { schema: 'futures.local_production_build_qualification/v1', generatedAt: new Date().toISOString(),
    sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    terminalTree: execFileSync('git', ['rev-parse', 'HEAD:terminal'], { cwd: root, encoding: 'utf8' }).trim(),
    authScope: 'no authenticated session; loopback public client settings only; no fake user grant, FLOW_FIXTURE or E2E bypass',
    productionMode: true, scope: 'compiled Next build on loopback; NOT deployed service or paid live-market qualification',
    buildIdSha256: hash(fs.readFileSync(path.join(root, '.next/BUILD_ID'))), traceFiles: traces.length,
    privateSampleTraceFiles: privateFiles.length, http, browser: checks, images,
    liveDataActivated: false, subscriberGrantEstablished: false, deployed: false };
  fs.writeFileSync(path.join(evidence, 'production-guard-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

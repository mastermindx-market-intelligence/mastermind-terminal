'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { buildFuturesWorkspacePublication } = require('../lib/futuresWorkspaceProjection');
const { fixture, BASE, ns } = require('./fixtures/futuresCapture');
test('actual source adapter output composes into a bounded internal publication with conserved executions', () => {
  const { capture, selection } = fixture(); const before = structuredClone(capture);
  const out = buildFuturesWorkspacePublication(capture, selection); assert.equal(out.status, 'ok');
  assert.equal(out.leaf, 'ES-1-1.json'); assert.equal(out.source.audience, 'internal_only');
  assert.equal(out.source.views[1].frames.reduce((n, f) => n + f.bar.total, 0), 20);
  assert.equal(out.source.views[1].tradeCoverage, 'partial'); assert.equal(out.source.views[1].frames[1].bar.cvd, null);
  assert.equal(out.envelope.payloadSha256, createHash('sha256').update(out.envelope.payloadJson).digest('hex'));
  assert.deepEqual(capture, before);
});
for (const pair of ['ES', 'NQ']) for (const intervalMinutes of [1, 5]) for (const priceStepTicks of [1, 4, 8])
  test(`variant ${pair}/${intervalMinutes}/${priceStepTicks} conserves all trade volume`, () => {
    const { capture, selection } = fixture(pair); Object.assign(selection, { intervalMinutes, priceStepTicks });
    const out = buildFuturesWorkspacePublication(capture, selection); assert.equal(out.status, 'ok');
    assert.equal(out.leaf, `${pair}-${intervalMinutes}-${priceStepTicks}.json`);
    assert.equal(out.source.views.at(-1).frames.reduce((n, f) => n + f.bar.total, 0), 20);
  });
test('gamma attachments deduplicate by content without sharing mutable caller objects', () => {
  const { capture, selection } = fixture(); const value = { cashSession: 'open', input: { fixture: true } };
  capture.gammaByEndMs = { [BASE + 60000]: value, [BASE + 120000]: value };
  const out = buildFuturesWorkspacePublication(capture, selection); assert.equal(out.status, 'ok');
  assert.equal(Object.keys(out.source.gammaAttachments).length, 1); value.input.fixture = false;
  assert.equal(Object.values(out.source.gammaAttachments)[0].input.fixture, true);
});
test('distribution is never promoted without the incumbent decision reference', () => {
  const { capture, selection } = fixture(); capture.distribution = { audience: 'subscriber_display' };
  assert.equal(buildFuturesWorkspacePublication(capture, selection).reason, 'missing_distribution_decision');
  capture.distribution.evidenceRef = 'fixture:simulated-source-grant-not-a-real-license';
  assert.equal(buildFuturesWorkspacePublication(capture, selection).source.audience, 'subscriber_display');
});
for (const [name, alter] of [
  ['unknown trade coverage', c => { delete c.tradeCoverage; }],
  ['invented live retrospectivity', c => { c.publication.basis = 'realtime'; c.availabilityBasis = 'vendor_capture_retrospective'; }],
  ['undefined contract reference', c => { c.binding.definitionId = ''; }],
  ['future definition knowledge', c => { c.binding.definitionAvailableAtNs = ns(1); }],
  ['expired contract', c => { c.binding.validUntilNs = ns(1000); }],
  ['reversed publication', c => { c.publication.publishedAtMs = BASE; }],
  ['unbounded freshness', c => { c.publication.freshUntilMs += 86400000; }],
]) test(`refuses ${name}`, () => {
  const { capture, selection } = fixture(); alter(capture); assert.equal(buildFuturesWorkspacePublication(capture, selection).status, 'unavailable');
});
for (const [name, alter] of [
  ['unbounded cutoffs', s => { s.cutoffsMs = Array.from({ length: 33 }, (_, i) => BASE + i); }],
  ['duplicate cutoff', s => { s.cutoffsMs = [BASE + 60000, BASE + 60000]; }],
  ['future cutoff', s => { s.cutoffsMs = [BASE + 180000]; }],
  ['invalid row grouping', s => { s.priceStepTicks = 3; }],
  ['unbounded price range', s => { s.highTick += 10000; }],
]) test(`refuses ${name}`, () => {
  const { capture, selection } = fixture(); alter(selection); assert.equal(buildFuturesWorkspacePublication(capture, selection).status, 'unavailable');
});

// IM10 parent regression assertions, adopted from parent-r1 parent_coherence.test.mts (sha256 02f3bf65…e84e1); only the runner import (node:test -> vitest) and the module path changed.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createPolicyPreviewSession, updatePolicyDraft, updatePolicyBinding,
  beginPolicyPreview, receivePolicyPreview, reviewPolicyDraft,
} from '../intlPolicyPreviewSession';
import type { PreviewBinding, PolicySettings, PreviewTicket, QualifiedPreview, UnavailablePreview } from '../intlPolicyPreviewSession';

const binding: PreviewBinding = {
  principal_partition: 'owner', auth_epoch: 'auth-1', saved_id: 'same-record', saved_revision: 3,
  source_generation: 'source-1', instrument_mapping_identity: 'mapping-1', qualification_identity: 'qualification-1',
};
const settings: PolicySettings = {
  economy_a: 'JP', economy_b: 'US', lens: 'nominal_policy_point_gap', definition: 'absolute_gap_change_bp',
  method_version: 'nominal-point-v1', period: { mode: 'fixed_dates', start: '2026-08-31', end: '2026-09-30' },
  instrument_a_ref: 'jp-owner-point', instrument_b_ref: 'us-owner-point', revision_policy: 'latest_vintage',
};
const draft = () => updatePolicyDraft(createPolicyPreviewSession(binding), { ok: true, settings });
const result = (ticket: PreviewTicket): QualifiedPreview => ({
  state: 'qualified', identity: { binding: structuredClone(ticket.binding), settings: structuredClone(ticket.settings) },
  signed_start_bp: -300, signed_end_bp: -250, signed_change_bp: 50, absolute_change_bp: -50,
  direction: 'narrowed', crosses_zero: false,
});

test('unavailable reply remains caller-owned and independently mutable', () => {
  const request = beginPolicyPreview(draft());
  assert.ok(request.ticket);
  const reply: UnavailablePreview = {
    state: 'unavailable', identity: result(request.ticket).identity,
    reasons: ['missing_observation'], missing_refs: ['a_start'],
  };
  const next = receivePolicyPreview(request.state, request.ticket, reply);
  assert.equal(next.preview?.state, 'unavailable');
  assert.equal(Object.isFrozen(reply.reasons), false, 'must not freeze caller reasons');
  assert.equal(Object.isFrozen(reply.missing_refs), false, 'must not freeze caller slots');
  (reply.reasons as string[]).push('later-owner-event');
  (reply.missing_refs as string[]).push('b_end');
  reply.identity.settings.economy_b = 'AU';
  assert.ok(next.preview?.state === 'unavailable');
  assert.deepEqual(next.preview.reasons, ['missing_observation']);
  assert.deepEqual(next.preview.missing_refs, ['a_start']);
  assert.equal(next.preview.identity.settings.economy_b, 'US');
  assert.notEqual(next.preview.reasons, reply.reasons);
  assert.notEqual(next.preview.missing_refs, reply.missing_refs);
});

test('both valid and invalid begin return immutable envelopes', () => {
  for (const state of [draft(), createPolicyPreviewSession(binding)]) {
    const output = beginPolicyPreview(state);
    assert.ok(Object.isFrozen(output), 'returned envelope must be immutable');
    assert.ok(Object.isFrozen(output.state));
    if (output.ticket) {
      assert.ok(Object.isFrozen(output.ticket));
      assert.ok(Object.isFrozen(output.ticket.settings.period));
    }
  }
});

test('same-principal reauthentication rejects old response even after restoring identical draft', () => {
  const old = beginPolicyPreview(draft());
  assert.ok(old.ticket);
  const signedOut = updatePolicyBinding(old.state, { ...binding, principal_partition: null, auth_epoch: 'auth-2' });
  const signedIn = updatePolicyBinding(signedOut, { ...binding, auth_epoch: 'auth-3' });
  const latest = beginPolicyPreview(updatePolicyDraft(signedIn, { ok: true, settings }));
  assert.ok(latest.ticket);
  const ignored = receivePolicyPreview(latest.state, old.ticket, result(old.ticket));
  assert.equal(ignored, latest.state);
  assert.equal(ignored.pending, latest.ticket);
  assert.equal(ignored.preview, null);
  assert.equal(receivePolicyPreview(ignored, latest.ticket, result(latest.ticket)).preview?.state, 'qualified');
});

test('saved revision dominates simultaneous generation change and clears earlier review', () => {
  const reviewed = reviewPolicyDraft(draft());
  const sourceOnly = updatePolicyBinding(reviewed, { ...binding, source_generation: 'source-2' });
  assert.equal(sourceOnly.review, reviewed.review);
  const changed = updatePolicyBinding(sourceOnly, { ...binding, saved_revision: 4, source_generation: 'source-3' });
  assert.equal(changed.review, null);
  assert.deepEqual(changed.validation, reviewed.validation);
  assert.equal(changed.pending, null);
  assert.equal(changed.preview, null);
  assert.ok(changed.sequence > sourceOnly.sequence);
});

test('numeric and error payload extras cannot reach state or settings-only review', () => {
  for (const kind of ['qualified', 'unavailable'] as const) {
    const request = beginPolicyPreview(reviewPolicyDraft(draft()));
    assert.ok(request.ticket);
    const reply = kind === 'qualified' ? result(request.ticket) : {
      state: 'unavailable' as const, identity: result(request.ticket).identity,
      reasons: ['missing_observation'], missing_refs: ['a_start'] as const,
    };
    const contaminated = { ...reply, provider_body: 'PRIVATE_SENTINEL' };
    const next = receivePolicyPreview(request.state, request.ticket, contaminated);
    assert.ok(next.preview?.state === 'unavailable');
    assert.deepEqual(next.preview.reasons, ['invalid_preview_response']);
    assert.equal(JSON.stringify(next).includes('PRIVATE_SENTINEL'), false);
    assert.equal(JSON.stringify(next.review).includes('signed_start_bp'), false);
    assert.deepEqual(Object.keys(next.review!).sort(), ['binding', 'settings']);
    assert.equal(next.review!.binding.saved_id, 'same-record');
    assert.equal(next.review!.settings.period.mode, 'fixed_dates');
  }
});

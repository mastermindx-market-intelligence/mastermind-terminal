// intlPolicyPreviewSession.test.mts — behavioral acceptance tests (IM10-T3).
// Adopted from IM10 parent-r1 intlPolicyPreviewSession.test.mts (sha256 b0a40653…b948707); only the runner import (node:test -> vitest) and the module path changed.
// Aliases: same = deepEqual, is = strictEqual (node:assert/strict).
import { test } from 'vitest';
import { deepEqual as same, ok, strictEqual as is, throws } from 'node:assert/strict';
import {
  createPolicyPreviewSession, updatePolicyDraft, updatePolicyBinding,
  beginPolicyPreview, receivePolicyPreview, reviewPolicyDraft,
  PolicyPreviewSequenceOverflow,
} from '../intlPolicyPreviewSession';
import type {
  PolicyPreviewResult, PolicyPreviewSessionState, PolicySettings,
  PolicyValidation, PreviewBinding, PreviewTicket,
} from '../intlPolicyPreviewSession';

type Rec = Record<string, unknown>;
const c = <T,>(v: T): T => structuredClone(v);
const BINDING: PreviewBinding = {
  principal_partition: 'pp-1', auth_epoch: 'epoch-1', saved_id: 'saved-1', saved_revision: 4,
  source_generation: 'gen-1', instrument_mapping_identity: 'map-1', qualification_identity: 'qual-1',
};
const SETTINGS: PolicySettings = {
  economy_a: 'DE', economy_b: 'FR', lens: 'nominal_policy_point_gap',
  definition: 'absolute_gap_change_bp', method_version: 'mv-7',
  period: { mode: 'fixed_dates', start: '2026-01-31', end: '2026-02-28' },
  instrument_a_ref: 'ins-a', instrument_b_ref: 'ins-b', revision_policy: 'latest_vintage',
};
const OK: PolicyValidation = { ok: true, settings: c(SETTINGS) };
const INVALID: PolicyValidation = {
  ok: false, errors: [
    { field: 'economy_b', code: 'missing_comparator' },
    { field: 'economies', code: 'same_economy' },
    { field: 'period', code: 'date_order' },
  ],
};
const noPair: PolicyValidation = { ok: false, errors: [] };
const RB = { principal_partition: 'pp-1', auth_epoch: 'epoch-1', saved_id: 'saved-1', saved_revision: 4 };
const valSettings = (s: PolicyPreviewSessionState): PolicySettings =>
  (s.validation as { settings: PolicySettings }).settings;
const draft = (v: PolicyValidation): PolicyPreviewSessionState =>
  updatePolicyDraft(createPolicyPreviewSession(c(BINDING)), v);
const qReply = (t: PreviewTicket, over: Rec = {}): PolicyPreviewResult =>
  ({ state: 'qualified', identity: { binding: c(t.binding), settings: c(t.settings) },
    signed_start_bp: 12.5, signed_end_bp: -3.25, signed_change_bp: -15.75,
    absolute_change_bp: 15.75, direction: 'widened', crosses_zero: true, ...over }) as PolicyPreviewResult;
const uReply = (t: PreviewTicket, reasons: string[], missing: string[]): PolicyPreviewResult =>
  ({ state: 'unavailable', identity: { binding: c(t.binding), settings: c(t.settings) },
    reasons, missing_refs: missing }) as PolicyPreviewResult;
const start = (): { s: PolicyPreviewSessionState; t: PreviewTicket } => {
  const r = beginPolicyPreview(draft(OK));
  return { s: r.state, t: r.ticket! };
};
const cleared = (s: PolicyPreviewSessionState) => {
  is(s.pending, null); is(s.preview, null); is(s.review, null);
};

test('initial + invalid: no synthetic pair, no ticket, no review', () => {
  const s0 = createPolicyPreviewSession(c(BINDING));
  same(s0.validation, noPair);
  cleared(s0);
  const b0 = beginPolicyPreview(s0);
  is(b0.ticket, null); is(b0.state, s0);
  is(reviewPolicyDraft(s0).review, null);
  const s = draft(INVALID); // owner errors persist exactly, still no ticket/review
  same(s.validation, INVALID);
  is(s.preview, null); is(s.review, null);
  is(beginPolicyPreview(s).ticket, null);
  is(reviewPolicyDraft(s).review, null);
});

test('valid settings adopted detached; day precision without Date', () => {
  const original = c(SETTINGS); const ownerBinding = c(BINDING);
  const s = updatePolicyDraft(createPolicyPreviewSession(ownerBinding), { ok: true, settings: original });
  original.economy_b = 'XX';
  original.period = { mode: 'owner_horizon', key: 'h' } as PolicySettings['period'];
  original.instrument_a_ref = null;
  ownerBinding.auth_epoch = 'epoch-x';
  same(valSettings(s), SETTINGS);
  is(s.binding.auth_epoch, 'epoch-1');
  const roll: PolicySettings = { ...c(SETTINGS), period: { mode: 'owner_horizon', key: 'rolling-3y' }, revision_policy: 'original_known' };
  same(valSettings(draft({ ok: true, settings: roll })), roll);
});

test('edit after qualified clears; A->B->A rejects old ticket', () => {
  let s = draft(OK);
  const r1 = beginPolicyPreview(s); s = r1.state;
  s = receivePolicyPreview(s, r1.ticket!, qReply(r1.ticket!));
  is(s.preview?.state, 'qualified');
  s = reviewPolicyDraft(s); ok(s.review);
  const edited = updatePolicyDraft(s, c(OK)); // same visible settings: still no ABA
  cleared(edited);
  is(receivePolicyPreview(edited, r1.ticket!, qReply(r1.ticket!)), edited);
  let s2 = draft(OK);
  const a1 = beginPolicyPreview(s2); s2 = a1.state;
  s2 = updatePolicyDraft(s2, { ok: true, settings: { ...c(SETTINGS), economy_b: 'IT' } });
  s2 = updatePolicyDraft(s2, c(OK)); // back to A
  is(receivePolicyPreview(s2, a1.ticket!, qReply(a1.ticket!)), s2);
});

test('out-of-order, duplicate and wrong-identity replies never install', () => {
  const { s, t } = start();
  const r2 = beginPolicyPreview(s);
  const s2 = r2.state; const t2 = r2.ticket!;
  is(receivePolicyPreview(s2, t, qReply(t)), s2); // stale request ignored, pending kept
  const done = receivePolicyPreview(s2, t2, qReply(t2));
  is(done.pending, null);
  is(done.preview?.state, 'qualified');
  is(receivePolicyPreview(done, t2, qReply(t2)), done); // duplicate no-op
  // Every identity field (settings 's' / binding 'b') is discriminating.
  const idMuts: Array<['s' | 'b', string, unknown]> = [
    ['s', 'economy_b', 'IT'], ['s', 'lens', 'real_gap'],
    ['s', 'definition', 'x'], ['s', 'method_version', 'mv-8'],
    ['s', 'period', { mode: 'owner_horizon', key: 'h' }],
    ['s', 'period', { mode: 'fixed_dates', start: '2026-01-31', end: '2026-03-31' }],
    ['s', 'instrument_a_ref', 'ins-b'], ['s', 'instrument_b_ref', null],
    ['s', 'revision_policy', 'original_known'],
    ['b', 'saved_revision', 5], ['b', 'saved_id', 'saved-2'], ['b', 'source_generation', null],
    ['b', 'instrument_mapping_identity', 'map-2'], ['b', 'qualification_identity', 'qual-2'],
    ['b', 'principal_partition', 'pp-2'], ['b', 'auth_epoch', 'epoch-2'],
  ];
  const { s: ps, t: pt } = start();
  idMuts.forEach(([w, k, v], i) => {
    const r = qReply(pt);
    (r.identity[w === 's' ? 'settings' : 'binding'] as Rec)[k] = v;
    is(receivePolicyPreview(ps, pt, r), ps, `field ${i}`);
  });
  const del = qReply(pt); // deep structural damage
  delete (del.identity as Rec).settings;
  is(receivePolicyPreview(ps, pt, del), ps);
  const swap = qReply(pt); // both ordered instrument refs swapped
  const sp = swap.identity.settings as Rec;
  const a = sp.instrument_a_ref; sp.instrument_a_ref = sp.instrument_b_ref; sp.instrument_b_ref = a;
  is(receivePolicyPreview(ps, pt, swap), ps);
  is(ps.pending, pt);
});

test('binding lifecycle transitions', () => {
  const s0 = reviewPolicyDraft(draft(OK));
  is(updatePolicyBinding(s0, c(BINDING)), s0); // unchanged: same state
  const out = updatePolicyBinding(s0, { ...c(BINDING), auth_epoch: 'epoch-2' }); // sign-out
  same(out.validation, noPair);
  cleared(out);
  const back = updatePolicyBinding(out, { ...c(BINDING), auth_epoch: 'epoch-3' }); // sign-in again
  same(back.validation, noPair); is(back.preview, null); is(back.review, null);
  same(updatePolicyBinding(s0, { ...c(BINDING), saved_id: 'saved-2' }).validation, noPair);
  const { s, t } = start();
  const s3 = reviewPolicyDraft(receivePolicyPreview(s, t, qReply(t)));
  const rev = updatePolicyBinding(s3, { ...c(BINDING), saved_revision: 5 }); // CAS advance
  same(rev.validation, OK); // draft retained...
  cleared(rev);
  ok(rev.sequence > s3.sequence);
  const r4 = beginPolicyPreview(draft(OK));
  const rev4 = reviewPolicyDraft(receivePolicyPreview(r4.state, r4.ticket!, qReply(r4.ticket!)));
  const gen = updatePolicyBinding(beginPolicyPreview(rev4).state, { ...c(BINDING), source_generation: 'gen-2' });
  is(gen.pending, null); is(gen.preview, null); // ...but the review survives
  same(gen.validation, OK);
  same(gen.review, rev4.review);
  const qual = updatePolicyBinding(gen, { ...c(BINDING), source_generation: 'gen-2', qualification_identity: null });
  same(qual.review, rev4.review);
});

test('unavailable keeps exact slots/reasons', () => {
  let s = draft(OK);
  const r = beginPolicyPreview(s); s = r.state;
  s = reviewPolicyDraft(s);
  const after = receivePolicyPreview(s, r.ticket!, uReply(r.ticket!, ['missing_observation'], ['a_start', 'b_end']));
  same(after.preview, {
    state: 'unavailable', identity: { binding: r.ticket!.binding, settings: r.ticket!.settings },
    reasons: ['missing_observation'], missing_refs: ['a_start', 'b_end'],
  });
  same(after.validation, OK); // draft kept
});

test('malformed/nonfinite replies -> fixed unavailable, nothing leaks', () => {
  const bads: Array<(t: PreviewTicket) => PolicyPreviewResult> = [
    (t) => qReply(t, { signed_end_bp: Number.NaN }),
    (t) => qReply(t, { signed_change_bp: Number.POSITIVE_INFINITY }),
    (t) => qReply(t, { direction: 'flat' }),
    (t) => qReply(t, { crosses_zero: 'yes' }),
    (t) => { const r = qReply(t) as Rec; delete r.absolute_change_bp; return r as PolicyPreviewResult; },
    (t) => ({ state: 'pending', identity: { binding: c(t.binding), settings: c(t.settings) } }) as unknown as PolicyPreviewResult,
    (t) => uReply(t, ['x'], ['zz_start']),
  ];
  for (const mk of bads) {
    const { s, t } = start();
    const after = receivePolicyPreview(s, t, mk(t));
    const p = after.preview;
    ok(p?.state === 'unavailable');
    is(after.preview?.state, 'unavailable');
    same(p.reasons, ['invalid_preview_response']);
    same(p.missing_refs, []);
    same(p.identity, { binding: t.binding, settings: t.settings });
    same(Object.keys(after.preview).sort(), ['identity', 'missing_refs', 'reasons', 'state']);
  }
});

test('numeric replies need qualification; zero stays qualified', () => {
  for (const field of ['source_generation', 'instrument_mapping_identity', 'qualification_identity'] as const) {
    const b: PreviewBinding = { ...c(BINDING), [field]: null };
    const r = beginPolicyPreview(updatePolicyDraft(createPolicyPreviewSession(b), c(OK)));
    const p = receivePolicyPreview(r.state, r.ticket!, qReply(r.ticket!)).preview;
    ok(p?.state === 'unavailable');
    is(p.state, 'unavailable', field);
    same(p.reasons, ['qualification_unavailable']);
    same(p.missing_refs, []);
  }
  const { s, t } = start();
  const nums = { signed_start_bp: 0, signed_end_bp: 0, signed_change_bp: 0,
    absolute_change_bp: 0, direction: 'unchanged_at_endpoints', crosses_zero: false };
  const za = receivePolicyPreview(s, t, qReply(t, nums));
  is(za.preview?.state, 'qualified');
  is(za.preview.signed_change_bp, 0);
});

test('review: exact shape, unavailable reviewable, timing-invariant', () => {
  is(reviewPolicyDraft(draft(INVALID)).review, null);
  const { s, t } = start();
  let s2 = reviewPolicyDraft(receivePolicyPreview(s, t, uReply(t, ['missing_observation'], ['b_end'])));
  ok(s2.review); // valid-but-unavailable is reviewable
  same(Object.keys(s2.review.binding).sort(), ['auth_epoch', 'principal_partition', 'saved_id', 'saved_revision']);
  same(s2.review.settings, SETTINGS);
  const r3 = beginPolicyPreview(s2); // preview timing must not disturb the snapshot
  is(r3.state.preview, null); // begin hides the old preview but keeps the review
  s2 = receivePolicyPreview(r3.state, r3.ticket!, qReply(r3.ticket!));
  same(s2.review!.binding, RB);
  same(s2.review!.settings, SETTINGS);
  is((s2.review as Rec).signed_change_bp, undefined);
});

test('mutation of inputs/outputs cannot change retained state', () => {
  const ownerBinding = c(BINDING); const ownerSettings = c(SETTINGS);
  const s0 = createPolicyPreviewSession(ownerBinding);
  ownerBinding.saved_revision = 99;
  is(s0.binding.saved_revision, 4);
  let s = updatePolicyDraft(s0, { ok: true, settings: ownerSettings });
  ownerSettings.economy_a = 'ZZ';
  same(valSettings(s), SETTINGS);
  const r = beginPolicyPreview(s); s = r.state;
  const ticket = r.ticket!;
  const reply = qReply(ticket);
  s = receivePolicyPreview(s, ticket, reply);
  (reply as Rec).signed_start_bp = 999;
  is((s.preview as { signed_start_bp: number }).signed_start_bp, 12.5);
  const review = reviewPolicyDraft(s).review!;
  throws(() => { (ticket as Rec).session_sequence = 1; }, TypeError);
  throws(() => { (ticket.binding as Rec).auth_epoch = 'e'; }, TypeError);
  throws(() => { (review.settings as Rec).economy_a = 'ZZ'; }, TypeError);
  throws(() => { (s as Rec).sequence = 0; }, TypeError);
  same(valSettings(s), SETTINGS);
});

test('sequence never decreases; fails closed before overflow', () => {
  let s = createPolicyPreviewSession(c(BINDING));
  const seqs: number[] = [s.sequence];
  s = updatePolicyDraft(s, c(INVALID)); seqs.push(s.sequence);
  const r = beginPolicyPreview(updatePolicyDraft(s, c(OK))); seqs.push(r.state.sequence);
  s = receivePolicyPreview(r.state, r.ticket!, qReply(r.ticket!)); seqs.push(s.sequence);
  s = reviewPolicyDraft(s); seqs.push(s.sequence);
  s = updatePolicyBinding(s, { ...c(BINDING), source_generation: 'gen-2' }); seqs.push(s.sequence);
  // receive/review are projections: never decrease; draft/begin/binding advance.
  for (let i = 1; i < seqs.length; i++) ok(seqs[i] >= seqs[i - 1], `seq ${i}`);
  ok(seqs[1] > seqs[0] && seqs[2] > seqs[1] && seqs[5] > seqs[2]);
  const atMax = { binding: c(BINDING), validation: noPair, sequence: Number.MAX_SAFE_INTEGER, pending: null, preview: null, review: null } as PolicyPreviewSessionState;
  throws(() => updatePolicyDraft(atMax, c(OK)), PolicyPreviewSequenceOverflow);
  throws(() => updatePolicyBinding(atMax, { ...c(BINDING), auth_epoch: 'e2' }), PolicyPreviewSequenceOverflow);
});

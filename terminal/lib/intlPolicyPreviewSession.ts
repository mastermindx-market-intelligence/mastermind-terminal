// intlPolicyPreviewSession.ts — IM10-T3 artifact-only source (paper-waves-01a1101f).
// Pure ephemeral coherence for the nominal policy point gap preview (absolute
// gap change, bp): no IO, clocks, persistence or recomputation; exported
// values are plain finite JSON, detached and frozen recursively.

export type PolicySettings = {
  economy_a: string;
  economy_b: string;
  lens: 'nominal_policy_point_gap';
  definition: 'absolute_gap_change_bp';
  method_version: string;
  period:
    | { mode: 'owner_horizon'; key: string }
    | { mode: 'fixed_dates'; start: string; end: string };
  instrument_a_ref: string | null;
  instrument_b_ref: string | null;
  revision_policy: 'latest_vintage' | 'original_known';
};

export type PolicyValidation =
  | { ok: true; settings: PolicySettings }
  | { ok: false; errors: readonly { field: string; code: string }[] };

// auth_epoch is an opaque owner lifecycle value, not a clock.
export type PreviewBinding = {
  principal_partition: string | null;
  auth_epoch: string;
  saved_id: string;
  saved_revision: number;
  source_generation: string | null;
  instrument_mapping_identity: string | null;
  qualification_identity: string | null;
};

export type PreviewIdentity = { binding: PreviewBinding; settings: PolicySettings };

export type QualifiedPreview = {
  state: 'qualified';
  identity: PreviewIdentity;
  signed_start_bp: number;
  signed_end_bp: number;
  signed_change_bp: number;
  absolute_change_bp: number;
  direction: 'narrowed' | 'widened' | 'unchanged_at_endpoints';
  crosses_zero: boolean;
};

export type PreviewMissingRef = 'a_start' | 'a_end' | 'b_start' | 'b_end';

export type UnavailablePreview = {
  state: 'unavailable';
  identity: PreviewIdentity;
  reasons: readonly string[];
  missing_refs: readonly PreviewMissingRef[];
};

export type PolicyPreviewResult = QualifiedPreview | UnavailablePreview;

// UI coherence guard (not auth, not a service op id); session_sequence is
// this request's serial.
export type PreviewTicket = {
  binding: PreviewBinding;
  settings: PolicySettings;
  session_sequence: number;
};

// Exact reviewed settings plus saved-record CAS/lifecycle identity only.
export type ReviewSnapshot = {
  binding: {
    principal_partition: string | null;
    auth_epoch: string;
    saved_id: string;
    saved_revision: number;
  };
  settings: PolicySettings;
};

export type PolicyPreviewSessionState = {
  binding: PreviewBinding;
  validation: PolicyValidation;
  sequence: number;
  pending: PreviewTicket | null;
  preview: PolicyPreviewResult | null;
  review: ReviewSnapshot | null;
};

export class PolicyPreviewSequenceOverflow extends Error {
  readonly code = 'policy_preview_sequence_overflow';
  constructor() { super('policy preview sequence exhausted'); this.name = 'PolicyPreviewSequenceOverflow'; }
}

type Rec = Record<string, unknown>;
const MAX_SEQ = Number.MAX_SAFE_INTEGER;
const EMPTY_INVALID: PolicyValidation = deepFreeze({ ok: false, errors: [] });
const MALFORMED: PolicyValidation = deepFreeze({
  ok: false, errors: [{ field: 'validation', code: 'malformed_owner_validation' }],
});

function isRec(v: unknown): v is Rec {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isStrOrNull(v: unknown): v is string | null {
  return typeof v === 'string' || v === null;
}
function isSafeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as unknown as T;
  if (isRec(v)) {
    const out: Rec = {};
    for (const k of Object.keys(v)) out[k] = clone(v[k]);
    return out as unknown as T;
  }
  return v;
}

function deepFreeze<T>(v: T): T {
  if (Array.isArray(v)) {
    for (const x of v) deepFreeze(x);
    Object.freeze(v);
  } else if (isRec(v)) {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

// Exact field equality (no hashes); own key sets must match.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => same(x, b[i]));
  }
  if (isRec(a) && isRec(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length || ka.some((k) => !(k in b))) return false;
    return ka.every((k) => same(a[k], b[k]));
  }
  return false;
}

function periodShapeOk(p: unknown): boolean {
  if (!isRec(p)) return false;
  if (p.mode === 'owner_horizon') return typeof p.key === 'string' && Object.keys(p).length === 2;
  if (p.mode === 'fixed_dates')
    return typeof p.start === 'string' && typeof p.end === 'string' && Object.keys(p).length === 3;
  return false;
}

// Shape safeguard only; invents no admission lists.
function settingsShapeOk(s: unknown): s is PolicySettings {
  return (
    isRec(s) && Object.keys(s).length === 9 &&
    typeof s.economy_a === 'string' && typeof s.economy_b === 'string' &&
    s.lens === 'nominal_policy_point_gap' && s.definition === 'absolute_gap_change_bp' &&
    typeof s.method_version === 'string' && periodShapeOk(s.period) &&
    isStrOrNull(s.instrument_a_ref) && isStrOrNull(s.instrument_b_ref) &&
    (s.revision_policy === 'latest_vintage' || s.revision_policy === 'original_known')
  );
}

function adoptBinding(b: PreviewBinding): PreviewBinding {
  if (!isRec(b) || Object.keys(b).length !== 7 || !isStrOrNull(b.principal_partition) ||
    typeof b.auth_epoch !== 'string' || typeof b.saved_id !== 'string' ||
    !isSafeInt(b.saved_revision) || !isStrOrNull(b.source_generation) ||
    !isStrOrNull(b.instrument_mapping_identity) || !isStrOrNull(b.qualification_identity)) {
    throw new TypeError('invalid PreviewBinding');
  }
  return deepFreeze({
    principal_partition: b.principal_partition, auth_epoch: b.auth_epoch,
    saved_id: b.saved_id, saved_revision: b.saved_revision,
    source_generation: b.source_generation,
    instrument_mapping_identity: b.instrument_mapping_identity,
    qualification_identity: b.qualification_identity,
  });
}

function adoptValidation(v: PolicyValidation): PolicyValidation {
  if (isRec(v) && v.ok === true && settingsShapeOk(v.settings)) {
    return deepFreeze({ ok: true as const, settings: clone(v.settings) });
  }
  if (isRec(v) && v.ok === false && Array.isArray(v.errors) &&
    v.errors.every((e) => isRec(e) && Object.keys(e).length === 2 &&
      typeof e.field === 'string' && typeof e.code === 'string')) {
    return deepFreeze({ ok: false as const, errors: clone(v.errors) });
  }
  return MALFORMED;
}

function validSettings(s: PolicyPreviewSessionState): PolicySettings | null {
  const v = s.validation;
  return isRec(v) && v.ok === true && settingsShapeOk(v.settings) ? v.settings : null;
}

function makeState(binding: PreviewBinding, validation: PolicyValidation, sequence: number,
  pending: PreviewTicket | null, preview: PolicyPreviewResult | null,
  review: ReviewSnapshot | null): PolicyPreviewSessionState {
  return deepFreeze({ binding, validation, sequence, pending, preview, review });
}

// Monotonic local sequence; fails closed before overflow.
function nextSeq(cur: number): number {
  if (!isSafeInt(cur) || cur >= MAX_SEQ) throw new PolicyPreviewSequenceOverflow();
  return cur + 1;
}

export function createPolicyPreviewSession(binding: PreviewBinding): PolicyPreviewSessionState {
  return makeState(adoptBinding(binding), EMPTY_INVALID, 0, null, null, null);
}

// Any draft update (even identical visible settings) advances the sequence,
// cancels pending and clears preview/review: no A->B->A revival.
export function updatePolicyDraft(state: PolicyPreviewSessionState,
  validation: PolicyValidation): PolicyPreviewSessionState {
  return makeState(state.binding, adoptValidation(validation), nextSeq(state.sequence), null, null, null);
}

export function updatePolicyBinding(state: PolicyPreviewSessionState,
  binding: PreviewBinding): PolicyPreviewSessionState {
  const next = adoptBinding(binding);
  if (same(state.binding, next)) return state;
  const cur = state.binding;
  const seq = nextSeq(state.sequence);
  if (cur.principal_partition !== next.principal_partition ||
    cur.auth_epoch !== next.auth_epoch || cur.saved_id !== next.saved_id) {
    // Other principal/lifecycle/record: carry nothing across.
    return makeState(next, EMPTY_INVALID, seq, null, null, null);
  }
  if (cur.saved_revision !== next.saved_revision) {
    // Revision advanced: keep the validated draft, drop request/review.
    return makeState(next, state.validation, seq, null, null, null);
  }
  // Only source/mapping/qualification moved: reviewed intent is unchanged,
  // so settings and an existing review snapshot survive.
  return makeState(next, state.validation, seq, null, null, state.review);
}

export function beginPolicyPreview(state: PolicyPreviewSessionState): {
  state: PolicyPreviewSessionState;
  ticket: PreviewTicket | null;
} {
  const settings = validSettings(state);
  if (settings === null) return deepFreeze({ state, ticket: null });
  const seq = nextSeq(state.sequence);
  const ticket = deepFreeze({
    binding: clone(state.binding), settings: clone(settings), session_sequence: seq,
  });
  return deepFreeze({
    state: makeState(state.binding, state.validation, seq, ticket, null, state.review),
    ticket,
  });
}

function installUnavailable(state: PolicyPreviewSessionState, trusted: PreviewIdentity,
  reasons: string[], missing: PreviewMissingRef[]): PolicyPreviewSessionState {
  return makeState(state.binding, state.validation, state.sequence, null,
    deepFreeze({ state: 'unavailable' as const, identity: trusted,
      reasons: clone(reasons), missing_refs: clone(missing) }),
    state.review);
}

const SLOTS: readonly PreviewMissingRef[] = ['a_start', 'a_end', 'b_start', 'b_end'];

export function receivePolicyPreview(state: PolicyPreviewSessionState, ticket: PreviewTicket,
  result: PolicyPreviewResult): PolicyPreviewSessionState {
  const pending = state.pending;
  if (pending === null) return state;
  if (!same(ticket, pending)) return state;
  const settings = validSettings(state);
  if (settings === null) return state;
  if (!same(pending.binding, state.binding) || !same(pending.settings, settings)) return state;
  if (!isRec(result)) return state;
  const id = result.identity;
  if (!isRec(id) || Object.keys(id).length !== 2 || !same(id.binding, pending.binding) ||
    !same(id.settings, pending.settings)) {
    return state;
  }
  const trusted: PreviewIdentity = {
    binding: clone(pending.binding), settings: clone(pending.settings),
  };
  if (result.state === 'qualified') {
    const q: Rec = result;
    const shapeOk = Object.keys(q).length === 8 && Number.isFinite(q.signed_start_bp as number) &&
      Number.isFinite(q.signed_end_bp as number) && Number.isFinite(q.signed_change_bp as number) &&
      Number.isFinite(q.absolute_change_bp as number) &&
      (q.direction === 'narrowed' || q.direction === 'widened' || q.direction === 'unchanged_at_endpoints') &&
      typeof q.crosses_zero === 'boolean';
    if (!shapeOk) return installUnavailable(state, trusted, ['invalid_preview_response'], []);
    if (pending.binding.source_generation === null ||
      pending.binding.instrument_mapping_identity === null ||
      pending.binding.qualification_identity === null) {
      return installUnavailable(state, trusted, ['qualification_unavailable'], []);
    }
    const preview: QualifiedPreview = deepFreeze({
      state: 'qualified' as const, identity: trusted,
      signed_start_bp: q.signed_start_bp as number, signed_end_bp: q.signed_end_bp as number,
      signed_change_bp: q.signed_change_bp as number, absolute_change_bp: q.absolute_change_bp as number,
      direction: q.direction as QualifiedPreview['direction'], crosses_zero: q.crosses_zero as boolean,
    });
    return makeState(state.binding, state.validation, state.sequence, null, preview, state.review);
  }
  if (result.state === 'unavailable') {
    const u: Rec = result;
    const shapeOk = Object.keys(u).length === 4 && Array.isArray(u.reasons) &&
      u.reasons.every((r) => typeof r === 'string') && Array.isArray(u.missing_refs) &&
      u.missing_refs.every((m) => SLOTS.includes(m as PreviewMissingRef));
    if (!shapeOk) return installUnavailable(state, trusted, ['invalid_preview_response'], []);
    return installUnavailable(state, trusted, u.reasons as string[], u.missing_refs as PreviewMissingRef[]);
  }
  // Unknown discriminator: matching but malformed; never stay pending.
  return installUnavailable(state, trusted, ['invalid_preview_response'], []);
}

export function reviewPolicyDraft(state: PolicyPreviewSessionState): PolicyPreviewSessionState {
  const settings = validSettings(state);
  if (settings === null) {
    return state.review === null ? state
      : makeState(state.binding, state.validation, state.sequence, state.pending, state.preview, null);
  }
  const b = state.binding;
  const review: ReviewSnapshot = deepFreeze({
    binding: deepFreeze({
      principal_partition: b.principal_partition, auth_epoch: b.auth_epoch,
      saved_id: b.saved_id, saved_revision: b.saved_revision,
    }),
    settings: clone(settings),
  });
  return makeState(state.binding, state.validation, state.sequence, state.pending, state.preview, review);
}

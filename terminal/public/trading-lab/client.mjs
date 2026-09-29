/** UI transport state, not a thesis store. One unresolved request is retained per signed-in user. */
const SCHEMA = 'mastermind.thesis-lab/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function tabStorage() { try { return globalThis.sessionStorage; } catch { return null; } }
const validUuid = x => typeof x === 'string' && UUID.test(x);
const clone = x => JSON.parse(JSON.stringify(x));
const normalized = x => typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/^ +| +$/g, '') : '';
const stable = x => JSON.stringify(x, (key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export class LabError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'LabError'; this.code = code; Object.assign(this, details); }
}
export function contentFromForm(form, previous = null) {
  const lines = value => normalized(value).split('\n').map(normalized).filter(x => x.trim());
  const content = {schema: 'mastermind.thesis-content/v1', title: normalized(form.title), statement: normalized(form.statement),
    catalysts: lines(form.catalysts), falsifiers: lines(form.falsifiers), risks: lines(form.risks), horizon: form.horizon,
    effectiveAt: previous?.effectiveAt ?? null, revisionNote: normalized(form.revisionNote) || null};
  if (!content.title.trim() || [...content.title].length > 160 || /[\r\n\t]/.test(content.title)) throw new LabError('title_required');
  if (!content.statement.trim() || [...content.statement].length > 12000) throw new LabError('statement_required');
  if (!['unspecified', 'days', 'weeks', 'months', 'quarters', 'years'].includes(content.horizon)) throw new LabError('invalid_horizon');
  for (const key of ['catalysts', 'falsifiers', 'risks'])
    if (content[key].length > 20 || content[key].some(x => [...x].length > 500)) throw new LabError('list_too_long');
  if (content.revisionNote && [...content.revisionNote].length > 1000) throw new LabError('revision_note_too_long');
  return content;
}
export function subjectFromSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!symbol || symbol.length > 24 || !/^(?:\^[A-Z0-9]+|[A-Z0-9]+(?:[.-][A-Z0-9]+)*)$/.test(symbol)) throw new LabError('invalid_symbol');
  // This preserves the canonical Analysis symbol grammar; a symbol is NOT issuer resolution.
  return {schema: 'mastermind.thesis-subject-ref/v1', kind: 'issuer', owner: 'terminal.analysis_symbol', key: symbol,
    identityState: 'listing_scoped', listing: {symbol, mic: null, securityId: null}, companyId: null, display: symbol};
}
export function planPrompts(content) {
  return [
    {key: 'statement', label: 'Your independent reasoning', done: Boolean(content.statement?.trim())},
    {key: 'horizon', label: 'A stated time horizon', done: content.horizon !== 'unspecified'},
    {key: 'falsifiers', label: 'What would change your view', done: Boolean(content.falsifiers?.length)},
    {key: 'risks', label: 'The strongest counter-case', done: Boolean(content.risks?.length)},
  ];
}
export class ThesisLabClient {
  constructor({endpoint = 'https://app.mastermind-x.com/api/theses/lab', fetchImpl = globalThis.fetch.bind(globalThis),
    storage = tabStorage(), uuid = () => globalThis.crypto.randomUUID(), timeoutMs = 25000} = {}) {
    this.endpoint = endpoint; this.fetchImpl = fetchImpl; this.storage = storage; this.uuid = uuid; this.timeoutMs = timeoutMs;
    this.userId = null; this.pending = null; this.busy = false; this.state = 'disconnected'; this.epoch = 0;
  }
  key() { return `mm.lab.pending.v1.${this.userId}`; }
  async request(query = '', options = {}) {
    const expected = this.userId, epoch = this.epoch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await this.fetchImpl(this.endpoint + query, {credentials: 'include', cache: 'no-store', redirect: 'error',
        ...options, headers: {...(expected ? {'X-Mastermind-User': expected} : {}), ...(options.headers || {})}, signal: controller.signal});
      if (epoch !== this.epoch) throw new LabError('superseded_response');
      const b = await r.json();
      if (epoch !== this.epoch) throw new LabError('superseded_response');
      if (b?.schema !== SCHEMA) throw new LabError('invalid_response');
      if (!r.ok) {
        if (b.error === 'account_changed' || b.error === 'unauthenticated') {
          this.state = b.error; this.userId = null; this.pending = null; this.epoch++;
        }
        throw new LabError(b.error || 'request_failed', {status: r.status, effectUnknown: b.effectUnknown, currentVersion: b.currentVersion});
      }
      if (expected && b.userId !== expected) { this.userId = null; this.pending = null; this.state = 'account_changed'; this.epoch++; throw new LabError('account_changed'); }
      return b;
    } catch (e) { if (e instanceof LabError) throw e; throw new LabError('connection_uncertain'); }
    finally { clearTimeout(timer); }
  }
  async connect() {
    if (this.busy) throw new LabError('request_in_progress');
    this.epoch++; this.userId = null; this.pending = null;
    const b = await this.request('?view=session');
    if (!validUuid(b.userId)) throw new LabError('invalid_response');
    this.userId = b.userId; this.state = 'ready';
    try {
      const raw = this.storage?.getItem(this.key());
      if (raw) {
        const value = JSON.parse(raw);
        if (value.userId !== this.userId || !validUuid(value.body?.clientRequestId) || !['create', 'revise'].includes(value.body?.action))
          throw new Error('invalid pending');
        this.pending = value; this.state = 'outcome_unknown';
      }
    } catch { this.state = 'recovery_unavailable'; throw new LabError('recovery_unavailable'); }
    return b;
  }
  async list() {
    this.requireUser(); const b = await this.request();
    if (!Array.isArray(b.theses) || typeof b.truncated !== 'boolean') throw new LabError('invalid_response');
    return b;
  }
  async read(id) {
    this.requireUser(); if (!validUuid(id)) throw new LabError('invalid_thesis_id');
    const b = await this.request(`?id=${encodeURIComponent(id)}`);
    if (b.thesis?.id !== id || !Number.isSafeInteger(b.thesis.currentVersion) || !Array.isArray(b.thesis.history) || !b.thesis.current?.content)
      throw new LabError('invalid_response');
    return b.thesis;
  }
  requireUser() { if (!this.userId) throw new LabError('unauthenticated'); }
  async save({subject, content, thesis = null}) {
    this.requireUser();
    if (this.busy) throw new LabError('request_in_progress');
    if (this.pending || this.state === 'recovery_unavailable') throw new LabError('unresolved_save');
    if (thesis && (!validUuid(thesis.id) || !Number.isSafeInteger(thesis.currentVersion) || thesis.currentVersion < 1)) throw new LabError('invalid_thesis_id');
    const body = {action: thesis ? 'revise' : 'create', id: thesis?.id ?? null, expectedVersion: thesis?.currentVersion ?? 0,
      clientRequestId: this.uuid(), subject: clone(subject), content: clone(content)};
    this.pending = {userId: this.userId, body};
    // Write before send. A storage failure cannot create a write whose identity is lost on reload.
    try {
      if (!this.storage) throw new Error('unavailable');
      const encoded = JSON.stringify(this.pending); this.storage.setItem(this.key(), encoded);
      if (this.storage.getItem(this.key()) !== encoded) throw new Error('not retained');
    } catch { this.pending = null; throw new LabError('recovery_storage_required'); }
    return this.sendPending();
  }
  async sendPending() {
    this.requireUser();
    if (!this.pending || this.pending.userId !== this.userId || this.busy) throw new LabError('unresolved_save');
    const pending = clone(this.pending); this.busy = true; this.state = 'saving';
    try {
      const b = await this.request('', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(pending.body)});
      if (!validUuid(b.thesisId) || !Number.isSafeInteger(b.version) || b.version !== pending.body.expectedVersion + 1 || typeof b.replayed !== 'boolean' || b.clientRequestId !== pending.body.clientRequestId ||
          b.executionAuthority !== false || b.orderSubmitted !== false || (pending.body.id && b.thesisId !== pending.body.id))
        throw new LabError('invalid_response');
      this.clearPending(); this.state = 'saved'; return b;
    } catch (e) {
      if (!this.userId) throw e;
      if (e.effectUnknown === false && [400, 404, 409, 413, 415, 422].includes(e.status)) {
        this.clearPending(); this.state = e.code === 'version_conflict' ? 'conflict' : 'refused';
      } else { this.state = 'outcome_unknown'; }
      throw e;
    } finally { this.busy = false; }
  }
  clearPending() {
    // Failure to clear only retains a duplicate-safe recovery record. Never falsify saved state.
    try { this.storage?.removeItem(this.key()); } catch { /* reconciled again after reload */ }
    this.pending = null;
  }
  async reconcile() {
    this.requireUser();
    if (!this.pending || this.busy) throw new LabError('no_pending_request');
    this.busy = true;
    const p = clone(this.pending);
    try {
      const b = await this.request(`?requestId=${encodeURIComponent(p.body.clientRequestId)}`);
      if (b.receipt === null) { this.state = 'not_recorded'; return {recorded: false}; }
      const r = b.receipt;
      if (!validUuid(r?.thesisId) || r.clientRequestId !== p.body.clientRequestId || (p.body.id && r.thesisId !== p.body.id))
        throw new LabError('invalid_receipt');
      const thesis = await this.read(r.thesisId);
      const version = thesis.history.find(v => v.clientRequestId === p.body.clientRequestId && v.version === r.version);
      if (!version || stable(version.content) !== stable(p.body.content) || stable(version.subject) !== stable(p.body.subject))
        throw new LabError('receipt_content_unverified');
      this.clearPending(); this.state = 'saved'; return {recorded: true, thesis, version: r.version};
    } catch (e) { if (this.userId) this.state = 'outcome_unknown'; throw e; }
    finally { this.busy = false; }
  }
  async retryUnrecorded() {
    if (this.state !== 'not_recorded') throw new LabError('reconcile_first');
    return this.sendPending(); // User-initiated, exact same principal, payload and request identity.
  }
}

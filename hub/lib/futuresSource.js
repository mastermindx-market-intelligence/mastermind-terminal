'use strict';
/**
 * Streaming source adapter for the EXISTING Quote Hub futures reducers.
 * Accepts the offline SDK normalizer's lossless records (or the same contract from
 * the existing capture owner). It opens no sockets, records no data and grants no
 * entitlements. A source ordinal is transport order, NOT a CME sequence number.
 * Exchange sequence jumps are normal after filtering and never imply a gap alone.
 */
const { createHash } = require('node:crypto');
const { FuturesMboBook, FLAGS } = require('./futuresMbo');
const U64 = (1n << 64n) - 1n, I64 = (1n << 63n) - 1n, TICK = 250000000n;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 256;
function check(ok, reason) { if (!ok) throw new Error(reason); }
function uint(v, label) {
  check(typeof v === 'string' && /^(0|[1-9]\d{0,19})$/.test(v), label);
  const n = BigInt(v); check(n < U64, label); return n;
}
function small(v, max, label) { check(Number.isSafeInteger(v) && v >= 0 && v <= max, label); return v; }
const keyOf = r => `${r.publisher_id}:${r.instrument_id}`;
const bindingKey = b => `${b.publisherId}:${b.instrumentId}`;
const errorText = e => e instanceof Error ? e.message : 'invalid_source';

/** DBN integers remain strings. Reject coercions, pretty prices and nested JSON headers. */
function normalizeMboRecord(raw) {
  check(obj(raw) && raw.rtype === 160, 'not_mbo');
  const r = {
    rtype: 160,
    publisher_id: small(raw.publisher_id, 65535, 'publisher_id'),
    instrument_id: small(raw.instrument_id, 0xffffffff, 'instrument_id'),
    flags: small(raw.flags, 255, 'flags'),
    channel_id: small(raw.channel_id, 255, 'channel_id'),
    sequence: small(raw.sequence, 0xffffffff, 'sequence'),
    action: raw.action, side: raw.side,
    order_id: uint(raw.order_id, 'order_id').toString(),
    ts_event: uint(raw.ts_event, 'ts_event').toString(),
    ts_recv: uint(raw.ts_recv, 'ts_recv').toString(),
    price: raw.price, size: small(raw.size, 0xffffffff, 'size'),
  };
  check(['A', 'M', 'C', 'R', 'T', 'F', 'N'].includes(r.action), 'action');
  check(['A', 'B', 'N'].includes(r.side), 'side');
  check(typeof r.price === 'string' && /^-?(0|[1-9]\d{0,18})$/.test(r.price), 'price');
  const price = BigInt(r.price);
  check(price >= -I64 - 1n && price <= I64, 'price');
  // R/N may carry UNDEF_PRICE and zero size. F is validated but not counted twice.
  if (['A', 'M', 'C', 'T', 'F'].includes(r.action)) {
    check(price > 0n && price < I64 && price % TICK === 0n, 'off_tick_price');
    check(r.size > 0, 'zero_quantity');
  }
  return r;
}

/** Turn an actual SDK definition into a constrained ES/NQ binding; not a security master. */
function bindFuturesDefinition(record, { sourceId, sessionId, availableAtNs }) {
  check(obj(record) && record.rtype === 19 && text(sourceId) && text(sessionId), 'definition_input');
  check(record.instrument_class === 'F' && /^(ES|NQ)[HMUZ]\d{1,4}$/.test(record.raw_symbol), 'not_es_nq_outright');
  check(record.min_price_increment === TICK.toString(), 'unsupported_tick_size');
  const publisherId = small(record.publisher_id, 65535, 'publisher_id');
  const instrumentId = small(record.instrument_id, 0xffffffff, 'instrument_id');
  const from = uint(record.activation, 'activation'), until = uint(record.expiration, 'expiration');
  const received = uint(record.ts_recv, 'definition_receive'), available = uint(availableAtNs, 'definition_availability');
  check(from < until && received <= available, 'definition_clock');
  return { contract: record.raw_symbol, publisherId, instrumentId, sessionId,
    validFromNs: from.toString(), validUntilNs: until.toString(),
    definitionId: `${sourceId}:${createHash('sha256').update(JSON.stringify(record)).digest('hex')}`,
    definitionAvailableAtNs: available.toString() };
}

/**
 * Assemble F_LAST batches without conflating ES and NQ events or assuming their
 * venue sequences are contiguous. All memory is bounded by admitted bindings and
 * maxPendingRecords. Exact same last input is idempotent, older input is refused.
 * sourceId + ordinal must be preserved across replays by the existing capture owner.
 */
class FuturesEventAssembler {
  constructor({ sourceId, bindings, availabilityBasis, maxPendingRecords = 100000, maxOrders = 200000 }) {
    check(text(sourceId) && Array.isArray(bindings) && bindings.length > 0 && bindings.length <= 16, 'source_bindings');
    check(['vendor_capture_retrospective', 'recorded_receipt'].includes(availabilityBasis), 'availability_basis');
    check(Number.isSafeInteger(maxPendingRecords) && maxPendingRecords > 0 && maxPendingRecords <= 100000, 'pending_capacity');
    this.sourceId = sourceId; this.availabilityBasis = availabilityBasis; this.maxPendingRecords = maxPendingRecords;
    this.states = new Map(); this.nextOrdinal = 0; this.lastInputHash = null;
    this.lastAvailability = 0n; this.gaps = 0; this.closed = false; this.sequences = new Map();
    for (const b of bindings) {
      check(obj(b) && text(b.definitionId) && text(b.sessionId), 'binding');
      const from = uint(b.validFromNs, 'valid_from'), until = uint(b.validUntilNs, 'valid_until');
      const definitionAt = uint(b.definitionAvailableAtNs, 'definition_availability');
      check(from < until && !this.states.has(bindingKey(b)), 'binding_range_or_duplicate');
      const book = new FuturesMboBook({ ...b, maxOrders });
      this.states.set(bindingKey(b), { binding: Object.freeze({ ...b }), from, until, definitionAt,
        book, pending: [], previousCursor: null, channel: null, coverage: 'partial' });
    }
  }
  _invalidate(reason, channel = null) {
    this.gaps++;
    for (const s of this.states.values()) if (channel === null || s.channel === channel || s.channel === null) {
      s.book.invalidate(reason); s.pending = []; s.coverage = 'gap';
    }
  }
  _result(status, extra = {}) {
    return { status, sourceId: this.sourceId, availabilityBasis: this.availabilityBasis,
      continuityBasis: 'source_ordinals_and_vendor_gap_flags', trades: [], ...extra };
  }
  push(envelope) {
    if (this.closed) return this._result('unavailable', { reason: 'source_finished' });
    try {
      check(obj(envelope) && envelope.sourceId === this.sourceId && Number.isSafeInteger(envelope.ordinal) &&
        envelope.ordinal >= 0, 'source_identity_or_ordinal');
      const hash = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
      if (envelope.ordinal === this.nextOrdinal - 1 && hash === this.lastInputHash) return this._result('duplicate');
      check(envelope.ordinal === this.nextOrdinal, 'source_ordinal_gap_or_reorder');
      const available = uint(envelope.availableAtNs, 'availability');
      check(available >= this.lastAvailability, 'availability_regression');
      this.nextOrdinal++; this.lastInputHash = hash; this.lastAvailability = available;
      const r = normalizeMboRecord(envelope.record);
      check(uint(r.ts_recv, 'ts_recv') <= available, 'receive_after_availability');
      // A vendor gap is CHANNEL-wide, including when the flag rides an unselected instrument.
      if (r.flags & FLAGS.BAD_BOOK) {
        this._invalidate('vendor_channel_gap', r.channel_id);
        return this._result('unavailable', { reason: 'vendor_channel_gap' });
      }
      const state = this.states.get(keyOf(r));
      if (!state) return this._result('ignored', { reason: 'unselected_instrument' });
      check(!(r.flags & (FLAGS.TOB | FLAGS.MBP | FLAGS.SPECIFIC)), 'unsupported_flags');
      const snapshot = !!(r.flags & FLAGS.SNAPSHOT);
      check(!(r.flags & FLAGS.BAD_TS) || snapshot, 'bad_receive_clock');
      // Use receive/availability, not an old GTC order event time, for snapshot validity.
      const effective = uint(snapshot ? r.ts_recv : r.ts_event, 'effective_time');
      check(effective >= state.from && effective < state.until && available >= state.definitionAt,
        'inactive_or_unavailable_definition');
      if (state.channel !== null) check(state.channel === r.channel_id, 'instrument_channel_changed');
      state.channel = r.channel_id;
      // Repeated sequences are normal. A forward jump is NOT evidence of missing selected data.
      if (!snapshot) {
        const previous = this.sequences.get(r.channel_id);
        if (previous !== undefined) {
          const distance = (r.sequence - previous + 0x100000000) % 0x100000000;
          check(distance < 0x80000000, 'venue_sequence_regression');
        }
        this.sequences.set(r.channel_id, r.sequence);
      }
      if (snapshot && r.action === 'R') {
        // A fresh complete snapshot can recover the FUTURE book, never erase historical gaps.
        state.pending = []; state.book.invalidate('snapshot_in_progress');
      }
      check(state.pending.length < this.maxPendingRecords, 'pending_event_capacity');
      state.pending.push({ record: r, ordinal: envelope.ordinal });
      if (!(r.flags & FLAGS.LAST)) return this._result('buffered', { pending: state.pending.length });
      const pending = state.pending; state.pending = [];
      const cursor = `${this.sourceId}:${envelope.ordinal}`;
      const batch = { ...state.binding, cursor, previousCursor: state.previousCursor,
        continuity: 'verified', availableAtNs: envelope.availableAtNs, records: pending.map(p => p.record) };
      const bookResult = state.book.applyBatch(batch);
      if (bookResult.status === 'applied') state.previousCursor = cursor;
      else state.coverage = 'partial';
      // Observed executions do NOT depend on having a complete starting depth snapshot.
      // One population feeds footprints, tape and profiles. Ignore bookResult.trades here.
      const trades = pending.filter(p => p.record.action === 'T').map(({ record: t, ordinal }) => ({
        id: `${this.sourceId}:${ordinal}`, contract: state.binding.contract,
        publisherId: t.publisher_id, instrumentId: t.instrument_id, sessionId: state.binding.sessionId,
        priceTicks: Number(BigInt(t.price) / TICK), size: t.size,
        aggressor: t.side === 'B' ? 'buy' : t.side === 'A' ? 'sell' : 'unknown',
        eventTimeNs: t.ts_event, receiveTimeNs: t.ts_recv, availableAtNs: envelope.availableAtNs,
      }));
      return this._result('event', { contract: state.binding.contract, cursor, trades,
        bookStatus: bookResult.status, bookReason: bookResult.reason ?? null,
        executionCoverage: this.gaps ? 'gap' : 'partial' });
    } catch (e) {
      this._invalidate(errorText(e));
      // A malformed source ordinal cannot silently rebase transport order.
      return this._result('unavailable', { reason: errorText(e) });
    }
  }
  view({ publisherId, instrumentId, ...options }) {
    const s = this.states.get(`${publisherId}:${instrumentId}`);
    if (!s) return { status: 'unavailable', reason: 'unselected_instrument' };
    try {
      const decision = uint(options.decisionTimeNs, "decision_time");
      check(decision >= s.from && decision < s.until && decision >= s.definitionAt, "contract_inactive");
    } catch (e) { return { status: "unavailable", reason: errorText(e) }; }
    return { ...s.book.view(options), sourceId: this.sourceId, availabilityBasis: this.availabilityBasis,
      pendingEventRecords: s.pending.length };
  }
  finish() {
    const incomplete = [...this.states.values()].some(s => s.pending.length > 0);
    if (incomplete) this._invalidate('incomplete_final_event');
    this.closed = true;
    return this._result(incomplete ? 'unavailable' : 'finished', {
      reason: incomplete ? 'incomplete_final_event' : null, recordCount: this.nextOrdinal, gapCount: this.gaps,
    });
  }
}
module.exports = { normalizeMboRecord, bindFuturesDefinition, FuturesEventAssembler };

/** Select a venue-published status at a decision cutoff, never infer it from clock time. */
function selectFuturesStatus(envelopes, binding, decisionTimeNs, maxAgeNs) {
  try {
    check(Array.isArray(envelopes) && obj(binding), 'status_input');
    const decision = uint(decisionTimeNs, 'decision_time'), age = uint(maxAgeNs, 'status_max_age');
    check(decision >= uint(binding.validFromNs, 'valid_from') && decision < uint(binding.validUntilNs, 'valid_until') &&
      decision >= uint(binding.definitionAvailableAtNs, 'definition_availability'), 'contract_inactive');
    let selected = null;
    for (const e of envelopes) {
      check(obj(e) && obj(e.record), 'status_record');
      const available = uint(e.availableAtNs, 'status_availability');
      if (available > decision) continue;
      const r = e.record;
      if (r.publisher_id !== binding.publisherId || r.instrument_id !== binding.instrumentId) continue;
      check(r.rtype === 18 && ['Y', 'N', '~'].includes(r.is_trading) && ['Y', 'N', '~'].includes(r.is_quoting), 'status_schema');
      const received = uint(r.ts_recv, 'status_receive'), event = uint(r.ts_event, 'status_event');
      check(received <= available, 'status_clock');
      if (event > decision) continue;
      if (!selected || available > selected.available || (available === selected.available && received > selected.received))
        selected = { available, received, record: r };
      else if (available === selected.available && received === selected.received)
        check(JSON.stringify(r) === JSON.stringify(selected.record), 'conflicting_status_revision');
    }
    check(selected, 'status_unavailable');
    check(decision - selected.received <= age, 'stale_status');
    const r = selected.record;
    return { status: 'ok', marketStatus: r.is_trading === 'Y' ? 'continuous' : r.is_trading === 'N' ? 'non_trading' : 'unknown',
      isQuoting: r.is_quoting === 'Y' ? true : r.is_quoting === 'N' ? false : null,
      receiveTimeNs: selected.received.toString(), availableAtNs: selected.available.toString(),
      basis: 'venue_status_record' };
  } catch (e) { return { status: 'unavailable', reason: errorText(e) }; }
}
module.exports.selectFuturesStatus = selectFuturesStatus;

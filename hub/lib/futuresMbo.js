'use strict';
/**
 * ES/NQ Databento-style MBO domain reducer for the existing Quote Hub.
 * No socket, credentials, scheduler, archive, or permission logic.
 * Caller supplies source-verified complete single-instrument event batches and
 * capture cursor/availability. NOT a live feed or a generic MBP adapter.
 * Raw int64/uint64 fields cross the boundary as decimal strings, never Numbers.
 */
const { createHash } = require('node:crypto');
const FLAGS = Object.freeze({ LAST: 128, TOB: 64, SNAPSHOT: 32, MBP: 16, BAD_TS: 8, BAD_BOOK: 4, SPECIFIC: 2 });
const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;
const TICK = 250000000n;
function requireThat(test, reason) { if (!test) throw new Error(reason); }
function exactUInt(value, reason) {
  requireThat(typeof value === 'string' && /^(0|[1-9]\d{0,19})$/.test(value), reason);
  const n = BigInt(value); requireThat(n < U64_MAX, reason); return n;
}
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function quantity(value) {
  requireThat(Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff, 'invalid_quantity'); return value;
}
function priceTicks(value) {
  const n = exactUInt(value, 'invalid_price');
  requireThat(n > 0n && n < I64_MAX && n % TICK === 0n && n / TICK <= BigInt(Number.MAX_SAFE_INTEGER), 'invalid_price');
  return Number(n / TICK);
}
function plusSafe(a, b) { const n = a + b; requireThat(Number.isSafeInteger(n), 'quantity_overflow'); return n; }

class FuturesMboBook {
  constructor({ contract, publisherId, instrumentId, sessionId, maxOrders = 200000 }) {
    requireThat(typeof contract === 'string' && /^(ES|NQ)[HMUZ]\d{1,4}$/.test(contract), 'invalid_contract');
    requireThat(Number.isSafeInteger(publisherId) && publisherId >= 0 &&
      Number.isSafeInteger(instrumentId) && instrumentId >= 0 && nonempty(sessionId), 'invalid_identity');
    requireThat(Number.isSafeInteger(maxOrders) && maxOrders > 0, 'invalid_capacity');
    this.identity = Object.freeze({ contract, publisherId, instrumentId, sessionId });
    this.maxOrders = maxOrders; this.orders = new Map(); this.valid = false;
    this.reason = 'snapshot_required'; this.cursor = null; this.digest = null;
    this.lastRecv = 0n; this.availableAt = 0n;
  }
  /** Atomic at a source F_LAST boundary. Duplicate last cursor is idempotent. */
  applyBatch(batch) {
    try {
      requireThat(object(batch) && nonempty(batch.cursor) &&
        (batch.previousCursor === null || nonempty(batch.previousCursor)) &&
        Array.isArray(batch.records) && batch.records.length > 0 && batch.records.length <= 100000, 'invalid_batch');
      const digest = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
      if (batch.cursor === this.cursor) {
        requireThat(digest === this.digest, 'cursor_conflict');
        requireThat(this.valid, 'snapshot_required');
        return { status: 'duplicate', cursor: this.cursor, trades: [] };
      }
      requireThat(batch.contract === this.identity.contract && batch.sessionId === this.identity.sessionId, 'batch_identity');
      requireThat(batch.continuity === 'verified', 'source_gap');
      const availableAt = exactUInt(batch.availableAtNs, 'invalid_availability');
      requireThat(availableAt >= this.availableAt, 'availability_regression');
      const first = batch.records[0];
      requireThat(object(first), 'invalid_record');
      const snapshot = !!(first.flags & FLAGS.SNAPSHOT);
      const reset = snapshot && first.action === 'R';
      requireThat(!snapshot || reset, 'snapshot_reset_required');
      requireThat(reset || this.valid, 'snapshot_required');
      requireThat(reset || batch.previousCursor === this.cursor, 'cursor_gap');
      // Stage only changed orders. No copy of the full order map on every tick.
      let cleared = reset, nextCount = reset ? 0 : this.orders.size;
      const changes = new Map(), trades = [];
      const get = id => changes.has(id) ? changes.get(id) : cleared ? undefined : this.orders.get(id);
      let lastRecv = this.lastRecv, snapshotPrefix = snapshot;
      for (let i = 0; i < batch.records.length; i++) {
        const r = batch.records[i];
        requireThat(object(r) && r.publisher_id === this.identity.publisherId && r.instrument_id === this.identity.instrumentId, 'instrument_mismatch');
        requireThat(Number.isInteger(r.flags) && r.flags >= 0 && r.flags <= 255, 'invalid_flags');
        requireThat(!!(r.flags & FLAGS.LAST) === (i === batch.records.length - 1), 'incomplete_event');
        const isSnapshotRecord = !!(r.flags & FLAGS.SNAPSHOT);
        requireThat(!isSnapshotRecord || snapshotPrefix, 'mixed_snapshot');
        if (!isSnapshotRecord) snapshotPrefix = false;
        requireThat(!(r.flags & (FLAGS.TOB | FLAGS.MBP | FLAGS.BAD_BOOK | FLAGS.SPECIFIC)), 'unsupported_or_bad_book');
        requireThat(!(r.flags & FLAGS.BAD_TS) || isSnapshotRecord, 'bad_receive_clock');
        const recv = exactUInt(r.ts_recv, 'invalid_receive_clock');
        const event = exactUInt(r.ts_event, 'invalid_event_clock');
        requireThat(recv >= lastRecv && recv <= availableAt, 'receive_order_or_availability');
        lastRecv = recv;
        requireThat(['A', 'B', 'N'].includes(r.side) && ['A', 'M', 'C', 'R', 'T', 'F', 'N'].includes(r.action), 'unknown_action_or_side');
        requireThat(!isSnapshotRecord || (i === 0 ? r.action === 'R' : r.action === 'A'), 'snapshot_actions');
        if (r.action === 'R') {
          requireThat(r.side === 'N', 'invalid_clear'); changes.clear(); cleared = true; nextCount = 0; continue;
        }
        if (r.action === 'T') {
          const ticks = priceTicks(r.price), size = quantity(r.size);
          trades.push({ id: `${batch.cursor}:${i}`, ...this.identity, priceTicks: ticks,
            size, aggressor: r.side === 'B' ? 'buy' : r.side === 'A' ? 'sell' : 'unknown',
            eventTimeNs: event.toString(), receiveTimeNs: recv.toString(), availableAtNs: availableAt.toString() });
          continue;
        }
        // F refers to the PASSIVE side and is not a second trade or book subtraction.
        if (r.action === 'F' || r.action === 'N') continue;
        requireThat(r.side === 'A' || r.side === 'B', 'invalid_order_side');
        const id = exactUInt(r.order_id, 'invalid_order_id').toString();
        const ticks = priceTicks(r.price), size = quantity(r.size), existing = get(id);
        if (r.action === 'A') {
          requireThat(!existing, 'duplicate_order'); nextCount++;
          changes.set(id, { side: r.side, priceTicks: ticks, size });
        } else if (r.action === 'M') {
          requireThat(existing && existing.side === r.side, 'unknown_or_changed_order');
          changes.set(id, { side: r.side, priceTicks: ticks, size });
        } else {
          requireThat(existing && existing.side === r.side && existing.priceTicks === ticks, 'unknown_cancel');
          requireThat(size <= existing.size, 'over_cancel');
          changes.set(id, size === existing.size ? null : { ...existing, size: existing.size - size });
          if (size === existing.size) nextCount--;
        }
        requireThat(nextCount <= this.maxOrders, 'order_capacity');
      }
      // Only a fully validated batch changes the public book state.
      if (cleared) this.orders.clear();
      for (const [id, value] of changes) { if (value) this.orders.set(id, value); else this.orders.delete(id); }
      this.valid = true; this.reason = null; this.cursor = batch.cursor; this.digest = digest;
      this.lastRecv = lastRecv; this.availableAt = availableAt;
      return { status: 'applied', cursor: this.cursor, trades };
    } catch (error) {
      this.valid = false; this.reason = error instanceof Error ? error.message : 'invalid_batch';
      return { status: 'unavailable', reason: this.reason, trades: [] };
    }
  }
  /** Snapshot for rendering, not a persistence owner. Never exposes individual order IDs. */
  view({ decisionTimeNs, maxAgeNs, marketStatus = 'unknown' }) {
    if (!this.valid) return { status: 'unavailable', reason: this.reason };
    try {
      const decision = exactUInt(decisionTimeNs, 'invalid_decision_clock');
      const age = exactUInt(maxAgeNs, 'invalid_age_limit');
      requireThat(['continuous', 'non_trading', 'unknown'].includes(marketStatus), 'invalid_market_status');
      requireThat(decision >= this.availableAt, 'not_yet_available');
      requireThat(decision - this.lastRecv <= age, 'stale_book');
      const levels = new Map();
      for (const order of this.orders.values()) {
        const key = `${order.side}:${order.priceTicks}`;
        const level = levels.get(key) || { side: order.side, priceTicks: order.priceTicks, size: 0, orderCount: 0 };
        level.size = plusSafe(level.size, order.size); level.orderCount++; levels.set(key, level);
      }
      const bids = [...levels.values()].filter(x => x.side === 'B').sort((a, b) => b.priceTicks - a.priceTicks);
      const asks = [...levels.values()].filter(x => x.side === 'A').sort((a, b) => a.priceTicks - b.priceTicks);
      const crossed = bids.length > 0 && asks.length > 0 && bids[0].priceTicks >= asks[0].priceTicks;
      requireThat(!crossed || marketStatus === 'non_trading', 'crossed_or_locked_book');
      return { status: 'ok', ...this.identity, cursor: this.cursor, coverage: 'full_order_book',
        liquidityScope: 'displayed_orders_excludes_implied', marketStatus,
        bookState: crossed ? 'crossed_non_trading' : 'uncrossed',
        receiveTimeNs: this.lastRecv.toString(), availableAtNs: this.availableAt.toString(), bids, asks };
    } catch (error) { return { status: 'unavailable', reason: error.message }; }
  }
}

/** Deterministic executed-volume projection; not a trade-correction or capture owner. */
function aggregateFootprint(trades, options) {
  try {
    requireThat(Array.isArray(trades) && object(options), 'invalid_input');
    const start = exactUInt(options.startNs, 'invalid_window'), end = exactUInt(options.endNs, 'invalid_window');
    const decision = exactUInt(options.decisionTimeNs, 'invalid_decision_clock');
    const interval = exactUInt(options.intervalNs, 'invalid_interval');
    requireThat(end > start && end <= decision && interval > 0n && nonempty(options.contract) && nonempty(options.sessionId) &&
      Number.isSafeInteger(options.publisherId) && Number.isSafeInteger(options.instrumentId), 'invalid_window');
    requireThat(['complete', 'partial', 'gap'].includes(options.coverage) && nonempty(options.sourceId), 'missing_coverage');
    const ratio = options.imbalanceRatio ?? 3, minVolume = options.minImbalanceVolume ?? 10;
    requireThat(Number.isFinite(ratio) && ratio > 1 && Number.isSafeInteger(minVolume) && minVolume > 0, 'invalid_imbalance_policy');
    const ids = new Map(), accepted = [];
    for (const t of trades) {
      requireThat(object(t) && nonempty(t.id) && t.contract === options.contract && t.sessionId === options.sessionId &&
        t.publisherId === options.publisherId && t.instrumentId === options.instrumentId, 'trade_identity');
      const event = exactUInt(t.eventTimeNs, 'invalid_trade_clock');
      const available = exactUInt(t.availableAtNs, 'invalid_trade_clock');
      const receive = exactUInt(t.receiveTimeNs, 'invalid_trade_clock');
      requireThat(available >= receive, 'invalid_trade_clock');
      // Later knowledge does not participate in the selected replay frame or its dedupe.
      if (available > decision || event < start || event >= end || event > decision) continue;
      requireThat(Number.isSafeInteger(t.priceTicks) && t.priceTicks > 0 && ['buy', 'sell', 'unknown'].includes(t.aggressor), 'invalid_trade');
      quantity(t.size);
      const signature = JSON.stringify([t.priceTicks, t.size, t.aggressor, t.eventTimeNs, t.receiveTimeNs, t.availableAtNs]);
      if (ids.has(t.id)) { requireThat(ids.get(t.id) === signature, 'trade_revision_conflict'); continue; }
      ids.set(t.id, signature); accepted.push({ ...t, event });
    }
    // Preserve input source order for equal event times; JS stable sort is specified.
    accepted.sort((a, b) => a.event < b.event ? -1 : a.event > b.event ? 1 : 0);
    const bars = new Map(), profile = new Map();
    const add = (map, t) => {
      const cell = map.get(t.priceTicks) || { priceTicks: t.priceTicks, buy: 0, sell: 0, unknown: 0, total: 0 };
      cell[t.aggressor] = plusSafe(cell[t.aggressor], t.size); cell.total = plusSafe(cell.total, t.size);
      map.set(t.priceTicks, cell);
    };
    for (const t of accepted) {
      const at = start + (t.event - start) / interval * interval, key = at.toString();
      let bar = bars.get(key);
      if (!bar) { bar = { startNs: key, openTicks: t.priceTicks, highTicks: t.priceTicks,
        lowTicks: t.priceTicks, closeTicks: t.priceTicks, cells: new Map() }; bars.set(key, bar); }
      bar.highTicks = Math.max(bar.highTicks, t.priceTicks); bar.lowTicks = Math.min(bar.lowTicks, t.priceTicks);
      bar.closeTicks = t.priceTicks; add(bar.cells, t); add(profile, t);
    }
    let cvdKnown = 0, cumulativeUnknown = 0, observedVolume = 0;
    const output = [...bars.values()].map(bar => {
      const cells = [...bar.cells.values()].sort((a, b) => a.priceTicks - b.priceTicks);
      let buy = 0, sell = 0, unknown = 0, poc = null;
      for (const cell of cells) {
        buy = plusSafe(buy, cell.buy); sell = plusSafe(sell, cell.sell); unknown = plusSafe(unknown, cell.unknown);
        if (!poc || cell.total > poc.total) poc = cell; // ascending price wins a POC tie
        const lower = bar.cells.get(cell.priceTicks - 1), upper = bar.cells.get(cell.priceTicks + 1);
        cell.buyImbalance = options.coverage === 'complete' && cell.unknown === 0 && !!lower && lower.unknown === 0 && lower.sell > 0 && cell.buy >= minVolume && cell.buy >= ratio * lower.sell;
        cell.sellImbalance = options.coverage === 'complete' && cell.unknown === 0 && !!upper && upper.unknown === 0 && upper.buy > 0 && cell.sell >= minVolume && cell.sell >= ratio * upper.buy;
      }
      const total = plusSafe(plusSafe(buy, sell), unknown), deltaKnown = buy - sell;
      cvdKnown = plusSafe(cvdKnown, deltaKnown); cumulativeUnknown = plusSafe(cumulativeUnknown, unknown);
      observedVolume = plusSafe(observedVolume, total);
      return { ...bar, cells, buy, sell, unknown, total, deltaKnown,
        delta: unknown === 0 && options.coverage === 'complete' ? deltaKnown : null,
        cvdKnown, cvd: cumulativeUnknown === 0 && options.coverage === 'complete' ? cvdKnown : null,
        pocTicks: poc?.priceTicks ?? null };
    });
    return { status: options.coverage === 'complete' ? 'ok' : 'partial', coverage: options.coverage,
      sourceId: options.sourceId, contract: options.contract, sessionId: options.sessionId,
      windowStartNs: start.toString(), windowEndNs: end.toString(), decisionTimeNs: decision.toString(),
      intervalNs: interval.toString(), observedVolume, bars: output,
      volumeProfile: [...profile.values()].sort((a, b) => a.priceTicks - b.priceTicks),
      cvdBasis: 'selected_window_start', pocTieBreak: 'lower_price', imbalanceRatio: ratio, minImbalanceVolume: minVolume };
  } catch (error) { return { status: 'unavailable', reason: error instanceof Error ? error.message : 'invalid_input' }; }
}
module.exports = { FuturesMboBook, aggregateFootprint, FLAGS };

/**
 * Full-book time-weighted heat tiles over source-available state intervals.
 * Missing/stale/gap time is NOT zero depth. Means cover only observed duration;
 * every column retains its coverage fraction. No future-dependent normalization.
 */
function buildLiquidityTiles(samples, options) {
  try {
    requireThat(Array.isArray(samples) && object(options), 'invalid_input');
    const start = exactUInt(options.startNs, 'invalid_window'), end = exactUInt(options.endNs, 'invalid_window');
    const decision = exactUInt(options.decisionTimeNs, 'invalid_decision_clock');
    const interval = exactUInt(options.intervalNs, 'invalid_interval');
    const maxAge = exactUInt(options.maxAgeNs, 'invalid_age_limit');
    requireThat(end > start && end <= decision && interval > 0n, 'invalid_window');
    const lo = options.lowTick, hi = options.highTick;
    requireThat(Number.isSafeInteger(lo) && lo > 0 && Number.isSafeInteger(hi) && hi >= lo && hi - lo < 2048, 'invalid_price_window');
    const count = (end - start + interval - 1n) / interval;
    requireThat(count <= 4096n && count * BigInt(hi - lo + 1) <= 1000000n, 'tile_capacity');
    const timeline = [];
    for (const sample of samples) {
      requireThat(object(sample), 'invalid_sample');
      const at = exactUInt(sample.availableAtNs, 'invalid_availability');
      if (at > decision || at >= end) continue;
      requireThat(object(sample.view) && ['ok', 'unavailable'].includes(sample.view.status), 'invalid_sample');
      if (sample.view.status === 'ok') {
        const v = sample.view;
        requireThat(v.contract === options.contract && v.sessionId === options.sessionId &&
          v.publisherId === options.publisherId && v.instrumentId === options.instrumentId &&
          v.coverage === 'full_order_book' && v.liquidityScope === 'displayed_orders_excludes_implied' && v.availableAtNs === sample.availableAtNs &&
          Array.isArray(v.bids) && Array.isArray(v.asks), 'sample_identity_or_coverage');
        requireThat(exactUInt(v.receiveTimeNs, 'invalid_receive_clock') <= at, 'invalid_receive_clock');
        for (const side of [v.bids, v.asks]) {
          const seen = new Set();
          for (const level of side) {
            requireThat(object(level) && Number.isSafeInteger(level.priceTicks) && level.priceTicks > 0 &&
              Number.isSafeInteger(level.size) && level.size >= 0 && !seen.has(level.priceTicks), 'invalid_depth_level');
            seen.add(level.priceTicks);
          }
        }
      }
      requireThat(!timeline.length || at >= timeline[timeline.length - 1].at, 'sample_order');
      timeline.push({ at, view: sample.view });
    }
    const columns = Array.from({ length: Number(count) }, (_, i) => {
      const a = start + BigInt(i) * interval, b = a + interval < end ? a + interval : end;
      return { a, b, covered: 0n, bids: new Map(), asks: new Map() };
    });
    for (let n = 0; n < timeline.length; n++) {
      const item = timeline[n], v = item.view;
      if (v.status !== 'ok') continue;
      const expiry = exactUInt(v.receiveTimeNs, 'invalid_receive_clock') + maxAge;
      let from = item.at < start ? start : item.at;
      let until = n + 1 < timeline.length ? timeline[n + 1].at : end;
      if (until > end) until = end;
      if (until > expiry) until = expiry;
      while (from < until) {
        const col = columns[Number((from - start) / interval)];
        const stop = until < col.b ? until : col.b, duration = stop - from;
        col.covered += duration;
        for (const [levels, target] of [[v.bids, col.bids], [v.asks, col.asks]]) {
          for (const level of levels) if (level.priceTicks >= lo && level.priceTicks <= hi)
            target.set(level.priceTicks, (target.get(level.priceTicks) || 0n) + BigInt(level.size) * duration);
        }
        from = stop;
      }
    }
    return { status: 'ok', contract: options.contract, sessionId: options.sessionId,
      measure: 'time_weighted_resting_contracts_over_covered_duration',
      liquidityScope: 'displayed_orders_excludes_implied',
      lowTick: lo, highTick: hi, intervalNs: interval.toString(), columns: columns.map(col => ({
        startNs: col.a.toString(), endNs: col.b.toString(), coveredNs: col.covered.toString(),
        coverage: col.covered === 0n ? 'gap' : col.covered === col.b - col.a ? 'full' : 'partial',
        coverageFraction: Number(col.covered) / Number(col.b - col.a),
        levels: Array.from({ length: hi - lo + 1 }, (_, i) => ({ priceTicks: lo + i,
          bidMean: col.covered === 0n ? null : Number(col.bids.get(lo + i) || 0n) / Number(col.covered),
          askMean: col.covered === 0n ? null : Number(col.asks.get(lo + i) || 0n) / Number(col.covered),
        })),
      })) };
  } catch (error) { return { status: 'unavailable', reason: error instanceof Error ? error.message : 'invalid_input' }; }
}
module.exports.buildLiquidityTiles = buildLiquidityTiles;

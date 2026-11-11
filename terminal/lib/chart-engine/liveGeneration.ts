// Live-bar generation reducer (L01) — one accepted live tick produces exactly one generation,
// carried as in-place series mutations. Never a setData rebuild, never a per-tick series.
//
// ChartPanel already owns this law at the component level (§commitLiveBarGeneration): both accept
// paths (applyLiveSplice / applyIntradayLiveCandle) gate the packet, fold it into the developing
// bar, push ONE update() to the price series and then carry every follower in the same
// generation. This module is the chart-free core of that contract over the renderer-agnostic
// SeriesHandle, so the engine side can assert it without a component:
//
//   reduceLiveTick    — the pure decision: replay / stamp guards, then the fold, producing either
//                       a "none" op (with a reason) or exactly one inplace/append op plus the
//                       next state. The generation counter bumps EXACTLY once per non-"none" op
//                       (L01-A01). Quote-clock math (liveQuoteStamp / acceptsLiveTick) and bucket
//                       math (mutateLiveCandle) are DELEGATED to the existing libs — nothing here
//                       reimplements them.
//   applyLiveOp       — the thin applier: one update() on the price handle for the op, one
//                       update() per "inplace-series" derived handle whose recompute yields a
//                       row, and a deferredRebuild list of the "inplace-rebuild" keys for the
//                       owner to re-run on its own cadence. It never calls setData and never
//                       creates a series (L01-A02/A03): a per-tick rebuild would recreate panes
//                       and reset their sizing (see lib/liveBarProjection.ts).
//   liveStateFromRows — the initializer: seed the developing bar from the loaded row set's tail.
//
// Bar identity follows the canonical rule (lib/sessionBars.ts): a bar's `time` IS its opening
// instant — never its close, never the tick's own print. mutateLiveCandle keys a new bucket by
// its opening display-epoch (a 10:15 print on a 1h chart lands in the 09:30-anchored bucket), so
// an append op's bar time is the opening-bar key by construction.
//
// Scope: the intraday aggregate lane mutateLiveCandle serves. The daily/resampled splice path
// (spliceDaily + foldFinalBucket) keeps its own acceptance rules and is NOT re-modeled here; rows
// seeded with non-numeric (daily-string) times simply never fold — mutateLiveCandle refuses a
// non-finite tail time — and the owner keeps its existing daily path for those.

import type { EngineBar, EngineSeriesRow, EngineTime, SeriesHandle } from "./api";
import {
  LIVE_INPLACE_SERIES_KEYS,
  LIVE_REBUILD_KEYS,
  acceptsLiveTick,
  liveQuoteStamp,
  type AcceptedLiveTick,
} from "@/lib/liveBarProjection";
import { mutateLiveCandle, type LiveCandleBar, type LiveCandleQuote } from "@/lib/liveCandle";
import type { Market } from "@/lib/intradayShared";
import type { IndKey } from "@/lib/indicators";

/**
 * The developing bar with its volume — the one field the fold needs that a price series's
 * EngineBar row does not carry. Structurally an EngineBar (assignable anywhere an EngineBar is),
 * so the ops below satisfy the engine contract while keeping OHLCV complete.
 */
export type LiveBar = EngineBar & { volume: number };

/**
 * One row of the source bar set, in either spelling this app uses: the engine's
 * open/high/low/close/volume or the loader's o/h/l/c/v (ChartPanel's Bar). Where both are
 * present the engine spelling wins, deterministically.
 */
export type LiveSourceRow = {
  time: EngineTime;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  volume?: number;
  v?: number;
};

export interface LiveGenerationState {
  /** Bumped exactly once per applied (non-"none") op — the generation every follower reads. */
  generation: number;
  /**
   * Serialized `basis|stamp` of the last APPLIED tick; null before the first and while the lane
   * ships no usable clock. Only an APPLIED tick becomes the lane's floor: a refused tick must
   * not raise it, and neither may an accepted-but-unchanged one — else a corrected print under
   * the same instant could never land.
   */
  lastStamp: string | null;
  /** The developing bar (the tail of the owner's bar set), or null before any rows loaded. */
  liveBar: LiveBar | null;
  /** How many bars this reducer has appended since initialization. */
  appendedKeys: number;
  market: Market;
  cadenceSec: number;
}

export type LiveNoneReason =
  | "replay"
  | "stale"
  | "duplicate"
  | "no-candle-change";

export type LiveOp =
  | { kind: "none"; reason: LiveNoneReason }
  | { kind: "inplace"; bar: LiveBar }
  | { kind: "append"; bar: LiveBar; closedPrev: LiveBar | null };

export interface LiveTickOptions {
  /** Replay freezes the live path: a replayed window must never absorb a live quote. */
  replay?: boolean;
  /** U.S. extended-hours selection (passed through to mutateLiveCandle's lane choice). */
  extHours?: boolean;
}

export interface DerivedLiveSeries {
  /** A built-in indicator key, or any owner-local key the classification sets simply ignore. */
  key: string;
  series: SeriesHandle;
  /**
   * Recompute this key's row for the developing bar (the callback closes over whatever bar set
   * it needs). null = nothing to push for this tick; the handle is then left untouched.
   */
  recompute: (bar: LiveBar) => EngineSeriesRow | null;
}

export interface AppliedLiveOp {
  /** How many series.update() calls were made (a "none" op performs none). */
  mutations: number;
  /**
   * The "inplace-rebuild" keys found in `derived`, in the order given (the owner passes canonical
   * order). Their builders are re-run by the owner on its own cadence (ChartPanel's
   * runStudyInPlace); the live path must not touch them (L01-A02).
   */
  deferredRebuild: string[];
}

// ── stamp-key serialization ─────────────────────────────────────────────────────
// The state carries ONE string for the last applied tick's identity, so both facts acceptsLiveTick
// orders by (lane AND instant) have to live in it. `basis|stamp` splits on the LAST separator, so
// even a basis that itself contained a pipe round-trips. A null stamp has no key: an unstamped
// lane never raises a floor it cannot compare against.

const STAMP_SEP = "|";

function stampKeyOf(tick: AcceptedLiveTick): string | null {
  return tick.stamp == null ? null : `${tick.basis}${STAMP_SEP}${tick.stamp}`;
}

function tickOfStampKey(key: string | null): AcceptedLiveTick | null {
  if (key == null) return null;
  const cut = key.lastIndexOf(STAMP_SEP);
  if (cut < 0) return null;
  const stamp = Number(key.slice(cut + 1));
  return { basis: key.slice(0, cut), stamp: Number.isFinite(stamp) ? stamp : null };
}

// ── cadence → timeframe ─────────────────────────────────────────────────────────
// mutateLiveCandle parses a timeframe STRING (via tfSeconds's s/m/h grammar); the reducer is
// cadence-driven. The inverse below is exact for every whole-second cadence, and maps 0/invalid
// to "" — tfSeconds("") is 0, which makes bucketStart refuse, so a nonsense cadence folds to a
// "no-candle-change" none rather than guessing a bucket.

export function tfFromCadence(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

// ── spelling adapters (field names only — never math) ───────────────────────────

/** Normalize either row spelling to the developing bar. */
export function toLiveBar(row: LiveSourceRow): LiveBar {
  const pick = (engine: number | undefined, legacy: number | undefined): number =>
    typeof engine === "number" ? engine : typeof legacy === "number" ? legacy : 0;
  return {
    time: row.time,
    open: pick(row.open, row.o),
    high: pick(row.high, row.h),
    low: pick(row.low, row.l),
    close: pick(row.close, row.c),
    volume: pick(row.volume, row.v),
  };
}

/** Engine spelling → mutateLiveCandle's o/h/l/c/v spelling (its tail-time coercion included). */
function toCandleBar(bar: LiveBar): LiveCandleBar {
  return {
    time: typeof bar.time === "number" ? bar.time : Number(bar.time),
    o: bar.open,
    h: bar.high,
    l: bar.low,
    c: bar.close,
    v: bar.volume,
  };
}

// ── initializer ─────────────────────────────────────────────────────────────────

/**
 * Seed a reducer state from the bar set the owner already holds: the developing bar is the tail
 * row, the stamp floor is empty (no tick accepted yet), the generation counter starts at 0.
 * On a timeframe or market change the owner re-initializes from the new rows rather than folding
 * the new cadence against the old developing bar.
 */
export function liveStateFromRows(
  rows: readonly LiveSourceRow[],
  market: Market,
  cadenceSec: number,
): LiveGenerationState {
  const tail = rows.length ? rows[rows.length - 1] : null;
  return {
    generation: 0,
    lastStamp: null,
    liveBar: tail ? toLiveBar(tail) : null,
    appendedKeys: 0,
    market,
    cadenceSec,
  };
}

// ── the reducer ─────────────────────────────────────────────────────────────────

/**
 * Fold ONE live tick into the developing bar.
 *
 * Guard order: replay → per-lane ordering (a strictly older same-lane packet must not roll the
 * candle backwards) → exact-duplicate packet (an equal instant IS allowed through by
 * acceptsLiveTick — a corrected print may share it — so the dedup compares the whole basis|stamp
 * pair, and only against an APPLIED tick) → the fold itself, whose session/lane/bucket rules all
 * belong to mutateLiveCandle. A tick that survives everything mutates the developing bar in place
 * or appends exactly one bar keyed by its opening instant, and bumps the generation exactly once.
 * The tick shape is the quote lane's own packet (LiveCandleQuote): its AcceptedLiveTick is derived
 * inside exactly as ChartPanel derives it — `{ basis, stamp: liveQuoteStamp(q) }`.
 */
export function reduceLiveTick(
  state: LiveGenerationState,
  tick: LiveCandleQuote | null | undefined,
  nowUtcMs: number,
  market: Market,
  cadenceSec: number,
  opts?: LiveTickOptions,
): { state: LiveGenerationState; op: LiveOp } {
  // A refused tick leaves the reducer state untouched — same generation, same floor, same
  // developing bar. The config fields are adopted only when the caller actually changed them, so
  // the common refusal returns the identical object (an identity the owner can rely on).
  const refuse = (reason: LiveNoneReason): { state: LiveGenerationState; op: LiveOp } => ({
    state:
      state.market === market && state.cadenceSec === cadenceSec
        ? state
        : { ...state, market, cadenceSec },
    op: { kind: "none", reason },
  });

  if (opts?.replay) return refuse("replay");

  const next: AcceptedLiveTick = { basis: tick?.basis ?? "", stamp: liveQuoteStamp(tick, nowUtcMs) };
  if (!acceptsLiveTick(tickOfStampKey(state.lastStamp), next)) return refuse("stale");
  if (next.stamp != null && stampKeyOf(next) === state.lastStamp) return refuse("duplicate");

  const mutation =
    state.liveBar == null
      ? null
      : mutateLiveCandle(
          [toCandleBar(state.liveBar)],
          tick,
          tfFromCadence(cadenceSec),
          market,
          opts?.extHours ?? false,
        );
  if (!mutation) return refuse("no-candle-change");

  const bar = toLiveBar(mutation.bar);
  const lastStamp = stampKeyOf(next);
  if (mutation.kind === "tick") {
    return {
      state: { ...state, generation: state.generation + 1, lastStamp, liveBar: bar, market, cadenceSec },
      op: { kind: "inplace", bar },
    };
  }
  return {
    state: {
      ...state,
      generation: state.generation + 1,
      lastStamp,
      liveBar: bar,
      appendedKeys: state.appendedKeys + 1,
      market,
      cadenceSec,
    },
    op: { kind: "append", bar, closedPrev: state.liveBar },
  };
}

// ── the applier ─────────────────────────────────────────────────────────────────

/**
 * Push ONE generation of a live op onto the chart: a single update() on the price series — the
 * OHLC row for bar kinds, the close as the point value for the four value kinds, exactly like
 * ChartPanel's live push — then one update() per "inplace-series" derived handle. Keys in
 * LIVE_REBUILD_KEYS are returned untouched in `deferredRebuild` for the owner; render-pass and
 * not-bar-derived keys are ignored outright. Never setData, never a series lifecycle call: the
 * live path updates what exists (L01-A02/A03).
 */
export function applyLiveOp(
  series: SeriesHandle,
  op: LiveOp,
  derived: readonly DerivedLiveSeries[] = [],
): AppliedLiveOp {
  if (op.kind === "none") return { mutations: 0, deferredRebuild: [] };

  const deferredRebuild: string[] = [];
  let mutations = 0;

  series.update(
    series.kind === "candles" || series.kind === "bars"
      ? op.bar
      : { time: op.bar.time, value: op.bar.close },
  );
  mutations += 1;

  for (const d of derived) {
    if (LIVE_REBUILD_KEYS.includes(d.key as IndKey)) {
      deferredRebuild.push(d.key);
      continue;
    }
    if (!LIVE_INPLACE_SERIES_KEYS.has(d.key as IndKey)) continue; // render-pass / not-bar-derived / foreign
    const row = d.recompute(op.bar);
    if (row == null) continue;
    d.series.update(row);
    mutations += 1;
  }

  return { mutations, deferredRebuild };
}

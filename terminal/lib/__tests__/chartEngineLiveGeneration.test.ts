// Live-bar generation reducer + applier (L01) — the chart-free half of ChartPanel's
// §commitLiveBarGeneration contract, over the renderer-agnostic SeriesHandle.
//
//   reduceLiveTick: one accepted tick → exactly one inplace/append op → generation +1 (never on a
//     refusal); replay never folds; a duplicate or older same-lane stamp never repaints; the
//     bucket/OHLCV math itself belongs to mutateLiveCandle and is only asserted through it.
//   applyLiveOp: one update() on the price handle, one per "inplace-series" derived handle,
//     rebuild keys deferred to their owner — and never a setData or series creation anywhere.
//
// The reducer table deliberately reuses lib/liveCandle's own fixture convention (2026-08-07 EDT)
// so the bucket expectations here stay comparable with that suite's.

import { describe, expect, it, vi } from "vitest";
import type { EngineSeriesKind, SeriesHandle } from "@/lib/chart-engine/api";
import {
  applyLiveOp,
  liveStateFromRows,
  reduceLiveTick,
  tfFromCadence,
  type LiveBar,
  type LiveGenerationState,
  type LiveOp,
} from "@/lib/chart-engine/liveGeneration";
import { tfSeconds } from "@/lib/intradayShared";

// ── fixtures — same EDT convention as lib/liveCandle's own suite ────────────────
// 2026-08-07 is EDT (UTC-4): etMs() builds a true UTC instant, display() the exchange-local
// display epoch it maps to. The state seeds a 5s US chart whose developing bar opened 09:30:05.

const etMs = (h: number, m: number, s: number) => Date.UTC(2026, 7, 7, h + 4, m, s);
const display = (h: number, m: number, s: number) => Date.UTC(2026, 7, 7, h, m, s) / 1000;

function quote(second: number, close: number, patch: Record<string, unknown> = {}) {
  const start = etMs(9, 30, second);
  return {
    basis: "REALTIME",
    marketSession: "rth",
    last: close,
    ts: Math.floor((start + 999) / 1000),
    asOfMs: start + 999,
    tickOpen: close - 0.05,
    tickHigh: close + 0.1,
    tickLow: close - 0.1,
    tickClose: close,
    tickVol: 12,
    tickStartMs: start,
    tickEndMs: start + 999,
    ...patch,
  };
}

const state5s = (): LiveGenerationState =>
  liveStateFromRows([{ time: display(9, 30, 5), o: 100, h: 100.2, l: 99.9, c: 100.1, v: 40 }], "us", 5);

// ── liveStateFromRows — the initializer ─────────────────────────────────────────

describe("liveStateFromRows", () => {
  it("seeds the developing bar from the tail row, in the loader's o/h/l/c/v spelling", () => {
    const st = state5s();
    expect(st.generation).toBe(0);
    expect(st.lastStamp).toBeNull();
    expect(st.appendedKeys).toBe(0);
    expect(st.market).toBe("us");
    expect(st.cadenceSec).toBe(5);
    expect(st.liveBar).toEqual({
      time: display(9, 30, 5), open: 100, high: 100.2, low: 99.9, close: 100.1, volume: 40,
    });
  });

  it("accepts the engine's open/high/low/close/volume spelling too", () => {
    const st = liveStateFromRows(
      [{ time: display(9, 30, 5), open: 7, high: 9, low: 6, close: 8, volume: 11 }],
      "us",
      60,
    );
    expect(st.liveBar).toEqual({ time: display(9, 30, 5), open: 7, high: 9, low: 6, close: 8, volume: 11 });
    expect(st.cadenceSec).toBe(60);
  });

  it("leaves liveBar null for an empty row set, and an empty chart never starts from a tick", () => {
    const st = liveStateFromRows([], "crypto", 60);
    expect(st.liveBar).toBeNull();
    const r = reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "crypto", 60);
    expect(r.op).toEqual({ kind: "none", reason: "no-candle-change" });
    expect(r.state).toBe(st); // refused with nothing to fold onto
  });
});

// ── tfFromCadence — the exact inverse of tfSeconds's grammar ────────────────────

describe("tfFromCadence", () => {
  it("round-trips every canonical cadence through tfSeconds", () => {
    for (const sec of [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200]) {
      expect(tfSeconds(tfFromCadence(sec))).toBe(sec);
    }
    expect(tfFromCadence(5)).toBe("5s");
    expect(tfFromCadence(60)).toBe("1m");
    expect(tfFromCadence(3600)).toBe("1h");
  });
  it("maps a nonsense cadence to the timeframe bucketStart refuses", () => {
    expect(tfFromCadence(0)).toBe("");
    expect(tfFromCadence(-5)).toBe("");
    expect(tfFromCadence(Number.NaN)).toBe("");
  });
});

// ── reduceLiveTick — the guard table ────────────────────────────────────────────

describe("reduceLiveTick — replay", () => {
  it("never folds a live tick into a replayed window, whatever the packet", () => {
    const st = state5s();
    const r = reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "us", 5, { replay: true });
    expect(r.op).toEqual({ kind: "none", reason: "replay" });
    expect(r.state).toBe(st);
    expect(r.state.generation).toBe(0);
    expect(r.state.liveBar?.close).toBe(100.1); // the developing bar is untouched
  });
});

describe("reduceLiveTick — duplicate", () => {
  it("refuses an exact repeat of the last applied instant, without bumping the generation", () => {
    const st = state5s();
    const first = reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "us", 5);
    expect(first.op.kind).toBe("inplace");
    const dup = reduceLiveTick(first.state, quote(7, 100.5), etMs(9, 30, 8), "us", 5);
    expect(dup.op).toEqual({ kind: "none", reason: "duplicate" });
    expect(dup.state).toBe(first.state);
    expect(dup.state.generation).toBe(1);
  });
});

describe("reduceLiveTick — stale", () => {
  it("refuses a strictly older same-lane packet: it must not roll the candle backwards", () => {
    const st = state5s();
    const first = reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "us", 5);
    expect(first.op.kind).toBe("inplace");
    const older = reduceLiveTick(first.state, quote(3, 100.4), etMs(9, 30, 9), "us", 5);
    expect(older.op).toEqual({ kind: "none", reason: "stale" });
    expect(older.state).toBe(first.state);
    expect(older.state.liveBar?.close).toBe(100.5);
  });

  it("restarts the ordering on a lane change (a delayed fallback must not freeze the chart)", () => {
    const applied = reduceLiveTick(state5s(), quote(7, 100.5), etMs(9, 30, 8), "us", 5);
    expect(applied.op.kind).toBe("inplace");
    // Same lane ordering would refuse this (a quarter hour older); the lane change admits it.
    // The fold itself still refuses a non-REALTIME basis on a US chart — the point here is the
    // reason is the fold's, not "stale".
    const switched = reduceLiveTick(
      applied.state,
      quote(7, 100.5, { basis: "DELAYED_15M", asOfMs: etMs(9, 15, 8) }),
      etMs(9, 30, 9),
      "us",
      5,
    );
    expect(switched.op).toEqual({ kind: "none", reason: "no-candle-change" });
  });

  it("does not raise the stamp floor for a tick that changed nothing", () => {
    // stamp2 > stamp1 but identical OHLCV: refused by the fold, and lastStamp must stay at
    // stamp1 so a corrected print under stamp2's instant can still land afterwards.
    const applied = reduceLiveTick(state5s(), quote(7, 100.5), etMs(9, 30, 8), "us", 5);
    expect(applied.op.kind).toBe("inplace");
    const floor = applied.state.lastStamp;
    const unchanged = reduceLiveTick(
      applied.state,
      quote(7, 100.5, { asOfMs: etMs(9, 30, 9) }),
      etMs(9, 30, 10),
      "us",
      5,
    );
    expect(unchanged.op).toEqual({ kind: "none", reason: "no-candle-change" });
    expect(unchanged.state.lastStamp).toBe(floor);
    // stamp1 < stamp3 < stamp2, values moved: accepted — the floor was never stamp2.
    const between = reduceLiveTick(
      unchanged.state,
      quote(7, 100.6, { asOfMs: etMs(9, 30, 8) + 500 }),
      etMs(9, 30, 10),
      "us",
      5,
    );
    expect(between.op.kind).toBe("inplace");
    expect(between.state.generation).toBe(2);
  });
});

describe("reduceLiveTick — the fold's own refusals are delegated, not reimplemented", () => {
  it("refuses a delayed basis, an outside-session print, and an out-of-session bucket", () => {
    const st = state5s();
    const delayed = reduceLiveTick(st, quote(7, 101, { basis: "DELAYED_15M" }), etMs(9, 30, 8), "us", 5);
    expect(delayed.op).toEqual({ kind: "none", reason: "no-candle-change" });
    const afterHours = reduceLiveTick(st, quote(7, 101, { marketSession: "post" }), etMs(9, 30, 8), "us", 5);
    expect(afterHours.op).toEqual({ kind: "none", reason: "no-candle-change" });
    // 09:30:04 predates the seeded 09:30:05 bar — mutateLiveCandle refuses the older bucket.
    const preOpen = reduceLiveTick(st, quote(4, 101), etMs(9, 30, 8), "us", 5);
    expect(preOpen.op).toEqual({ kind: "none", reason: "no-candle-change" });
  });

  it("accepts an unstamped lane and keeps accepting it (no clock must not mean frozen)", () => {
    const st = state5s();
    const a = reduceLiveTick(st, quote(7, 100.5, { asOfMs: null, ts: null }), etMs(9, 30, 8), "us", 5);
    expect(a.op.kind).toBe("inplace");
    expect(a.state.lastStamp).toBeNull();
    const b = reduceLiveTick(a.state, quote(8, 100.6, { asOfMs: null, ts: null }), etMs(9, 30, 9), "us", 5);
    expect(b.op.kind).toBe("inplace"); // a second clockless packet is not a duplicate
    expect(b.state.generation).toBe(2);
  });
});

describe("reduceLiveTick — inplace", () => {
  it("mutates OHLCV of the developing bar inside its own window, bumps the generation once", () => {
    const st = state5s();
    const r = reduceLiveTick(
      st,
      quote(7, 100.5, { tickOpen: 100.3, tickHigh: 100.8, tickLow: 99.7 }),
      etMs(9, 30, 8),
      "us",
      5,
    );
    expect(r.op).toEqual({
      kind: "inplace",
      bar: { time: display(9, 30, 5), open: 100, high: 100.8, low: 99.7, close: 100.5, volume: 40 },
    });
    expect(r.state.generation).toBe(1);
    expect(r.state.appendedKeys).toBe(0);
    expect(r.state.liveBar).toEqual(r.op.kind === "inplace" ? r.op.bar : null);
    expect(r.state.lastStamp).toBe(`REALTIME|${etMs(9, 30, 7) + 999}`);
  });

  it("keys an hourly print to the 09:30-anchored bar: a 10:15 quote is INPLACE, not an append", () => {
    // The identity law: a bar's time is its OPENING instant. mutateLiveCandle anchors a 1h live
    // bucket at the session open, so the op must update the 09:30 bar in place.
    const st = liveStateFromRows(
      [{ time: display(9, 30, 0), o: 100, h: 101, l: 99, c: 100.2, v: 1000 }],
      "us",
      3600,
    );
    const r = reduceLiveTick(
      st,
      quote(0, 100.7, { tickStartMs: Date.UTC(2026, 7, 7, 14, 15, 0), tickEndMs: Date.UTC(2026, 7, 7, 14, 15, 0) + 999 }),
      Date.UTC(2026, 7, 7, 14, 16, 0),
      "us",
      3600,
    );
    expect(r.op.kind).toBe("inplace");
    expect(r.op.kind === "inplace" && r.op.bar.time).toBe(display(9, 30, 0));
    expect(r.state.appendedKeys).toBe(0);
  });
});

describe("reduceLiveTick — append", () => {
  it("appends one bar keyed by the new bucket's OPENING instant, finalizing the previous bar", () => {
    const st = state5s();
    // 09:30:12 print on a 5s cadence: the new bucket OPENS 09:30:10 — the bar's identity, not
    // the tick's own 09:30:12 instant.
    const r = reduceLiveTick(
      st,
      quote(12, 99.8, { tickOpen: 99.75, tickHigh: 99.9, tickLow: 99.7 }),
      etMs(9, 30, 13),
      "us",
      5,
    );
    expect(r.op.kind).toBe("append");
    if (r.op.kind !== "append") return;
    expect(r.op.bar).toEqual({
      time: display(9, 30, 10), open: 99.75, high: 99.9, low: 99.7, close: 99.8, volume: 12,
    });
    // the finalized previous bar is handed back for the owner's bookkeeping
    expect(r.op.closedPrev).toEqual({
      time: display(9, 30, 5), open: 100, high: 100.2, low: 99.9, close: 100.1, volume: 40,
    });
    expect(r.state.generation).toBe(1);
    expect(r.state.appendedKeys).toBe(1);
    expect(r.state.liveBar).toEqual(r.op.bar);
  });

  it("chains: the next tick folds onto the appended bar in its own window", () => {
    const first = reduceLiveTick(
      state5s(),
      quote(12, 99.8, { tickOpen: 99.75, tickHigh: 99.9, tickLow: 99.7 }),
      etMs(9, 30, 13),
      "us",
      5,
    );
    const second = reduceLiveTick(first.state, quote(13, 100.4), etMs(9, 30, 14), "us", 5);
    expect(second.op.kind).toBe("inplace");
    expect(second.op.kind === "inplace" && second.op.bar.time).toBe(display(9, 30, 10));
    expect(second.state.generation).toBe(2);
    expect(second.state.appendedKeys).toBe(1); // an in-place update never inflates the key count
  });
});

// ── L01-A01: the generation counter is the whole point ──────────────────────────

describe("reduceLiveTick — generation counting (L01-A01)", () => {
  it("bumps exactly once per applied op and never for a refused one", () => {
    let st = state5s();
    const feed: { q: ReturnType<typeof quote>; opts?: { replay: boolean }; want: string }[] = [
      { q: quote(7, 100.5), want: "inplace" },        // gen 1
      { q: quote(7, 100.5), want: "none/duplicate" },  // refused
      { q: quote(3, 100.4), want: "none/stale" },      // refused
      { q: quote(8, 100.6), want: "inplace" },         // gen 2
      { q: quote(7, 100.5), want: "none/stale" },      // older than the applied :8 floor
      { q: quote(12, 99.8), want: "append" },          // gen 3
    ];
    const expectGen = [1, 1, 1, 2, 2, 3];
    feed.forEach(({ q, opts }, i) => {
      const r = reduceLiveTick(st, q, etMs(9, 30, 20), "us", 5, opts);
      st = r.state;
      expect(`${r.op.kind}${r.op.kind === "none" ? `/${r.op.reason}` : ""}`).toBe(feed[i].want);
      expect(st.generation).toBe(expectGen[i]);
    });
    expect(st.appendedKeys).toBe(1);
  });
});

describe("reduceLiveTick — purity", () => {
  it("never mutates the input state", () => {
    const st = state5s();
    const before = structuredClone(st);
    reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "us", 5);
    reduceLiveTick(st, quote(12, 99.8), etMs(9, 30, 13), "us", 5);
    reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "us", 5, { replay: true });
    expect(st).toEqual(before);
  });
});

// ── applyLiveOp — the applier over SeriesHandle ─────────────────────────────────

type SpyHandle = SeriesHandle & {
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function spyHandle(kind: EngineSeriesKind): SpyHandle {
  return {
    kind,
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    setMarkers: vi.fn(),
    createPriceLine: vi.fn(),
    priceToCoordinate: vi.fn(() => null),
    coordinateToPrice: vi.fn(() => null),
    paneIndex: vi.fn(() => 0),
  } as unknown as SpyHandle;
}

const inplaceBar: LiveBar = {
  time: display(9, 30, 5), open: 100, high: 100.8, low: 99.7, close: 100.5, volume: 40,
};
const INPLACE_BAR: LiveOp = { kind: "inplace", bar: inplaceBar };

describe("applyLiveOp — a \"none\" op touches nothing", () => {
  it("performs zero mutations and defers nothing", () => {
    const price = spyHandle("candles");
    const ema = spyHandle("line");
    const out = applyLiveOp(price, { kind: "none", reason: "stale" }, [
      { key: "ema", series: ema, recompute: vi.fn() },
    ]);
    expect(out).toEqual({ mutations: 0, deferredRebuild: [] });
    expect(price.update).not.toHaveBeenCalled();
    expect(ema.update).not.toHaveBeenCalled();
  });
});

describe("applyLiveOp — the price series gets exactly one update, and never a setData", () => {
  it("pushes the OHLC row once on a bar-kind series", () => {
    const price = spyHandle("candles");
    const out = applyLiveOp(price, INPLACE_BAR);
    expect(out.mutations).toBe(1);
    expect(price.update).toHaveBeenCalledTimes(1);
    expect(price.update).toHaveBeenCalledWith(inplaceBar);
    expect(price.setData).not.toHaveBeenCalled();
  });

  it("maps to the close point for every value kind (all six series kinds are first-class)", () => {
    for (const kind of ["line", "area", "histogram", "baseline"] as EngineSeriesKind[]) {
      const price = spyHandle(kind);
      const out = applyLiveOp(price, INPLACE_BAR);
      expect(out.mutations).toBe(1);
      expect(price.update).toHaveBeenCalledTimes(1);
      expect(price.update).toHaveBeenCalledWith({ time: inplaceBar.time, value: inplaceBar.close });
      expect(price.setData).not.toHaveBeenCalled();
    }
  });

  it("pushes the appended bar once on an append op", () => {
    const price = spyHandle("bars");
    const appended: LiveBar = {
      time: display(9, 30, 10), open: 99.75, high: 99.9, low: 99.7, close: 99.8, volume: 12,
    };
    const out = applyLiveOp(price, { kind: "append", bar: appended, closedPrev: null });
    expect(out.mutations).toBe(1);
    expect(price.update).toHaveBeenCalledTimes(1);
    expect(price.update).toHaveBeenCalledWith(appended);
    expect(price.setData).not.toHaveBeenCalled();
  });
});

describe("applyLiveOp — derived series routing (L01-A02)", () => {
  const row = { time: display(9, 30, 5), value: 3 };

  it("updates an inplace-series key exactly once with its recomputed row", () => {
    const price = spyHandle("candles");
    const ema = spyHandle("line");
    const recompute = vi.fn(() => row);
    const out = applyLiveOp(price, INPLACE_BAR, [{ key: "ema", series: ema, recompute }]);
    expect(out.mutations).toBe(2); // price + ema
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(recompute).toHaveBeenCalledWith(inplaceBar);
    expect(ema.update).toHaveBeenCalledTimes(1);
    expect(ema.update).toHaveBeenCalledWith(row);
    expect(ema.setData).not.toHaveBeenCalled();
  });

  it("leaves an inplace-series handle untouched when its recompute yields nothing", () => {
    const price = spyHandle("candles");
    const rsi = spyHandle("line");
    const out = applyLiveOp(price, INPLACE_BAR, [
      { key: "rsi", series: rsi, recompute: () => null },
    ]);
    expect(out.mutations).toBe(1); // price only
    expect(rsi.update).not.toHaveBeenCalled();
    expect(rsi.setData).not.toHaveBeenCalled();
  });

  it("defers rebuild keys without touching their series or running their math", () => {
    const price = spyHandle("candles");
    const ichimoku = spyHandle("line");
    const adx = spyHandle("line");
    const recompute = vi.fn(() => row);
    const out = applyLiveOp(price, INPLACE_BAR, [
      { key: "ichimoku", series: ichimoku, recompute },
      { key: "adx", series: adx, recompute },
    ]);
    expect(out.mutations).toBe(1); // the price series alone
    expect(out.deferredRebuild).toEqual(["ichimoku", "adx"]); // owner order preserved
    expect(recompute).not.toHaveBeenCalled();
    expect(ichimoku.update).not.toHaveBeenCalled();
    expect(adx.update).not.toHaveBeenCalled();
    expect(ichimoku.setData).not.toHaveBeenCalled();
  });

  it("ignores render-pass, not-bar-derived and owner-local keys outright", () => {
    const price = spyHandle("candles");
    const gaps = spyHandle("line");
    const optlevels = spyHandle("line");
    const pine = spyHandle("line");
    const out = applyLiveOp(price, INPLACE_BAR, [
      { key: "gaps", series: gaps, recompute: vi.fn(() => row) },
      { key: "optlevels", series: optlevels, recompute: vi.fn(() => row) },
      { key: "pineCustom", series: pine, recompute: vi.fn(() => row) },
    ]);
    expect(out.mutations).toBe(1);
    expect(out.deferredRebuild).toEqual([]);
    for (const s of [gaps, optlevels, pine]) {
      expect(s.update).not.toHaveBeenCalled();
      expect(s.setData).not.toHaveBeenCalled();
    }
  });
});

// ── end to end: one accepted tick → one op → one set of updates ────────────────

describe("one accepted live tick → one commitLiveBarGeneration's worth of writes", () => {
  it("a tick that survives the guards produces exactly one price update and no rebuild", () => {
    let st = state5s();
    const price = spyHandle("candles");
    const ema = spyHandle("line");
    const ichimoku = spyHandle("line");

    const refused = reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "us", 5, { replay: true });
    expect(applyLiveOp(price, refused.op, [
      { key: "ema", series: ema, recompute: () => ({ time: refused.state.liveBar!.time, value: 1 }) },
      { key: "ichimoku", series: ichimoku, recompute: () => ({ time: 0, value: 2 }) },
    ]).mutations).toBe(0);

    const accepted = reduceLiveTick(st, quote(7, 100.5), etMs(9, 30, 8), "us", 5);
    st = accepted.state;
    const applied = applyLiveOp(price, accepted.op, [
      { key: "ema", series: ema, recompute: (bar) => ({ time: bar.time, value: bar.close }) },
      { key: "ichimoku", series: ichimoku, recompute: () => ({ time: 0, value: 2 }) },
    ]);
    expect(st.generation).toBe(1);
    expect(applied.mutations).toBe(2);
    expect(applied.deferredRebuild).toEqual(["ichimoku"]);
    expect(price.update).toHaveBeenCalledTimes(1);
    expect(ema.update).toHaveBeenCalledTimes(1);
    expect(ichimoku.update).not.toHaveBeenCalled();
    for (const s of [price, ema, ichimoku]) expect(s.setData).not.toHaveBeenCalled();
  });
});

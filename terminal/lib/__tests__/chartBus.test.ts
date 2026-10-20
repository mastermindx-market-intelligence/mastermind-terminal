import { describe, it, expect } from "vitest";
import {
  isV2Envelope, validateEnvelope, translate, applyToStore, atr, fitMetrics, CommandQueue,
  cleanCaption, AI_OBJECT_CAP, BATCH_OP_CAP, CAPTION_MAX,
  type ChartCommandV2, type AiObject,
} from "@/lib/chartBus";

// Capabilities used across tests — the REAL enum shape the Terminal reports.
const CAPS = {
  tfs: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "D", "2D", "3D", "W", "2W", "1M", "3M"],
  indicators: ["ema", "bb", "vwap", "vol", "rsi", "stochrsi", "macd"],
};

// A helper to build a valid-ish envelope with overrides.
function env(over: Partial<ChartCommandV2> & Record<string, unknown> = {}): unknown {
  return { on: true, v: 2, batch_id: "b_1", seq: 1, op: "draw.hline", id: "ai_1", args: { p: 100 },
    target: { schema: "chart.command_target.v1", origin_id: "unit-origin", context_revision: 1,
      pane_id: 0, symbol: "NVDA", tf: "D" }, ...over };
}

// Validate + translate + apply a command against a store; returns {store, ack, res}.
function run(store: Record<string, AiObject[]>, sym: string, j: unknown) {
  const v = validateEnvelope(j);
  if (!v.ok) return { store, ack: { ok: false, error: v.error }, applied: null } as const;
  const res = translate(v.cmd, CAPS);
  const out = applyToStore(store, sym, v.cmd, res);
  return { store: out.store, ack: out.ack, res, applied: out } as const;
}

describe("v1/v2 discrimination", () => {
  it("v1 envelope (no v:2) is NOT a v2 envelope — falls through to the legacy dispatcher", () => {
    // the actual Terminal v1 shape: {action, symbol|tf|indicator+on|kind}
    expect(isV2Envelope({ action: "set_symbol", symbol: "NVDA" })).toBe(false);
    expect(isV2Envelope({ on: true, symbol: "NVDA" })).toBe(false); // v1-ish annotate/command, no v:2
    expect(isV2Envelope({ on: true, v: 2, batch_id: "b", seq: 1, op: "ai.clear" })).toBe(true);
  });
});

describe("envelope validation (rejected ack, never crash)", () => {
  it("non-object → reject", () => {
    const v = validateEnvelope(null);
    expect(v.ok).toBe(false);
  });
  it("unknown op → reject with unknown_op", () => {
    const v = validateEnvelope(env({ op: "draw.frobnicate" as any }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe("unknown_op");
  });
  it("draw op without an ai_* id → reject", () => {
    const v = validateEnvelope(env({ op: "draw.hline", id: "u_9" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe("bad_id_namespace");
  });
  it("a non-ai id anywhere → reject", () => {
    const v = validateEnvelope(env({ op: "ai.clear", id: "hax" }));
    expect(v.ok).toBe(false);
  });
  it("missing batch_id / seq → reject", () => {
    expect(validateEnvelope(env({ batch_id: undefined as any })).ok).toBe(false);
    expect(validateEnvelope(env({ seq: undefined as any })).ok).toBe(false);
  });
  it("malformed args → reject with an ack error, never throws", () => {
    // hline with a non-positive price
    const r = run({}, "NVDA", env({ op: "draw.hline", args: { p: -5 } }));
    expect(r.ack.ok).toBe(false);
    // trendline missing p2
    const r2 = run({}, "NVDA", env({ op: "draw.trendline", args: { p1: { t: 1721606400, p: 100 } } }));
    expect(r2.ack.ok).toBe(false);
  });
  it("insane epoch (ms instead of seconds) → rejected", () => {
    const r = run({}, "NVDA", env({ op: "draw.hline", args: { p: 100, at: 1721606400000 } }));
    // `at` is out of the sane-seconds band → falls back to now(), price still valid → ok. But a point
    // with a ms time on a trendline is rejected:
    const r2 = run({}, "NVDA", env({ op: "draw.trendline", args: { p1: { t: 1721606400000, p: 100 }, p2: { t: 1721606400, p: 90 } } }));
    expect(r2.ack.ok).toBe(false);
    void r;
  });
});

describe("chart.* ops reject hallucinated enums", () => {
  it("unknown timeframe → reject", () => {
    const r = run({}, "NVDA", env({ op: "chart.set_tf", id: undefined as any, args: { tf: "7D" } }));
    expect(r.ack.ok).toBe(false);
    if (!r.ack.ok) expect((r.ack as any).error).toBe("unknown_tf");
  });
  it("known timeframe → ok, emits a setTf effect", () => {
    const v = validateEnvelope(env({ op: "chart.set_tf", id: undefined as any, args: { tf: "1D".replace("1D", "D") } }));
    expect(v.ok).toBe(true);
    if (v.ok) { const out = applyToStore({}, "NVDA", v.cmd, translate(v.cmd, CAPS)); expect(out.ack.ok).toBe(true); expect(out.effect).toEqual({ kind: "setTf", tf: "D" }); }
  });
  it("unknown indicator → reject", () => {
    const r = run({}, "NVDA", env({ op: "chart.set_indicators", id: undefined as any, args: { indicators: [{ name: "supertrend_x" }] } }));
    expect(r.ack.ok).toBe(false);
  });
  it("set_symbol emits a setSymbol effect and does not touch the store", () => {
    const r = run({ NVDA: [] }, "NVDA", env({ op: "chart.set_symbol", id: undefined as any, args: { symbol: "AAPL" } }));
    expect(r.ack.ok).toBe(true);
    expect(r.applied?.effect).toEqual({ kind: "setSymbol", symbol: "AAPL" });
  });
});

describe("draw.* translation → tagged ai objects", () => {
  it("trendline produces one ai object anchored at both points", () => {
    const r = run({}, "NVDA", env({ op: "draw.trendline", id: "ai_tl_1", args: { p1: { t: 1721606400, p: 118.42 }, p2: { t: 1737244800, p: 96.1 }, style: { kind: "solid", width: 2 }, text: "Rising support" } }));
    expect(r.ack.ok).toBe(true);
    const objs = r.store.NVDA;
    expect(objs).toHaveLength(1);
    expect(objs[0].id).toBe("ai_tl_1");
    expect(objs[0].by).toBe("ai");
    expect(objs[0].kind).toBe("trendline");
    expect(objs[0].dash).toBe("solid");
    expect(objs[0].width).toBe(2);
    expect(objs[0].meta).toMatchObject({ by: "ai", label: "Rising support" });
    expect(objs[0].points.map((p) => Number(p.t))).toEqual([1721606400, 1737244800]);
  });
  it("channel produces two objects sharing the base id (+_u/_l)", () => {
    const a = { u1: { t: 1721606400, p: 120 }, u2: { t: 1737244800, p: 130 }, l1: { t: 1721606400, p: 110 }, l2: { t: 1737244800, p: 118 } };
    const r = run({}, "NVDA", env({ op: "draw.channel", id: "ai_ch", args: a }));
    expect(r.ack.ok).toBe(true);
    expect(r.store.NVDA.map((o) => o.id).sort()).toEqual(["ai_ch_l", "ai_ch_u"]);
  });
  it("path produces N-1 segments", () => {
    const pts = [{ t: 1700000000, p: 10 }, { t: 1710000000, p: 20 }, { t: 1720000000, p: 15 }];
    const r = run({}, "NVDA", env({ op: "draw.path", id: "ai_p", args: { points: pts } }));
    expect(r.store.NVDA).toHaveLength(2);
  });
  it("risk_box produces a rect and (with target) a target hline", () => {
    const r = run({}, "NVDA", env({ op: "draw.risk_box", id: "ai_rb", args: { entry: 100, stop: 95, target: 115 } }));
    expect(r.store.NVDA.map((o) => o.kind).sort()).toEqual(["hline", "rect"]);
  });
  it("every AI object id is ai_* namespaced", () => {
    const r = run({}, "NVDA", env({ op: "draw.zone", id: "ai_z", args: { p_lo: 90, p_hi: 100 } }));
    for (const o of r.store.NVDA) expect(o.id.startsWith("ai_")).toBe(true);
  });
});

describe("ai.clear / ai.undo never mutate by:user objects", () => {
  // The store holds ONLY ai objects; user drawings live in a separate store (drawStore). So ai.clear
  // clearing the ai store cannot, by construction, touch any by:user object. We also verify the
  // reducer never emits a user-store effect.
  it("ai.clear empties the AI store for the active symbol only", () => {
    const store: Record<string, AiObject[]> = {
      NVDA: [{ id: "ai_1", by: "ai", op: "draw.hline", batch_id: "b1", seq: 1, kind: "hline", points: [{ t: "1", p: 1 }] } as AiObject],
      AAPL: [{ id: "ai_2", by: "ai", op: "draw.hline", batch_id: "b2", seq: 1, kind: "hline", points: [{ t: "1", p: 1 }] } as AiObject],
    };
    const r = run(store, "NVDA", env({ op: "ai.clear", id: undefined as any }));
    expect(r.ack.ok).toBe(true);
    expect(r.store.NVDA).toEqual([]);
    expect(r.store.AAPL).toHaveLength(1); // other symbol untouched
    expect(r.applied?.effect).toBeNull(); // no user-store side effect
  });
  it("ai.undo{n} drops the n most-recent batches", () => {
    const mk = (id: string, b: string): AiObject => ({ id, by: "ai", op: "draw.hline", batch_id: b, seq: 1, kind: "hline", points: [{ t: "1", p: 1 }] } as AiObject);
    const store = { NVDA: [mk("ai_a", "b1"), mk("ai_b", "b2"), mk("ai_c", "b2"), mk("ai_d", "b3")] };
    const r = run(store, "NVDA", env({ op: "ai.undo", id: undefined as any, args: { n: 1 } }));
    expect(r.store.NVDA.map((o) => o.id)).toEqual(["ai_a", "ai_b", "ai_c"]); // dropped b3
    const r2 = run(store, "NVDA", env({ op: "ai.undo", id: undefined as any, args: { n: 2 } }));
    expect(r2.store.NVDA.map((o) => o.id)).toEqual(["ai_a"]); // dropped b3 + b2
  });
});

describe("caps enforced with ack errors (never silent-drop)", () => {
  it("per-batch cap → object_cap or batch_cap error", () => {
    let store: Record<string, AiObject[]> = {};
    // add BATCH_OP_CAP hlines in the same batch — the (cap+1)th rejects.
    for (let i = 0; i < BATCH_OP_CAP; i++) {
      const r = run(store, "NVDA", env({ op: "draw.hline", id: `ai_${i}`, batch_id: "bx", seq: i, args: { p: 100 + i } }));
      expect(r.ack.ok).toBe(true);
      store = r.store;
    }
    const over = run(store, "NVDA", env({ op: "draw.hline", id: "ai_over", batch_id: "bx", seq: 99, args: { p: 200 } }));
    expect(over.ack.ok).toBe(false);
    if (!over.ack.ok) expect((over.ack as any).error).toBe("batch_cap_exceeded");
    expect(store.NVDA).toHaveLength(BATCH_OP_CAP); // nothing silently dropped or added
  });
  it("total object cap → object_cap_exceeded", () => {
    let store: Record<string, AiObject[]> = {};
    // fill to the total cap across many batches (each batch < BATCH_OP_CAP).
    for (let i = 0; i < AI_OBJECT_CAP; i++) {
      const r = run(store, "NVDA", env({ op: "draw.hline", id: `ai_${i}`, batch_id: `b_${Math.floor(i / 10)}`, seq: i, args: { p: 100 + i } }));
      expect(r.ack.ok).toBe(true);
      store = r.store;
    }
    expect(store.NVDA).toHaveLength(AI_OBJECT_CAP);
    const over = run(store, "NVDA", env({ op: "draw.hline", id: "ai_over", batch_id: "b_last", seq: 999, args: { p: 999 } }));
    expect(over.ack.ok).toBe(false);
    if (!over.ack.ok) expect((over.ack as any).error).toBe("object_cap_exceeded");
  });
  it("re-using an ai_* id updates in place and does NOT count as a new object", () => {
    let store: Record<string, AiObject[]> = {};
    const r1 = run(store, "NVDA", env({ op: "draw.hline", id: "ai_x", batch_id: "b1", seq: 1, args: { p: 100 } }));
    store = r1.store;
    const r2 = run(store, "NVDA", env({ op: "draw.hline", id: "ai_x", batch_id: "b2", seq: 1, args: { p: 105 } }));
    expect(r2.store.NVDA).toHaveLength(1);
    expect(r2.store.NVDA[0].points[0].p).toBe(105);
  });
});

describe("caption sanitization", () => {
  it("clamps to CAPTION_MAX and strips control chars", () => {
    const long = "x".repeat(200);
    expect(cleanCaption(long)!.length).toBe(CAPTION_MAX);
    expect(cleanCaption("line1\nline2\ttab")).toBe("line1 line2 tab");
    expect(cleanCaption(123 as any)).toBeUndefined();
  });
});

describe("ATR(14) + fit metrics on a synthetic series", () => {
  // Build a flat series that repeatedly touches a horizontal line at p=100.
  const bars = Array.from({ length: 30 }, (_, i) => ({
    time: 1700000000 + i * 86400,
    o: 100, c: 100,
    h: 100.5 + (i % 2 === 0 ? 0.3 : 0), // highs straddle 100 within a tight band
    l: 99.5 - (i % 2 === 0 ? 0.3 : 0),
  }));

  it("atr is positive and finite for a nontrivial series", () => {
    const a = atr(bars, 14);
    expect(a).toBeGreaterThan(0);
    expect(Number.isFinite(a)).toBe(true);
  });

  it("atr mirrors the gateway's Wilder smoothing (seed = mean of first 14 TRs, bar-0 TR = h−l)", () => {
    // TRs alternate 1.6 (even bars: high 100.8, low 99.2 vs prior close 100) and 1.0 (odd bars: high
    // 100.5, low 99.5). Wilder smoothing (seed = mean of first 14, then prev=(prev·13+TR)/14) converges
    // to ≈1.2923 here — distinct from the plain last-14 SMA (≈1.30) the code used before this fix.
    // Byte-for-byte cross-checked against the gateway's chart_perception._atr_series. Guards the port.
    expect(atr(bars, 14)).toBeCloseTo(1.292284, 5);
  });

  it("an hline at 100 is touched by every bar whose [l,h] straddles it", () => {
    const fit = fitMetrics({ kind: "hline", points: [{ t: "1700000000", p: 100 }] }, bars);
    expect(fit).not.toBeNull();
    expect(fit!.touches).toBe(30); // every bar's [l,h] contains 100
    // max_dev_atr = worst band-discounted violation THROUGH the line. Even bars' lows dip to 99.2,
    // i.e. 0.8 below a support line at 100; minus the 0.5×ATR (=0.65) band → 0.15, /ATR(1.3) ≈ 0.119.
    expect(fit!.max_dev_atr).toBeCloseTo(0.119, 3);
  });

  it("an hline far ABOVE a series it never violates does NOT inflate max_dev_atr", () => {
    // Price sits far below the line and never closes through it. Closes are all below 130 → the line
    // reads as resistance, and no high pokes above it → max_dev_atr must be 0 (the natural distance
    // BELOW an un-violated resistance line is not a violation). This is the ruling's core semantic.
    const fit = fitMetrics({ kind: "hline", points: [{ t: "1700000000", p: 130 }] }, bars);
    expect(fit).not.toBeNull();
    expect(fit!.touches).toBe(0);
    expect(fit!.max_dev_atr).toBe(0);
  });

  it("a close cleanly THROUGH a respected support line DOES register as max_dev_atr", () => {
    // A support line at 100 respected for 29 bars — price rides ABOVE it (closes at 101, dips only to
    // ~100), so the close distribution reads the line as support (29 above, 1 below). On the last bar
    // price breaks and closes hard through it (low 96, close 96) — a genuine violation. Contrast the
    // "rally far ABOVE, never violates" case above, which stays 0: here the wrong-side penetration
    // must register clearly. Byte-cross-checked against the gateway → max_dev_atr ≈ 1.249.
    const support = Array.from({ length: 30 }, (_, i) =>
      i === 29
        ? { time: 1700000000 + i * 86400, o: 101, c: 96, h: 101.2, l: 96 } // break: closes below
        : {
            time: 1700000000 + i * 86400, o: 101, c: 101, // respected: rides above, closes at 101
            h: 101.8 + (i % 2 === 0 ? 0.3 : 0),
            l: 100.0 - (i % 2 === 0 ? 0.2 : 0),
          },
    );
    const fit = fitMetrics({ kind: "hline", points: [{ t: "1700000000", p: 100 }] }, support);
    expect(fit).not.toBeNull();
    expect(fit!.max_dev_atr).toBeCloseTo(1.249, 3);
    // and it dwarfs the incidental within-band wick-poke of the un-broken respected case.
    expect(fit!.max_dev_atr).toBeGreaterThan(1);
  });

  it("a horizontal trendline counts touches only within its time segment", () => {
    // line from (bar0, 100) to (bar10, 100) — horizontal segment over the first 11 bars.
    const fit = fitMetrics({ kind: "trendline", points: [{ t: "1700000000", p: 100 }, { t: String(1700000000 + 10 * 86400), p: 100 }] }, bars);
    expect(fit).not.toBeNull();
    expect(fit!.touches).toBe(11); // bars 0..10 inclusive
    expect(fit!.max_dev_atr).toBeCloseTo(0.119, 3); // same band-discounted dip as the hline case
  });

  it("returns null for an unsupported kind", () => {
    expect(fitMetrics({ kind: "text", points: [{ t: "1", p: 1 }] }, bars)).toBeNull();
  });
});

describe("CommandQueue pacing", () => {
  it("with delay 0 applies synchronously and emits step events in order", () => {
    const q = new CommandQueue(0);
    const seen: string[] = [];
    q.on((s) => seen.push(s.id ?? ""));
    for (let i = 0; i < 5; i++) {
      q.enqueue(() => ({ op: "draw.hline", id: `ai_${i}`, ok: true }));
    }
    expect(seen).toEqual(["ai_0", "ai_1", "ai_2", "ai_3", "ai_4"]);
    expect(q.size).toBe(0);
  });

  it("applyInstantly drains a paced queue immediately", () => {
    const q = new CommandQueue(10_000); // 10s pace — would not fire during the test
    const seen: string[] = [];
    q.on((s) => seen.push(s.id ?? ""));
    q.enqueue(() => ({ op: "draw.hline", id: "ai_a", ok: true }));
    q.enqueue(() => ({ op: "draw.hline", id: "ai_b", ok: true }));
    // first job may be scheduled behind the timer; drain everything now.
    q.applyInstantly();
    expect(seen).toContain("ai_a");
    expect(seen).toContain("ai_b");
    expect(q.size).toBe(0);
  });
});

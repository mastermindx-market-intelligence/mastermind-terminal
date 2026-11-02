"use client";
// CMX W3 dev harness — /dev/theater. Env-free (no Supabase), NOT under the authed /terminal layout.
//
// The live /terminal 500s locally without Supabase env, so this page is the verification + future
// regression stage for the Conductor overlay. It mounts:
//   • a synthetic candlestick SVG of ~120 generated OHLC bars (the visual backdrop),
//   • a synthetic DrawLayer that renders bus-produced AI objects with the REAL CMX enter-classes
//     (so the stroke-and-caption cadence is visible exactly as it renders in ChartPanel's DrawLayer),
//   • the REAL ChartConductor, driven by the REAL chartBus CommandQueue.
// "Play demo" feeds a scripted v2 batch (set_tf → 2 trendlines w/ fit acks → zone → fib → 2 labels →
// done) through the real queue + validate/translate/applyToStore pipeline — the same path the Brain
// drives in production. Toggles: reduced-motion (.cmx-rm) and a 390px frame for the narrow check.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";
import ChartConductor from "@/components/ChartConductor";
import {
  CommandQueue, validateEnvelope, translate, applyToStore, fitMetrics,
  type AiObject, type ChartCommandV2, type QueueStep,
} from "@/lib/chartBus";
import { setActivePaneCoords } from "@/lib/paneCoords";
import type { Drawing, Pt } from "@/lib/drawings";

// ── synthetic OHLC series (deterministic; ~120 daily bars) ───────────────────────────────────────
type Bar = { time: string; o: number; h: number; l: number; c: number };
function genBars(n = 120): Bar[] {
  const bars: Bar[] = [];
  let px = 180;
  const start = Math.floor(Date.UTC(2024, 0, 2) / 1000);
  for (let i = 0; i < n; i++) {
    // deterministic pseudo-random walk (no Math.random → stable screenshots)
    const wob = Math.sin(i * 0.5) * 1.4 + Math.cos(i * 0.17) * 2.6 + (i % 7 === 0 ? 3 : 0);
    const o = px;
    const c = +(px + wob).toFixed(2);
    const h = +(Math.max(o, c) + Math.abs(Math.sin(i * 1.3)) * 2.2 + 0.5).toFixed(2);
    const l = +(Math.min(o, c) - Math.abs(Math.cos(i * 0.9)) * 2.2 - 0.5).toFixed(2);
    const tSec = start + i * 86400;
    bars.push({ time: String(tSec), o, h, l, c });
    px = c;
  }
  return bars;
}

const CAPS = { tfs: ["1m", "5m", "15m", "1h", "D", "W", "1M"], indicators: ["ema", "rsi", "macd", "vwap"] };

const W = 900, H = 460, PADX = 8, PADY = 16;

export default function TheaterHarness() {
  if (process.env.NODE_ENV === "production") notFound();

  const bars = useMemo(() => genBars(120), []);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [aiCount, setAiCount] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [narrowFrame, setNarrowFrame] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [queueReady, setQueueReady] = useState(false);
  const svgWrapRef = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef<Set<string>>(new Set()); // enter-class-once gate (mirrors ChartPanel)

  // price range for the y transform
  const [lo, hi] = useMemo(() => {
    let l = Infinity, h = -Infinity;
    for (const b of bars) { l = Math.min(l, b.l); h = Math.max(h, b.h); }
    const pad = (h - l) * 0.08;
    return [l - pad, h + pad];
  }, [bars]);
  const t0 = Number(bars[0].time), t1 = Number(bars[bars.length - 1].time);
  const xOf = useCallback((tSec: number) => PADX + ((tSec - t0) / (t1 - t0)) * (W - PADX * 2), [t0, t1]);
  const yOf = useCallback((p: number) => PADY + (1 - (p - lo) / (hi - lo)) * (H - PADY * 2), [lo, hi, PADY]);

  // one real CommandQueue for the whole harness (the conductor subscribes to it)
  const queue = useMemo(() => new CommandQueue(0), []);

  // register a coord resolver so the conductor's ghost cursor can glide to real anchors
  useEffect(() => {
    setActivePaneCoords({
      toPx: (tSec: number, price: number) => {
        const x = xOf(tSec), y = yOf(price);
        return isFinite(x) && isFinite(y) ? { x, y } : null;
      },
      rect: () => svgWrapRef.current?.getBoundingClientRect() ?? null,
    });
    return () => setActivePaneCoords(null);
  }, [xOf, yOf]);

  // apply one AI object to the synthetic draw list (mirrors ChartPanel's drawings= merge)
  const store = useRef<Record<string, AiObject[]>>({});
  const applyStep = useCallback((cmd: ChartCommandV2): QueueStep => {
    const v = validateEnvelope(cmd);
    if (!v.ok) return { op: (cmd.op as any), id: cmd.id ?? null, ok: false };
    const res = translate(v.cmd, CAPS);
    const barsFit = bars.map((b) => ({ time: b.time, h: b.h, l: b.l, c: b.c, o: b.o }));
    const out = applyToStore(store.current, "DEMO", v.cmd, res);
    store.current = out.store;
    const objs = store.current["DEMO"] ?? [];
    setDrawings(objs.map((o) => ({ ...o })));
    setAiCount(objs.length);
    let fit; let anchor;
    if (out.ack.ok && res.ok && res.draw && res.draw.length) {
      const f = fitMetrics(res.draw[0], barsFit); if (f) fit = f;
      const p0 = res.draw[0].points[0]; if (p0) { const ts = Number(p0.t); if (isFinite(ts)) anchor = { t: ts, p: p0.p }; }
    }
    return { op: v.cmd.op, id: cmd.id ?? null, caption: res.ok ? res.caption : undefined, ok: out.ack.ok, fit, anchor };
  }, [bars]);

  // ── the scripted demo batch ──
  const play = useCallback(() => {
    // reset
    store.current = {}; playedRef.current = new Set(); setDrawings([]); setAiCount(0);
    setPlaying(true);
    const B = "b_demo_" + Date.now();
    // pick a few anchors off the synthetic series so the drawings sit on real geometry
    const iA = 20, iB = 60, iC = 95;
    const bA = bars[iA], bB = bars[iB], bC = bars[iC];
    const env = (seq: number, op: string, id: string | undefined, args: any, caption?: string): ChartCommandV2 =>
      ({ on: true, v: 2, batch_id: B, seq, op: op as any, id, args, caption,
        // Fixed identity of this synthetic, single-pane fixture; never a live Terminal target.
        target: { schema: "chart.command_target.v1", origin_id: "conductor_theater_fixture",
          context_revision: 0, pane_id: 0, symbol: "DEMO", tf: "D" } });
    const script: ChartCommandV2[] = [
      env(1, "chart.set_tf", undefined, { tf: "D" }, "Setting the daily timeframe"),
      env(2, "draw.trendline", "ai_tl_1", { p1: { t: Number(bars[10].time), p: bars[10].l }, p2: { t: Number(bA.time), p: bA.l } }, "Rising support off the January low"),
      env(3, "draw.trendline", "ai_tl_2", { p1: { t: Number(bB.time), p: bB.h }, p2: { t: Number(bC.time), p: bC.h } }, "Overhead resistance capping the rally"),
      env(4, "draw.zone", "ai_zone_1", { p_lo: bB.l, p_hi: bB.h, t1: Number(bB.time), t2: Number(bC.time) }, "Supply zone where sellers stepped in"),
      env(5, "draw.fib", "ai_fib_1", { p1: { t: Number(bA.time), p: bA.l }, p2: { t: Number(bB.time), p: bB.h } }, "Retracement of the leg up"),
      env(6, "draw.label", "ai_lbl_1", { p1: { t: Number(bA.time), p: bA.l }, text: "HL" }, "Marking the higher low"),
      env(7, "draw.label", "ai_lbl_2", { p1: { t: Number(bC.time), p: bC.h }, text: "LH" }, "Marking the lower high"),
    ];
    // enqueue each op as a real queue job (the conductor sees start → 7 steps → drain)
    for (const cmd of script) queue.enqueue(() => applyStep(cmd));
  }, [bars, queue, applyStep]);

  useEffect(() => {
    const off = queue.onDrain(() => setPlaying(false));
    // Child conductor subscriptions attach before this parent passive effect.
    // Keep server/initial Play disabled so the zero-delay queue cannot outrun them.
    // This external queue must be subscribed before a user can start it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueueReady(true);
    return off;
  }, [queue]);

  // ── render one synthetic drawing (reuses the CMX enter-classes on first paint) ──
  const px = (p: Pt) => ({ x: xOf(Number(p.t)), y: yOf(p.p) });
  function renderDrawing(d: Drawing) {
    const fresh = (d.meta as any)?.by === "ai" && !reduced && !playedRef.current.has(d.id);
    let cls = "";
    if (fresh) {
      cls = d.kind === "rect" ? "cmx-enter-zone" : d.kind === "fib" ? "cmx-enter-fib" : d.kind === "text" ? "cmx-enter-pop" : "cmx-enter-line";
      playedRef.current.add(d.id);
    }
    const col = "var(--ai)";
    if (d.kind === "trendline" || d.kind === "ray") {
      const a = px(d.points[0]), b = px(d.points[1]);
      return <g key={d.id} className={cls}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={1.8} /></g>;
    }
    if (d.kind === "rect") {
      const a = px(d.points[0]), b = px(d.points[1]);
      return <g key={d.id} className={cls}>
        <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={col} fillOpacity={0.12} stroke={col} strokeWidth={1.4} />
      </g>;
    }
    if (d.kind === "fib") {
      const hiP = Math.max(d.points[0].p, d.points[1].p), loP = Math.min(d.points[0].p, d.points[1].p);
      const x1 = Math.min(px(d.points[0]).x, px(d.points[1]).x);
      const FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      return <g key={d.id} className={cls}>
        {FIBS.map((f, i) => { const y = yOf(hiP - (hiP - loP) * f); return <line key={i} x1={x1} y1={y} x2={W - PADX} y2={y} stroke={col} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />; })}
      </g>;
    }
    if (d.kind === "text") {
      const a = px(d.points[0]);
      return <g key={d.id} className={cls}><text x={a.x} y={a.y} fill={col} fontSize={13} fontFamily="var(--font-ui)">{d.text}</text></g>;
    }
    return null;
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: 20, fontFamily: "var(--font-ui)" }}>
      <div style={{ maxWidth: 940, margin: "0 auto" }}>
        <h1 style={{ font: "700 18px var(--font-ui)", margin: "0 0 4px" }}>CMX W3 — Conductor theater harness</h1>
        <p style={{ color: "var(--text-2)", font: "500 12px var(--font-ui)", margin: "0 0 14px" }}>
          Env-free verification stage. Drives the real chartBus queue + the real ChartConductor over a synthetic 120-bar chart.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <button onClick={play} disabled={playing || !queueReady}
            style={{ font: "600 13px var(--font-ui)", color: "#fff", background: playing ? "var(--panel-3)" : "var(--ai)", border: 0, borderRadius: 6, padding: "8px 16px", cursor: playing ? "default" : "pointer" }}>
            {playing ? "Playing…" : "Play demo"}
          </button>
          <button onClick={() => setReduced((r) => !r)}
            style={{ font: "600 13px var(--font-ui)", color: "var(--text)", background: reduced ? "rgba(157,134,255,.2)" : "var(--panel-2)", border: "1px solid var(--line-3)", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}>
            Reduced motion: {reduced ? "ON" : "off"}
          </button>
          <button onClick={() => setNarrowFrame((n) => !n)}
            style={{ font: "600 13px var(--font-ui)", color: "var(--text)", background: narrowFrame ? "rgba(157,134,255,.2)" : "var(--panel-2)", border: "1px solid var(--line-3)", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}>
            390px frame: {narrowFrame ? "ON" : "off"}
          </button>
          <span style={{ font: "500 12px var(--font-num)", fontVariantNumeric: "tabular-nums", color: "var(--text-2)", alignSelf: "center" }}>AI objects on chart: {aiCount}</span>
        </div>

        {/* The pane. .cmx-rm on the wrapper simulates reduced-motion for the conductor (mirrors the media query). */}
        <div className={reduced ? "cmx-rm" : ""} style={{ width: narrowFrame ? 390 : "100%", maxWidth: 900, transition: "width .2s" }}>
          <div ref={svgWrapRef} style={{ position: "relative", background: "var(--chart-bg)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", aspectRatio: `${W} / ${H}` }}>
              {/* candles */}
              {bars.map((b, i) => {
                const x = xOf(Number(b.time)); const bw = Math.max(1.5, (W - PADX * 2) / bars.length * 0.62);
                const up = b.c >= b.o; const col = up ? "var(--up)" : "var(--down)";
                const yO = yOf(b.o), yC = yOf(b.c), yH = yOf(b.h), yL = yOf(b.l);
                return <g key={i}>
                  <line x1={x} y1={yH} x2={x} y2={yL} stroke={col} strokeWidth={1} />
                  <rect x={x - bw / 2} y={Math.min(yO, yC)} width={bw} height={Math.max(1, Math.abs(yC - yO))} fill={col} />
                </g>;
              })}
              {/* AI drawings (with enter-classes) rendered on top */}
              {drawings.map(renderDrawing)}
            </svg>
            {/* the real conductor overlay, driven by the real queue */}
            <ChartConductor queue={queue} count={aiCount} />
          </div>
        </div>

        <p style={{ color: "var(--muted)", font: "500 11px var(--font-ui)", marginTop: 12 }}>
          Sequence: set_tf → 2 trendlines (with synthetic fit acks) → zone → fib → 2 labels → done. Click the orb to open the step rail; the » Skip button drains instantly.
        </p>
      </div>
    </div>
  );
}

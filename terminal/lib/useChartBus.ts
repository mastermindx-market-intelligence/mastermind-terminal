"use client";
// useChartBus — the React glue binding lib/chartBus.ts into TerminalShell.
//
// Owns the in-memory, per-symbol AI drawing layer (survives symbol switches within the session; NO
// server persistence), the command queue, ack accumulation, and the debounced state-mirror POST to
// the Terminal's own brain proxy (/api/brain/chart/state — added to the route.ts allowlist).
//
// TerminalShell wires:
//   • dispatchV2(cmd)          → call from handleBrainCommand when isV2Envelope(j)
//   • aiDrawingsFor(symbol)    → merge into the ChartPane `drawings=` prop
//   • legend { count, hidden, toggleHidden, clear } → the "AI layer · N" chip
//   • report a session snapshot (symbol/tf/indicators/capabilities/user-drawings) so state POSTs are complete

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Drawing } from "@/lib/drawings";
import {
  CommandQueue, applyToStore, isV2Envelope, translate, validateEnvelope,
  fitMetrics, type Ack, type AiObject, type Fit, type FitBar, type IndicatorSpec,
  type QueueStep, type StoreEffect,
} from "@/lib/chartBus";

// What TerminalShell must supply so the bus can act on the chart + build a complete state snapshot.
export type ChartBusHost = {
  activeSymbol: string;
  bars: FitBar[]; // the active symbol's rendered series (for fit metrics + visible-range span)
  capabilities: { tfs: string[]; indicators: string[] };
  sessionIndicators: IndicatorSpec[]; // current indicator set (name+params)
  currentTf: string;
  userDrawings: Drawing[]; // the active symbol's user drawings (by:"user"), if enumerable
  // chart mutators (already exist in TerminalShell):
  setSymbol: (s: string) => void;
  setTf: (tf: string) => void;
  setIndicators: (specs: IndicatorSpec[]) => void;
  setRange: (from: number, to: number) => void;
};

export type ChartBus = {
  dispatchV2: (cmd: unknown) => void;
  aiDrawingsFor: (symbol: string) => Drawing[];
  legend: { count: number; hidden: boolean; toggleHidden: () => void; clear: () => void };
  queue: CommandQueue; // exposed so W3 can subscribe to step events later
};

// A rejected command still produces an ack (ok:false) — the gateway needs to see the rejection.
const STATE_DEBOUNCE_MS = 2000;

export function useChartBus(host: ChartBusHost): ChartBus {
  // per-symbol AI objects. Keyed by symbol; NEVER reset on symbol switch (that's the whole point).
  const [aiStore, setAiStore] = useState<Record<string, AiObject[]>>({});
  const [hiddenSyms, setHiddenSyms] = useState<Set<string>>(new Set()); // symbols whose AI layer is eye-toggled off

  // Keep a live ref of the COMMITTED host so synchronous queue jobs cannot run against the prior
  // symbol/timeframe during the render→passive-effect gap. Layout effects refresh this before any
  // layout-phase command consumer can fire, without exposing an uncommitted concurrent render.
  const hostRef = useRef(host);
  useLayoutEffect(() => { hostRef.current = host; }, [host]);
  // aiStoreRef is the SYNCHRONOUS working copy of the AI store — updated immediately in dispatch so a
  // burst of queued draws in one tick each see the prior draw's result (React state timing would lag).
  // setAiStore mirrors it for rendering. The legend/aiDrawingsFor read the React state (aiStore).
  const aiStoreRef = useRef(aiStore);

  const queue = useMemo(() => new CommandQueue(0), []); // default 0 = instant; W3 sets a pace + subscribes
  const acksRef = useRef<Ack[]>([]);

  // ── debounced state mirror POST ────────────────────────────────────────────────────────────
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postState = useCallback(() => {
    const h = hostRef.current;
    const sym = h.activeSymbol;
    const aiObjs = aiStoreRef.current[sym] ?? [];
    const bars = h.bars;
    const drawings = [
      ...aiObjs.map((o) => {
        const base: Record<string, unknown> = { id: o.id, by: "ai", op: o.op, args: aiArgs(o) };
        const fit = fitMetrics(o, bars);
        if (fit) base.fit = fit;
        if (o.caption) base.caption = o.caption;
        return base;
      }),
      ...h.userDrawings.map((d) => ({ id: d.id, by: "user", op: "draw." + d.kind, args: userArgs(d) })),
    ];
    const acks = acksRef.current;
    acksRef.current = [];
    // visible_range: the loaded-series span (first↔last bar epoch). NOTE: this is the data span, not
    // the live pan/zoom viewport — see PR body; the clean follow-up is the existing onChartApi seam.
    const span = seriesSpan(bars);
    const body = {
      client: "terminal",
      session: {
        symbol: sym,
        tf: h.currentTf,
        indicators: h.sessionIndicators,
        visible_range: span,
        capabilities: h.capabilities,
        drawings,
      },
      acks,
    };
    // Fire-and-forget through the session-verified proxy. Failures are non-fatal (the gateway re-reads
    // on the next change); we never surface a network error into the chart.
    try {
      fetch("/api/brain/chart/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch { /* ignore */ }
  }, []);

  const scheduleState = useCallback(() => {
    if (stateTimer.current) return; // already pending — coalesce (≤1 per 2s)
    stateTimer.current = setTimeout(() => { stateTimer.current = null; postState(); }, STATE_DEBOUNCE_MS);
  }, [postState]);

  // POST on symbol / tf / indicator / user-drawing changes (contract: "also POST on … changes").
  const changeSig = `${host.activeSymbol}|${host.currentTf}|${host.sessionIndicators.map((s) => s.name + JSON.stringify(s.params || {})).join(",")}|${host.userDrawings.length}`;
  const firstSig = useRef(true);
  useEffect(() => {
    if (firstSig.current) { firstSig.current = false; return; } // no POST on mount
    scheduleState();
  }, [changeSig, scheduleState]);
  useEffect(() => () => { if (stateTimer.current) clearTimeout(stateTimer.current); }, []);

  // ── ack helper ───────────────────────────────────────────────────────────────────────────
  const pushAck = useCallback((a: Ack) => { acksRef.current.push(a); scheduleState(); }, [scheduleState]);

  // ── the v2 dispatcher ──────────────────────────────────────────────────────────────────────
  const dispatchV2 = useCallback((j: unknown) => {
    if (!isV2Envelope(j)) return; // not a v2 envelope — caller handles v1 fallback
    const v = validateEnvelope(j);
    if (!v.ok) { pushAck({ batch_id: v.batch_id, seq: v.seq, id: v.id, ok: false, error: v.error }); return; }
    const cmd = v.cmd;
    const h = hostRef.current;
    const res = translate(cmd, h.capabilities);
    if (!res.ok) { pushAck({ batch_id: cmd.batch_id, seq: cmd.seq, id: cmd.id ?? null, ok: false, error: res.error }); return; }

    // Enqueue the side-effect. The queue applies sequentially (instant by default; W3 paces it later).
    queue.enqueue((): QueueStep => {
      // Run the PURE reducer against the synchronous working store, commit the result to both the ref
      // (so the next queued draw sees it) and React state (for render), then apply the chart.* effect.
      const r = applyToStore(aiStoreRef.current, hostRef.current.activeSymbol, cmd, res);
      aiStoreRef.current = r.store;
      setAiStore(r.store);
      const e: StoreEffect = r.effect;
      if (e) {
        const h = hostRef.current;
        switch (e.kind) {
          case "setSymbol": h.setSymbol(e.symbol); break;
          case "setTf": h.setTf(e.tf); break;
          case "setIndicators": h.setIndicators(e.indicators); break;
          case "setRange": h.setRange(e.from, e.to); break;
          case "scene": break; // markers only — inert now (W3 consumes)
        }
      }
      pushAck(r.ack);
      // Fit metrics ride the step for the W3 rail's ack chip. Computed against the current bar series
      // for the FIRST object this draw produced (the primary object; channel/path fan out to siblings
      // that share the same read). Only trendline/ray/hline/zone(rect) yield fit — otherwise undefined.
      let fit: Fit | undefined;
      let anchor: { t: number; p: number } | undefined;
      if (r.ack.ok && res.ok && res.draw && res.draw.length) {
        const obj = res.draw[0];
        const f = fitMetrics(obj, hostRef.current.bars);
        if (f) fit = f;
        // first anchor point → {t: epoch-seconds, p: price} for the W3 ghost cursor glide.
        const p0 = obj.points[0];
        if (p0) { const tSec = Number(p0.t); if (Number.isFinite(tSec)) anchor = { t: tSec, p: p0.p }; }
      }
      return { op: cmd.op, id: cmd.id ?? null, caption: res.ok ? res.caption : undefined, ok: r.ack.ok, fit, anchor };
    });
  }, [queue, pushAck]);

  // ── AI drawings for a symbol (merged into ChartPane), respecting the eye-toggle ──────────────
  const aiDrawingsFor = useCallback((symbol: string): Drawing[] => {
    if (hiddenSyms.has(symbol)) return [];
    return aiStore[symbol] ?? [];
  }, [aiStore, hiddenSyms]);

  // ── legend chip props (for the active symbol) ────────────────────────────────────────────────
  const activeSym = host.activeSymbol;
  const legend = useMemo(() => ({
    count: (aiStore[activeSym] ?? []).length,
    hidden: hiddenSyms.has(activeSym),
    toggleHidden: () => setHiddenSyms((s) => { const n = new Set(s); if (n.has(activeSym)) n.delete(activeSym); else n.add(activeSym); return n; }),
    clear: () => { const next = { ...aiStoreRef.current, [activeSym]: [] }; aiStoreRef.current = next; setAiStore(next); scheduleState(); },
  }), [aiStore, hiddenSyms, activeSym, scheduleState]);

  return { dispatchV2, aiDrawingsFor, legend, queue };
}

// ── shape helpers for the state mirror ──────────────────────────────────────────────────────────
// Report AI objects with their *contract* args (not the internal Drawing shape) where cheap; fall back
// to the raw points otherwise. The gateway mostly needs id/by/op/fit — args are best-effort context.
function aiArgs(o: AiObject): Record<string, unknown> {
  const pts = o.points.map((p) => ({ t: Number(p.t) || p.t, p: p.p }));
  const out: Record<string, unknown> = { points: pts };
  if (o.kind === "hline" && o.points[0]) out.p = o.points[0].p;
  if (o.text) out.text = o.text;
  return out;
}
function userArgs(d: Drawing): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.kind === "hline" && d.points[0]) out.p = d.points[0].p;
  else out.points = d.points.map((p) => ({ t: Number(p.t) || p.t, p: p.p }));
  return out;
}

// visible_range from the loaded series (first↔last bar epoch-seconds).
function seriesSpan(bars: FitBar[]): { from: number; to: number } | null {
  if (!bars.length) return null;
  const toSec = (t: string | number): number => {
    if (typeof t === "number") return t;
    if (/^\d+$/.test(t)) return Number(t);
    return Math.floor(+new Date(t + "T12:00:00Z") / 1000);
  };
  return { from: toSec(bars[0].time), to: toSec(bars[bars.length - 1].time) };
}

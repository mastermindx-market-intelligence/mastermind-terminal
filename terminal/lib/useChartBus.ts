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
import { timeToMs } from "@/lib/timeWindow";
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
  activePaneId: number;
  userDrawings: Drawing[]; // the active symbol's user drawings (by:"user"), if enumerable
  // Existing DeepVue ai-context identity. Read at POST time so revision stays in lockstep
  // with the same provider the Brain widget sends on the chat request.
  getContextIdentity: () => { origin_id: string; context_revision: number };
  // chart mutators (already exist in TerminalShell):
  setSymbol: (s: string) => void;
  setTf: (tf: string) => void;
  setIndicators: (specs: IndicatorSpec[]) => void;
  setRange: (from: number, to: number) => void;
};

export type ChartBus = {
  dispatchV2: (cmd: unknown) => void;
  /** PaneSync calendar window in epoch ms; only active-pane changes trigger a mirror. */
  noteViewport: (paneId: number, windowMs: { from: number; to: number } | null) => void;
  aiDrawingsFor: (symbol: string) => Drawing[];
  legend: { count: number; hidden: boolean; toggleHidden: () => void; clear: () => void };
  queue: CommandQueue; // exposed so W3 can subscribe to step events later
};

// A rejected command still produces an ack (ok:false) — the gateway needs to see the rejection.
const STATE_DEBOUNCE_MS = 2000;
const VIEWPORT_DEBOUNCE_MS = 250;
const ACK_DEBOUNCE_MS = 100;

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
  const viewportByPaneRef = useRef(new Map<number, { from: number; to: number }>());

  // ── debounced state mirror POST ────────────────────────────────────────────────────────────
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimerDelay = useRef<number | null>(null);
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
      ...h.userDrawings.map(userDrawingState),
    ];
    const acks = acksRef.current;
    acksRef.current = [];
    const identity = h.getContextIdentity();
    if (
      !identity
      || typeof identity.origin_id !== "string"
      || !identity.origin_id
      || identity.origin_id.length > 64
      || !Number.isInteger(identity.context_revision)
      || identity.context_revision < 0
    ) {
      // Exact origin is part of chart-state identity now. Do not silently fall back to
      // the legacy shared key when the mounted Terminal provider is malformed.
      acksRef.current = [...acks, ...acksRef.current];
      return;
    }
    const dataRange = seriesSpan(bars);
    const viewportMs = viewportByPaneRef.current.get(h.activePaneId) ?? null;
    const visibleRange = viewportMs
      ? { from: viewportMs.from / 1000, to: viewportMs.to / 1000 }
      : null;
    const body = {
      client: "terminal",
      origin_id: identity.origin_id,
      context_revision: identity.context_revision,
      session: {
        symbol: sym,
        tf: h.currentTf,
        pane_id: h.activePaneId,
        indicators: h.sessionIndicators,
        // True live pan/zoom bounds from paneSync's calendar-window owner.
        visible_range: visibleRange,
        // Loaded-series availability is useful context but is not the viewport.
        data_range: dataRange,
        capabilities: h.capabilities,
        drawings,
      },
      acks,
    };
    // Fire-and-forget through the session-verified proxy. The session snapshot itself is best-effort,
    // but command acknowledgements are not: the gateway needs them to close/reject command steps.
    // We remove this batch optimistically above, then restore it ahead of any newer acks when the
    // request fails or returns non-2xx so the next scheduled state write retries it.
    let restored = false;
    const restoreAcks = () => {
      if (restored || !acks.length) return;
      restored = true;
      acksRef.current = [...acks, ...acksRef.current];
    };
    try {
      void fetch("/api/brain/chart/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }).then((response) => {
        if (!response.ok) restoreAcks();
      }, restoreAcks);
    } catch {
      restoreAcks();
    }
  }, []);

  const scheduleState = useCallback((delayMs = STATE_DEBOUNCE_MS) => {
    if (stateTimer.current) {
      const currentDelay = stateTimerDelay.current ?? STATE_DEBOUNCE_MS;
      // Smaller delay = higher priority: ACK (100ms) > viewport/context (250ms) > telemetry (2s).
      // A lower-priority update may coalesce into a pending higher-priority flush, never postpone it.
      if (delayMs >= currentDelay) return;
      clearTimeout(stateTimer.current);
      stateTimer.current = null;
      stateTimerDelay.current = null;
    }
    stateTimerDelay.current = delayMs;
    stateTimer.current = setTimeout(() => {
      stateTimer.current = null;
      stateTimerDelay.current = null;
      postState();
    }, delayMs);
  }, [postState]);

  // Context targeting (symbol/tf/active pane) mirrors promptly, including the initial mount.
  const contextSig = `${host.activeSymbol}|${host.currentTf}|${host.activePaneId}`;
  useEffect(() => {
    scheduleState(VIEWPORT_DEBOUNCE_MS);
  }, [contextSig, scheduleState]);

  // Indicator/drawing telemetry can stay on the slower coalescing path.
  const userDrawingSig = JSON.stringify(host.userDrawings.map(userDrawingState));
  const contentSig = `${host.sessionIndicators.map((s) => s.name + JSON.stringify(s.params || {})).join(",")}|${userDrawingSig}`;
  useEffect(() => {
    scheduleState();
  }, [contentSig, scheduleState]);
  useEffect(() => () => {
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = null;
    stateTimerDelay.current = null;
  }, []);

  const noteViewport = useCallback((paneId: number, windowMs: { from: number; to: number } | null) => {
    if (!Number.isInteger(paneId) || paneId < 0) return;
    const next = windowMs
      && Number.isFinite(windowMs.from)
      && Number.isFinite(windowMs.to)
      && windowMs.from < windowMs.to
      ? { from: windowMs.from, to: windowMs.to }
      : null;
    const prev = viewportByPaneRef.current.get(paneId) ?? null;
    if (
      (prev == null && next == null)
      || (prev != null && next != null && prev.from === next.from && prev.to === next.to)
    ) return;
    if (next) viewportByPaneRef.current.set(paneId, next);
    else viewportByPaneRef.current.delete(paneId);
    if (paneId === hostRef.current.activePaneId) scheduleState(VIEWPORT_DEBOUNCE_MS);
  }, [scheduleState]);

  // ── ack helper ───────────────────────────────────────────────────────────────────────────
  const pushAck = useCallback((a: Ack) => {
    acksRef.current.push(a);
    scheduleState(ACK_DEBOUNCE_MS);
  }, [scheduleState]);

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

  return { dispatchV2, noteViewport, aiDrawingsFor, legend, queue };
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

function userDrawingState(d: Drawing): Record<string, unknown> {
  return { id: d.id, by: "user", op: "draw." + d.kind, args: userArgs(d) };
}

// Loaded data availability, distinct from the live viewport. Uses the same time
// interpretation as paneSync/timeWindow so daily bars are midnight UTC and intraday bars stay seconds.
function seriesSpan(bars: FitBar[]): { from: number; to: number } | null {
  if (!bars.length) return null;
  const fromMs = timeToMs(bars[0].time);
  const toMs = timeToMs(bars[bars.length - 1].time);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null;
  return { from: fromMs / 1000, to: toMs / 1000 };
}

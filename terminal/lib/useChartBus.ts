"use client";
// useChartBus — the React glue binding lib/chartBus.ts into TerminalShell.
//
// Projects the canonical account drawing collection supplied by TerminalShell.
// Owns only the principal-scoped queue, ACKs, and debounced state-mirror POST to
// the Terminal's own brain proxy (/api/brain/chart/state — added to the route.ts allowlist).
//
// TerminalShell wires:
//   • dispatchV2(cmd)          → call from handleBrainCommand when isV2Envelope(j)
//   • aiDrawingsFor(symbol)    → merge into the ChartPane `drawings=` prop
//   • legend { count, hidden, toggleHidden, clear } → the "AI layer · N" chip
//   • report a session snapshot (symbol/tf/indicators/capabilities/user-drawings) so state POSTs are complete

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Drawing } from "@/lib/drawings";
import { storedAiObjects, storedAiLayerHidden } from "@/lib/drawingAiPersistence";
import type { ChartStatePreparationRequest, ChartStatePreparationResult } from "@/lib/mastermindBrain";
import { editAiObjects, type AiLayerController, type AiObjectEdit } from "@/lib/chartAiLayer";
import { isAiNativeDrawingKind, nativeDrawingAnchorError, nativeDrawingStateArgs } from "@/lib/chartDrawingTools";
import { timeToMs } from "@/lib/timeWindow";
import { prepareChartStatePayload } from "@/lib/chartStatePayload";
import { buildChartPriceWindow, CHART_PRICE_WINDOW_SCHEMA, type ChartPriceWindowSource } from "@/lib/chartPriceWindow";
import { CHART_PRESENTATION_SCHEMA } from "@/lib/chartPresentation";
import {createWorkspaceContextSession,type WorkspaceContextSession} from "./workspaceContextSession";
import {
  CommandQueue, applyToStore, isV2Envelope, translate, validateEnvelope,
  fitMetrics, updateIndicatorVisibility, describeIndicatorVisibility, type Ack, type AiObject, type Fit, type FitBar, type IndicatorSpec, type IndicatorVisibilityPatch,
  type QueueStep, type StoreEffect, type ChartCommandTarget,
  CHART_COMMAND_TARGET_SCHEMA, requiresExactChartTarget, readChartCommandTarget, chartCommandTargetError,
} from "@/lib/chartBus";

export const CHART_PANE_CONTEXT_SCHEMA = "chart.pane_contexts.v1" as const;
export const CHART_PANE_CONTEXT_MAX = 4;

export type ChartPaneContextSnapshot = {
  pane_id: number;
  symbol: string;
  tf: string;
  price_window_source: ChartPriceWindowSource | null;
  presentation: unknown;
  native_observations: unknown;
};

// What TerminalShell must supply so the bus can act on the chart + build a complete state snapshot.
export type ChartDrawingOwner = {
  key: string;
  /** Transient activation identity; A -> B -> A must produce a fresh object. */
  generation: object;
  /** Missing symbol means authoritative loading has not completed. */
  collections: Record<string, Drawing[]>;
  replaceAi: (symbol: string, objects: AiObject[], layerHidden: boolean) =>
    { ok: true; objects: AiObject[] } | { ok: false; error: string };
};
export type ChartBusHost = {
  drawingOwner: ChartDrawingOwner;
  activeSymbol: string;
  bars: FitBar[]; // the active symbol's rendered series (for fit metrics + visible-range span)
  capabilities: { tfs: string[]; indicators: string[] };
  sessionIndicators: IndicatorSpec[]; // current indicator set (name+params)
  hiddenIndicators?: readonly string[]; // existing legend visibility, separate from numerical settings
  currentTf: string;
  activePaneId: number;
  userDrawings: Drawing[]; // the active symbol's user drawings (by:"user"), if enumerable
  // Existing DeepVue ai-context identity. Read at POST time so revision stays in lockstep
  // with the same provider the Brain widget sends on the chat request.
  getContextIdentity: () => { origin_id: string; context_revision: number };
  // Flush already-pending owner commits before admission; no second context store.
  // A host offering successor receipts commits each chart setter synchronously.
  flushContext?: () => void;
  getReadoutSnapshot?: () => unknown; // existing Data Window projection, never new calculation
  getRenderedPriceWindowSource?: () => ChartPriceWindowSource | null; // accepted renderer bars, replay-safe
  getPresentationSnapshot?: () => unknown; // committed chart presentation, read-only
  getNativeObservationSnapshot?: () => unknown; // active pane's exact renderer-bundle projection
  getPaneContextSnapshots?: () => readonly ChartPaneContextSnapshot[]; // mounted panes, read-only evidence
  // chart mutators (already exist in TerminalShell):
  setSymbol: (s: string) => void;
  setTf: (tf: string) => void;
  setIndicators: (specs: IndicatorSpec[], visibility?: IndicatorVisibilityPatch) => void;
  setRange: (from: number, to: number) => void | boolean;
};

export type ChartBus = {
  /** Ephemeral view context owned by this mount; never a Brain pin or persisted layout. */
  readonly context: WorkspaceContextSession|null;
  dispatchV2: (cmd: unknown) => void;
  prepareChartState: (expected: ChartStatePreparationRequest, signal?: AbortSignal) => Promise<ChartStatePreparationResult>;
  noteReadoutChange: () => void; // reuse ordinary state coalescing; ACK priority remains higher
  noteNativeObservationChange: () => void;
  /** PaneSync calendar window in epoch ms; mounted panes share the existing mirror. */
  noteViewport: (paneId: number, windowMs: { from: number; to: number } | null) => void;
  aiDrawingsFor: (symbol: string) => Drawing[];
  legend: AiLayerController;
  queue: CommandQueue; // exposed so W3 can subscribe to step events later
};

// A rejected command still produces an ack (ok:false) — the gateway needs to see the rejection.
const STATE_DEBOUNCE_MS = 2000;
const VIEWPORT_DEBOUNCE_MS = 250;
const ACK_DEBOUNCE_MS = 100;
const STATE_POST_TIMEOUT_MS = 4000;

export function useChartBus(host: ChartBusHost): ChartBus {
  const generation = host.drawingOwner.generation;
  const generationRef = useRef<object | null>(null);
  // This is a projection, not a second persistent store. The owner returns the
  // exact normalized readback after accepting each synchronous local mutation.
  const aiStore = useMemo(() => Object.fromEntries(Object.entries(host.drawingOwner.collections)
    .map(([symbol, drawings]) => [symbol, storedAiObjects(drawings)])), [host.drawingOwner.collections]);
  const hiddenSyms = useMemo(() => new Set(Object.entries(host.drawingOwner.collections)
    .filter(([, drawings]) => storedAiLayerHidden(drawings)).map(([symbol]) => symbol)), [host.drawingOwner.collections]);
  const hiddenSymsRef = useRef(hiddenSyms);

  // Keep a live ref of the COMMITTED host so synchronous queue jobs cannot run against the prior
  // symbol/timeframe during the render→passive-effect gap. Layout effects refresh this before any
  // layout-phase command consumer can fire, without exposing an uncommitted concurrent render.
  const hostRef = useRef(host);
  const mountedRef = useRef(true);
  const isCurrentOwner = useCallback(() => mountedRef.current
    && generationRef.current === generation && hostRef.current.drawingOwner.generation === generation, [generation]);
  // A context-changing setter schedules React work. Targeted edits must not slip
  // through in that same tick against the still-committed OLD chart.
  const pendingContextRef = useRef<{ symbol: string; tf: string } | null>(null);
  useLayoutEffect(() => {
    hostRef.current = host;
    const pending = pendingContextRef.current;
    if (pending && (host.activeSymbol !== pending.symbol || host.currentTf !== pending.tf))
      pendingContextRef.current = null;
  }, [host]);
  useLayoutEffect(() => {
    mountedRef.current = true; generationRef.current = generation;
    return () => {
      if (generationRef.current === generation) generationRef.current = null;
      mountedRef.current = false;
    };
  }, [generation]);
  const contextRef=useRef<WorkspaceContextSession|null>(null),contextSequence=useRef(0);
  // The owner is created after commit. Notify rendered consumers once its
  // epoch exists; the ref remains the sole session and closes on unmount.
  const [,setContextEpoch]=useState<string|null>(null);
  // Allocate/close in the committed lifecycle. StrictMode's effect remount gets a
  // new epoch; abandoned mounts and their asynchronous response tokens stay closed.
  useLayoutEffect(()=>{
    const h=hostRef.current;
    const epoch=globalThis.crypto?.randomUUID?.()??`context_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const context=createWorkspaceContextSession(epoch,[{id:"active_security",initial:{kind:"security",id:h.activeSymbol,timeframe:h.currentTf,pane_id:h.activePaneId},accepts:value=>Object.keys(value).length===4&&value.kind==="security"&&typeof value.id==="string"&&typeof value.timeframe==="string"&&Number.isInteger(value.pane_id)&&Number(value.pane_id)>=0}]);
    context.register({id:"active-chart",group:"active_security",emit:true});contextRef.current=context;contextSequence.current=0;setContextEpoch(epoch);
    return()=>{context.close();if(contextRef.current===context)contextRef.current=null;};
  },[generation]);
  useLayoutEffect(()=>{
    const context=contextRef.current,source=context?.snapshot("active-chart");if(!context||!source)return;
    context.publish({epoch:source.epoch,origin:source.consumer,origin_generation:source.incarnation,sequence:++contextSequence.current,value:{kind:"security",id:host.activeSymbol,timeframe:host.currentTf,pane_id:host.activePaneId}});
  },[generation,host.activeSymbol,host.currentTf,host.activePaneId]);
  // aiStoreRef is the SYNCHRONOUS working copy of the AI store — updated immediately in dispatch so a
  // burst of queued draws in one tick each see the prior draw's result (React state timing would lag).
  // Rendering comes only from the canonical owner's committed collection.
  const aiStoreRef = useRef(aiStore);
  useLayoutEffect(() => {
    aiStoreRef.current = aiStore; hiddenSymsRef.current = hiddenSyms;
  }, [aiStore, hiddenSyms, generation]);

  const queue = useMemo(() => new CommandQueue(0), [generation]); // default 0 = instant; W3 sets a pace + subscribes
  const acksRef = useRef<Ack[]>([]);
  const viewportByPaneRef = useRef(new Map<number, { from: number; to: number }>());

  // ── debounced state mirror POST ────────────────────────────────────────────────────────────
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimerDelay = useRef<number | null>(null);
  // Request state for this existing mirror only, not another queue or retry owner.
  const stateRequestRef = useRef<{
    inFlight: boolean; pending: boolean; completion: Promise<ChartStatePreparationResult> | null; retire?: () => void;
  }>({ inFlight: false, pending: false, completion: null });
  const scheduleStateRef = useRef<((delayMs: number) => void) | null>(null);
  useLayoutEffect(() => {
    acksRef.current = []; viewportByPaneRef.current.clear(); pendingContextRef.current = null;
    return () => {
      // Principal retirement is not a user Stop. Drop pending authority without
      // publishing old cancellation receipts through the incoming account.
      queue.clear();
      if (stateTimer.current) clearTimeout(stateTimer.current);
      stateTimer.current = null; stateTimerDelay.current = null;
      stateRequestRef.current.retire?.();
      stateRequestRef.current = { inFlight: false, pending: false, completion: null };
      acksRef.current = [];
    };
  }, [generation, queue]);
  const postState = useCallback((expected?: ChartStatePreparationRequest): Promise<ChartStatePreparationResult> => {
    const unavailable = (reason: Extract<ChartStatePreparationResult, { ok: false }>["reason"]) =>
      Promise.resolve<ChartStatePreparationResult>({ ok: false, reason });
    if (!isCurrentOwner()) return unavailable("host_unmounted");
    if (stateRequestRef.current.inFlight) {
      stateRequestRef.current.pending = true;
      return stateRequestRef.current.completion ?? unavailable("state_unavailable");
    }
    const h = hostRef.current;
    const sym = h.activeSymbol;
    // Unknown storage is not a verified empty drawing inventory. A turn cannot
    // plan replacements until the same principal's authoritative collection is ready.
    if (h.drawingOwner.collections[sym] === undefined) return unavailable("state_unavailable");
    const aiObjs = aiStoreRef.current[sym] ?? [];
    const bars = h.bars;
    const drawings = [
      ...aiObjs.map((o) => {
        const base: Record<string, unknown> = { id: o.id, by: "ai", op: o.op, kind: o.kind, args: aiArgs(o),
          command_id: o.command_id ?? o.id, batch_id: o.batch_id, seq: o.seq,
          hidden: hiddenSymsRef.current.has(sym) || o.hidden === true };
        const fit = fitMetrics(o, bars);
        if (fit) base.fit = fit;
        if (o.caption) base.caption = o.caption;
        return base;
      }),
      ...h.userDrawings.map(userDrawingState),
    ];
    const acks = acksRef.current;
    // Do not consume receipts before identity lookup and payload preparation succeed.
    let identity: ReturnType<ChartBusHost["getContextIdentity"]>;
    try { identity = h.getContextIdentity(); } catch { return unavailable("state_unavailable"); }
    if (
      !identity
      || typeof identity.origin_id !== "string"
      || !identity.origin_id
      || identity.origin_id.length > 64
      || !Number.isSafeInteger(identity.context_revision)
      || identity.context_revision < 0
    ) {
      // Keep every ACK in the incumbent accumulator. No shared-key fallback.
      return unavailable("state_unavailable");
    }
    if (expected && (identity.origin_id !== expected.origin_id
      || identity.context_revision !== expected.context_revision)) return unavailable("context_changed");
    const dataRange = seriesSpan(bars);
    const viewportMs = viewportByPaneRef.current.get(h.activePaneId) ?? null;
    const visibleRange = viewportMs
      ? { from: viewportMs.from / 1000, to: viewportMs.to / 1000 }
      : null;
    let dataReadout: unknown = null;
    try { dataReadout = h.getReadoutSnapshot?.() ?? null; }
    catch { /* absent/failed readout is not an empty market conclusion */ }
    let priceWindow: unknown = null;
    try {
      const priceSource = h.getRenderedPriceWindowSource?.() ?? null;
      if (priceSource) priceWindow = buildChartPriceWindow(
        priceSource, sym, h.currentTf, visibleRange,
      );
    } catch { /* absent/failed price window is missing evidence, never a market conclusion */ }
    let presentation: unknown = null;
    try { presentation = h.getPresentationSnapshot?.() ?? null; }
    catch { /* absent/failed presentation is missing view evidence, never a chart conclusion */ }
    let nativeObservations: unknown = null;
    try { nativeObservations = h.getNativeObservationSnapshot?.() ?? null; }
    catch { /* absent/failed native evidence is not an empty/no-setup conclusion */ }

    // Read-only multi-pane evidence rides the SAME state mirror. It never changes
    // the active pane or grants mutation authority to an inactive pane.
    let paneContexts: unknown = null;
    try {
      const rows = h.getPaneContextSnapshots?.() ?? [];
      if (rows.length > CHART_PANE_CONTEXT_MAX) throw new Error("pane_context_limit");
      const seen = new Set<number>();
      const panes: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        if (
          !row
          || !Number.isSafeInteger(row.pane_id)
          || row.pane_id < 0
          || row.pane_id >= CHART_PANE_CONTEXT_MAX
          || seen.has(row.pane_id)
          || typeof row.symbol !== "string"
          || !row.symbol
          || row.symbol.length > 64
          || typeof row.tf !== "string"
          || !row.tf
          || row.tf.length > 32
        ) throw new Error("pane_context_identity");
        seen.add(row.pane_id);
        const windowMs = viewportByPaneRef.current.get(row.pane_id) ?? null;
        const paneVisibleRange = windowMs
          ? { from: windowMs.from / 1000, to: windowMs.to / 1000 }
          : null;
        const activeRow = row.pane_id === h.activePaneId;
        const paneRow: Record<string, unknown> = {
          pane_id: row.pane_id,
          symbol: row.symbol,
          tf: row.tf,
          visible_range: paneVisibleRange,
        };
        if (activeRow) {
          // Root active packets are already carried and separately qualified. References
          // prevent multi-pane context from paying their JSON size twice.
          paneRow.price_window_ref = "session.price_window";
          paneRow.presentation_ref = "session.presentation";
          paneRow.native_observations_ref = "session.native_observations";
        } else {
          paneRow.price_window = row.price_window_source
            ? buildChartPriceWindow(row.price_window_source, row.symbol, row.tf, paneVisibleRange)
            : { schema: CHART_PRICE_WINDOW_SCHEMA, status: "unavailable",
                reason: "price_window_source_not_current" };
          paneRow.presentation = row.presentation ?? {
            schema: CHART_PRESENTATION_SCHEMA, status: "unavailable",
            reason: "presentation_source_not_current",
          };
          paneRow.native_observations = row.native_observations;
        }
        panes.push(paneRow);
      }
      if (panes.length > 1) {
        paneContexts = {
          schema: CHART_PANE_CONTEXT_SCHEMA,
          status: "observed",
          active_pane_id: h.activePaneId,
          pane_count: panes.length,
          control_authority: "active_pane_only",
          panes,
        };
      }
    } catch {
      // Cross-pane evidence is optional, but absence must be explicit rather than
      // silently looking like a complete smaller layout.
      paneContexts = {
        schema: CHART_PANE_CONTEXT_SCHEMA,
        status: "unavailable",
        reason: "pane_context_snapshot_invalid",
      };
    }
    const body = {
      client: "terminal",
      origin_id: identity.origin_id,
      context_revision: identity.context_revision,
      session: {
        symbol: sym,
        tf: h.currentTf,
        pane_id: h.activePaneId,
        indicators: h.sessionIndicators,
        ...(h.hiddenIndicators ? { indicator_visibility: describeIndicatorVisibility(h.sessionIndicators, h.hiddenIndicators) } : {}),
        // True live pan/zoom bounds from paneSync's calendar-window owner.
        visible_range: visibleRange,
        // Loaded-series availability is useful context but is not the viewport.
        data_range: dataRange,
        data_readout: dataReadout,
        price_window: priceWindow,
        presentation,
        native_observations: nativeObservations,
        pane_contexts: paneContexts,
        capabilities: h.capabilities,
        drawings,
      },
      acks,
    };
    const prepared = prepareChartStatePayload(body);
    if (!prepared.ok) return unavailable("state_unavailable"); // identity/receipts stay intact
    acksRef.current = prepared.remainingAcks;
    let resolveDelivery!: (value: ChartStatePreparationResult) => void;
    const completion = new Promise<ChartStatePreparationResult>((resolve) => { resolveDelivery = resolve; });
    const controller = new AbortController();
    const request = { inFlight: true, pending: false, completion,
      retire: () => { controller.abort(); finish({ ok: false, reason: "context_changed" }); } };
    stateRequestRef.current = request;
    let finished = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: ChartStatePreparationResult) => {
      if (finished) return;
      finished = true;
      if (deadline) clearTimeout(deadline);
      // A late response may settle only its own waiter. It must not restore A's
      // ACKs into B, release B's in-flight POST, or schedule B's next upload.
      if (!isCurrentOwner() || stateRequestRef.current !== request) {
        resolveDelivery({ ok: false, reason: "context_changed" }); return;
      }
      if (!result.ok && prepared.sentAcks.length)
        acksRef.current = [...prepared.sentAcks, ...acksRef.current];
      const pending = request.pending;
      stateRequestRef.current = { inFlight: false, pending: false, completion: null };
      // Drain remaining receipt batches after success. After a failure, only an
      // actual new coalesced update justifies another attempt; no periodic retry loop.
      if (mountedRef.current && (pending || (result.ok && acksRef.current.length > 0)))
        scheduleStateRef.current?.(acksRef.current.length ? ACK_DEBOUNCE_MS : VIEWPORT_DEBOUNCE_MS);
      resolveDelivery(result);
    };
    try {
      // A stalled telemetry request must not hold the sole mirror forever. A failed
      // or aborted POST is not a delivered ACK; preserve its original batch identities.
      deadline = setTimeout(() => {
        controller.abort(); finish({ ok: false, reason: "state_post_timeout" });
      }, STATE_POST_TIMEOUT_MS);
      void fetch("/api/brain/chart/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: prepared.text,
      }).then((response) => finish(response.ok
        ? { ok: true, origin_id: identity.origin_id, context_revision: identity.context_revision }
        : { ok: false, reason: response.status === 401 ? "sign_in_required" : "state_post_failed" }),
        () => finish({ ok: false, reason: "state_post_failed" }));
    } catch {
      finish({ ok: false, reason: "state_post_failed" });
    }
    return completion;
  }, [isCurrentOwner]);

  // A new chat turn must survive a quiet chart or gateway restart. Reuse this
  // mirror's sole delivery, then send one fresh snapshot for the captured identity.
  // Cancelling the chat detaches its wait; an unrelated ACK upload keeps running.
  const prepareChartState = useCallback(async (
    expected: ChartStatePreparationRequest, signal?: AbortSignal,
  ): Promise<ChartStatePreparationResult> => {
    const currentFailure = (): ChartStatePreparationResult | null => {
      if (signal?.aborted) return { ok: false, reason: "cancelled" };
      if (!isCurrentOwner()) return { ok: false, reason: "host_unmounted" };
      try {
        hostRef.current.flushContext?.();
        if (!isCurrentOwner()) return { ok: false, reason: "context_changed" };
        if (hostRef.current.drawingOwner.collections[hostRef.current.activeSymbol] === undefined)
          return { ok: false, reason: "state_unavailable" };
        const current = hostRef.current.getContextIdentity();
        if (!expected || current.origin_id !== expected.origin_id
          || current.context_revision !== expected.context_revision)
          return { ok: false, reason: "context_changed" };
      } catch { return { ok: false, reason: "state_unavailable" }; }
      return null;
    };
    let failure = currentFailure();
    if (failure) return failure;
    const previous = stateRequestRef.current.completion;
    if (previous) {
      await waitForChartState(previous, signal);
      failure = currentFailure();
      if (failure) return failure;
    }
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = null;
    stateTimerDelay.current = null;
    const result = await waitForChartState(postState(expected), signal);
    return currentFailure() ?? result;
  }, [isCurrentOwner, postState]);

  const scheduleState = useCallback((delayMs = STATE_DEBOUNCE_MS) => {
    if (!isCurrentOwner()) return;
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
  }, [isCurrentOwner, postState]);
  useLayoutEffect(() => {
    scheduleStateRef.current = scheduleState;
    return () => { scheduleStateRef.current = null; };
  }, [scheduleState]);

  const noteReadoutChange = useCallback(() => scheduleState(), [scheduleState]);
  const noteNativeObservationChange = useCallback(() => scheduleState(VIEWPORT_DEBOUNCE_MS), [scheduleState]);

  // Context targeting (symbol/tf/active pane) mirrors promptly, including the initial mount.
  const contextSig = `${host.activeSymbol}|${host.currentTf}|${host.activePaneId}`;
  useEffect(() => {
    scheduleState(VIEWPORT_DEBOUNCE_MS);
  }, [generation, contextSig, scheduleState]);

  // Indicator/drawing telemetry can stay on the slower coalescing path.
  const userDrawingSig = JSON.stringify(host.userDrawings.map(userDrawingState));
  const contentSig = `${host.sessionIndicators.map((s) => s.name + JSON.stringify(s.params || {})).join(",")}|${JSON.stringify(host.hiddenIndicators ?? [])}|${userDrawingSig}`;
  useEffect(() => {
    scheduleState();
  }, [aiStore, hiddenSyms, contentSig, scheduleState]);
  useEffect(() => () => {
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = null;
    stateTimerDelay.current = null;
  }, []);

  const noteViewport = useCallback((paneId: number, windowMs: { from: number; to: number } | null) => {
    if (!isCurrentOwner()) return;
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
    // Up to four MOUNTED panes share one bounded mirror. Ignore stray/stale pane ids:
    // they may update this local cache but cannot create network churn or evidence.
    const h = hostRef.current;
    let mounted = paneId === h.activePaneId;
    if (!mounted) {
      try { mounted = (h.getPaneContextSnapshots?.() ?? []).some((row) => row.pane_id === paneId); }
      catch { mounted = false; }
    }
    if (mounted) scheduleState(VIEWPORT_DEBOUNCE_MS);
  }, [isCurrentOwner, scheduleState]);

  // ── ack helper ───────────────────────────────────────────────────────────────────────────
  const pushAck = useCallback((a: Ack) => {
    if (!isCurrentOwner()) return;
    acksRef.current.push(a);
    scheduleState(ACK_DEBOUNCE_MS);
  }, [isCurrentOwner, scheduleState]);

  const commitAiObjects = useCallback((symbol: string, objects: AiObject[], layerHidden: boolean) => {
    if (!isCurrentOwner()) return { ok: false as const, error: "drawing_owner_changed" };
    const owner = hostRef.current.drawingOwner;
    if (owner.collections[symbol] === undefined)
      return { ok: false as const, error: "drawing_collection_not_ready" };
    const result = owner.replaceAi(symbol, objects, layerHidden);
    if (!result.ok || !isCurrentOwner()) return result.ok
      ? { ok: false as const, error: "drawing_owner_changed" } : result;
    aiStoreRef.current = { ...aiStoreRef.current, [symbol]: result.objects };
    const hidden = new Set(hiddenSymsRef.current);
    if (layerHidden && result.objects.length) hidden.add(symbol); else hidden.delete(symbol);
    hiddenSymsRef.current = hidden;
    return result;
  }, [isCurrentOwner]);

  // ── the v2 dispatcher ──────────────────────────────────────────────────────────────────────
  const dispatchV2 = useCallback((j: unknown) => {
    if (!isCurrentOwner()) return; // retired principals have no execution authority
    if (!isV2Envelope(j)) return; // not a v2 envelope — caller handles v1 fallback
    const v = validateEnvelope(j);
    if (!v.ok) {
      pushAck({ batch_id: v.batch_id, seq: v.seq, id: v.id, ok: false, error: v.error });
      queue.reportRejection({ op: v.op, id: v.id, error: v.error });
      return;
    }
    const cmd = v.cmd;
    const targetRequired = requiresExactChartTarget(cmd);
    const checkTarget = (): string | null => {
      if (!cmd.target && !targetRequired) return null; // retained legacy behavior
      if (pendingContextRef.current) return "command_target_transition_pending";
      return chartCommandTargetError(cmd.target, currentCommandTarget(hostRef.current), targetRequired);
    };
    const rejectTarget = (error: string): QueueStep => {
      pushAck({ batch_id: cmd.batch_id, seq: cmd.seq, id: cmd.id ?? null, ok: false, error });
      return { op: cmd.op, id: cmd.id ?? null, ok: false, error };
    };
    const targetError = checkTarget();
    if (targetError) { queue.reportRejection(rejectTarget(targetError)); return; }
    const h = hostRef.current;
    const res = translate(cmd, h.capabilities, h.sessionIndicators);
    if (!res.ok) {
      pushAck({ batch_id: cmd.batch_id, seq: cmd.seq, id: cmd.id ?? null, ok: false, error: res.error });
      queue.reportRejection({ op: cmd.op, id: cmd.id ?? null, error: res.error });
      return;
    }

    // Enqueue the side-effect. The queue applies sequentially (instant by default; W3 paces it later).
    queue.enqueue((): QueueStep => {
      // No auto-retargeting, requeue or replay. A valid receipt-time target may have
      // changed while this command waited; refuse BEFORE any store or host mutation.
      if (!isCurrentOwner()) return { op: cmd.op, id: cmd.id ?? null, ok: false, error: "command_receiver_unmounted" };
      try { hostRef.current.flushContext?.(); }
      catch { return rejectTarget("chart_context_commit_unavailable"); }
      if (!isCurrentOwner()) return { op: cmd.op, id: cmd.id ?? null, ok: false, error: "drawing_owner_changed" };
      const targetError = checkTarget();
      if (targetError) return rejectTarget(targetError);
      const predecessor = currentCommandTarget(hostRef.current);
      if (cmd.op === "draw.tool" && isAiNativeDrawingKind(cmd.args?.kind) && res.draw?.[0]) {
        const host = hostRef.current;
        let source: ChartPriceWindowSource | null = null;
        try { source = host.getRenderedPriceWindowSource?.() ?? null; } catch { /* explicit unavailable below */ }
        const error = nativeDrawingAnchorError(cmd.args.kind,
          res.draw[0].points.map(point => ({ t: Number(point.t), p: point.p })), source, host.activeSymbol, host.currentTf);
        if (error) return rejectTarget(error);
      }
      // Run the PURE reducer against the synchronous working store, commit the result to both the ref
      // (so the next queued draw sees it) and React state (for render), then apply the chart.* effect.
      // Rebase a patch on the committed host at EXECUTION time, not on a snapshot
      // taken while a paced queue (or a human edit) was still ahead of this command.
      const applied = cmd.op === "chart.set_indicators" && cmd.args?.mode === "patch"
        ? translate(cmd, hostRef.current.capabilities, hostRef.current.sessionIndicators)
        : res;
      const r = applyToStore(aiStoreRef.current, hostRef.current.activeSymbol, cmd, applied);
      if (r.store !== aiStoreRef.current) {
        const symbol = hostRef.current.activeSymbol;
        const accepted = commitAiObjects(symbol, r.store[symbol] ?? [], hiddenSymsRef.current.has(symbol));
        if (!accepted.ok) return rejectTarget(accepted.error);
      }
      const e: StoreEffect = r.effect;
      if (e) {
        const h = hostRef.current;
        switch (e.kind) {
          case "setSymbol":
            if (e.symbol.trim().toUpperCase() !== h.activeSymbol.trim().toUpperCase())
              pendingContextRef.current = { symbol: h.activeSymbol, tf: h.currentTf };
            try { h.setSymbol(e.symbol); }
            catch {
              // A throwing setter may have started a transition. Keep the guard closed
              // until a committed context change; an error is not proof of no effect.
              return rejectTarget("chart_context_application_failed");
            }
            break;
          case "setTf":
            if (e.tf !== h.currentTf)
              pendingContextRef.current = { symbol: h.activeSymbol, tf: h.currentTf };
            try { h.setTf(e.tf); }
            catch { return rejectTarget("chart_context_application_failed"); }
            break;
          case "setIndicators":
            try {
              if (e.visibility && !h.hiddenIndicators) return rejectTarget("indicator_visibility_unavailable");
              if (e.visibility && h.hiddenIndicators) {
                const projected = updateIndicatorVisibility(h.hiddenIndicators, h.sessionIndicators, e.indicators, e.visibility);
                const state = describeIndicatorVisibility(e.indicators, projected);
                if (e.visibility.show.some(name => state.effective_hidden.includes(name)))
                  return rejectTarget("visibility_blocked_by_hidden_parent");
              }
              if (e.visibility) h.setIndicators(e.indicators, e.visibility);
              else h.setIndicators(e.indicators);
              // The next same-tick queued patch sees this accepted configuration even
              // before React commits the corresponding host render. No second store.
              if (!h.flushContext)
                hostRef.current = { ...hostRef.current, sessionIndicators: e.indicators,
                  ...(h.hiddenIndicators ? { hiddenIndicators: updateIndicatorVisibility(h.hiddenIndicators, h.sessionIndicators, e.indicators, e.visibility) } : {}) };
            } catch {
              pushAck({ ...r.ack, ok: false, error: "indicator_application_failed" });
              return { op: cmd.op, id: null, ok: false, error: "indicator_application_failed" };
            }
            break;
          case "setRange":
            try {
              if (h.setRange(e.from, e.to) === false)
                return rejectTarget("chart_range_not_representable");
            } catch { return rejectTarget("chart_range_application_failed"); }
            break;
          case "scene": break; // markers only — inert now (W3 consumes)
        }
      }
      if (!isCurrentOwner()) return { op: cmd.op, id: cmd.id ?? null, ok: false, error: "drawing_owner_changed" };
      if (r.ack.ok && cmd.target && hostRef.current.flushContext) {
        const successor = currentCommandTarget(hostRef.current);
        const expectedSymbol = e?.kind === "setSymbol" ? e.symbol.trim().toUpperCase() : cmd.target.symbol;
        const expectedTf = e?.kind === "setTf" ? e.tf : cmd.target.tf;
        const settingsMatch = e?.kind !== "setIndicators" || (
          e.indicators.length === hostRef.current.sessionIndicators.length
          && e.indicators.every(spec => {
            const actual = hostRef.current.sessionIndicators.find(row => row.name === spec.name);
            return actual && Object.entries(spec.params ?? {}).every(([key, value]) => actual.params?.[key] === value);
          })
          && (!e.visibility || (!!hostRef.current.hiddenIndicators
            && e.visibility.show.every(name => !describeIndicatorVisibility(hostRef.current.sessionIndicators,
              hostRef.current.hiddenIndicators!).effective_hidden.includes(name))
            && e.visibility.hide.every(name => hostRef.current.hiddenIndicators!.includes(name))))
        );
        const contextEffect = e?.kind === "setSymbol" || e?.kind === "setTf" || e?.kind === "setIndicators";
        const revisionDelta = successor && predecessor
          ? successor.context_revision - predecessor.context_revision : -1;
        if (!predecessor || !successor || chartCommandTargetError(cmd.target, predecessor, true)
            || successor.origin_id !== predecessor.origin_id || successor.pane_id !== predecessor.pane_id
            || successor.symbol !== expectedSymbol || successor.tf !== expectedTf || !settingsMatch
            || (contextEffect ? revisionDelta < 0 || revisionDelta > 1 : revisionDelta !== 0)
            || ((expectedSymbol !== predecessor.symbol || expectedTf !== predecessor.tf) && revisionDelta !== 1)) {
          return rejectTarget("chart_context_receipt_failed");
        }
        r.ack.application = { schema: "chart.command_application.v1", predecessor, successor };
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
      return { op: cmd.op, id: cmd.id ?? null, caption: res.ok ? res.caption : undefined, ok: r.ack.ok, error: r.ack.error, fit, anchor };
    }, () => {
      // User cancellation consumes this pending command without calling a chart setter
      // or the AI drawing reducer. Reuse the same exact batch/seq ACK transport.
      if (!isCurrentOwner()) return {
        op: cmd.op, id: cmd.id ?? null, ok: false, error: "command_receiver_unmounted",
      };
      return rejectTarget("command_cancelled_by_user");
    }, cmd.batch_id);
  }, [commitAiObjects, isCurrentOwner, queue, pushAck]);

  // ── AI drawings for a symbol (merged into ChartPane), respecting the eye-toggle ──────────────
  const aiDrawingsFor = useCallback((symbol: string): Drawing[] => {
    if (!isCurrentOwner() || hiddenSyms.has(symbol)) return [];
    return (aiStore[symbol] ?? []).filter(object => !object.hidden);
  }, [aiStore, hiddenSyms, isCurrentOwner]);

  // The manager is a projection of this same store, scoped to the committed active symbol.
  const activeSym = host.activeSymbol;
  // Each committed chart scope owns its own editor lifetime. A → B → A must
  // retire the first A callback even if the visible symbol is A again.
  const editScope = useMemo(() => ({
    symbol: activeSym, tf: host.currentTf, paneId: host.activePaneId, live: false,
  }), [generation, activeSym, host.currentTf, host.activePaneId]);
  useLayoutEffect(() => {
    editScope.live = true;
    return () => { editScope.live = false; };
  }, [editScope]);
  const legend = useMemo(() => ({
    count: (aiStore[activeSym] ?? []).length,
    objects: aiStore[activeSym] ?? [],
    hidden: hiddenSyms.has(activeSym),
    toggleHidden: () => {
      if (!isCurrentOwner() || hostRef.current.activeSymbol !== activeSym) return;
      const accepted = commitAiObjects(activeSym, aiStoreRef.current[activeSym] ?? [], !hiddenSymsRef.current.has(activeSym));
      if (accepted.ok) scheduleState();
    },
    clear: () => {
      if (!isCurrentOwner() || hostRef.current.activeSymbol !== activeSym) return;
      const accepted = commitAiObjects(activeSym, [], false);
      if (accepted.ok) scheduleState();
    },
    editObjects: (ids: readonly string[], edit: AiObjectEdit) => {
      const current = hostRef.current;
      if (!isCurrentOwner() || !editScope.live || pendingContextRef.current
          || current.activeSymbol !== editScope.symbol
          || current.currentTf !== editScope.tf
          || current.activePaneId !== editScope.paneId) return false;
      const objects = editAiObjects(aiStoreRef.current[activeSym] ?? [], ids, edit);
      if (!objects) return false;
      const accepted = commitAiObjects(activeSym, objects, hiddenSymsRef.current.has(activeSym));
      if (accepted.ok) scheduleState();
      return accepted.ok;
    },
  }), [aiStore, hiddenSyms, activeSym, editScope, commitAiObjects, isCurrentOwner, scheduleState]);

  return { get context() { return isCurrentOwner() ? contextRef.current : null; }, dispatchV2, prepareChartState, noteViewport, noteReadoutChange, noteNativeObservationChange, aiDrawingsFor, legend, queue };
}

// A waiting turn can leave without cancelling the mirror or consuming its ACKs.
function waitForChartState(
  completion: Promise<ChartStatePreparationResult>, signal?: AbortSignal,
): Promise<ChartStatePreparationResult> {
  if (!signal) return completion;
  if (signal.aborted) return Promise.resolve({ ok: false, reason: "cancelled" });
  return new Promise((resolve) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve({ ok: false, reason: "cancelled" }); };
    signal.addEventListener("abort", abort, { once: true });
    completion.then((result) => { signal.removeEventListener("abort", abort); resolve(result); });
  });
}

// Read only the incumbent provider/host. A failed identity read cannot silently fall
// back to legacy targeting, and no new origin, revision counter or pane registry is created.
function currentCommandTarget(host: ChartBusHost): ChartCommandTarget | null {
  try {
    const identity = host.getContextIdentity();
    return readChartCommandTarget({ schema: CHART_COMMAND_TARGET_SCHEMA,
      origin_id: identity.origin_id, context_revision: identity.context_revision,
      pane_id: host.activePaneId, symbol: host.activeSymbol, tf: host.currentTf });
  } catch { return null; }
}

// ── shape helpers for the state mirror ──────────────────────────────────────────────────────────
// Native constructions retain their closed contract; legacy compound children
// remain separately addressable geometries under the exact logical command id.
function aiArgs(o: AiObject): Record<string, unknown> {
  if (o.op === "draw.tool") {
    const native = nativeDrawingStateArgs(o);
    if (native) return native;
  }
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

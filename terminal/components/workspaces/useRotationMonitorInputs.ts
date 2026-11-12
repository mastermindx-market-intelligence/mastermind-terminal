"use client";

import { useEffect, useMemo, useState } from "react";
import { sectorRegularSession } from "@/lib/sectorRegularReading";
import { ROTATION_BENCHMARK, ROTATION_SYMBOLS } from "@/lib/rotationMonitor";

const SYMBOLS = [ROTATION_BENCHMARK, ...ROTATION_SYMBOLS] as const;
export type RotationReadState = "idle" | "loading" | "ready" | "partial" | "unavailable" | "access" | "paused";
type Inputs = {
  quotes: Record<string, unknown>;
  histories: Record<string, unknown>;
  quoteState: RotationReadState;
  historyState: RotationReadState;
  quoteReceivedAt: number | null;
  historyReceivedAt: number | null;
  nowMs: number;
};
const empty = (nowMs = 0): Inputs => ({
  quotes: {}, histories: {}, quoteState: "idle", historyState: "idle",
  quoteReceivedAt: null, historyReceivedAt: null, nowMs,
});
const record = (raw: unknown): Record<string, unknown> | null =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
function backoff(response: Response, floor: number): number {
  const raw = response.headers.get("Retry-After");
  if (raw === null) return floor;
  const seconds = Number(raw);
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(requested) ? Math.max(floor, Math.min(requested, 300_000)) : floor;
}

/**
 * Visible-view consumption of the incumbent authenticated quote and bar endpoints.
 * One flight per lane, no new upstream, history store, event ledger or background task.
 * Transport receipts are kept apart from the source clocks inside the returned data.
 */
export function useRotationMonitorInputs(accountId: string | null, enabled: boolean): Inputs {
  const owner = useMemo(() => ({ accountId, enabled }), [accountId, enabled]);
  const [received, setReceived] = useState<{ owner: typeof owner; inputs: Inputs } | null>(null);

  useEffect(() => {
    if (!owner.accountId || !owner.enabled) return;
    let disposed = false, denied = false, generation = 0;
    let quoteRequest: AbortController | null = null, historyRequest: AbortController | null = null;
    let quoteTimer: ReturnType<typeof setTimeout> | undefined;
    let historyTimer: ReturnType<typeof setTimeout> | undefined;
    const active = () => !disposed && !denied && !document.hidden;
    function publish(patch: Partial<Inputs>) {
      if (!active()) return;
      setReceived(previous => ({ owner, inputs: {
        ...(previous?.owner === owner ? previous.inputs : empty()), ...patch, nowMs: Date.now(),
      } }));
    }
    function cancel() {
      clearTimeout(quoteTimer); clearTimeout(historyTimer);
      quoteRequest?.abort(); historyRequest?.abort();
      quoteRequest = null; historyRequest = null;
      generation++;
    }
    function deny() {
      if (disposed) return;
      denied = true; cancel();
      setReceived({ owner, inputs: { ...empty(Date.now()), quoteState: "access", historyState: "access" } });
    }
    async function quotes() {
      if (!active() || quoteRequest) return;
      const controller = new AbortController(), current = generation;
      quoteRequest = controller;
      const deadline = setTimeout(() => {
        if (active() && quoteRequest === controller && current === generation)
          publish({ quotes: {}, quoteState: "unavailable", quoteReceivedAt: null });
        controller.abort();
      }, 8_000);
      let delay = 5_000;
      try {
        const params = new URLSearchParams({ view: "regular", syms: SYMBOLS.join(",") });
        const response = await fetch("/api/quote?" + params, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (!active() || current !== generation || controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { deny(); return; }
        if (!response.ok) {
          delay = backoff(response, 15_000);
          publish({ quotes: {}, quoteState: "unavailable", quoteReceivedAt: null });
          return;
        }
        const payload = record(await response.json()), raw = record(payload?.quotes);
        if (!raw || payload?.truncated) throw new Error("incomplete quote envelope");
        if (!active() || current !== generation || controller.signal.aborted) return;
        const selected = Object.fromEntries(SYMBOLS.map(symbol => [symbol, raw[symbol] ?? null]));
        publish({ quotes: selected, quoteState: "ready", quoteReceivedAt: Date.now() });
        if (sectorRegularSession(Date.now())?.open === false) delay = 60_000;
      } catch {
        if (active() && current === generation) {
          publish({ quotes: {}, quoteState: "unavailable", quoteReceivedAt: null });
          delay = 15_000;
        }
      } finally {
        clearTimeout(deadline);
        if (quoteRequest === controller) {
          quoteRequest = null;
          if (active()) quoteTimer = setTimeout(quotes, delay);
        }
      }
    }
    async function history() {
      if (!active() || historyRequest) return;
      const session = sectorRegularSession(Date.now());
      if (!session) {
        publish({ histories: {}, historyState: "unavailable", historyReceivedAt: null });
        historyTimer = setTimeout(history, 60_000);
        return;
      }
      const controller = new AbortController(), current = generation;
      historyRequest = controller;
      const deadline = setTimeout(() => {
        if (active() && historyRequest === controller && current === generation)
          publish({ histories: {}, historyState: "unavailable", historyReceivedAt: null });
        controller.abort();
      }, 30_000);
      const histories: Record<string, unknown> = {};
      let cursor = 0, failures = 0, delay = 60_000;
      try {
        // Twelve current-session reads, at most three concurrently. Never reload full history.
        async function lane() {
          while (active() && current === generation && !controller.signal.aborted) {
            const symbol = SYMBOLS[cursor++];
            if (!symbol) return;
            try {
              const params = new URLSearchParams({ sym: symbol, tf: "5m", ext: "0", date: session!.date });
              const response = await fetch("/api/intraday?" + params, {
                credentials: "same-origin", cache: "no-store", signal: controller.signal,
              });
              if (!active() || current !== generation || controller.signal.aborted) return;
              if (response.status === 401 || response.status === 403) { deny(); return; }
              if (!response.ok) { failures++; delay = Math.max(delay, backoff(response, 60_000)); continue; }
              const payload: unknown = await response.json();
              if (record(payload)) histories[symbol] = payload;
              else failures++;
            } catch {
              if (!controller.signal.aborted) failures++;
            }
          }
        }
        await Promise.all([lane(), lane(), lane()]);
        if (!active() || current !== generation || controller.signal.aborted) return;
        // A response begun before the next session must not become that session's read.
        if (sectorRegularSession(Date.now())?.date !== session.date) {
          publish({ histories: {}, historyState: "loading", historyReceivedAt: null });
          delay = 1_000;
          return;
        }
        publish({ histories, historyState: failures ? Object.keys(histories).length ? "partial" : "unavailable" : "ready",
          historyReceivedAt: Date.now() });
      } finally {
        clearTimeout(deadline);
        if (historyRequest === controller) {
          if (controller.signal.aborted && active() && current === generation)
            publish({ histories: {}, historyState: "unavailable", historyReceivedAt: null });
          historyRequest = null;
          if (active()) historyTimer = setTimeout(history, delay);
        }
      }
    }
    function visibility() {
      if (disposed || denied) return;
      cancel();
      setReceived({ owner, inputs: { ...empty(Date.now()),
        quoteState: document.hidden ? "paused" : "loading",
        historyState: document.hidden ? "paused" : "loading",
      } });
      if (!document.hidden) { void quotes(); void history(); }
    }
    visibility();
    const presentationTimer = setInterval(() => { if (active()) publish({}); }, 5_000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true; cancel(); clearInterval(presentationTimer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [owner]);

  return owner.accountId && owner.enabled && received?.owner === owner ? received.inputs : empty();
}

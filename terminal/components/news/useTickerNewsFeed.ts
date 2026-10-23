"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseTickerNewsChange,
  parseTickerNewsSnapshot,
  parseEditorialView,
  requireSameEditorialView,
  type TickerNewsViewMode,
  type TickerNewsEditorialView,
  type TickerNewsSnapshot,
} from "@/lib/newsContract";

export type TickerNewsLoadState = "loading" | "restricted" | "unavailable" | "ready";

function newestSequence(snapshot: TickerNewsSnapshot): number {
  return snapshot.change_sequence ?? snapshot.rows.reduce((max, row) => Math.max(max, row.sequence), 0);
}

export function useTickerNewsFeed(symbol: string, view: TickerNewsViewMode = "news") {
  const key = JSON.stringify([symbol, view]);
  const [reload, setReload] = useState(0);
  // Re-entering the same ticker/view is a new activation. Adjust during render
  // so an earlier activation cannot briefly become ready before effects run.
  const [activation, setActivation] = useState(() => ({ key, reload, id: 0 }));
  const activationMatches = activation.key === key && activation.reload === reload;
  if (!activationMatches) setActivation({ key, reload, id: activation.id + 1 });
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<TickerNewsSnapshot | null>(null);
  const [loadState, setLoadState] = useState<{ key: string; activation: number; state: TickerNewsLoadState }>(
    () => ({ key, activation: activation.id, state: "loading" }),
  );
  const [liveInterrupted, setLiveInterrupted] = useState(false);

  const loadSnapshot = useCallback(async (
    expectedGeneration: number,
    controller: AbortController,
    background: boolean,
    isLatest: () => boolean,
    clearInterruptedOnSuccess: boolean,
    isStreamClosed: () => boolean,
    acceptedView: TickerNewsEditorialView | null,
    onReset: () => void,
  ): Promise<TickerNewsSnapshot | null> => {
    const stale = () =>
      controller.signal.aborted ||
      generation.current !== expectedGeneration ||
      !isLatest();
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(symbol)}?limit=20&view=${view}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (stale()) return null;
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          detail = String(body?.detail || body?.error || "");
        } catch {
          detail = "";
        }
        if (stale()) return null;
        const restricted =
          res.status === 401 ||
          res.status === 403 ||
          /rights|access|unauth/i.test(detail);
        if (restricted) {
          setSnapshot(null);
          setLoadState({ key, activation: activation.id, state: "restricted" });
          return null;
        }
        // Master contract: a failed load ends unavailable whether initial or background; only the
        // initial load also clears the snapshot (the panel hides rows whenever state is not ready).
        if (!background) setSnapshot(null);
        setLoadState({ key, activation: activation.id, state: "unavailable" });
        return null;
      }
      const parsed = parseTickerNewsSnapshot(await res.json());
      if (stale()) return null;
      if (parsed.ticker !== symbol.toUpperCase() || parsed.editorial_view?.mode !== view) {
        setSnapshot(null);
        setLoadState({ key, activation: activation.id, state: "unavailable" });
        return null;
      }
      if (acceptedView && parsed.editorial_view.revision !== acceptedView.revision) {
        onReset();
        return null;
      }
      setSnapshot(parsed);
      setLoadState({ key, activation: activation.id, state: "ready" });
      if ((!background || clearInterruptedOnSuccess) && !isStreamClosed()) {
        setLiveInterrupted(false);
      }
      return parsed;
    } catch {
      if (stale()) return null;
      setLoadState({ key, activation: activation.id, state: "unavailable" });
      return null;
    }
  }, [symbol, view, key, activation.id]);

  useEffect(() => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    const controller = new AbortController();
    let events: EventSource | null = null;
    let alive = true;
    // Overlapping refreshes share one generation, so only the newest request may publish.
    let requestSerial = 0;
    let reconnectPending = false;
    let streamClosed = false;
    let acceptedView: TickerNewsEditorialView | null = null;

    const restart = () => {
      if (!alive || streamClosed || generation.current !== currentGeneration) return;
      streamClosed = true;
      requestSerial += 1;
      events?.close();
      controller.abort();
      setSnapshot(null);
      setLoadState({ key, activation: activation.id, state: "loading" });
      setLiveInterrupted(false);
      setReload((value) => value + 1);
    };

    const issue = (background: boolean, clearInterruptedOnSuccess = false) => {
      const requestId = ++requestSerial;
      return loadSnapshot(
        currentGeneration,
        controller,
        background,
        () => alive && requestId === requestSerial,
        clearInterruptedOnSuccess,
        () => streamClosed,
        acceptedView,
        restart,
      );
    };

    const refreshFromChange = async (event: Event) => {
      const message = event as MessageEvent;
      try {
        const change = parseTickerNewsChange(JSON.parse(message.data));
        if (acceptedView) {
          try { requireSameEditorialView(acceptedView, change.editorial_view); }
          catch { restart(); return; }
        }
      } catch {
        return;
      }
      if (!alive || streamClosed || generation.current !== currentGeneration) return;
      // A delivered change event proves the stream is live again, so a successful catch-up
      // refresh also clears a stale interrupted note (e.g. after a failed re-open refresh).
      await issue(true, true);
    };

    void (async () => {
      const initial = await issue(false);
      if (!initial || !alive || generation.current !== currentGeneration) return;
      acceptedView = initial.editorial_view ?? null;
      if (typeof EventSource === "undefined" || !acceptedView) return;
      events = new EventSource(
        `/api/news/stream?symbol=${encodeURIComponent(symbol)}&after_sequence=${newestSequence(initial)}&view=${view}&view_revision=${acceptedView.revision}`,
      );
      events.addEventListener("upsert", refreshFromChange);
      events.addEventListener("remove", refreshFromChange);
      events.addEventListener("reset", (event) => {
        if (!alive || streamClosed || generation.current !== currentGeneration) return;
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          if (payload.schema !== "ticker_news.reset.v1" || payload.ticker !== symbol.toUpperCase()) return;
          const nextView = parseEditorialView(payload.editorial_view);
          if (!nextView || nextView.mode !== view) return;
          restart();
        } catch { /* malformed events cannot replace the current context */ }
      });
      events.addEventListener("restricted", () => {
        if (!alive || generation.current !== currentGeneration) return;
        // A rights revocation invalidates every refresh already in flight.
        requestSerial += 1;
        streamClosed = true;
        setSnapshot(null);
        setLoadState({ key, activation: activation.id, state: "restricted" });
        events?.close();
      });
      events.addEventListener("unavailable", () => {
        if (!alive || generation.current !== currentGeneration) return;
        streamClosed = true;
        setLiveInterrupted(true);
        events?.close();
      });
      events.onerror = () => {
        if (!alive || generation.current !== currentGeneration || streamClosed) return;
        reconnectPending = true;
        setLiveInterrupted(true);
      };
      events.onopen = () => {
        if (!alive || generation.current !== currentGeneration || streamClosed) return;
        if (!reconnectPending) return;
        reconnectPending = false;
        void issue(true, true);
      };
    })();

    return () => {
      alive = false;
      controller.abort();
      events?.close();
    };
  }, [loadSnapshot, symbol, view, key, reload, activation.id]);

  const currentActivation = activationMatches && loadState.key === key && loadState.activation === activation.id;
  const activeSnapshot =
    currentActivation && snapshot?.ticker === symbol.toUpperCase() && snapshot.editorial_view?.mode === view ? snapshot : null;
  const effectiveLoadState: TickerNewsLoadState =
    currentActivation ? loadState.state : "loading";

  const refresh = useCallback(() => {
    generation.current += 1;
    setSnapshot(null);
    setLoadState({ key, activation: activation.id, state: "loading" });
    setReload((value) => value + 1);
  }, [key, activation.id]);

  return { snapshot: activeSnapshot, loadState: effectiveLoadState, liveInterrupted: currentActivation && liveInterrupted, refresh };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseTickerNewsChange,
  parseTickerNewsSnapshot,
  type TickerNewsSnapshot,
} from "@/lib/newsContract";

export type TickerNewsLoadState = "loading" | "restricted" | "unavailable" | "ready";

function newestSequence(snapshot: TickerNewsSnapshot): number {
  return snapshot.rows.reduce((max, row) => Math.max(max, row.sequence), 0);
}

export function useTickerNewsFeed(symbol: string) {
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<TickerNewsSnapshot | null>(null);
  const [loadState, setLoadState] = useState<{ symbol: string; state: TickerNewsLoadState }>(
    () => ({ symbol, state: "loading" }),
  );
  const [liveInterrupted, setLiveInterrupted] = useState(false);

  const loadSnapshot = useCallback(async (
    expectedGeneration: number,
    controller: AbortController,
    background: boolean,
    isLatest: () => boolean,
    clearInterruptedOnSuccess: boolean,
    isStreamClosed: () => boolean,
  ): Promise<TickerNewsSnapshot | null> => {
    const stale = () =>
      controller.signal.aborted ||
      generation.current !== expectedGeneration ||
      !isLatest();
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(symbol)}?limit=20`, {
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
          setLoadState({ symbol, state: "restricted" });
          return null;
        }
        if (background) {
          setLiveInterrupted(true);
          return null;
        }
        setSnapshot(null);
        setLoadState({ symbol, state: "unavailable" });
        return null;
      }
      const parsed = parseTickerNewsSnapshot(await res.json());
      if (stale()) return null;
      if (parsed.ticker !== symbol.toUpperCase()) {
        if (!background) {
          setSnapshot(null);
          setLoadState({ symbol, state: "unavailable" });
        }
        return null;
      }
      setSnapshot(parsed);
      setLoadState({ symbol, state: "ready" });
      if ((!background || clearInterruptedOnSuccess) && !isStreamClosed()) {
        setLiveInterrupted(false);
      }
      return parsed;
    } catch {
      if (stale()) return null;
      if (background) {
        setLiveInterrupted(true);
        return null;
      }
      setLoadState({ symbol, state: "unavailable" });
      return null;
    }
  }, [symbol]);

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

    const issue = (background: boolean, clearInterruptedOnSuccess = false) => {
      const requestId = ++requestSerial;
      return loadSnapshot(
        currentGeneration,
        controller,
        background,
        () => alive && requestId === requestSerial,
        clearInterruptedOnSuccess,
        () => streamClosed,
      );
    };

    const refreshFromChange = async (event: Event) => {
      const message = event as MessageEvent;
      try {
        parseTickerNewsChange(JSON.parse(message.data));
      } catch {
        return;
      }
      if (!alive || streamClosed || generation.current !== currentGeneration) return;
      await issue(true);
    };

    void (async () => {
      const initial = await issue(false);
      if (!initial || !alive || generation.current !== currentGeneration) return;
      if (typeof EventSource === "undefined") return;
      events = new EventSource(
        `/api/news/stream?symbol=${encodeURIComponent(symbol)}&after_sequence=${newestSequence(initial)}`,
      );
      events.addEventListener("upsert", refreshFromChange);
      events.addEventListener("remove", refreshFromChange);
      events.addEventListener("restricted", () => {
        if (!alive || generation.current !== currentGeneration) return;
        // A rights revocation invalidates every refresh already in flight.
        requestSerial += 1;
        streamClosed = true;
        setSnapshot(null);
        setLoadState({ symbol, state: "restricted" });
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
  }, [loadSnapshot, symbol]);

  const activeSnapshot =
    snapshot?.ticker === symbol.toUpperCase() ? snapshot : null;
  const effectiveLoadState: TickerNewsLoadState =
    loadState.symbol === symbol ? loadState.state : "loading";

  return { snapshot: activeSnapshot, loadState: effectiveLoadState, liveInterrupted };
}

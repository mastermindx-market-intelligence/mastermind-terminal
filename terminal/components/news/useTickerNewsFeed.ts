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
  ): Promise<TickerNewsSnapshot | null> => {
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(symbol)}?limit=50`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (generation.current !== expectedGeneration) return null;
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          detail = String(body?.detail || body?.error || "");
        } catch {
          detail = "";
        }
        if (generation.current !== expectedGeneration) return null;
        const restricted =
          res.status === 401 ||
          res.status === 403 ||
          /rights|access|unauth/i.test(detail);
        if (!background) setSnapshot(null);
        setLoadState({ symbol, state: restricted ? "restricted" : "unavailable" });
        return null;
      }
      const parsed = parseTickerNewsSnapshot(await res.json());
      if (
        generation.current !== expectedGeneration ||
        parsed.ticker !== symbol.toUpperCase()
      ) {
        return null;
      }
      setSnapshot(parsed);
      setLoadState({ symbol, state: "ready" });
      if (!background) setLiveInterrupted(false);
      return parsed;
    } catch {
      if (controller.signal.aborted || generation.current !== expectedGeneration) {
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

    const refreshFromChange = async (event: Event) => {
      const message = event as MessageEvent;
      try {
        parseTickerNewsChange(JSON.parse(message.data));
      } catch {
        return;
      }
      if (!alive || generation.current !== currentGeneration) return;
      await loadSnapshot(currentGeneration, controller, true);
    };

    void (async () => {
      const initial = await loadSnapshot(currentGeneration, controller, false);
      if (!initial || !alive || generation.current !== currentGeneration) return;
      if (typeof EventSource === "undefined") return;
      events = new EventSource(
        `/api/news/stream?symbol=${encodeURIComponent(symbol)}&after_sequence=${newestSequence(initial)}`,
      );
      events.addEventListener("upsert", refreshFromChange);
      events.addEventListener("remove", refreshFromChange);
      events.addEventListener("restricted", () => {
        if (!alive || generation.current !== currentGeneration) return;
        setLoadState({ symbol, state: "restricted" });
        events?.close();
      });
      events.addEventListener("unavailable", () => {
        if (!alive || generation.current !== currentGeneration) return;
        setLiveInterrupted(true);
        events?.close();
      });
      events.onerror = () => {
        if (alive && generation.current === currentGeneration) {
          setLiveInterrupted(true);
        }
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
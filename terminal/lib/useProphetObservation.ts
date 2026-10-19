"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { decodeProphetObservations, isProphetTicker, type ProphetObservationRead, type ProphetReadStatus } from "./prophetObservations";

/** One active-symbol read. No shared/public cache, local storage, watcher, or interval. */
export function useProphetObservation(symbol: string, account: string | null): ProphetObservationRead {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ProphetObservationRead>({ symbol, account, status: "loading", data: null });
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const reset = (status: ProphetReadStatus) => setState({ symbol, account, status, data: null });
    if (!isProphetTicker(symbol)) { reset("unsupported"); return; }
    if (!account) { reset("unauthenticated"); return; }
    reset("loading");
    // Wait for the browser session to match the server account before any request.
    let active = true, sequence = 0, permitted = false, lastStarted = -Infinity;
    let current: AbortController | null = null;
    const cancelCurrent = () => current?.abort();
    const receive = (status: ProphetReadStatus) => { if (active) reset(status); };
    const initialAuthTimer = setTimeout(() => {
      if (active && !permitted) receive("unavailable");
    }, 12_000);
    const read = async (force = false) => {
      if (!active || !permitted || document.visibilityState !== "visible" || (!force && Date.now() - lastStarted < 60_000)) return;
      lastStarted = Date.now();
      const ticket = ++sequence;
      current?.abort();
      const request = new AbortController(); current = request;
      receive("loading");
      const timer = setTimeout(() => {
        request.abort();
        if (active && ticket === sequence) { sequence++; receive("unavailable"); }
      }, 12_000);
      try {
        const response = await fetch(`/api/prophet/observations?ticker=${encodeURIComponent(symbol)}`, {
          method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: request.signal,
          headers: { Accept: "application/json" },
        });
        if (!active || !permitted || ticket !== sequence) return;
        if (response.status === 401) { receive("unauthenticated"); return; }
        if (response.status === 403) { receive("forbidden"); return; }
        if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) { receive("unavailable"); return; }
        const raw: unknown = await response.json();
        if (!active || !permitted || ticket !== sequence) return;
        const data = decodeProphetObservations(raw, symbol);
        if (!data) { receive("unavailable"); return; }
        setState({ symbol, account, status: "ready", data });
      } catch {
        if (active && permitted && ticket === sequence) receive("unavailable");
      } finally { clearTimeout(timer); request.abort(); }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      const client = createClient();
      const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        clearTimeout(initialAuthTimer);
        if (!session?.user || session.user.id !== account) {
          permitted = false; sequence++; current?.abort(); receive("unauthenticated"); return;
        }
        const resumed = !permitted; permitted = true;
        // A native auth event is an invalidation edge, not another session authority.
        if (resumed || event === "TOKEN_REFRESHED") void read(true);
        else if (event === "SIGNED_IN") void read();
      });
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      clearTimeout(initialAuthTimer); permitted = false; sequence++; cancelCurrent(); receive("unavailable");
      return () => { active = false; current?.abort(); };
    }
    const focus = () => { void read(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false; clearTimeout(initialAuthTimer); sequence++; current?.abort(); unsubscribe?.();
      window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus);
    };
  }, [symbol, account, attempt]);
  // Effects run after paint. Never display an outgoing account/symbol even for one frame.
  const current = state.symbol === symbol && state.account === account
    ? state : { symbol, account, status: "loading" as const, data: null };
  return { ...current, retry };
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { flowGetFresh } from "@/lib/flowClientCache";

/** One cache owner, bounded polling only while this visible perspective is mounted.
 * A late response is fenced by both effect lifetime and feed identity. Failure may retain
 * a clearly dated same-root snapshot; a new root never inherits another root's values.
 */
export function useOptionsSnapshot(feed: string) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ feed: string; data: unknown; loading: boolean; failed: boolean }>(
    { feed: "", data: null, loading: true, failed: false },
  );
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    let active = true, inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      setState((previous) => ({ feed, data: previous.feed === feed ? previous.data : null, loading: true, failed: false }));
      let data: unknown = null;
      try { data = await flowGetFresh(feed); } catch { /* shared source can be temporarily unavailable */ }
      inFlight = false;
      if (!active) return;
      setState((previous) => ({ feed, data: data ?? (previous.feed === feed ? previous.data : null), loading: false, failed: data == null }));
    };
    void load();
    const timer = setInterval(() => { void load(); }, 120_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [feed, version]);
  return state.feed === feed ? { ...state, refresh } : { data: null, loading: true, failed: false, refresh };
}

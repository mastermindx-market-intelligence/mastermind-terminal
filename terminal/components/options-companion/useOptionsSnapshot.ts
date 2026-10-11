"use client";
import { useCallback, useEffect, useState } from "react";
import type { UnavailableReason } from "@/lib/dataCache";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";

/** Discriminated read of one options feed. `data` / `loading` / `failed` stay for
 * existing consumers: a refresh that did not land may still retain a same-root snapshot.
 * A 403 is `unavailable` here; not-entitled copy is the `access` prop, never a FlowOutcome.
 */
export type OptionsSnapshotState =
  | { status: "loading"; data: unknown; reason?: undefined }
  | { status: "data"; data: unknown; reason?: undefined }
  | { status: "absent"; data: unknown; reason?: undefined }
  | { status: "unavailable"; data: unknown; reason: UnavailableReason };

type Internal = OptionsSnapshotState & { feed: string };

export function useOptionsSnapshot(feed: string): OptionsSnapshotState & {
  loading: boolean;
  failed: boolean;
  refresh: () => void;
} {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Internal>({ feed: "", status: "loading", data: null });
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    let active = true, inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      setState((previous) => ({
        feed, status: "loading", data: previous.feed === feed ? previous.data : null,
      }));
      let outcome: FlowOutcome;
      try { outcome = await flowGetResult(feed, { refresh: version > 0 }); }
      catch { outcome = { status: "unavailable", reason: "network" }; }
      inFlight = false;
      if (!active) return;
      setState((previous) => {
        const retained = previous.feed === feed ? previous.data : null;
        if (outcome.status === "data") return { feed, status: "data", data: outcome.data };
        if (outcome.status === "absent") return { feed, status: "absent", data: retained };
        return { feed, status: "unavailable", data: retained, reason: outcome.reason };
      });
    };
    void load();
    const timer = setInterval(() => { void load(); }, 120_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [feed, version]);
  if (state.feed !== feed) {
    return { status: "loading", data: null, loading: true, failed: false, refresh };
  }
  return {
    ...state,
    loading: state.status === "loading",
    failed: state.status === "absent" || state.status === "unavailable",
    refresh,
  };
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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

type PendingSnap = { key: string; data: unknown } | null;
type Internal = OptionsSnapshotState & { feed: string; pending: PendingSnap };
type Hold = { active: boolean; key: (data: unknown) => string | null };

function dropPending(current: Internal): Internal {
  return current.pending === null ? current : { ...current, pending: null };
}

export function useOptionsSnapshot(feed: string, hold?: Hold): OptionsSnapshotState & {
  loading: boolean;
  failed: boolean;
  refresh: () => void;
  pending: PendingSnap;
  applyPending: () => void;
} {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Internal>({ feed: "", status: "loading", data: null, pending: null });
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  const applyPending = useCallback(() => {
    setState((previous) => previous.pending
      ? { feed: previous.feed, status: "data", data: previous.pending.data, pending: null }
      : previous);
  }, []);
  // Latest hold for the next read. Assigned in an effect so a new `key` function does not
  // re-run the load, and never written during render.
  const holdRef = useRef(hold);
  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  const active = hold?.active === true;
  const [seenFeed, setSeenFeed] = useState(feed);
  const [seenActive, setSeenActive] = useState(active);
  // Feed change drops a queued snapshot. Ending the hold applies it in this render, before paint.
  if (seenFeed !== feed) {
    setSeenFeed(feed);
    setSeenActive(active);
    if (state.pending !== null) setState(dropPending(state));
  } else if (seenActive !== active) {
    setSeenActive(active);
    if (seenActive && !active && state.pending !== null) {
      setState({ feed: state.feed, status: "data", data: state.pending.data, pending: null });
    }
  }

  useEffect(() => {
    let live = true, inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      setState((previous) => ({
        feed, status: "loading",
        data: previous.feed === feed ? previous.data : null,
        pending: previous.feed === feed ? previous.pending : null,
      }));
      let outcome: FlowOutcome;
      try { outcome = await flowGetResult(feed, { refresh: version > 0 }); }
      catch { outcome = { status: "unavailable", reason: "network" }; }
      inFlight = false;
      if (!live) return;
      setState((previous) => {
        const sameFeed = previous.feed === feed;
        const retained = sameFeed ? previous.data : null;
        const pending = sameFeed ? previous.pending : null;
        if (outcome.status === "data") {
          const spec = holdRef.current;
          if (spec?.active) {
            const displayedKey = spec.key(retained);
            const nextKey = spec.key(outcome.data);
            if (displayedKey != null && nextKey != null && displayedKey !== nextKey) {
              return { feed, status: "data", data: retained, pending: { key: nextKey, data: outcome.data } };
            }
          }
          return { feed, status: "data", data: outcome.data, pending: null };
        }
        if (outcome.status === "absent") return { feed, status: "absent", data: retained, pending };
        return { feed, status: "unavailable", data: retained, reason: outcome.reason, pending };
      });
    };
    void load();
    const timer = setInterval(() => { void load(); }, 120_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [feed, version]);
  if (state.feed !== feed) {
    return { status: "loading", data: null, loading: true, failed: false, refresh, pending: null, applyPending };
  }
  return {
    ...state,
    loading: state.status === "loading",
    failed: state.status === "absent" || state.status === "unavailable",
    refresh,
    applyPending,
  };
}

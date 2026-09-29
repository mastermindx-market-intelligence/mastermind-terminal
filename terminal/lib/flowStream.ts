"use client";
/**
 * useFlowStream — subscribe to a flow feed over SSE, with a polling fallback.
 *
 * Phase 1 live spine (client half). Opens ONE EventSource per FEED KEY to
 * /api/flow/stream?f=<f> and pushes updates into React state as the server sends
 * them. If SSE is unsupported or errors repeatedly, it degrades to the existing
 * cache-owned fresh polling path — so a consumer that swaps flowGet for
 * useFlowStream never ends up worse off than before.
 *
 * PER-KEY CONNECTION SHARING (v7b perf wave)
 * ------------------------------------------
 * Every hook instance used to construct its own EventSource, so the options hub
 * (`feed`) and the Flow Desk (`feed` again) each held a connection — and because
 * the desk stays mounted after its first visit, a session that touched it carried
 * two for the rest of its life. Each connection makes the server re-read the
 * upstream and run two full JSON.stringify passes over a ~2 MB frame every 15 s,
 * and pushes that frame down the wire twice.
 *
 * Now a module-level registry keys connections by `f`: the first subscriber opens
 * it, the last one to leave closes it, and everyone in between shares the same
 * frames. A late subscriber is handed the last frame SYNCHRONOUSLY, so opening the
 * Flow Desk paints from the hub's already-received feed instead of waiting up to a
 * full push interval for the next one.
 *
 * Returns { data, connected, error }:
 *   - data:  latest payload (null until the first message)
 *   - connected: true while the SSE transport is open. This says nothing about
 *                producer cadence or source freshness.
 *   - error: true after the stream errored and before it recovered
 *
 * SSR-safe: no EventSource touched on the server; the connection opens in useEffect.
 */
import { useEffect, useState } from "react";
import { flowGetFresh } from "@/lib/flowClientCache";

export interface FlowStreamResult<T> {
  data: T | null;
  connected: boolean;
  error: boolean;
}

/** What every subscriber of a key sees. Replaced wholesale on each change. */
interface Snapshot {
  data: unknown;
  connected: boolean;
  error: boolean;
}

type Listener = (s: Snapshot) => void;

interface Conn {
  es: EventSource | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  pollMs: number;
  errCount: number;
  refs: number;
  snap: Snapshot;
  subs: Set<Listener>;
}

/** One entry per live feed key. Deleted when its last subscriber leaves. */
const CONNS = new Map<string, Conn>();

function publish(c: Conn, next: Partial<Snapshot>): void {
  c.snap = { ...c.snap, ...next };
  // Iterate a copy: a listener that unsubscribes while being notified must not
  // corrupt the walk.
  for (const fn of Array.from(c.subs)) fn(c.snap);
}

function startPolling(f: string, c: Conn): void {
  if (c.pollTimer) return;
  const tick = async () => {
    // A stream fallback is a long-lived consumer: when its cache entry is stale,
    // wait for the canonical cache owner's revalidation instead of publishing the
    // stale value and making the UI lag one complete polling interval.
    const d = await flowGetFresh(f);
    if (CONNS.get(f) !== c) return; // connection was torn down mid-flight
    if (d != null) publish(c, { data: d, error: false });
  };
  void tick();
  c.pollTimer = setInterval(tick, c.pollMs);
}

function stopPolling(c: Conn): void {
  if (c.pollTimer) { clearInterval(c.pollTimer); c.pollTimer = null; }
}

function openConn(f: string, c: Conn): void {
  if (typeof window !== "undefined" && "EventSource" in window) {
    const es = new EventSource(`/api/flow/stream?f=${encodeURIComponent(f)}`);
    c.es = es;
    es.onopen = () => {
      if (CONNS.get(f) !== c) return;
      c.errCount = 0;
      stopPolling(c); // SSE recovered — drop the fallback poll
      publish(c, { connected: true, error: false });
    };
    es.onmessage = (ev) => {
      if (CONNS.get(f) !== c) return;
      try {
        publish(c, { data: JSON.parse(ev.data), error: false });
      } catch { /* keep last good data on a malformed frame */ }
    };
    es.onerror = () => {
      if (CONNS.get(f) !== c) return;
      publish(c, { connected: false, error: true });
      // EventSource auto-reconnects; if it keeps failing, fall back to polling
      // so the consumer still updates while SSE is unavailable.
      if (++c.errCount >= 3) startPolling(f, c);
    };
  } else {
    // No EventSource (old browser / SSR hydration edge) — poll from the start.
    startPolling(f, c);
  }
}

/**
 * Join the shared connection for `f`, creating it if this is the first subscriber.
 * The listener is invoked immediately with the current snapshot. Returns the
 * unsubscribe fn; the connection closes when the last subscriber releases it.
 */
function subscribeFlow(f: string, pollMs: number, fn: Listener): () => void {
  let c = CONNS.get(f);
  if (!c) {
    c = {
      es: null, pollTimer: null, pollMs, errCount: 0, refs: 0,
      snap: { data: null, connected: false, error: false },
      subs: new Set<Listener>(),
    };
    CONNS.set(f, c);
    openConn(f, c);
  }
  const conn = c;
  conn.refs++;
  conn.subs.add(fn);
  // Late joiner paints off the last frame this key already received rather than
  // waiting for the server's next push.
  fn(conn.snap);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    conn.subs.delete(fn);
    if (--conn.refs > 0) return;
    if (CONNS.get(f) === conn) CONNS.delete(f);
    stopPolling(conn);
    if (conn.es) {
      try { conn.es.close(); } catch { /* already closed */ }
      conn.es = null;
    }
  };
}

const EMPTY: Snapshot = { data: null, connected: false, error: false };

export function useFlowStream<T = unknown>(
  f: string | null,
  opts?: { pollMs?: number },
): FlowStreamResult<T> {
  const pollMs = opts?.pollMs ?? 30_000;
  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    if (!f) {
      // Key went null (e.g. left the tab). Keep the last payload so cross-tab
      // consumers still resolve, but stop claiming the transport is connected.
      setSnap((s) => (s.connected ? { ...s, connected: false } : s));
      return;
    }
    // New subscription key — clear the previous feed's data so a consumer never
    // flashes stale content (e.g. the old ticker's ladder) while the first snapshot
    // for the new key is in flight. If the shared connection already holds a frame
    // for this key, subscribeFlow overwrites this in the same batch.
    setSnap(EMPTY);
    let cancelled = false;
    const unsub = subscribeFlow(f, pollMs, (s) => { if (!cancelled) setSnap(s); });
    return () => { cancelled = true; unsub(); };
  }, [f, pollMs]);

  return { data: snap.data as T | null, connected: snap.connected, error: snap.error };
}

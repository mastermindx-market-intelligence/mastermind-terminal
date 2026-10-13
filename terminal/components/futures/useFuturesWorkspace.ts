"use client";
import { useEffect, useState } from "react";
import { futuresQuery, type FuturesRequest } from "@/lib/futuresRequest";
import { parseFuturesPublishedView, readFuturesJson, type FuturesPublishedView } from "@/lib/futuresTransport";
import { publicFuturesReason, type FuturesCopyKey } from "@/lib/futuresUiCopy";

type State = { key: string; status: "loading" | "data" | "unavailable"; data?: FuturesPublishedView; reason?: FuturesCopyKey };
/** Per-mounted-consumer state. No cross-account cache, new stream owner, or vendor socket. */
export function useFuturesWorkspace(request: FuturesRequest, ownerKey: string, refresh: number): State {
  const query = futuresQuery(request), key = `${ownerKey}|${query}|${refresh}`;
  const [state, setState] = useState<State>({ key: "", status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true, busy = false, stopped = false;
    const hidden = () => document.visibilityState === "hidden";
    let poll: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      if (!alive || busy || stopped || hidden()) return;
      busy = true;
      let nextPollMs: number | null = request.cutoffMs === null ? 15000 : null;
      const activeController = new AbortController(); controller = activeController;
      const deadline = setTimeout(() => activeController.abort(), 6000);
      try {
        const response = await fetch(`/api/futures?${query}`, { cache: "no-store", redirect: "error", signal: activeController.signal });
        if (!alive) { await response.body?.cancel(); return; }
        // A denied account is cleared immediately, even when its error body is malformed.
        if (response.status === 401 || response.status === 403) {
          stopped = true; setState({ key, status: "unavailable", reason: "access_required" });
          await response.body?.cancel().catch(() => {}); return;
        }
        // Do not automatically replay a malformed request or a rate-limit refusal.
        if (response.status === 400 || response.status === 429) stopped = true;
        const raw = await readFuturesJson(response);
        if (!alive) return;
        if (!response.ok) {
          const reason = publicFuturesReason(raw && typeof raw === "object" && "error" in raw ? raw.error : null);
          setState({ key, status: "unavailable", reason }); return;
        }
        const data = parseFuturesPublishedView(raw, request, Date.now());
        if (!data) { setState({ key, status: "unavailable", reason: "source_invalid" }); return; }
        setNow(Date.now());
        setState({ key, status: "data", data });
        nextPollMs = data.basis !== "historical" && request.cutoffMs === null ? 5000 : null;
      } catch {
        if (alive) setState({ key, status: "unavailable", reason: "source_unavailable" });
      } finally {
        clearTimeout(deadline); busy = false;
        // One existing poll loop, no overlapping requests. A transient 503/timeout must
        // not strand a current chart forever; denied/rate-limited access stays stopped.
        if (alive && !stopped && nextPollMs !== null && !hidden()) {
          clearTimeout(poll); poll = setTimeout(load, nextPollMs);
        }
      }
    };
    const visible = () => {
      clearTimeout(poll);
      if (document.visibilityState === "visible") void load();
      else controller?.abort();
    };
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => { alive = false; controller?.abort(); clearTimeout(poll); document.removeEventListener("visibilitychange", visible); };
    // Every serialized request field is in query. Owner change also invalidates an in-flight response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const active = state.key === key ? state : { key, status: "loading" as const };
  useEffect(() => {
    if (active.status !== "data" || active.data?.basis === "historical" || request.cutoffMs !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [active.status, active.data?.basis, request.cutoffMs]);
  if (active.status === "data" && active.data && active.data.basis !== "historical" && request.cutoffMs === null && now > active.data.freshUntilMs)
    return { key, status: "unavailable" as const, reason: "stale_source" as const };
  return active;
}

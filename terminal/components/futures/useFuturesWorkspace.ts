"use client";
import { useEffect, useState } from "react";
import { futuresQuery, type FuturesRequest } from "@/lib/futuresRequest";
import { parseFuturesPublishedView, FUTURES_MAX_BYTES, type FuturesPublishedView } from "@/lib/futuresTransport";
import { publicFuturesReason, type FuturesCopyKey } from "@/lib/futuresUiCopy";

type State = { key: string; status: "loading" | "data" | "unavailable"; data?: FuturesPublishedView; reason?: FuturesCopyKey };
/** Per-mounted-consumer state. No cross-account cache, new stream owner, or vendor socket. */
export function useFuturesWorkspace(request: FuturesRequest, ownerKey: string, refresh: number): State {
  const query = futuresQuery(request), key = `${ownerKey}|${query}|${refresh}`;
  const [state, setState] = useState<State>({ key: "", status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true, busy = false, denied = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      if (!alive || busy || denied || document.visibilityState === "hidden") return;
      busy = true;
      const activeController = new AbortController(); controller = activeController;
      const deadline = setTimeout(() => activeController.abort(), 6000);
      try {
        const response = await fetch(`/api/futures?${query}`, { cache: "no-store", signal: activeController.signal });
        const text = await response.text();
        if (!alive) return;
        if (text.length > FUTURES_MAX_BYTES) throw Error("response_size");
        let raw: unknown; try { raw = JSON.parse(text); } catch { raw = null; }
        if (!response.ok) {
          denied = response.status === 401 || response.status === 403;
          const reason = denied ? "access_required" : publicFuturesReason(raw && typeof raw === "object" && "error" in raw ? raw.error : null);
          setState({ key, status: "unavailable", reason }); return;
        }
        const data = parseFuturesPublishedView(raw, request, Date.now());
        if (!data) { setState({ key, status: "unavailable", reason: "source_invalid" }); return; }
        setNow(Date.now());
        setState({ key, status: "data", data });
        if (data.basis !== "historical" && request.cutoffMs === null) poll = setTimeout(load, 5000);
      } catch {
        if (alive) setState({ key, status: "unavailable", reason: "source_unavailable" });
      } finally { clearTimeout(deadline); busy = false; }
    };
    const visible = () => { if (document.visibilityState === "visible") { clearTimeout(poll); void load(); } };
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

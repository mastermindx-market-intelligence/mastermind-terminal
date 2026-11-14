"use client";

import { useEffect, useState } from "react";
import { groupsFromSymbols, planQuoteBatch } from "@/lib/quoteDemand";
import { extQuotePollMs } from "@/lib/extQuoteFreshness";
import { discoverOvernightReading, type DiscoverQuote } from "@/lib/discoverQuotes";

type State = { key: string; regular: Record<string, DiscoverQuote | null>; overnight: Record<string, unknown>; now: number; status: "ready" | "unavailable"; regularStatus: "ready" | "unavailable"; overnightStatus: "ready" | "unavailable" };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Presentation subscriber to the incumbent quote routes. Only the visible
 * window requests quotes; filters and ordering remain tied to the scan snapshot.
 * Hidden tabs stop, old scopes abort, failures back off, and BOATS expires on its
 * source clock even if a later HTTP request hangs or fails.
 */
export function useDiscoverQuotes(owner: string, symbols: readonly string[], overnightSymbols: readonly string[], regularEnabled: boolean, overnightEnabled: boolean) {
  const regularKey = regularEnabled ? symbols.join(",") : "";
  const overnightKey = overnightEnabled ? overnightSymbols.join(",") : "";
  const key = `${owner}|${regularKey}|${overnightKey}`;
  const [state, setState] = useState<State | null>(null);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!regularKey && !overnightKey) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | null = null;
    let regularCursor = 0, overnightCursor = 0, nextOvernight = 0;
    let regular: State["regular"] = {}, overnight: State["overnight"] = {};
    let regularStatus: State["regularStatus"] = "ready", overnightStatus: State["overnightStatus"] = "ready";
    async function poll() {
      if (disposed || document.hidden || controller) return;
      const active = new AbortController(); controller = active;
      const deadline = setTimeout(() => active.abort(), 8000);
      let delay = regularKey ? 5000 : extQuotePollMs(), failed = false;
      let regularComplete = !regularKey, overnightComplete = true;
      const jobs: Promise<void>[] = [];
      const canCommit = () => !disposed && controller === active && !active.signal.aborted;
      async function read(path: string, wanted: string[], lane: "regular" | "overnight") {
        try {
          const params = new URLSearchParams({ syms: wanted.join(","), ...(lane === "regular" ? { view: "regular" } : {}) });
          const res = await fetch(`${path}?${params}`, { cache: "no-store", credentials: "same-origin", signal: active.signal });
          if (!canCommit()) return;
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) { if (lane === "overnight") overnight = {}; else regular = {}; }
            const retry = Number(res.headers.get("Retry-After"));
            delay = Math.max(delay, 15000, Number.isFinite(retry) ? Math.min(retry * 1000, 300000) : 0);
            throw new Error("quote unavailable");
          }
          const payload = object(await res.json());
          if (!canCommit()) return;
          if (!payload.quotes || payload.error || payload.truncated) throw new Error("incomplete quote response");
          const values = object(payload.quotes);
          for (const sym of wanted) {
            const value = values[sym];
            if (lane === "regular") regular[sym] = value && typeof value === "object" && !Array.isArray(value) ? value as DiscoverQuote : null;
            else overnight[sym] = discoverOvernightReading(value);
          }
          if (lane === "regular") { regularStatus = "ready"; regularComplete = true; }
          else { overnightStatus = "ready"; overnightComplete = true; }
        } catch {
          // A hidden/resumed tab or replaced owner can already have a new poll.
          // Its dictionaries must never be changed by an older continuation.
          if (!canCommit()) return;
          failed = true; delay = Math.max(delay, 15000);
          if (lane === "regular") { regularStatus = "unavailable"; regularComplete = true; }
          else { overnightStatus = "unavailable"; overnightComplete = true; }
          // Do not label a failed refresh live. BOATS can survive a transport
          // miss only until its independent, strict source expiry.
          if (lane === "regular") regular = {};
        }
      }
      if (regularKey) {
        const plan = planQuoteBatch({ rotating: groupsFromSymbols(regularKey.split(",")), cursor: regularCursor });
        regularCursor = plan.nextCursor; jobs.push(read("/api/quote", plan.symbols, "regular"));
      }
      if (overnightKey && Date.now() >= nextOvernight) {
        overnightComplete = false;
        const plan = planQuoteBatch({ rotating: groupsFromSymbols(overnightKey.split(",")), cursor: overnightCursor, limit: 100 });
        overnightCursor = plan.nextCursor; nextOvernight = Date.now() + extQuotePollMs();
        jobs.push(read("/api/ext-quote", plan.symbols, "overnight"));
      }
      await Promise.all(jobs);
      clearTimeout(deadline);
      if (disposed || controller !== active || active.signal.aborted) {
        if (!disposed && controller === active) {
          controller = null;
          if (!regularComplete) { regular = {}; regularStatus = "unavailable"; }
          if (!overnightComplete) overnightStatus = "unavailable";
          setState({ key, regular: { ...regular }, overnight: { ...overnight }, now: Date.now(), status: "unavailable", regularStatus, overnightStatus });
          timer = setTimeout(poll, Math.max(delay, 15000));
        }
        return;
      }
      controller = null;
      setState({ key, regular: { ...regular }, overnight: { ...overnight }, now: Date.now(), status: failed ? "unavailable" : "ready", regularStatus, overnightStatus });
      if (!document.hidden) timer = setTimeout(poll, delay);
    }
    function visibility() {
      clearTimeout(timer); controller?.abort(); controller = null;
      regular = {}; overnight = {}; regularStatus = "ready"; overnightStatus = "ready"; nextOvernight = 0; setState(null);
      if (!document.hidden) void poll();
    }
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [key, regularKey, overnightKey]);
  useEffect(() => {
    if (!overnightKey) return;
    const timer = setInterval(() => { if (!document.hidden) setClock(Date.now()); }, 1000);
    return () => clearInterval(timer);
  }, [overnightKey]);
  const current = state?.key === key ? state : null;
  return { regular: current?.regular ?? {}, overnight: current?.overnight ?? {}, now: Math.max(clock, current?.now ?? Date.now()), status: current?.status ?? "pending", regularStatus: current?.regularStatus ?? "pending", overnightStatus: current?.overnightStatus ?? "pending" };
}

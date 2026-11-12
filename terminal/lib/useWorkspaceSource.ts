"use client"

import { useCallback, useEffect, useState } from "react"
import { getJSONResult, invalidate } from "./dataCache"
import { workspaceSourceValid } from "./intelligenceWorkspaceView"

export type WorkspaceSource<T> = {
  symbol: string
  status: "loading" | "ready" | "absent" | "unavailable"
  data: T | null
  refresh: "settled" | "checking" | "failed"
  reason?: "identity" | "malformed" | "network" | "server"
}

/** A consumer of the shared cache, with symbol and lifecycle fences. No second store. */
export function useWorkspaceSource<T>(symbol: string, kind: "intel" | "slice" | "backtest", enabled: boolean) {
  const url = `/data/${encodeURIComponent(symbol)}.${kind}.json`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<WorkspaceSource<T>>({ symbol, status: "loading", data: null, refresh: "settled" })
  const retry = useCallback(() => { invalidate(url); setAttempt(value => value + 1) }, [url])

  useEffect(() => {
    if (!enabled) return
    let active = true
    let sequence = 0
    setState(previous => previous.symbol === symbol && previous.data
      ? { ...previous, refresh: "checking" }
      : { symbol, status: "loading", data: null, refresh: "settled" })
    const receive = (raw: unknown, refresh: WorkspaceSource<T>["refresh"]) => {
      if (!active) return
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        setState({ symbol, status: "unavailable", data: null, refresh: "settled", reason: "malformed" }); return
      }
      const subject = (raw as { ticker?: unknown; symbol?: unknown }).ticker ?? (raw as { symbol?: unknown }).symbol
      if (subject != null && (typeof subject !== "string" || subject.toUpperCase() !== symbol.toUpperCase())) {
        setState({ symbol, status: "unavailable", data: null, refresh: "settled", reason: "identity" }); return
      }
      if (!workspaceSourceValid(kind, raw)) {
        setState({ symbol, status: "unavailable", data: null, refresh: "settled", reason: "malformed" }); return
      }
      setState({ symbol, status: "ready", data: raw as T, refresh })
    }
    const read = async () => {
      const ticket = ++sequence
      const outcome = await getJSONResult(url, { ttl: 60_000, swr: true })
      if (!active || ticket !== sequence) return
      if (outcome.status === "data") {
        receive(outcome.data, outcome.stale ? "checking" : "settled")
        if (outcome.stale) {
          void outcome.stale.revalidation.then(result => {
            if (!active || ticket !== sequence) return
            if (result === "failed") {
              setState(previous => previous.symbol === symbol && previous.data ? { ...previous, refresh: "failed" } : previous)
            } else {
              // A shared inflight request may belong to a different consumer. Read its
              // accepted result from the shared cache after it settles.
              void read()
            }
          })
        }
      } else {
        setState({ symbol, status: outcome.status, data: null, refresh: "settled",
          ...(outcome.status === "unavailable" ? { reason: outcome.reason } : {}) })
      }
    }
    void read()
    const focus = () => { if (document.visibilityState === "visible") void read() }
    window.addEventListener("focus", focus)
    document.addEventListener("visibilitychange", focus)
    return () => { active = false; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus) }
  }, [url, symbol, kind, enabled, attempt])

  // Effects run after paint; this synchronous fence prevents even one frame of
  // the previous symbol's verdict during rapid watchlist changes.
  const current: WorkspaceSource<T> = state.symbol === symbol ? state : { symbol, status: "loading", data: null, refresh: "settled" }
  return { ...current, retry }
}

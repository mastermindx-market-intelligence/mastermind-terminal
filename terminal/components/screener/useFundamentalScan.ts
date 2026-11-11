"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getJSONResult, invalidate } from "@/lib/dataCache";
import {
  FUNDAMENTAL_SCAN_URL,
  nextFundamentalSource,
  readFundamentalScanResponse,
  type FundamentalScanSource,
} from "@/lib/fundamentalScan";

export type FundamentalScanState = {
  /** null until the first answer; then ready / absent / error — never collapsed. */
  source: FundamentalScanSource | null;
  /** The clock the staleness rules are evaluated against (fixed per adopted answer, so the
   *  Screener's filter memo is stable between answers). */
  nowMs: number;
  /** True while a read (first load or a Retry) is in flight. */
  pending: boolean;
  retry: () => void;
};

/**
 * One bounded read of `/data/scan/fundamental.json`, made only once the user opens the
 * fundamental controls (`enabled`). Four states stay distinct (failure-state-truth law):
 * loading, ready, absent (404 — never published), error (transport / 5xx / rejected document).
 * A background revalidation is folded in with the E01 adoption rule, and a refresh that fails
 * keeps the held generation but marks it `refreshFailed` so the bar can say so.
 */
export function useFundamentalScan(enabled: boolean): FundamentalScanState {
  const [source, setSource] = useState<FundamentalScanSource | null>(null);
  const [nowMs, setNowMs] = useState(0);
  // A Retry in flight; the first load's pending state is derived (enabled, no answer yet), so the
  // effect never sets state synchronously.
  const [retrying, setRetrying] = useState(false);
  const [reloadN, setReloadN] = useState(0);
  const held = useRef<FundamentalScanSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const commit = (incoming: FundamentalScanSource) => {
      if (!alive) return;
      const { source: next } = nextFundamentalSource(held.current, incoming);
      held.current = next;
      setSource(next);
      setNowMs(Date.now());
      setRetrying(false);
    };
    getJSONResult(FUNDAMENTAL_SCAN_URL, {
      onRevalidate: (data: unknown) => commit(readFundamentalScanResponse(200, data)),
    })
      .then((res) => {
        if (res.status === "data") {
          commit(readFundamentalScanResponse(200, res.data));
          // A stale copy whose background refresh failed is still the last real answer — kept,
          // but labelled (dataCache never calls onRevalidate for a failed refresh).
          res.stale?.revalidation.then((r) => { if (r === "failed") commit({ kind: "error", error: "refresh_failed" }); });
        } else if (res.status === "absent") {
          commit({ kind: "absent" });
        } else {
          commit({ kind: "error", error: res.reason });
        }
      })
      .catch(() => commit({ kind: "error", error: "network" }));
    return () => { alive = false; };
  }, [enabled, reloadN]);

  // invalidate() also clears the in-session 404 negative cache, so a scan that was absent can be
  // found by Retry once the nightly publishes it.
  const retry = useCallback(() => {
    invalidate(FUNDAMENTAL_SCAN_URL);
    setRetrying(true);
    setReloadN((n) => n + 1);
  }, []);

  return { source, nowMs, pending: enabled && (retrying || source === null), retry };
}

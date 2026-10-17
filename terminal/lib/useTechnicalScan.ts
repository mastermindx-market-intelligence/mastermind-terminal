"use client";
// ── The Screener's ONE technical-scan read (E01, AC-E01-03 / AC-E01-04) ──────────
// One bounded read of the published scan generation (`/data/scan/technical.json`) through the
// shared dataCache — never per-symbol OHLC. Nothing is fetched until the technical screen is
// opened, so the default Screener journey keeps its manifest-only compatibility path.
//
// Every answer is folded through `nextTechnicalSource`, the one adoption rule: an incomplete
// generation never displaces a complete one, nothing older replaces what is held, and a failed
// refresh keeps the held scan but flags it `refreshFailed` so the UI labels it.

import { useCallback, useEffect, useRef, useState } from "react";
import { getJSONResult, invalidate, type CacheOutcome } from "./dataCache";
import type { AdoptDecision } from "./screenerScan";
import {
  TECHNICAL_SCAN_URL,
  nextTechnicalSource,
  readTechnicalScanResponse,
  type TechnicalScanSource,
} from "./technicalScan";

export type TechnicalScanState =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
    phase: "settled";
    source: TechnicalScanSource;
    /** The adoption decision of the last fold, when it was a ready scan. */
    decision: AdoptDecision | null;
    /** Classification clock (epoch ms), fixed per fold so memoized coverage is stable. */
    now: number;
  };

/** Adapt the cache's discriminated outcome to a reader source. Absent and unavailable stay apart
 *  (failure-state-truth law): 404 ⇒ absent; transport / 5xx / unparseable ⇒ error. */
export function sourceFromOutcome(o: CacheOutcome): TechnicalScanSource {
  if (o.status === "data") return readTechnicalScanResponse(200, o.data);
  if (o.status === "absent") return { kind: "absent" };
  return { kind: "error", error: o.httpStatus ? `http_${o.httpStatus}` : o.reason };
}

/** A stale serve whose background refresh failed is folded as a failed read, so the held copy is
 *  labelled `refreshFailed` instead of being painted as current. */
export const REFRESH_FAILED: TechnicalScanSource = { kind: "error", error: "refresh_failed" };

export function useTechnicalScan(enabled: boolean): TechnicalScanState & { retry: () => void } {
  const [state, setState] = useState<TechnicalScanState>({ phase: "idle" });
  const [reloadN, setReloadN] = useState(0);
  const heldRef = useRef<TechnicalScanSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fold = (incoming: TechnicalScanSource) => {
      if (!alive) return;
      const { source, decision } = nextTechnicalSource(heldRef.current, incoming);
      heldRef.current = source;
      setState({ phase: "settled", source, decision, now: Date.now() });
    };
    if (heldRef.current === null) setState({ phase: "loading" });
    getJSONResult(TECHNICAL_SCAN_URL, { onRevalidate: (d) => fold(readTechnicalScanResponse(200, d)) })
      .then((res) => {
        fold(sourceFromOutcome(res));
        if (res.status === "data" && res.stale) {
          res.stale.revalidation.then((r) => { if (r === "failed") fold(REFRESH_FAILED); });
        }
      })
      .catch(() => fold({ kind: "error", error: "network" }));
    return () => { alive = false; };
  }, [enabled, reloadN]);

  // invalidate() also clears the in-session 404 negative cache — without it a scan that once
  // answered 404 would answer `absent` from memory and Retry could never reach the network.
  const retry = useCallback(() => {
    invalidate(TECHNICAL_SCAN_URL);
    setReloadN((n) => n + 1);
  }, []);

  return { ...state, retry };
}

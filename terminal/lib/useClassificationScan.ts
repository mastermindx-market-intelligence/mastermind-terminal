"use client";
import { useCallback, useEffect, useState } from "react";
import { getJSONResult, invalidate } from "./dataCache";
import {
  CLASSIFICATION_SCAN_URL,
  nextClassificationSource,
  readClassificationScanResponse,
  type ClassificationScanSource,
} from "./classificationScan";

/** How long the first read may stay unsettled before the screen stops waiting on it. The scan
 *  is a multi-megabyte document; a read that hangs must not hold the whole screener on
 *  "loading" — it settles as an `error` (named in the strip, with Retry) and a late answer is
 *  still adopted through the normal fold. */
export const CLASSIFICATION_SCAN_TIMEOUT_MS = 10_000;

/**
 * One bounded read of the classification scan, folded through E01's adoption rule.
 *
 * `source` is null until the first read SETTLES (loading is not a population). A 404 is
 * `absent`, a failed or rejected read is `error`, and a revalidation that fails after a good
 * read keeps that read on screen flagged `refreshFailed` — never a silent stale copy, never a
 * downgrade to an empty state. A first read still unsettled after
 * CLASSIFICATION_SCAN_TIMEOUT_MS settles as `error: "timeout"` so the screen is never held on it.
 */
export function useClassificationScan(): { source: ClassificationScanSource | null; retry: () => void } {
  const [source, setSource] = useState<ClassificationScanSource | null>(null);
  const [reloadN, setReloadN] = useState(0);

  useEffect(() => {
    let alive = true;
    const fold = (incoming: ClassificationScanSource) => {
      if (alive) setSource((held) => nextClassificationSource(held, incoming).source);
    };
    getJSONResult(CLASSIFICATION_SCAN_URL, {
      // dataCache-swr law: a persisted copy is served stale on every load; the corrected copy
      // arrives only through onRevalidate (and only ever with data).
      onRevalidate: (data: unknown) => fold(readClassificationScanResponse(200, data)),
    })
      .then((res) => {
        if (res.status === "data") {
          fold(readClassificationScanResponse(200, res.data));
          res.stale?.revalidation.then((r) => { if (r === "failed") fold({ kind: "error", error: "refresh_failed" }); });
          return;
        }
        fold(res.status === "absent" ? { kind: "absent" } : { kind: "error", error: res.reason });
      })
      .catch(() => fold({ kind: "error", error: "network" }));
    // Bounded: only an UNSETTLED first read times out; a held read (ready or failed) is kept.
    const timer = setTimeout(() => {
      if (alive) setSource((held) => held ?? { kind: "error", error: "timeout" });
    }, CLASSIFICATION_SCAN_TIMEOUT_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [reloadN]);

  // invalidate() also clears the in-session 404 negative cache, so Retry reaches the network.
  const retry = useCallback(() => {
    invalidate(CLASSIFICATION_SCAN_URL);
    setReloadN((n) => n + 1);
  }, []);

  return { source, retry };
}

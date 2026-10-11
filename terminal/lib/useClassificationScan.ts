"use client";
import { useCallback, useEffect, useState } from "react";
import { getJSONResult, invalidate } from "./dataCache";
import {
  CLASSIFICATION_SCAN_URL,
  nextClassificationSource,
  readClassificationScanResponse,
  type ClassificationScanSource,
} from "./classificationScan";

/**
 * One bounded read of the classification scan, folded through E01's adoption rule.
 *
 * `source` is null until the first read SETTLES (loading is not a population). A 404 is
 * `absent`, a failed or rejected read is `error`, and a revalidation that fails after a good
 * read keeps that read on screen flagged `refreshFailed` — never a silent stale copy, never a
 * downgrade to an empty state.
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
    return () => { alive = false; };
  }, [reloadN]);

  // invalidate() also clears the in-session 404 negative cache, so Retry reaches the network.
  const retry = useCallback(() => {
    invalidate(CLASSIFICATION_SCAN_URL);
    setReloadN((n) => n + 1);
  }, []);

  return { source, retry };
}

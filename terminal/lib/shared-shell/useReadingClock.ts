"use client";
import { useEffect, useRef, useState } from "react";

/** Render-time `new Date()` only moves when something else re-renders, so Today's
 * freshness line needs its own minute hand. Returns the local wall clock, resampled
 * by a single self-rearming setTimeout at each next minute boundary (delay
 * 60000 − now % 60000 — the same minute grid the canonical NY session clock ticks
 * on) and immediately on returning visible after a suspended clock. A hidden
 * document is left alone: a hidden event cancels the armed boundary and updates
 * nothing, and neither mount nor tick arms while hidden. With `bucket`, the clock
 * only moves the workspace when the bucket actually changes — otherwise the fresh
 * sample is dropped, the previous Date is returned, and React bails out of the
 * re-render. The bucket callback can change once owner/data results land, so it
 * rides in a ref instead of an effect dependency: the boundary chain never restarts
 * for it (no duplicate timers) and the next tick or wake always reads the latest.
 * Touches no fetch, storage, owner, calendar, or session authority: the wall clock
 * is the only input. */
export function useReadingClock(bucket?: (now: Date) => string): Date {
  const [now, setNow] = useState(() => new Date());
  // The live bucket, deliberately outside the timer effect: a changed callback
  // must not tear down and restart the boundary chain.
  const bucketRef = useRef(bucket);
  useEffect(() => {
    bucketRef.current = bucket;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (document.visibilityState !== "visible") return; // never arm while hidden
      timer = setTimeout(tick, 60000 - (Date.now() % 60000));
    };
    const sample = () => {
      const current = new Date();
      setNow((prev) => {
        const bucketOf = bucketRef.current;
        if (!bucketOf) return current;
        // Same bucket → keep the previous Date; React bails out, no rerender.
        return bucketOf(prev) === bucketOf(current) ? prev : current;
      });
    };
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      sample();
      arm();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        clearTimeout(timer); // hidden: drop the armed boundary, update nothing
        timer = undefined;
        return;
      }
      clearTimeout(timer); // visible wake: resample immediately, rearm on the grid
      sample();
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return now;
}

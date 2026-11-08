"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Observe minute boundaries and visible wakes without rerendering an unchanged
 * displayed age bucket. Ordinary renders always use fresh wall time, including the
 * first render of newly arrived owner data. The timer compares against the latest
 * committed render, so it never needs to repair a stale render-time Date. Hidden
 * documents have no timer; this hook performs no reads, storage or owner changes. */
export function useReadingClock(bucket?: (now: Date) => string): Date {
  const now = new Date();
  const [, setVersion] = useState(0);
  const committed = useRef({ bucket, at: now });
  useLayoutEffect(() => {
    committed.current = { bucket, at: now };
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (document.visibilityState !== "visible") return; // never arm while hidden
      timer = setTimeout(tick, 60000 - (Date.now() % 60000));
    };
    const sample = () => {
      const current = new Date();
      const { bucket: bucketOf, at } = committed.current;
      if (bucketOf && bucketOf(at) === bucketOf(current)) return;
      committed.current = { bucket: bucketOf, at: current };
      setVersion((version) => version + 1);
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

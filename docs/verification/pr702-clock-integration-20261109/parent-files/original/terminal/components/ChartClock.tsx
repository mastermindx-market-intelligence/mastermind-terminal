"use client";
import { useEffect, useState } from "react";

type ClockSnapshot = { time: string; zone: string };
function snapshot(now: Date): ClockSnapshot {
  const two = (value: number) => String(value).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const absolute = Math.abs(offset);
  return {
    time: `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`,
    zone: `UTC${offset >= 0 ? "+" : "-"}${Math.floor(absolute / 60)}${absolute % 60 ? ":" + two(absolute % 60) : ""}`,
  };
}

/** Own only the wall clock: ticking never re-renders chart navigation/settings. */
export default function ChartClock() {
  // SSR and the first client render agree; server-local time must not leak into hydration.
  const [clock, setClock] = useState<ClockSnapshot | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => setClock(snapshot(new Date()));
    const syncVisibility = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      tick();
      timer = setInterval(tick, 1000);
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);
  return clock ? <span className="cfb-clock num">
    {clock.time} <span className="cfb-tz">{clock.zone}</span>
  </span> : null;
}

import { liveDisplayEpoch } from "./liveCandle";
import { usRegularSessionWindow } from "./usEquitySessionClock";
import { number, object } from "./sectorIntelligence";

type RegularSession = { date: string; open: boolean; start: number; end: number };
const DAY = 86400;

/** The most recent regular session that has actually opened in New York. */
export function sectorRegularSession(now: number): RegularSession | null {
  const epoch = liveDisplayEpoch(now, "us");
  if (epoch === null) return null;
  const today = Math.floor(epoch / DAY) * DAY;
  try {
    for (let day = today; day >= today - 14 * DAY; day -= DAY) {
      const window = usRegularSessionWindow(day);
      if (!window) continue;
      const start = day + window[0] * 60, end = day + window[1] * 60;
      if (epoch >= start) return { date: new Date(day * 1000).toISOString().slice(0, 10), open: epoch < end, start, end };
    }
  } catch { /* Beyond the published calendar, keep the dated owner snapshot. */ }
  return null;
}

type Reading = { value: number; kind: "live" | "delayed" | "untimed" | "close"; observed: number | null };

export function sectorRegularReading(raw: unknown, session: RegularSession, now: number): Reading | null {
  const q = object(raw), value = number(q.regularChg), previous = number(q.prevClose);
  if (q.market !== "us" || q.regularSessionDate !== session.date || value === null || previous === null || previous <= 0
      || q.prevSessionChg != null || q.stale_anchor === true || q.suspended === true) return null;
  if (!session.open) {
    const close = number(q.close);
    return close !== null && close > 0 ? { value, kind: "close", observed: null } : null;
  }
  const price = number(q.regularPrice);
  if (q.marketSession !== "rth" || q.regularSession !== "rth" || q.close != null || price === null || price <= 0) return null;
  const bar = q.source === "polygon-live" || q.source === "polygon-delayed";
  // AM.ts is the end of a market bar. A REST day.c snapshot's ts can be the fetch clock.
  const observed = number(q.asOfMs) ?? (bar && number(q.ts) !== null ? Number(q.ts) * 1000 : null);
  if (observed === null) {
    return q.source === "polygon-snapshot" && q.basis === "DELAYED_15M" && q.anchor_source === "snapshot"
      ? { value, kind: "untimed", observed: null } : null;
  }
  const age = now - observed, wall = liveDisplayEpoch(observed, "us");
  if (wall === null || wall < session.start || wall > session.end || age < 0 || age > 20 * 60_000) return null;
  if (q.basis === "REALTIME" || q.basis === "LIVE") {
    return { value, kind: age <= 15_000 ? "live" : "delayed", observed };
  }
  return q.basis === "DELAYED_15M" ? { value, kind: "delayed", observed } : null;
}

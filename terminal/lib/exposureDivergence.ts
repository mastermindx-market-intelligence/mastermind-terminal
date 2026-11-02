import { resampleTf, type SessionOhlcBar } from "./sessionBars";
import { resampleUsEquitySession, type Bar6 } from "./intradayShared";
import { usRegularSessionWindow } from "./usEquitySessionClock";
import { rsi } from "./techRating";
import { findDivergences, type DivergenceEvent } from "./suites/shared/divergence";
import type { SuiteBar } from "./indicator-canvas/types";

export const EXPOSURE_DIVERGENCE_PROFILE = Object.freeze({ version: "rsi14-w2-s60-v1", length: 14, wing: 2, maxSpan: 60 });
export type ExposureTimeframe = "5m" | "30m" | "2h" | "D" | "W";
export type ClosedExposureBar = SuiteBar & { closedAtDisplay: number; shortened: boolean };
const midnight = (t: number) => Math.floor(t / 86400) * 86400;
const dateAt = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const valid = (b: SuiteBar) => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite)
  && Math.min(b.o, b.h, b.l, b.c) > 0 && b.v >= 0 && b.l <= Math.min(b.o, b.c) && b.h >= Math.max(b.o, b.c);

function contiguous(bars: ClosedExposureBar[], tf: ExposureTimeframe): ClosedExposureBar[] {
  for (let i = 1; i < bars.length; i++) {
    if (latestExposureBarClose(tf, bars[i].t) !== bars[i - 1].closedAtDisplay) throw new Error("MISSING_SESSION_BARS");
  }
  return bars;
}

/** Expected last close from the same exchange calendar, including holidays and shortened sessions. */
export function latestExposureBarClose(tf: ExposureTimeframe, nowDisplay: number): number | null {
  for (let d = 0; d < 21; d++) {
    const day = midnight(nowDisplay) - d * 86400;
    const window = usRegularSessionWindow(day);
    if (!window) continue;
    const close = day + window[1] * 60;
    if (tf === "D") { if (close <= nowDisplay) return close; continue; }
    if (tf === "W") {
      const dow = (new Date(day * 1000).getUTCDay() + 6) % 7;
      let last = true;
      for (let i = dow + 1; i < 7; i++) if (usRegularSessionWindow(day + (i - dow) * 86400)) last = false;
      if (last && close <= nowDisplay) return close;
      continue;
    }
    const span = (tf === "5m" ? 5 : tf === "30m" ? 30 : 120) * 60;
    const open = day + window[0] * 60;
    for (let start = open + Math.floor((close - open - 1) / span) * span; start >= open; start -= span) {
      const end = Math.min(start + span, close);
      if (end <= nowDisplay) return end;
    }
  }
  return null;
}

/** Input and output clocks are the incumbent chart's ET display epoch, never true UTC. */
export function closedIntradayBars(input: Bar6[], tf: "5m" | "30m" | "2h", nowDisplay: number): ClosedExposureBar[] {
  const minutes = tf === "2h" ? 120 : tf === "30m" ? 30 : 5;
  if (!Number.isFinite(nowDisplay)) throw new Error("CLOCK_UNAVAILABLE");
  for (let i = 0; i < input.length; i++) {
    const b = input[i];
    if (!valid({ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }) || (i > 0 && b[0] <= input[i - 1][0])) throw new Error("INVALID_BARS");
  }
  return contiguous(resampleUsEquitySession(input, minutes, "regular").flatMap((b) => {
    const window = usRegularSessionWindow(b[0]);
    if (!window) return [];
    const end = Math.min(b[0] + minutes * 60, midnight(b[0]) + window[1] * 60);
    if (end > nowDisplay) return [];
    const members = input.filter((x) => x[0] >= b[0] && x[0] < end);
    // No completed classification over a partially received higher-timeframe candle.
    if (members.length !== (end - b[0]) / 300 || members.some((x, i) => x[0] !== b[0] + i * 300)) {
      if (b[0] < input[0][0]) return []; // truncated leading bucket, never a complete bar
      throw new Error("INCOMPLETE_BUCKET");
    }
    return [{ t: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], closedAtDisplay: end, shortened: end - b[0] < minutes * 60 }];
  }), tf);
}

export function closedDailyBars(input: SessionOhlcBar[], tf: "D" | "W", nowDisplay: number): ClosedExposureBar[] {
  if (!Number.isFinite(nowDisplay)) throw new Error("CLOCK_UNAVAILABLE");
  const complete = input.filter((b, i) => {
    const t = Date.parse(b.time + "T00:00:00Z") / 1000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.time) || !Number.isFinite(t) || dateAt(t) !== b.time || !valid({ ...b, t }) || (i > 0 && b.time <= input[i - 1].time)) throw new Error("INVALID_BARS");
    const window = usRegularSessionWindow(t);
    if (!window) throw new Error("NON_SESSION_BAR");
    return t + window[1] * 60 <= nowDisplay;
  });
  const rows = resampleTf(complete, tf);
  return contiguous(rows.flatMap((b) => {
    const t = Date.parse(b.time + "T00:00:00Z") / 1000;
    let close = t + usRegularSessionWindow(t)![1] * 60;
    if (tf === "W") {
      const dow = (new Date(t * 1000).getUTCDay() + 6) % 7;
      const monday = t - dow * 86400;
      const sessions: number[] = [];
      for (let d = 0; d < 7; d++) if (usRegularSessionWindow(monday + d * 86400)) sessions.push(monday + d * 86400);
      const last = sessions.at(-1)!;
      close = last + usRegularSessionWindow(last)![1] * 60;
      if (close > nowDisplay) return [];
      const members = complete.filter((x) => x.time >= dateAt(monday) && x.time <= dateAt(last));
      if (members.length !== sessions.length) {
        if (complete[0]?.time > dateAt(monday)) return []; // first truncated week has no complete candle
        throw new Error("INCOMPLETE_WEEK");
      }
    }
    return [{ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, closedAtDisplay: close, shortened: usRegularSessionWindow(t)![1] < 960 }];
  }), tf);
}

export interface ConfirmedExposureDivergence {
  state: "none" | "insufficient" | "stale" | "confirmed";
  bars: number;
  latestClose: number | null;
  shortened: boolean;
  event: (DivergenceEvent & { pivotAtDisplay: number; confirmedAtDisplay: number; ageBars: number }) | null;
}

/** Frozen descriptive profile. Historical events become visible at confirmation close, never pivot time. */
export function confirmedExposureDivergence(bars: ClosedExposureBar[], hidden: boolean, stale = false): ConfirmedExposureDivergence {
  const base = { bars: bars.length, latestClose: bars.at(-1)?.closedAtDisplay ?? null, shortened: bars.at(-1)?.shortened ?? false, event: null };
  if (stale) return { ...base, state: "stale" };
  // RSI warmup plus two distinct confirmed oscillator pivots; absence before this is not 'none'.
  if (bars.length < 14 + 2 * 2 + 3) return { ...base, state: "insufficient" };
  const oscillator = Float64Array.from(rsi(bars.map((b) => b.c), 14));
  const events = findDivergences(bars, oscillator, { wing: 2, maxSpan: 60, hidden });
  const event = events.at(-1);
  if (!event) return { ...base, state: "none" };
  return { ...base, state: "confirmed", event: { ...event, pivotAtDisplay: bars[event.iB].t,
    confirmedAtDisplay: bars[event.confirmedAt].closedAtDisplay, ageBars: bars.length - 1 - event.confirmedAt } };
}

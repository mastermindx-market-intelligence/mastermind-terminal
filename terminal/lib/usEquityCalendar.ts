// Session phases project the existing immutable Macro-owned NYSE clock; this is
// not another holiday calendar. Epoch UTC fields are already ET wall-clock.
// BOATS: https://blueocean-tech.io/corporate-fact-sheet/ (20:00–04:00 ET).
import { usRegularSessionWindow } from "./usEquitySessionClock";

const DAY = 86400;
export type UsSessionPhase = "pre" | "rth" | "post" | "overnight" | "closed";
export type UsSession = { session: UsSessionPhase; tradeDate: string | null; anchorEpoch: number | null };
const closed: UsSession = { session: "closed", tradeDate: null, anchorEpoch: null };
function dateEpoch(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000-")) return null;
  const epoch = Date.parse(`${date}T00:00:00Z`) / 1000;
  return Number.isFinite(epoch) && new Date(epoch * 1000).toISOString().slice(0, 10) === date ? epoch : null;
}
export function isUsEquityTradingDate(date: string): boolean {
  const epoch = dateEpoch(date);
  return epoch != null && usRegularSessionWindow(epoch) != null;
}
export function usRegularCloseMinute(date: string): number | null {
  const epoch = dateEpoch(date);
  return epoch == null ? null : usRegularSessionWindow(epoch)?.[1] ?? null;
}
export function usEquitySessionAtDisplayEpoch(epoch: number): UsSession {
  if (!Number.isFinite(epoch)) return closed;
  const instant = new Date(epoch * 1000);
  if (!Number.isFinite(instant.valueOf())) return closed;
  const day = Math.floor(epoch / DAY) * DAY;
  const minute = (epoch - day) / 60;
  // An evening print belongs to the following trading date. Friday/Saturday
  // evenings and the eve of a full closure have no BOATS session.
  const tradeDay = minute >= 1200 ? day + DAY : day;
  const tradeDate = new Date(tradeDay * 1000).toISOString().slice(0, 10);
  const window = usRegularSessionWindow(tradeDay);
  if (!window) return closed;
  if (minute >= 1200 || minute < 240) return {
    session: "overnight", tradeDate, anchorEpoch: tradeDay - DAY + 1200 * 60,
  };
  if (minute < window[0]) return { session: "pre", tradeDate, anchorEpoch: day + 240 * 60 };
  if (minute < window[1]) return { session: "rth", tradeDate, anchorEpoch: day + window[0] * 60 };
  // U.S. early-close late sessions end at 17:00 ET. The regular close stays
  // owned by the canonical projection (including exceptional closures).
  if (minute < (window[1] < 960 ? 1020 : 1200)) return { session: "post", tradeDate, anchorEpoch: day + window[1] * 60 };
  return closed;
}
export function usSessionBucket(epoch: number, span: number, mode: "regular" | "extended" | "24h"): number | null {
  if (!Number.isFinite(span) || span <= 0) return null;
  const phase = usEquitySessionAtDisplayEpoch(epoch);
  if (phase.anchorEpoch == null || phase.session === "closed") return null;
  if (mode === "regular" && phase.session !== "rth") return null;
  if (mode === "extended" && phase.session === "overnight") return null;
  const day = Math.floor(epoch / DAY) * DAY;
  // Preserve existing ETH buckets. 24H splits every phase so a wide candle
  // cannot mix overnight, premarket, regular, or after-hours observations.
  const anchor = mode === "24h" ? phase.anchorEpoch : day + (mode === "regular" ? 570 : 240) * 60;
  return anchor + Math.floor((epoch - anchor) / span) * span;
}

/** 24H candles stop at phase boundaries, including shortened trading days. */
export function us24hCandleClose(open: number, span: number): number | null {
  if (!Number.isFinite(span) || span <= 0) return null;
  const phase = usEquitySessionAtDisplayEpoch(open);
  if (phase.anchorEpoch == null || phase.tradeDate == null) return null;
  const day = dateEpoch(phase.tradeDate)!;
  const window = usRegularSessionWindow(day)!;
  const end = phase.session === "overnight" ? day + 240 * 60
    : phase.session === "pre" ? day + window[0] * 60
    : phase.session === "rth" ? day + window[1] * 60
    : day + (window[1] < 960 ? 1020 : 1200) * 60;
  return Math.min(open + span, end);
}

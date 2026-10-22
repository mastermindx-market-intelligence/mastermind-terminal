import type { Bar6 } from "@/lib/intradayShared";

export const SESSION_REVIEW_VERSION = "exposure-session-review/v1";
export const REVIEW_BARS_TF = "10m";
export type ReviewMode = "dominant" | "pinned";
export type ReviewFrameKind = "observed" | "reconstructed" | "aggregate" | "current";
export interface ReviewFrameInput { session: string; kind: ReviewFrameKind; level: number | null; levelNetMn: number | null }

export interface SessionTouchMeasure {
  bars: number; touches: number; firstTouchEt: string | null; lastTouchEt: string | null;
  maxExcursionPct: number | null; maxExcursionPrice: number | null; maxExcursionSide: "above" | "below" | null;
  close: number | null; closeVsLevelPct: number | null; low: number | null; high: number | null;
}
export interface SessionReviewRow {
  session: string; kind: ReviewFrameKind; level: number | null; levelNetMn: number | null;
  pinned: boolean; measure: SessionTouchMeasure | null; missing: "no_level" | "no_bars" | null;
}
export interface SessionReview {
  version: typeof SESSION_REVIEW_VERSION; root: string; mode: ReviewMode; tf: typeof REVIEW_BARS_TF;
  rows: SessionReviewRow[];
  totals: { sessions: number; observed: number; reconstructed: number; aggregate: number; observedTouches: number; reconstructedTouches: number };
}

/** epochSec is a display epoch whose UTC fields already read as the ET wall clock. */
const etClock = (epochSec: number) => new Date(epochSec * 1000).toISOString();
export const etSessionDate = (epochSec: number) => etClock(epochSec).slice(0, 10);
export const etHm = (epochSec: number) => etClock(epochSec).slice(11, 16);

export function bucketBarsBySession(bars: readonly Bar6[]): Map<string, Bar6[]> {
  const out = new Map<string, Bar6[]>();
  for (const bar of bars) {
    if (!Number.isFinite(bar[0])) continue;
    const day = etSessionDate(bar[0]);
    const bucket = out.get(day);
    if (bucket) bucket.push(bar); else out.set(day, [bar]);
  }
  for (const bucket of out.values()) bucket.sort((a, b) => a[0] - b[0]);
  return out;
}

/** A touch is a bar whose range includes the level; both boundaries are inclusive. */
export function measureSessionTouches(bars: readonly Bar6[], level: number): SessionTouchMeasure | null {
  if (!bars.length || !Number.isFinite(level)) return null;
  let touches = 0, firstTouchEt: string | null = null, lastTouchEt: string | null = null;
  let low = Infinity, high = -Infinity, close: number | null = null, closeAt = -Infinity;
  for (const bar of bars) {
    const [t, , h, l, c] = bar;
    if (l <= level && level <= h) {
      if (firstTouchEt == null) firstTouchEt = etHm(t);
      lastTouchEt = etHm(t);
      touches += 1;
    }
    if (l < low) low = l;
    if (h > high) high = h;
    if (t >= closeAt) { closeAt = t; close = c; }
  }
  const above = high - level, below = level - low;
  const side: "above" | "below" = above >= below ? "above" : "below";
  const price = side === "above" ? high : low;
  return {
    bars: bars.length, touches, firstTouchEt, lastTouchEt,
    maxExcursionPct: (price - level) / level, maxExcursionPrice: price, maxExcursionSide: side,
    close, closeVsLevelPct: close == null ? null : (close - level) / level, low, high,
  };
}

const isFiniteLevel = (level: number | null): level is number => level != null && Number.isFinite(level);

export function buildSessionReview(
  root: string, frames: readonly ReviewFrameInput[], barsBySession: ReadonlyMap<string, readonly Bar6[]>, mode: ReviewMode, pinnedLevel: number | null,
): SessionReview {
  const pinned = mode === "pinned";
  const rows = frames.map((frame): SessionReviewRow => {
    // The stored net belongs to the frame's own level, so it never describes a pinned re-measure.
    const level = pinned ? pinnedLevel : frame.level;
    const levelNetMn = pinned ? null : frame.levelNetMn;
    if (!isFiniteLevel(level)) return { ...frame, level, levelNetMn, pinned, measure: null, missing: "no_level" };
    const bucket = barsBySession.get(frame.session);
    const measure = bucket ? measureSessionTouches(bucket, level) : null;
    return { ...frame, level, levelNetMn, pinned, measure, missing: measure ? null : "no_bars" };
  });
  const observedTouches = rows.reduce((sum, row) => (row.kind === "observed" || row.kind === "current") && row.measure ? sum + row.measure.touches : sum, 0);
  const reconstructedTouches = rows.reduce((sum, row) => (row.kind === "reconstructed" || row.kind === "aggregate") && row.measure ? sum + row.measure.touches : sum, 0);
  return {
    version: SESSION_REVIEW_VERSION, root, mode, tf: REVIEW_BARS_TF, rows,
    totals: {
      sessions: rows.length,
      observed: rows.filter((row) => row.kind === "observed" || row.kind === "current").length,
      reconstructed: rows.filter((row) => row.kind === "reconstructed").length,
      aggregate: rows.filter((row) => row.kind === "aggregate").length,
      observedTouches, reconstructedTouches,
    },
  };
}

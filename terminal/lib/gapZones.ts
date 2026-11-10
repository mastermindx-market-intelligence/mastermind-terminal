/**
 * Gap Zones — the true-daily-gap rule, and what of it was knowable at a point in history.
 *
 * A gap is a day whose whole range clears the prior day's: a gap up (low > prior high) leaves
 * the band [prior high, low]; a gap down (high < prior low) leaves [high, prior low]. It is
 * FILLED by the first later day that trades back into the band.
 *
 * Detection is O(days²) and does not depend on where the chart is scrolled, so the chart runs
 * it once per daily history and keeps the result. Each zone records the ROW at which it formed
 * and at which it filled, so Bar Replay can ask what was known after the first `known` rows
 * without re-scanning: a zone that forms later does not exist yet, and a fill that happens
 * later has not happened yet. `gapZonesAsOf(detectGapZones(rows), k)` equals
 * `gapZonesAsOf(detectGapZones(rows.slice(0, k)), k)` for every k — knowing more history can
 * never change what was knowable (lib/__tests__/replayLookahead.test.ts).
 */

export type GapBar = { time: string | number; h: number; l: number };

export type GapZone = {
  /** Row of the gap day in the daily history it was detected on. */
  at: number;
  date: string;
  type: "up" | "down";
  lo: number;
  hi: number;
  /** Row of the first day that traded back into the band, or -1 if none has. */
  fillAt: number;
  fillDate: string | null;
};

/** One zone as a chart draws it: `fill` is the fill date, or null while the gap is open. */
export type GapZoneView = { date: string; type: "up" | "down"; lo: number; hi: number; fill: string | null };

/** A daily bar's calendar date: daily rows carry "YYYY-MM-DD", intraday rows epoch seconds. */
const dayOf = (t: string | number): string =>
  typeof t === "string" ? t : new Date(t * 1000).toISOString().slice(0, 10);

/** Every gap of at least `thr` (a fraction: 0.003 = 0.3%) in `daily`, oldest first. */
export function detectGapZones(daily: readonly GapBar[], thr: number): GapZone[] {
  const out: GapZone[] = [];
  for (let i = 1; i < daily.length; i++) {
    const b = daily[i], pb = daily[i - 1];
    let band: { type: "up" | "down"; lo: number; hi: number } | null = null;
    if (pb.h > 0 && b.l > pb.h && (b.l - pb.h) / pb.h >= thr) band = { type: "up", lo: pb.h, hi: b.l };
    else if (pb.l > 0 && b.h < pb.l && (pb.l - b.h) / pb.l >= thr) band = { type: "down", lo: b.h, hi: pb.l };
    if (!band) continue;
    let fillAt = -1;
    for (let j = i + 1; j < daily.length; j++) {
      if (band.type === "up" ? daily[j].l <= band.lo : daily[j].h >= band.hi) { fillAt = j; break; }
    }
    out.push({ at: i, date: dayOf(b.time), ...band, fillAt, fillDate: fillAt >= 0 ? dayOf(daily[fillAt].time) : null });
  }
  return out;
}

/** The zones a chart holding only the first `known` daily rows would draw. */
export function gapZonesAsOf(gaps: readonly GapZone[], known: number): GapZoneView[] {
  const out: GapZoneView[] = [];
  for (const g of gaps) {
    if (g.at >= known) continue;
    out.push({ date: g.date, type: g.type, lo: g.lo, hi: g.hi, fill: g.fillAt >= 0 && g.fillAt < known ? g.fillDate : null });
  }
  return out;
}

/**
 * Synthetic bar times past the last loaded candle.
 *
 * Drawing anchors live in DATA space (bar time + price), so the blank area to
 * the right of the newest candle had no addressable anchor at all: every point
 * placed there collapsed onto the last real bar. That produced two visible
 * defects — objects "cut off by the wall" at the live edge, and a drag whose
 * two ends landed on the same bar, which the creation state machine then read
 * as a stationary click and left stuck to the cursor.
 *
 * The grid continues the series' own cadence, so a slot is a REAL future
 * timestamp: when that bar eventually arrives, the anchor already matches it and
 * the drawing keeps its meaning instead of shifting.
 */

/** How many addressable bars exist past the newest candle. */
export const FUTURE_ANCHOR_BARS = 200;

const DAY_MS = 86_400_000;

/** Epoch ms for either representation lightweight-charts accepts. */
function toMs(time: string | number): number {
  if (typeof time === "number") return time * 1000;
  if (/^\d+$/.test(time)) return Number(time) * 1000;
  return +new Date(`${time}T12:00:00Z`);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Median gap between consecutive samples. The median (not the mean) keeps a
 * weekend, a holiday, or an overnight session break from stretching the cadence.
 */
function medianStepMs(times: readonly (string | number)[]): number {
  const deltas: number[] = [];
  for (let i = Math.max(1, times.length - 40); i < times.length; i++) {
    const delta = toMs(times[i]) - toMs(times[i - 1]);
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  if (!deltas.length) return 0;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

/** The cadence a future grid is generated from: step size and its origin. */
export type FutureCadence = { stepMs: number; lastMs: number };

/**
 * Measure a series' bar cadence. Callers use it to place a time that is past the
 * newest bar but absent from the generated grid — a stored anchor whose exact
 * slot no longer exists because new bars shifted the grid. Deriving its offset
 * keeps the anchor in the future instead of clamping it back to the live edge.
 */
export function futureCadence(times: readonly (string | number)[]): FutureCadence | null {
  if (times.length < 2) return null;
  const lastMs = toMs(times[times.length - 1]);
  const stepMs = medianStepMs(times);
  if (!Number.isFinite(lastMs) || stepMs <= 0) return null;
  return { stepMs, lastMs };
}

/**
 * Slot index for a time that sits past the newest bar, or -1 when it does not.
 * Slot 0 is the first bar after the last real one.
 */
export function futureSlotOf(
  cadence: FutureCadence | null,
  time: string | number,
  slots = FUTURE_ANCHOR_BARS,
): number {
  if (!cadence) return -1;
  const ms = toMs(time);
  if (!Number.isFinite(ms) || ms <= cadence.lastMs) return -1;
  const offset = Math.round((ms - cadence.lastMs) / cadence.stepMs) - 1;
  return offset < 0 || offset >= slots ? -1 : offset;
}

/**
 * Continue a bar-time series `count` steps into the future.
 *
 * Daily-cadence grids advance by calendar days and skip weekends, so the labels
 * read as plausible sessions. Intraday grids advance by the measured step and
 * stay in the epoch-seconds form the series already uses. An empty or
 * single-sample series has no derivable cadence and yields no future slots.
 */
export function futureBarTimes(
  times: readonly (string | number)[],
  count = FUTURE_ANCHOR_BARS,
): (string | number)[] {
  const slots = Math.max(0, Math.floor(count));
  if (!slots || times.length < 2) return [];

  const last = times[times.length - 1];
  const lastMs = toMs(last);
  const step = medianStepMs(times);
  if (!Number.isFinite(lastMs) || step <= 0) return [];

  const numeric = typeof last === "number";
  if (numeric) {
    const stepSeconds = Math.round(step / 1000);
    if (stepSeconds <= 0) return [];
    const base = Math.round(lastMs / 1000);
    return Array.from({ length: slots }, (_, i) => base + stepSeconds * (i + 1));
  }

  // Only a true daily grid lands on individual sessions. Any coarser aggregate
  // (2D, 3D, weekly, monthly) already absorbs weekends inside a bar, so nudging
  // it off Saturday would stretch its cadence instead of preserving it.
  const stepDays = Math.max(1, Math.round(step / DAY_MS));
  const skipWeekends = stepDays === 1;
  const out: string[] = [];
  let cursor = lastMs;
  while (out.length < slots) {
    cursor += stepDays * DAY_MS;
    if (skipWeekends) {
      const day = new Date(cursor).getUTCDay();
      if (day === 0) cursor += DAY_MS;            // Sunday → Monday
      else if (day === 6) cursor += 2 * DAY_MS;   // Saturday → Monday
    }
    out.push(isoDate(cursor));
  }
  return out;
}

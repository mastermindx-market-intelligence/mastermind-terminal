// Shared, side-effect-free helpers used by BOTH host.ts (main thread) and worker.ts (worker thread):
// the source-hash function (AST cache key / astId) and the columnar Bar packing that makes the
// worker payload transferable-friendly. Kept in its own module so worker.ts never imports host.ts
// (which references `new Worker(...)`, illegal inside a worker) and vice-versa.
import type { Bar } from "./runtime";
import { NA } from "./builtins";

// FNV-1a (32-bit, folded twice) over the source — matches lib/fingerprint.ts's idiom. Cheap,
// stable, collision-resistant enough to key an AST cache; NOT security-sensitive.
export function hashSource(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let h2 = (0x811c9dc5 ^ h) >>> 0;
  for (let i = str.length - 1; i >= 0; i--) { h2 ^= str.charCodeAt(i); h2 = Math.imul(h2, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

// Columnar bar payload: numeric columns as Float64Array (transferable) + the ISO time strings the
// engine's date math reads. n is redundant with the array lengths but explicit for clarity/guards.
export interface ColumnarBars { n: number; time: string[]; timeClose?: string[]; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; v: Float64Array; }

// One rule for session stamps used by admission (isParseableSession), builtin
// `time` / `time_close`, and calendar week bucketing. Date-only → UTC midnight.
// A date-time is admitted only with an explicit offset (`Z` or `±hh:mm`);
// offset-less date-time is Pine na, so every viewer maps the same epoch.
// Anything else, or a failed parse → Pine na (never a leaked Date.parse NaN,
// never a local-time parse).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseSessionStampMs(stamp: unknown): number {
  if (typeof stamp !== "string" || stamp.length === 0) return NA;
  const iso = DATE_ONLY.test(stamp)
    ? stamp + "T00:00:00Z"
    : DATETIME_WITH_OFFSET.test(stamp)
      ? stamp
      : null;
  if (iso == null) return NA;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NA;
}

// ISO-week Monday (UTC date-only) for a parseable session stamp. Unparseable
// stamps return null rather than throwing on Invalid Date#toISOString.
export function sessionWeekOpenDate(stamp: unknown): string | null {
  const ms = parseSessionStampMs(stamp);
  if (!Number.isFinite(ms)) return null;
  const dt = new Date(ms);
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

function isParseableSession(s: unknown): s is string {
  return Number.isFinite(parseSessionStampMs(s));
}

// ChartPanel 3D session groups stamp `closeTime`; the engine's HTF resample stamps `timeClose`.
// `timeClose` wins when both are present and parseable.
export function resolveBarTimeClose(b: { timeClose?: string; closeTime?: string }): string | undefined {
  if (isParseableSession(b.timeClose)) return b.timeClose;
  if (isParseableSession(b.closeTime)) return b.closeTime;
  return undefined;
}

// Pack row-object bars into columns. Returns the payload plus the ArrayBuffers to hand to
// postMessage's transfer list (zero-copy). Called on the host before posting a run.
export function barsToColumns(bars: Bar[]): { payload: ColumnarBars; transfer: ArrayBufferLike[] } {
  const n = bars.length;
  const o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  const time = new Array<string>(n);
  const timeClose = new Array<string>(n);
  let anyClose = false;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    time[i] = b.time; o[i] = b.o; h[i] = b.h; l[i] = b.l; c[i] = b.c; v[i] = b.v;
    const tc = resolveBarTimeClose(b);
    if (tc) { timeClose[i] = tc; anyClose = true; } else timeClose[i] = "";
  }
  const payload: ColumnarBars = { n, time, o, h, l, c, v };
  if (anyClose) payload.timeClose = timeClose;
  return { payload, transfer: [o.buffer, h.buffer, l.buffer, c.buffer, v.buffer] };
}

// Rehydrate columns back into the Bar[] the runtime expects (worker side).
export function columnsToBars(cols: ColumnarBars): Bar[] {
  const { n, time, o, h, l, c, v, timeClose } = cols;
  const out: Bar[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const b: Bar = { time: time[i], o: o[i], h: h[i], l: l[i], c: c[i], v: v[i] };
    if (timeClose && timeClose[i]) b.timeClose = timeClose[i];
    out[i] = b;
  }
  return out;
}

// Chart-engine presented-frame cadence parser (Q03).
//
// Pure, browser-safe helper that turns a Chromium devtools CDP trace into
// per-pid presented-frame records, with a strict renderer-pid choice. The
// Renderer's pid is identified by the EARLIEST blink.user_timing event whose
// name starts with `markPrefix` (every, with no fallback); only when
// there is NO such mark in the trace is the single PipelineReporter pid used.
//
// Chromium FORKS the frame reporter: one display presentation can be reported
// by two PipelineReporter slices with different `frame_sequence` values (one of
// them carries `frame_type: "FORKED"` in `args.frame_reporter`). Per
// frame_source:frame_sequence ("the key") the gesture held e.g.:
//   192x {STATE_PRESENTED_ALL on main, STATE_DROPPED on forked}
//   183x {STATE_PRESENTED_ALL on forked, STATE_NO_UPDATE_DESIRED on main}
//   76x  {STATE_DROPPED on main}
//   27x  {STATE_PRESENTED_ALL on main}
// so the 402 ALL slices = 202 distinct presentation times (one per input),
// and counting DROPPED slices would over-report drops by 192. We therefore
// count FRAMES, not slices: the per-key reducer collapses forked duplicates.
//
// Frames:
//   presented  — unique sorted endMs of every ALL slice (each endMs is one frame)
//   partial    — unique sorted endMs of PARTIAL slices whose key has no ALL
//                 and whose endMs is not in presentedMs
//   dropped    — keys holding >= 1 DROPPED slice and no ALL or PARTIAL slice;
//                 one frame per key at the max endMs of its DROPPED slices
//
// presentedMs stays the unique sorted ms of the "presented" subset only.
// NO_UPDATE_DESIRED never counts.
//
// `gestureIntervals` excludes idle gaps outside [windowStart, windowEnd]
// inclusive; `gestureStats` works over [startMarkMs, endMarkMs + GESTURE_TAIL_MS].
// `buildCadenceReceipt` / `validateCadenceReceipt` are hand-written, no
// schema, no ajv. Percentiles delegate to `corpus.percentile` so an empty
// sample set yields UNMEASURED — a violation, never `NaN`.
//
// Per-input presentation latency (Q03b):
// Before each gesture the bench installs a capture-phase listener on
// `document` for pointermove and mousemove (pan) or wheel (zoom). A pointer
// event with coalesced events gets one mark per coalesced event; any other
// event gets one mark of its own. Each mark is written with
// `performance.mark(name, { startTime: ev.timeStamp })`, so it sits at the
// time the input happened, not at the time the listener ran. A pointermove
// and its compatibility mousemove carry the same timeStamp, so identical
// times count as one input. For every input mark m inside [start mark, end
// mark], latency = the first presented frame (STATE_PRESENTED_ALL) at or
// after m, minus m, provided that frame arrives by end mark +
// GESTURE_TAIL_MS; an input with no such frame is counted in
// input_unpresented. The presented interval cannot be shorter than the time
// between inputs (a zoom that dispatches ~50 wheel events per second cannot
// show intervals under ~20 ms), so it says little about the renderer.
// Latency has no such floor: it is bounded below by the vsync slot, not by
// the input rate.
//
// Measured vsync:
// vsync_ms is the MODE of the finite positive presented-frame intervals,
// rounded to 0.1 ms (ties -> the smallest value), pooled over both
// gestures; hz = round(1000 / vsync_ms). Measured, never declared: nothing
// here assumes 60 Hz / 120 Hz / 16.7 ms. When inputs arrive more slowly
// than the display refreshes, every presented interval spans several
// refreshes and this mode is a multiple of the true slot (a slow headless
// host read 43.5 ms on a 16.7 ms clock). `frameSequenceIntervals` is the
// cross-check that does not depend on input: begin-time difference divided
// by frame_sequence difference between consecutive frames of one BeginFrame
// source. Its mode is printed as vsync_seq_ms on the diagnostic line and is
// not part of the receipt.
//
// Pure: no fs, no playwright, no DOM, no ajv. Only `./corpus` is imported.
// House style: 2-space indent, double quotes, semicolons, named exports.

import { percentile } from "./corpus";

// Q03b per-input presentation latency budgets are bound here prospectively,
// before a reference-Mac run (D10: never lower a budget after a result).
export const CADENCE_BUDGETS = {
  presented_p95_ms: 20,
  presented_p99_ms: 33.4,
  input_to_present_p95_ms: 20,
  input_to_present_p99_ms: 33.4,
} as const;

export const GESTURE_TAIL_MS = 100;

/** Chromium devtools frame-reporter states (one per `b` event). */
const STATE_PRESENTED_ALL = "STATE_PRESENTED_ALL";
const STATE_PRESENTED_PARTIAL = "STATE_PRESENTED_PARTIAL";
const STATE_DROPPED = "STATE_DROPPED";
// STATE_NO_UPDATE_DESIRED is recognised and OMITTED from `frames`; no symbol
// needed, just the literal in toFrameState below.

export type PresentedFrame = {
  ms: number;
  state: "presented" | "partial" | "dropped";
};

export type ParsedPresentation = {
  frames: PresentedFrame[];
  presentedMs: number[];
  presented: number;
  partial: number;
  dropped: number;
  rendererPid: number;
};

/** The eight intervals-only metrics a per-gesture stats record carries. */
export type PresentedCadenceStats = {
  inputs: number;
  input_hz: number;
  presented: number;
  partial: number;
  dropped: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

/** Per-input presentation latency (Q03b): how long each input waited for a
 *  presented frame. `input_marks` is the unique count of input events; each
 *  input that finds no presented frame at-or-after it inside the gesture tail
 *  is counted in `input_unpresented`. Empty latency -> p50/p95/p99 are
 *  UNMEASURED (a violation, never `NaN`). */
export type InputLatencyStats = {
  input_marks: number;
  input_unpresented: number;
  input_to_present_p50_ms: number;
  input_to_present_p95_ms: number;
  input_to_present_p99_ms: number;
};

/** Per-gesture record in a receipt: 13 keys. The eight intervals-only metrics
 *  plus the five per-input latency metrics. */
export type CadenceGestureStats = PresentedCadenceStats & InputLatencyStats;

/** Top-level display signal: measured vsync. Never declared from a constant;
 *  computed from the union of presented-frame intervals across both gestures. */
export type CadenceDisplay = {
  vsync_ms: number;
  hz: number;
};

export type CadenceReceipt = {
  commit: string;
  impl: "mm" | "lwc";
  host: { os: string; cpu: string; dpr: number };
  display: CadenceDisplay;
  generated_at: string;
  gesture: { pan: CadenceGestureStats; zoom: CadenceGestureStats };
  budgets: typeof CADENCE_BUDGETS;
  violations: Array<{ metric: string; value: number; budget: number }>;
  budget_ok: boolean;
};

// ---------- typed views of a raw trace event (structural; never untyped) ----------

type RawEvent = {
  name?: unknown;
  cat?: unknown;
  ph?: unknown;
  ts?: unknown;
  dur?: unknown;
  pid?: unknown;
  tid?: unknown;
  id?: unknown;
  id2?: { local?: unknown; global?: unknown };
  args?: {
    frame_reporter?: {
      state?: unknown;
      frame_source?: unknown;
      frame_sequence?: unknown;
      frame_type?: unknown;
    };
    chrome_frame_reporter?: {
      state?: unknown;
      frame_source?: unknown;
      frame_sequence?: unknown;
      frame_type?: unknown;
    };
  };
};

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function readNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readRawEvents(events: readonly unknown[]): RawEvent[] {
  const out: RawEvent[] = [];
  for (const e of events) {
    if (e != null && typeof e === "object") out.push(e as RawEvent);
  }
  return out;
}

// ---------- trace event normalisation ----------

/**
 * Accept either `{traceEvents:[...]}` (CDP `Tracing.dataCollected` payload) or
 * a bare array of events. Anything else is an empty array — never a throw,
 * the bench must stay green when no CDP session captured one.
 */
export function asTraceEvents(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    const maybe = (raw as { traceEvents?: unknown }).traceEvents;
    if (Array.isArray(maybe)) return maybe;
  }
  return [];
}

/**
 * First blink.user_timing event whose `name` equals the requested one;
 * presentation is `ts / 1000` (CDP microseconds → ms). The mark clock and
 * the PipelineReporter clock are the same trace clock, no mapping.
 */
export function userTimingMs(events: readonly unknown[], name: string): number | null {
  const raw = readRawEvents(events);
  for (const e of raw) {
    if (readString(e.cat) === "blink.user_timing" && readString(e.name) === name) {
      const ts = readNumber(e.ts);
      if (ts != null) return ts / 1000;
    }
  }
  return null;
}

/**
 * EVERY blink.user_timing event whose `name` equals `name` exactly, presented
 * as `ts / 1000` ms, sorted ascending. Duplicates are kept (NOT de-duplicated)
 * so the caller can tell how many marks Chromium actually emitted. When `pid`
 * is supplied, only marks on that pid count; the bench passes the renderer
 * pid so a Browser-pid copy of the same mark name cannot leak into the input
 * set. `userTimingMs` is the FIRST-of-NAME view; `userTimingAllMs` is the
 * EVERY view.
 */
export function userTimingAllMs(events: readonly unknown[], name: string, pid?: number): number[] {
  const raw = readRawEvents(events);
  const out: number[] = [];
  for (const e of raw) {
    if (readString(e.cat) !== "blink.user_timing") continue;
    if (readString(e.name) !== name) continue;
    if (pid != null) {
      const p = readNumber(e.pid);
      if (p !== pid) continue;
    }
    const ts = readNumber(e.ts);
    if (ts != null) out.push(ts / 1000);
  }
  out.sort((a, b) => a - b);
  return out;
}

// ---------- renderer pid selection ----------

function readPid(e: RawEvent): number | null {
  return readNumber(e.pid);
}

type RawReporterArgs = {
  state: string | null;
  frame_source: number | null;
  frame_sequence: number | null;
};

/**
 * Read the `frame_reporter` (or `chrome_frame_reporter`) sub-object of a
 * PipelineReporter event's args. Anything missing or wrong-typed becomes
 * null; the per-slice key is then a unique per-slice fallback.
 */
function readReporterArgs(e: RawEvent): RawReporterArgs {
  const args = e.args;
  if (args == null || typeof args !== "object") return { state: null, frame_source: null, frame_sequence: null };
  const inner = (args.frame_reporter ?? args.chrome_frame_reporter) as Record<string, unknown> | undefined;
  if (inner == null || typeof inner !== "object") return { state: null, frame_source: null, frame_sequence: null };
  return {
    state: typeof inner.state === "string" ? inner.state : null,
    frame_source: typeof inner.frame_source === "number" && Number.isFinite(inner.frame_source) ? inner.frame_source : null,
    frame_sequence: typeof inner.frame_sequence === "number" && Number.isFinite(inner.frame_sequence) ? inner.frame_sequence : null,
  };
}

/** Local-pairing key for `b`/`e` halves (Chromium puts it on `id2.local`). */
function pairKeyOf(e: RawEvent, pid: number): string {
  const id2 = e.id2;
  const local = id2 ? readString(id2.local) : null;
  if (local != null) return `${pid}:${local}`;
  const global = id2 ? readString(id2.global) : null;
  if (global != null) return `${pid}:${global}`;
  const id = readString(e.id);
  return `${pid}:${id ?? "?"}`;
}

type ParsedBegin = { kind: "b"; pid: number; pairKey: string; ts: number; reporter: RawReporterArgs };
type ParsedEnd = { kind: "e"; pid: number; pairKey: string; ts: number };
type ParsedComplete = { kind: "X"; pid: number; ts: number; dur: number; reporter: RawReporterArgs };

function parseReporterEvent(e: RawEvent): ParsedBegin | ParsedEnd | ParsedComplete | null {
  if (readString(e.name) !== "PipelineReporter") return null;
  const pid = readPid(e);
  if (pid == null) return null;
  const ph = readString(e.ph);
  const ts = readNumber(e.ts);
  if (ts == null) return null;
  if (ph === "b") {
    return { kind: "b", pid, pairKey: pairKeyOf(e, pid), ts, reporter: readReporterArgs(e) };
  }
  if (ph === "e") {
    return { kind: "e", pid, pairKey: pairKeyOf(e, pid), ts };
  }
  if (ph === "X") {
    const dur = readNumber(e.dur);
    if (dur == null) return null;
    return { kind: "X", pid, ts, dur, reporter: readReporterArgs(e) };
  }
  return null;
}

function toFrameState(state: string | null): "presented" | "partial" | "dropped" | null {
  if (state === STATE_PRESENTED_ALL) return "presented";
  if (state === STATE_PRESENTED_PARTIAL) return "partial";
  if (state === STATE_DROPPED) return "dropped";
  return null; // STATE_NO_UPDATE_DESIRED or anything unknown: omit
}

/** A1 frame key = `${frame_source}:${frame_sequence}` when both are numbers;
 *  otherwise a unique per-slice key (still de-dupes a forked pair that lacks
 *  the IDs). */
function frameKey(args: RawReporterArgs, sliceKey: string): string {
  if (args.frame_source != null && args.frame_sequence != null) {
    return `${args.frame_source}:${args.frame_sequence}`;
  }
  return sliceKey;
}

// ---------- public parser ----------

/**
 * Pair `b` with the next `e` of the same `pairKey` (no overlapping slices per
 * track, per the trace contract). `X` uses ts+dur. Then group the slices by
 * A1 frame key (frame_source:frame_sequence) and reduce to one frame per
 * presentation time; see the per-frame rules in the header comment.
 *
 * Renderer pid:
 *   - If ANY blink.user_timing event whose name starts with `markPrefix`
 *     exists, rendererPid = the pid of the EARLIEST such mark, and if that
 *     pid emitted NO PipelineReporter -> throw (no fallback).
 *   - Only when no such mark exists: exactly one PipelineReporter pid in
 *     the trace -> that pid, else throw.
 *   - Throw "no presentation records in trace" when the chosen pid has zero
 *     PipelineReporter slices of every kind.
 *   - A pid whose slices are all NO_UPDATE_DESIRED returns frames [] (the
 *     spec turns that into INVALID, B4).
 */
export function parsePresentedFrames(events: readonly unknown[], markPrefix = "cadence:"): ParsedPresentation {
  const raw = readRawEvents(events);

  // Reporter pids by trace.
  const reporterPids = new Set<number>();
  for (const e of raw) {
    if (readString(e.name) === "PipelineReporter") {
      const pid = readPid(e);
      if (pid != null) reporterPids.add(pid);
    }
  }

  // Find earliest blink.user_timing mark under markPrefix , in ts order.
  type MarkHit = { pid: number; ts: number };
  let earliestMark: MarkHit | null = null;
  for (const e of raw) {
    if (readString(e.cat) !== "blink.user_timing") continue;
    const name = readString(e.name);
    if (name == null || !name.startsWith(markPrefix)) continue;
    const pid = readPid(e);
    if (pid == null) continue;
    const ts = readNumber(e.ts);
    if (ts == null) continue;
    if (earliestMark == null || ts < earliestMark.ts) {
      earliestMark = { pid, ts };
    }
  }

  let rendererPid: number | null;
  if (earliestMark != null) {
    // Hard pin: never fall back to another pid.
    rendererPid = earliestMark.pid;
  } else if (reporterPids.size === 1) {
    rendererPid = reporterPids.values().next().value ?? null;
  } else {
    throw new Error("no presentation records in trace");
  }
  if (rendererPid == null) {
    throw new Error("no presentation records in trace");
  }
  // Mark set but the marked pid emitted no PipelineReporter -> throw.
  if (earliestMark != null && !reporterPids.has(rendererPid)) {
    throw new Error("no presentation records in trace");
  }

  // Parse reporter events; filter to chosen pid; sort ascending by ts.
  const parsed: Array<ParsedBegin | ParsedEnd | ParsedComplete> = [];
  for (const e of raw) {
    const r = parseReporterEvent(e);
    if (r == null) continue;
    if (r.pid !== rendererPid) continue;
    parsed.push(r);
  }
  parsed.sort((a, b) => a.ts - b.ts);

  // Track whether the chosen pid emitted reporter events at all. When
  // this is true but every slice filtered out as NO_UPDATE_DESIRED the spec
  // wants frames [] (a "no frames" trace is INVALID only because the bench
  // needs >= 2 presented frames, not because the trace is malformed).
  const hadAnyReporter = parsed.some((ev) => ev.kind === "b" || ev.kind === "X");

  // Pair `b` with the next `e` of the same pairKey; produce per-slice
  // records carrying {state, endMs, key}.
  type SliceRecord = { state: "presented" | "partial" | "dropped"; endMs: number; frameKey: string };
  const slices: SliceRecord[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const ev = parsed[i];
    if (ev.kind === "X") {
      const state = toFrameState(ev.reporter.state);
      if (state == null) continue;
      slices.push({
        state,
        endMs: (ev.ts + ev.dur) / 1000,
        // X events: no id2 paired-key, so the frame key has to come from
        // frame_reporter.frame_source:frame_sequence or fall back to a
        // per-slice unique key.
        frameKey: frameKey(ev.reporter, `x:${ev.pid}:${ev.ts}:${ev.dur}`),
      });
      continue;
    }
    if (ev.kind === "b") {
      const state = toFrameState(ev.reporter.state);
      if (state == null) continue;
      const paired = findNextEnd(parsed, i + 1, ev.pairKey);
      if (paired == null) continue;
      slices.push({
        state,
        endMs: paired.ts / 1000,
        frameKey: frameKey(ev.reporter, `b:${ev.pairKey}`),
      });
      continue;
    }
    // ev.kind === "e" — terminal half; ignore unpaired ends.
  }

  if (slices.length === 0) {
    // The chosen pid emitted PipelineReporter events but every one was
    // NO_UPDATE_DESIRED; the spec wants frames=[] (the bench's B4 INVALID
    // gate is the right place to reject fewer-than-2 frames).
    if (hadAnyReporter) {
      return { frames: [], presentedMs: [], presented: 0, partial: 0, dropped: 0, rendererPid };
    }
    throw new Error("no presentation records in trace");
  }

  // A1 reducer: group slices by frame key; reduce each key into at most one
  // frame of every kind.
  type KeyAgg = {
    endMsAll: number[];
    endMsPartial: number[];
    endMsDropped: number[];
  };
  const byKey = new Map<string, KeyAgg>();
  for (const s of slices) {
    let agg = byKey.get(s.frameKey);
    if (agg == null) {
      agg = { endMsAll: [], endMsPartial: [], endMsDropped: [] };
      byKey.set(s.frameKey, agg);
    }
    if (s.state === "presented") agg.endMsAll.push(s.endMs);
    else if (s.state === "partial") agg.endMsPartial.push(s.endMs);
    else agg.endMsDropped.push(s.endMs);
  }

  // Unique sorted ms of every ALL slice across keys (one frame per endMs).
  const presentedMsSet = new Set<number>();
  for (const agg of byKey.values()) {
    for (const ms of agg.endMsAll) presentedMsSet.add(ms);
  }
  const presentedMs = Array.from(presentedMsSet).sort((a, b) => a - b);

  // Build the per-key frames (dropped at max endMs; partial = unique endMs
  // not already in presentedMs when the key has no ALL slice).
  const frames: PresentedFrame[] = [];
  for (const agg of byKey.values()) {
    if (agg.endMsAll.length > 0) continue;
    if (agg.endMsPartial.length > 0) {
      for (const ms of new Set(agg.endMsPartial)) {
        if (!presentedMsSet.has(ms)) frames.push({ ms, state: "partial" });
      }
      continue;
    }
    // No ALL, no PARTIAL — keyed dropped frame at max endMs of its DROPPED slices.
    const maxD = agg.endMsDropped.reduce((m, v) => (v > m ? v : m), -Infinity);
    if (Number.isFinite(maxD)) frames.push({ ms: maxD, state: "dropped" });
  }
  // Append the presented frames (one per presented ms).
  for (const ms of presentedMs) frames.push({ ms, state: "presented" });
  frames.sort((a, b) => a.ms - b.ms);

  const presented = frames.reduce((n, f) => (f.state === "presented" ? n + 1 : n), 0);
  const partial = frames.reduce((n, f) => (f.state === "partial" ? n + 1 : n), 0);
  const dropped = frames.reduce((n, f) => (f.state === "dropped" ? n + 1 : n), 0);

  return { frames, presentedMs, presented, partial, dropped, rendererPid };
}

function findNextEnd(
  list: ReadonlyArray<ParsedBegin | ParsedEnd | ParsedComplete>,
  startIdx: number,
  pairKey: string,
): ParsedEnd | null {
  for (let i = startIdx; i < list.length; i++) {
    const ev = list[i];
    if (ev.kind === "e" && ev.pairKey === pairKey) return ev;
  }
  return null;
}

// ---------- windowed math ----------

/**
 * Consecutive deltas `presentedMs[i+1] - presentedMs[i]` kept only when
 * BOTH ends lie inside `[windowStartMs, windowEndMs]` inclusive. Excludes
 * the idle gap before the first and after the last in-window presentation.
 */
export function gestureIntervals(presentedMs: readonly number[], windowStartMs: number, windowEndMs: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < presentedMs.length; i++) {
    const a = presentedMs[i - 1];
    const b = presentedMs[i];
    if (a == null || b == null) continue;
    if (a < windowStartMs || a > windowEndMs) continue;
    if (b < windowStartMs || b > windowEndMs) continue;
    out.push(b - a);
  }
  return out;
}

/**
 * Window = `[startMarkMs, endMarkMs + GESTURE_TAIL_MS]` inclusive.
 * Whole-trace counts: `presented`/`partial`/`dropped` are the frames
 * whose ms lies in the window. `input_hz` = dispatch rate.
 * Percentiles use `corpus.percentile` (returns UNMEASURED on empty).
 * Returns ONLY the eight intervals-only metrics of `PresentedCadenceStats`;
 * the per-input latency keys (`input_marks`, `input_unpresented`, the three
 * `input_to_present_*_ms` percentiles) come from `inputLatencyStats` and the
 * spec merges them with `{ ...baseStats, ...latency }` to build a gesture
 * record.
 */
export function gestureStats(
  parsed: ParsedPresentation,
  startMarkMs: number,
  endMarkMs: number,
  inputs: number,
): PresentedCadenceStats {
  const windowEnd = endMarkMs + GESTURE_TAIL_MS;
  let presented = 0;
  let partial = 0;
  let dropped = 0;
  for (const f of parsed.frames) {
    if (f.ms < startMarkMs || f.ms > windowEnd) continue;
    if (f.state === "presented") presented++;
    else if (f.state === "partial") partial++;
    else dropped++;
  }
  const intervals = gestureIntervals(parsed.presentedMs, startMarkMs, windowEnd);
  const elapsedSec = (endMarkMs - startMarkMs) / 1000;
  const inputHz = elapsedSec > 0 ? Math.round((inputs / elapsedSec) * 10) / 10 : 0;
  return {
    inputs,
    input_hz: inputHz,
    presented,
    partial,
    dropped,
    p50_ms: p50(intervals),
    p95_ms: p95(intervals),
    p99_ms: p99(intervals),
  };
}

// ---------- percentile shims ----------

export function p50(v: readonly number[]): number {
  return percentile([...v], 0.5);
}

export function p95(v: readonly number[]): number {
  return percentile([...v], 0.95);
}

export function p99(v: readonly number[]): number {
  return percentile([...v], 0.99);
}

// ---------- per-input latency ----------

/**
 * Per-input presentation latency (Q03b). The matching rule is the FIRST
 * `presentedMs` value at-or-after each input mark `m`, AND that presentation
 * must still fall inside `[startMarkMs, endMarkMs + GESTURE_TAIL_MS]`
 * inclusive (otherwise the input is unpresented — the gesture is over and no
 * frame arrived in time). `inputMarksMs` is de-duplicated within the gesture
 * window (a pointermove and its compatibility mousemove carry the same
 * timeStamp; both are marked and identical times count as one input).
 * Equality counts (a mark that lands exactly on a presentation frame has
 * latency 0). An empty mark list throws — there is no way to compute a
 * per-input latency without inputs.
 */
export function inputLatencyStats(
  parsed: ParsedPresentation,
  inputMarksMs: readonly number[],
  startMarkMs: number,
  endMarkMs: number,
): InputLatencyStats {
  // Keep marks that fall inside the gesture window inclusive; de-duplicate.
  const inWindow = inputMarksMs.filter((m) => m >= startMarkMs && m <= endMarkMs);
  const marks = Array.from(new Set(inWindow)).sort((a, b) => a - b);
  if (marks.length === 0) {
    throw new Error("no input marks");
  }
  const tailEnd = endMarkMs + GESTURE_TAIL_MS;
  const latencies: number[] = [];
  let unpresented = 0;
  // presentedMs is already sorted ascending (see parsePresentedFrames).
  const presentedMs = parsed.presentedMs;
  for (const m of marks) {
    let found = false;
    for (const p of presentedMs) {
      if (p >= m && p <= tailEnd) {
        latencies.push(p - m);
        found = true;
        break;
      }
    }
    if (!found) unpresented += 1;
  }
  return {
    input_marks: marks.length,
    input_unpresented: unpresented,
    input_to_present_p50_ms: percentile(latencies, 0.5),
    input_to_present_p95_ms: percentile(latencies, 0.95),
    input_to_present_p99_ms: percentile(latencies, 0.99),
  };
}

// ---------- presented intervals / measured vsync ----------

/**
 * Consecutive deltas `b - a` over the WHOLE `presentedMs` array; zero and
 * negative deltas are dropped (a malformed frame and an out-of-order one).
 * Unlike `gestureIntervals`, there is NO window — this feeds vsync detection,
 * which must see every consecutive frame pair.
 */
export function presentedIntervals(presentedMs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < presentedMs.length; i++) {
    const a = presentedMs[i - 1];
    const b = presentedMs[i];
    if (a == null || b == null) continue;
    const d = b - a;
    if (d > 0) out.push(d);
  }
  return out;
}

/**
 * The mode of the rounded (0.1 ms) presented-frame intervals across both
 * gestures is the vsync period; ties go to the SMALLEST rounded value (so a
 * 120 Hz / 8.3 ms mode wins over a 60 Hz / 16.7 ms tail). Empty or all-non-
 * finite -> throw; the bench never produces zero intervals because every
 * gesture requires >= 2 presented frames. Measured, never declared: there is
 * no constant 60 / 120 / 16.7 anywhere in this function.
 */
export function measureVsync(intervalsMs: readonly number[]): CadenceDisplay {
  const counts = new Map<number, number>();
  for (const v of intervalsMs) {
    if (!Number.isFinite(v) || v <= 0) continue;
    const rounded = Math.round(v * 10) / 10;
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }
  if (counts.size === 0) {
    throw new Error("no presented intervals");
  }
  let modeValue = Number.NaN;
  let modeCount = -1;
  for (const [value, count] of counts) {
    if (count > modeCount || (count === modeCount && value < modeValue)) {
      modeValue = value;
      modeCount = count;
    }
  }
  const vsyncMs = Math.round(modeValue * 10) / 10;
  return { vsync_ms: vsyncMs, hz: Math.round(1000 / vsyncMs) };
}

/**
 * Cross-check vsync signal that does NOT depend on the dispatched input rate.
 * Chromium's frame reporter assigns each issued BeginFrame a `frame_sequence`
 * number; one BeginFrame -> one new sequence number, regardless of whether
 * the frame was presented, dropped, or forked. By looking at BEGIN-time
 * difference divided by SEQUENCE-difference between consecutive frames of
 * ONE BeginFrame source, we recover the wall-clock per-refresh slot the
 * compositor was using. Input-independent: a frame's sequence number counts
 * BeginFrame ticks, one per refresh, whether or not the frame was presented,
 * and skips numbers for ticks it did not issue.
 *
 * Rules:
 *  - Only `PipelineReporter` `b` and `X` events whose `pid` equals
 *    `rendererPid` and whose `args.frame_reporter.frame_source` AND
 *    `args.frame_reporter.frame_sequence` are both numbers are considered.
 *    `e` events carry no args and are ignored; events on other pids are
 *    ignored.
 *  - One entry per `frame_source:frame_sequence` key, taken at the EARLIEST
 *    `ts` of that key (a forked pair repeats the key on the same frame; we
 *    keep the first `b` / `X` we see).
 *  - Group by `frame_source`. Within each source, sort by
 *    `frame_sequence` ascending. For each consecutive pair with
 *    `dSeq > 0` and `dTs > 0`, push `(dTs_us / 1000) / dSeq` (milliseconds
 *    per refresh slot). Never pair across sources; no window; return `[]`
 *    when nothing qualifies — the caller decides what that means.
 *
 * The result feeds `measureVsync` for the mode (`vsync_seq_ms`); `vsync_ms`
 * (the receipt value) stays the mode of the presented intervals.
 */
export function frameSequenceIntervals(events: readonly unknown[], rendererPid: number): number[] {
  const raw = readRawEvents(events);
  // Key = `${frame_source}:${frame_sequence}` -> earliest ts (microseconds).
  const earliest = new Map<string, number>();
  for (const e of raw) {
    const r = parseReporterEvent(e);
    if (r == null) continue;
    if (r.pid !== rendererPid) continue;
    if (r.kind !== "b" && r.kind !== "X") continue; // "e" carries no args
    const src = r.reporter.frame_source;
    const seq = r.reporter.frame_sequence;
    if (src == null || seq == null) continue;
    const key = `${src}:${seq}`;
    const prev = earliest.get(key);
    if (prev == null || r.ts < prev) earliest.set(key, r.ts);
  }
  if (earliest.size === 0) return [];
  // Group by frame_source.
  type SeqTs = { seq: number; ts: number };
  const bySource = new Map<number, SeqTs[]>();
  for (const [key, ts] of earliest) {
    const sep = key.indexOf(":");
    if (sep < 0) continue;
    const src = Number(key.slice(0, sep));
    const seq = Number(key.slice(sep + 1));
    if (!Number.isFinite(src) || !Number.isFinite(seq)) continue;
    let list = bySource.get(src);
    if (list == null) {
      list = [];
      bySource.set(src, list);
    }
    list.push({ seq, ts });
  }
  const out: number[] = [];
  for (const list of bySource.values()) {
    list.sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (a == null || b == null) continue;
      const dSeq = b.seq - a.seq;
      const dTs = b.ts - a.ts;
      if (dSeq <= 0 || dTs <= 0) continue;
      out.push((dTs / 1000) / dSeq);
    }
  }
  return out;
}

// ---------- input-mark clock check ----------

/**
 * The bench listener stamps each mark with `ev.timeStamp` via
 * `performance.mark(name, { startTime })`. The trace should carry every
 * mark at exactly that ts, so the two views — CDP trace ts/1000 and the
 * page-side `performance.getEntriesByName(name, "mark")` startTimes — must
 * agree. Sort both ascending, require equal lengths, and verify every
 * delta-from-first agrees within `toleranceMs` (default 0.01 ms — the mark
 * clock is microsecond-precision, 0.01 ms is two-decimal headroom). An empty
 * pair is ok (no marks to disagree on). On ok:false, `reason` names the
 * failure shape so the bench can dump the offending trace.
 */
export function checkInputMarkClock(
  traceMarksMs: readonly number[],
  pageStartTimesMs: readonly number[],
  toleranceMs = 0.01,
): { ok: true; maxDeviationMs: number } | { ok: false; reason: string } {
  if (traceMarksMs.length === 0 && pageStartTimesMs.length === 0) {
    return { ok: true, maxDeviationMs: 0 };
  }
  const trace = [...traceMarksMs].sort((a, b) => a - b);
  const page = [...pageStartTimesMs].sort((a, b) => a - b);
  if (trace.length !== page.length) {
    return { ok: false, reason: `count mismatch trace=${trace.length} page=${page.length}` };
  }
  const traceBase = trace[0] ?? 0;
  const pageBase = page[0] ?? 0;
  let maxDev = 0;
  for (let i = 0; i < trace.length; i++) {
    const dev = Math.abs((trace[i] - traceBase) - (page[i] - pageBase));
    if (dev > maxDev) maxDev = dev;
    if (dev > toleranceMs) {
      return { ok: false, reason: `deviation at i=${i} is ${dev} ms (> ${toleranceMs} ms tolerance)` };
    }
  }
  return { ok: true, maxDeviationMs: maxDev };
}

// ---------- receipt builder / validator ----------

export type BuildCadenceReceiptInput = {
  commit: string;
  impl: "mm" | "lwc";
  host: { os: string; cpu: string; dpr: number };
  display: CadenceDisplay;
  generated_at?: string;
  pan: CadenceGestureStats;
  zoom: CadenceGestureStats;
};

type MetricOrder = {
  metric: string;
  gesture: "pan" | "zoom";
  field: "p95_ms" | "p99_ms" | "input_to_present_p95_ms" | "input_to_present_p99_ms";
  budget: number;
};

const METRIC_ORDER: readonly MetricOrder[] = [
  { metric: "pan.presented_p95_ms", gesture: "pan", field: "p95_ms", budget: CADENCE_BUDGETS.presented_p95_ms },
  { metric: "pan.presented_p99_ms", gesture: "pan", field: "p99_ms", budget: CADENCE_BUDGETS.presented_p99_ms },
  { metric: "zoom.presented_p95_ms", gesture: "zoom", field: "p95_ms", budget: CADENCE_BUDGETS.presented_p95_ms },
  { metric: "zoom.presented_p99_ms", gesture: "zoom", field: "p99_ms", budget: CADENCE_BUDGETS.presented_p99_ms },
  { metric: "pan.input_to_present_p95_ms", gesture: "pan", field: "input_to_present_p95_ms", budget: CADENCE_BUDGETS.input_to_present_p95_ms },
  { metric: "pan.input_to_present_p99_ms", gesture: "pan", field: "input_to_present_p99_ms", budget: CADENCE_BUDGETS.input_to_present_p99_ms },
  { metric: "zoom.input_to_present_p95_ms", gesture: "zoom", field: "input_to_present_p95_ms", budget: CADENCE_BUDGETS.input_to_present_p95_ms },
  { metric: "zoom.input_to_present_p99_ms", gesture: "zoom", field: "input_to_present_p99_ms", budget: CADENCE_BUDGETS.input_to_present_p99_ms },
];

function readGestureMetric(s: CadenceGestureStats, field: MetricOrder["field"]): number {
  switch (field) {
    case "p95_ms":
      return s.p95_ms;
    case "p99_ms":
      return s.p99_ms;
    case "input_to_present_p95_ms":
      return s.input_to_present_p95_ms;
    case "input_to_present_p99_ms":
      return s.input_to_present_p99_ms;
  }
}

export function buildCadenceReceipt(input: BuildCadenceReceiptInput): CadenceReceipt {
  const violations: CadenceReceipt["violations"] = [];
  for (const m of METRIC_ORDER) {
    const stats = m.gesture === "pan" ? input.pan : input.zoom;
    const value = readGestureMetric(stats, m.field);
    if (value > m.budget) violations.push({ metric: m.metric, value, budget: m.budget });
  }
  return {
    commit: input.commit,
    impl: input.impl,
    host: input.host,
    display: input.display,
    generated_at: input.generated_at ?? new Date().toISOString(),
    gesture: { pan: input.pan, zoom: input.zoom },
    budgets: CADENCE_BUDGETS,
    violations,
    budget_ok: violations.length === 0,
  };
}

function deepEqualBudgets(a: unknown): { ok: true } | { ok: false; reason: string } {
  if (a == null || typeof a !== "object") return { ok: false, reason: "budgets must be an object" };
  const obj = a as Record<string, unknown>;
  const keys = Object.keys(obj);
  const required = ["presented_p95_ms", "presented_p99_ms", "input_to_present_p95_ms", "input_to_present_p99_ms"] as const;
  for (const k of required) {
    if (!(k in obj)) return { ok: false, reason: `missing budgets key "${k}"` };
    if (obj[k] !== (CADENCE_BUDGETS as Record<string, number>)[k]) {
      return { ok: false, reason: `budgets.${k} must equal ${(CADENCE_BUDGETS as Record<string, number>)[k]} (got ${JSON.stringify(obj[k])})` };
    }
  }
  for (const k of keys) {
    if (!(required as readonly string[]).includes(k)) return { ok: false, reason: `unexpected budgets key "${k}"` };
  }
  return { ok: true };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.floor(v) === v && v > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.floor(v) === v && v >= 0;
}

function isNonNegativeFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Exactly nine top-level keys; exactly thirteen gesture stat keys per gesture. */
const TOP_LEVEL_KEYS = [
  "commit",
  "impl",
  "host",
  "display",
  "generated_at",
  "gesture",
  "budgets",
  "violations",
  "budget_ok",
] as const;
const GESTURE_STAT_KEYS = [
  "inputs",
  "input_hz",
  "presented",
  "partial",
  "dropped",
  "p50_ms",
  "p95_ms",
  "p99_ms",
  "input_marks",
  "input_unpresented",
  "input_to_present_p50_ms",
  "input_to_present_p95_ms",
  "input_to_present_p99_ms",
] as const;
const DISPLAY_KEYS = ["vsync_ms", "hz"] as const;

export function validateCadenceReceipt(receipt: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (receipt == null || typeof receipt !== "object") {
    return { ok: false, errors: ["receipt is not an object"] };
  }
  const r = receipt as Record<string, unknown>;
  // A3: reject a top-level key outside the nine.
  for (const k of Object.keys(r)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(k)) {
      errors.push(`unexpected top-level key "${k}"`);
    }
  }
  for (const k of TOP_LEVEL_KEYS) {
    if (!(k in r)) errors.push(`missing top-level key "${k}"`);
  }
  if (typeof r.commit !== "string" || !/^[0-9a-f]{40}$/.test(r.commit)) {
    errors.push(`commit must match /^[0-9a-f]{40}$/ (got ${JSON.stringify(r.commit)})`);
  }
  if (r.impl !== "mm" && r.impl !== "lwc") {
    errors.push(`impl must be "mm" or "lwc" (got ${JSON.stringify(r.impl)})`);
  }
  if (typeof r.generated_at !== "string" || Number.isNaN(Date.parse(r.generated_at))) {
    errors.push(`generated_at must parse as a Date (got ${JSON.stringify(r.generated_at)})`);
  }
  const host = r.host as Record<string, unknown> | undefined;
  if (host == null || typeof host !== "object") {
    errors.push("host must be an object");
  } else {
    if (!isNonEmptyString(host.os)) errors.push(`host.os must be a non-empty string (got ${JSON.stringify(host.os)})`);
    if (!isNonEmptyString(host.cpu)) errors.push(`host.cpu must be a non-empty string (got ${JSON.stringify(host.cpu)})`);
    if (!isFiniteNumber(host.dpr) || host.dpr <= 0) {
      errors.push(`host.dpr must be a positive number (got ${JSON.stringify(host.dpr)})`);
    }
  }
  const display = r.display as Record<string, unknown> | undefined;
  if (display == null || typeof display !== "object") {
    errors.push("display must be an object");
  } else {
    for (const k of Object.keys(display)) {
      if (!(DISPLAY_KEYS as readonly string[]).includes(k)) {
        errors.push(`unexpected display key "${k}"`);
      }
    }
    for (const k of DISPLAY_KEYS) {
      if (!(k in display)) errors.push(`missing display key "${k}"`);
    }
    if (!isNonNegativeFinite(display.vsync_ms) || display.vsync_ms <= 0) {
      errors.push(`display.vsync_ms must be a finite number > 0 (got ${JSON.stringify(display.vsync_ms)})`);
    }
    if (!isPositiveInteger(display.hz)) {
      errors.push(`display.hz must be a positive integer (got ${JSON.stringify(display.hz)})`);
    } else if (isNonNegativeFinite(display.vsync_ms) && display.vsync_ms > 0) {
      const expected = Math.round(1000 / (display.vsync_ms as number));
      if (display.hz !== expected) {
        errors.push(`display.hz (${display.hz}) must equal round(1000/vsync_ms) (${expected})`);
      }
    }
  }
  const budgetCheck = deepEqualBudgets(r.budgets);
  if (!budgetCheck.ok) {
    errors.push(budgetCheck.reason);
  }
  const gesture = r.gesture as { pan?: unknown; zoom?: unknown } | undefined;
  if (gesture == null || typeof gesture !== "object") {
    errors.push("gesture must be an object");
  } else {
    for (const g of ["pan", "zoom"] as const) {
      const s = gesture[g] as Record<string, unknown> | undefined;
      if (s == null || typeof s !== "object") {
        errors.push(`gesture.${g} must be an object`);
        continue;
      }
      // A3: reject a stat key outside the thirteen.
      for (const k of Object.keys(s)) {
        if (!(GESTURE_STAT_KEYS as readonly string[]).includes(k)) {
          errors.push(`unexpected gesture.${g} key "${k}"`);
        }
      }
      for (const k of GESTURE_STAT_KEYS) {
        if (!(k in s)) errors.push(`missing gesture.${g} key "${k}"`);
      }
      const finiteKeys = ["input_hz", "p50_ms", "p95_ms", "p99_ms", "input_to_present_p50_ms", "input_to_present_p95_ms", "input_to_present_p99_ms"];
      for (const k of finiteKeys) {
        if (!isNonNegativeFinite(s[k])) errors.push(`gesture.${g}.${k} must be a finite number >= 0 (got ${JSON.stringify(s[k])})`);
      }
      for (const k of ["inputs", "presented", "partial", "dropped", "input_unpresented"]) {
        if (!isNonNegativeInt(s[k])) errors.push(`gesture.${g}.${k} must be a non-negative integer (got ${JSON.stringify(s[k])})`);
      }
      // input_marks is the unique count of input events; a gesture without any
      // input marks has no per-input latency to report, so the bench throws
      // "no input marks" and the receipt must never carry 0 here.
      if (!isPositiveInteger(s.input_marks)) {
        errors.push(`gesture.${g}.input_marks must be an integer >= 1 (got ${JSON.stringify(s.input_marks)})`);
      }
      // input_unpresented <= input_marks (cannot have more unpresented than inputs).
      if (isNonNegativeInt(s.input_marks) && isNonNegativeInt(s.input_unpresented) && (s.input_unpresented as number) > (s.input_marks as number)) {
        errors.push(`gesture.${g}.input_unpresented (${s.input_unpresented}) must be <= input_marks (${s.input_marks})`);
      }
    }
  }
  if (!Array.isArray(r.violations)) {
    errors.push("violations must be an array");
  }
  if (typeof r.budget_ok !== "boolean") {
    errors.push("budget_ok must be a boolean");
  }

  // Round-trip check: rebuild the receipt from the gesture stats + display
  // and the canonical budgets and compare violations / budget_ok exactly.
  if (gesture && typeof gesture === "object") {
    const pan = gesture.pan as CadenceGestureStats | undefined;
    const zoom = gesture.zoom as CadenceGestureStats | undefined;
    if (
      pan != null && zoom != null &&
      isNonNegativeFinite(pan.p95_ms) && isNonNegativeFinite(pan.p99_ms) &&
      isNonNegativeFinite(zoom.p95_ms) && isNonNegativeFinite(zoom.p99_ms) &&
      isNonNegativeFinite(pan.input_to_present_p95_ms) && isNonNegativeFinite(pan.input_to_present_p99_ms) &&
      isNonNegativeFinite(zoom.input_to_present_p95_ms) && isNonNegativeFinite(zoom.input_to_present_p99_ms) &&
      display != null && typeof display === "object" &&
      isNonNegativeFinite(display.vsync_ms) && isPositiveInteger(display.hz)
    ) {
      const expected = buildCadenceReceipt({
        commit: typeof r.commit === "string" ? r.commit : "0".repeat(40),
        impl: r.impl === "lwc" ? "lwc" : "mm",
        host: {
          os: typeof host?.os === "string" ? host.os : "x",
          cpu: typeof host?.cpu === "string" ? host.cpu : "x",
          dpr: isFiniteNumber(host?.dpr) ? (host.dpr as number) : 1,
        },
        display: { vsync_ms: display.vsync_ms as number, hz: display.hz as number },
        pan,
        zoom,
      });
      if (Array.isArray(r.violations)) {
        const ev = JSON.stringify(r.violations);
        const av = JSON.stringify(expected.violations);
        if (ev !== av) errors.push(`violations do not match what buildCadenceReceipt would compute (got ${ev}, want ${av})`);
      }
      if (typeof r.budget_ok === "boolean" && r.budget_ok !== expected.budget_ok) {
        errors.push(`budget_ok (${r.budget_ok}) does not match what buildCadenceReceipt would compute (${expected.budget_ok})`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}
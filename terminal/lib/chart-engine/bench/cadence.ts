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
// Pure: no fs, no playwright, no DOM, no ajv. Only `./corpus` is imported.
// House style: 2-space indent, double quotes, semicolons, named exports.

import { percentile } from "./corpus";

export const CADENCE_BUDGETS = {
  presented_p95_ms: 20,
  presented_p99_ms: 33.4,
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

export type CadenceGestureStats = {
  inputs: number;
  input_hz: number;
  presented: number;
  partial: number;
  dropped: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
};

export type CadenceReceipt = {
  commit: string;
  impl: "mm" | "lwc";
  host: { os: string; cpu: string; dpr: number };
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
 */
export function gestureStats(
  parsed: ParsedPresentation,
  startMarkMs: number,
  endMarkMs: number,
  inputs: number,
): CadenceGestureStats {
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

// ---------- receipt builder / validator ----------

export type BuildCadenceReceiptInput = {
  commit: string;
  impl: "mm" | "lwc";
  host: { os: string; cpu: string; dpr: number };
  generated_at?: string;
  pan: CadenceGestureStats;
  zoom: CadenceGestureStats;
};

type MetricOrder = { metric: string; gesture: "pan" | "zoom"; field: "p95_ms" | "p99_ms"; budget: number };

const METRIC_ORDER: readonly MetricOrder[] = [
  { metric: "pan.presented_p95_ms", gesture: "pan", field: "p95_ms", budget: CADENCE_BUDGETS.presented_p95_ms },
  { metric: "pan.presented_p99_ms", gesture: "pan", field: "p99_ms", budget: CADENCE_BUDGETS.presented_p99_ms },
  { metric: "zoom.presented_p95_ms", gesture: "zoom", field: "p95_ms", budget: CADENCE_BUDGETS.presented_p95_ms },
  { metric: "zoom.presented_p99_ms", gesture: "zoom", field: "p99_ms", budget: CADENCE_BUDGETS.presented_p99_ms },
];

function readGestureMetric(s: CadenceGestureStats, field: MetricOrder["field"]): number {
  if (field === "p95_ms") return s.p95_ms;
  return s.p99_ms;
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
    generated_at: input.generated_at ?? new Date().toISOString(),
    gesture: { pan: input.pan, zoom: input.zoom },
    budgets: CADENCE_BUDGETS,
    violations,
    budget_ok: violations.length === 0,
  };
}

function deepEqualBudgets(a: unknown): boolean {
  if (a == null || typeof a !== "object") return false;
  const obj = a as Record<string, unknown>;
  return (
    obj.presented_p95_ms === CADENCE_BUDGETS.presented_p95_ms &&
    obj.presented_p99_ms === CADENCE_BUDGETS.presented_p99_ms
  );
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.floor(v) === v && v >= 0;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Exactly eight top-level keys; exactly eight gesture stat keys per gesture. */
const TOP_LEVEL_KEYS = [
  "commit",
  "impl",
  "host",
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
] as const;

export function validateCadenceReceipt(receipt: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (receipt == null || typeof receipt !== "object") {
    return { ok: false, errors: ["receipt is not an object"] };
  }
  const r = receipt as Record<string, unknown>;
  // A3: reject a top-level key outside the eight.
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
  if (!deepEqualBudgets(r.budgets)) {
    errors.push(`budgets must deep-equal CADENCE_BUDGETS (got ${JSON.stringify(r.budgets)})`);
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
      // A3: reject a stat key outside the eight.
      for (const k of Object.keys(s)) {
        if (!(GESTURE_STAT_KEYS as readonly string[]).includes(k)) {
          errors.push(`unexpected gesture.${g} key "${k}"`);
        }
      }
      const finiteKeys = ["input_hz", "p50_ms", "p95_ms", "p99_ms"];
      for (const k of finiteKeys) {
        if (!isFiniteNumber(s[k])) errors.push(`gesture.${g}.${k} must be a finite number (got ${JSON.stringify(s[k])})`);
      }
      for (const k of ["inputs", "presented", "partial", "dropped"]) {
        if (!isNonNegativeInt(s[k])) errors.push(`gesture.${g}.${k} must be a non-negative integer (got ${JSON.stringify(s[k])})`);
      }
    }
  }
  if (!Array.isArray(r.violations)) {
    errors.push("violations must be an array");
  }
  if (typeof r.budget_ok !== "boolean") {
    errors.push("budget_ok must be a boolean");
  }

  // Round-trip check: rebuild the receipt from the gesture stats and the
  // canonical budgets and compare violations / budget_ok exactly.
  if (gesture && typeof gesture === "object") {
    const pan = gesture.pan as CadenceGestureStats | undefined;
    const zoom = gesture.zoom as CadenceGestureStats | undefined;
    if (
      pan != null && zoom != null &&
      isFiniteNumber(pan.p95_ms) && isFiniteNumber(pan.p99_ms) &&
      isFiniteNumber(zoom.p95_ms) && isFiniteNumber(zoom.p99_ms)
    ) {
      const expected = buildCadenceReceipt({
        commit: typeof r.commit === "string" ? r.commit : "0".repeat(40),
        impl: r.impl === "lwc" ? "lwc" : "mm",
        host: {
          os: typeof host?.os === "string" ? host.os : "x",
          cpu: typeof host?.cpu === "string" ? host.cpu : "x",
          dpr: isFiniteNumber(host?.dpr) ? (host.dpr as number) : 1,
        },
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

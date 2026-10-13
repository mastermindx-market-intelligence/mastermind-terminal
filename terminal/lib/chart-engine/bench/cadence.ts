// Chart-engine presented-frame cadence parser (Q03).
//
// Pure, browser-safe helper that turns a Chromium devtools CDP trace into
// per-pid presented-frame slices, with a strict renderer-pid choice (the
// Renderer's pid is identified by blink.user_timing marks under the
// `markPrefix`; only when no such mark exists AND exactly one pid emitted
// PipelineReporter is that pid chosen). NO_UPDATE_DESIRED slices are omitted
// from `frames`. Frames are sorted ascending by presentation time (ms);
// `presentedMs` is the unique sorted ms of the "presented" subset only.
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
const STATE_PRESENTED_ALL = "PresentedAll";
const STATE_PRESENTED_PARTIAL = "PresentedPartial";
const STATE_DROPPED = "Dropped";
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

// ---------- typed views of a raw trace event (structural; never `any`) ----------

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
    frame_reporter?: { state?: unknown };
    chrome_frame_reporter?: { state?: unknown };
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

/** Key used to pair `b`/`e` events of the SAME frame-reporter track. */
function trackKeyOf(e: RawEvent, pid: number): string {
  const id2 = e.id2;
  const local = id2 ? readString(id2.local) : null;
  if (local != null) return `${pid}:${local}`;
  const global = id2 ? readString(id2.global) : null;
  if (global != null) return `${pid}:${global}`;
  const id = readString(e.id);
  return `${pid}:${id ?? "?"}`;
}

type ParsedBegin = { kind: "b"; pid: number; key: string; ts: number; state: string | null };
type ParsedEnd = { kind: "e"; pid: number; key: string; ts: number };
type ParsedComplete = { kind: "X"; pid: number; ts: number; dur: number; state: string | null };

function parseReporterEvent(e: RawEvent): ParsedBegin | ParsedEnd | ParsedComplete | null {
  if (readString(e.name) !== "PipelineReporter") return null;
  const pid = readPid(e);
  if (pid == null) return null;
  const ph = readString(e.ph);
  const ts = readNumber(e.ts);
  if (ts == null) return null;
  if (ph === "b") {
    const args = e.args;
    const inner = args?.frame_reporter ?? args?.chrome_frame_reporter;
    const state = inner ? (typeof inner.state === "string" ? inner.state : null) : null;
    return { kind: "b", pid, key: trackKeyOf(e, pid), ts, state };
  }
  if (ph === "e") {
    return { kind: "e", pid, key: trackKeyOf(e, pid), ts };
  }
  if (ph === "X") {
    const dur = readNumber(e.dur);
    if (dur == null) return null;
    const args = e.args;
    const inner = args?.frame_reporter ?? args?.chrome_frame_reporter;
    const state = inner ? (typeof inner.state === "string" ? inner.state : null) : null;
    return { kind: "X", pid, ts, dur, state };
  }
  return null;
}

function toFrameState(state: string | null): "presented" | "partial" | "dropped" | null {
  if (state === STATE_PRESENTED_ALL) return "presented";
  if (state === STATE_PRESENTED_PARTIAL) return "partial";
  if (state === STATE_DROPPED) return "dropped";
  return null; // STATE_NO_UPDATE_DESIRED or anything unknown: omit
}

// ---------- public parser ----------

/**
 * Pair `b` with the next `e` of the same key after sorting by ts; unpaired
 * halves are ignored. `X` uses ts+dur. Renderer pid = the pid of a
 * blink.user_timing event whose name starts with `markPrefix` AND that also
 * emitted PipelineReporter; if no such mark exists and exactly one pid
 * emitted PipelineReporter, that pid is used. NO_UPDATE_DESIRED is omitted.
 * Throws when no Presentation records can be produced for the chosen pid.
 */
export function parsePresentedFrames(events: readonly unknown[], markPrefix = "cadence:"): ParsedPresentation {
  const raw = readRawEvents(events);

  // Renderer pid selection.
  const reporterPids = new Set<number>();
  for (const e of raw) {
    if (readString(e.name) === "PipelineReporter") {
      const pid = readPid(e);
      if (pid != null) reporterPids.add(pid);
    }
  }

  let rendererPid: number | null = null;
  // First pass: pid of any blink.user_timing whose name starts with markPrefix
  // AND that pid also appears in reporterPids. Take the first such mark.
  for (const e of raw) {
    if (readString(e.cat) !== "blink.user_timing") continue;
    const name = readString(e.name);
    if (name == null || !name.startsWith(markPrefix)) continue;
    const pid = readPid(e);
    if (pid == null) continue;
    if (reporterPids.has(pid)) {
      rendererPid = pid;
      break;
    }
  }
  // Fallback: exactly one pid emitted PipelineReporter.
  if (rendererPid == null && reporterPids.size === 1) {
    rendererPid = reporterPids.values().next().value ?? null;
  }
  if (rendererPid == null) {
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

  // Pair `b` with the next `e` of the same key (no overlapping slices per
  // track, per the trace contract).
  const frames: PresentedFrame[] = [];
  let presented = 0;
  let partial = 0;
  let dropped = 0;
  for (let i = 0; i < parsed.length; i++) {
    const ev = parsed[i];
    if (ev.kind === "X") {
      const state = toFrameState(ev.state);
      if (state == null) continue;
      const ms = (ev.ts + ev.dur) / 1000;
      frames.push({ ms, state });
      if (state === "presented") presented++;
      else if (state === "partial") partial++;
      else dropped++;
      continue;
    }
    if (ev.kind === "b") {
      const state = toFrameState(ev.state);
      if (state == null) continue;
      const paired = findNextEnd(parsed, i + 1, ev.key);
      if (paired == null) continue;
      const ms = paired.ts / 1000;
      frames.push({ ms, state });
      if (state === "presented") presented++;
      else if (state === "partial") partial++;
      else dropped++;
      continue;
    }
    // ev.kind === "e" — terminal half; ignore unpaired ends.
  }
  if (frames.length === 0) {
    throw new Error("no presentation records in trace");
  }

  frames.sort((a, b) => a.ms - b.ms);

  // Unique sorted ms of "presented" frames only.
  const presentedSet = new Set<number>();
  for (const f of frames) if (f.state === "presented") presentedSet.add(f.ms);
  const presentedMs = Array.from(presentedSet).sort((a, b) => a - b);

  return { frames, presentedMs, presented, partial, dropped, rendererPid };
}

function findNextEnd(
  list: ReadonlyArray<ParsedBegin | ParsedEnd | ParsedComplete>,
  startIdx: number,
  key: string,
): ParsedEnd | null {
  for (let i = startIdx; i < list.length; i++) {
    const ev = list[i];
    if (ev.kind === "e" && ev.key === key) return ev;
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
 * Whole-trace counts: `presented`/`partial`/`dropped` are the slices of
 * `parsed.frames` whose ms lies in the window. `input_hz` = dispatch rate.
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

type MetricOrder = { metric: string; get: (s: CadenceGestureStats) => number; budget: number };

const METRIC_ORDER: readonly MetricOrder[] = [
  { metric: "pan.presented_p95_ms", get: (s) => s.p95_ms, budget: CADENCE_BUDGETS.presented_p95_ms },
  { metric: "pan.presented_p99_ms", get: (s) => s.p99_ms, budget: CADENCE_BUDGETS.presented_p99_ms },
  { metric: "zoom.presented_p95_ms", get: (s) => s.p95_ms, budget: CADENCE_BUDGETS.presented_p95_ms },
  { metric: "zoom.presented_p99_ms", get: (s) => s.p99_ms, budget: CADENCE_BUDGETS.presented_p99_ms },
];

export function buildCadenceReceipt(input: BuildCadenceReceiptInput): CadenceReceipt {
  const violations: CadenceReceipt["violations"] = [];
  for (const m of METRIC_ORDER) {
    const pValue = m.get(input.pan);
    if (pValue > m.budget) violations.push({ metric: m.metric, value: pValue, budget: m.budget });
    const zValue = m.get(input.zoom);
    if (zValue > m.budget) violations.push({ metric: m.metric, value: zValue, budget: m.budget });
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

export function validateCadenceReceipt(receipt: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (receipt == null || typeof receipt !== "object") {
    return { ok: false, errors: ["receipt is not an object"] };
  }
  const r = receipt as Record<string, unknown>;
  const keys = ["commit", "impl", "host", "generated_at", "gesture", "budgets", "violations", "budget_ok"];
  for (const k of keys) {
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
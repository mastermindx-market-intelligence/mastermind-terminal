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
// refreshes and this mode tracks the modal INPUT GAP, which is generally
// NOT a whole multiple of the slot (a slow headless host read 43.5 ms on a
// 16.666 ms clock = 2.6 slots). `frameSequenceIntervals` is the
// cross-check that does not depend on input: begin-time difference divided
// by frame_sequence difference between consecutive frames of one BeginFrame
// source. Its mode is printed as vsync_seq_ms on the diagnostic line and is
// not part of the receipt.
//
// Protocol v2 (zoom only; Q03c):
// The v2 zoom gesture sends the 60 wheels via wall-clock seeded dispatch
// (one Input.dispatchMouseEvent at a time, scheduled by a Mulberry32 PRNG
// seeded with CADENCE_V2_SEED_BASE + run index) and replaces the 200 ms
// pre-gesture idle with a harness-side requestAnimationFrame heartbeat.
// The 13 stat keys on gesture.zoom stay unchanged; v2 receipts add three
// extra keys (dispatch, awake_start, answered_by_prior_frame) and carry a
// top-level `protocol` field. The validator refuses "INVALID (q03b-v2)"
// when any of the four conditions from the ruling fires. v1 receipts and
// v2 receipts are NEVER compared without the protocol column.
//
// A refused (INVALID) v2 run is repeated, never counted and never read, so
// `cadenceInvalidLine` formats its one allowed log line: dispatch identity,
// the four INVALID-rule inputs and the two end-mark diagnostics only — no
// latency, percentile, cadence or answered number. `dispatchOnSchedule`
// settles as soon as the last send is fired and NEVER awaits a send; the
// bench counts fulfilled sends with `countDispatched` AFTER the end mark.
//
// Protocol v3 (zoom only; ruled prospectively before any v3 receipt):
// v3 keeps every v2 input, schedule, heartbeat, budget and INVALID rule and
// changes ONE thing: the zoom latency anchor. A CDP `Input.dispatchMouseEvent`
// mouseWheel is time-stamped when the Browser process receives the command
// (that stamp is the event's `timeStamp`, which the bench marks), then held
// behind an `InsertVisualStateCallback` before the Browser forwards it to the
// renderer. A wheel from the operating system is forwarded at receipt and
// never pays that CDP-only wait. v3 therefore anchors each zoom input at its
// Browser-process `RenderWidgetHostImpl::ForwardWheelEvent` slice (trace
// category "input", captured for the zoom gesture only) instead of at the
// mark. Wheel k's forward is paired with mark k by index: the Browser
// forwards wheels in receipt order, so with exactly one non-zero forward per
// scheduled wheel the index pairing is the only order-preserving one, and
// each forward must lie in [mark_k, mark_k + 30 ms]. A forward is NOT
// required to precede mark_k+1: marks are Browser-receipt stamps, not send
// times, and a held first wheel can be received only ~6 ms before the next
// (the 367f488e5c67 mm diag trace: wheel 0 -> 1 stamp gap 6.30 ms, forward 0
// at 10.38 ms after mark 0). A dropped or coalesced wheel changes the
// forward count, which the count rule refuses. The answering rule is unchanged:
// the first STATE_PRESENTED_ALL presentation at-or-after the anchor inside
// the gesture tail. The v3 zoom record adds one `forward` block (forwards,
// paired, stamp-to-forward min/p50/max); a run whose forwards cannot be
// paired one-to-one with the 60 marks is "INVALID (q03b-v3)", repeated and
// never read. Pan is unchanged in every protocol.
//
// Protocol v4 (zoom only; ruled prospectively before any v4 receipt):
// v4 keeps every v3 input, schedule, heartbeat, pairing, budget and INVALID
// rule and changes the ANSWER, the ANCHOR and the ENDPOINT. No v3 receipt was
// taken: a pre-receipt check found that the v1-v3 answer (the first
// presentation at-or-after the anchor) is, for almost every wheel, an EARLIER
// frame than the one the wheel itself produced, so no Q03b receipt so far
// measured the wheel's own frame.
//   Answer: the wheel's own frame, as Chromium attributes it. Each wheel has
//   one renderer-pid `EventLatency` async slice (category
//   "cc,benchmark,input,input.scrolling", event_type MOUSE_WHEEL) whose
//   `BrowserMainToRendererCompositor` stage begins when the Browser forwards
//   it. Forward k maps to the EventLatency whose stage begin is nearest it,
//   and only when that is mutual (forward k is also the nearest forward of
//   ANY delta to that stage begin), within 0.1 ms and claimed by no other
//   forward. An EventLatency that terminates without presenting (Chromium
//   ends it at RendererMainProcessing when the wheel's update rides a later
//   frame) is answered by the first presented MOUSE_WHEEL EventLatency whose
//   Commit stage begins at-or-after the terminated slice's end.
//   Endpoint: the GPU swap end of that frame (the begin of its
//   `SwapEndToPresentationCompositorFrame` stage). The OS display stage
//   after the swap is excluded (Chairman ruling 2026-10-18); the swap end
//   must still lie inside the gesture tail.
//   Anchor: forward k minus the busy part of the CDP hold, bias_k =
//   max(0, min(busy_k, forward_k - mark_k)), where busy_k is the remaining
//   duration of the renderer main thread's top-level task (trace category
//   "toplevel") that spans mark_k, or 0. An OS wheel arriving at the mark
//   would have waited for that task too.
// The v4 zoom record adds an `own_frame` block (mapped, fallback, map max,
// bias p50/max, main-thread task count). A run that cannot map all 60
// forwards within 0.1 ms, or that recorded no top-level main-thread task, is
// "INVALID (q03b-v4)", repeated and never read. Budgets are unchanged.
//
// Pure: no fs, no playwright, no DOM, no ajv. Only `./corpus` is imported.
// House style: 2-space indent, double quotes, semicolons, named exports.

import { percentile, UNMEASURED } from "./corpus";

// Q03b per-input presentation latency budgets are bound here prospectively,
// before a reference-Mac run (D10: never lower a budget after a result).
export const CADENCE_BUDGETS = {
  presented_p95_ms: 20,
  presented_p99_ms: 33.4,
  input_to_present_p95_ms: 20,
  input_to_present_p99_ms: 33.4,
} as const;

export const GESTURE_TAIL_MS = 100;

// ---------- Q03c v2 protocol constants ----------

/** The 60 wheels of every zoom gesture, dispatched at the protocol v2 schedule. */
export const CADENCE_V2_WHEELS = 60;
/** Minimum scheduled gap between consecutive wheels (ms). */
export const CADENCE_V2_GAP_MIN_MS = 17;
/** Per-wheel scheduled gap jitter amplitude (ms). */
export const CADENCE_V2_GAP_JITTER_MS = 6;
/** Base seed of the cadence V2 schedule Mulberry32; per-run seed = (BASE + runIdx) >>> 0. */
export const CADENCE_V2_SEED_BASE = 0x51c03b00;
/** Maximum tolerated wheel dispatch lateness (ms); exceeding it is INVALID (q03b-v2). */
export const CADENCE_V2_DISPATCH_DEV_MAX_MS = 2;
/** Minimum heartbeat duration before the start mark is allowed (ms). */
export const CADENCE_V2_HEARTBEAT_MIN_MS = 200;
/** Length of the lead-in window sampled for `awake_start.leadin_presentations` (ms). */
export const CADENCE_V2_LEADIN_WINDOW_MS = 200;

// ---------- q03b-v3 protocol constants ----------

/** Browser-process slice that forwards a wheel event to the renderer. */
export const CADENCE_V3_FORWARD_EVENT = "RenderWidgetHostImpl::ForwardWheelEvent";
/** Extra trace category the zoom gesture records so the forward slices exist. */
export const CADENCE_V3_ZOOM_EXTRA_CATEGORIES: readonly string[] = ["input"];
/** Maximum mark-to-forward delay (ms) for a forward to pair with its mark. */
export const CADENCE_V3_STAMP_TO_FORWARD_MAX_MS = 30;

// ---------- q03b-v4 protocol constants ----------

/** Chromium's per-input latency async slice and its exact category string. */
export const CADENCE_V4_EVENT_LATENCY = "EventLatency";
export const CADENCE_V4_EVENT_LATENCY_CATEGORY = "cc,benchmark,input,input.scrolling";
/** `args.event_latency.event_type` of a wheel's EventLatency. */
export const CADENCE_V4_EL_EVENT_TYPE = "MOUSE_WHEEL";
/** EventLatency stage whose begin is the Browser forward (the mapping stage). */
export const CADENCE_V4_EL_MAP_STAGE = "BrowserMainToRendererCompositor";
/** EventLatency stage whose begin is the main-thread commit of the frame. */
export const CADENCE_V4_EL_COMMIT_STAGE = "Commit";
/** EventLatency stage whose begin is the GPU swap end (the v4 endpoint). */
export const CADENCE_V4_EL_SWAP_END_STAGE = "SwapEndToPresentationCompositorFrame";
/** Maximum |stage begin - forward| (ms) for a forward to map to an EventLatency. */
export const CADENCE_V4_EL_MAP_MAX_MS = 0.1;
/** Extra trace categories the v4 zoom gesture records: "input" for the
 *  forwards and EventLatency, "toplevel" for the main-thread tasks. */
export const CADENCE_V4_ZOOM_EXTRA_CATEGORIES: readonly string[] = ["input", "toplevel"];
/** `thread_name` of the renderer main thread. */
export const CADENCE_V4_MAIN_THREAD = "CrRendererMain";
/** Category token of a top-level task slice. */
export const CADENCE_V4_TOPLEVEL_CATEGORY = "toplevel";

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

/** Internal: a presented/partial/dropped STATE_PRESENTED_* slice in
 *  begin/end form. Used by parsePresentedFrames (end-only consumer) and
 *  parsePresentedFrameSpans (begin+end consumer for answered_by_prior_frame). */
type SliceSpan = {
  state: "presented" | "partial" | "dropped";
  beginMs: number;
  endMs: number;
  frameKey: string;
};

/** Internal return shape of the slice-pairing helper. Same renderer-pid rule
 *  as parsePresentedFrames. */
type SlicedPresentation = {
  rendererPid: number;
  spans: SliceSpan[];
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

/** One row of `inputLatenciesMs` — the per-input detail. `latencyMs` and
 *  `answerMs` are null when the input is unpresented (no frame answers it
 *  inside the gesture tail). */
export type InputLatencyRow = {
  markMs: number;
  latencyMs: number | null;
  answerMs: number | null;
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

/** Q03c v2 zoom dispatch receipt block: the 60-wall-clock wheels the bench
 *  scheduled via dispatchOnSchedule. */
export type CadenceDispatch = {
  gap_min_ms: 17;
  gap_jitter_ms: 6;
  seed: number;
  scheduled: 60;
  dispatched: number;
  dispatch_dev_max_ms: number;
};

/** Q03c v2 awake-start receipt block: how the harness kept the renderer
 *  awake before the gesture. `leadin_presentations` is the diagnostic-only
 *  count of STATE_PRESENTED_ALL moments in the 200 ms before the first wheel. */
export type CadenceAwakeStart = {
  heartbeat_ms: number;
  heartbeat_mode: "through" | "until-first-input";
  leadin_presentations: number;
};

/** v2 zoom gesture: 13 stat keys + dispatch + awake_start +
 *  answered_by_prior_frame. `answered_by_prior_frame` counts inputs whose
 *  answering frame's beginMs lies before the input's mark (synchronously
 *  scheduled but already-presented frames). */
export type CadenceZoomV2Stats = CadenceGestureStats & {
  dispatch: CadenceDispatch;
  awake_start: CadenceAwakeStart;
  answered_by_prior_frame: number;
};

/** q03b-v3 forward block: how the zoom wheels' Browser-process forwards
 *  paired with their marks. `forwards` counts non-zero-delta forwards inside
 *  the gesture window and tail; `paired` counts index-k pairs that satisfy
 *  0 <= forward - mark <= CADENCE_V3_STAMP_TO_FORWARD_MAX_MS. The
 *  stamp-to-forward numbers are mechanism checks of the CDP dispatch path,
 *  not latency. */
export type CadenceForward = {
  forwards: number;
  paired: number;
  stamp_to_forward_min_ms: number;
  stamp_to_forward_p50_ms: number;
  stamp_to_forward_max_ms: number;
};

/** v3 zoom gesture: the v2 16 keys + `forward` (17 keys). The five
 *  `input_*` keys are forward-anchored. */
export type CadenceZoomV3Stats = CadenceZoomV2Stats & {
  forward: CadenceForward;
};

/** q03b-v4 own-frame block: how the zoom forwards mapped to their own
 *  EventLatency frames. `mapped` counts forwards with a mutual-nearest
 *  EventLatency within CADENCE_V4_EL_MAP_MAX_MS; `fallback` counts mapped
 *  wheels whose own EventLatency terminated unpresented and were answered by
 *  the next committed frame; `main_tasks` counts the renderer main thread's
 *  top-level tasks in the trace (0 = the busy term could not be measured).
 *  `bias_*` is the busy part of the hold subtracted from the forward. */
export type CadenceOwnFrame = {
  mapped: number;
  fallback: number;
  map_max_ms: number;
  bias_p50_ms: number;
  bias_max_ms: number;
  main_tasks: number;
};

/** v4 zoom gesture: the v3 17 keys + `own_frame` (18 keys). The five
 *  `input_*` keys run from forward - bias to the own frame's GPU swap end. */
export type CadenceZoomV4Stats = CadenceZoomV3Stats & {
  own_frame: CadenceOwnFrame;
};

/** Protocol discriminator on the top-level receipt. The validator refuses
 *  any other value. */
export type CadenceProtocol = "q03b-v1" | "q03b-v2" | "q03b-v3" | "q03b-v4";

const CADENCE_PROTOCOLS: readonly CadenceProtocol[] = ["q03b-v1", "q03b-v2", "q03b-v3", "q03b-v4"];

/** `gesture.zoom` may be the v1 13-key stats, the v2 16-key stats, the v3
 *  17-key stats or the v4 18-key stats. The validator narrows on the
 *  receipt's `protocol` field. */
export type CadenceReceiptGesture = {
  pan: CadenceGestureStats;
  zoom: CadenceGestureStats | CadenceZoomV2Stats | CadenceZoomV3Stats | CadenceZoomV4Stats;
};

export type CadenceReceipt = {
  protocol: CadenceProtocol;
  commit: string;
  impl: "mm" | "lwc";
  host: { os: string; cpu: string; dpr: number };
  display: CadenceDisplay;
  generated_at: string;
  gesture: CadenceReceiptGesture;
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
    /** `process_name` metadata events carry the process label here. */
    name?: unknown;
    /** ForwardWheelEvent slices carry the wheel delta here. */
    dx?: unknown;
    dy?: unknown;
    /** EventLatency begin events carry the input type here. */
    event_latency?: { event_type?: unknown };
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

// ---------- shared slice pairing ----------

/**
 * Apply the renderer-pid selection rule and return one `SliceSpan` per
 * presented/partial/dropped slice on the chosen pid in `{beginMs, endMs}`
 * form. Used by `parsePresentedFrameSpans` (and by `parsePresentedFrames`
 * to keep the b->next-e-of-same-pairKey pairing rules identical between
 * the two consumers).
 */
function slicePresentationSpans(raw: readonly RawEvent[], markPrefix = "cadence:"): SlicedPresentation {
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
    rendererPid = earliestMark.pid;
  } else if (reporterPids.size === 1) {
    rendererPid = reporterPids.values().next().value ?? null;
  } else {
    throw new Error("no presentation records in trace");
  }
  if (rendererPid == null) {
    throw new Error("no presentation records in trace");
  }
  if (earliestMark != null && !reporterPids.has(rendererPid)) {
    throw new Error("no presentation records in trace");
  }

  const parsed: Array<ParsedBegin | ParsedEnd | ParsedComplete> = [];
  for (const e of raw) {
    const r = parseReporterEvent(e);
    if (r == null) continue;
    if (r.pid !== rendererPid) continue;
    parsed.push(r);
  }
  parsed.sort((a, b) => a.ts - b.ts);

  const spans: SliceSpan[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const ev = parsed[i];
    if (ev.kind === "X") {
      const state = toFrameState(ev.reporter.state);
      if (state == null) continue;
      spans.push({
        state,
        beginMs: ev.ts / 1000,
        endMs: (ev.ts + ev.dur) / 1000,
        frameKey: frameKey(ev.reporter, `x:${ev.pid}:${ev.ts}:${ev.dur}`),
      });
      continue;
    }
    if (ev.kind === "b") {
      const state = toFrameState(ev.reporter.state);
      if (state == null) continue;
      const paired = findNextEnd(parsed, i + 1, ev.pairKey);
      if (paired == null) continue;
      spans.push({
        state,
        beginMs: ev.ts / 1000,
        endMs: paired.ts / 1000,
        frameKey: frameKey(ev.reporter, `b:${ev.pairKey}`),
      });
      continue;
    }
    // ev.kind === "e" — terminal half; ignore unpaired ends.
  }

  return { rendererPid, spans };
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
  return parsePresentedFramesImpl(events, markPrefix);
}

/** Production logic of `parsePresentedFrames`. Pulled out so the v2
 *  `parsePresentedFrameSpans` helper can share slice pairing with the v1
 *  parser through `slicePresentationSpans`. */
function parsePresentedFramesImpl(events: readonly unknown[], markPrefix: string): ParsedPresentation {
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

/**
 * Same renderer-pid choice and same b->next-e pairing as parsePresentedFrames
 * (a thin view over `slicePresentationSpans`), returned as one entry per
 * DISTINCT STATE_PRESENTED_ALL ms: `presentMs` is the slice end, `beginMs` is
 * the EARLIEST beginMs among the slices (b-event start or X-event ts) that
 * presents at that ms. Sorted by presentMs ascending. The set of presentMs
 * values EQUALS parsePresentedFrames(...).presentedMs (the v2 receipt relies
 * on this for the leadin_presentations count over the same window).
 */
export function parsePresentedFrameSpans(events: readonly unknown[], markPrefix = "cadence:"): { beginMs: number; presentMs: number }[] {
  const sliced = slicePresentationSpans(readRawEvents(events), markPrefix);
  const byPresentMs = new Map<number, number>();
  for (const s of sliced.spans) {
    if (s.state !== "presented") continue;
    const prev = byPresentMs.get(s.endMs);
    if (prev == null || s.beginMs < prev) byPresentMs.set(s.endMs, s.beginMs);
  }
  const out: { beginMs: number; presentMs: number }[] = [];
  for (const [presentMs, beginMs] of byPresentMs) out.push({ beginMs, presentMs });
  out.sort((a, b) => a.presentMs - b.presentMs);
  return out;
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
 * Per-input presentation latency (Q03b). For every input mark `m` inside
 * `[startMarkMs, endMarkMs]` inclusive, find the FIRST `presentedMs` value
 * `p` such that `p >= m` AND `p <= endMarkMs + GESTURE_TAIL_MS`. Equality
 * counts (a mark that lands exactly on a presentation frame has latency 0).
 * The mark list is de-duplicated within the gesture window (a pointermove
 * and its compatibility mousemove carry the same timeStamp; identical
 * timestamps count as one input).
 *
 * Returns one row per input mark in mark-ascending order:
 *   `{ markMs, latencyMs, answerMs }`
 * with `latencyMs` and `answerMs` null when no frame answers this input
 * inside the tail. The bench reads these rows to emit the diag-only
 * `zoom_first_lat_ms`, `zoom_rest_lat_min_ms`, `zoom_rest_lat_max_ms`, and
 * `zoom_answered_lt2ms`; the existing `inputLatencyStats` aggregator is
 * re-implemented on top of this function and its outputs are BIT-IDENTICAL
 * to the previous implementation (the existing unit tests in
 * `chartEngineCadence.test.ts` are the guard).
 *
 * An empty mark list throws — there is no way to compute a per-input
 * latency without inputs.
 */
export function inputLatenciesMs(
  parsed: ParsedPresentation,
  inputMarksMs: readonly number[],
  startMarkMs: number,
  endMarkMs: number,
): InputLatencyRow[] {
  const inWindow = inputMarksMs.filter((m) => m >= startMarkMs && m <= endMarkMs);
  const marks = Array.from(new Set(inWindow)).sort((a, b) => a - b);
  if (marks.length === 0) {
    throw new Error("no input marks");
  }
  const tailEnd = endMarkMs + GESTURE_TAIL_MS;
  // presentedMs is already sorted ascending (see parsePresentedFrames).
  const presentedMs = parsed.presentedMs;
  const rows: InputLatencyRow[] = [];
  for (const m of marks) {
    let answer: number | null = null;
    for (const p of presentedMs) {
      if (p >= m && p <= tailEnd) {
        answer = p;
        break;
      }
    }
    rows.push({
      markMs: m,
      latencyMs: answer == null ? null : answer - m,
      answerMs: answer,
    });
  }
  return rows;
}

/**
 * Per-input presentation latency summary (Q03b). The matching rule is the
 * FIRST `presentedMs` value at-or-after each input mark `m`, AND that
 * presentation must still fall inside `[startMarkMs, endMarkMs +
 * GESTURE_TAIL_MS]` inclusive (otherwise the input is unpresented — the
 * gesture is over and no frame arrived in time). `inputMarksMs` is
 * de-duplicated within the gesture window (a pointermove and its
 * compatibility mousemove carry the same timeStamp; both are marked and
 * identical times count as one input). Equality counts (a mark that lands
 * exactly on a presentation frame has latency 0). An empty mark list
 * throws — there is no way to compute a per-input latency without inputs.
 *
 * The implementation is the original Q03b reducer; `inputLatenciesMs` is
 * the per-input detail view used by the v2 bench for diag-only numbers,
 * and its outputs are derived INDEPENDENTLY so a regression in either
 * helper is caught by the existing unit-test suite (the two views agree
 * because they share the same window / dedupe / answering rule).
 */
export function inputLatencyStats(
  parsed: ParsedPresentation,
  inputMarksMs: readonly number[],
  startMarkMs: number,
  endMarkMs: number,
): InputLatencyStats {
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

// ---------- Q03c v2 schedule / dispatch helpers ----------

/**
 * Mulberry32 PRNG, the standard reference algorithm bound by the Q03c
 * ruling. `seed` is a uint32 (the caller is responsible for `>>> 0`-ing
 * the value when deriving per-run seeds). The first three draws with
 * `seed = 1` are 0.6270739405881613, 0.002735721180215478,
 * 0.5274470399599522 (exact; pinned by the unit tests).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `(CADENCE_V2_SEED_BASE + runIdx) >>> 0` — the per-run v2 schedule seed. */
export function cadenceV2Seed(runIdx: number): number {
  return (CADENCE_V2_SEED_BASE + runIdx) >>> 0;
}

/**
 * Per-wheel scheduled offsets (ms from t_0) for the Q03c v2 zoom dispatch.
 * `offsets[0] = 0`; for `i = 1..count - 1`, `offsets[i] = offsets[i-1] +
 * CADENCE_V2_GAP_MIN_MS + CADENCE_V2_GAP_JITTER_MS * u_i` where `u_i` is
 * the `i`-th draw of `mulberry32(seed)` (the first draw is consumed but
 * produces the `i = 0` offset of 0 by construction; it is NOT in the
 * schedule). Every gap lies in `[CADENCE_V2_GAP_MIN_MS,
 * CADENCE_V2_GAP_MIN_MS + CADENCE_V2_GAP_JITTER_MS)` (= `[17, 23)`).
 */
export function cadenceV2ScheduleMs(seed: number, count: number = CADENCE_V2_WHEELS): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`cadenceV2ScheduleMs: count must be a non-negative integer (got ${count})`);
  }
  const offsets: number[] = new Array<number>(count).fill(0);
  if (count === 0) return offsets;
  const rng = mulberry32(seed);
  // gap[i] = 17 + 6 * u_i where u_i is the i-th draw of mulberry32(seed)
  // (i = 1..count - 1; offsets[0] is fixed at 0). Draw 1 IS the first
  // call into the PRNG; there is no bootstrap draw because the schedule
  // anchor (offsets[0] = 0) is the zero point, not a draw. The unit
  // tests pin the first three gaps and the offsets[59] end-of-schedule
  // total, which together prove the draw-to-gap mapping is correct.
  let prev = 0;
  for (let i = 1; i < count; i++) {
    const u = rng();
    const gap = CADENCE_V2_GAP_MIN_MS + CADENCE_V2_GAP_JITTER_MS * u;
    prev = prev + gap;
    offsets[i] = prev;
  }
  return offsets;
}

/**
 * Q03c v2 dispatch helper: schedule the `offsetsMs` offsets against a
 * Node clock. For each `i`, `waitUntilMs(targetMs)` is awaited BEFORE the
 * `send(i)` call is fired WITHOUT awaiting it. The returned promise
 * SETTLES as soon as the last send has been fired: it NEVER awaits a send
 * promise anywhere, so a slow CDP ack can never delay the gesture's end
 * mark (the ruling: "all dispatch promises are awaited after the end
 * mark"). `devMaxMs` is the maximum lateness observed at fire time
 * (>= 0, NOT floored).
 *
 * `sendPromises` holds the ORIGINAL send promises so `countDispatched`
 * still sees a rejection as a rejection. Each one additionally gets a
 * no-op rejection handler attached to a DERIVED promise
 * (`p.catch(() => undefined)`) so a failed send can never surface as an
 * unhandled rejection before the bench counts it.
 *
 * `deps.nowMs()` is the Node firing clock. `deps.waitUntilMs(targetMs)`
 * should wake about 2 ms before the target then spin on the Node clock
 * to consume the remaining slack. `deps.send(i)` returns the CDP send
 * promise (typically `session.send("Input.dispatchMouseEvent", params)`).
 *
 * The schedule is engine-independent: the seed sequence is the only
 * source of variance, so both engines see the same offsets ms.
 */
export async function dispatchOnSchedule(
  offsetsMs: readonly number[],
  deps: {
    nowMs(): number;
    waitUntilMs(targetMs: number): Promise<void>;
    send(i: number): Promise<unknown>;
  },
): Promise<{ devMaxMs: number; sendPromises: Promise<unknown>[] }> {
  const t0 = deps.nowMs();
  const sendPromises: Promise<unknown>[] = [];
  let devMaxMs = 0;
  for (let i = 0; i < offsetsMs.length; i++) {
    const target = t0 + (offsetsMs[i] ?? 0);
    // The ONLY await in the loop is on the scheduling sleep (waitUntilMs);
    // the CDP `send(i)` call below is fired WITHOUT awaiting so back-to-back
    // dispatches are not gated by a round-trip ack. The bench consumes
    // `sendPromises` AFTER the end mark via `countDispatched`.
    await deps.waitUntilMs(target);
    const actual = deps.nowMs();
    const dev = actual - target;
    if (dev > devMaxMs) devMaxMs = dev;
    const sendPromise = deps.send(i);
    sendPromises.push(sendPromise);
    // No-op rejection handler on a DERIVED promise. The raw promise above
    // is what the bench counts, so a rejection is still visible there.
    sendPromise.catch(() => undefined);
  }
  return { devMaxMs, sendPromises };
}

/**
 * Q03c v2: how many of the fired sends actually fulfilled. The bench calls
 * this AFTER the end mark, never before — the ruling awaits every dispatch
 * promise after the end mark. A rejected send counts as NOT dispatched.
 */
export async function countDispatched(sendPromises: readonly Promise<unknown>[]): Promise<number> {
  const settled = await Promise.allSettled(sendPromises);
  return settled.reduce((n, r) => (r.status === "fulfilled" ? n + 1 : n), 0);
}

/**
 * Q03c v2 diag: count of inputs whose answering presented frame's
 * `beginMs` (paired `b`/`X` start) lies strictly BEFORE the input's mark.
 * Inputs whose frame began before the input are "synchronously scheduled
 * but already-presented" — they hit a frame the renderer was already
 * painting when the wheel arrived. `spans` must come from
 * `parsePresentedFrameSpans`; `inputMarksMs` must already be sorted and
 * de-duplicated. `inputMarksMs[0]` is the first wheel.
 */
export function answeredByPriorFrame(
  spans: { beginMs: number; presentMs: number }[],
  inputMarksMs: readonly number[],
  startMarkMs: number,
  endMarkMs: number,
): number {
  const inWindow = inputMarksMs.filter((m) => m >= startMarkMs && m <= endMarkMs);
  const marks = Array.from(new Set(inWindow)).sort((a, b) => a - b);
  if (marks.length === 0) return 0;
  // For each mark find the FIRST span whose presentMs >= mark AND
  // presentMs <= endMark + GESTURE_TAIL_MS (matches the answering rule).
  const tailEnd = endMarkMs + GESTURE_TAIL_MS;
  let count = 0;
  for (const m of marks) {
    for (const s of spans) {
      if (s.presentMs < m) continue;
      if (s.presentMs > tailEnd) break;
      if (s.beginMs < m) count += 1;
      break;
    }
  }
  return count;
}

/**
 * Q03c v2 diag: number of STATE_PRESENTED_ALL events whose ms lies inside
 * `[startMarkMs - windowMs, firstInputMarkMs)` (inclusive start, exclusive
 * end). When `firstInputMarkMs` is null there is no first input and the
 * count is 0. The default `windowMs` is
 * `CADENCE_V2_LEADIN_WINDOW_MS` (200 ms).
 */
export function leadinPresentations(
  presentedMs: readonly number[],
  startMarkMs: number,
  firstInputMarkMs: number | null,
  windowMs: number = CADENCE_V2_LEADIN_WINDOW_MS,
): number {
  if (firstInputMarkMs == null) return 0;
  const lo = startMarkMs - windowMs;
  const hi = firstInputMarkMs;
  let n = 0;
  for (const p of presentedMs) {
    if (p >= lo && p < hi) n += 1;
  }
  return n;
}

// ---------- q03b-v3 forward anchor ----------

/**
 * q03b-v3: every Browser-process `RenderWidgetHostImpl::ForwardWheelEvent`
 * slice start with a non-zero wheel delta, as `ts / 1000` ms, sorted
 * ascending. The Browser pid is the pid of the `process_name` metadata event
 * whose label starts with "Browser"; with no such event the result is []
 * (fail closed: the run then cannot pair and is INVALID). Zero-delta
 * forwards (Chromium forwards a second, phase-only wheel per dispatch) and
 * any forward on another pid are dropped.
 */
export function wheelForwardsMs(events: readonly unknown[]): number[] {
  return wheelForwardSlices(readRawEvents(events))
    .filter((f) => f.nonzero)
    .map((f) => f.ms);
}

/**
 * q03b-v4: every Browser-process forward slice start of ANY delta (the
 * zero-delta phase-only wheels included), sorted ascending, with the same
 * Browser-pid rule and fail-closed [] as `wheelForwardsMs`. The own-frame
 * mapping needs the zero-delta forwards too: a forward maps to an
 * EventLatency only when no other forward is as near to its stage begin.
 */
export function allWheelForwardsMs(events: readonly unknown[]): number[] {
  return wheelForwardSlices(readRawEvents(events)).map((f) => f.ms);
}

type WheelForwardSlice = { ms: number; nonzero: boolean };

function wheelForwardSlices(raw: readonly RawEvent[]): WheelForwardSlice[] {
  let browserPid: number | null = null;
  for (const e of raw) {
    if (readString(e.ph) !== "M" || readString(e.name) !== "process_name") continue;
    const label = e.args == null || typeof e.args !== "object" ? null : readString(e.args.name);
    if (label == null || !label.startsWith("Browser")) continue;
    browserPid = readPid(e);
    if (browserPid != null) break;
  }
  if (browserPid == null) return [];
  const out: WheelForwardSlice[] = [];
  for (const e of raw) {
    if (readString(e.name) !== CADENCE_V3_FORWARD_EVENT) continue;
    const ph = readString(e.ph);
    if (ph !== "X" && ph !== "B") continue;
    if (readPid(e) !== browserPid) continue;
    const ts = readNumber(e.ts);
    if (ts == null) continue;
    const args = e.args;
    let nonzero = false;
    if (args != null && typeof args === "object") {
      const dx = readNumber(args.dx);
      const dy = readNumber(args.dy);
      nonzero = (dx != null && dx !== 0) || (dy != null && dy !== 0);
    }
    out.push({ ms: ts / 1000, nonzero });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

/** Result of `pairWheelForwards`: the in-window marks and forwards, the
 *  per-index stamp-to-forward delays and how many index pairs are provable. */
export type WheelForwardPairing = {
  marksMs: number[];
  forwardsMs: number[];
  stampToForwardMs: number[];
  paired: number;
};

/**
 * q03b-v3 pairing. Marks are de-duplicated and kept inside
 * `[startMarkMs, endMarkMs]`; forwards are kept inside
 * `[startMarkMs, endMarkMs + GESTURE_TAIL_MS]` (the last wheel may be
 * forwarded after the end mark). Forward k pairs with mark k for
 * k < min(forwards, marks): the Browser forwards wheels in receipt order, so
 * when the forward count equals the scheduled count the index pairing is
 * the only order-preserving one. A pair is counted in `paired` only when
 * `mark_k <= forward_k <= mark_k + CADENCE_V3_STAMP_TO_FORWARD_MAX_MS`.
 * `forward_k` may lie after `mark_k+1`: receipt stamps of a held wheel and
 * the next one can be closer than the scheduled send gap. An index shift
 * from a dropped or coalesced wheel can still fit the cap; the validator's
 * count rule (forwards == scheduled) is what refuses it.
 */
export function pairWheelForwards(
  marksMs: readonly number[],
  forwardsMs: readonly number[],
  startMarkMs: number,
  endMarkMs: number,
): WheelForwardPairing {
  const marks = Array.from(new Set(marksMs.filter((m) => m >= startMarkMs && m <= endMarkMs))).sort((a, b) => a - b);
  const tailEnd = endMarkMs + GESTURE_TAIL_MS;
  const forwards = forwardsMs.filter((f) => f >= startMarkMs && f <= tailEnd).sort((a, b) => a - b);
  const stampToForwardMs: number[] = [];
  let paired = 0;
  const n = Math.min(marks.length, forwards.length);
  for (let k = 0; k < n; k++) {
    const m = marks[k] as number;
    const f = forwards[k] as number;
    const d = f - m;
    stampToForwardMs.push(d);
    if (d >= 0 && d <= CADENCE_V3_STAMP_TO_FORWARD_MAX_MS) paired += 1;
  }
  return { marksMs: marks, forwardsMs: forwards, stampToForwardMs, paired };
}

/** The receipt's `forward` block from a pairing. Empty delays give
 *  UNMEASURED min/p50/max (which the v3 max rule then refuses). */
export function cadenceForwardBlock(pairing: WheelForwardPairing): CadenceForward {
  const d = pairing.stampToForwardMs;
  return {
    forwards: pairing.forwardsMs.length,
    paired: pairing.paired,
    stamp_to_forward_min_ms: d.length === 0 ? UNMEASURED : Math.min(...d),
    stamp_to_forward_p50_ms: percentile([...d], 0.5),
    stamp_to_forward_max_ms: d.length === 0 ? UNMEASURED : Math.max(...d),
  };
}

/** One forward-anchored zoom input: its mark, its paired forward (null when
 *  the run has fewer forwards than marks), and the answering presentation. */
export type ForwardLatencyRow = {
  markMs: number;
  forwardMs: number | null;
  latencyMs: number | null;
  answerMs: number | null;
};

/**
 * q03b-v3 per-input latency rows: one per in-window mark k, anchored at
 * forward k. The answering rule is the v1/v2 rule applied to the anchor:
 * the FIRST presentedMs `p` with `p >= forward_k` and
 * `p <= endMarkMs + GESTURE_TAIL_MS`. A mark with no forward, or whose
 * forward finds no presentation inside the tail, is unpresented. An empty
 * mark set throws.
 */
export function forwardLatenciesMs(
  parsed: ParsedPresentation,
  pairing: WheelForwardPairing,
  endMarkMs: number,
): ForwardLatencyRow[] {
  if (pairing.marksMs.length === 0) {
    throw new Error("no input marks");
  }
  const tailEnd = endMarkMs + GESTURE_TAIL_MS;
  const presentedMs = parsed.presentedMs;
  const rows: ForwardLatencyRow[] = [];
  for (let k = 0; k < pairing.marksMs.length; k++) {
    const m = pairing.marksMs[k] as number;
    const f = pairing.forwardsMs[k];
    let answer: number | null = null;
    if (f != null) {
      for (const p of presentedMs) {
        if (p >= f && p <= tailEnd) {
          answer = p;
          break;
        }
      }
    }
    rows.push({
      markMs: m,
      forwardMs: f ?? null,
      latencyMs: answer == null || f == null ? null : answer - f,
      answerMs: answer,
    });
  }
  return rows;
}

/** The five receipt `input_*` keys from per-input rows (v3 forward-anchored
 *  or v4 own-frame): a null `latencyMs` is unpresented. */
export function forwardLatencyStats(rows: readonly { latencyMs: number | null }[]): InputLatencyStats {
  if (rows.length === 0) {
    throw new Error("no input marks");
  }
  const latencies: number[] = [];
  let unpresented = 0;
  for (const r of rows) {
    if (r.latencyMs == null) unpresented += 1;
    else latencies.push(r.latencyMs);
  }
  return {
    input_marks: rows.length,
    input_unpresented: unpresented,
    input_to_present_p50_ms: percentile(latencies, 0.5),
    input_to_present_p95_ms: percentile(latencies, 0.95),
    input_to_present_p99_ms: percentile(latencies, 0.99),
  };
}

/** q03b-v3 `answered_by_prior_frame`: rows whose answering presentation's
 *  frame began strictly before the row's forward anchor. `spans` must come
 *  from `parsePresentedFrameSpans` (one entry per distinct presentMs). */
export function forwardAnsweredByPriorFrame(
  spans: readonly { beginMs: number; presentMs: number }[],
  rows: readonly ForwardLatencyRow[],
): number {
  const beginByPresent = new Map<number, number>();
  for (const s of spans) beginByPresent.set(s.presentMs, s.beginMs);
  let count = 0;
  for (const r of rows) {
    if (r.answerMs == null || r.forwardMs == null) continue;
    const begin = beginByPresent.get(r.answerMs);
    if (begin != null && begin < r.forwardMs) count += 1;
  }
  return count;
}

// ---------- q03b-v4 own-frame answer ----------

/** One wheel EventLatency on the renderer pid: its slice begin/end, the
 *  begin of its mapping stage (the Browser forward), and the begins of its
 *  Commit and swap-end stages (null when the slice never reached them). */
export type WheelEventLatency = {
  beginMs: number;
  endMs: number;
  mapMs: number;
  commitMs: number | null;
  swapEndMs: number | null;
};

function asyncIdOf(e: RawEvent): string | null {
  const id2 = e.id2;
  if (id2 != null && typeof id2 === "object") {
    const local = readString(id2.local);
    if (local != null) return local;
    const global = readString(id2.global);
    if (global != null) return global;
  }
  return readString(e.id);
}

/**
 * q03b-v4: every MOUSE_WHEEL `EventLatency` on `rendererPid` that reached
 * its mapping stage, sorted by that stage's begin. EventLatency and its
 * stage slices are nestable async `b`/`e` events that share the category
 * and the slice id, and ids are reused, so the events are walked in time
 * order (at equal ts: EventLatency begins, then stage begins, then ends) and
 * each stage keeps its FIRST begin inside the open slice. A slice still open
 * when the trace ends, and an event with no id, are dropped.
 */
export function parseWheelEventLatencies(events: readonly unknown[], rendererPid: number): WheelEventLatency[] {
  type Step = { ms: number; rank: number; name: string; ph: "b" | "e" | "n"; id: string; type: string | null };
  const steps: Step[] = [];
  for (const e of readRawEvents(events)) {
    if (readString(e.cat) !== CADENCE_V4_EVENT_LATENCY_CATEGORY) continue;
    if (readPid(e) !== rendererPid) continue;
    const ph = readString(e.ph);
    if (ph !== "b" && ph !== "e" && ph !== "n") continue;
    const name = readString(e.name);
    const ts = readNumber(e.ts);
    const id = asyncIdOf(e);
    if (name == null || ts == null || id == null) continue;
    const isLatency = name === CADENCE_V4_EVENT_LATENCY;
    const info = e.args != null && typeof e.args === "object" ? e.args.event_latency : undefined;
    const type = isLatency && info != null && typeof info === "object" ? readString(info.event_type) : null;
    steps.push({ ms: ts / 1000, rank: ph === "e" ? 2 : isLatency ? 0 : 1, name, ph, id, type });
  }
  steps.sort((a, b) => a.ms - b.ms || a.rank - b.rank);
  type Open = { beginMs: number; type: string | null; stages: Map<string, number> };
  const open = new Map<string, Open>();
  const out: WheelEventLatency[] = [];
  for (const s of steps) {
    if (s.name === CADENCE_V4_EVENT_LATENCY) {
      if (s.ph === "b") {
        open.set(s.id, { beginMs: s.ms, type: s.type, stages: new Map() });
      } else if (s.ph === "e") {
        const rec = open.get(s.id);
        if (rec == null) continue;
        open.delete(s.id);
        const mapMs = rec.stages.get(CADENCE_V4_EL_MAP_STAGE);
        if (rec.type !== CADENCE_V4_EL_EVENT_TYPE || mapMs == null) continue;
        out.push({
          beginMs: rec.beginMs,
          endMs: s.ms,
          mapMs,
          commitMs: rec.stages.get(CADENCE_V4_EL_COMMIT_STAGE) ?? null,
          swapEndMs: rec.stages.get(CADENCE_V4_EL_SWAP_END_STAGE) ?? null,
        });
      }
      continue;
    }
    if (s.ph === "e") continue;
    const rec = open.get(s.id);
    if (rec != null && !rec.stages.has(s.name)) rec.stages.set(s.name, s.ms);
  }
  out.sort((a, b) => a.mapMs - b.mapMs);
  return out;
}

/** One forward's own EventLatency and the forward-to-stage distance. */
export type EventLatencyMapping = { el: WheelEventLatency; distMs: number };

/**
 * q03b-v4 mutual-nearest mapping of each forward to its own EventLatency.
 * EL_k is the EventLatency whose mapping-stage begin is nearest forward_k.
 * Forward k maps to it only when (a) the distance is at most
 * CADENCE_V4_EL_MAP_MAX_MS, (b) no other EventLatency is as near forward_k,
 * (c) no other forward of `allForwardsMs` (any delta) is as near EL_k's stage
 * begin, and (d) no other forward maps to EL_k. Anything else is null
 * (unmapped), which the v4 count rule refuses.
 */
export function mapForwardsToEventLatencies(
  forwardsMs: readonly number[],
  allForwardsMs: readonly number[],
  els: readonly WheelEventLatency[],
): (EventLatencyMapping | null)[] {
  const picks: ({ idx: number; distMs: number } | null)[] = forwardsMs.map((f) => {
    let idx = -1;
    let distMs = Infinity;
    els.forEach((el, i) => {
      const d = Math.abs(el.mapMs - f);
      if (d < distMs) {
        distMs = d;
        idx = i;
      }
    });
    if (idx < 0 || distMs > CADENCE_V4_EL_MAP_MAX_MS) return null;
    if (els.filter((el) => Math.abs(el.mapMs - f) <= distMs).length !== 1) return null;
    const mapMs = (els[idx] as WheelEventLatency).mapMs;
    const self = allForwardsMs.includes(f) ? 1 : 0;
    if (allForwardsMs.filter((g) => Math.abs(g - mapMs) <= distMs).length - self !== 0) return null;
    return { idx, distMs };
  });
  const claims = new Map<number, number>();
  for (const p of picks) if (p != null) claims.set(p.idx, (claims.get(p.idx) ?? 0) + 1);
  return picks.map((p) => (p == null || claims.get(p.idx) !== 1 ? null : { el: els[p.idx] as WheelEventLatency, distMs: p.distMs }));
}

/** One top-level task of the renderer main thread. */
export type MainThreadTask = { startMs: number; endMs: number };

/**
 * q03b-v4: the renderer main thread's top-level tasks. The main thread is
 * the `thread_name` metadata thread "CrRendererMain" on `rendererPid`
 * (none -> [], fail closed). Its tasks are complete (`X`) slices whose
 * category tokens include "toplevel"; sorted by (start, longest first), a
 * slice that starts before the previous kept slice ends is nested and
 * dropped.
 */
export function rendererMainTopLevelTasks(events: readonly unknown[], rendererPid: number): MainThreadTask[] {
  const raw = readRawEvents(events);
  let mainTid: number | null = null;
  for (const e of raw) {
    if (readString(e.ph) !== "M" || readString(e.name) !== "thread_name") continue;
    if (readPid(e) !== rendererPid) continue;
    const label = e.args == null || typeof e.args !== "object" ? null : readString(e.args.name);
    if (label !== CADENCE_V4_MAIN_THREAD) continue;
    mainTid = readNumber(e.tid);
    if (mainTid != null) break;
  }
  if (mainTid == null) return [];
  const slices: MainThreadTask[] = [];
  for (const e of raw) {
    if (readString(e.ph) !== "X") continue;
    if (readPid(e) !== rendererPid || readNumber(e.tid) !== mainTid) continue;
    const cat = readString(e.cat);
    if (cat == null || !cat.split(",").includes(CADENCE_V4_TOPLEVEL_CATEGORY)) continue;
    const ts = readNumber(e.ts);
    const dur = readNumber(e.dur);
    if (ts == null || dur == null || dur < 0) continue;
    slices.push({ startMs: ts / 1000, endMs: (ts + dur) / 1000 });
  }
  slices.sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const out: MainThreadTask[] = [];
  let end = -Infinity;
  for (const s of slices) {
    if (s.startMs < end) continue;
    out.push(s);
    end = s.endMs;
  }
  return out;
}

/** Remaining duration of the top-level task spanning `atMs`
 *  (start <= atMs < end), or 0 when the main thread is idle at `atMs`.
 *  `tasks` must come from `rendererMainTopLevelTasks`. */
export function mainThreadBusyMs(tasks: readonly MainThreadTask[], atMs: number): number {
  for (const t of tasks) {
    if (t.startMs > atMs) break;
    if (atMs < t.endMs) return t.endMs - atMs;
  }
  return 0;
}

/** One q03b-v4 zoom input: its mark and forward, the own-frame mapping
 *  distance, the busy bias and anchor, the answering frame's Commit begin and
 *  GPU swap end, whether the answer is the fallback frame, and the latency
 *  (null when unpaired, unmapped or unpresented inside the tail). */
export type OwnFrameLatencyRow = {
  markMs: number;
  forwardMs: number | null;
  mapDistMs: number | null;
  biasMs: number | null;
  anchorMs: number | null;
  commitMs: number | null;
  swapEndMs: number | null;
  fallback: boolean;
  latencyMs: number | null;
};

/**
 * q03b-v4 per-input rows: one per in-window mark k, using forward k of the
 * pairing. Anchor = forward_k - bias_k with
 * bias_k = max(0, min(busy at mark_k, forward_k - mark_k)). Answer = the
 * swap end of forward k's own EventLatency (`mapForwardsToEventLatencies`);
 * when that slice terminated unpresented, the swap end of the first
 * presented MOUSE_WHEEL EventLatency whose Commit begins at-or-after the
 * terminated slice's end (a candidate without a Commit stage is skipped).
 * A swap end after `endMarkMs + GESTURE_TAIL_MS` is unpresented. An empty
 * mark set throws.
 */
export function ownFrameLatenciesMs(
  pairing: WheelForwardPairing,
  allForwardsMs: readonly number[],
  els: readonly WheelEventLatency[],
  tasks: readonly MainThreadTask[],
  endMarkMs: number,
): OwnFrameLatencyRow[] {
  if (pairing.marksMs.length === 0) {
    throw new Error("no input marks");
  }
  const tailEnd = endMarkMs + GESTURE_TAIL_MS;
  const n = pairing.marksMs.length;
  const forwards = pairing.forwardsMs.slice(0, n);
  const maps = mapForwardsToEventLatencies(forwards, allForwardsMs, els);
  const committed = els
    .filter((el) => el.swapEndMs != null && el.commitMs != null)
    .sort((a, b) => (a.commitMs as number) - (b.commitMs as number));
  const rows: OwnFrameLatencyRow[] = [];
  for (let k = 0; k < n; k++) {
    const m = pairing.marksMs[k] as number;
    const f = forwards[k];
    if (f == null) {
      rows.push({ markMs: m, forwardMs: null, mapDistMs: null, biasMs: null, anchorMs: null, commitMs: null, swapEndMs: null, fallback: false, latencyMs: null });
      continue;
    }
    const bias = Math.max(0, Math.min(mainThreadBusyMs(tasks, m), f - m));
    const anchor = f - bias;
    const map = maps[k] ?? null;
    let commitMs: number | null = null;
    let swapEndMs: number | null = null;
    let fallback = false;
    if (map != null) {
      if (map.el.swapEndMs != null) {
        commitMs = map.el.commitMs;
        swapEndMs = map.el.swapEndMs;
      } else {
        fallback = true;
        const x = map.el.endMs;
        const next = committed.find((c) => (c.commitMs as number) >= x);
        if (next != null) {
          commitMs = next.commitMs;
          swapEndMs = next.swapEndMs;
        }
      }
    }
    const answered = swapEndMs != null && swapEndMs <= tailEnd;
    rows.push({
      markMs: m,
      forwardMs: f,
      mapDistMs: map == null ? null : map.distMs,
      biasMs: bias,
      anchorMs: anchor,
      commitMs,
      swapEndMs,
      fallback,
      latencyMs: answered ? (swapEndMs as number) - anchor : null,
    });
  }
  return rows;
}

/** The receipt's `own_frame` block from v4 rows and the main-thread task
 *  count. Empty distances or biases give UNMEASURED (which the v4 map rule
 *  then refuses). */
export function cadenceOwnFrameBlock(rows: readonly OwnFrameLatencyRow[], mainTasks: number): CadenceOwnFrame {
  const dists = rows.flatMap((r) => (r.mapDistMs == null ? [] : [r.mapDistMs]));
  const biases = rows.flatMap((r) => (r.biasMs == null ? [] : [r.biasMs]));
  return {
    mapped: dists.length,
    fallback: rows.filter((r) => r.fallback).length,
    map_max_ms: dists.length === 0 ? UNMEASURED : Math.max(...dists),
    bias_p50_ms: percentile([...biases], 0.5),
    bias_max_ms: biases.length === 0 ? UNMEASURED : Math.max(...biases),
    main_tasks: mainTasks,
  };
}

/** q03b-v4 `answered_by_prior_frame`: answered rows whose answering frame
 *  committed strictly before the row's anchor (expected 0: a wheel's own
 *  frame commits after the wheel reaches the renderer). */
export function ownFrameAnsweredByPriorFrame(rows: readonly OwnFrameLatencyRow[]): number {
  let count = 0;
  for (const r of rows) {
    if (r.latencyMs == null || r.commitMs == null || r.anchorMs == null) continue;
    if (r.commitMs < r.anchorMs) count += 1;
  }
  return count;
}

// ---------- receipt builder / validator ----------

export type BuildCadenceReceiptInput = {
  commit: string;
  impl: "mm" | "lwc";
  host: { os: string; cpu: string; dpr: number };
  display: CadenceDisplay;
  generated_at?: string;
  pan: CadenceGestureStats;
  zoom: CadenceGestureStats | CadenceZoomV2Stats | CadenceZoomV3Stats | CadenceZoomV4Stats;
  /** Q03c v2: defaults to "q03b-v1" so existing benches and the unit-test
   *  fixtures see the v1 receipt shape unchanged. */
  protocol?: CadenceProtocol;
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
  const protocol: CadenceProtocol = input.protocol ?? "q03b-v1";
  const violations: CadenceReceipt["violations"] = [];
  for (const m of METRIC_ORDER) {
    const stats: CadenceGestureStats = m.gesture === "pan" ? input.pan : (input.zoom as CadenceGestureStats);
    const value = readGestureMetric(stats, m.field);
    if (value > m.budget) violations.push({ metric: m.metric, value, budget: m.budget });
  }
  return {
    protocol,
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

/** Top-level keys: exactly 10 (the original 9 plus the new `protocol`).
 *  `protocol` must be in {"q03b-v1", "q03b-v2", "q03b-v3", "q03b-v4"}. */
const TOP_LEVEL_KEYS = [
  "protocol",
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
const V2_DISPATCH_KEYS = [
  "gap_min_ms",
  "gap_jitter_ms",
  "seed",
  "scheduled",
  "dispatched",
  "dispatch_dev_max_ms",
] as const;
const V2_AWAKE_START_KEYS = ["heartbeat_ms", "heartbeat_mode", "leadin_presentations"] as const;
const V2_HEARTBEAT_MODES = new Set(["through", "until-first-input"]);
const V3_FORWARD_KEYS = [
  "forwards",
  "paired",
  "stamp_to_forward_min_ms",
  "stamp_to_forward_p50_ms",
  "stamp_to_forward_max_ms",
] as const;
const V4_OWN_FRAME_KEYS = [
  "mapped",
  "fallback",
  "map_max_ms",
  "bias_p50_ms",
  "bias_max_ms",
  "main_tasks",
] as const;

/** Top-level validator. After the v0 checks (shape, types, round-trip)
 *  the v2/v3/v4 zoom fields are validated; v1 zoom must not carry any v2
 *  keys, v2 zoom must not carry the v3 `forward` block and v3 zoom must not
 *  carry the v4 `own_frame` block. Any validator error
 *  that fires an INVALID rule starts its message with
 *  "INVALID (<protocol>): " so the bench can detect the run-retry path. */
export function validateCadenceReceipt(receipt: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (receipt == null || typeof receipt !== "object") {
    return { ok: false, errors: ["receipt is not an object"] };
  }
  const r = receipt as Record<string, unknown>;
  // A3: reject a top-level key outside the ten.
  for (const k of Object.keys(r)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(k)) {
      errors.push(`unexpected top-level key "${k}"`);
    }
  }
  for (const k of TOP_LEVEL_KEYS) {
    if (!(k in r)) errors.push(`missing top-level key "${k}"`);
  }
  // `protocol` is a required string in the closed set.
  const knownProtocol = CADENCE_PROTOCOLS.find((p) => p === r.protocol);
  if (knownProtocol == null) {
    errors.push(`protocol must be "q03b-v1", "q03b-v2", "q03b-v3" or "q03b-v4" (got ${JSON.stringify(r.protocol)})`);
  }
  const protocol: CadenceProtocol = knownProtocol ?? "q03b-v1";
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
    // pan is always 13 stat keys in both protocols.
    const pan = validateGestureStats(errors, gesture.pan, "pan", false);
    // zoom shape is 13 (v1), 16 (v2), 17 (v3) or 18 (v4). Reject extra keys.
    if (protocol !== "q03b-v1") {
      validateZoomV2(errors, gesture.zoom, protocol);
    } else {
      validateGestureStats(errors, gesture.zoom, "zoom", false);
    }
    // For round-trip rebuild we need zoom in 13-key form.
    if (pan != null && gesture.zoom != null && typeof gesture.zoom === "object") {
      maybeRoundTrip(errors, r, gesture, protocol);
    }
  }
  if (!Array.isArray(r.violations)) {
    errors.push("violations must be an array");
  }
  if (typeof r.budget_ok !== "boolean") {
    errors.push("budget_ok must be a boolean");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

function validateGestureStats(
  errors: string[],
  stat: unknown,
  label: "pan" | "zoom",
  allowV2Keys: boolean,
): CadenceGestureStats | null {
  if (stat == null || typeof stat !== "object") {
    errors.push(`gesture.${label} must be an object`);
    return null;
  }
  const s = stat as Record<string, unknown>;
  // A3: reject a stat key outside the thirteen (v2 zoom also has 3 extras;
  // validateZoomV2 handles them separately so we do not allow them here).
  for (const k of Object.keys(s)) {
    if (!(GESTURE_STAT_KEYS as readonly string[]).includes(k)) {
      if (!allowV2Keys) {
        errors.push(`unexpected gesture.${label} key "${k}"`);
      } else {
        // v2 may carry them; validateZoomV2 will reject anything outside
        // the 16 expected. Here we accept; the specialized validator owns
        // the v2 shape.
      }
    }
  }
  for (const k of GESTURE_STAT_KEYS) {
    if (!(k in s)) errors.push(`missing gesture.${label} key "${k}"`);
  }
  const finiteKeys = ["input_hz", "p50_ms", "p95_ms", "p99_ms", "input_to_present_p50_ms", "input_to_present_p95_ms", "input_to_present_p99_ms"];
  for (const k of finiteKeys) {
    if (!isNonNegativeFinite(s[k])) errors.push(`gesture.${label}.${k} must be a finite number >= 0 (got ${JSON.stringify(s[k])})`);
  }
  for (const k of ["inputs", "presented", "partial", "dropped", "input_unpresented"]) {
    if (!isNonNegativeInt(s[k])) errors.push(`gesture.${label}.${k} must be a non-negative integer (got ${JSON.stringify(s[k])})`);
  }
  if (!isPositiveInteger(s.input_marks)) {
    errors.push(`gesture.${label}.input_marks must be an integer >= 1 (got ${JSON.stringify(s.input_marks)})`);
  }
  if (isNonNegativeInt(s.input_marks) && isNonNegativeInt(s.input_unpresented) && (s.input_unpresented as number) > (s.input_marks as number)) {
    errors.push(`gesture.${label}.input_unpresented (${s.input_unpresented}) must be <= input_marks (${s.input_marks})`);
  }
  return s as unknown as CadenceGestureStats;
}

function validateZoomV2(errors: string[], stat: unknown, protocol: "q03b-v2" | "q03b-v3" | "q03b-v4"): void {
  if (stat == null || typeof stat !== "object") {
    errors.push("gesture.zoom must be an object");
    return;
  }
  const s = stat as Record<string, unknown>;
  const invalid = `INVALID (${protocol}): `;
  const hasForward = protocol === "q03b-v3" || protocol === "q03b-v4";
  const hasOwnFrame = protocol === "q03b-v4";
  const expectedTop: readonly string[] = [
    ...GESTURE_STAT_KEYS,
    "dispatch",
    "awake_start",
    "answered_by_prior_frame",
    ...(hasForward ? ["forward"] : []),
    ...(hasOwnFrame ? ["own_frame"] : []),
  ];
  for (const k of Object.keys(s)) {
    if (!expectedTop.includes(k)) {
      errors.push(`unexpected gesture.zoom key "${k}"`);
    }
  }
  for (const k of expectedTop) {
    if (!(k in s)) errors.push(`missing gesture.zoom key "${k}"`);
  }
  // Inner shape of `dispatch` and `awake_start`.
  const dispatch = s.dispatch as Record<string, unknown> | undefined;
  if (dispatch == null || typeof dispatch !== "object") {
    errors.push("gesture.zoom.dispatch must be an object");
  } else {
    for (const k of Object.keys(dispatch)) {
      if (!(V2_DISPATCH_KEYS as readonly string[]).includes(k)) {
        errors.push(`unexpected gesture.zoom.dispatch key "${k}"`);
      }
    }
    for (const k of V2_DISPATCH_KEYS) {
      if (!(k in dispatch)) errors.push(`missing gesture.zoom.dispatch key "${k}"`);
    }
    if (dispatch.gap_min_ms !== CADENCE_V2_GAP_MIN_MS) errors.push(`gesture.zoom.dispatch.gap_min_ms must be ${CADENCE_V2_GAP_MIN_MS} (got ${JSON.stringify(dispatch.gap_min_ms)})`);
    if (dispatch.gap_jitter_ms !== CADENCE_V2_GAP_JITTER_MS) errors.push(`gesture.zoom.dispatch.gap_jitter_ms must be ${CADENCE_V2_GAP_JITTER_MS} (got ${JSON.stringify(dispatch.gap_jitter_ms)})`);
    if (!isNonNegativeInt(dispatch.seed) || (dispatch.seed as number) > 0xFFFFFFFF) errors.push(`gesture.zoom.dispatch.seed must be a uint32 integer (got ${JSON.stringify(dispatch.seed)})`);
    if (dispatch.scheduled !== CADENCE_V2_WHEELS) errors.push(`gesture.zoom.dispatch.scheduled must be ${CADENCE_V2_WHEELS} (got ${JSON.stringify(dispatch.scheduled)})`);
    if (dispatch.dispatched !== CADENCE_V2_WHEELS) errors.push(`gesture.zoom.dispatch.dispatched must be ${CADENCE_V2_WHEELS} (got ${JSON.stringify(dispatch.dispatched)})`);
    if (!(isNonNegativeFinite(dispatch.dispatch_dev_max_ms) && Number.isFinite(dispatch.dispatch_dev_max_ms))) errors.push(`gesture.zoom.dispatch.dispatch_dev_max_ms must be a finite number >= 0 (got ${JSON.stringify(dispatch.dispatch_dev_max_ms)})`);
  }
  const awake = s.awake_start as Record<string, unknown> | undefined;
  if (awake == null || typeof awake !== "object") {
    errors.push("gesture.zoom.awake_start must be an object");
  } else {
    for (const k of Object.keys(awake)) {
      if (!(V2_AWAKE_START_KEYS as readonly string[]).includes(k)) {
        errors.push(`unexpected gesture.zoom.awake_start key "${k}"`);
      }
    }
    for (const k of V2_AWAKE_START_KEYS) {
      if (!(k in awake)) errors.push(`missing gesture.zoom.awake_start key "${k}"`);
    }
    if (!(isNonNegativeFinite(awake.heartbeat_ms) && awake.heartbeat_ms >= CADENCE_V2_HEARTBEAT_MIN_MS)) errors.push(`gesture.zoom.awake_start.heartbeat_ms must be a finite number >= ${CADENCE_V2_HEARTBEAT_MIN_MS} (got ${JSON.stringify(awake.heartbeat_ms)})`);
    if (typeof awake.heartbeat_mode !== "string" || !V2_HEARTBEAT_MODES.has(awake.heartbeat_mode)) errors.push(`gesture.zoom.awake_start.heartbeat_mode must be "through" or "until-first-input" (got ${JSON.stringify(awake.heartbeat_mode)})`);
    if (!isNonNegativeInt(awake.leadin_presentations)) errors.push(`gesture.zoom.awake_start.leadin_presentations must be a non-negative integer (got ${JSON.stringify(awake.leadin_presentations)})`);
  }
  if (!isNonNegativeInt(s.answered_by_prior_frame)) {
    errors.push(`gesture.zoom.answered_by_prior_frame must be a non-negative integer (got ${JSON.stringify(s.answered_by_prior_frame)})`);
  } else if (isNonNegativeInt(s.input_marks)) {
    const ap = s.answered_by_prior_frame as number;
    const im = s.input_marks as number;
    if (ap < 0 || ap > im) errors.push(`gesture.zoom.answered_by_prior_frame (${ap}) must be between 0 and input_marks (${im})`);
  }
  // q03b-v3/v4 forward block shape.
  const forward = hasForward ? (s.forward as Record<string, unknown> | undefined) : undefined;
  if (hasForward) {
    if (forward == null || typeof forward !== "object") {
      errors.push("gesture.zoom.forward must be an object");
    } else {
      for (const k of Object.keys(forward)) {
        if (!(V3_FORWARD_KEYS as readonly string[]).includes(k)) {
          errors.push(`unexpected gesture.zoom.forward key "${k}"`);
        }
      }
      for (const k of V3_FORWARD_KEYS) {
        if (!(k in forward)) errors.push(`missing gesture.zoom.forward key "${k}"`);
      }
      for (const k of ["forwards", "paired"] as const) {
        if (!isNonNegativeInt(forward[k])) errors.push(`gesture.zoom.forward.${k} must be a non-negative integer (got ${JSON.stringify(forward[k])})`);
      }
      for (const k of ["stamp_to_forward_min_ms", "stamp_to_forward_p50_ms", "stamp_to_forward_max_ms"] as const) {
        if (!isFiniteNumber(forward[k])) errors.push(`gesture.zoom.forward.${k} must be a finite number (got ${JSON.stringify(forward[k])})`);
      }
    }
  }
  // q03b-v4 own_frame block shape.
  const ownFrame = hasOwnFrame ? (s.own_frame as Record<string, unknown> | undefined) : undefined;
  if (hasOwnFrame) {
    if (ownFrame == null || typeof ownFrame !== "object") {
      errors.push("gesture.zoom.own_frame must be an object");
    } else {
      for (const k of Object.keys(ownFrame)) {
        if (!(V4_OWN_FRAME_KEYS as readonly string[]).includes(k)) {
          errors.push(`unexpected gesture.zoom.own_frame key "${k}"`);
        }
      }
      for (const k of V4_OWN_FRAME_KEYS) {
        if (!(k in ownFrame)) errors.push(`missing gesture.zoom.own_frame key "${k}"`);
      }
      for (const k of ["mapped", "fallback", "main_tasks"] as const) {
        if (!isNonNegativeInt(ownFrame[k])) errors.push(`gesture.zoom.own_frame.${k} must be a non-negative integer (got ${JSON.stringify(ownFrame[k])})`);
      }
      for (const k of ["map_max_ms", "bias_p50_ms", "bias_max_ms"] as const) {
        if (!isNonNegativeFinite(ownFrame[k])) errors.push(`gesture.zoom.own_frame.${k} must be a finite number >= 0 (got ${JSON.stringify(ownFrame[k])})`);
      }
      if (isNonNegativeInt(ownFrame.fallback) && isNonNegativeInt(ownFrame.mapped) && (ownFrame.fallback as number) > (ownFrame.mapped as number)) {
        errors.push(`gesture.zoom.own_frame.fallback (${ownFrame.fallback}) must be <= mapped (${ownFrame.mapped})`);
      }
    }
  }
  // INVALID rules: the four v2 rules in every protocol, plus the v3
  // forward-pairing rules (v3, v4) and the v4 own-frame rules.
  if (dispatch != null) {
    if ((s.input_marks as number | undefined) !== undefined && (dispatch.scheduled as number | undefined) !== undefined && (s.input_marks as number) !== (dispatch.scheduled as number)) {
      errors.push(`${invalid}gesture.zoom.input_marks (${s.input_marks}) must equal dispatch.scheduled (${dispatch.scheduled})`);
    }
    if ((s.input_unpresented as number | undefined) !== undefined && (s.input_unpresented as number) !== 0) {
      errors.push(`${invalid}gesture.zoom.input_unpresented (${s.input_unpresented}) must be 0`);
    }
    if (isNonNegativeFinite(dispatch.dispatch_dev_max_ms) && (dispatch.dispatch_dev_max_ms as number) > CADENCE_V2_DISPATCH_DEV_MAX_MS) {
      errors.push(`${invalid}gesture.zoom.dispatch.dispatch_dev_max_ms (${dispatch.dispatch_dev_max_ms}) must be <= ${CADENCE_V2_DISPATCH_DEV_MAX_MS}`);
    }
    if (awake != null && awake.heartbeat_mode === "through" && isNonNegativeInt(awake.leadin_presentations) && (awake.leadin_presentations as number) > 0) {
      errors.push(`${invalid}gesture.zoom.awake_start.heartbeat_mode is "through" but leadin_presentations (${awake.leadin_presentations}) is > 0`);
    }
    if (forward != null && typeof forward === "object") {
      if (isNonNegativeInt(forward.forwards) && forward.forwards !== dispatch.scheduled) {
        errors.push(`${invalid}gesture.zoom.forward.forwards (${forward.forwards}) must equal dispatch.scheduled (${dispatch.scheduled})`);
      }
      if (isNonNegativeInt(forward.paired) && forward.paired !== dispatch.scheduled) {
        errors.push(`${invalid}gesture.zoom.forward.paired (${forward.paired}) must equal dispatch.scheduled (${dispatch.scheduled})`);
      }
      if (isFiniteNumber(forward.stamp_to_forward_min_ms) && forward.stamp_to_forward_min_ms < 0) {
        errors.push(`${invalid}gesture.zoom.forward.stamp_to_forward_min_ms (${forward.stamp_to_forward_min_ms}) must be >= 0`);
      }
      if (isFiniteNumber(forward.stamp_to_forward_max_ms) && forward.stamp_to_forward_max_ms > CADENCE_V3_STAMP_TO_FORWARD_MAX_MS) {
        errors.push(`${invalid}gesture.zoom.forward.stamp_to_forward_max_ms (${forward.stamp_to_forward_max_ms}) must be <= ${CADENCE_V3_STAMP_TO_FORWARD_MAX_MS}`);
      }
    }
    if (ownFrame != null && typeof ownFrame === "object") {
      if (isNonNegativeInt(ownFrame.mapped) && ownFrame.mapped !== dispatch.scheduled) {
        errors.push(`${invalid}gesture.zoom.own_frame.mapped (${ownFrame.mapped}) must equal dispatch.scheduled (${dispatch.scheduled})`);
      }
      if (isNonNegativeFinite(ownFrame.map_max_ms) && ownFrame.map_max_ms > CADENCE_V4_EL_MAP_MAX_MS) {
        errors.push(`${invalid}gesture.zoom.own_frame.map_max_ms (${ownFrame.map_max_ms}) must be <= ${CADENCE_V4_EL_MAP_MAX_MS}`);
      }
      if (isNonNegativeInt(ownFrame.main_tasks) && ownFrame.main_tasks < 1) {
        errors.push(`${invalid}gesture.zoom.own_frame.main_tasks (${ownFrame.main_tasks}) must be >= 1`);
      }
    }
  }
}

/** Round-trip check: rebuild a v1-shape receipt from the gesture stats +
 *  display and the canonical budgets; if the v2 zoom has only the 13 stat
 *  fields, the round-trip is the v1 path. */
function maybeRoundTrip(
  errors: string[],
  r: Record<string, unknown>,
  gesture: { pan?: unknown; zoom?: unknown },
  protocol: CadenceProtocol,
): void {
  const pan = gesture.pan as CadenceGestureStats | undefined;
  const zoom = gesture.zoom as Record<string, unknown> | undefined;
  if (
    pan == null || zoom == null ||
    typeof pan !== "object" || typeof zoom !== "object"
  ) return;
  if (
    !isNonNegativeFinite(pan.p95_ms) || !isNonNegativeFinite(pan.p99_ms) ||
    !isNonNegativeFinite(zoom.p95_ms as number) || !isNonNegativeFinite(zoom.p99_ms as number) ||
    !isNonNegativeFinite(pan.input_to_present_p95_ms) || !isNonNegativeFinite(pan.input_to_present_p99_ms) ||
    !isNonNegativeFinite(zoom.input_to_present_p95_ms as number) || !isNonNegativeFinite(zoom.input_to_present_p99_ms as number)
  ) return;
  const host = r.host as Record<string, unknown> | undefined;
  const display = r.display as Record<string, unknown> | undefined;
  if (display == null || typeof display !== "object") return;
  if (!isNonNegativeFinite(display.vsync_ms) || !isPositiveInteger(display.hz)) return;
  // For v2 receipts the zoom carries extra keys; the round-trip test calls
  // buildCadenceReceipt with the same shape, which accepts v2 zoom via the
  // union type.
  const expected = buildCadenceReceipt({
    commit: typeof r.commit === "string" ? r.commit : "0".repeat(40),
    impl: r.impl === "lwc" ? "lwc" : "mm",
    host: {
      os: typeof host?.os === "string" ? host.os : "x",
      cpu: typeof host?.cpu === "string" ? host.cpu : "x",
      dpr: isFiniteNumber(host?.dpr) ? (host?.dpr as number) : 1,
    },
    display: { vsync_ms: display.vsync_ms as number, hz: display.hz as number },
    pan: pan as CadenceGestureStats,
    zoom: zoom as unknown as CadenceGestureStats,
    protocol,
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

// ---------- Q03c v2 diagnostic line formatting ----------

/** The two end-mark diagnostics computed from the trace. DIAG-only: they
 *  are printed on CADENCE_DIAG / CADENCE_CONTROL / CADENCE_INVALID and are
 *  NEVER part of a receipt.
 *  - `zoom_marks_after_end`: de-duplicated renderer-pid zoom input marks
 *    whose time is strictly AFTER the end mark (expected 0).
 *  - `zoom_end_minus_last_mark_ms`: end mark minus the last zoom input mark
 *    at-or-before it, rounded to 0.001 (expected a few ms, never ~1000). */
export type CadenceEndMarkDiag = {
  zoom_marks_after_end: number;
  zoom_end_minus_last_mark_ms: number;
};

/** The field keys `cadenceInvalidLine` prints, in order. Exported so the
 *  unit test can pin the ordering without re-typing the list. */
export const CADENCE_INVALID_FIELDS = [
  "run",
  "attempt",
  "seed",
  "input_marks",
  "scheduled",
  "dispatched",
  "dispatch_dev_max_ms",
  "heartbeat_mode",
  "leadin_presentations",
  "input_unpresented",
  "forwards",
  "paired",
  "mapped",
  "main_tasks",
  "zoom_marks_after_end",
  "zoom_end_minus_last_mark_ms",
  "errors",
] as const;

function round3ms(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * One `CADENCE_INVALID` line for a discarded q03b-v2/v3/v4 run. The ruling says
 * an INVALID run is "repeated, never counted and never read", so this line
 * deliberately carries NO latency, percentile, cadence or answered number:
 * only the dispatch identity, the INVALID-rule inputs (the v3 forward and
 * pair counts print "null" on a v2 receipt, the v4 mapped and main-task
 * counts "null" on a v2/v3 receipt), the two end-mark diagnostics,
 * and the validator errors joined with `|`.
 * Pure: no I/O, no clock, no rounding of anything but the two ms fields.
 */
export function cadenceInvalidLine(
  impl: string,
  run: number,
  attempt: number,
  receipt: CadenceReceipt,
  diag: CadenceEndMarkDiag,
  errors: readonly string[],
): string {
  const zoom = receipt.gesture.zoom as CadenceGestureStats & Partial<CadenceZoomV4Stats>;
  const dispatch = zoom.dispatch;
  const awake = zoom.awake_start;
  const forward = zoom.forward;
  const ownFrame = zoom.own_frame;
  return [
    "CADENCE_INVALID",
    impl,
    `run=${run}`,
    `attempt=${attempt}`,
    `seed=${dispatch == null ? "null" : dispatch.seed}`,
    `input_marks=${zoom.input_marks}`,
    `scheduled=${dispatch == null ? "null" : dispatch.scheduled}`,
    `dispatched=${dispatch == null ? "null" : dispatch.dispatched}`,
    `dispatch_dev_max_ms=${dispatch == null ? "null" : round3ms(dispatch.dispatch_dev_max_ms)}`,
    `heartbeat_mode=${awake == null ? "null" : awake.heartbeat_mode}`,
    `leadin_presentations=${awake == null ? "null" : awake.leadin_presentations}`,
    `input_unpresented=${zoom.input_unpresented}`,
    `forwards=${forward == null ? "null" : forward.forwards}`,
    `paired=${forward == null ? "null" : forward.paired}`,
    `mapped=${ownFrame == null ? "null" : ownFrame.mapped}`,
    `main_tasks=${ownFrame == null ? "null" : ownFrame.main_tasks}`,
    `zoom_marks_after_end=${diag.zoom_marks_after_end}`,
    `zoom_end_minus_last_mark_ms=${round3ms(diag.zoom_end_minus_last_mark_ms)}`,
    `errors=${errors.join("|")}`,
  ].join(" ");
}

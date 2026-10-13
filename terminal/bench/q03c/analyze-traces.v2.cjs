#!/usr/bin/env node
// analyze-traces.v2.cjs
// Per-wheel breakdown for the CE-Q03C-D1 diagnostic using the explicit
// EventLatency and RenderScheduler sub-stage names Chromium emits under the
// `input` and `devtools.timeline` categories. Pure node, never imports
// cadence.ts.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const out = { dir: null, impl: null, report: null, cpuReport: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--impl") out.impl = argv[++i];
    else if (a === "--report") out.report = argv[++i];
    else if (a === "--cpu-report") out.cpuReport = argv[++i];
  }
  if (!out.dir) {
    const runId = process.env.RUN_ID ?? "ce-q03c-d1diag-1013";
    const home = process.env.HOME ?? require("node:os").homedir();
    out.dir = path.resolve(home, "lanes", "wt", runId, "traces");
  }
  return out;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}
const median = (xs) => quantile(xs.slice().sort((a, b) => a - b), 0.5);
const p95 = (xs) => quantile(xs.slice().sort((a, b) => a - b), 0.95);
const p99 = (xs) => quantile(xs.slice().sort((a, b) => a - b), 0.99);
const max = (xs) => xs.length ? xs.reduce((a, b) => (a > b ? a : b), xs[0]) : Number.NaN;
const min = (xs) => xs.length ? xs.reduce((a, b) => (a < b ? a : b), xs[0]) : Number.NaN;
const round3 = (n) => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;

function readTraceEvents(file) {
  const text = fs.readFileSync(file, "utf8");
  const data = JSON.parse(text);
  if (Array.isArray(data)) return { events: data, meta: {} };
  const events = data.traceEvents ?? [];
  for (const e of events) {
    if (!e || typeof e !== "object" || typeof e.cat !== "string") continue;
    if (e.cat.includes(",")) e._cats = e.cat.split(",");
    else e._cats = [e.cat];
  }
  return { events, meta: { wheelTimings: data.wheelTimings ?? [], impl: data.impl, runIdx: data.runIdx } };
}
const inCat = (e, cat) => e && (e.cat === cat || (Array.isArray(e._cats) && e._cats.includes(cat)));

function userTimingAllMs(events, name) {
  const out = [];
  for (const e of events) {
    if (!inCat(e, "blink.user_timing")) continue;
    if (e.name !== name) continue;
    if (typeof e.ts === "number") out.push(e.ts / 1000);
  }
  return out;
}

function pickRendererPid(events) {
  let rendererPid = null;
  let earliest = Number.POSITIVE_INFINITY;
  for (const e of events) {
    if (!inCat(e, "blink.user_timing")) continue;
    if (e.name !== "cadence:zoom:start") continue;
    if (typeof e.ts !== "number" || typeof e.pid !== "number") continue;
    if (e.ts < earliest) { earliest = e.ts; rendererPid = e.pid; }
  }
  if (rendererPid != null) return rendererPid;
  const counts = new Map();
  for (const e of events) {
    if (!inCat(e, "disabled-by-default-devtools.timeline.frame")) continue;
    if (typeof e.pid !== "number") continue;
    counts.set(e.pid, (counts.get(e.pid) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null, bestN = -1;
  for (const [pid, n] of counts) if (n > bestN) { bestN = n; best = pid; }
  return best;
}

function presentedFramesAll(events, rendererPid) {
  const out = [];
  for (const e of events) {
    if (!inCat(e, "disabled-by-default-devtools.timeline.frame")) continue;
    if (rendererPid != null && e.pid !== rendererPid) continue;
    const fr = e.args && e.args.frame_reporter;
    if (!fr) continue;
    if (fr.state !== "STATE_PRESENTED_ALL") continue;
    out.push({ tsUs: e.ts, endUs: e.ts, seq: fr.frame_sequence ?? 0 });
  }
  return out.sort((a, b) => a.endUs - b.endUs);
}

// Collect every phase 'X' event matching one of the names. Returns array of
// {name, tsUs, durUs, pid}. When `pid` is non-null, restrict to that pid.
function xSlices(events, names, pid) {
  const nameSet = new Set(names);
  const out = [];
  for (const e of events) {
    if (!e || e.ph !== "X") continue;
    if (typeof e.name !== "string" || !nameSet.has(e.name)) continue;
    if (pid != null && e.pid !== pid) continue;
    out.push({ name: e.name, tsUs: e.ts, durUs: typeof e.dur === "number" ? e.dur : 0, pid: e.pid });
  }
  return out;
}

// Pair B/E events into synthetic X slices. Chromium emits many pipeline
// sub-stages as instant begin (ph="b") and end (ph="e") events; the latency
// is end.ts - begin.ts.
function beSlices(events, names, pid) {
  const nameSet = new Set(names);
  const begins = new Map();
  const out = [];
  for (const e of events) {
    if (!e) continue;
    if (typeof e.name !== "string" || !nameSet.has(e.name)) continue;
    if (pid != null && e.pid !== pid) continue;
    if (e.ph === "b") {
      const k = `${e.pid}:${e.tid}:${e.name}`;
      const arr = begins.get(k) ?? [];
      arr.push({ ts: e.ts });
      begins.set(k, arr);
    } else if (e.ph === "e") {
      const k = `${e.pid}:${e.tid}:${e.name}`;
      const arr = begins.get(k);
      if (arr && arr.length) {
        const b = arr.shift();
        out.push({ name: e.name, tsUs: b.ts, durUs: e.ts - b.ts, pid: e.pid });
      }
    } else if (e.ph === "X") {
      out.push({ name: e.name, tsUs: e.ts, durUs: typeof e.dur === "number" ? e.dur : 0, pid: e.pid });
    }
  }
  return out;
}

// The set of names we collect for the per-wheel decomposition.
const EVENT_LATENCY_NAMES = [
  "GenerationToBrowserMain",
  "BrowserMainToRendererCompositor",
  "RendererCompositorQueueingDelay",
  "RendererCompositorToMain",
  "RendererMainProcessing",
  "RendererCompositorProcessing",
  "RenderInputRouter::GetWidgetInputHandler",
];

const RENDER_SCHEDULER_NAMES = [
  "RendererMainFinishedToCommit",
  "Commit",
  "EndCommitToActivation",
  "Activation",
  "EndActivateToSubmitCompositorFrame",
  "SubmitCompositorFrameToPresentationCompositorFrame",
];

const RENDERER_NAMES = [
  "EventDispatch",
  "FireAnimationFrame",
  "UpdateLayoutTree",
  "Layout",
  "PrePaint",
  "Paint",
  "CompositeLayers",
];

const GC_NAMES = ["MinorGC", "MajorGC"];

function assignToNearestInputMarks(marks, slices) {
  // For every slice, assign it to the nearest input mark by ts; for every
  // input mark, accumulate the assigned slices' durations. We allow many
  // slices per wheel because the same event name may appear multiple times
  // (BeginFrame vsync cycles, GC, etc.).
  const bucket = marks.map(() => []);
  for (const s of slices) {
    let bestIdx = -1;
    let bestDt = Number.POSITIVE_INFINITY;
    for (let i = 0; i < marks.length; i++) {
      const dt = Math.abs(s.tsUs - marks[i]);
      if (dt < bestDt) { bestDt = dt; bestIdx = i; }
    }
    if (bestIdx >= 0) bucket[bestIdx].push(s);
  }
  return bucket;
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.dir)) {
    console.error(`traces directory not found: ${args.dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(args.dir).filter((f) => f.endsWith(".json")).map((f) => path.join(args.dir, f)).sort();
  if (files.length === 0) {
    console.error(`no traces in ${args.dir}`);
    process.exit(1);
  }
  const perImpl = new Map();
  const cpuPerImpl = new Map();

  for (const f of files) {
    const { events, meta } = readTraceEvents(f);
    const impl = meta.impl ?? (f.includes("lwc-") ? "lwc" : f.includes("mm-") ? "mm" : null);
    if (!impl) continue;
    if (args.impl && impl !== args.impl) continue;

    const rendererPid = pickRendererPid(events);
    const startMs = userTimingAllMs(events, "cadence:zoom:start")[0] ?? 0;
    const endMs = userTimingAllMs(events, "cadence:zoom:end")[0] ?? 0;
    const inputMarksMs = userTimingAllMs(events, "cadence:zoom:input");
    const inputMarksUs = inputMarksMs.map((ms) => ms * 1000);
    const presented = presentedFramesAll(events, rendererPid);
    const presentedEndMs = presented.map((p) => p.endUs / 1000);

    const vsyncMs = vsyncFromPresented(presentedEndMs);

    // Per-input latency
    const perWheel = inputMarksUs.map((mUs, i) => {
      let lastPresUs = null;
      for (const p of presented) {
        if (p.endUs <= mUs) lastPresUs = p.endUs;
        else break;
      }
      let nextPresUs = null;
      for (const p of presented) {
        if (p.endUs >= mUs) { nextPresUs = p.endUs; break; }
      }
      const Latms = nextPresUs != null ? (nextPresUs - mUs) / 1000 : null;
      const phaseMs = lastPresUs != null ? (mUs - lastPresUs) / 1000 : null;
      const slots = Latms != null && vsyncMs ? Math.round(Latms / vsyncMs) : 0;
      return { i, markMs: inputMarksMs[i], Latms, phaseMs, slots };
    });

    // Per-wheel decomp
    const decomp = perWheel.map((w) => ({
      i: w.i, Latms: w.Latms, phaseMs: w.phaseMs, slots: w.slots,
      Hms: 0, Rms: 0, Layms: 0, ULTms: 0, PPms: 0, PNms: 0, CMms: 0,
      Qms: 0, Cms: 0, GenToBrowserMs: 0, BrowsToCompMs: 0,
      RendererCompQDelayMs: 0, CompToMainMs: 0, MainProcessingMs: 0,
      RendererCompProcMs: 0, GetWidgetMs: 0,
      MainFinishToCommitMs: 0, CommitMs: 0, EndCommitToActMs: 0,
      ActivationMs: 0, EndActToSubmitMs: 0, SubmitToPresMs: 0,
    }));

    const accumulated = (key, slices) => {
      const per = assignToNearestInputMarks(inputMarksUs, slices);
      for (let i = 0; i < perWheel.length; i++) {
        let sum = 0;
        for (const s of per[i]) sum += s.durUs / 1000;
        decomp[i][key] += sum;
      }
    };

    const rendererSlices = xSlices(events, RENDERER_NAMES, rendererPid);
    // EventLatency and RenderScheduler events live in the "input" /
    // "devtools.timeline" categories and are emitted by BOTH the browser
    // process and the renderer, mostly as phase 'b'/'e' instants. We
    // collect both PIDs and merge per-wheel; beSlices pairs them.
    const allPids = new Set();
    for (const e of events) if (e && typeof e.pid === "number") allPids.add(e.pid);
    const otherPids = [...allPids].filter((p) => p !== rendererPid);
    const eventLatencySlices = [
      ...beSlices(events, EVENT_LATENCY_NAMES, rendererPid),
      ...beSlices(events, EVENT_LATENCY_NAMES, otherPids[0] ?? null),
    ];
    const renderSchedulerSlices = [
      ...beSlices(events, RENDER_SCHEDULER_NAMES, rendererPid),
      ...beSlices(events, RENDER_SCHEDULER_NAMES, otherPids[0] ?? null),
    ];
    const gcSlices = xSlices(events, GC_NAMES, null);

    // Renderer-side per-name main thread ms.
    const byName = {};
    for (const s of rendererSlices) {
      byName[s.name] = (byName[s.name] ?? 0) + s.durUs / 1000;
      if (s.name === "EventDispatch") accumulated("Hms", [s]);
      else if (s.name === "FireAnimationFrame") accumulated("Rms", [s]);
      else if (s.name === "Layout") accumulated("Layms", [s]);
      else if (s.name === "UpdateLayoutTree") accumulated("ULTms", [s]);
      else if (s.name === "PrePaint") accumulated("PPms", [s]);
      else if (s.name === "Paint") accumulated("PNms", [s]);
      else if (s.name === "CompositeLayers") accumulated("CMms", [s]);
    }

    // EventLatency sub-stages
    for (const s of eventLatencySlices) {
      const key = ({
        "GenerationToBrowserMain": "GenToBrowserMs",
        "BrowserMainToRendererCompositor": "BrowsToCompMs",
        "RendererCompositorQueueingDelay": "RendererCompQDelayMs",
        "RendererCompositorToMain": "CompToMainMs",
        "RendererMainProcessing": "MainProcessingMs",
        "RendererCompositorProcessing": "RendererCompProcMs",
        "RenderInputRouter::GetWidgetInputHandler": "GetWidgetMs",
      })[s.name];
      if (key) accumulated(key, [s]);
    }

    // RenderScheduler sub-stages
    for (const s of renderSchedulerSlices) {
      const key = ({
        "RendererMainFinishedToCommit": "MainFinishToCommitMs",
        "Commit": "CommitMs",
        "EndCommitToActivation": "EndCommitToActMs",
        "Activation": "ActivationMs",
        "EndActivateToSubmitCompositorFrame": "EndActToSubmitMs",
        "SubmitCompositorFrameToPresentationCompositorFrame": "SubmitToPresMs",
      })[s.name];
      if (key) accumulated(key, [s]);
    }

    // Total main-thread busy ms per wheel
    for (let i = 0; i < decomp.length; i++) {
      const d = decomp[i];
      d.total_main_thread =
        d.Hms + d.MainProcessingMs + d.Rms + d.Layms + d.ULTms + d.PPms + d.PNms +
        d.CMms + d.CommitMs;
    }

    // GC summary in window
    const gcInWindow = gcSlices.filter((g) => g.tsUs >= startMs * 1000 && g.tsUs <= endMs * 1000 + 200_000);
    const gcMs = gcInWindow.reduce((a, b) => a + b.durUs / 1000, 0);

    // CPU profile top functions inside H + R windows
    // disabled-by-default-v8.cpu_profiler emits "Profile" / "ProfileChunk"
    // and per-sample "Sample" events with "tree" / "node" payloads.
    // Aggregate the per-sample self-time inside any input mark's [mark, mark+33ms]
    // window for the renderer pid.
    const sampleBuckets = new Map();
    for (let i = 0; i < inputMarksUs.length; i++) {
      const lo = inputMarksUs[i];
      const hi = lo + 33_000; // 33ms ≈ 2 vsync slots
      sampleBuckets.set(i, { lo, hi, totals: new Map() });
    }
    const allSamples = events.filter((e) => e && inCat(e, "disabled-by-default-v8.cpu_profiler") && e.name === "Sample");
    const cpuTopByWheel = {};
    if (allSamples.length > 0) {
      // CPU samples are X events whose args include the call stack. Most
      // Chromium builds use { "node": { "cf": function-name, "url": ..., "l": line } }
      // or { "tree": "tree-name" } per sample. Without the full profile graph
      // we can only attribute to top-level names — record both formats.
      for (const s of allSamples) {
        const ts = s.ts;
        for (const [i, b] of sampleBuckets) {
          if (ts >= b.lo && ts <= b.hi) {
            // Pick a label: args.node.cf if present, else args.tree, else args.name
            let label = null;
            const a = s.args ?? {};
            if (a.node && typeof a.node === "object") label = a.node.cf ?? a.node.name ?? a.node.fn ?? JSON.stringify(a.node).slice(0, 80);
            else if (typeof a.tree === "string") label = a.tree;
            else if (typeof a.name === "string") label = a.name;
            if (!label) continue;
            b.totals.set(label, (b.totals.get(label) ?? 0) + 1);
            break;
          }
        }
      }
      // Build a per-engine roll-up over all wheels (sum count per label).
      const totals = new Map();
      for (const [, b] of sampleBuckets) {
        for (const [k, v] of b.totals) totals.set(k, (totals.get(k) ?? 0) + v);
      }
      cpuTopByWheel.all = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    }

    const arr = perImpl.get(impl) ?? [];
    arr.push({
      file: f, impl, runIdx: meta.runIdx ?? null, rendererPid,
      vsyncMs, hz: vsyncMs ? Math.round(1000 / vsyncMs) : null,
      gcMs, gcCount: gcInWindow.length,
      perWheel: decomp,
      cpuTopByWheel,
      nInputs: inputMarksMs.length, nPresented: presented.length,
      byName_ms: byName,
    });
    perImpl.set(impl, arr);

    // CPU top: aggregate across runs
    const cpuRollup = cpuPerImpl.get(impl) ?? new Map();
    for (const [label, count] of cpuTopByWheel.all ?? []) {
      cpuRollup.set(label, (cpuRollup.get(label) ?? 0) + count);
    }
    cpuPerImpl.set(impl, cpuRollup);
  }

  const summary = {};
  for (const [impl, entries] of perImpl) {
    const perWheelPool = [];
    for (const e of entries) {
      for (const w of e.perWheel) {
        if (w.i >= 1 && w.i <= 59 && Number.isFinite(w.Latms) && Number.isFinite(w.phaseMs)) {
          perWheelPool.push(w);
        }
      }
    }
    const wheel0Pool = entries.flatMap((e) => e.perWheel.filter((w) => w.i === 0));
    const cols = [
      "Latms", "phaseMs",
      "Hms", "Rms", "Layms", "ULTms", "PPms", "PNms", "CMms",
      "Qms", "Cms",
      "GenToBrowserMs", "BrowsToCompMs", "RendererCompQDelayMs",
      "CompToMainMs", "MainProcessingMs", "RendererCompProcMs", "GetWidgetMs",
      "MainFinishToCommitMs", "CommitMs", "EndCommitToActMs",
      "ActivationMs", "EndActToSubmitMs", "SubmitToPresMs",
      "total_main_thread",
    ];
    const colStats = (key) => ({
      n: perWheelPool.length,
      median: round3(median(perWheelPool.map((w) => w[key]))),
      p95: round3(p95(perWheelPool.map((w) => w[key]))),
      p99: round3(p99(perWheelPool.map((w) => w[key]))),
      max: round3(max(perWheelPool.map((w) => w[key]))),
    });
    const stats = {};
    for (const k of cols) stats[k] = colStats(k);

    const slotCounts = new Map();
    for (const w of perWheelPool) {
      const s = w.slots;
      slotCounts.set(s, (slotCounts.get(s) ?? 0) + 1);
    }
    const slotDistribution = {};
    for (const [k, v] of [...slotCounts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
      slotDistribution[`slot_${k}`] = v;
    }

    const byName_total = {};
    for (const e of entries) {
      for (const [k, v] of Object.entries(e.byName_ms ?? {})) {
        byName_total[k] = (byName_total[k] ?? 0) + v;
      }
    }

    summary[impl] = {
      runs: entries.length,
      nInputs: entries.reduce((a, e) => a + e.nInputs, 0),
      nPresented: entries.reduce((a, e) => a + e.nPresented, 0),
      vsyncMs: entries[0]?.vsyncMs ?? null,
      hz: entries[0]?.hz ?? null,
      gcMs_total: round3(entries.reduce((a, e) => a + e.gcMs, 0)),
      gcCount_total: entries.reduce((a, e) => a + e.gcCount, 0),
      wheel0: wheel0Pool.length
        ? { n: wheel0Pool.length, Latms_median: round3(median(wheel0Pool.map((w) => w.Latms))), Latms_p95: round3(p95(wheel0Pool.map((w) => w.Latms))) }
        : null,
      stats,
      slotDistribution,
      byName_ms_total: Object.fromEntries(Object.entries(byName_total).map(([k, v]) => [k, round3(v)])),
      cpuTop10: [...(cpuPerImpl.get(impl) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }

  if (summary.mm && summary.lwc) {
    const delta = {};
    for (const k of Object.keys(summary.mm.stats)) {
      delta[k] = {
        median_delta: round3(summary.mm.stats[k].median - summary.lwc.stats[k].median),
        p95_delta: round3(summary.mm.stats[k].p95 - summary.lwc.stats[k].p95),
      };
    }
    summary.delta_mm_minus_lwc = delta;
  }

  if (args.report) fs.writeFileSync(args.report, JSON.stringify(summary, null, 2) + "\n");
  if (args.cpuReport) {
    const out = {};
    for (const [impl, m] of cpuPerImpl) out[impl] = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    fs.writeFileSync(args.cpuReport, JSON.stringify(out, null, 2) + "\n");
  }
  console.log(JSON.stringify(summary, null, 2));
}

function vsyncFromPresented(presentedEndMs) {
  if (!presentedEndMs || presentedEndMs.length < 3) return null;
  const intervals = [];
  for (let i = 1; i < presentedEndMs.length; i++) {
    const d = presentedEndMs[i] - presentedEndMs[i - 1];
    if (d > 0 && d < 100) intervals.push(d);
  }
  if (intervals.length === 0) return null;
  return round3(quantile(intervals.slice().sort((a, b) => a - b), 0.05));
}

main();
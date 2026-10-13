#!/usr/bin/env node
/**
 * Stand-alone analysis for the Q03C-D2 diagnostic.
 * Reads ~/lanes/wt/$RUN_ID/traces/runs.json (the harness's per-run summary)
 * and the per-run trace JSONs in the same directory, then prints:
 *   - per-variant, per-impl, per-gesture table of first-input latency
 *     (median + range over runs) and rest median
 *   - F4 timestamp table (for V0 zoom + pan, both impls): page input mark
 *     (ts/1000 in trace), first presented frame at-or-after, and gap
 *   - F5 task dump summary (for V0 zoom + pan, both impls): count of
 *     renderer main-thread top-level tasks, max duration, GC events
 *
 * Must NOT import repo modules (per task constraint). Runs with `node`.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const TRACE_OUT = process.env.D2_TRACE_OUT
  || path.resolve(process.env.HOME || "/home/longr", "lanes/wt/d2-traces-ce-q03c-1013");

function median(xs) {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}
function range(xs) {
  if (!xs.length) return { min: NaN, max: NaN };
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

function loadRuns() {
  const f = path.join(TRACE_OUT, "runs.json");
  if (!fs.existsSync(f)) {
    console.error(`runs.json not found at ${f}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function firstInputTable(runs) {
  const groups = new Map();
  for (const r of runs.runs) {
    if (r.firstMs == null || !Number.isFinite(r.firstMs)) continue;
    const key = `${r.variant}|${r.impl}|${r.panOrZoom}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const keys = Array.from(groups.keys()).sort();
  console.log("\n=== first-input latency table (ms) ===");
  console.log("variant | impl | kind | n | first_med | first_min | first_max | rest_med");
  for (const k of keys) {
    const list = groups.get(k);
    const firsts = list.map((r) => r.firstMs);
    const rests = list.map((r) => r.restMedianMs).filter((x) => x != null && Number.isFinite(x));
    const f = firsts;
    const m = median(f);
    const r = range(f);
    console.log(
      `${k.split("|")[0].padEnd(22)} ${k.split("|")[1].padEnd(5)} ${k.split("|")[2].padEnd(5)} n=${list.length.toString().padStart(3)} first_med=${m.toFixed(1).padStart(7)} first_min=${r.min.toFixed(1).padStart(7)} first_max=${r.max.toFixed(1).padStart(7)} rest_med=${(rests.length ? median(rests) : NaN).toFixed(1).padStart(7)}`,
    );
  }
}

function ratioTable(runs) {
  // first_ms / rest_med — the ELEVATION RATIO; should be near 1 for d (pipeline wake-up),
  // and > 1 for a/b (engine-specific).
  console.log("\n=== elevation ratio (first_ms / rest_med) ===");
  console.log("variant | impl | kind | n | ratio_med");
  const groups = new Map();
  for (const r of runs.runs) {
    if (r.firstMs == null || r.restMedianMs == null) continue;
    if (!Number.isFinite(r.firstMs) || !Number.isFinite(r.restMedianMs)) continue;
    if (r.restMedianMs <= 0) continue;
    const k = `${r.variant}|${r.impl}|${r.panOrZoom}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.firstMs / r.restMedianMs);
  }
  const keys = Array.from(groups.keys()).sort();
  for (const k of keys) {
    const xs = groups.get(k);
    console.log(
      `${k.split("|")[0].padEnd(22)} ${k.split("|")[1].padEnd(5)} ${k.split("|")[2].padEnd(5)} n=${xs.length.toString().padStart(3)} ratio_med=${median(xs).toFixed(2).padStart(7)}`,
    );
  }
}

function f4TimestampTable(runs) {
  // For V0 and F4 variants, compare the FIRST input mark ts with the
  // first presented frame at-or-after it. Also report the gap between the
  // FIRST mark and the SECOND mark, and the same for presented.
  console.log("\n=== F4: first input mark vs first presented frame (V0 zoom) ===");
  console.log("impl | run | first_mark_ms | first_presented_ms | gap_ms | second_mark_ms | second_presented_ms | gap2_ms");
  for (const r of runs.runs) {
    if (r.variant !== "V0" || r.panOrZoom !== "zoom") continue;
    const m1 = r.inputMarksFirst10[0];
    const p1 = r.presentedFirst10[0];
    const m2 = r.inputMarksFirst10[1];
    const p2 = r.presentedFirst10[1];
    if (m1 == null || p1 == null) continue;
    console.log(
      `${r.impl.padEnd(5)} n=${r.run + 1}  m1=${m1.toFixed(3)} p1=${p1.toFixed(3)} gap=${(p1 - m1).toFixed(3)} m2=${m2 == null ? "null" : m2.toFixed(3)} p2=${p2 == null ? "null" : p2.toFixed(3)} gap2=${p2 != null && m2 != null ? (p2 - m2).toFixed(3) : "null"}`,
    );
  }
  console.log("\n=== F4: V0 pan ===");
  console.log("impl | run | first_mark_ms | first_presented_ms | gap_ms | second_mark_ms | second_presented_ms | gap2_ms");
  for (const r of runs.runs) {
    if (r.variant !== "V0" || r.panOrZoom !== "pan") continue;
    const m1 = r.inputMarksFirst10[0];
    const p1 = r.presentedFirst10[0];
    const m2 = r.inputMarksFirst10[1];
    const p2 = r.presentedFirst10[1];
    if (m1 == null || p1 == null) continue;
    console.log(
      `${r.impl.padEnd(5)} n=${r.run + 1}  m1=${m1.toFixed(3)} p1=${p1.toFixed(3)} gap=${(p1 - m1).toFixed(3)} m2=${m2 == null ? "null" : m2.toFixed(3)} p2=${p2 == null ? "null" : p2.toFixed(3)} gap2=${p2 != null && m2 != null ? (p2 - m2).toFixed(3) : "null"}`,
    );
  }
}

function findFirstPresentedAtOrAfter(events, afterMs, afterMs_end) {
  // Find the first STATE_PRESENTED_ALL endMs at-or-after `afterMs` in the
  // presentedMs array derived from the trace's PipelineReporter events.
  // We use the standard cadence parser for parity.
  const { parsePresentedFrames } = require(path.resolve(__dirname, "../../lib/chart-engine/bench/cadence.js"));
  // but cadence.ts uses ts/1000 already in parsePresentedFrames
  return null;
}

function f5TaskSummary(runs) {
  // Walk the per-run trace files and summarize the renderer main-thread tasks
  // in [firstMarkMs - 5, firstPresentedAfterInput + 5]. The trace's "toplevel"
  // category X events (ThreadControllerImpl::RunTask etc.) are the renderer
  // main-thread top-level tasks.
  console.log("\n=== F5: task dump (renderer main thread, V0 zoom, first input to first presentation AFTER it) ===");
  console.log("impl | run | renderer_pid | n_tasks | max_dur_ms | total_dur_ms | has_gc | has_compile | input_to_present_ms");
  for (const r of runs.runs) {
    if (r.variant !== "V0" || r.panOrZoom !== "zoom") continue;
    if (r.rendererPid == null) continue;
    const file = path.join(TRACE_OUT, `V0-${r.impl}-r${r.run + 1}-zoom.json`);
    if (!fs.existsSync(file)) continue;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const evs = data.traceEvents || [];
    const m1 = r.inputMarksFirst10[0];
    const firstMs = r.firstMs;
    if (m1 == null || firstMs == null || !Number.isFinite(firstMs)) continue;
    // first presented-after-input = m1 + firstMs
    const p1 = m1 + firstMs;
    const startUs = (m1 - 5) * 1000;
    const endUs = (p1 + 5) * 1000;
    let n = 0, maxDur = 0, totalDur = 0;
    let hasGc = false, hasCompile = false;
    for (const e of evs) {
      if (!e || typeof e !== "object") continue;
      if (e.cat !== "toplevel" || e.ph !== "X") continue;
      if (e.pid !== r.rendererPid) continue;
      if (typeof e.ts !== "number" || e.ts < startUs || e.ts > endUs) continue;
      const dur = (typeof e.dur === "number" ? e.dur : 0) / 1000;
      if (dur > maxDur) maxDur = dur;
      totalDur += dur;
      n++;
      if (typeof e.name === "string") {
        if (e.name.includes("GC") || e.name.includes("MajorGC") || e.name.includes("MinorGC") || e.name.includes("Scavenge")) hasGc = true;
        if (e.name.includes("Compile") || e.name.includes("Parse") || e.name.includes("V8.Bytecode")) hasCompile = true;
      }
    }
    console.log(
      `${r.impl.padEnd(5)} n=${r.run + 1}  pid=${r.rendererPid} n=${n.toString().padStart(3)} max=${maxDur.toFixed(2).padStart(7)}ms total=${totalDur.toFixed(2).padStart(7)}ms gc=${hasGc ? "Y" : "n"} compile=${hasCompile ? "Y" : "n"} first_ms=${firstMs.toFixed(2)}`,
    );
  }
}

function summary() {
  const runs = loadRuns();
  console.log(`commit=${runs.commit.slice(0, 12)} host=${runs.host} cpu=${runs.cpu} os=${runs.os}`);
  console.log(`n_runs=${runs.runs.length}`);
  firstInputTable(runs);
  ratioTable(runs);
  f4TimestampTable(runs);
  f5TaskSummary(runs);
}

if (require.main === module) summary();
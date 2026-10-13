#!/usr/bin/env node
/**
 * F4 timestamp comparison (Q03C-D2):
 * For the FIRST 5 inputs of every V0 gesture, compare:
 *   - the page-side input mark (ts/1000 from cadence:{kind}:input blink.user_timing)
 *   - the first renderer-side LatencyInfo.Flow / ScrollUpdate / HandleScrollUpdate
 *     in the trace, with timing relative to the page mark.
 *
 * Prints: (mark_to_first_latency_flow_ms), (first_latency_flow_to_first_scroll_ms),
 *         (first_scroll_to_presentation_ms).
 *
 * Must NOT import repo modules. Reads per-run trace JSONs from $D2_TRACE_OUT.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const TRACE_OUT = process.env.D2_TRACE_OUT
  || path.resolve(process.env.HOME || "/home/longr", "lanes/wt/d2-traces-ce-q03c-1013");

function readEvents(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return data.traceEvents || [];
}

function firstNInputMarks(events, kind, n) {
  const name = `cadence:${kind}:input`;
  const out = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.cat !== "blink.user_timing" || e.name !== name) continue;
    if (typeof e.ts !== "number") continue;
    out.push(e.ts / 1000); // ms
    if (out.length >= n) break;
  }
  return out;
}

function firstBrowserEventAtOrAfter(events, afterMs, names) {
  // Find the first event whose name is in `names` and whose ts (us/1000=ms)
  // is at or after `afterMs`. Returns {name, tsMs} or null.
  const afterUs = afterMs * 1000;
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.ts !== "number") continue;
    if (e.ts < afterUs) continue;
    if (names.includes(e.name)) {
      return { name: e.name, tsMs: e.ts / 1000 };
    }
  }
  return null;
}

function firstPresentedAtOrAfter(events, afterMs) {
  // Walk the events and find the first STATE_PRESENTED_ALL frame whose
  // end ts is at or after `afterMs`. Chromium emits `b`/`e` pairs (not `X`)
  // for PipelineReporter on this build; we pair by id2.local and read the
  // state's frame_source:frame_sequence key to de-dup forked duplicates.
  const afterUs = afterMs * 1000;
  const beginByKey = new Map();
  const completed = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.name !== "PipelineReporter") continue;
    const ts = typeof e.ts === "number" ? e.ts : null;
    if (ts == null) continue;
    if (e.ph === "b") {
      const state = e.args && e.args.frame_reporter && e.args.frame_reporter.state;
      const id2 = e.id2 || {};
      const pairKey = id2.local || id2.global || e.id;
      beginByKey.set(pairKey, { state, ts });
    } else if (e.ph === "e") {
      const id2 = e.id2 || {};
      const pairKey = id2.local || id2.global || e.id;
      const begin = beginByKey.get(pairKey);
      if (begin) {
        completed.push({ state: begin.state, endUs: ts });
        beginByKey.delete(pairKey);
      }
    } else if (e.ph === "X") {
      const state = e.args && e.args.frame_reporter && e.args.frame_reporter.state;
      const dur = typeof e.dur === "number" ? e.dur : 0;
      completed.push({ state, endUs: ts + dur });
    }
  }
  completed.sort((a, b) => a.endUs - b.endUs);
  for (const c of completed) {
    if (c.endUs >= afterUs && c.state === "STATE_PRESENTED_ALL") {
      return { tsMs: c.endUs / 1000 };
    }
  }
  return null;
}

function analyze(file, kind) {
  const events = readEvents(file);
  const marks = firstNInputMarks(events, kind, 5);
  if (marks.length === 0) {
    console.log(`${path.basename(file)}: no input marks`);
    return;
  }
  console.log(`\n=== ${path.basename(file)} (${kind}) ===`);
  console.log("input_idx | mark_ms | first_latency_flow | flow_ms | first_scroll | scroll_ms | presented | present_ms");
  const latencyNames = ["LatencyInfo.Flow"];
  const scrollNames = ["HandleScrollBegin", "HandleScrollUpdate", "ScrollUpdate"];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const flow = firstBrowserEventAtOrAfter(events, mark, latencyNames);
    const scroll = firstBrowserEventAtOrAfter(events, mark, scrollNames);
    const present = firstPresentedAtOrAfter(events, mark);
    console.log(
      `i=${i + 1} mark=${mark.toFixed(3)}` +
      ` flow=${flow ? `${flow.name}@${flow.tsMs.toFixed(3)} (${(flow.tsMs - mark).toFixed(2)})` : "none"}` +
      ` scroll=${scroll ? `${scroll.name}@${scroll.tsMs.toFixed(3)} (${(scroll.tsMs - mark).toFixed(2)})` : "none"}` +
      ` present=${present ? `${present.tsMs.toFixed(3)} (${(present.tsMs - mark).toFixed(2)})` : "none"}`,
    );
  }
}

if (require.main === module) {
  const variants = ["V0"];
  const kinds = ["zoom", "pan"];
  const impls = ["mm", "lwc"];
  const runs = [1, 2, 3];
  for (const v of variants) {
    for (const k of kinds) {
      for (const impl of impls) {
        for (const n of runs) {
          const file = path.join(TRACE_OUT, `${v}-${impl}-r${n}-${k}.json`);
          if (fs.existsSync(file)) analyze(file, k);
        }
      }
    }
  }
}
#!/usr/bin/env node
/**
 * F5 task dump (Q03C-D2):
 * For the first input of every V0 gesture, list the renderer main-thread
 * top-level tasks (cat=toplevel, ph=X, pid=rendererPid) in the window from
 * the input mark to the first presented-after-input frame.
 *
 * Reports: name | start offset from mark (ms) | dur (ms).
 * Also dumps a comparison vs input 5.
 *
 * Must NOT import repo modules.
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
    out.push(e.ts);
    if (out.length >= n) break;
  }
  return out;
}

function firstPresentedAtOrAfter(events, afterUs) {
  // Chromium emits `b`/`e` pairs (not `X`) for PipelineReporter on this build.
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
      return c.endUs;
    }
  }
  return null;
}

function rendererPid(events) {
  // Find PipelineReporter pids
  const pids = new Set();
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.name !== "PipelineReporter") continue;
    if (typeof e.pid === "number") pids.add(e.pid);
  }
  // Find the pid that emitted the FIRST cadence:zoom:input mark
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.cat === "blink.user_timing" && (e.name === "cadence:zoom:input" || e.name === "cadence:pan:input")) {
      if (typeof e.pid === "number" && pids.has(e.pid)) return e.pid;
    }
  }
  return null;
}

function listTasks(events, fromUs, toUs, pid) {
  const tasks = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.cat !== "toplevel" || e.ph !== "X") continue;
    if (e.pid !== pid) continue;
    if (typeof e.ts !== "number") continue;
    if (e.ts < fromUs || e.ts > toUs) continue;
    const dur = typeof e.dur === "number" ? e.dur : 0;
    tasks.push({ name: e.name || "?", tsUs: e.ts, durUs: dur, durMs: dur / 1000, startOffsetMs: (e.ts - fromUs) / 1000 });
  }
  tasks.sort((a, b) => a.tsUs - b.tsUs);
  return tasks;
}

function analyze(file, kind, inputIdx) {
  const events = readEvents(file);
  const marks = firstNInputMarks(events, kind, 6);
  if (marks.length < inputIdx + 1) {
    console.log(`${path.basename(file)}: not enough marks`);
    return;
  }
  const pid = rendererPid(events);
  if (pid == null) {
    console.log(`${path.basename(file)}: no renderer pid`);
    return;
  }
  const markUs = marks[inputIdx - 1];
  const presentUs = firstPresentedAtOrAfter(events, markUs);
  if (presentUs == null) {
    console.log(`${path.basename(file)}: no presentation after mark`);
    return;
  }
  const tasks = listTasks(events, markUs - 2000, presentUs + 2000, pid);
  console.log(`\n=== ${path.basename(file)} (${kind}, input ${inputIdx}, mark->present=${((presentUs - markUs) / 1000).toFixed(2)}ms) ===`);
  console.log("name | start_offset_ms | dur_ms");
  for (const t of tasks) {
    if (t.durMs < 0.3) continue; // filter trivial
    console.log(`  ${t.name.padEnd(45)} ${t.startOffsetMs.toFixed(2).padStart(7)} ${t.durMs.toFixed(2).padStart(7)}`);
  }
  if (tasks.length === 0) console.log("  (no toplevel X tasks in window)");
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
          if (fs.existsSync(file)) {
            analyze(file, k, 1);
            analyze(file, k, 5);
          }
        }
      }
    }
  }
}
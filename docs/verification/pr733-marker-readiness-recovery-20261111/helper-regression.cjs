"use strict";

// This executes the actual helper against scripted DOM geometry. It does not
// launch a browser, reproduce a pointer gesture or claim hosted acceptance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const terminal = path.resolve(__dirname, "../../../terminal");
const requireTerminal = createRequire(path.join(terminal, "package.json"));
const ts = requireTerminal("typescript");
const { JSDOM } = requireTerminal("jsdom");
const original = fs.readFileSync(path.join(__dirname, "original-marker-helpers.ts.txt"), "utf8");
const full = fs.readFileSync(path.join(terminal, "e2e/marker-tooltip.spec.ts"), "utf8");
const candidate = full.slice(full.indexOf("/** Every titled marker"), full.indexOf("/** Resolve a FIXTURE signal date"));
assert.equal(candidate, fs.readFileSync(path.join(__dirname, "accepted-marker-helpers.ts.txt"), "utf8"));

async function observe(source, frames) {
  const dom = new JSDOM('<div class="chart-body"><div class="chart-wrap"><div class="tv-lightweight-charts"><table></table></div><svg data-sig-layer="1"><g><title>2026-09-01 · fixture marker</title></g></svg></div></div>');
  const document = dom.window.document;
  const body = document.querySelector(".chart-body");
  const wrap = document.querySelector(".chart-wrap");
  const table = document.querySelector("table");
  const svg = document.querySelector("svg");
  const marker = svg.querySelector("g");
  let reads = 0;
  const rect = (height, y = 0) => ({ x: 10, y, width: 20, height, top: y, left: 10, right: 30, bottom: y + height });
  const page = { locator(selector) {
    assert.equal(selector, "[data-sig-layer]");
    return { first() { return { evaluate(fn) {
      const frame = frames[reads++];
      assert.ok(frame, "unexpected additional geometry read");
      body.style.setProperty("--subpanes", String(frame.declared));
      body.style.setProperty("--drawing-host-height", `${frame.wrapper}px`);
      table.innerHTML = "<tr><td><canvas></canvas></td></tr>".repeat(frame.drawn + 2);
      wrap.getBoundingClientRect = () => rect(frame.wrapper);
      table.getBoundingClientRect = () => rect(frame.table);
      marker.getBoundingClientRect = () => rect(8, frame.y);
      return fn(svg);
    } }; } };
  } };
  const expect = { poll(callback, options) {
    assert.equal(options.timeout, 25000);
    assert.deepEqual(Array.from(options.intervals), [150, 200, 300, 400, 500]);
    return { async toBe(value) {
      assert.equal(value, true);
      while (reads < frames.length) if (await callback()) return;
      throw new Error("UNSETTLED_GEOMETRY");
    } };
  } };
  const code = ts.transpileModule(source + "\nglobalThis.run = settledMarkers;", {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(code.diagnostics.length, 0);
  const context = vm.createContext({ expect, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
  vm.runInContext(code.outputText, context);
  try {
    const result = await context.run(page);
    return { state: "ready", reads, cy: result[0]?.cy };
  } catch (error) {
    if (error.message !== "UNSETTLED_GEOMETRY") throw error;
    return { state: "unsettled", reads };
  } finally {
    dom.window.close();
  }
}

(async () => {
  const staleTopology = { declared: 2, drawn: 0, wrapper: 464, table: 464, y: 198 };
  const staleGeometry = { declared: 0, drawn: 0, wrapper: 346, table: 464, y: 198 };
  const ready = { declared: 0, drawn: 0, wrapper: 346, table: 346, y: 148 };
  const cases = [
    ["waits past stale requested topology", [staleTopology, staleTopology, ready, ready], 4],
    ["waits until chart fills the new wrapper", [staleGeometry, staleGeometry, ready, ready], 4],
    ["resets stability across an ineligible sample", [ready, { ...staleGeometry, y: 148 }, ready, ready], 4],
  ];
  for (const [name, frames, expectedReads] of cases) {
    const before = await observe(original, frames);
    const after = await observe(candidate, frames);
    assert.equal(before.state, "ready");
    assert.equal(before.reads, 2, "original helper should expose its early readiness");
    assert.equal(after.state, "ready");
    assert.equal(after.reads, expectedReads);
    assert.equal(after.cy, 152);
    console.log(JSON.stringify({ name, before, after }));
  }
  for (const [name, frames] of [
    ["never admits unresolved topology", [staleTopology, staleTopology]],
    ["never admits an unresolved resize", [staleGeometry, staleGeometry]],
  ]) {
    const before = await observe(original, frames), after = await observe(candidate, frames);
    assert.equal(before.state, "ready");
    assert.equal(after.state, "unsettled");
    console.log(JSON.stringify({ name, before, after }));
  }
  const before = await observe(original, [ready, ready]), after = await observe(candidate, [ready, ready]);
  assert.deepEqual(after, before);
  assert.equal(after.state, "ready");
  console.log(JSON.stringify({ name: "preserves two-read readiness when geometry is already final", before, after }));
  console.log("6 helper regression contracts passed; 5 original-helper negative discriminators; no browser execution.");
})().catch(error => { console.error(error); process.exitCode = 1; });

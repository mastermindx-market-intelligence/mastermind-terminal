"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- synthetic Node evidence checks */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PNG } = require("pngjs");
const { TITLES, SHOTS, VIEWPORTS, validateReport, validateImages } = require("./ticker_news_capture_receipt.cjs");

// Synthetic report and tiny PNGs test rejection behavior only. They are never
// browser evidence and are not written into any capture packet.
const startedAt = "2026-11-11T00:00:00.000Z";
function report() {
  const specs = TITLES.map((title, index) => ({ title, file: "ticker-news.spec.ts", ok: true,
    tests: Object.keys(VIEWPORTS).map(projectName => {
      const skip = ([0, 3, 4].includes(index) && projectName !== "desktop") || (index === 1 && projectName === "tablet");
      return { projectName, expectedStatus: skip ? "skipped" : "passed", status: skip ? "skipped" : "expected",
        results: [{ status: skip ? "skipped" : "passed", retry: 0, errors: [], duration: 10 }] };
    }) }));
  return { config: { workers: 1 }, errors: [], suites: [{ specs }],
    stats: { startTime: "2026-11-11T00:00:01.000Z", duration: 1000, expected: 14, skipped: 7, unexpected: 0, flaky: 0 } };
}
test("accepts the exact full matrix with only its seven authored skips", () => {
  const cases = validateReport(report(), startedAt);
  assert.equal(cases.filter(row => row.status === "passed").length, 14);
  assert.equal(cases.filter(row => row.status === "skipped").length, 7);
});
const mutations = {
  "runner error": r => { r.errors.push({ message: "server startup failed" }); },
  "more than one worker": r => { r.config.workers = 2; },
  "stale report": r => { r.stats.startTime = "2026-11-10T00:00:00.000Z"; },
  "invalid report time": r => { r.stats.startTime = "unknown"; },
  "zero duration": r => { r.stats.duration = 0; },
  "missing passed case": r => { r.stats.expected = 13; },
  "extra skip": r => { r.stats.skipped = 8; },
  "unexpected failure": r => { r.stats.unexpected = 1; },
  "flaky result": r => { r.stats.flaky = 1; },
  "wrong spec": r => { r.suites[0].specs[0].file = "another.spec.ts"; },
  "non-ok spec": r => { r.suites[0].specs[0].ok = false; },
  "missing project case with forged totals": r => { r.suites[0].specs[0].tests.pop(); },
  "duplicate case with forged totals": r => { r.suites[0].specs[0].tests[1] = r.suites[0].specs[0].tests[0]; },
  "unknown case title": r => { r.suites[0].specs[0].title = "subset"; },
  "unknown project": r => { r.suites[0].specs[0].tests[0].projectName = "phone"; },
  "passed case newly skipped": r => { const t=r.suites[0].specs[0].tests[0];t.status="skipped";t.expectedStatus="skipped";t.results[0].status="skipped"; },
  "authored skip unexpectedly executed": r => { const t=r.suites[0].specs[0].tests[1];t.status="expected";t.expectedStatus="passed";t.results[0].status="passed"; },
  "expected failure exemption": r => { r.suites[0].specs[0].tests[0].expectedStatus = "failed"; },
  "retried pass": r => { r.suites[0].specs[0].tests[0].results[0].retry = 1; },
  "multiple attempts": r => { const t=r.suites[0].specs[0].tests[0];t.results.push({ ...t.results[0] }); },
  "missing attempt": r => { r.suites[0].specs[0].tests[0].results = []; },
  "failed result hidden by totals": r => { r.suites[0].specs[0].tests[0].results[0].status = "failed"; },
  "result errors": r => { r.suites[0].specs[0].tests[0].results[0].errors = [{ message: "failure" }]; },
  "result error field": r => { r.suites[0].specs[0].tests[0].results[0].error = { message: "failure" }; },
};
for (const [name, mutate] of Object.entries(mutations)) test("rejects " + name, () => {
  const value = report(); mutate(value); assert.throws(() => validateReport(value, startedAt));
});
const names = SHOTS.map(shot => shot.file);
const bytes = PNG.sync.write(new PNG({ width: 3, height: 2 }));
test("decodes all ten synthetic crops and keeps viewport separate from crop size", () => {
  const images = validateImages(() => bytes, names);
  assert.equal(images.length, 10);
  assert.deepEqual(images[0].viewport, VIEWPORTS.desktop);
  assert.equal(images[0].image.width, 3);
  assert.equal(images[0].image.height, 2);
});
test("rejects an incomplete crop packet", () => assert.throws(() => validateImages(() => bytes, names.slice(1))));
test("rejects an extra crop", () => assert.throws(() => validateImages(() => bytes, [...names, "extra.png"])));
test("rejects duplicate crop names", () => assert.throws(() => validateImages(() => bytes, [names[0], ...names.slice(0, -1)])));
test("rejects a path outside the packet", () => assert.throws(() => validateImages(() => bytes, ["../other.png", ...names.slice(1)])));
test("rejects a PNG header without complete image data", () => assert.throws(() => validateImages(() => bytes.subarray(0, 24), names)));
test("rejects a corrupt image CRC", () => {
  const bad=Buffer.from(bytes);bad[bad.length-1]^=1;
  assert.throws(() => validateImages(() => bad, names));
});
test("rejects a crop wider than its viewport", () => {
  const wide=PNG.sync.write(new PNG({ width: 1441, height: 2 }));
  assert.throws(() => validateImages(() => wide, names));
});

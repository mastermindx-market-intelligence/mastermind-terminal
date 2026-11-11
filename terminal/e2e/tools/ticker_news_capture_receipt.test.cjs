"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- synthetic Node evidence checks */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PNG } = require("pngjs");
const { TITLES, SHOTS, VIEWPORTS, validateReport, validateImages, validateFontWitnesses } = require("./ticker_news_capture_receipt.cjs");

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

const completedAt = "2026-11-11T00:05:00.000Z";
function cjkFixtures() {
  const font = { schema: "terminal.cjk-font-runtime.v1", receiptSha256: "a".repeat(64),
    resolvedFace: { family: "Fixture CJK", postScriptName: "FixtureCJK-Regular", charsetRanges: [[0x3002, 0x3002], [0x3400, 0x9fff]] } };
  const witnesses = Object.fromEntries(SHOTS.filter(shot => shot.lang === "zh").map(shot => {
    const text = shot.state === "live-feed" ? "新闻" : "新闻暂时不可用。";
    return [shot.file + ".json", { schema: "ticker-news.cjk-glyph-witness.v1", file: shot.file,
      fontReceiptSha256: font.receiptSha256, observedAt: "2026-11-11T00:02:00.000Z", text,
      bounds: { x: 1, y: 1, width: 100, height: 30 },
      fonts: [{ familyName: font.resolvedFace.family, postScriptName: font.resolvedFace.postScriptName,
        isCustomFont: false, glyphCount: [...text].length }] }];
  }));
  return { font, witnesses };
}
function checkCjk(value) {
  return validateFontWitnesses(file => Buffer.from(JSON.stringify(value.witnesses[file])),
    Object.keys(value.witnesses), value.font, startedAt, completedAt);
}
test("requires five distinct native-font witnesses for the five Chinese crops", () => {
  const result = checkCjk(cjkFixtures());
  assert.equal(result.length, 5);
  assert.ok(result.every(row => row.witnessFile === row.file + ".json" && /^[0-9a-f]{64}$/.test(row.sha256)));
});
const fontMutations = {
  "missing witness despite passing DOM assertions": v => { delete v.witnesses[Object.keys(v.witnesses)[0]]; },
  "extra witness": v => { v.witnesses["extra.json"] = {}; },
  "another capture receipt": v => { v.witnesses[Object.keys(v.witnesses)[0]].fontReceiptSha256 = "b".repeat(64); },
  "another crop identity": v => { v.witnesses[Object.keys(v.witnesses)[0]].file = "mobile-zh-dark.png"; },
  "old glyph observation": v => { v.witnesses[Object.keys(v.witnesses)[0]].observedAt = "2026-11-10T00:00:00Z"; },
  "future glyph observation": v => { v.witnesses[Object.keys(v.witnesses)[0]].observedAt = "2026-11-12T00:00:00Z"; },
  "Latin-only observation": v => { v.witnesses[Object.keys(v.witnesses)[0]].text = "News"; },
  "tofu fallback face": v => { v.witnesses[Object.keys(v.witnesses)[0]].fonts[0].familyName = "Last Resort"; },
  "different native face": v => { v.witnesses[Object.keys(v.witnesses)[0]].fonts[0].postScriptName = "OtherFace"; },
  "injected custom font": v => { v.witnesses[Object.keys(v.witnesses)[0]].fonts[0].isCustomFont = true; },
  "missing painted glyph": v => { v.witnesses[Object.keys(v.witnesses)[0]].fonts[0].glyphCount = 1; },
  "missing character coverage": v => { v.font.resolvedFace.charsetRanges = [[0x20, 0x7e]]; },
  "missing source punctuation": v => { v.witnesses["unavailable-desktop-zh-dark.png.json"].text = "新闻暂时不可用"; },
  "missing punctuation coverage": v => { v.font.resolvedFace.charsetRanges = [[0x3400, 0x9fff]]; },
  "unpainted status punctuation": v => { v.witnesses["unavailable-desktop-zh-dark.png.json"].fonts[0].glyphCount = 7; },
  "hidden node": v => { v.witnesses[Object.keys(v.witnesses)[0]].bounds.width = 0; },
  "offscreen node": v => { v.witnesses[Object.keys(v.witnesses)[0]].bounds.y = 10000; },
};
for (const [name, mutate] of Object.entries(fontMutations)) test("rejects " + name, () => {
  const value = cjkFixtures(); mutate(value); assert.throws(() => checkCjk(value));
});

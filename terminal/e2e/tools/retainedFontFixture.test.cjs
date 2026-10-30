"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const f = require("./retainedFontFixture.cjs");
const receipt = require("../fixtures/retained-fonts-34fb/receipt.json");
const files = receipt.families.flatMap(f => f.files);
test("retained13 buffers and CSS pass exact receipt hashes", () => { f.verify(); assert.equal(files.length, 13); });
test("fixture declaration owns mock path; unlabelled/unknown overrides refuse", () => {
  assert.throws(() => f.environment({ NEXT_FONT_GOOGLE_MOCKED_RESPONSES: "foreign" }), /FONT_FIXTURE_BINDING/);
  assert.throws(() => f.environment({ TERMINAL_EVIDENCE_FONTS: "foreign" }), /FONT_FIXTURE_BINDING/);
  assert.ok(f.environment({ TERMINAL_EVIDENCE_FONTS: f.ID, NEXT_FONT_GOOGLE_MOCKED_RESPONSES: "foreign" }).NEXT_FONT_GOOGLE_MOCKED_RESPONSES.endsWith("retained-fonts-34fb/responses.cjs"));
});
test("installed Next exact CSS and font-file test seams consume retained bytes with sockets forbidden", async () => {
  const old = process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES, connect = net.Socket.prototype.connect;
  process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = f.environment({ TERMINAL_EVIDENCE_FONTS: f.ID }).NEXT_FONT_GOOGLE_MOCKED_RESPONSES;
  net.Socket.prototype.connect = () => { throw new Error("NO_SOCKET_IN_OFFLINE_FONT_TEST"); };
  try {
    const { fetchCSSFromGoogleFonts } = require("next/dist/compiled/@next/font/dist/google/fetch-css-from-google-fonts");
    const { fetchFontFile } = require("next/dist/compiled/@next/font/dist/google/fetch-font-file");
    const { getGoogleFontsUrl } = require("next/dist/compiled/@next/font/dist/google/get-google-fonts-url");
    for (const family of receipt.families) {
      const url = getGoogleFontsUrl(family.family, { wght: [family.family === "Inter" ? "100..900" : "100..800"] }, "swap");
      const css = await fetchCSSFromGoogleFonts(url, family.family, true);
      const urls = [...css.matchAll(/src: url\((.*?)\)/g)].map(m => m[1]);
      assert.equal(urls.length, family.files.length);
      for (const url of urls) {
        assert.equal(path.isAbsolute(url), true);
        const bytes = await fetchFontFile(url, true);
        const row = family.files.find(row => row.file === path.basename(url));
        assert.equal(bytes.length, row.bytes); assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), row.sha256);
      }
    }
  } finally {
    net.Socket.prototype.connect = connect;
    if (old === undefined) delete process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES; else process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = old;
  }
});
function observation() { return { fixture: f.ID, responses: receipt.families.map(f => { const row = f.files.find(x => x.subset === "latin"); return { sha256: row.sha256, bytes: row.bytes }; }), loadedFaces: [{ family: "__Inter_abc", status: "loaded" }, { family: "__JetBrains_Mono_abc", status: "loaded" }], numeric: { present: true, fontFamily: "__Inter_abc, Arial" } }; }
test("actual response/load observation requires both faces plus numeric first family", () => {
  f.validate(observation());
  for (const alter of [x => x.responses.pop(), x => x.responses[0].sha256 = "a".repeat(64), x => x.loadedFaces[0].family += "_Fallback", x => x.loadedFaces[0].status = "loading", x => x.numeric.fontFamily = "Arial"]) {
    const x = observation(); alter(x); assert.throws(() => f.validate(x), /FONT_FIXTURE_BINDING/);
  }
});
test("actual PL6 writeCase statement forwards the font observation captured before pixels", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "capture_pl6_batch1.cjs"), "utf8");
  const statement = source.match(/const written = evidence\.writeCase\([^;]+;/)?.[0];
  assert.ok(statement);
  const marker = { fixture: f.ID, actualLoad: true }; let observation;
  require("node:vm").runInNewContext(statement, {
    evidence: { key: () => "case", writeCase: (_op, _spec, _png, obs) => { observation = obs; return {}; } },
    operation: {}, project: "desktop", title: "capture ChartChrome", lang: "en", width: 1440,
    surface: { name: "ChartChrome" }, VIEWPORTS: { 1440: { width: 1440, height: 900 } },
    immutablePng: Buffer.from("synthetic pixels"), immutableFonts: marker, observed: { lang: "en", theme: "dark" }, page: { viewportSize: () => ({ width: 1440, height: 900 }) },
  });
  assert.equal(observation.fonts, marker);
});
test("actual VI writeCase statement forwards the page's font witness", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "../visual-evidence-capture.spec.ts"), "utf8");
  const statement = source.match(/const result = evidence\.writeCase\([^;]+;/)?.[0];
  assert.ok(statement);
  const marker = { fixture: f.ID, actualLoad: true }; let observation;
  require("node:vm").runInNewContext(statement, {
    evidence: { writeCase: (_op, _spec, _png, obs) => { observation = obs; return {}; } },
    operation: {}, spec: {}, bytes: Buffer.from("synthetic pixels"), actual: { lang: "en", theme: "dark" }, fonts: marker,
    page: { viewportSize: () => ({ width: 1440, height: 900 }) },
  });
  assert.equal(observation.fonts, marker);
});

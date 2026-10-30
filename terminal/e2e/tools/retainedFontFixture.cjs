"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ID = "retained-fonts-34fb";
const root = path.resolve(__dirname, "../fixtures", ID);
const receipt = require(path.join(root, "receipt.json"));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const files = receipt.families.flatMap(f => f.files);
const tracked = new WeakMap();
function check(ok) { if (!ok) throw new Error("FONT_FIXTURE_BINDING"); }
function verify() {
  for (const row of files) { const bytes = fs.readFileSync(path.join(root, row.file)); check(bytes.length === row.bytes && digest(bytes) === row.sha256); }
  for (const family of receipt.families) check(digest(fs.readFileSync(path.join(root, family.localized_css))) === family.localized_css_sha256);
}
function environment(env) {
  if (env.TERMINAL_EVIDENCE_FONTS === undefined) { check(env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES === undefined); return env; }
  check(env.TERMINAL_EVIDENCE_FONTS === ID); verify();
  return { ...env, NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.join(root, "responses.cjs") };
}
function track(page) {
  const state = { pending: [], responses: [], failed: false }; tracked.set(page, state);
  page.on("response", response => {
    if (!/\.woff2(?:\?|$)/.test(response.url())) return;
    const pending = response.body().then(bytes => {
      const sha256 = digest(bytes); check(response.status() === 200 && files.some(f => f.sha256 === sha256));
      state.responses.push({ sha256, bytes: bytes.length });
    }).catch(() => { state.failed = true; });
    state.pending.push(pending);
  });
}
function validate(observation) {
  check(observation?.fixture === ID && Array.isArray(observation.responses) && Array.isArray(observation.loadedFaces));
  for (const f of observation.responses) check(files.some(row => row.sha256 === f.sha256 && row.bytes === f.bytes));
  for (const family of receipt.families) {
    const latin = family.files.find(f => f.subset === "latin");
    check(observation.responses.some(f => f.sha256 === latin.sha256));
    const name = family.family.toLowerCase().replaceAll(" ", "_");
    check(observation.loadedFaces.some(f => f.status === "loaded" && f.family.toLowerCase().replaceAll(" ", "_").includes(name) && !/fallback/i.test(f.family)));
  }
  check(observation.numeric && typeof observation.numeric.present === "boolean");
  if (observation.numeric.present) check(/inter/i.test(observation.numeric.fontFamily.split(",")[0]) && !/fallback/i.test(observation.numeric.fontFamily.split(",")[0]));
}
async function observe(page) {
  const state = tracked.get(page); check(state);
  const actual = await page.evaluate(async () => {
    const style = getComputedStyle(document.body);
    const families = [style.getPropertyValue("--font-inter"), style.getPropertyValue("--font-jetbrains-mono")].map(x => x.split(",")[0].trim());
    if (families.some(x => !x)) throw new Error("FONT_VARIABLE_ABSENT");
    for (const family of families) {
      const loaded = await document.fonts.load(`400 16px ${family}`, "0123456789Aa");
      if (!loaded.length || loaded.some(f => f.status !== "loaded")) throw new Error("FONT_LOAD_FAILED");
    }
    await document.fonts.ready;
    const numeric = [...document.querySelectorAll("body *")].find(el => {
      const s = getComputedStyle(el), box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && /[0-9]/.test(el.textContent || "") && s.fontVariantNumeric.includes("tabular-nums") && /inter/i.test(s.fontFamily.split(",")[0]);
    });
    return { loadedFaces: [...document.fonts].filter(f => f.status === "loaded").map(f => ({ family: f.family, status: f.status, weight: f.weight, style: f.style })), numeric: numeric ? { present: true, fontFamily: getComputedStyle(numeric).fontFamily, fontVariantNumeric: getComputedStyle(numeric).fontVariantNumeric } : { present: false } };
  });
  await Promise.all(state.pending); check(!state.failed);
  const observation = { fixture: ID, ...actual, responses: [...new Map(state.responses.map(r => [r.sha256, r])).values()].sort((a,b) => a.sha256.localeCompare(b.sha256)) };
  validate(observation); return observation;
}
module.exports = { ID, verify, environment, track, observe, validate };

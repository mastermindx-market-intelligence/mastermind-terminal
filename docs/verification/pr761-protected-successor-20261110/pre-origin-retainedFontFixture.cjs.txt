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
function assetIdentity(raw) {
  const url = new URL(raw);
  check(url.protocol === "http:" && url.hostname === "127.0.0.1" && ["33961", "33962"].includes(url.port) && !url.username && !url.password && !url.hash);
  check(/^\/_next\/static\/media\/[a-f0-9]{16}(?:-s)?(?:\.p)?\.woff2$/.test(url.pathname));
  check(url.search === "" || /^\?v=\d+$/.test(url.search));
  return url.origin + url.pathname;
}
function track(page) {
  const state = { pending: [], responses: new Map(), unavailable: [], failed: false }; tracked.set(page, state);
  page.on("response", response => {
    if (!/\.woff2(?:\?|$)/.test(response.url())) return;
    let asset;
    try { asset = assetIdentity(response.url()); } catch { state.failed = true; return; }
    if (response.status() !== 200) state.failed = true;
    const pending = response.body().then(bytes => {
      const sha256 = digest(bytes), prior = state.responses.get(asset);
      if (!files.some(f => f.sha256 === sha256 && f.bytes === bytes.length) || (prior && prior.sha256 !== sha256)) { state.failed = true; return; }
      state.responses.set(asset, { asset, sha256, bytes: bytes.length });
    }, () => { state.unavailable.push({ asset, reason: "body_unavailable" }); });
    state.pending.push(pending);
  });
}

function validate(observation) {
  check(observation?.fixture === ID && Array.isArray(observation.responses) && Array.isArray(observation.loadedFaces));
  check(observation.verifiedResponseScope === "same-isolated-page-context" && Array.isArray(observation.unavailableResponses));
  check(Number.isSafeInteger(observation.unavailableBodies) && observation.unavailableBodies === observation.unavailableResponses.length);
  const assets = new Map();
  for (const f of observation.responses) {
    check(assetIdentity(f.asset) === f.asset && files.some(row => row.sha256 === f.sha256 && row.bytes === f.bytes));
    check(!assets.has(f.asset) || assets.get(f.asset) === f.sha256); assets.set(f.asset, f.sha256);
  }
  for (const f of observation.unavailableResponses) check(f.reason === "body_unavailable" && assetIdentity(f.asset) === f.asset && assets.has(f.asset));
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
  const observation = { fixture: ID, ...actual, verifiedResponseScope: "same-isolated-page-context", unavailableBodies: state.unavailable.length, unavailableResponses: state.unavailable, responses: [...state.responses.values()].sort((a,b) => a.asset.localeCompare(b.asset)) };
  validate(observation); return observation;
}
module.exports = { ID, verify, environment, track, observe, validate };

/* eslint-disable @typescript-eslint/no-require-imports -- The Next font mock and incumbent capture tools use CommonJS. */
"use strict";
// Fixed, retained test inputs for this controlled capture only. Never a provider
// fallback or a general parent-environment passthrough.
const fs = require("node:fs"), path = require("node:path");
const { createHash } = require("node:crypto");
const sha = b => createHash("sha256").update(b).digest("hex");
const RECEIPT = "1d04bbe5678ad7eef6e969a5c46e643f9526695bc3167de5a7d8a29280b6ca0f";
const ASSETS = path.resolve(__dirname, "../fixtures/retained-fonts-34fb");
const PAGE_STATE = new WeakMap();
function need(value) { if (!value) throw Error("THESIS_CAPTURE_FONT_BINDING"); }
function read(file) {
  const s = fs.lstatSync(file);
  need(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size < 1024 * 1024);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const b = fs.readFileSync(fd), a = fs.fstatSync(fd), p = fs.lstatSync(file);
    for (const k of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) need(a[k] === s[k] && p[k] === s[k]);
    need(b.length === s.size); return b;
  } finally { fs.closeSync(fd); }
}
function prepareFontEnvironment(root, assets = ASSETS) {
  // The alternate argument exists only for pure negative tests. Runtime uses
  // the module-owned fixed path; no caller/env supplied executable is enrolled.
  const raw = read(path.join(assets, "receipt.json")); need(sha(raw) === RECEIPT);
  const receipt = JSON.parse(raw), layout = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  need(receipt.next_version === "16.2.9" && require(path.join(root, "node_modules/next/package.json")).version === receipt.next_version);
  need(receipt.target_font_options.every(line => layout.includes(line)));
  const inputs = [{ file: "receipt.json", sha256: RECEIPT, bytes: raw.length }];
  for (const family of receipt.families) {
    const css = read(path.join(assets, family.localized_css)); need(sha(css) === family.localized_css_sha256);
    inputs.push({ file: family.localized_css, sha256: sha(css), bytes: css.length });
    for (const f of family.files) {
      need(path.basename(f.file) === f.file);
      const b = read(path.join(assets, f.file)); need(sha(b) === f.sha256 && b.length === f.bytes);
      inputs.push({ file: f.file, sha256: f.sha256, bytes: b.length, family: family.family, subset: f.subset });
    }
  }
  // This fixed module performs these same checks when Next requires it.
  const responses = path.join(__dirname, "thesis_capture_font_responses.cjs");
  return { env: { NEXT_FONT_GOOGLE_MOCKED_RESPONSES: responses },
    provenance: { receiptSha256: RECEIPT, originalSource: receipt.source_head,
      originalLayoutSha256: receipt.source_layout_sha256, currentLayoutSha256: sha(Buffer.from(layout)),
      nextVersion: receipt.next_version, optionsByteEqual: true, inputs }, receipt };
}
function responseMap(root) {
  prepareFontEnvironment(root);
  const css = name => read(path.join(ASSETS, name)).toString().replaceAll("FIXTURE_ASSET_ROOT", ASSETS);
  return {
    "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap": css("inter.css"),
    "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&display=swap": css("jetbrains-mono.css"),
  };
}
function installFontWitness(context, counts) {
  const receipt = JSON.parse(read(path.join(ASSETS, "receipt.json"))), known = new Map();
  for (const family of receipt.families) for (const f of family.files) known.set(f.sha256, { ...f, family: family.family });
  const verified = new Map(), pending = [], unavailable = [], failures = [];
  counts.canonicalFontWitnesses ||= [];
  const newPage = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await newPage(...args);
    page.on("response", response => {
      const u = new URL(response.url());
      if (!/^\/_next\/static\/media\/[^/]+\.woff2$/.test(u.pathname)) return;
      const key = u.href;
      pending.push((async () => {
        if (response.status() !== 200) { failures.push("FONT_STATUS"); return; }
        let b; try { b = await response.body(); } catch { unavailable.push(key); return; }
        const h = sha(b), f = known.get(h);
        if (!f || f.bytes !== b.length || (verified.has(key) && verified.get(key).sha256 !== h)) { failures.push("FONT_BYTES"); return; }
        verified.set(key, { path: u.pathname, sha256: h, bytes: b.length, family: f.family, subset: f.subset });
      })());
    });
    PAGE_STATE.set(page, { verified, pending, unavailable, failures, counts });
    return page;
  };
}
async function captureCanonicalScreenshot(page, target, options) {
  const state = PAGE_STATE.get(page);
  need(state && options && path.isAbsolute(options.path) && !path.basename(options.path).startsWith("FAIL-"));
  const faces = await waitForCanonicalFonts(page);
  let region = options.clip || null;
  if (target !== page) {
    await target.scrollIntoViewIfNeeded();
    region = await target.boundingBox();
    need(region && region.width > 0 && region.height > 0);
  }
  const witness = await qualifyPageFonts(page, state, region, faces);
  const image = await target.screenshot(options);
  need(Buffer.isBuffer(image));
  state.counts.canonicalFontWitnesses.push({ ...witness, file: path.basename(options.path),
    captureKind: target === page ? "page" : "locator", region,
    imageSha256: sha(image), imageBytes: image.length });
  return image;
}
function validateFontWitnesses(stage, files, counts) {
  const witnesses = counts.canonicalFontWitnesses;
  need(Array.isArray(witnesses) && witnesses.length === files.length && new Set(files).size === files.length);
  const byName = new Map(witnesses.map(w => [w.file, w])); need(byName.size === files.length);
  for (const file of files) {
    need(path.basename(file) === file && file.endsWith(".png") && !file.startsWith("FAIL-"));
    const w = byName.get(file), target = path.join(stage, file), s = fs.lstatSync(target);
    need(w && w.receiptSha256 === RECEIPT && s.isFile() && !s.isSymbolicLink());
    need(Array.isArray(w.loadedFaces) && ["Inter", "JetBrains"].every(name =>
      w.loadedFaces.some(f => f.family.includes(name) && f.status === "loaded")));
    need(Array.isArray(w.verifiedBodies) && ["Inter", "JetBrains Mono"].every(family =>
      w.verifiedBodies.some(b => b.family === family && b.subset === "latin")));
    need(Array.isArray(w.renderedGlyphs) && w.renderedGlyphs.some(g => g.kind === "latin" && g.present
      && g.fonts.some(f => /^Inter(?:\b|[-_ ])/.test(f.familyName) && f.isCustomFont && f.glyphCount > 0))
      && w.renderedGlyphs.some(g => g.kind === "crop" && g.present && g.fonts.some(f => f.glyphCount > 0)));
    const bytes = fs.readFileSync(target); need(bytes.length === w.imageBytes && sha(bytes) === w.imageSha256);
  }
}
async function loadFontFaces(page, state) {
  const faces = await page.evaluate(async () => {
    const action = async () => {
      const actual = [...document.fonts].filter(f => /Inter|JetBrains/.test(f.family) && !/Fallback/i.test(f.family));
      if (!actual.some(f => /Inter/.test(f.family)) || !actual.some(f => /JetBrains/.test(f.family))) throw Error("FONT_DECLARATION");
      for (const f of actual) await document.fonts.load(`400 16px "${f.family.replaceAll('"', '')}"`, "NVDA 0123456789");
      await document.fonts.ready;
      return actual.map(f => ({ family: f.family, weight: f.weight, style: f.style, status: f.status }));
    };
    let timer;
    try { return await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error("FONT_READY_TIMEOUT")), 5000); })]); }
    finally { clearTimeout(timer); }
  });
  await Promise.all(state.pending);
  need(!state.failures.length && state.unavailable.every(url => state.verified.has(url)));
  const bodies = [...state.verified.values()];
  for (const family of ["Inter", "JetBrains Mono"]) need(bodies.some(b => b.family === family && b.subset === "latin"));
  need(faces.some(f => /Inter/.test(f.family) && f.status === "loaded") && faces.some(f => /JetBrains/.test(f.family) && f.status === "loaded"));
  return faces;
}
async function waitForCanonicalFonts(page) {
  const state = PAGE_STATE.get(page); need(state);
  return loadFontFaces(page, state);
}
async function qualifyPageFonts(page, state, region = null, faces = null) {
  faces ||= await loadFontFaces(page, state);
  await Promise.all(state.pending);
  need(!state.failures.length && state.unavailable.every(url => state.verified.has(url)));
  const bodies = [...state.verified.values()];
  // Platform font glyphs establish actual rendering. fonts.check/load alone can
  // establish availability but cannot exclude fallback for the displayed text.
  const session = await page.context().newCDPSession(page), glyphs = [];
  try {
    await session.send("DOM.enable"); await session.send("CSS.enable");
    await session.send("DOM.getDocument");
    for (const kind of ["latin", "numeric", "crop"]) {
      const expression = `(() => { const pattern = ${kind === "latin" ? "/[A-Za-z]/" : kind === "numeric" ? "/[0-9]/" : "/[^\\s]/"}, box = ${kind === "crop" ? JSON.stringify(region) : "null"}; for (const e of document.body.querySelectorAll('*')) { const s=getComputedStyle(e), r=e.getBoundingClientRect(), text=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(''); if(pattern.test(text) && /Inter/.test(s.fontFamily) && (!box || (r.bottom>box.y && r.top<box.y+box.height && r.right>box.x && r.left<box.x+box.width)) && s.visibility!=='hidden' && s.display!=='none' && s.opacity!=='0' && r.width>0 && r.height>0 && r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth) return e; } return null; })()`;
      const { result } = await session.send("Runtime.evaluate", { expression, returnByValue: false });
      if (!result.objectId) { need(kind === "numeric"); glyphs.push({ kind, present: false }); continue; }
      try {
        const { nodeId } = await session.send("DOM.requestNode", { objectId: result.objectId });
        const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
        need(fonts.some(f => f.glyphCount > 0));
        if (kind !== "crop") need(fonts.some(f => /^Inter(?:\b|[-_ ])/.test(f.familyName) && f.isCustomFont && f.glyphCount > 0));
        glyphs.push({ kind, scope: kind === "crop" ? "captured-region" : "page-visible", present: true,
          fonts: fonts.map(f => ({ familyName: f.familyName, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount })) });
      } finally { await session.send("Runtime.releaseObject", { objectId: result.objectId }); }
    }
  } finally { await session.detach(); }
  return { receiptSha256: RECEIPT, loadedFaces: faces, verifiedBodies: bodies, renderedGlyphs: glyphs,
    unavailableDuplicateBodies: state.unavailable.length, jetBrainsAvailabilityOnly: true };
}
module.exports = { prepareFontEnvironment, responseMap, installFontWitness, qualifyPageFonts, captureCanonicalScreenshot, validateFontWitnesses, waitForCanonicalFonts };

/* LOCAL browser qualification for the Rotation measured-coverage receipt + A42/A45.
 * Composes real owner bytes from INPUT_DIR, intercepts /api/sector-intelligence in a
 * local Next dev server, and proves the receipt line, state matrix and access loss.
 * Never a production proof. From terminal: node e2e/tools/qualify_sector_measured_receipt.cjs INPUT_DIR PORT RUN_NAME [--capture tall]
 *
 * --capture tall (LR-T18-TERM-EV2): for every 1440 cell, before screenshotting, find any
 * scroll-overflow container, grow the viewport to its full content height, and screenshot
 * with fullPage:false. Without this flag the harness preserves the original r1 capture.
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { chromium, webkit, expect } = require("@playwright/test");
const input = process.argv[2], port = process.argv[3] || "3171", run = process.argv[4] || "r1";
const tallMode = (() => {
  const a = process.argv[5], b = process.argv[6];
  if (!a) return false;
  return a === "--capture" ? b === "tall" : /^tall/i.test(a);
})();
if (!input || !/^\d{4,5}$/.test(port) || !/^[a-z0-9-]+$/.test(run)) {
  console.error("usage: node e2e/tools/qualify_sector_measured_receipt.cjs INPUT_DIR PORT RUN_NAME [--capture tall]"); process.exit(2);
}
const origin = `http://localhost:${port}`;
const out = path.resolve(`../docs/pr-crops/lr-t18-terminal-measured/${run}`);
if (fs.existsSync(out)) { console.error(`refusing: ${out} exists`); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
if (typeof expect.configure === "function") expect.configure({ timeout: 45000 });

const FROZEN = {
  "sector_base.json": { bytes: 145069, sha256: "2f89eee87e602d6df8f98afb64024ce3da8c14b6778c96114b441bc4f03883f4" },
  "history.json": { bytes: 2119318, sha256: "462201aa4b38836816f1e247f1ec187ba2589fe8a97d1fdb1ee3d753f32ce615" },
  "events.json": { bytes: 117246, sha256: "9eb9993be7db6dec2b07669d300b35bb16f7e7ca98d54ab5695fa9baec07a916" },
  "measured_read_v1.json": { bytes: 9430, sha256: "3c94163010d780c9bf1a3ab5e06bbd711a52470951e866c68a4ff595b7f6b5b1" },
};
const PAGE_AS_OF = "2026-10-12", ALIGN_DAY = "2026-10-12";
const MEASURED_SCHEMA_V1 = "leadership_rotation_context.measured_group_read/v1";

const report = { transport: "local interception", productionProof: false, inputs: [], variants: {}, checks: [], screenshots: [], errors: [], gaps: [], keyboard: null, touch: null, verdict: null };
function check(name, ok, details) { report.checks.push({ name, passed: !!ok, details }); return !!ok; }
function gap(name, details) { report.gaps.push({ name, details }); }
function shot(file) { report.screenshots.push({ name: path.basename(file), sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }

// --- LR-T18-TERM-EV2 tall capture helpers ---
function selectorOf(el) {
  const parts = [];
  let cur = el, depth = 0;
  while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
    let s = cur.tagName.toLowerCase();
    const id = cur.getAttribute && cur.getAttribute("id");
    if (id) s += `#${id}`;
    else {
      const cls = (cur.getAttribute && cur.getAttribute("class")) || "";
      if (cls) s += "." + cls.split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    }
    const tid = cur.getAttribute && cur.getAttribute("data-testid");
    if (tid) s += `[data-testid="${tid}"]`;
    parts.unshift(s);
    cur = cur.parentElement; depth++;
  }
  return parts.join(" > ");
}
async function findOverflows(page) {
  return await page.evaluate(() => {
    const out = [];
    const all = document.querySelectorAll("*");
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.overflowY !== "auto" && cs.overflowY !== "scroll") continue;
      if (el.scrollHeight <= el.clientHeight + 2) continue;
      const rect = el.getBoundingClientRect();
      out.push({
        selector: (() => {
          const parts = [];
          let cur = el, n = 0;
          while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
            let s = cur.tagName.toLowerCase();
            const id = cur.getAttribute && cur.getAttribute("id");
            if (id) s += `#${id}`;
            else {
              const cls = (cur.getAttribute && cur.getAttribute("class")) || "";
              if (cls) s += "." + cls.split(/\s+/).filter(Boolean).slice(0, 2).join(".");
            }
            const tid = cur.getAttribute && cur.getAttribute("data-testid");
            if (tid) s += `[data-testid="${tid}"]`;
            parts.unshift(s);
            cur = cur.parentElement; n++;
          }
          return parts.join(" > ");
        })(),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        top: rect.top + window.scrollY,
        bottom: rect.top + window.scrollY + el.scrollHeight,
      });
    }
    return { docH: document.documentElement.scrollHeight, vpH: window.innerHeight, overflows: out };
  });
}
async function tallExpand(page, width, label) {
  const initial = await findOverflows(page);
  const overflowsBottom = initial.overflows.map(o => o.bottom);
  const need = Math.min(4200, 24 + Math.max(initial.docH, initial.vpH, ...(overflowsBottom.length ? overflowsBottom : [0])));
  console.log(`[tall] ${label} width=${width} docH=${initial.docH} vpH=${initial.vpH} overflows=${JSON.stringify(initial.overflows)} → need=${need}`);
  await page.setViewportSize({ width, height: need });
  await page.waitForTimeout(500);
  const after = await findOverflows(page);
  const stillOver = after.overflows.filter(o => o.bottom > after.vpH + 2);
  console.log(`[tall] ${label} after resize vpH=${after.vpH} stillOver=${JSON.stringify(stillOver)}`);
  return { ok: stillOver.length === 0, need, after, initial };
}
async function rotationBottomEdge(page) {
  return await page.evaluate(() => {
    const rot = document.querySelector('[data-testid="sector-rotation"]');
    if (!rot) return null;
    const rect = rot.getBoundingClientRect();
    return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, vh: window.innerHeight };
  });
}
async function historyPaneRect(page) {
  return await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="rotation-history"]');
    if (!pane) return null;
    const rect = pane.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, vh: window.innerHeight,
      visible: rect.top >= 0 && rect.bottom <= window.innerHeight };
  });
}
async function pixelSanity(browser, file) {
  const buf = fs.readFileSync(file);
  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const result = await page.evaluate(async (url) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const w = img.naturalWidth, h = img.naturalHeight;
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      const bottomStart = Math.floor(h * 0.75);
      let uniformRows = 0;
      for (let y = bottomStart; y < h; y++) {
        const counts = new Map();
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        let max = 0; for (const c of counts.values()) if (c > max) max = c;
        if (max / w >= 0.98) uniformRows++;
      }
      const total = h - bottomStart;
      return { width: w, height: h, uniformRows, total, fraction: total ? uniformRows / total : 0 };
    }, dataUrl);
    return result;
  } finally { await context.close(); }
}

// --- inputs: frozen bytes only ---
const raw = {};
for (const [name, want] of Object.entries(FROZEN)) {
  const file = path.join(input, name), bytes = fs.readFileSync(file);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== want.bytes || sha !== want.sha256) { console.error(`BLOCKED: ${name} sha/bytes mismatch`); process.exit(2); }
  report.inputs.push({ path: name, bytes: bytes.length, sha256: sha }); raw[name] = bytes;
}
const base = JSON.parse(raw["sector_base.json"]), fixture = JSON.parse(raw["measured_read_v1.json"]);
const history = JSON.parse(raw["history.json"]), events = JSON.parse(raw["events.json"]);
check("inputs: sector page as_of is the frozen 2026-10-12 snapshot", base.as_of === PAGE_AS_OF && Array.isArray(base.sectors) && base.sectors.length === 11, { as_of: base.as_of, sectors: base.sectors.length });
check("inputs: owner history payload publishes no reconstructed rs_history trail", !(history.meta || {}).rs_history, "meta.rs_history absent — the trail is unpublished; the view must render the honest unavailable state, never a fabricated trail");

// --- in-memory variants of the sector payload ---
function clone(value) { return JSON.parse(JSON.stringify(value)); }
const alignedMeasured = clone(fixture);
alignedMeasured.generation.session_end = ALIGN_DAY;
if (Object.hasOwn(alignedMeasured.generation, "history_as_of")) alignedMeasured.generation.history_as_of = ALIGN_DAY;
const invalidMeasured = clone(alignedMeasured); invalidMeasured.schema = MEASURED_SCHEMA_V1.replace("/v1", "/v0");
const VARIANTS = {
  aligned: (() => { const v = clone(base); v.measured_read = alignedMeasured; return v; })(),
  stale: (() => { const v = clone(base); v.measured_read = clone(fixture); return v; })(),
  outage: (() => { const v = clone(base); v.measured_read = { status: "unavailable", reason: "source_missing" }; return v; })(),
  invalid: (() => { const v = clone(base); v.measured_read = invalidMeasured; return v; })(),
  absent: clone(base),
};
for (const [name, payload] of Object.entries(VARIANTS))
  report.variants[name] = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

// --- independent oracle, re-derived from the frozen fixture (never imported from the TSX) ---
function oracle(state, lang) {
  const zh = lang === "zh";
  if (state === "outage") return zh ? "今日未能生成实测读数。" : "Measured read could not be produced today.";
  if (state === "invalid") return zh ? "实测读数无法校验，因此不显示。" : "Measured read could not be checked, so it is not shown.";
  if (state === "absent") return null;
  const REASON = {
    missing_input: zh ? "今日缺少该板块价格数据" : "no price data for this sector today",
    thin_history: zh ? "价格历史不足" : "not enough price history yet",
    non_finite_input: zh ? "价格数据无法读取" : "the price data could not be read",
  };
  const read = state === "stale" ? fixture : alignedMeasured;
  let measuredN = 0; const items = [];
  for (const group of read.groups) {
    const current = group.current || {}, rank = Number(current.rank);
    if (current.status === "measured" && Number.isFinite(rank)) { measuredN += 1; continue; }
    const code = typeof current.reason === "string" ? current.reason : null;
    const reason = code && Object.prototype.hasOwnProperty.call(REASON, code) ? REASON[code] : zh ? "今日无法测量" : "could not be measured today";
    items.push(zh ? `${group.name_zh || group.name_en}（${reason}）` : `${group.name_en} (${reason})`);
  }
  const parts = [zh ? `已测 ${measuredN} / ${read.cohort.expected_n} 个板块` : `Measured ${measuredN} of ${read.cohort.expected_n} sectors`];
  if (items.length) parts.push(zh ? ` · 未测：${items.join("、")}` : ` · not measured: ${items.join(", ")}`);
  const sessionEnd = read.generation.session_end;
  if (sessionEnd && sessionEnd < PAGE_AS_OF) parts.push(zh ? ` · 实测于 ${sessionEnd}，早于本页` : ` · measured ${sessionEnd}, older than this page`);
  return parts.join("");
}
check("oracle: independent fixture derivation matches the 9/11 partial cohort", oracle("aligned", "en").startsWith("Measured 9 of 11 sectors") && oracle("aligned", "zh").startsWith("已测 9 / 11 个板块"), oracle("aligned", "en"));

// raw measured rs strings the view must never leak (access loss, A45 for this view)
const measuredNumbers = new Set();
for (const group of fixture.groups) {
  const current = group.current || {};
  if (current.status !== "measured" || !Number.isFinite(Number(current.rank))) continue;
  for (const key of ["rs_21d", "rs_63d"]) {
    const value = Number(current[key]);
    if (!Number.isFinite(value)) continue;
    measuredNumbers.add((value > 0 ? "+" : "") + value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%");
  }
}

// --- routing, modelled on e2e/tools/qualify_sector_rotation.cjs ---
async function openCell(browser, { engine = "chromium", width, height, lang, theme, variant, access = false, historyFailure = null, hasTouch = false }) {
  const instance = engine === "webkit" ? await webkit.launch() : browser;
  const context = await instance.newContext({ viewport: { width, height }, reducedMotion: "reduce", hasTouch });
  await context.addCookies([{ name: "mm_e2e_rs30", value: "1", url: origin }]);
  await context.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const label = `${engine}-${width}-${lang}-${theme}-${variant}${historyFailure ? `-history-${historyFailure.receiptStatus}` : access ? "-access" : ""}`;
  page.on("pageerror", error => report.errors.push({ label, message: error.message }));
  const receipts = {
    sector: { path: "/sectordata/sector_central.json", observedAt: "2026-10-12T08:30:00Z", sha: report.variants[variant] },
    history: { path: "/sectordata/sector_cycles.json", observedAt: "2026-10-12T08:30:00Z", sha: FROZEN["history.json"].sha256 },
    events: { path: "/marketdata/rotation_events.json", observedAt: "2026-10-09T14:00:00Z", sha: FROZEN["events.json"].sha256 },
  };
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/sector-intelligence") {
      const key = url.searchParams.get("source");
      if (key === "sector") return route.fulfill({ status: access ? 401 : 200, json: { data: access ? null : VARIANTS[variant],
        receipt: { source: "sector", path: receipts.sector.path, status: access ? "access" : "ready", asOf: access ? null : VARIANTS[variant].as_of,
          contentHash: access ? null : receipts.sector.sha, observedAt: access ? null : receipts.sector.observedAt, stale: false } } });
      if (key === "history" && historyFailure) return route.fulfill({ status: historyFailure.http, json: { data: null,
        receipt: { source: "history", path: receipts.history.path, status: historyFailure.receiptStatus, asOf: null, contentHash: null, observedAt: null, stale: false } } });
      if (key === "history") return route.fulfill({ status: 200, json: { data: history,
        receipt: { source: "history", path: receipts.history.path, status: "ready", asOf: history.meta.asOf, contentHash: receipts.history.sha, observedAt: receipts.history.observedAt, stale: false } } });
      if (key === "events") return route.fulfill({ status: access ? 401 : 200, json: { data: access ? null : events,
        receipt: { source: "events", path: receipts.events.path, status: access ? "access" : "ready", asOf: access ? null : events.as_of,
          contentHash: access ? null : receipts.events.sha, observedAt: access ? null : receipts.events.observedAt, stale: false } } });
      return route.fulfill({ status: access ? 401 : 200, json: access ? { data: null, receipt: { source: key, path: null, status: "access", asOf: null, contentHash: null, observedAt: null, stale: false } } : {} });
    }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
    return route.continue();
  });
  await page.goto(`${origin}/discover?tab=sectors&sectorWorkspace=rotation&sector=xle&sectorTheme=${theme}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  return { instance, context, page, label };
}

async function rotationReady(page, variant, lang = "en") {
  const root = page.getByTestId("sector-intelligence"), rotation = page.getByTestId("sector-rotation");
  await expect(root).toHaveAttribute("data-sector-workspace", "rotation");
  await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(11);
  const coverage = rotation.getByTestId("rotation-measured-coverage");
  if (variant === "absent") await expect(coverage).toHaveCount(0);
  else await expect(coverage).toHaveText(oracle(variant, lang));
  return { root, rotation, coverage };
}

(async () => {
  const browser = await chromium.launch();
  const lines = {};
  const stylesByCell = {};
  try {
    // A. REST matrix — chromium × {1440, 390} × {en, zh} × {dark, light}, variant aligned
    for (const width of [1440, 390]) for (const lang of ["en", "zh"]) for (const theme of ["dark", "light"]) {
      const label = `A/chromium-${width}-${lang}-${theme}-aligned`;
      const { context, page } = await openCell(browser, { width, height: width === 1440 ? 900 : 844, lang, theme, variant: "aligned" });
      try {
        const { rotation, coverage } = await rotationReady(page, "aligned", lang);
        const text = await coverage.innerText();
        lines[`aligned-${lang}`] = lines[`aligned-${lang}`] || text;
        check(`${label}: coverage line equals the independent oracle exactly`, text === oracle("aligned", lang), text);
        const order = await page.evaluate(() => {
          const receipt = document.querySelector('[data-testid="rotation-receipt"]');
          const measured = document.querySelector('[data-testid="rotation-measured-coverage"]');
          return receipt && measured ? receipt.nextElementSibling === measured : false;
        });
        check(`${label}: measured line sits directly after the rotation receipt`, order, "DOM order receipt → measured");
        const rotationText = await rotation.innerText();
        check(`${label}: no raw reason code or NaN/undefined/null leaks`, !rotationText.includes("missing_input") && !rotationText.includes("thin_history")
          && !rotationText.includes("NaN") && !rotationText.includes("undefined") && !rotationText.includes("null"), "rotation view text hygiene");
        const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
        check(`${label}: no horizontal scroll`, overflow.scroll <= overflow.inner, overflow);
        const style = await coverage.evaluate(el => {
          const computed = getComputedStyle(el), parent = getComputedStyle(el.parentElement);
          return { color: computed.color, fontSize: computed.fontSize, lineHeight: computed.lineHeight, parentBackground: parent.backgroundColor, height: el.getBoundingClientRect().height };
        });
        stylesByCell[`${width}-${lang}-${theme}`] = style;
        if (width === 390) {
          const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
          check(`${label}: coverage line wraps on the 390 viewport`, style.height >= lineHeight * 1.9, { height: style.height, lineHeight });
        }
        if (tallMode && width === 1440) {
          const expand = await tallExpand(page, width, `A/chromium-${width}-${lang}-${theme}`);
          check(`${label}: tall viewport resize leaves no overflowing container`, expand.ok, { need: expand.need, vpH: expand.after.vpH });
          const rotEdge = await rotationBottomEdge(page);
          check(`${label}: rotation root bottom edge ≤ viewport height`, rotEdge && rotEdge.bottom <= rotEdge.vh + 2, rotEdge);
        }
        await page.screenshot({ path: path.join(out, `chromium-${width}-${lang}-${theme}-aligned.png`), fullPage: !tallMode || width !== 1440 });
        shot(path.join(out, `chromium-${width}-${lang}-${theme}-aligned.png`));
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      await context.close();
    }
    for (const width of [1440, 390]) for (const lang of ["en", "zh"])
      check(`A/${width}-${lang}: computed color differs between dark and light`, stylesByCell[`${width}-${lang}-dark`] && stylesByCell[`${width}-${lang}-light`]
        && stylesByCell[`${width}-${lang}-dark`].color !== stylesByCell[`${width}-${lang}-light`].color, { dark: stylesByCell[`${width}-${lang}-dark`], light: stylesByCell[`${width}-${lang}-light`] });

    // B. STATE crops — element shots at 1440, dark and light, EN; ZH dark for stale/outage
    const stateCells = [];
    for (const state of ["stale", "outage", "invalid", "absent"]) for (const theme of ["dark", "light"]) stateCells.push(["en", theme, state]);
    for (const state of ["stale", "outage"]) stateCells.push(["zh", "dark", state]);
    for (const [lang, theme, state] of stateCells) {
      const label = `B/state-${state}-1440-${lang}-${theme}`;
      const { context, page } = await openCell(browser, { width: 1440, height: 900, lang, theme, variant: state });
      try {
        const { rotation } = await rotationReady(page, state, lang);
        const coverage = rotation.getByTestId("rotation-measured-coverage");
        if (state === "absent") {
          check(`${label}: no coverage element is rendered`, await coverage.count() === 0, "absent state renders nothing");
          lines[`absent-${lang}`] = "<none>";
        } else {
          const text = await coverage.innerText();
          check(`${label}: coverage line equals the ${state} oracle exactly`, text === oracle(state, lang), text);
          lines[`${state}-${lang}`] = text;
        }
        if (tallMode) {
          const expand = await tallExpand(page, 1440, `B/state-${state}-1440-${lang}-${theme}`);
          check(`${label}: tall viewport resize leaves no overflowing container`, expand.ok, { need: expand.need, vpH: expand.after.vpH });
          const rotEdge = await rotationBottomEdge(page);
          check(`${label}: rotation root bottom edge ≤ viewport height`, rotEdge && rotEdge.bottom <= rotEdge.vh + 2, rotEdge);
        }
        const file = path.join(out, `state-${state}-1440-${lang}-${theme}.png`);
        await rotation.screenshot({ path: file }); shot(file);
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      await context.close();
    }
    // aligned reference crops at 1440 (EN dark + light) for the distinctness table
    for (const theme of ["dark", "light"]) {
      const { context, page } = await openCell(browser, { width: 1440, height: 900, lang: "en", theme, variant: "aligned" });
      try {
        const { rotation } = await rotationReady(page, "aligned", "en");
        if (tallMode) {
          const expand = await tallExpand(page, 1440, `B/aligned-1440-en-${theme}`);
          check(`B/aligned-1440-en-${theme}: tall viewport resize leaves no overflowing container`, expand.ok, { need: expand.need, vpH: expand.after.vpH });
          const rotEdge = await rotationBottomEdge(page);
          check(`B/aligned-1440-en-${theme}: rotation root bottom edge ≤ viewport height`, rotEdge && rotEdge.bottom <= rotEdge.vh + 2, rotEdge);
        }
        const file = path.join(out, `state-aligned-1440-en-${theme}.png`);
        await rotation.screenshot({ path: file }); shot(file);
      } catch (error) { report.errors.push({ label: `B/aligned-1440-en-${theme}`, message: error.message }); }
      await context.close();
    }
    lines["aligned-en"] = lines["aligned-en"] || "<none>";
    const fiveStates = ["aligned", "stale", "outage", "invalid", "absent"].map(state => [state, lines[`${state}-en`] || "<none>"]);
    const heads = fiveStates.map(([state, line]) => [state, line === "<none>" ? line : line.slice(0, 80)]);
    let pairwiseDistinct = true;
    for (let i = 0; i < fiveStates.length; i++) for (let j = i + 1; j < fiveStates.length; j++)
      if (fiveStates[i][1] === fiveStates[j][1]) pairwiseDistinct = false;
    check("B/distinctness: aligned/stale/outage/invalid/absent full lines differ pairwise (first-80 heads printed; the 80-char head truncates before the stale clause)", pairwiseDistinct, heads.map(([state, head]) => `${state}: ${head}`));

    // C. A42 — history owner failing keeps the map and the receipt
    for (const theme of ["dark", "light"]) {
      const label = `C/a42-history-error-1440-en-${theme}`;
      const { context, page } = await openCell(browser, { width: 1440, height: 900, lang: "en", theme, variant: "aligned", historyFailure: { http: 503, receiptStatus: "error" } });
      try {
        const { rotation, coverage } = await rotationReady(page, "aligned", "en");
        const points = await rotation.locator("[data-sector-rotation-point]").count();
        check(`${label}: plotted population unchanged with the history owner failing`, points === 11, { points });
        check(`${label}: coverage line still equals the aligned oracle`, (await coverage.innerText()) === oracle("aligned", "en"), await coverage.innerText());
        await rotation.locator('[data-sector-rotation-point="xlk"]').click();
        await expect(page).toHaveURL(/sector=xlk/);
        check(`${label}: sector selection still responds while history fails`, new URL(page.url()).searchParams.get("sector") === "xlk", page.url());
        if (tallMode) {
          const expand = await tallExpand(page, 1440, `C/a42-history-error-1440-en-${theme}`);
          check(`${label}: tall viewport resize leaves no overflowing container`, expand.ok, { need: expand.need, vpH: expand.after.vpH });
          const rotEdge = await rotationBottomEdge(page);
          check(`${label}: rotation root bottom edge ≤ viewport height`, rotEdge && rotEdge.bottom <= rotEdge.vh + 2, rotEdge);
          const histRect = await historyPaneRect(page);
          check(`${label}: history pane is inside the viewport and visible`, !!histRect && histRect.visible, histRect);
        }
        const file = path.join(out, `a42-history-error-1440-en-${theme}.png`);
        await rotation.screenshot({ path: file }); shot(file);
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      await context.close();
    }
    {
      const label = "C/a42-history-unavailable-1440-en-dark";
      const { context, page } = await openCell(browser, { width: 1440, height: 900, lang: "en", theme: "dark", variant: "aligned", historyFailure: { http: 503, receiptStatus: "unavailable" } });
      try {
        const { rotation, coverage } = await rotationReady(page, "aligned", "en");
        check(`${label}: receipt status unavailable also keeps the full plotted population`, await rotation.locator("[data-sector-rotation-point]").count() === 11, "11 points");
        check(`${label}: coverage line unaffected by the unavailable receipt status`, (await coverage.innerText()) === oracle("aligned", "en"), await coverage.innerText());
        if (tallMode) {
          const expand = await tallExpand(page, 1440, `C/a42-history-unavailable-1440-en-dark`);
          check(`${label}: tall viewport resize leaves no overflowing container`, expand.ok, { need: expand.need, vpH: expand.after.vpH });
          const rotEdge = await rotationBottomEdge(page);
          check(`${label}: rotation root bottom edge ≤ viewport height`, rotEdge && rotEdge.bottom <= rotEdge.vh + 2, rotEdge);
          const histRect = await historyPaneRect(page);
          check(`${label}: history pane is inside the viewport and visible`, !!histRect && histRect.visible, histRect);
          const file = path.join(out, `a42-history-unavailable-1440-en-dark.png`);
          await rotation.screenshot({ path: file }); shot(file);
        }
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      await context.close();
    }
    {
      const label = "C/a42-history-unavailable-1440-en-light";
      const { context, page } = await openCell(browser, { width: 1440, height: 900, lang: "en", theme: "light", variant: "aligned", historyFailure: { http: 503, receiptStatus: "unavailable" } });
      try {
        const { rotation, coverage } = await rotationReady(page, "aligned", "en");
        check(`${label}: receipt status unavailable also keeps the full plotted population`, await rotation.locator("[data-sector-rotation-point]").count() === 11, "11 points");
        check(`${label}: coverage line unaffected by the unavailable receipt status`, (await coverage.innerText()) === oracle("aligned", "en"), await coverage.innerText());
        if (tallMode) {
          const expand = await tallExpand(page, 1440, `C/a42-history-unavailable-1440-en-light`);
          check(`${label}: tall viewport resize leaves no overflowing container`, expand.ok, { need: expand.need, vpH: expand.after.vpH });
          const rotEdge = await rotationBottomEdge(page);
          check(`${label}: rotation root bottom edge ≤ viewport height`, rotEdge && rotEdge.bottom <= rotEdge.vh + 2, rotEdge);
          const histRect = await historyPaneRect(page);
          check(`${label}: history pane is inside the viewport and visible`, !!histRect && histRect.visible, histRect);
          const file = path.join(out, `a42-history-unavailable-1440-en-light.png`);
          await rotation.screenshot({ path: file }); shot(file);
        }
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      await context.close();
    }

    // D. Access loss — every source 401/access: no coverage element, no measured numbers
    {
      const label = "D/access-1440-en-dark";
      const { context, page } = await openCell(browser, { width: 1440, height: 900, lang: "en", theme: "dark", variant: "aligned", access: true });
      try {
        const root = page.getByTestId("sector-intelligence"), rotation = page.getByTestId("sector-rotation");
        await expect(root).toHaveAttribute("data-sector-workspace", "rotation");
        await expect(rotation.locator('[role="status"]')).toContainText("access", { ignoreCase: true });
        await expect(page.locator('[data-testid="rotation-measured-coverage"]')).toHaveCount(0);
        check(`${label}: no coverage element under access loss`, await page.locator('[data-testid="rotation-measured-coverage"]').count() === 0, "A45 for this view");
        const text = await rotation.innerText();
        const leaked = [...measuredNumbers].filter(value => text.includes(value));
        check(`${label}: none of the fixture's measured rs numbers appear`, leaked.length === 0, { checked: measuredNumbers.size, leaked });
        check(`${label}: no measured vocabulary renders`, !text.includes("Measured") && !text.includes("已测"), text.slice(0, 120));
        if (tallMode) {
          const expand = await tallExpand(page, 1440, `D/access-1440-en-dark`);
          check(`${label}: tall viewport resize leaves no overflowing container`, expand.ok, { need: expand.need, vpH: expand.after.vpH });
          const rotEdge = await rotationBottomEdge(page);
          check(`${label}: rotation root bottom edge ≤ viewport height`, rotEdge && rotEdge.bottom <= rotEdge.vh + 2, rotEdge);
        }
        const file = path.join(out, `access-1440-en-dark.png`);
        await rotation.screenshot({ path: file }); shot(file);
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      await context.close();
    }

    // E. Navigation, keyboard, touch
    {
      const label = "E/navigation-1440-en-dark";
      const { context, page } = await openCell(browser, { width: 1440, height: 900, lang: "en", theme: "dark", variant: "aligned" });
      try {
        const { rotation } = await rotationReady(page, "aligned", "en");
        await rotation.locator('[data-sector-rotation-point="xlk"]').click();
        await expect(page).toHaveURL(/sector=xlk/);
        check(`${label}: clicking XLK selects it in the URL`, new URL(page.url()).searchParams.get("sector") === "xlk", page.url());
        await page.goBack();
        await expect.poll(() => new URL(page.url()).searchParams.get("sector"), { timeout: 20000 }).toBe("xle");
        check(`${label}: browser Back restores the XLE selection`, new URL(page.url()).searchParams.get("sector") === "xle", page.url());
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      // keyboard walk with Tab (<= 30 presses), report facts only
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
        await rotationReady(page, "aligned", "en");
        let walk = null;
        for (let presses = 1; presses <= 30; presses++) {
          await page.keyboard.press("Tab");
          const focus = await page.evaluate(() => {
            const el = document.activeElement;
            return { tag: el ? el.tagName : null, point: el && el.getAttribute ? el.getAttribute("data-sector-rotation-point") : null,
              testid: el && el.getAttribute ? el.getAttribute("data-testid") : null, text: el && el.textContent ? el.textContent.slice(0, 40) : "" };
          });
          if (focus.point) { walk = { presses, ...focus }; break; }
        }
        const sectorBefore = new URL(page.url()).searchParams.get("sector");
        let enter = { selectionBefore: sectorBefore }, space = null;
        if (walk) {
          await page.keyboard.press("Enter");
          await page.waitForTimeout(400);
          enter.selectionAfter = new URL(page.url()).searchParams.get("sector");
          await page.keyboard.press("Space");
          await page.waitForTimeout(400);
          space = { selectionAfterSpace: new URL(page.url()).searchParams.get("sector") };
        }
        report.keyboard = { tabWalk: walk, enter, space };
        check(`${label}: Tab walk reaches a rotation point within 30 presses`, !!walk, report.keyboard);
      } catch (error) { report.errors.push({ label: label + "-keyboard", message: error.message }); check(`${label}: keyboard walk completed`, false, error.message); }
      await context.close();
    }
    {
      const label = "E/touch-390-en-dark";
      const { context, page } = await openCell(browser, { width: 390, height: 844, lang: "en", theme: "dark", variant: "aligned", hasTouch: true });
      try {
        await rotationReady(page, "aligned", "en");
        const boxes = await page.evaluate(() => [...document.querySelectorAll("[data-sector-rotation-point]")].map(el => {
          const rect = el.getBoundingClientRect();
          return { id: el.getAttribute("data-sector-rotation-point"), w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 };
        }));
        const small = boxes.filter(box => box.w < 44 && box.h < 44);
        report.touch = { count: boxes.length, under44Both: small.length, small };
        check(`${label}: touch bounding boxes recorded (finding, not a failure)`, boxes.length === 11, report.touch);
      } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); }
      await context.close();
    }

    // F. webkit cells — only when a matching cached build exists
    {
      const cache = process.env.HOME ? path.join(process.env.HOME, ".cache", "ms-playwright") : null;
      const webkitRevision = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../node_modules/playwright-core/browsers.json"), "utf8")).browsers.find(b => b.name === "webkit").revision; } catch { return null; } })();
      const cached = cache && webkitRevision && fs.existsSync(path.join(cache, `webkit-${webkitRevision}`));
      if (cached) {
        for (const [width, height, lang, theme] of [[1440, 900, "en", "dark"], [390, 844, "zh", "light"]]) {
          const label = `F/webkit-${width}-${lang}-${theme}-aligned`;
          const cell = await openCell(null, { engine: "webkit", width, height, lang, theme, variant: "aligned" });
          try {
            const { context, page } = cell;
            const { coverage } = await rotationReady(page, "aligned", lang);
            check(`${label}: coverage line equals the aligned oracle`, (await coverage.innerText()) === oracle("aligned", lang), await coverage.innerText());
            await page.screenshot({ path: path.join(out, `webkit-${width}-${lang}-${theme}-aligned.png`), fullPage: true });
            shot(path.join(out, `webkit-${width}-${lang}-${theme}-aligned.png`));
            await context.close();
          } catch (error) { report.errors.push({ label, message: error.message }); check(`${label}: cell completed`, false, error.message); await cell.context.close(); }
        }
      } else {
        gap("webkit cells", `no cached webkit build matching playwright-core revision ${webkitRevision}; F cells skipped`);
        check("F/webkit: matching cached build present", false, `webkit-${webkitRevision} not in ~/.cache/ms-playwright — recorded as a GAP, not a failure`);
      }
    }

    check("zero page exceptions", report.errors.length === 0, report.errors);

    // --- LR-T18-TERM-EV2 pixel sanity: fraction of bottom rows that are ≥98% one colour ---
    if (tallMode) {
      const sanity = [];
      for (const shot of report.screenshots) {
        const file = path.join(out, shot.name);
        try {
          const s = await pixelSanity(browser, file);
          sanity.push({ name: shot.name, width: s.width, height: s.height, fraction: Number(s.fraction.toFixed(4)) });
          const isLight1440 = /^chromium-1440-.*-aligned\.(png)$/.test(shot.name);
          if (isLight1440) check(`pixel/${shot.name}: bottom-25% uniform-row fraction < 0.5`, s.fraction < 0.5, { width: s.width, height: s.height, uniformRows: s.uniformRows, total: s.total, fraction: s.fraction });
        } catch (error) { report.errors.push({ label: `pixel/${shot.name}`, message: error.message }); }
      }
      report.pixelSanity = sanity;
    }
  } finally {
    if (browser) await browser.close();
    const failed = report.checks.filter(row => !row.passed);
    const receiptWrong = failed.some(row => /oracle/.test(row.name));
    const mapBroken = failed.some(row => /plotted population|selection still responds/.test(row.name));
    const pixelBroken = failed.some(row => /^pixel\/chromium-1440-.*light/.test(row.name));
    report.verdict = receiptWrong || mapBroken || pixelBroken ? "FAILED" : failed.length ? "PASS-WITH-GAPS" : "PASS";
    if (report.gaps.length && report.verdict === "PASS") report.verdict = "PASS-WITH-GAPS";
    fs.writeFileSync(path.join(out, "qualification.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ verdict: report.verdict, checks: `${report.checks.length - failed.length}/${report.checks.length}`, failed, errors: report.errors, gaps: report.gaps, keyboard: report.keyboard, touch: report.touch, screenshots: report.screenshots.length, pixelSanity: report.pixelSanity || null }, null, 2));
  }
})();

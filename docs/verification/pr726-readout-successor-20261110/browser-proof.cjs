const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { createRequire } = require("node:module");
const p = __dirname, w = path.resolve(p, "../../.."), t = path.join(w, "terminal");
const { chromium } = createRequire(path.join(t, "package.json"))("@playwright/test");
const out = path.join(p, "browser"), pub = path.join(out, "public");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const build = JSON.parse(fs.readFileSync(path.join(out, "build.json"), "utf8"));
assert.equal(build.state, "BUILT");
const snapshot = () => Object.fromEntries(Object.keys(build.sourceFiles).map(f => [f, hash(fs.readFileSync(path.join(w, f)))]));
assert.deepEqual(snapshot(), build.sourceFiles);
const receipt = { schema: "terminal_pr726_component_browser.v1", state: "RUNNING", startedAt: new Date().toISOString(), matrices: [], screenshots: [], sourceBefore: snapshot(), retries: 0 };
const save = () => fs.writeFileSync(path.join(out, "browser-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
assert(!fs.existsSync(path.join(out, "browser-receipt.json")));
save();
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  const file = path.resolve(pub, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end("Not found"); return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  response.end(fs.readFileSync(file));
});
let browser;
const viewports = [{ name: "desktop", width: 1440, height: 900 }, { name: "tablet", width: 820, height: 1180 }, { name: "mobile", width: 390, height: 844 }];
const availability = { ready: "ready", "opposite-headline": "ready", empty: "unavailable", malformed: "unavailable", metadata: "unavailable", partial: "partial", "zero-false": "ready", stale: "ready", "long-headline": "ready" };
const titles = { en: "Wait for confluence", zh: "等待共振" };
(async () => {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  receipt.port = server.address().port;
  browser = await chromium.launch({ headless: true });
  receipt.browserVersion = browser.version();
  for (const viewport of viewports) for (const lang of ["en", "zh"]) for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce", locale: lang === "zh" ? "zh-CN" : "en-US" });
    const page = await context.newPage(), errors = [], failedHttp = [], failedRequests = [];
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(String(error)));
    page.on("response", response => { if (response.status() >= 400) failedHttp.push({ url: response.url(), status: response.status() }); });
    page.on("requestfailed", request => failedRequests.push({ url: request.url(), failure: request.failure() }));
    const prefix = viewport.name + "-" + lang + "-" + theme;
    try {
      await page.goto("http://127.0.0.1:" + receipt.port + "/?lang=" + lang + "&theme=" + theme, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__precisionProof && document.querySelectorAll("[data-case]").length === 9);
      await page.evaluate(async () => { await document.fonts.load("12px Inter", "0123456789"); await document.fonts.ready; });
      const appearance = await page.evaluate(() => ({
        panel: getComputedStyle(document.documentElement).getPropertyValue("--panel-2").trim(),
        background: getComputedStyle(document.body).backgroundColor,
        font: getComputedStyle(document.querySelector("[data-testid='precision-bottom-confidence'] span:last-child")).fontFamily,
        interLoaded: document.fonts.check("12px Inter", "0123456789"),
        fontStatus: document.fonts.status, scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      }));
      assert.equal(appearance.panel, theme === "light" ? "#eef1f6" : "#15171d");
      assert(appearance.interLoaded && appearance.fontStatus === "loaded" && appearance.font.includes("Inter"));
      assert(appearance.scrollWidth <= viewport.width);
      const cases = [];
      for (const [key, expected] of Object.entries(availability)) {
        const strip = page.locator("[data-case='" + key + "'] [data-testid='precision-entry-strip']");
        assert.equal(await strip.getAttribute("data-precision-availability"), expected);
        assert.equal(await strip.getAttribute("data-precision-freshness"), key === "stale" ? "stale" : "current");
        const text = await strip.textContent(), posture = strip.locator("[data-testid='precision-posture']");
        assert(!text.includes("await_confluence") && !text.includes("T3"));
        if (["opposite-headline", "empty", "malformed", "metadata", "zero-false"].includes(key)) assert.equal(await posture.count(), 0);
        if (key === "opposite-headline") assert(!text.includes(titles[lang === "en" ? "zh" : "en"]));
        if (["ready", "stale"].includes(key)) assert((await posture.textContent()).includes(titles[lang]));
        if (key === "partial") assert((await posture.textContent()).includes(lang === "en" ? "Wait for a cleaner setup" : "等待更清晰的形态"));
        const badge = strip.locator("[data-testid='precision-data-state']");
        if (expected === "unavailable") {
          assert.equal(await badge.getAttribute("data-precision-data"), "unavailable");
          assert.equal(await badge.textContent(), lang === "en" ? "Intel unavailable" : "智能数据不可用");
        } else if (key === "partial") {
          assert.equal(await badge.getAttribute("data-precision-data"), "partial");
          assert.equal(await badge.textContent(), lang === "en" ? "Partial data" : "数据不完整");
        } else if (key === "stale") {
          assert.equal(await badge.getAttribute("data-precision-data"), "stale");
          assert((await badge.textContent()).includes("2026-11-10"));
        } else assert.equal(await badge.count(), 0);
        if (key === "zero-false") {
          assert((await strip.locator("[data-testid='precision-bottom-confidence']").textContent()).includes("0"));
          assert((await strip.locator("[data-testid='precision-htf']").textContent()).includes(lang === "en" ? "Not confirmed" : "未确认"));
          assert((await strip.locator("[data-testid='precision-trigger']").textContent()).includes(lang === "en" ? "Crossing" : "正在交叉"));
          assert((await strip.locator("[data-testid='precision-w2']").textContent()).includes(lang === "en" ? "Stoch D 0" : "随机指标 D 0"));
        }
        const geometry = await strip.evaluate(element => {
          const r = element.getBoundingClientRect(), s = getComputedStyle(element);
          const spans = [...element.querySelectorAll("span")].map(span => {
            const b = span.getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, height: b.height, text: span.textContent, size: getComputedStyle(span).fontSize };
          });
          return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, overflowX: s.overflowX, whiteSpace: s.whiteSpace, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, spans };
        });
        assert(geometry.x >= 0 && geometry.x + geometry.width <= viewport.width + 1);
        assert(geometry.height >= 32 && ["auto", "scroll"].includes(geometry.overflowX) && geometry.whiteSpace === "nowrap");
        assert(geometry.spans.every(span => span.height > 0 && span.top >= geometry.y - 1 && span.bottom <= geometry.bottom + 1));
        cases.push({ key, availability: expected, geometry });
      }
      async function capture(suffix) {
        const filename = prefix + "-" + suffix + ".png", file = path.join(out, filename);
        await page.screenshot({ path: file, fullPage: true });
        const data = fs.readFileSync(file);
        receipt.screenshots.push({ path: filename, bytes: data.length, sha256: hash(data) });
      }
      await capture("initial");
      const scrollResults = await page.locator("[data-testid='precision-entry-strip']").evaluateAll(elements => elements.map(element => {
        element.scrollLeft = element.scrollWidth;
        const r = element.getBoundingClientRect(), last = element.lastElementChild.getBoundingClientRect();
        return { key: element.closest("[data-case]").dataset.case, scrollLeft: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth, lastLeft: last.left, lastRight: last.right, left: r.left, right: r.right };
      }));
      assert(scrollResults.every(x => x.lastLeft >= x.left - 1 && x.lastRight <= x.right + 1));
      assert(scrollResults.find(x => x.key === "long-headline").scrollLeft > 0);
      if (viewport.name !== "desktop") assert(scrollResults.find(x => x.key === "ready").scrollLeft > 0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await capture("scrolled");
      await page.evaluate(lang => {
        const data = structuredClone(window.__precisionProof.base);
        data.analysis.entry[lang === "en" ? "headline" : "headline_zh"] = "";
        window.__precisionProof.setReady(data);
      }, lang);
      await page.waitForFunction(() => !document.querySelector("[data-case='ready'] [data-testid='precision-posture']"));
      assert.equal(await page.locator("[data-case='ready'] [data-testid='precision-entry-strip']").getAttribute("data-precision-availability"), "ready");
      await page.evaluate(() => window.__precisionProof.setReady(structuredClone(window.__precisionProof.base)));
      await page.waitForFunction(expected => document.querySelector("[data-case='ready'] [data-testid='precision-posture']")?.textContent.includes(expected), titles[lang]);
      const other = lang === "en" ? "zh" : "en";
      await page.evaluate(other => window.__precisionProof.setLang(other), other);
      await page.waitForFunction(expected => document.querySelector("[data-case='ready'] [data-testid='precision-posture']")?.textContent.includes(expected), titles[other]);
      assert(!(await page.locator("[data-case='ready']").textContent()).includes(titles[lang]));
      assert.deepEqual(errors, []); assert.deepEqual(failedHttp, []); assert.deepEqual(failedRequests, []);
      receipt.matrices.push({ viewport, lang, theme, state: "PASS", states: cases.length, cases, transitions: ["selected-headline-omitted", "selected-headline-restored", "language-changed"], appearance, scrollResults, pageErrors: errors, failedHttp, failedRequests });
      save();
      console.log(JSON.stringify({ matrix: prefix, state: "PASS", states: cases.length, transitions: 3, images: 2 }));
    } finally { await context.close(); }
  }
  assert.equal(receipt.matrices.length, 12); assert.equal(receipt.screenshots.length, 24);
  receipt.state = "BROWSER_MATRICES_PASSED";
})().catch(error => {
  receipt.state = "BROWSER_PROOF_FAILED";
  receipt.failure = { name: error.name, message: error.message, code: error.code || null, stack: error.stack };
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  if (browser) { await browser.close(); receipt.browserClosed = !browser.isConnected(); }
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  receipt.serverClosed = !server.listening;
  receipt.sourceAfter = snapshot(); receipt.sourceStable = JSON.stringify(receipt.sourceBefore) === JSON.stringify(receipt.sourceAfter);
  receipt.finishedAt = new Date().toISOString();
  if (!receipt.sourceStable || !receipt.serverClosed || (browser && !receipt.browserClosed)) { receipt.state = "CLOSURE_OR_SOURCE_FAILURE"; process.exitCode = 1; }
  save();
  console.log(JSON.stringify({ state: receipt.state, matrices: receipt.matrices.length, states: receipt.matrices.reduce((n, x) => n + x.states, 0), transitions: receipt.matrices.reduce((n, x) => n + x.transitions.length, 0), images: receipt.screenshots.length, sourceStable: receipt.sourceStable, browserClosed: receipt.browserClosed, serverClosed: receipt.serverClosed }));
});

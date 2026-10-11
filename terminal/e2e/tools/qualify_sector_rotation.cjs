/* Exact public-owner snapshot proof for the Sector Central rotation vertical.
 * Does not migrate or waive the separately held historical responsive fixtures.
 * From terminal: node e2e/tools/qualify_sector_rotation.cjs INPUT_DIR PORT RUN_NAME
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
const input = process.argv[2], port = process.argv[3] || "3157", run = process.argv[4] || "initial";
assert(input && /^\d{4,5}$/.test(port) && /^[a-z0-9-]+$/.test(run));
const origin = `http://localhost:${port}`, out = path.resolve(`../docs/pr-crops/sector-rotation-20260927/${run}`);
assert(!fs.existsSync(out), "Retain earlier proof runs"); fs.mkdirSync(out, { recursive: true });
const provenance = JSON.parse(fs.readFileSync(path.join(input, "provenance.json"), "utf8"));
const bytes = fs.readFileSync(path.join(input, "sector.json")), source = JSON.parse(bytes);
const historyBytes = fs.readFileSync(path.join(input, "history.json")), history = JSON.parse(historyBytes);
const eventsBytes = fs.readFileSync(path.join(input, "events.json")), events = JSON.parse(eventsBytes);
assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), provenance.files.sector.sha256);
assert.equal(crypto.createHash("sha256").update(historyBytes).digest("hex"), provenance.files.history.sha256);
assert.equal(crypto.createHash("sha256").update(eventsBytes).digest("hex"), provenance.files.events.sha256);
assert.equal(events.schema, "rotation_events.v1");
assert.equal(events.authority?.may_rank, false);
assert.equal(history.meta?.rs_history?.schema, "sector_cycles.rs_history.v1");
assert.equal(history.meta?.rs_history?.mode, "reconstructed_price_history");
assert.equal(history.meta?.rs_history?.naturally_observed, false);
const report = { sourceRevision: provenance.ref, sourcePath: provenance.source, sourceSha256: provenance.files.sector.sha256,
  historyRevision: provenance.historyRef, historyPath: provenance.historySource, historySha256: provenance.files.history.sha256,
  eventRevision: provenance.eventRef, eventPath: provenance.eventSource, eventSha256: provenance.files.events.sha256,
  sourceBodiesChanged: false, transport: "local interception", productionProof: false, independentDesignAcceptance: false,
  checks: [], screenshots: [], errors: [] };
function check(name, ok, details) { report.checks.push({ name, passed: !!ok, details }); assert(ok, name); }
async function shot(page, name) { const file = path.join(out, name + ".png"); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push({ name: name + ".png", sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }
function shortDate(day, lang) {
 const m = String(day || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return "";
 const month = Number(m[2]), date = Number(m[3]), months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
 return lang === "zh" ? `${month}月${date}日` : `${months[month - 1]} ${date}`;
}
const cases = [["chromium",1440,900,"en","light"],["chromium",820,1180,"en","dark"],["chromium",390,844,"en","light"],["webkit",1440,900,"en","dark"],["webkit",390,844,"zh","light"]];
let browser;
(async () => {
 for (const [engine, width, height, lang, theme] of cases) {
  browser = await ({ chromium, webkit }[engine]).launch();
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  await context.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  const page = await context.newPage(), label = `${engine}-${width}-${lang}-${theme}`;
  page.on("pageerror", error => report.errors.push({ label, message: error.message }));
  let access = true;
  await page.route("**/*", route => {
   const url = new URL(route.request().url());
   if (url.origin !== origin) return route.abort();
   if (url.pathname === "/api/sector-intelligence") {
    const key = url.searchParams.get("source");
    if (key === "sector") return route.fulfill({ status: access ? 200 : 401, json: { data: access ? source : null,
      receipt: { source: "sector", path: "/sectordata/sector_central.json", status: access ? "ready" : "access",
        asOf: access ? source.as_of : null, contentHash: access ? provenance.files.sector.sha256 : null,
        observedAt: access ? "2026-10-05T08:30:00Z" : null, stale: false } } });
    if (key === "history") return route.fulfill({ status: access ? 200 : 401, json: { data: access ? history : null,
      receipt: { source: "history", path: "/sectordata/sector_cycles.json", status: access ? "ready" : "access",
        asOf: access ? history.meta.asOf : null, contentHash: access ? provenance.files.history.sha256 : null,
        observedAt: access ? "2026-10-05T08:30:00Z" : null, stale: false } } });
    if (key === "events") return route.fulfill({ status: access ? 200 : 401, json: { data: access ? events : null,
      receipt: { source: "events", path: "/marketdata/rotation_events.json", status: access ? "ready" : "access",
        asOf: access ? events.as_of : null, contentHash: access ? provenance.files.events.sha256 : null,
        observedAt: access ? "2026-10-09T14:00:00Z" : null, stale: false } } });
    return route.fulfill({ status: 401, json: { data: null, receipt: { source: key, path: null, status: "access", asOf: null, contentHash: null, observedAt: null, stale: false } } });
   }
   if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
   return route.continue();
  });
  const start = `${origin}/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}`;
  await page.goto(start, { waitUntil: "domcontentloaded", timeout: 60000 });
  const root = page.getByTestId("sector-intelligence"), rotation = page.getByTestId("sector-rotation");
  await expect(root).toHaveAttribute("data-sector-workspace", "rotation");
  const complete = source.sectors.filter(row => Number.isFinite(row.momentum?.rs_21d) && Number.isFinite(row.momentum?.rs_63d));
  await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(complete.length);
  check(label + ": exact sector population plotted", complete.length === 11);
  const receipt = await rotation.getByTestId("rotation-receipt").innerText();
  check(label + ": compact dated receipt", receipt === `${shortDate(source.as_of, lang)} · ${lang === "zh" ? "11个板块" : "11 sectors"}`, receipt);
  const positiveBoth = complete.filter(row => row.momentum.rs_21d > 0 && row.momentum.rs_63d > 0);
  const strongestQuarter = complete.reduce((best, row) => row.momentum.rs_63d > best.momentum.rs_63d ? row : best);
  const localName = row => lang === "zh" ? row.name_zh || row.name : row.name;
  const answer = await rotation.getByTestId("rotation-answer").innerText();
  check(label + ": answer is derived from the owner coordinates", positiveBoth.length === 1 && answer.includes(localName(positiveBoth[0])) && answer.includes(localName(strongestQuarter)), answer);
  const workspaceNav = root.getByRole("navigation", { name: lang === "zh" ? "板块工作区视图" : "Sector workspace views", exact: true });
  await expect(workspaceNav.getByRole("button")).toHaveCount(3);
  check(label + ": only three outer jobs", await workspaceNav.getByRole("button", { name: lang === "zh" ? "板块研究" : "Sector research", exact: true }).count() === 0);
  const tech = source.sectors.find(row => row.id === "xlk"), techPoint = rotation.locator('[data-sector-rotation-point="xlk"]');
  const techLabel = await techPoint.getAttribute("aria-label");
  check(label + ": exact 21-session coordinate", techLabel.includes(`+${tech.momentum.rs_21d.toFixed(1)}%`), techLabel);
  check(label + ": exact 63-session coordinate", techLabel.includes(`+${tech.momentum.rs_63d.toFixed(1)}%`), techLabel);
  const inspector = rotation.getByTestId("rotation-inspector"), inspectorText = await inspector.innerText();
  check(label + ": selected source record", inspectorText.includes(`+${tech.heat.heat_1M.toFixed(2)}%`) && inspectorText.includes(`${tech.heat.breadth_pct}%`), inspectorText);
  check(label + ": tactical state is separately labeled", inspectorText.toLocaleLowerCase("en-US").includes((lang === "zh" ? "战术状态" : "Tactical state").toLocaleLowerCase("en-US")), inspectorText);
  const method = rotation.locator("[data-rotation-method]"), methodSummary = method.locator("summary");
  await methodSummary.click();
  const methodText = await method.innerText();
  check(label + ": history is explicitly reconstructed, never presented as observed", methodText.includes(lang === "zh" ? "由板块/SPY历史价格重建" : "Reconstructed from sector/SPY price history"), methodText);
  await methodSummary.click();
  const historical = rotation.getByTestId("rotation-history");
  await expect(historical).toBeVisible();
  const historyText = await historical.innerText();
  check(label + ": historical owner date is visible", historyText.includes(shortDate(history.meta.asOf, lang)), historyText);
  check(label + ": reconstructed provenance is visible at point of use", historyText.includes(lang === "zh" ? "并非Mastermind当时实时观察的记录" : "not a record of what Mastermind observed then"), historyText);
  const native = rotation.getByTestId("rotation-native-episodes");
  await expect(native).toBeVisible();
  const nativeText = await native.innerText();
  const lastNativeClosed = events.closed_recent.filter(row => row.sector === "xlk").at(-1);
  check(label + ": native RC closure remains separately sourced and provenance-bounded",
    nativeText.includes(lang === "zh" ? "轮动命令原生已结束交棒事件" : "Native RC closed episodes")
    && nativeText.includes(lang === "zh" ? "并非历史当时可知的信号" : "not an as-known historical signal")
    && nativeText.includes(lang === "zh" ? lastNativeClosed.to_name_zh : lastNativeClosed.to_name_en)
    && nativeText.includes(shortDate(lastNativeClosed.closed_asof, lang)));
  check(label + ": native source date and actual freshness are faithfully represented",
    nativeText.includes(shortDate(events.as_of, lang))
    && (events.as_of < source.as_of
      ? nativeText.includes(lang === "zh" ? "早于当前板块中心快照" : "older than the current Sector Central snapshot")
      : !nativeText.includes(lang === "zh" ? "早于当前板块中心快照" : "older than the current Sector Central snapshot")));
  const nativeHistory = history.sectors.find(row => row.id === "xlk");
  const selectedHistory = nativeHistory.rs_history;
  const evidence = rotation.getByTestId("rotation-cycle-evidence");
  await expect(evidence).toBeVisible();
  const cycleText = await evidence.innerText();
  check(label + ": native price-cycle markers remain explicitly retrospective",
    cycleText.includes(lang === "zh" ? "回溯重建的价格周期转折" : "Retrospective price-cycle turns")
    && cycleText.includes(lang === "zh" ? "并非资金轮动交棒事件" : "not a migration episode or a live-time confirmation"));
  const newestNativeTurn = nativeHistory.turns.at(-1);
  check(label + ": latest native owner swing is date-bound and visible",
    newestNativeTurn && cycleText.includes(shortDate(newestNativeTurn.date, lang)));
  const sourceDotBefore = await techPoint.getAttribute("style");
  const trail = rotation.getByTestId("rotation-history-trail");
  await expect(trail).toBeVisible();
  check(label + ": history trail is bound to the selected source date",
    await trail.getAttribute("data-selected-date") === selectedHistory.at(-1).date);
  check(label + ": history trail uses at most 21 source sessions without an invented point",
    (await trail.locator("polyline").getAttribute("points")).split(" ").length === Math.min(21, selectedHistory.length));
  const historySlider = historical.getByRole("slider", { name: lang === "zh" ? "历史日期" : "Historical date" });
  await historySlider.fill("0");
  const firstHistory = await historical.innerText();
  check(label + ": future owner swings disappear from the selected historical view",
    newestNativeTurn && newestNativeTurn.date > selectedHistory[0].date
      ? !(await evidence.innerText()).includes(shortDate(newestNativeTurn.date, lang)) : true);
  check(label + ": historical trail follows the selected date",
    await trail.getAttribute("data-selected-date") === selectedHistory[0].date
    && (await trail.locator("polyline").getAttribute("points")).split(" ").length === 1);
  check(label + ": date navigation does not move live sector coordinates",
    await techPoint.getAttribute("style") === sourceDotBefore);
  check(label + ": history date navigation reaches the first retained point", firstHistory.includes(shortDate(selectedHistory[0].date, lang)), firstHistory);
  check(label + ": historical coordinate is source-exact", firstHistory.includes((selectedHistory[0].rs_21d >= 0 ? "+" : "") + selectedHistory[0].rs_21d.toFixed(1) + "%")
    && firstHistory.includes((selectedHistory[0].rs_63d >= 0 ? "+" : "") + selectedHistory[0].rs_63d.toFixed(1) + "%"), firstHistory);
  const filter = rotation.locator("[data-rotation-filter]"); await filter.locator("summary").click();
  const priorStyle = await techPoint.getAttribute("style"), search = rotation.getByRole("searchbox");
  await search.fill(lang === "zh" ? "科技" : "tech"); await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(1);
  check(label + ": display filter preserves coordinates", await techPoint.getAttribute("style") === priorStyle);
  await rotation.getByRole("button", { name: lang === "zh" ? "清除搜索" : "Clear search", exact: true }).click();
  if (await filter.evaluate(node => node.open)) await filter.locator("summary").click();
  await rotation.getByRole("button", { name: lang === "zh" ? "列表" : "List", exact: true }).click();
  await expect(rotation.locator("[data-sector-rotation-row]")).toHaveCount(source.sectors.length);
  check(label + ": list shares the exact source population", new URL(page.url()).searchParams.get("sectorRotationMode") === "list");
  await rotation.locator('[data-sector-rotation-row="xle"]').click(); await expect(page).toHaveURL(/sector=xle/);
  check(label + ": native source empty-sector view does not fabricate an all clear",
    (await native.innerText()).includes(lang === "zh" ? "没有此板块的已结束交棒事件" : "No closed episodes for this sector"));
  check(label + ": selection remains one URL-bound object", (await inspector.innerText()).includes(lang === "zh" ? "能源" : "Energy"));
  const detailReturn = page.url();
  await rotation.getByRole("button", { name: new RegExp(lang === "zh" ? "打开板块研究" : "Open sector research") }).click();
  await expect(root).toHaveAttribute("data-sector-workspace", "detail");
  check(label + ": research opens without a fabricated group join", new URL(page.url()).searchParams.get("sector") === "xle" && new URL(page.url()).searchParams.get("group") === "");
  const depthReturn = root.getByTestId("sector-detail-return");
  check(label + ": detail exposes an explicit return path", (await depthReturn.innerText()).includes(lang === "zh" ? "返回轮动" : "Back to Rotation"));
  await depthReturn.click(); await expect(page).toHaveURL(detailReturn); await expect(root).toHaveAttribute("data-sector-workspace", "rotation");
  await expect(rotation.locator('[data-sector-rotation-row="xle"]')).toHaveAttribute("aria-pressed", "true");
  check(label + ": explicit return restores rotation selection and list mode", true);
  await rotation.getByRole("button", { name: new RegExp(lang === "zh" ? "打开板块研究" : "Open sector research") }).click();
  await expect(root).toHaveAttribute("data-sector-workspace", "detail"); await page.goBack();
  await expect(root).toHaveAttribute("data-sector-workspace", "rotation"); await expect(rotation.locator('[data-sector-rotation-row="xle"]')).toHaveAttribute("aria-pressed", "true");
  check(label + ": browser Back also restores rotation state", true);
  await rotation.getByRole("button", { name: lang === "zh" ? "图表" : "Map", exact: true }).click();
  const first = rotation.locator('[data-sector-rotation-point="xlk"]');
  const currentIndex = complete.findIndex(row => row.id === "xlk");
  check(label + ": keyboard anchor belongs to the observed plotted population", currentIndex >= 0);
  const nextSourceId = complete[(currentIndex + 1) % complete.length].id;
  await first.focus(); await page.keyboard.press("ArrowRight");
  await expect.poll(() => new URL(page.url()).searchParams.get("sector")).toBe(nextSourceId);
  await expect(rotation.locator(`[data-sector-rotation-point="${nextSourceId}"]`)).toBeFocused();
  check(label + ": keyboard navigation advances exact source order", true, nextSourceId);
  const sourceButton = rotation.getByRole("button", { name: new RegExp(lang === "zh" ? "查看来源" : "Review sources") });
  await sourceButton.click(); const dialog = page.getByRole("dialog", { name: lang === "zh" ? "来源" : "Sources", exact: true });
  await expect(dialog).toBeVisible(); check(label + ": Sources belongs to rotation", (await dialog.innerText()).includes(lang === "zh" ? "轮动" : "Rotation"));
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  const dims = await root.evaluate(el => ({ inner: el.scrollWidth - el.clientWidth, document: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(label + ": no horizontal overflow", dims.inner <= 1 && dims.document <= 1, dims);
  await root.evaluate(el => { el.scrollTop = 0; }); await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, label + "-rotation");
  access = false; await root.getByRole("button", { name: lang === "zh" ? "刷新" : "Refresh", exact: true }).click();
  await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(0);
  check(label + ": access loss removes retained rotation coordinates", !(await rotation.innerText()).includes("+6.5%"));
  await context.close(); await browser.close(); browser = null;
 }
 check("zero page exceptions", report.errors.length === 0, report.errors); report.passed = true;
})().catch(error => { report.passed = false; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
 if (browser) await browser.close(); fs.writeFileSync(path.join(out, "qualification.json"), JSON.stringify(report, null, 2) + "\n");
 console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(row => !row.passed), errors: report.errors, error: report.error, screenshots: report.screenshots.length }, null, 2));
});

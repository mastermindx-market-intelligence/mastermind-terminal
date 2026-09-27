/* Exact-owner proof for Discover -> selected-sector Company Heatmap.
 * Uses the incumbent sector + S&P-500 heatmap bodies through local interception.
 * It does not admit the separately rights-held Finviz theme/bubble plane or prove production transport.
 * From terminal: node e2e/tools/qualify_sector_heatmap.cjs INPUT_DIR PORT RUN_NAME
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
const input = process.argv[2], port = process.argv[3] || "3157", run = process.argv[4] || "initial";
assert(input && /^\d{4,5}$/.test(port) && /^[a-z0-9-]+$/.test(run));
const origin = `http://127.0.0.1:${port}`, out = path.resolve(`../docs/pr-crops/sector-heatmap-20260927/${run}`);
assert(!fs.existsSync(out), "Retain earlier proof runs"); fs.mkdirSync(out, { recursive: true });
const provenance = JSON.parse(fs.readFileSync(path.join(input, "provenance.json"), "utf8")), data = {};
for (const [key, entry] of Object.entries(provenance.files)) {
 const bytes = fs.readFileSync(path.join(input, key + ".json"));
 assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), entry.sha256);
 data[key] = JSON.parse(bytes);
}
const paths = { sector: "/sectordata/sector_central.json", heatmap: "/marketdata/sp500_heatmap.json",
 confluence: "/marketdata/subsector_confluence.json", themes: "/neuralwebdata/theme_state.json" };
const report = { sourceRevision: provenance.ref, sourceBodiesChanged: false, transport: "local interception",
 productionProof: false, independentReviewRequired: false, themeRightsAdmitted: false, checks: [], screenshots: [], errors: [] };
function check(name, ok, details) { report.checks.push({ name, passed: !!ok, details }); assert(ok, name); }
async function shot(page, name) { const file = path.join(out, name + ".png"); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push({ name: name + ".png", sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }
const capBand = size => size >= 200e9 ? "mega" : size >= 50e9 ? "large" : size >= 10e9 ? "mid" : "smaller";
const technology = data.heatmap.tiles.filter(row => row.sector === "Technology");
const separateInformationTechnology = data.heatmap.tiles.filter(row => row.sector === "Information Technology");
assert.equal(data.heatmap.size_basis, "marketcap"); assert.equal(technology.length, 79); assert.equal(separateInformationTechnology.length, 1);
const valuesFor = timeframe => technology.map(row => row.perf?.[timeframe]).filter(Number.isFinite);
const domainFor = timeframe => Math.max(1, Math.ceil(Math.max(...valuesFor(timeframe).map(Math.abs), 0) * 10) / 10);
const domain1d = domainFor("1D"), target = [...technology].sort((a,b) => b.size-a.size)[0];
const targetIndustry = target.industry, targetIndustryCount = technology.filter(row => row.industry === targetIndustry).length;
const targetBand = capBand(target.size), targetBandCount = technology.filter(row => capBand(row.size) === targetBand).length;
const totalCap = technology.reduce((sum,row) => sum + row.size, 0), industries = new Map();
for (const row of technology) {
 const current = industries.get(row.industry) || { industry: row.industry, size: 0, observed: 0, advancing: 0, order: industries.size };
 current.size += row.size;
 const value = row.perf?.["1D"];
 if (Number.isFinite(value)) { current.observed += 1; current.advancing += value > 0 ? 1 : 0; }
 industries.set(row.industry, current);
}
const industryRows = [...industries.values()], largestIndustry = [...industryRows].sort((a,b)=>b.size-a.size || a.order-b.order)[0];
const observedIndustries = industryRows.filter(row => row.observed > 0), broadestIndustry = [...observedIndustries].sort((a,b)=>b.advancing/b.observed-a.advancing/a.observed || b.observed-a.observed || a.order-b.order)[0];
const largestShare = Math.round(largestIndustry.size/totalCap*100);
const cases = [["chromium",1440,900,"en","light"],["chromium",820,1180,"en","dark"],["chromium",390,844,"en","light"],["webkit",1440,900,"en","dark"],["webkit",390,844,"zh","light"]];
let browser;
(async () => {
 for (const [engine,width,height,lang,theme] of cases) {
  browser = await ({ chromium, webkit }[engine]).launch();
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  await context.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  const page = await context.newPage(), label = `${engine}-${width}-${lang}-${theme}`;
  page.on("pageerror", error => report.errors.push({ label, message: error.message }));
  let access = true;
  await page.route("**/*", route => {
   const url = new URL(route.request().url()); if (url.origin !== origin) return route.abort();
   if (url.pathname === "/api/sector-intelligence") {
    const key = url.searchParams.get("source"), entry = provenance.files[key];
    if (!access) return route.fulfill({ status: 401, json: { data: null, receipt: { source: key, path: paths[key] || "", status: "access", asOf: null, observedAt: null, contentHash: null, stale: false } } });
    if (!entry) return route.fulfill({ status: 404, json: { data: null, receipt: { source: key, path: paths[key] || "", status: "unavailable", asOf: null, observedAt: null, contentHash: null, stale: false } } });
    return route.fulfill({ status: 200, json: { data: data[key], receipt: { source: key, path: entry.path.replace(/^site/, ""), status: "ready", asOf: entry.asOf, observedAt: "2026-09-27T11:00:00Z", contentHash: entry.sha256, stale: false } } });
   }
   if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
   return route.continue();
  });
  const start = `${origin}/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=heatmap&sector=xlk&sectorMatrixTimeframe=1D&sectorTheme=${theme}`;
  await page.goto(start, { waitUntil: "domcontentloaded", timeout: 60000 });
  const root = page.getByTestId("sector-intelligence"), discovery = page.getByTestId("sector-discovery"), heatmap = page.getByTestId("sector-company-heatmap");
  await expect(root).toHaveAttribute("data-sector-workspace", "discover"); await expect(heatmap).toBeVisible();
  await expect(heatmap.locator("[data-company-heatmap-tile]")).toHaveCount(technology.length, { timeout: 15000 });
  const heatmapText = await heatmap.innerText();
  check(label + ": exact Technology population", lang === "zh" ? /79\s*家公司/.test(heatmapText) : /79\s+names/.test(heatmapText), heatmapText);
  check(label + ": exact source date", heatmapText.includes("2026-09-25"));
  check(label + ": distinct Information Technology row excluded", technology.length === 79 && separateInformationTechnology.length === 1);
  const initialDomain = Number(await heatmap.getAttribute("data-domain"));
  check(label + ": full-population fixed domain", initialDomain === domain1d, { expected:domain1d, actual:initialDomain });
  const answer = await heatmap.getByTestId("heatmap-answer").innerText();
  check(label + ": answer names the cap owner and breadth leader", answer.includes(largestIndustry.industry) && answer.includes(broadestIndustry.industry) && answer.includes(String(largestShare)), answer);
  const inspector = heatmap.getByTestId("heatmap-inspector");
  await expect(inspector).toContainText(target.t); check(label + ": default inspector is the largest company", (await inspector.innerText()).includes(target.name));
  const mapDisclosure = heatmap.getByTestId("heatmap-map-disclosure"), map = heatmap.getByTestId("heatmap-map");
  if (width <= 760) {
   check(label + ": mobile serves selected insight before mechanics", !(await mapDisclosure.evaluate(el => el.open)) && await inspector.isVisible());
   await mapDisclosure.locator("summary").click(); await expect(map).toBeVisible();
  } else {
   await expect(map).toBeVisible();
  }
  const targetTile = heatmap.locator(`[data-company-heatmap-tile="${target.t}"]`);
  await targetTile.click(); await expect(page).toHaveURL(new RegExp(`sectorCompany=${encodeURIComponent(target.t)}`));
  check(label + ": exact company selection stays URL-bound", new URL(page.url()).searchParams.get("sectorCompany") === target.t);
  await expect(inspector).toContainText(target.t); await expect(inspector.locator(`a[href="/analysis?symbol=${encodeURIComponent(target.t)}&page=overview"]`)).toHaveCount(1);
  const selects = heatmap.getByRole("combobox"), industrySelect = selects.nth(2), bandSelect = selects.nth(3);
  await industrySelect.selectOption(targetIndustry); await expect(heatmap.locator("[data-company-heatmap-tile]")).toHaveCount(targetIndustryCount);
  check(label + ": industry filter never rescales color", Number(await heatmap.getAttribute("data-domain")) === domain1d);
  await industrySelect.selectOption(""); await bandSelect.selectOption(targetBand); await expect(heatmap.locator("[data-company-heatmap-tile]")).toHaveCount(targetBandCount);
  check(label + ": cap filter is exact and URL-bound", new URL(page.url()).searchParams.get("sectorMatrixBand") === targetBand);
  check(label + ": cap filter never rescales color", Number(await heatmap.getAttribute("data-domain")) === domain1d);
  await bandSelect.selectOption("");
  const timeframe = selects.nth(1); await timeframe.selectOption("1M");
  check(label + ": timeframe is durable URL state", new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  const rep = discovery.getByRole("group", { name: lang === "zh" ? "发现视图" : "Discover representation", exact: true });
  await rep.getByRole("button", { name: lang === "zh" ? "表格" : "Table", exact: true }).click(); await expect(heatmap).toHaveCount(0);
  check(label + ": Table remains the same Discover job", new URL(page.url()).searchParams.get("sectorWorkspace") === "discover");
  await rep.getByRole("button", { name: lang === "zh" ? "热图" : "Heatmap", exact: true }).click(); await expect(page.getByTestId("sector-company-heatmap")).toBeVisible();
  check(label + ": Heatmap restores selected sector, company and timeframe", new URL(page.url()).searchParams.get("sector") === "xlk" && new URL(page.url()).searchParams.get("sectorCompany") === target.t && new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  const returnUrl = page.url(), heatmapAgain = page.getByTestId("sector-company-heatmap");
  const openSector = heatmapAgain.getByTestId("heatmap-inspector").getByRole("button", { name: new RegExp(lang === "zh" ? "打开板块情报" : "Open sector intelligence") });
  await openSector.click(); await expect(root).toHaveAttribute("data-sector-workspace", "detail");
  const returnButton = root.getByTestId("sector-detail-return"); check(label + ": detail has explicit Discover return", (await returnButton.innerText()).includes(lang === "zh" ? "返回发现" : "Back to Discover"));
  const expectedReturn = new URL(returnUrl), expectedState = JSON.stringify([...expectedReturn.searchParams.entries()].sort());
  await returnButton.click(); await expect(root).toHaveAttribute("data-sector-workspace", "discover");
  await expect.poll(() => { const current = new URL(page.url()); return current.pathname + JSON.stringify([...current.searchParams.entries()].sort()); })
    .toBe(expectedReturn.pathname + expectedState);
  check(label + ": explicit return restores Heatmap context", new URL(page.url()).searchParams.get("sectorDiscoveryMode") === "heatmap" && new URL(page.url()).searchParams.get("sectorCompany") === target.t);
  await expect(openSector).toBeFocused(); check(label + ": explicit return restores Heatmap action focus", true);
  const heatmapReturned = page.getByTestId("sector-company-heatmap");
  const sources = heatmapReturned.getByRole("button", { name: new RegExp(lang === "zh" ? "查看来源" : "Review sources") }).first();
  await sources.click(); const dialog = page.getByRole("dialog", { name: lang === "zh" ? "来源" : "Sources", exact: true }); await expect(dialog).toBeVisible();
  check(label + ": Sources remains contextual to Discover", (await dialog.innerText()).includes(lang === "zh" ? "发现" : "Discover"));
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  if (width <= 760) {
   const returnedDisclosure = heatmapReturned.getByTestId("heatmap-map-disclosure");
   if (await returnedDisclosure.evaluate(el => el.open)) await returnedDisclosure.locator("summary").click();
  }
  const dims = await root.evaluate(el => ({ inner: el.scrollWidth-el.clientWidth, document: document.documentElement.scrollWidth-document.documentElement.clientWidth }));
  check(label + ": no horizontal overflow", dims.inner <= 1 && dims.document <= 1, dims);
  await root.evaluate(el => { el.scrollTop = 0; }); await page.evaluate(() => window.scrollTo(0,0)); await shot(page, label + "-heatmap");
  access = false; await root.getByRole("button", { name: lang === "zh" ? "刷新" : "Refresh", exact: true }).click();
  await expect(page.getByTestId("sector-company-heatmap").locator("[data-company-heatmap-tile]")).toHaveCount(0);
  check(label + ": access loss clears exact company names", !(await page.getByTestId("sector-company-heatmap").innerText()).includes(target.t));
  await context.close(); await browser.close(); browser = null;
 }
 check("zero page exceptions", report.errors.length === 0, report.errors); report.passed = true;
})().catch(error => { report.passed = false; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
 if (browser) await browser.close(); fs.writeFileSync(path.join(out,"qualification.json"), JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(row=>!row.passed), errors: report.errors, error: report.error, screenshots: report.screenshots.length },null,2));
});

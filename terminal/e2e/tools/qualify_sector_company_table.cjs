/* Exact-owner proof for Discover -> selected-sector Company Table.
 * Uses the incumbent sector + S&P-500 heatmap bodies through local interception.
 * It proves representation parity and selected-object return; it does not prove production transport.
 * From terminal: node e2e/tools/qualify_sector_company_table.cjs INPUT_DIR PORT RUN_NAME
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
const input = process.argv[2], port = process.argv[3] || "3157", run = process.argv[4] || "initial";
assert(input && /^\d{4,5}$/.test(port) && /^[a-z0-9-]+$/.test(run));
const origin = `http://127.0.0.1:${port}`, out = path.resolve(`../docs/pr-crops/sector-company-table-20260927/${run}`);
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
 productionProof: false, independentReviewRequired: false, checks: [], screenshots: [], errors: [] };
function check(name, ok, details) { report.checks.push({ name, passed: !!ok, details }); assert(ok, name); }
async function shot(page, name) { const file = path.join(out, name + ".png"); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push({ name: name + ".png", sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }
const capBand = size => size >= 200e9 ? "mega" : size >= 50e9 ? "large" : size >= 10e9 ? "mid" : "smaller";
const technology = data.heatmap.tiles.filter(row => row.sector === "Technology");
const separateInformationTechnology = data.heatmap.tiles.filter(row => row.sector === "Information Technology");
assert.equal(data.heatmap.size_basis, "marketcap"); assert.equal(technology.length, 79); assert.equal(separateInformationTechnology.length, 1);
const observed1d = technology.map((row, order) => ({ row, order, value: row.perf?.["1D"] })).filter(item => Number.isFinite(item.value));
const leader = [...observed1d].sort((a,b)=>b.value-a.value || a.order-b.order)[0].row;
const advancing = observed1d.filter(item => item.value > 0).length;
const largest = [...technology].sort((a,b)=>b.size-a.size)[0];
const target = leader, targetIndustry = target.industry, targetBand = capBand(target.size);
const targetIndustryCount = technology.filter(row => row.industry === targetIndustry).length;
const targetBandCount = technology.filter(row => capBand(row.size) === targetBand).length;
const missing1d = technology.find(row => !Number.isFinite(row.perf?.["1D"]));
const zero1d = technology.find(row => row.perf?.["1D"] === 0);
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
    return route.fulfill({ status: 200, json: { data: data[key], receipt: { source: key, path: entry.path.replace(/^site/, ""), status: "ready", asOf: entry.asOf, observedAt: "2026-09-27T12:00:00Z", contentHash: entry.sha256, stale: false } } });
   }
   if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
   return route.continue();
  });
  const start = `${origin}/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=table&sector=xlk&sectorMatrixTimeframe=1D&sectorCompanyTableSort=source&sectorTheme=${theme}`;
  await page.goto(start, { waitUntil: "domcontentloaded", timeout: 60000 });
  const root = page.getByTestId("sector-intelligence"), discovery = page.getByTestId("sector-discovery"), table = page.getByTestId("sector-company-table");
  await expect(root).toHaveAttribute("data-sector-workspace", "discover"); await expect(table).toBeVisible();
  await expect(table.locator("[data-company-table-row]")).toHaveCount(technology.length, { timeout: 15000 });
  const tableText = await table.innerText();
  check(label + ": exact Technology population", lang === "zh" ? /79\s*家公司/.test(tableText) : /79\s+names/.test(tableText), tableText);
  check(label + ": exact source date", tableText.includes("2026-09-25"));
  check(label + ": distinct Information Technology row excluded", technology.length === 79 && separateInformationTechnology.length === 1);
  const answer = await table.getByTestId("company-table-answer").innerText();
  check(label + ": answer derived from exact visible company population", answer.includes(leader.t) && answer.includes(largest.t) && answer.includes(String(advancing)), answer);
  const rows = table.locator("[data-company-table-row]");
  check(label + ": exact source order begins with owner first row", await rows.first().getAttribute("data-company-table-row") === technology[0].t);
  if (missing1d) check(label + ": missing observation stays unavailable", (await table.locator(`[data-company-table-row="${missing1d.t}"]`).innerText()).includes("—"));
  if (zero1d) check(label + ": exact zero stays zero", (await table.locator(`[data-company-table-row="${zero1d.t}"]`).innerText()).includes("0.00%"));
  const controls = table.getByRole("combobox"), search = table.getByRole("searchbox");
  check(label + ": table controls meet 44px height", await search.evaluate(el=>el.getBoundingClientRect().height>=44) && await controls.first().evaluate(el=>el.getBoundingClientRect().height>=44));
  await controls.nth(4).selectOption("performance");
  await expect(table.locator("[data-company-table-row]").first()).toHaveAttribute("data-company-table-row", leader.t);
  check(label + ": performance sort is URL-bound", new URL(page.url()).searchParams.get("sectorCompanyTableSort") === "performance");
  await search.fill(target.name); await expect(table.locator("[data-company-table-row]")).toHaveCount(1);
  check(label + ": exact company search is URL-bound", new URL(page.url()).searchParams.get("sectorCompanyTableQuery") === target.name);
  await table.locator(`[data-company-table-row="${target.t}"] button`).click();
  check(label + ": selected company is URL-bound", new URL(page.url()).searchParams.get("sectorCompany") === target.t);
  const selected = table.getByTestId("company-table-selection"); await expect(selected).toContainText(target.t);
  await expect(selected.locator(`a[href="/analysis?symbol=${encodeURIComponent(target.t)}&page=overview"]`)).toHaveCount(1);
  await search.fill(""); await controls.nth(2).selectOption(targetIndustry);
  await expect(table.locator("[data-company-table-row]")).toHaveCount(targetIndustryCount);
  check(label + ": exact industry filter is URL-bound", new URL(page.url()).searchParams.get("sectorMatrixIndustry") === targetIndustry);
  await controls.nth(2).selectOption(""); await controls.nth(3).selectOption(targetBand);
  await expect(table.locator("[data-company-table-row]")).toHaveCount(targetBandCount);
  check(label + ": exact cap-band filter is URL-bound", new URL(page.url()).searchParams.get("sectorMatrixBand") === targetBand);
  await controls.nth(3).selectOption(""); await controls.nth(1).selectOption("1M");
  check(label + ": timeframe is URL-bound", new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  const rep = discovery.getByRole("group", { name: lang === "zh" ? "发现视图" : "Discover representation", exact: true });
  await rep.getByRole("button", { name: lang === "zh" ? "热图" : "Heatmap", exact: true }).click();
  const heatmap = page.getByTestId("sector-company-heatmap"); await expect(heatmap.locator("[data-company-heatmap-tile]")).toHaveCount(technology.length);
  check(label + ": Heatmap preserves exact company and timeframe", new URL(page.url()).searchParams.get("sectorCompany") === target.t && new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  await rep.getByRole("button", { name: lang === "zh" ? "矩阵" : "Matrix", exact: true }).click();
  const matrix = page.getByTestId("sector-industry-matrix"); await expect(matrix).toBeVisible();
  check(label + ": Matrix preserves exact company state without consuming it", new URL(page.url()).searchParams.get("sectorCompany") === target.t);
  await rep.getByRole("button", { name: lang === "zh" ? "表格" : "Table", exact: true }).click();
  const tableAgain = page.getByTestId("sector-company-table"); await expect(tableAgain).toBeVisible();
  await expect(tableAgain.getByTestId("company-table-selection")).toContainText(target.t);
  check(label + ": Table restores filters, sort and selected company", new URL(page.url()).searchParams.get("sectorCompanyTableSort") === "performance" && new URL(page.url()).searchParams.get("sectorCompany") === target.t && new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  const returnUrl = page.url(), openSector = tableAgain.getByTestId("company-table-selection").getByRole("button", { name: new RegExp(lang === "zh" ? "打开板块情报" : "Open sector intelligence") });
  await openSector.click(); await expect(root).toHaveAttribute("data-sector-workspace", "detail");
  const returnButton = root.getByTestId("sector-detail-return"); check(label + ": detail has explicit Discover return", (await returnButton.innerText()).includes(lang === "zh" ? "返回发现" : "Back to Discover"));
  const expected = new URL(returnUrl), expectedState = JSON.stringify([...expected.searchParams.entries()].sort());
  await returnButton.click(); await expect(root).toHaveAttribute("data-sector-workspace", "discover");
  await expect.poll(() => { const current = new URL(page.url()); return current.pathname + JSON.stringify([...current.searchParams.entries()].sort()); }).toBe(expected.pathname + expectedState);
  await expect(openSector).toBeFocused(); check(label + ": explicit return restores Table action focus", true);
  const returnedTable = page.getByTestId("sector-company-table");
  const sources = returnedTable.getByRole("button", { name: new RegExp(lang === "zh" ? "查看来源" : "Review sources") }).first();
  await sources.click(); const dialog = page.getByRole("dialog", { name: lang === "zh" ? "来源" : "Sources", exact: true }); await expect(dialog).toBeVisible();
  check(label + ": Sources remains contextual to Discover", (await dialog.innerText()).includes(lang === "zh" ? "发现" : "Discover"));
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  const dims = await root.evaluate(el => ({ inner:el.scrollWidth-el.clientWidth, document:document.documentElement.scrollWidth-document.documentElement.clientWidth }));
  check(label + ": no horizontal overflow", dims.inner <= 1 && dims.document <= 1, dims);
  await root.evaluate(el => { el.scrollTop = 0; }); await page.evaluate(() => window.scrollTo(0,0)); await shot(page, label + "-table");
  access = false; await root.getByRole("button", { name:lang === "zh" ? "刷新" : "Refresh", exact:true }).click();
  await expect(page.getByTestId("sector-company-table").locator("[data-company-table-row]")).toHaveCount(0);
  check(label + ": access loss clears exact company rows", !(await page.getByTestId("sector-company-table").innerText()).includes(target.t));
  await context.close(); await browser.close(); browser = null;
 }
 check("zero page exceptions", report.errors.length === 0, report.errors); report.passed = true;
})().catch(error => { report.passed = false; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
 if (browser) await browser.close(); fs.writeFileSync(path.join(out,"qualification.json"), JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(row=>!row.passed), errors: report.errors, error: report.error, screenshots: report.screenshots.length },null,2));
});

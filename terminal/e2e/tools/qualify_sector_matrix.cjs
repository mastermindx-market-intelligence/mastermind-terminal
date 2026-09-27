/* Exact-owner proof for Discover -> selected-sector Industry × market-cap Matrix.
 * Uses the incumbent sector + S&P-500 heatmap bodies through local interception.
 * It neither admits the separately rights-held Finviz theme/bubble plane nor proves production transport.
 * From terminal: node e2e/tools/qualify_sector_matrix.cjs INPUT_DIR PORT RUN_NAME
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
const input = process.argv[2], port = process.argv[3] || "3157", run = process.argv[4] || "initial";
assert(input && /^\d{4,5}$/.test(port) && /^[a-z0-9-]+$/.test(run));
const origin = `http://127.0.0.1:${port}`, out = path.resolve(`../docs/pr-crops/sector-matrix-20260927/${run}`);
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
const band = size => size >= 200e9 ? "mega" : size >= 50e9 ? "large" : size >= 10e9 ? "mid" : "smaller";
const bandLabel = { mega: "≥ $200B", large: "$50–200B", mid: "$10–50B", smaller: "< $10B" };
const technology = data.heatmap.tiles.filter(row => row.sector === "Technology");
const separateInformationTechnology = data.heatmap.tiles.filter(row => row.sector === "Information Technology");
assert.equal(data.heatmap.size_basis, "marketcap"); assert.equal(technology.length, 79); assert.equal(separateInformationTechnology.length, 1);
const cellMap = new Map();
for (const tile of technology) {
 const key = `${tile.industry}\u0000${band(tile.size)}`;
 if (!cellMap.has(key)) cellMap.set(key, { industry: tile.industry, band: band(tile.size), members: [] });
 cellMap.get(key).members.push(tile);
}
const cells = [...cellMap.values()].map(cell => {
 const values = cell.members.map(row => row.perf?.["1D"]).filter(Number.isFinite);
 return { ...cell, observed: values.length, advancing: values.filter(value => value > 0).length };
});
const industries = new Map();
for (const cell of cells) {
 const current = industries.get(cell.industry) || { industry: cell.industry, observed: 0, advancing: 0, order: industries.size };
 current.observed += cell.observed; current.advancing += cell.advancing; industries.set(cell.industry, current);
}
const observedIndustries = [...industries.values()].filter(row => row.observed > 0), ratio = row => row.advancing / row.observed;
const strongest = [...observedIndustries].sort((a,b) => ratio(b)-ratio(a) || b.observed-a.observed || a.order-b.order)[0];
const weakest = [...observedIndustries].sort((a,b) => ratio(a)-ratio(b) || b.observed-a.observed || a.order-b.order)[0];
const target = cells.find(cell => cell.members.length >= 2 && cell.observed > 0) || cells[0];
const targetKey = `${target.industry}::${target.band}`;
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
    return route.fulfill({ status: 200, json: { data: data[key], receipt: { source: key, path: entry.path.replace(/^site/, ""), status: "ready", asOf: entry.asOf, observedAt: "2026-09-27T10:00:00Z", contentHash: entry.sha256, stale: false } } });
   }
   if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
   return route.continue();
  });
  const start = `${origin}/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=matrix&sector=xlk&sectorMatrixTimeframe=1D&sectorTheme=${theme}`;
  await page.goto(start, { waitUntil: "domcontentloaded", timeout: 60000 });
  const root = page.getByTestId("sector-intelligence"), discovery = page.getByTestId("sector-discovery"), matrix = page.getByTestId("sector-industry-matrix");
  await expect(root).toHaveAttribute("data-sector-workspace", "discover"); await expect(matrix).toBeVisible();
  await expect(matrix.locator("[data-matrix-cell]")).toHaveCount(cells.length * 2, { timeout: 15000 });
  const matrixText = await matrix.innerText();
  check(label + ": exact Technology population", lang === "zh" ? /79\s*家公司/.test(matrixText) : /79\s+names/.test(matrixText), matrixText);
  check(label + ": exact source date", (await matrix.innerText()).includes("2026-09-25"));
  check(label + ": distinct Information Technology row excluded", technology.length === 79 && separateInformationTechnology.length === 1);
  const answer = await matrix.getByTestId("matrix-answer").innerText();
  check(label + ": answer derived from exact industry participation", answer.includes(strongest.industry) && answer.includes(weakest.industry), answer);
  const grid = matrix.getByTestId("matrix-grid"), mobileList = matrix.getByTestId("matrix-mobile-list");
  await expect(grid.locator("[data-matrix-cell]")).toHaveCount(cells.length);
  await expect(mobileList.locator("[data-matrix-cell]")).toHaveCount(cells.length);
  check(label + ": size bands preserve exact source counts", technology.filter(row => band(row.size)==="mega").length === 24 && technology.filter(row => band(row.size)==="large").length === 26 && technology.filter(row => band(row.size)==="mid").length === 29 && technology.filter(row => band(row.size)==="smaller").length === 0);
  const visibleCells = width <= 760 ? mobileList : grid;
  if (width <= 760) await matrix.getByTestId("matrix-mobile-disclosure").locator("summary").click();
  const targetButton = visibleCells.locator(`[data-matrix-cell=${JSON.stringify(targetKey)}]`);
  await targetButton.click();
  await expect(page).toHaveURL(new RegExp(`sectorMatrixBand=${target.band}`));
  check(label + ": selected cell identity stays URL-bound", new URL(page.url()).searchParams.get("sectorMatrixIndustry") === target.industry);
  const inspector = matrix.getByTestId("matrix-inspector");
  await expect(inspector.locator("a")).toHaveCount(target.members.length);
  const inspectorText = await inspector.innerText();
  check(label + ": selected cell exposes the complete exact member set", target.members.every(row => inspectorText.includes(row.t)), inspectorText);
  const timeframe = matrix.getByRole("combobox", { name: lang === "zh" ? "表现周期" : "Performance window", exact: true });
  await timeframe.selectOption("1M"); check(label + ": timeframe is durable URL state", new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  const rep = discovery.getByRole("group", { name: lang === "zh" ? "发现视图" : "Discover representation", exact: true });
  await rep.getByRole("button", { name: lang === "zh" ? "表格" : "Table", exact: true }).click(); await expect(matrix).toHaveCount(0);
  check(label + ": Table remains the same Discover job", new URL(page.url()).searchParams.get("sectorWorkspace") === "discover" && new URL(page.url()).searchParams.get("sectorDiscoveryMode") === "table");
  await rep.getByRole("button", { name: lang === "zh" ? "矩阵" : "Matrix", exact: true }).click(); await expect(page.getByTestId("sector-industry-matrix")).toBeVisible();
  check(label + ": Matrix restores selected sector and timeframe", new URL(page.url()).searchParams.get("sector") === "xlk" && new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  const returnUrl = page.url();
  const matrixOpen = page.getByTestId("matrix-inspector").getByRole("button", { name: new RegExp(lang === "zh" ? "打开板块情报" : "Open sector intelligence") });
  await matrixOpen.click(); await expect(root).toHaveAttribute("data-sector-workspace", "detail");
  const returnButton = root.getByTestId("sector-detail-return"); check(label + ": detail has explicit Discover return", (await returnButton.innerText()).includes(lang === "zh" ? "返回发现" : "Back to Discover"));
  await returnButton.click(); await expect(page).toHaveURL(returnUrl); await expect(root).toHaveAttribute("data-sector-workspace", "discover");
  check(label + ": explicit return restores Matrix context", new URL(page.url()).searchParams.get("sectorDiscoveryMode") === "matrix" && new URL(page.url()).searchParams.get("sectorMatrixTimeframe") === "1M");
  await expect(matrixOpen).toBeFocused(); check(label + ": explicit return restores Matrix action focus", true);
  const matrixAgain = page.getByTestId("sector-industry-matrix");
  const sources = matrixAgain.getByRole("button", { name: new RegExp(lang === "zh" ? "查看来源" : "Review sources") }).first();
  await sources.click(); const dialog = page.getByRole("dialog", { name: lang === "zh" ? "来源" : "Sources", exact: true }); await expect(dialog).toBeVisible();
  check(label + ": Sources remains contextual to Discover", (await dialog.innerText()).includes(lang === "zh" ? "发现" : "Discover"));
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  const dims = await root.evaluate(el => ({ inner: el.scrollWidth-el.clientWidth, document: document.documentElement.scrollWidth-document.documentElement.clientWidth }));
  check(label + ": no horizontal overflow", dims.inner <= 1 && dims.document <= 1, dims);
  await root.evaluate(el => { el.scrollTop = 0; }); await page.evaluate(() => window.scrollTo(0,0)); await shot(page, label + "-matrix");
  access = false; await root.getByRole("button", { name: lang === "zh" ? "刷新" : "Refresh", exact: true }).click();
  await expect(page.getByTestId("sector-industry-matrix").locator("[data-matrix-cell]")).toHaveCount(0);
  check(label + ": access loss clears exact matrix names", !(await page.getByTestId("sector-industry-matrix").innerText()).includes("AMD"));
  await context.close(); await browser.close(); browser = null;
 }
 check("zero page exceptions", report.errors.length === 0, report.errors); report.passed = true;
})().catch(error => { report.passed = false; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
 if (browser) await browser.close(); fs.writeFileSync(path.join(out,"qualification.json"), JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(row=>!row.passed), errors: report.errors, error: report.error, screenshots: report.screenshots.length },null,2));
});

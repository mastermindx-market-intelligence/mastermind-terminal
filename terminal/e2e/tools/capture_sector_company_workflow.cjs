/* Repeatable local native-UI proof. Requires this exact worktree's fixture dev server.
 * Uses the same historical browser fixture as the committed Playwright workflow.
 * Run from terminal/: node e2e/tools/capture_sector_company_workflow.cjs chromium 3157
 * WebKit is engine proof, not an authenticated Safari/production acceptance claim.
 */
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const playwright = require("@playwright/test");
const engine = process.argv[2] || "chromium", port = process.argv[3] || "3157";
assert(["chromium", "webkit"].includes(engine)); assert(/^\d{4,5}$/.test(port));
const origin = `http://127.0.0.1:${port}`;
const file = path.resolve("e2e/fixtures/sector-company-v3.ts");
const compiled = require("esbuild").transformSync(fs.readFileSync(file, "utf8"), { loader: "ts", format: "cjs" }).code;
const fixture = new Module(file); fixture.filename = file; fixture._compile(compiled, file);
const { sectorFixture } = fixture.exports;
const out = path.resolve("../docs/pr-crops/sector-intelligence-r2"); fs.mkdirSync(out, { recursive: true });
const report = { engine, source: "native-Terminal-UI-with-historical-design-fixture", production: false,
  authenticatedOwnerData: false, independentHumanAcceptance: false, fixturesInProduction: false,
  heatmap: "unavailable: full source cohort not in the reference archive", checks: [], screenshots: [], pageErrors: [] };
function check(name, passed, details) { report.checks.push({ name, passed: !!passed, details }); assert(passed, name); }
function imageReceipt(name) { const bytes = fs.readFileSync(path.join(out, name)); report.screenshots.push({ name, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }); }
async function capture(page, name) { await page.screenshot({ path: path.join(out, name) }); imageReceipt(name); }
let browser;
(async () => {
  browser = await playwright[engine].launch(); report.browserVersion = browser.version();
  for (const [profile, width, height, lang, theme] of [
    ["desktop", 1440, 900, "en", "light"], ["desktop", 1440, 900, "en", "dark"],
    ["desktop", 1440, 900, "zh", "light"], ["tablet", 820, 1180, "en", "light"],
    ["mobile", 390, 844, "en", "light"], ["mobile", 390, 844, "zh", "dark"],
  ]) {
    const label = `${engine}-${profile}-${lang}-${theme}`;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await context.addInitScript(lang => { localStorage.setItem("mm.lang", lang); document.documentElement?.setAttribute("data-lang", lang); }, lang);
    const page = await context.newPage(); page.on("pageerror", error => report.pageErrors.push({ label, message: error.message }));
    let access = false;
    await page.route("**/*", route => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) return route.abort();
      if (u.pathname === "/api/sector-intelligence") return sectorFixture(route, access ? "access" : "ready");
      if (u.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
      return route.continue();
    });
    await page.goto(`${origin}/discover?tab=sectors&sectorTheme=${theme}&sectorCompany=MU`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const root = page.getByTestId("sector-intelligence"), inspector = root.getByTestId("sector-company-inspector");
    await inspector.getByText("+14.9%", { exact: true }).waitFor({ timeout: 30000 });
    check(`${label}: absolute/relative kept distinct`, (await inspector.innerText()).includes("+1.9pp"));
    check(`${label}: exact existing company route`, await inspector.getByRole("link").getAttribute("href") === "/analysis?symbol=MU&page=overview");
    check(`${label}: source subset`, await root.locator("[data-company-choice]").count() === 6);
    check(`${label}: no fabricated concentration`, !(await root.innerText()).includes("63.2%"));
    check(`${label}: appearance`, await root.getAttribute("data-sector-theme") === theme);
    const overflow = await root.evaluate(el => ({ inner: el.scrollWidth - el.clientWidth, document: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    check(`${label}: no horizontal overflow`, overflow.inner <= 1 && overflow.document <= 1, overflow);
    if (lang === "en") check(`${label}: no CJK chrome leakage`, !/[\u3400-\u9fff]/.test(await root.innerText()));
    else check(`${label}: shared language`, (await root.innerText()).includes("比较公司"));
    await capture(page, label + "-overview.png");
    const comparison = root.getByRole("region", { name: lang === "zh" ? "比较公司" : "Compare the companies", exact: true });
    await comparison.screenshot({ path: path.join(out, label + "-comparison.png") }); imageReceipt(label + "-comparison.png");
    await root.locator('[data-company-choice="MU"]').focus(); await page.keyboard.press("ArrowDown");
    check(`${label}: keyboard selects next source row`, (await inspector.innerText()).includes("NXPI"));
    check(`${label}: keyboard focus follows selection`, await root.locator('[data-company-choice="NXPI"]').evaluate(el => document.activeElement === el));
    await page.goBack(); await inspector.getByRole("heading", { name: "MU", exact: true }).waitFor();
    check(`${label}: Back restores company`, (await inspector.innerText()).includes("+1.9pp"));
    await root.getByRole("button", { name: lang === "zh" ? "显示全部公司" : "Show all companies", exact: true }).click();
    check(`${label}: full cohort`, await root.locator("[data-company-choice]").count() === 14);
    await root.locator('[data-company-choice="INTC"]').click();
    await inspector.getByText(lang === "zh" ? "信号详情" : "Signal details", { exact: true }).click();
    check(`${label}: false source flag preserved`, (await inspector.innerText()).includes(lang === "zh" ? "否" : "No"));
    check(`${label}: unscored stays unscored`, (await inspector.innerText()).includes(lang === "zh" ? "未评级" : "Not rated"));
    check(`${label}: values not inferred`, (await inspector.innerText()).includes("+40.1%") && (await inspector.innerText()).includes("+27.2pp"));
    const scroll = await root.evaluate(el => { const owner = el.scrollHeight > el.clientHeight + 1 ? el : document.scrollingElement; owner.scrollTop = owner.scrollHeight; const bottom = owner.scrollTop; owner.scrollTop = 0; return { owner: owner === el ? "workspace" : "document", bottom, restored: owner.scrollTop }; });
    check(`${label}: return to top`, scroll.bottom > 0 && scroll.restored === 0, scroll);
    access = true;
    await root.getByRole("button", { name: lang === "zh" ? "刷新" : "Refresh", exact: true }).click();
    await root.getByRole("heading", { name: lang === "zh" ? "板块数据需要访问权限" : "Sector data requires access", exact: true }).waitFor();
    check(`${label}: no previous company data after lost access`, await root.locator("[data-company-choice]").count() === 0 && await inspector.getByRole("link").count() === 0);
    await context.close();
  }
  check("zero browser page exceptions", report.pageErrors.length === 0, report.pageErrors);
  report.passed = true;
})().catch(error => { report.passed = false; report.failure = error.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  fs.writeFileSync(path.join(out, `${engine}-capture-report.json`), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ engine, passed: report.passed, checks: report.checks.length, failed: report.checks.filter(x => !x.passed), screenshots: report.screenshots.length, pageErrors: report.pageErrors, failure: report.failure }, null, 2));
});

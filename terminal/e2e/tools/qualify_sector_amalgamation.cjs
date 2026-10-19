/* Qualify the unified navigation with immutable owner bodies, never production fixtures.
 * Run from terminal/: node e2e/tools/qualify_sector_amalgamation.cjs INPUT_DIR PORT [RUN_NAME]
 * This checks the amalgamation slice; it does not waive the older fixture-migration gate.
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
const input = process.argv[2], port = process.argv[3] || "3157", run = process.argv[4] || "initial";
assert(input && /^\d{4,5}$/.test(port) && /^[a-z0-9-]+$/.test(run));
const origin = `http://127.0.0.1:${port}`, out = path.resolve(`../docs/pr-crops/sector-amalgamation-20260926/${run}`);
assert(!fs.existsSync(out), "Do not overwrite an earlier proof run"); fs.mkdirSync(out, { recursive: true });
const provenance = JSON.parse(fs.readFileSync(path.join(input, "provenance.json"), "utf8")), payloads = {};
for (const [key, receipt] of Object.entries(provenance.files)) {
  const bytes = fs.readFileSync(path.join(input, key + ".json"));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), receipt.sha256); payloads[key] = JSON.parse(bytes);
}
const report = { sourceRevision: provenance.ref, purpose: "Sector Central unified destinations and contextual evidence",
  nativePaperModified: false, authenticatedProduction: false, independentDesignAcceptance: false,
  transport: "local interception with unmodified owner JSON", checks: [], screenshots: [], errors: [] };
function check(name, pass, details) { report.checks.push({ name, passed: !!pass, details }); assert(pass, name); }
async function capture(page, name) { const file = path.join(out, name + ".png"); await page.screenshot({ path: file }); report.screenshots.push({ name: name + ".png", sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }
const copy = {
 en: { title: "Sector Central", tabs: ["Overview", "Companies", "Signals", "Drivers", "History"], sources: "Sources", close: "Back to research", search: "Find a ticker", group: "Browse company groups", methods: "Technical receipt", drivers: "Related source universe · not verified company exposure", history: "Historical observations are not connected", review: "Review sources" },
 zh: { title: "板块中心", tabs: ["概览", "公司", "信号", "驱动因素", "历史"], sources: "来源", close: "返回研究", search: "搜索股票代码", group: "浏览公司分组", methods: "技术凭据", drivers: "相关来源全集 · 非已验证的公司敞口", history: "尚未连接历史观察记录", review: "查看来源" },
};
let browser;
(async () => {
 for (const [engine, width, height, lang, theme] of [
  ["chromium",1440,900,"en","light"], ["chromium",820,1180,"en","dark"],
  ["chromium",390,844,"en","light"], ["webkit",1440,900,"en","dark"], ["webkit",390,844,"zh","light"],
 ]) {
  browser = await ({ chromium, webkit }[engine]).launch();
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  await context.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  const page = await context.newPage(), c = copy[lang], label = `${engine}-${width}-${lang}-${theme}`;
  page.on("pageerror", error => report.errors.push({ label, message: error.message }));
  await page.route("**/*", route => {
   const url = new URL(route.request().url());
   if (url.origin !== origin) return route.abort();
   if (url.pathname === "/api/sector-intelligence") {
    const key = url.searchParams.get("source"), entry = provenance.files[key];
    return route.fulfill({ status: 200, json: { data: payloads[key], receipt: { source: key, path: entry.path.replace(/^site/, ""), status: "ready", asOf: entry.asOf, observedAt: "2026-09-26T12:00:00Z", contentHash: entry.sha256, stale: false } } });
   }
   if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} });
   return route.continue();
  });
  const base = `${origin}/discover?tab=sectors&group=semiconductors&sectorCompany=MU&sectorSort=relative&sectorTheme=${theme}`;
  await page.goto(base + "&sectorView=companies&sectorQuery=MU", { waitUntil: "domcontentloaded", timeout: 60000 });
  const root = page.getByTestId("sector-intelligence"); await expect(root.getByTestId("sector-company-row")).toHaveCount(1);
  await expect(root.getByRole("heading", { name: c.title, exact: true })).toBeVisible();
  check(`${label}: exactly five unified destinations`, JSON.stringify(await root.getByRole("tab").allTextContents()) === JSON.stringify(c.tabs));
  check(`${label}: Sources is not a competing destination`, await root.getByRole("tab", { name: c.sources, exact: true }).count() === 0);
  const open = root.getByRole("button", { name: c.sources, exact: true });
  const prior = page.url(), beforeScroll = await root.evaluate(el => ({ inner: el.scrollTop, outer: window.scrollY }));
  await open.click(); const dialog = page.getByRole("dialog", { name: c.sources, exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText(c.tabs[1]);
  check(`${label}: source overlay preserves view and query`, new URL(page.url()).searchParams.get("sectorView") === "companies" && new URL(page.url()).searchParams.get("sectorQuery") === "MU");
  check(`${label}: exact current source clocks`, (await dialog.innerText()).includes(provenance.files.sector.asOf) && (await dialog.innerText()).includes(provenance.files.themes.asOf));
  await dialog.getByText(c.methods, { exact: true }).first().click();
  check(`${label}: technical receipt stays in disclosure`, (await dialog.innerText()).includes(provenance.files.sector.sha256));
  await capture(page, label + "-sources");
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(open).toBeFocused();
  await expect(page).toHaveURL(prior); await expect(root.getByTestId("sector-company-row")).toHaveCount(1);
  check(`${label}: Escape restores exact filtered view`, await root.getByLabel(c.search, { exact: true }).inputValue() === "MU");
  const afterScroll = await root.evaluate(el => ({ inner: el.scrollTop, outer: window.scrollY }));
  check(`${label}: evidence close preserves scroll`, Math.abs(afterScroll.inner-beforeScroll.inner)<2 && Math.abs(afterScroll.outer-beforeScroll.outer)<2, { beforeScroll, afterScroll });
  await page.goForward(); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: c.close, exact: true }).click(); await expect(dialog).not.toBeVisible();
  check(`${label}: Forward/open then close keeps company`, new URL(page.url()).searchParams.get("sectorCompany") === "MU");
  await root.getByRole("tab", { name: c.tabs[2], exact: true }).click();
  await expect(page).toHaveURL(/sectorView=signals/); await expect(root.getByRole("tab", { name: c.tabs[2], exact: true })).toHaveAttribute("aria-selected","true");
  check(`${label}: signal destination retains selected group`, new URL(page.url()).searchParams.get("group") === "semiconductors");
  const signalText = await root.innerText();
  check(`${label}: parent-sector and selected-group signal scopes remain explicit`, signalText.includes(lang === "en" ? "Technology · Slow cycle / Fast rotation" : "科技 · 慢周期 / 快速轮动") && signalText.includes("Semiconductors ·"));
  await capture(page, label + "-signals");
  await root.getByRole("tab", { name: c.tabs[3], exact: true }).click();
  await root.getByText(c.drivers, { exact: true }).click();
  for (const row of payloads.themes.themes) await expect(root.getByRole("heading", { name: lang === "zh" ? row.name_zh || row.name_en : row.name_en, exact: true })).toBeVisible();
  check(`${label}: no lost theme depth in consolidation`, payloads.themes.themes.length === 18);
  await root.getByRole("tab", { name: c.tabs[4], exact: true }).click();
  await expect(root.getByRole("heading", { name: c.history, exact: true })).toBeVisible();
  check(`${label}: missing history does not fabricate a chart`, await root.locator("svg,canvas").count() === 0);
  await root.getByRole("button", { name: c.review + " →", exact: true }).click(); await expect(dialog).toBeVisible(); await page.goBack(); await expect(dialog).not.toBeVisible();
  check(`${label}: browser Back closes Sources before losing History`, new URL(page.url()).searchParams.get("sectorView") === "history");
  const dims = await root.evaluate(el => ({ inner: el.scrollWidth-el.clientWidth, document: document.documentElement.scrollWidth-document.documentElement.clientWidth }));
  check(`${label}: no horizontal overflow`, dims.inner <= 1 && dims.document <= 1, dims);
  for (const [old, index] of [["dossier",2],["themes",3]]) {
   await page.goto(base + `&sectorView=${old}`, { waitUntil:"domcontentloaded" });
   await expect(root.getByRole("tab", { name:c.tabs[index],exact:true })).toHaveAttribute("aria-selected","true");
   check(`${label}: old ${old} link retains MU`, new URL(page.url()).searchParams.get("sectorCompany") === "MU");
  }
  await page.goto(base + "&sectorView=sources", { waitUntil:"domcontentloaded" }); await expect(dialog).toBeVisible();
  await dialog.getByRole("button",{name:c.close,exact:true}).click(); await expect(dialog).not.toBeVisible();
  check(`${label}: direct legacy Sources closes without leaving workspace`, new URL(page.url()).pathname === "/discover" && new URL(page.url()).searchParams.get("sectorView") === "intelligence");
  await context.close(); await browser.close(); browser = null;
 }
 check("zero page exceptions",report.errors.length===0,report.errors);report.passed=true;
})().catch(error=>{ report.passed=false; report.error=error.stack;process.exitCode=1; }).finally(async()=>{
 if(browser) await browser.close(); fs.writeFileSync(path.join(out,"qualification.json"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.checks.filter(r=>!r.passed),errors:report.errors,error:report.error,screenshots:report.screenshots.length},null,2));
});

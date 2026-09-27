/* Actual-owner-body proof for the new Discover -> breadth -> sector-detail journey.
 * Does not migrate or waive the separately held historical-fixture suite.
 * From terminal: node e2e/tools/qualify_sector_discovery.cjs INPUT_DIR PORT RUN_NAME
 */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { chromium, webkit, expect } = require("@playwright/test");
const input = process.argv[2], port = process.argv[3] || "3157", run = process.argv[4] || "initial";
assert(input && /^\d{4,5}$/.test(port) && /^[a-z0-9-]+$/.test(run));
const origin = `http://127.0.0.1:${port}`, out = path.resolve(`../docs/pr-crops/sector-discovery-20260926/${run}`);
assert(!fs.existsSync(out), "Retain earlier proof runs"); fs.mkdirSync(out, { recursive: true });
const provenance = JSON.parse(fs.readFileSync(path.join(input, "provenance.json"), "utf8")), data = {};
for (const [key, entry] of Object.entries(provenance.files)) {
 const bytes = fs.readFileSync(path.join(input, key + ".json")); assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), entry.sha256); data[key] = JSON.parse(bytes);
}
const report = { sourceRevision: provenance.ref, sourceBodiesChanged: false, transport: "local interception", productionProof: false, independentDesignAcceptance: false, checks: [], screenshots: [], errors: [] };
function check(name, ok, details) { report.checks.push({ name, passed: !!ok, details }); assert(ok, name); }
async function shot(page, name) { const file = path.join(out, name + ".png"); await page.screenshot({ path: file }); report.screenshots.push({ name: name + ".png", sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }
let browser;
(async () => {
 for (const [engine, width, height, lang, theme] of [["chromium",1440,900,"en","light"],["chromium",820,1180,"en","dark"],["chromium",390,844,"en","light"],["webkit",1440,900,"en","dark"],["webkit",390,844,"zh","light"]]) {
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
    return route.fulfill({ status: access ? 200 : 401, json: { data: access ? data[key] : null, receipt: { source: key, path: entry.path.replace(/^site/, ""), status: access ? "ready" : "access", asOf: access ? entry.asOf : null, contentHash: access ? entry.sha256 : null, observedAt: access ? "2026-09-26T12:00:00Z" : null, stale: false } } });
   }
   if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} }); return route.continue();
  });
  await page.goto(`${origin}/discover?tab=sectors&sectorTheme=${theme}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const root = page.getByTestId("sector-intelligence"), discovery = page.getByTestId("sector-discovery");
  await expect(root).toHaveAttribute("data-sector-workspace", "discover");
  await expect(discovery.locator("[data-sector-choice]")).toHaveCount(data.sector.sectors.length);
  check(label + ": all 11 exact sectors", data.sector.sectors.length === 11);
  check(label + ": source date retained", (await discovery.innerText()).includes(provenance.files.sector.asOf));
  const tech = data.sector.sectors.find(row => row.id === "xlk"), techName = lang === "zh" ? tech.name_zh : tech.name;
  check(label + ": owner return rendered", (await discovery.innerText()).includes("+" + tech.heat.heat_1M.toFixed(2) + "%"));
  await shot(page, label + "-discover");
  const search = discovery.getByRole("searchbox"), sort = discovery.getByRole("combobox");
  check(label + ": search and sort controls meet 44px height", await search.evaluate(el => el.getBoundingClientRect().height >= 44) && await sort.evaluate(el => el.getBoundingClientRect().height >= 44));
  await search.fill(lang === "zh" ? "科技" : "tech"); await sort.selectOption("participation");
  await expect(discovery.locator("[data-sector-choice]")).toHaveCount(1);
  const prior = page.url(); await discovery.locator('[data-sector-choice="xlk"]').click();
  await expect(root).toHaveAttribute("data-sector-workspace","discover");
  check(label + ": sector selection stays in Discover", new URL(page.url()).searchParams.get("sector") === "xlk");
  const discoveryOpen = discovery.getByTestId("sector-discovery-selection").getByRole("button");
  await discoveryOpen.click(); await expect(root).toHaveAttribute("data-sector-workspace","detail");
  await expect(root.getByText(techName,{exact:true}).first()).toBeVisible();
  check(label + ": sector selection is not a fabricated group join", new URL(page.url()).searchParams.get("group") === "" && await root.locator("[data-company-choice]").count() === 0);
  await root.getByTestId("sector-primary-action").click();
  const groupsDialog = page.getByRole("dialog", { name: lang === "zh" ? "浏览公司分组" : "Browse company groups", exact: true });
  await expect(groupsDialog).toBeVisible(); await groupsDialog.getByRole("searchbox").fill("semiconductors");
  await groupsDialog.locator('[data-group-choice="semiconductors"]').click();
  check(label + ": primary action reaches a real source group",new URL(page.url()).searchParams.get("group") === "semiconductors");
  await root.getByTestId("sector-primary-action").click(); await expect(root.getByTestId("sector-company-row")).toHaveCount(14);
  check(label + ": complete sector-to-group-to-company journey",true);
  const discoverReturn = root.getByTestId("sector-detail-return");
  await discoverReturn.click(); await expect(page).toHaveURL(prior); await expect(root).toHaveAttribute("data-sector-workspace","discover");
  await expect(search).toHaveValue(lang === "zh" ? "科技" : "tech");
  check(label + ": explicit return restores filter and sort", await sort.inputValue() === "participation");
  await expect(discoveryOpen).toBeFocused(); check(label + ": explicit return restores the open action focus", true);
  await search.fill("");
  const workspaceNav = root.getByRole("navigation", { name: lang === "zh" ? "板块工作区视图" : "Sector workspace views", exact: true });
  await workspaceNav.getByRole("button", { name: lang === "zh" ? "市场广度" : "Market breadth", exact:true }).click();
  await expect(root).toHaveAttribute("data-sector-workspace","breadth"); await expect(discovery.locator("[data-sector-choice]")).toHaveCount(11);
  const techCard = discovery.locator('[data-sector-choice="xlk"]');
  check(label + ": supplied breadth and population", (await techCard.innerText()).includes(`${tech.heat.breadth_pct}%`) && (await techCard.innerText()).includes(String(tech.heat.adv)));
  check(label + ": common 0-100 bar scale", await techCard.locator("span[style]").evaluate(el => el.style.width) === `${tech.heat.breadth_pct}%`);
  await shot(page,label + "-breadth");
  const last = discovery.locator("[data-sector-choice]").last(); await last.scrollIntoViewIfNeeded();
  const target = await last.getAttribute("data-sector-choice"); await last.click(); await expect(root).toHaveAttribute("data-sector-workspace","breadth");
  check(label + ": breadth selection stays in breadth", new URL(page.url()).searchParams.get("sector") === target);
  const breadthOpen = discovery.getByTestId("sector-discovery-selection").getByRole("button"); await breadthOpen.scrollIntoViewIfNeeded();
  const beforeScroll = await root.evaluate(el => ({ inner:el.scrollTop,outer:window.scrollY }));
  await breadthOpen.click(); await expect(root).toHaveAttribute("data-sector-workspace","detail");
  check(label + ": breadth opens exact sector research", new URL(page.url()).searchParams.get("sector") === target);
  await root.getByTestId("sector-detail-return").click(); await expect(root).toHaveAttribute("data-sector-workspace","breadth");
  await expect.poll(async () => root.evaluate((el,p) => Math.max(Math.abs(el.scrollTop-p.inner),Math.abs(window.scrollY-p.outer)),beforeScroll)).toBeLessThan(3);
  check(label + ": return restores list position",true,beforeScroll);
  await expect(breadthOpen).toBeFocused(); check(label + ": return restores the open action focus",true);
  const source = discovery.getByRole("button", { name:lang === "zh" ? "来源" : "Sources",exact:true });
  await source.click(); const dialog=page.getByRole("dialog",{name:lang === "zh" ? "来源" : "Sources",exact:true}); await expect(dialog).toBeVisible();
  check(label + ": evidence belongs to the breadth workspace",(await dialog.innerText()).includes(lang === "zh" ? "市场广度" : "Market breadth"));
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(source).toBeFocused();
  check(label + ": Sources closes to the same breadth view",new URL(page.url()).searchParams.get("sectorWorkspace") === "breadth");
  await search.fill("NO_SUCH_SECTOR"); await expect(discovery.locator("[data-sector-choice]")).toHaveCount(0);
  await discovery.getByRole("button",{name:lang === "zh" ? "清除搜索" : "Clear search",exact:true}).click(); await expect(discovery.locator("[data-sector-choice]")).toHaveCount(11);
  check(label + ": empty search recovers without reload",true);
  const dims = await root.evaluate(el=>({inner:el.scrollWidth-el.clientWidth,document:document.documentElement.scrollWidth-document.documentElement.clientWidth}));
  check(label + ": no horizontal overflow",dims.inner <= 1 && dims.document <= 1,dims);
  access=false; await root.getByRole("button",{name:lang === "zh" ? "刷新" : "Refresh",exact:true}).click(); await expect(discovery.locator("[data-sector-choice]")).toHaveCount(0);
  check(label + ": access loss removes retained breadth values",!(await discovery.innerText()).includes("59%"));
  await context.close();await browser.close();browser=null;
 }
 check("zero page exceptions",report.errors.length===0,report.errors);report.passed=true;
})().catch(error=>{report.passed=false;report.error=error.stack;process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();fs.writeFileSync(path.join(out,"qualification.json"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.checks.filter(row=>!row.passed),errors:report.errors,error:report.error,screenshots:report.screenshots.length},null,2));
});

/* Actual-owner-body proof for Discover Table -> selected-sector detail -> Market breadth.
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
const report = { sourceRevision: provenance.ref, sourceBodiesChanged: false, transport: "local interception", productionProof: false, independentReviewRequired: false, checks: [], screenshots: [], errors: [] };
function check(name, ok, details) { report.checks.push({ name, passed: !!ok, details }); assert(ok, name); }
async function shot(page, name) { const file = path.join(out, name + ".png"); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push({ name: name + ".png", sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }); }
const technology = data.heatmap.tiles.filter(row => row.sector === "Technology"), targetCompany = technology[0];
assert.equal(technology.length,79);
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
    if (!entry) return route.fulfill({ status: access ? 404 : 401, json: { data: null, receipt: { source:key, path:"", status:access ? "unavailable" : "access", asOf:null, contentHash:null, observedAt:null, stale:false } } });
    return route.fulfill({ status: access ? 200 : 401, json: { data: access ? data[key] : null, receipt: { source: key, path: entry.path.replace(/^site/, ""), status: access ? "ready" : "access", asOf: access ? entry.asOf : null, contentHash: access ? entry.sha256 : null, observedAt: access ? "2026-09-27T12:30:00Z" : null, stale: false } } });
   }
   if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, json: {} }); return route.continue();
  });
  await page.goto(`${origin}/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=table&sector=xlk&sectorMatrixTimeframe=1D&sectorTheme=${theme}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const root = page.getByTestId("sector-intelligence"), discovery = page.getByTestId("sector-discovery"), table = page.getByTestId("sector-company-table");
  await expect(root).toHaveAttribute("data-sector-workspace", "discover");
  await expect(table.locator("[data-company-table-row]")).toHaveCount(79, { timeout:15000 });
  check(label + ": Discover Table uses exact selected-sector population", technology.length === 79);
  check(label + ": source date retained", (await table.innerText()).includes(provenance.files.heatmap.asOf));
  check(label + ": three representation controls remain subordinate to Discover", await discovery.getByRole("group", { name:lang === "zh" ? "发现视图" : "Discover representation", exact:true }).getByRole("button").count() === 3);
  await shot(page, label + "-discover");
  const search = table.getByRole("searchbox"), controls = table.getByRole("combobox");
  check(label + ": Table search and sort meet 44px height", await search.evaluate(el=>el.getBoundingClientRect().height>=44) && await controls.nth(4).evaluate(el=>el.getBoundingClientRect().height>=44));
  await controls.nth(4).selectOption("marketcap"); await search.fill(targetCompany.t);
  await expect(table.locator("[data-company-table-row]")).toHaveCount(1);
  await table.locator(`[data-company-table-row="${targetCompany.t}"] button`).click();
  check(label + ": selected company stays in Discover", new URL(page.url()).searchParams.get("sectorCompany") === targetCompany.t && new URL(page.url()).searchParams.get("sectorWorkspace") === "discover");
  const selected = table.getByTestId("company-table-selection"), openAction = selected.getByRole("button", { name:new RegExp(lang === "zh" ? "打开板块情报" : "Open sector intelligence") });
  const prior = page.url(); await openAction.click(); await expect(root).toHaveAttribute("data-sector-workspace","detail");
  const tech = data.sector.sectors.find(row=>row.id==="xlk"), techName = lang === "zh" ? tech.name_zh : tech.name;
  await expect(root.getByText(techName,{exact:true}).first()).toBeVisible();
  check(label + ": selected company does not fabricate a source group join", new URL(page.url()).searchParams.get("group") === "" && await root.locator("[data-company-choice]").count() === 0);
  await root.getByTestId("sector-primary-action").click();
  const groupsDialog = page.getByRole("dialog", { name: lang === "zh" ? "浏览公司分组" : "Browse company groups", exact: true });
  await expect(groupsDialog).toBeVisible(); await groupsDialog.getByRole("searchbox").fill("semiconductors");
  await groupsDialog.locator('[data-group-choice="semiconductors"]').click();
  check(label + ": primary action reaches the real independent source group",new URL(page.url()).searchParams.get("group") === "semiconductors");
  await root.getByTestId("sector-primary-action").click(); await expect(root.getByTestId("sector-company-row")).toHaveCount(14);
  check(label + ": complete Table-to-group-to-company journey",true);
  const discoverReturn = root.getByTestId("sector-detail-return");
  const expected = new URL(prior), expectedState = JSON.stringify([...expected.searchParams.entries()].sort());
  await discoverReturn.click(); await expect(root).toHaveAttribute("data-sector-workspace","discover");
  await expect.poll(()=>{const current=new URL(page.url());return current.pathname+JSON.stringify([...current.searchParams.entries()].sort());}).toBe(expected.pathname+expectedState);
  const returnedTable = page.getByTestId("sector-company-table"), returnedSearch = returnedTable.getByRole("searchbox"), returnedSort = returnedTable.getByRole("combobox").nth(4);
  await expect(returnedSearch).toHaveValue(targetCompany.t); check(label + ": explicit return restores company sort", await returnedSort.inputValue() === "marketcap");
  await expect(openAction).toBeFocused(); check(label + ": explicit return restores Table action focus",true);
  await returnedSearch.fill("");
  const workspaceNav = root.getByRole("navigation", { name: lang === "zh" ? "板块工作区视图" : "Sector workspace views", exact: true });
  await workspaceNav.getByRole("button", { name:lang === "zh" ? "市场广度" : "Market breadth", exact:true }).click();
  await expect(root).toHaveAttribute("data-sector-workspace","breadth");
  const breadth = page.getByTestId("sector-discovery"); await expect(breadth.locator("[data-sector-choice]")).toHaveCount(11);
  const techCard = breadth.locator('[data-sector-choice="xlk"]');
  check(label + ": breadth keeps supplied population and common scale", (await techCard.innerText()).includes(`${tech.heat.breadth_pct}%`) && await techCard.locator("span[style]").evaluate(el=>el.style.width)===`${tech.heat.breadth_pct}%`);
  await shot(page,label+"-breadth");
  const last=breadth.locator("[data-sector-choice]").last();await last.scrollIntoViewIfNeeded();const targetSector=await last.getAttribute("data-sector-choice");await last.click();
  await expect(root).toHaveAttribute("data-sector-workspace","breadth"); check(label+": breadth selection stays in breadth",new URL(page.url()).searchParams.get("sector")===targetSector);
  const breadthOpen=breadth.getByTestId("sector-discovery-selection").getByRole("button");await breadthOpen.scrollIntoViewIfNeeded();const beforeScroll=await root.evaluate(el=>({inner:el.scrollTop,outer:window.scrollY}));
  await breadthOpen.click();await expect(root).toHaveAttribute("data-sector-workspace","detail");await root.getByTestId("sector-detail-return").click();await expect(root).toHaveAttribute("data-sector-workspace","breadth");
  await expect.poll(async()=>root.evaluate((el,p)=>Math.max(Math.abs(el.scrollTop-p.inner),Math.abs(window.scrollY-p.outer)),beforeScroll)).toBeLessThan(3);
  await expect(breadthOpen).toBeFocused();check(label+": breadth return restores list position and open focus",true,beforeScroll);
  const breadthSearch=breadth.getByRole("searchbox"), source=breadth.getByRole("button",{name:lang === "zh" ? "来源" : "Sources",exact:true});
  await source.click();const dialog=page.getByRole("dialog",{name:lang === "zh" ? "来源" : "Sources",exact:true});await expect(dialog).toBeVisible();
  check(label+": Sources remains contextual to breadth",(await dialog.innerText()).includes(lang === "zh" ? "市场广度" : "Market breadth"));
  await page.keyboard.press("Escape");await expect(dialog).not.toBeVisible();await expect(source).toBeFocused();
  await breadthSearch.fill("NO_SUCH_SECTOR");await expect(breadth.locator("[data-sector-choice]")).toHaveCount(0);
  await breadth.getByRole("button",{name:lang === "zh" ? "清除搜索" : "Clear search",exact:true}).click();await expect(breadth.locator("[data-sector-choice]")).toHaveCount(11);
  check(label+": empty breadth search recovers without reload",true);
  const dims=await root.evaluate(el=>({inner:el.scrollWidth-el.clientWidth,document:document.documentElement.scrollWidth-document.documentElement.clientWidth}));check(label+": no horizontal overflow",dims.inner<=1&&dims.document<=1,dims);
  access=false;await root.getByRole("button",{name:lang === "zh" ? "刷新" : "Refresh",exact:true}).click();await expect(breadth.locator("[data-sector-choice]")).toHaveCount(0);
  check(label+": access loss removes retained breadth values",!(await breadth.innerText()).includes(`${tech.heat.breadth_pct}%`));
  await context.close();await browser.close();browser=null;
 }
 check("zero page exceptions",report.errors.length===0,report.errors);report.passed=true;
})().catch(error=>{report.passed=false;report.error=error.stack;process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();fs.writeFileSync(path.join(out,"qualification.json"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.checks.filter(row=>!row.passed),errors:report.errors,error:report.error,screenshots:report.screenshots.length},null,2));
});

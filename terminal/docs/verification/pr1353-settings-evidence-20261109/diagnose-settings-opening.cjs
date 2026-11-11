"use strict";
const { resolve, join, dirname } = require("node:path");
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const Module = require("node:module");
const root = resolve(__dirname, "../../..");
process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, "test-results/pr1353-settings-evidence-20261109/playwright-browsers");
const { startLegacyServer, waitLegacyServer, settleLegacyServer } = require(join(root, "e2e/tools/capture_ci_evidence.cjs"));
const { chromium } = require(join(root, "node_modules/@playwright/test"));
const port = 3805, base = "http://127.0.0.1:" + port;
process.env.TERMINAL_CROP_PORT = String(port);
const reportPath = join(__dirname, "settings-opening-diagnostic.json");
if (existsSync(reportPath)) throw new Error("Existing diagnostic must be reconciled");
const report = { startedAt: new Date().toISOString(), port, cases: [], serverSettled: false };
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
global.__pr1353Observe = async (page, stage) => {
  const observation = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button[aria-label="Settings"], button[aria-label="设置"]'))
      .filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height)
      .map(el => {
        const ancestry = []; let p = el;
        for (let i = 0; p && i < 8; i++, p = p.parentElement) ancestry.push({
          tag: p.tagName, class: p.className, testid: p.getAttribute("data-testid"),
          busy: p.getAttribute("aria-busy"), id: p.id,
        });
        return { outer: el.outerHTML, ancestry };
      });
    return { href: location.href, readyState: document.readyState, visualReady: Boolean(window.__pr1353VisualReady), visualReadyAt: window.__pr1353VisualReadyAt ?? null, observedAt: performance.now(), buttons,
      openCards: document.querySelectorAll(".acs-overlay.open .acs-card").length,
      visibleText: document.body.innerText.slice(0, 4000) };
  });
  report.cases.at(-1).observations.push({ stage, at: new Date().toISOString(), ...observation }); save();
};
const file = join(root, "e2e/tools/capture_w9t_f08_13_targets.cjs");
let source = readFileSync(file, "utf8");report.producerSha256 = createHash("sha256").update(source).digest("hex");
const click = "await page.locator('button[aria-label=\"Settings\"]:visible, button[aria-label=\"设置\"]:visible').first().click();";
if (source.split(click).length !== 2) throw new Error("Click diagnostic anchor changed");
source = source.replace(click, 'await global.__pr1353Observe(page, "before-click");\n  ' + click + '\n  await global.__pr1353Observe(page, "after-click");');
const main = "main().catch(error => { console.error(error); process.exitCode = 1; });";
if (source.split(main).length !== 2) throw new Error("Native entrypoint changed");
source = source.replace(main, "module.exports = { gotoSettings };");
const producer = new Module(file, module);producer.filename=file;producer.paths=Module._nodeModulePaths(dirname(file));producer._compile(source,file);
(async () => {
  const child = startLegacyServer(root, port);report.serverPid=child.pid;save();
  let browser;
  try {
    await waitLegacyServer(child, base + "/terminal?symbol=NVDA", 180000);
    browser = await chromium.launch({ headless: true });
    for (const lang of ["en", "zh"]) {
      const row = { lang, state: "empty", width: 390, observations: [], pageErrors: [], consoleErrors: [] };
      report.cases.push(row);save();
      const context = await browser.newContext({ viewport:{width:390,height:844},hasTouch:true,locale:lang==="zh"?"zh-CN":"en-US",colorScheme:"dark",deviceScaleFactor:2 });
      try {
        await context.addCookies([{name:"mm_e2e_wl",value:"settings-diagnostic-"+randomUUID(),url:base}]);
        for (const suffix of ["/api/portfolio?view=positions","/api/portfolio/targets"]) {
          const res=await context.request.get(base+suffix);if(!res.ok())throw Error("Native diagnostic readback "+res.status());
        }
        const page=await context.newPage();await page.addInitScript(() => { window.__pr1353VisualReady = false; window.addEventListener("mm:terminal-visual-ready", () => { window.__pr1353VisualReady = true; window.__pr1353VisualReadyAt = performance.now(); }); });page.on("pageerror",e=>{row.pageErrors.push(e.message);save();});
        page.on("console",m=>{if(m.type()==="error"){row.consoleErrors.push(m.text());save();}});
        try { await producer.exports.gotoSettings(page,lang);row.opened=true; }
        catch(error){row.opened=false;row.error={name:error.name,message:error.message};}
        await global.__pr1353Observe(page,"final");
        await page.screenshot({path:join(__dirname,"diagnostic-settings-"+lang+".png"),fullPage:false});
      } finally {await context.close();save();}
    }
  } finally {
    if(browser)await browser.close();
    await settleLegacyServer(child);report.serverSettled=true;report.completedAt=new Date().toISOString();save();
  }
  console.log(JSON.stringify({cases:report.cases.map(c=>({lang:c.lang,opened:c.opened,pageErrors:c.pageErrors,observations:c.observations.map(o=>({stage:o.stage,readyState:o.readyState,openCards:o.openCards,buttons:o.buttons}))})),serverSettled:report.serverSettled}));
})().catch(e=>{report.error=e.message;save();console.error(e);process.exitCode=1;});

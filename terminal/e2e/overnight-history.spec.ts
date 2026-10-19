import {test, expect} from "@playwright/test";
import {mkdirSync} from "node:fs";
for (const lang of ["en","zh"] as const) test(`${lang}: captured BOATS history survives a page reload`,async({page},testInfo)=>{
 test.slow();
 await page.addInitScript(({lang})=>{
  localStorage.setItem("mm.startTf",JSON.stringify("5m"));
  localStorage.setItem("mm.inds",JSON.stringify([]));
  localStorage.setItem("mm.lang",lang);
  localStorage.setItem("mm.chartSettings",JSON.stringify({extHours:true,overnightHours:true}));
  localStorage.removeItem("mm.ws");
 },{lang});
 let reads=0;
 await page.route("**/api/intraday?**",async route=>{
  const query=new URL(route.request().url()).searchParams;
  if (query.get("session") !== "24h") {
   await route.fulfill({json:{t:"AMD",tf:query.get("tf"),bars:[]}});
   return;
  }
  reads++;
  await route.fulfill({json:{t:"AMD",tf:"5m",bars:[
   [Date.parse("2026-10-08T20:00:00Z")/1000,200,202,199,201,123],
   [Date.parse("2026-10-08T20:05:00Z")/1000,201,203,200,202,234]],
   boats_history:{schema:"terminal.tiingo_boats_history_evidence.v1",status:"available",source:"tiingo-boats-rest",venue:"BOATS",complete:false,volume_basis:"vendor_reported_shares",returned_bars:2}}});
 });
 await page.route("**/api/ext-quote?**",async route=>route.fulfill({json:{quotes:{}}}));
 await page.goto("/terminal?symbol=AMD");
 const coverage=page.getByTestId("chart-24h-coverage");
 const expected=lang==="zh"?"已载入历史K线":"Captured history available";
 await expect(coverage).toContainText(expected,{timeout:45000});
 const before=reads;
 await page.reload();
 await expect(coverage).toContainText(expected,{timeout:45000});
 expect(reads).toBeGreaterThan(before);
 await expect(page.locator(".chart-wrap").first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 const dir="docs/pr-crops/overnight-history-20261019"; mkdirSync(dir,{recursive:true});
 await page.screenshot({path:`${dir}/${testInfo.project.name}-${lang}.png`});
});

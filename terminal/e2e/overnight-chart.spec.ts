import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
const now = Date.parse("2026-10-19T01:15:00Z"); // Sunday 21:15 ET
test("12h 24H countdown ends at the post-market boundary", async ({page}) => {
 await page.addInitScript(() => {
  Date.now=()=>Date.parse("2026-10-19T20:05:00Z"); // 16:05 ET
  localStorage.setItem("mm.startTf",JSON.stringify("12h"));
  localStorage.setItem("mm.inds",JSON.stringify([]));
  localStorage.setItem("mm.lang","en");
  localStorage.setItem("mm.chartSettings",JSON.stringify({extHours:true,overnightHours:true}));
  localStorage.removeItem("mm.ws");
 });
 await page.route("**/api/intraday?**", route=>route.fulfill({json:{t:"NVDA",tf:"12h",bars:[
  [Date.parse("2026-10-19T09:30:00Z")/1000,100,102,99,101,1000],
  [Date.parse("2026-10-19T16:00:00Z")/1000,101,103,100,102,100],
 ]}}));
 await page.route("**/api/ext-quote?**",route=>route.fulfill({json:{quotes:{}}}));
 await page.goto("/terminal?symbol=NVDA");
 await expect(page.getByTestId("chart-24h-coverage")).toBeVisible({timeout:45000});
 await expect(page.locator(".mm-ptag-cd").first()).toHaveText("03:55:00",{timeout:45000});
});

async function settings(page: Page) {
 if (page.viewportSize()!.width <= 640) {
  await page.getByTestId("roller-more").click();
  await page.getByTestId("hub-tile-chartSettings").click();
 } else {
  await page.locator(".cfb-gear").first().click();
  await page.locator(".qsg-menu .qsg-item").last().click();
 }
 const dialog=page.locator("dialog.sm-backdrop");
 await expect(dialog).toBeVisible();
 await dialog.locator('[data-settings-tab="symbol"]').click();
 return dialog;
}
for (const lang of ["en","zh"] as const) for (const theme of ["dark","light"] as const) {
 test(`${lang} ${theme}: opt-in BOATS chart is honest about overnight coverage`,async({page},testInfo)=>{
  test.slow();
  let sampled=false;
  await page.addInitScript(({lang,theme,now})=>{
   Date.now=()=>now;
   localStorage.setItem("mm.startTf",JSON.stringify("5m"));
   localStorage.setItem("mm.inds",JSON.stringify([]));
   localStorage.setItem("mm.lang",lang);
   localStorage.setItem("theme",theme);
   localStorage.setItem("mmx.shell.theme",theme);
   localStorage.setItem("theme_auto","0");
   localStorage.setItem("mm.chartSettings",JSON.stringify({extHours:true,overnightHours:true}));
   localStorage.removeItem("mm.ws");
  },{lang,theme,now});
  await page.route("**/api/intraday?**",async route=>{
   sampled=new URL(route.request().url()).searchParams.get("session")==="24h";
   await route.fulfill({json:{t:"NVDA",tf:"5m",bars:[[Date.parse("2026-10-16T19:55:00Z")/1000,100,101,99,100,1000]]}});
  });
  await page.route("**/api/ext-quote?**",async route=>route.fulfill({json:{quotes:{NVDA:{
   extSource:"tiingo_boats",extBasis:"LIVE",extVenue:"BOATS",extPriceKind:"LAST_TRADE",extSession:"overnight",
   extPrice:105,extChg:null,extTs:now/1000,extReceivedTs:now/1000,extPublishedTs:now/1000,extExpiresTs:now/1000+30,
   extCaptureId:"12345678-1234-1234-1234-123456789abc",extGeneration:1,
  }}}}));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.getByTestId("chart-24h-coverage")).toBeVisible({timeout:45000});
  await expect.poll(()=>sampled).toBe(true);
  const chart=page.locator(".chart-wrap").first();
  await expect(chart).toHaveAttribute("data-live-close","105",{timeout:45000});
  await expect(chart).toHaveAttribute("data-live-time",String(Date.parse("2026-10-18T21:15:00Z")/1000));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  // The chart route currently pins its incumbent dark presentation. Exercise
  // the existing light token consumer explicitly; this is visual fixture
  // evidence, not a claim that the chart has a persisted light-theme picker.
  await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
  const crops="docs/pr-crops/overnight-chart-20261018";
  mkdirSync(crops,{recursive:true});
  await page.screenshot({path:`${crops}/${testInfo.project.name}-${lang}-${theme}-chart.png`});
  const dialog=await settings(page);
  const session=dialog.getByLabel(lang==="zh"?"交易时段":"Session",{exact:true});
  await expect(session).toHaveValue("24h");
  await page.screenshot({path:`${crops}/${testInfo.project.name}-${lang}-${theme}.png`});
  await session.selectOption("regular");
  await dialog.locator(".sm-ok").click();
  await expect(page.getByTestId("chart-24h-coverage")).toHaveCount(0);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("mm.chartSettings")||"{}"));
  expect(saved.overnightHours).toBe(false);
  expect(saved.extHours).toBe(false);
 });
}

for (const tf of ["D", "12h"] as const) {
 test(`24H settings respect ${tf} timeframe eligibility without losing the saved preference`, async ({ page }) => {
  await page.addInitScript(({tf}) => {
   localStorage.setItem("mm.startTf",JSON.stringify(tf));
   localStorage.setItem("mm.inds",JSON.stringify([]));
   localStorage.setItem("mm.lang","en");
   localStorage.setItem("mm.chartSettings",JSON.stringify({extHours:true,overnightHours:true}));
   localStorage.removeItem("mm.ws");
  },{tf});
  await page.route("**/api/intraday?**", async route => route.fulfill({json:{t:"NVDA",tf,bars:[]}}));
  await page.route("**/api/ext-quote?**", async route => route.fulfill({json:{quotes:{}}}));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap").first()).toBeVisible({timeout:45000});
  const dialog=await settings(page);
  const session=dialog.getByLabel("Session",{exact:true});
  if (tf === "D") {
   await expect(session).toHaveValue("extended");
   await expect(session.locator('option[value="24h"]')).toHaveCount(0);
   await expect(page.getByTestId("chart-24h-coverage")).toHaveCount(0);
  } else {
   await expect(session).toHaveValue("24h");
   await expect(session.locator('option[value="24h"]')).toHaveCount(1);
  }
  await dialog.locator(".sm-ok").click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("mm.chartSettings")||"{}").overnightHours)).toBe(true);
 });
}

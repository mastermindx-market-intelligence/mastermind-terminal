import { test, expect } from "@playwright/test";
import { reportedGammaBook } from "../lib/__tests__/fixtures/reportedGammaBooks";
// Synthetic source/identity only. Does not exercise a production account or provider.
for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
 test(`reported Gamma exact host consumer ${lang} ${theme}`, async ({page}, info) => {
  const t=(en:string,zh:string)=>lang==="en"?en:zh;
  await page.context().addCookies([{name:"mm_e2e_rs30",value:"1",domain:"127.0.0.1",path:"/"}]);
  await page.addInitScript(lang=>localStorage.setItem("mm.lang",lang),lang);
  const reads:string[]=[];
  await page.route("**/api/flow?*",async route=>{
   const f=new URL(route.request().url()).searchParams.get("f");if(f)reads.push(f);
   if(f==="matrix:SPY")return route.fulfill({json:{schema:"options_structure.matrix/v1",root:"SPY",session:"2026-10-19",cells:[{strike:100,expiry:"2026-10-23",call_vol:243,call_oi:110,put_vol:9,put_oi:2}]}});
   if(f==="gex:SPY")return route.fulfill({json:reportedGammaBook("2026-10-19")});
   if(f==="gex_dates:SPY")return route.fulfill({json:{root:"SPY",dates:["2026-10-19","2026-10-16"],latest:"2026-10-19"}});
   if(f==="gex_at:SPY:2026-10-16")return route.fulfill({json:reportedGammaBook("2026-10-16",2)});
   return route.fallback();
  });
  // GexDesk prefers the incumbent SSE frame; bind that actual host input too.
  await page.route("**/api/flow/stream?*",async route=>{
   if(new URL(route.request().url()).searchParams.get("f")==="gex:SPY")
    return route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify(reportedGammaBook("2026-10-19"))}\n\n`});
   return route.fallback();
  });
  await page.goto("/options?tab=gex&view=research");
  const lab=page.getByRole("region",{name:t("3D Research Lab","3D 期权研究室"),exact:true});
  await expect(lab).toBeVisible({timeout:45000});
  await page.evaluate(theme=>document.documentElement.setAttribute("data-theme",theme),theme);
  await lab.getByRole("button",{name:t("100 Call · 2026-10-23","100 看涨 · 2026-10-23"),exact:true}).click();
  await lab.getByRole("button",{name:t("Replay & change","回放与变化"),exact:true}).click();
  const panel=lab.getByTestId("research-reported-gamma");
  await expect(panel).toHaveAttribute("data-comparison-state","data");
  await expect(panel).toContainText(t("reported Gamma dollars","已报告 Gamma 美元"));
  await expect(panel.getByTestId("research-reported-gamma-pin")).toHaveAttribute("data-pin-state","pinned");
  await expect(panel).toContainText("+20K → +10K");
  await expect(panel).toContainText(t("historical PIT claim","历史时点可得性声明"));
  const details=panel.getByTestId("research-reported-gamma-details");
  await details.locator("summary").click();await expect(details).toHaveAttribute("open","");
  await expect(details).toContainText("2026-10-20T10:00:00Z");
  await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(reads.filter(x=>x==="gex_at:SPY:2026-10-16").length).toBe(1);
  await panel.screenshot({path:info.outputPath(`gamma-${lang}-${theme}.png`)});
  await lab.getByRole("button",{name:t("Chain landscape","期权链分布"),exact:true}).click();
  await expect(panel).toHaveCount(0);
  await expect(lab.getByTestId("research-inspector")).toContainText(t("Not in this snapshot","此快照未提供"));
 });
}

import {expect,test,type Page} from "@playwright/test";
import {useLang} from "./layoutStore";

// Real mounted chart and Seasonality reader, deterministic feed/auth fixtures.
// Brain's script is suppressed; its existing host envelope remains observable.
async function symbol(page:Page,id:string){
 await page.evaluate(symbol=>window.dispatchEvent(new CustomEvent("mm:embedded-symbol",{detail:{symbol}})),id);
 await expect.poll(()=>page.evaluate(()=>{
  const cfg=(window as unknown as {MM_BRAIN_CFG?:{getAiContext?:()=>{active?:{id:string}}}}).MM_BRAIN_CFG;
  return cfg?.getAiContext?.().active?.id;
 })).toBe(id);
}
for(const lang of ["en","zh"] as const)test(`${lang}: a pinned view retains its own symbol while Brain follows the chart`,async({page},testInfo)=>{
 test.setTimeout(90_000);
 await useLang(page,lang);
 await page.route("https://www.mastermind-x.com/mm_brain.js",route=>route.fulfill({contentType:"application/javascript",body:""}));
 const writes:string[]=[];
 page.on("request",request=>{
  if(request.url().includes("/api/")&&!["GET","HEAD","OPTIONS"].includes(request.method()))writes.push(new URL(request.url()).pathname);
 });
 await page.goto("/terminal?symbol=NVDA");
 const card=page.getByRole("region",{name:lang==="en"?"Seasonality view context":"季节性视图上下文"});
 const status=card.locator('p[role="status"]');
 const pin=card.getByRole("button",{name:lang==="en"?"Pin this view":"固定此视图",exact:true});
 const follow=card.getByRole("button",{name:lang==="en"?"Follow chart":"跟随图表",exact:true});
 await expect(status).toContainText("NVDA",{timeout:45_000});
 await expect(card.getByTestId("seasonality-context")).toContainText("NVDA");
 await card.scrollIntoViewIfNeeded();
 await pin.click();await expect(pin).toHaveAttribute("aria-pressed","true");
 await symbol(page,"AAPL");
 await expect(status).toContainText(lang==="en"?"pinned to NVDA; chart is AAPL":"固定为 NVDA；图表为 AAPL");
 await expect(card.getByTestId("seasonality-context")).toContainText("NVDA");
 await expect(card.getByRole("link")).toHaveAttribute("href","/analysis?symbol=NVDA");
 await card.getByRole("button",{name:lang==="en"?"Unlink":"取消关联",exact:true}).click();
 await symbol(page,"MSFT");
 await expect(status).toContainText(lang==="en"?"unlinked at NVDA; chart is MSFT":"保留 NVDA；图表为 MSFT");
 await follow.click();await expect(status).toHaveText(lang==="en"?"Following chart: MSFT":"跟随图表：MSFT");
 await expect(card.getByTestId("seasonality-context")).toContainText("MSFT");
 await expect(card.getByRole("link")).toHaveCount(0);
 // At narrow width with all page text doubled, the same controls remain keyboard usable.
 if(testInfo.project.name==="mobile"){
  await page.setViewportSize({width:320,height:844});
  await page.evaluate(()=>{
   const nodes=Array.from(document.querySelectorAll<HTMLElement>("body *"));
   const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
   nodes.forEach((node,i)=>node.style.fontSize=`${sizes[i]*2}px`);
  });
  await follow.focus();await page.keyboard.press("Tab");await expect(pin).toBeFocused();
  await page.keyboard.press("Enter");await expect(pin).toHaveAttribute("aria-pressed","true");
  expect(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 }
 await card.screenshot({path:testInfo.outputPath(`context-${lang}.png`)});
 // Existing chart mirroring and owner preference writes are observed separately;
 // no context-control operation may create a layout, Investigation or Brain pin.
 expect(writes.filter(path=>/layouts|investigations|pin/.test(path))).toEqual([]);
});

import {boatsQuote} from "./fixtures/boatsQuote";
import {expect,test} from "@playwright/test";

// Real browser/renderer with synthetic response interception, never market proof.
for(const lang of ["en","zh"] as const){
 test(`BOATS single-venue label, age and independent expiry (${lang})`,async({page},info)=>{
  test.setTimeout(60_000);
  await page.clock.install();
  await page.addInitScript(language=>{
   localStorage.setItem("mm.lang",language);localStorage.setItem("theme","dark");localStorage.setItem("theme_auto","0");
   localStorage.setItem("mm.setVersion","1");localStorage.setItem("mm.set",JSON.stringify({tableView:true,
    cols:{last:true,changePct:true,change:false,volume:false,ext:true,extPct:true},disp:"symbol",logo:true,colW:{}}));
  },lang);
  let outage=false;
  await page.route("**/api/ext-quote?**",async route=>{
   if(outage){await route.fulfill({status:503,json:{error:"quote_hub_unavailable"}});return;}
   const quote=boatsQuote(100,1);
   const syms=(new URL(route.request().url()).searchParams.get("syms")||"").split(",");
   await route.fulfill({json:{quotes:Object.fromEntries(syms.map(sym=>[sym,sym==="NVDA"?quote:null]))}});
  });
  await page.route("**/api/quote?**",async route=>{
   const syms=(new URL(route.request().url()).searchParams.get("syms")||"NVDA").split(",");
   await route.fulfill({json:{quotes:Object.fromEntries(syms.map(sym=>[sym,sym==="NVDA"?
    {sym,last:192.53,prevClose:195.74,chg:-1.64,regularPrice:192.53,regularChg:-1.64,basis:"DELAYED_15M"}:null]))}});
  });
  await page.goto("/terminal?symbol=NVDA");
  const desktop=info.project.name==="desktop";
  const surface=desktop?page.locator(".ah-block"):page.locator('[data-quote-lane="extended"]');
  await expect(surface).toContainText("100.00",{timeout:30_000});
  await expect(surface).toContainText("BOATS");
  if(desktop)await expect(surface).toContainText(lang==="zh"?"最新合格成交 · 单一场所":"Latest qualifying BOATS trade · single venue");
  else await expect(surface.locator(".m-ext-label")).toHaveAttribute("title",lang==="zh"?/BOATS 最新合格成交 · 单一场所/:/Latest qualifying BOATS trade · single venue/);
  const regular=page.locator('[data-quote-lane="regular"]').first();
  await expect(regular).toContainText("192.53");
  const before=await regular.textContent();
  await page.screenshot({path:info.outputPath(`boats-${info.project.name}-${lang}.png`),fullPage:false});
  outage=true;
  await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
  await expect(surface).toContainText("100.00");
  await page.clock.fastForward(31_000);
  await expect(surface).toHaveCount(0);
  if(before!=null)expect(await page.locator('[data-quote-lane="regular"]').first().textContent()).toBe(before);
  if(desktop){const row=page.locator(".wl-row",{has:page.locator(".tk",{hasText:/^NVDA$/})});
   await expect(row.locator('[data-watchlist-column="ext"]')).toHaveText("—");}
 });
}

test("coalesced trailing null clears BOATS and a later failure cannot revive it",async({page},info)=>{
 test.setTimeout(60_000);
 const q=boatsQuote(100,1);
 let phase:"initial"|"hold"|"empty"|"failure"="initial";
 let held:import("@playwright/test").Route|null=null;
 let requests=0;
 await page.route("**/api/ext-quote?**",async route=>{
  requests++;
  if(phase==="hold"){held=route;return;}
  if(phase==="failure"){await route.fulfill({status:503,json:{error:"quote_hub_unavailable"}});return;}
  await route.fulfill({json:{quotes:{NVDA:phase==="empty"?null:q}}});
 });
 // Deliberate poison in the unrelated quote namespace also cannot revive BOATS.
 await page.route("**/api/quote?**",async route=>{
  await route.fulfill({json:{quotes:{NVDA:{sym:"NVDA",last:192.53,regularPrice:192.53,regularChg:-1.64,...q}}}});
 });
 await page.goto("/terminal?symbol=NVDA");
 const surface=info.project.name==="desktop"?page.locator(".ah-block"):page.locator('[data-quote-lane="extended"]');
 await expect(surface).toContainText("100.00",{timeout:30_000});
 phase="hold";await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
 await expect.poll(()=>held!==null).toBe(true);
 const heldRequestCount=requests;
 phase="empty";
 await page.evaluate(()=>{
  for(let i=0;i<3;i++)document.dispatchEvent(new Event("visibilitychange"));
 });
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 // A trigger cannot manufacture an authoritative empty result while the sole request is held.
 expect(requests).toBe(heldRequestCount);
 await expect(surface).toContainText("100.00");
 const emptyResponse=page.waitForResponse(async response=>{
  if(!response.url().includes("/api/ext-quote?")||response.status()!==200)return false;
  const body=await response.json().catch(()=>null);
  return body?.quotes?.NVDA===null;
 });
 await held!.fulfill({json:{quotes:{NVDA:q}}});
 await emptyResponse;
 await expect(surface).toHaveCount(0);
 expect(requests).toBe(heldRequestCount+1); // exactly one coalesced catch-up
 expect(await page.evaluate(()=>Date.now()/1000)-q.extTs).toBeLessThan(25); // not freshness expiry
 phase="failure";
 const failedResponse=page.waitForResponse(response=>response.url().includes("/api/ext-quote?")&&response.status()===503);
 await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
 await failedResponse;
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(surface).toHaveCount(0);
});

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
 // Hold browser time below the recurring 5s/30s poll cadence. Only the
 // visibility triggers and their zero-delay catch-up belong to this assertion.
 const start=new Date();
 await page.clock.install({time:start});
 await page.clock.pauseAt(start);
 const q=boatsQuote(100,1,start.getTime()/1000-1);
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
 await page.clock.runFor(1_000); // settle initial debounce/catch-up timers
 const surface=info.project.name==="desktop"?page.locator(".ah-block"):page.locator('[data-quote-lane="extended"]');
 await expect(surface).toContainText("100.00",{timeout:30_000});
 await page.clock.runFor(100); // retire any bootstrap catch-up before the baseline
 phase="hold";await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
 await expect.poll(()=>held!==null).toBe(true);
 const heldRequestCount=requests;
 phase="empty";
 await page.evaluate(()=>{
  for(let i=0;i<3;i++)document.dispatchEvent(new Event("visibilitychange"));
 });
 await page.clock.runFor(50); // run animation frames while wall-clock timers stay paused
 // A trigger cannot manufacture an authoritative empty result while the sole request is held.
 expect(requests).toBe(heldRequestCount);
 await expect(surface).toContainText("100.00");
 const emptyResponse=page.waitForResponse(async response=>{
  if(!response.url().includes("/api/ext-quote?")||response.status()!==200)return false;
  const body=await response.json().catch(()=>null);
  return body?.quotes?.NVDA===null;
 });
 await held!.fulfill({json:{quotes:{NVDA:q}}});
 // The fulfilled fetch may enqueue its catch-up after the route promise
 // settles. Advance only 1ms per observation until that exact request arrives.
 await expect.poll(async()=>{
  await page.clock.runFor(1);
  return requests;
 },{timeout:3_000,intervals:[25]}).toBe(heldRequestCount+1);
 await emptyResponse;
 await expect(surface).toHaveCount(0);
 expect(requests).toBe(heldRequestCount+1); // exactly one coalesced catch-up
 expect(await page.evaluate(()=>Date.now())-start.getTime()).toBeLessThan(2_000);
 expect(await page.evaluate(()=>Date.now()/1000)-q.extTs).toBeLessThan(25); // not freshness expiry
 phase="failure";
 const failedResponse=page.waitForResponse(response=>response.url().includes("/api/ext-quote?")&&response.status()===503);
 await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
 await failedResponse;
 await page.clock.runFor(50); // run animation frames while wall-clock timers stay paused
 await expect(surface).toHaveCount(0);
});

// A previous accessibility pass removed the visible quote stack from the button's
// accessible name. The replacement description must preserve the same BOATS age
// as the visible label, not merely its venue and price. Fixture only, not proof of
// actual market freshness or data vendor coverage.
for (const lang of ["en", "zh"] as const) {
  test(`mobile symbol search describes the same BOATS observation age (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "Mobile symbol bar is the owner of this description");
    test.setTimeout(90_000);
    const fixedMs = new Date("2026-11-14T02:00:00.000Z").getTime();
    await page.clock.install({ time: new Date(fixedMs) });
    // The clock starts at one fixed instant, then ticks during real Next.js hydration.
    // Each intercepted observation is dated relative to that same emulated clock,
    // avoiding a fixture becoming 30s stale during an unrelated cold compile.
    const wallAnchorMs = Date.now();
    await page.addInitScript(language => {
      localStorage.setItem("mm.lang", language);
      localStorage.setItem("theme", "dark");
      localStorage.setItem("theme_auto", "0");
    }, lang);
    let observedAgeSeconds = 3;
    await page.route("**/api/ext-quote?**", route => route.fulfill({
      json: { quotes: { NVDA: boatsQuote(100, 1,
        (fixedMs + Date.now() - wallAnchorMs) / 1000 - observedAgeSeconds) } },
    }));
    await page.route("**/api/quote?**", route => route.fulfill({
      json: { quotes: { NVDA: { sym: "NVDA", last: 192.53, prevClose: 195.74,
        chg: -1.64, regularPrice: 192.53, regularChg: -1.64, basis: "DELAYED_15M" } } },
    }));
    await page.goto("/terminal?symbol=NVDA");
    const opener = page.locator(".m-symbar button[data-symbol-search]");
    await expect(opener).toHaveAccessibleName(/NVDA/);
    const id = await opener.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const description = page.locator(`[id="${id}"]`);
    const label = page.locator(".m-ext-label");
    const venue = lang === "zh" ? "BOATS 最新合格成交 · 单一场所" : "Latest qualifying BOATS trade · single venue";
    const visibleAge = lang === "zh" ? /^BOATS · (\d+)秒$/ : /^BOATS · (\d+)s$/;
    const descriptionAge = lang === "zh" ? / · (\d+)秒前/ : / · (\d+)s ago/;
    const observe = async () => {
      const visible = await label.textContent().catch(() => null);
      const described = await description.textContent().catch(() => null);
      const v = visible?.match(visibleAge), d = described?.match(descriptionAge);
      const seconds = Number(v?.[1]);
      return { seconds, described,
        coherent: !!v && !!d && v[1] === d[1] &&
          !!described?.includes(venue) && !!described?.includes("192.53") &&
          !!described?.includes("100.00") && !!described?.includes("+1.00%") };
    };
    await expect.poll(async () => (await observe()).coherent, { timeout: 20_000 }).toBe(true);
    const first = await observe();
    // A newer route response changes only the observation time: the displayed
    // and described ages must agree despite hydration and the advancing clock.
    observedAgeSeconds = 20;
    await page.reload();
    await expect.poll(async () => {
      const second = await observe();
      return second.coherent && second.seconds > first.seconds + 5 && second.seconds >= 20;
    }, { timeout: 20_000 }).toBe(true);
    const second = await observe();
    expect(second.described?.replace(descriptionAge, " · {AGE}")).toBe(
      first.described?.replace(descriptionAge, " · {AGE}"));
    await expect(opener).toHaveAccessibleName(/NVDA/);
  });
}

test("mobile search does not manufacture an extended quote for an unqualified venue", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "Phone quote contract");
  await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {
    NVDA: { extSource: "other", extSession: "pre", extPrice: 100, extChg: 1 },
  } } }));
  await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {
    NVDA: { sym: "NVDA", last: 192.53, chg: -1.64, regularPrice: 192.53, regularChg: -1.64, basis: "DELAYED_15M" },
  } } }));
  await page.goto("/terminal?symbol=NVDA");
  const opener = page.locator(".m-symbar button[data-symbol-search]");
  await expect(opener).toHaveAccessibleName(/NVDA/);
  const id = await opener.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const description = page.locator(`[id="${id}"]`);
  await expect(description).toContainText("192.53");
  await expect(description).not.toContainText(/BOATS|100\.00|Pre-market/);
  await expect(page.locator(".m-symbar [data-quote-lane='extended']")).toHaveCount(0);
});

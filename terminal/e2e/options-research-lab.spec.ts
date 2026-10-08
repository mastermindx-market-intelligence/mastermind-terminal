import { expect, test } from "@playwright/test";

// Synthetic consumer qualification only. This is not production-data evidence.
const matrix = { schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-10-06T02:00:00Z", _build_meta: { asof_date: "2026-10-05" }, spot: 774.77,
  cells: Array.from({ length: 15 }, (_,i) => ({ strike: 760+i*5, expiry: i < 8 ? "2026-10-09" : "2026-10-16", gex: -42000,
    call_vol: i===5 ? 243000 : (i+1)*2500, put_vol: i===0 ? 0 : (16-i)*3200, call_oi: 110000, put_oi: null, delta_oi: {call:-10,put:25} })) };

for (const lang of ["en","zh"] as const) {
  test(`3D research lab exact selection and responsive fallback ${lang}`, async ({page}, info) => {
    const errors: string[]=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(l=>localStorage.setItem("mm.lang",l),lang);
    let matrixReads=0, volReads=0;
    await page.route("**/api/flow?*",async route=> {
      if(new URL(route.request().url()).searchParams.get("f")==="matrix:SPY") {matrixReads++;await route.fulfill({json:matrix});}
      else if(new URL(route.request().url()).searchParams.get("f")==="vol:SPY") {volReads++;await route.fulfill({json:{
        schema:"options_hub.vol/v1",root:"SPY",asof:"2026-10-05",
        smile:[{exp:"2026-10-09",points:[{strike:785,call_iv:58.2,put_iv:0}]}],
      }});}
      else await route.fallback();
    });
    await page.goto("/options?tab=gex&view=research");
    const lab=page.getByRole("region",{name:lang==="en"?"3D Research Lab":"3D 期权研究室",exact:true});
    await expect(lab).toBeVisible({timeout:30000});
    const row=lab.getByRole("button",{name:lang==="en"?"785 Call · 2026-10-09":"785 看涨 · 2026-10-09",exact:true});
    await row.click();
    const inspector=lab.getByTestId("research-inspector");
    await expect(inspector).toContainText("243,000");
    await expect(inspector).toContainText("110,000");
    await expect(inspector).toContainText("2.21×");
    await expect(inspector).toContainText("58.2%");
    for(const label of lang==="en"?["Volatility terrain","Replay & change","Flow & packages","Scenario lab","Chain landscape"]:["波动率曲面","回放与变化","成交与组合","情景研究","期权链分布"]){
      await lab.getByRole("button",{name:label,exact:true}).click();await expect(inspector).toContainText("243,000");
    }
    expect(matrixReads).toBe(1);
    expect(volReads).toBe(1);
    if(info.project.name === "mobile") await lab.getByRole("button",{name:"3D",exact:true}).click();
    const canvas=lab.locator("canvas");
    await expect(canvas).toBeVisible();
    await lab.getByRole("heading",{level:2}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`${info.project.name}-${lang}-chain.png`),fullPage:false});
    await canvas.focus(); await page.keyboard.press("ArrowRight");
    await expect(inspector).not.toContainText("243,000");
    await row.click();
    await canvas.dispatchEvent("webglcontextlost");
    await expect(lab.getByRole("status")).toContainText(lang==="en"?"3D unavailable":"3D 不可用");
    await expect(inspector).toContainText("243,000");
    await expect(row).toHaveAttribute("aria-pressed","true");
    await expect(lab.getByRole("button",{name:lang==="en"?"Save investigation":"保存研究",exact:true})).toBeDisabled();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await lab.getByRole("heading",{level:2}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`${info.project.name}-${lang}-fallback.png`),fullPage:false});
  });
}

test("research lab 320px and enlarged body text keeps controls reachable",async({page},info)=>{
  test.skip(info.project.name!=="mobile");
  await page.setViewportSize({width:320,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/api/flow?*",route=>new URL(route.request().url()).searchParams.get("f")==="matrix:SPY"?route.fulfill({json:matrix}):route.fallback());
  await page.goto("/options?tab=gex&view=research");
  const lab=page.getByRole("region",{name:"3D Research Lab",exact:true});
  await expect(lab).toBeVisible();
  await lab.evaluate(node=>{(node as HTMLElement).style.fontSize="26px";});
  await expect(lab.getByRole("button",{name:"3D",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  await expect(lab.getByRole("button",{name:"Back to Exposure",exact:true})).toBeVisible();
  await lab.screenshot({path:info.outputPath("narrow-zoom.png")});
});

test("research lab withdraws values when the existing account authority revokes access", async ({page},info) => {
  test.skip(info.project.name !== "desktop");
  await page.clock.install();
  let declined = false;
  await page.route("**/api/me", route => route.fulfill({json:{tier:declined ? "free" : "unlimited",features:[],status:"active"}}));
  await page.route("**/api/flow?*", route => new URL(route.request().url()).searchParams.get("f")==="matrix:SPY" ? route.fulfill({json:matrix}) : route.fallback());
  await page.goto("/options?tab=gex&view=research");
  const lab=page.getByRole("region",{name:"3D Research Lab",exact:true});
  await expect(lab).toContainText("243,000");
  declined = true;
  await page.clock.fastForward(61000);
  await page.locator(".topbar").getByRole("button",{name:"Settings",exact:true}).click();
  await expect(lab).toContainText("Research values and selections have been withdrawn.");
  await expect(lab).not.toContainText("243,000");
  await expect(lab.locator("canvas")).toHaveCount(0);
});

for (const count of [1000,5000,20000]) test(`research lab ${count} marks picking`,async({page},info)=>{
  test.skip(info.project.name!=="desktop");
  const payload={...matrix,cells:Array.from({length:count/2},(_,i)=>({strike:100+i/100,expiry:"2026-10-09",gex:null,call_vol:i+1,put_vol:i+1,call_oi:null,put_oi:null}))};
  await page.route("**/api/flow?*",route=>new URL(route.request().url()).searchParams.get("f")==="matrix:SPY"?route.fulfill({json:payload}):route.fallback());
  await page.goto("/options?tab=gex&view=research");
  const canvas=page.getByTestId("research-scene").locator("canvas");
  await expect(canvas).toBeVisible({timeout:30000});
  await canvas.click({position:{x:100,y:120}});
  const pickMs=await canvas.getAttribute("data-pick-ms");
  expect(pickMs).not.toBeNull();
  expect(Number.isFinite(Number(pickMs))).toBe(true);
  expect(Number(pickMs)).toBeLessThan(100);
  const measurement={count,pickMs:Number(pickMs),fixture:true,browser:"Playwright Chromium",activeFps:"unmeasured",idleCpu:"unmeasured"};
  console.log("RESEARCH_PERFORMANCE " + JSON.stringify(measurement));
  await info.attach("picking-performance",{body:JSON.stringify(measurement),contentType:"application/json"});
});

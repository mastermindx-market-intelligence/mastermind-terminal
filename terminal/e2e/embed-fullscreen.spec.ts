import { expect, test, type Page } from "@playwright/test";
const bars=Array.from({length:260},(_,i)=>{
 const close=100+i*.2+Math.sin(i/9)*4;
 return [new Date(Date.UTC(2024,2,4)-(259-i)*86400000).toISOString().slice(0,10),close-.6,close+1.4,close-1.2,close,1000000+i*1000];
});
type EmbedWindow=Window&{__mmEmbedOpts?:unknown;__d06Engine?:unknown;__d06NativeMessages?:unknown[];__d06BrowserRequests?:number};
async function boot(page:Page,extra=""){
 await page.route("**/data/NVDA.json",route=>route.fulfill({json:{bars}}));
 await page.goto("/embed/chart?symbol=NVDA&fs=1"+extra);
 await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
 await expect(page.locator(".embed-status").first()).toContainText("2024-03-04");
 if(await page.locator(".embed-head-quote").isVisible()){
  await page.mouse.move(0,0);
  await expect(page.locator(".embed-date time")).toHaveAttribute("datetime","2024-03-04");
 }
}
async function fullscreen(page:Page,active:boolean){
 await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===document.querySelector(".embed-root"))).toBe(active);
 await expect(page.locator(".embed-root")).toHaveAttribute("data-fullscreen",active?"1":"0");
 const geometry=await page.locator(".embed-fs").evaluate(button=>{
  const r=button.getBoundingClientRect(),controls=button.closest(".embed-range-controls")!.getBoundingClientRect();
  return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
   controlsLeft:controls.left,controlsRight:controls.right,viewportWidth:innerWidth,viewportHeight:innerHeight,
   insideRangeScroller:button.closest(".embed-ranges")!==null};
 });
 expect(geometry.insideRangeScroller,"fullscreen action has reserved space outside the range scroller").toBe(false);
 expect(geometry.width).toBeGreaterThanOrEqual(44);
 expect(geometry.height).toBeGreaterThanOrEqual(44);
 expect(geometry.left).toBeGreaterThanOrEqual(geometry.controlsLeft-1);
 expect(geometry.right).toBeLessThanOrEqual(Math.min(geometry.controlsRight,geometry.viewportWidth)+1);
 expect(geometry.top).toBeGreaterThanOrEqual(0);
 expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight+1);
 await test.info().attach("fullscreen-control-"+active,{body:Buffer.from(JSON.stringify(geometry)),contentType:"application/json"});
}
for(const lang of ["en","zh"] as const){
 test("browser fullscreen retains chart, range, overlays and source date in "+lang,async({page},info)=>{
  const theme=lang==="en"?"light":"dark";
  let reads=0,completedReads=0;
  await page.route("**/data/NVDA.json",async route=>{
   reads++;await route.fulfill({json:{bars}});completedReads++;
  });
  await page.goto("/embed/chart?symbol=NVDA&fs=1&transparent=1&theme="+theme+"&lang="+lang);
  await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
  await expect.poll(()=>reads-completedReads).toBe(0);
  const startupReads=reads;
  expect(startupReads,"the chart has a completed source read before controls").toBeGreaterThan(0);
  await page.getByRole("button",{name:"6M",exact:true}).click();
  const sma=page.getByRole("button",{name:lang==="en"?"Toggle the 50-day moving average":"切换50日移动平均线",exact:true});
  await sma.click();await expect(sma).toHaveAttribute("aria-pressed","false");
  expect(await sma.evaluate(e=>getComputedStyle(e).opacity)).toBe("1");
  await page.evaluate(()=>{const w=window as EmbedWindow;w.__d06Engine=w.__mmEmbedOpts;});
  const enter=page.getByRole("button",{name:lang==="en"?"Enter full screen":"进入全屏",exact:true});
  await enter.focus();await page.keyboard.press("Enter");await fullscreen(page,true);
  await expect(page.getByRole("button",{name:lang==="en"?"Exit full screen":"退出全屏",exact:true})).toBeVisible();
  expect(await page.locator(".embed-root").evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.mouse.move(0,0); // Latest-bar header; crosshair dates have their own deliberate-hover proof.
  await expect(page.locator(".embed-date time")).toHaveAttribute("datetime","2024-03-04");
  await page.screenshot({path:info.outputPath("embed-fullscreen-"+lang+".png")});
  await page.locator(".embed-fs").click();await fullscreen(page,false);
  await expect(page.locator(".embed-fs")).toBeFocused();
  await expect(page.getByRole("button",{name:"6M",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(sma).toHaveAttribute("aria-pressed","false");
  expect(await page.evaluate(()=>{const w=window as EmbedWindow;return w.__d06Engine===w.__mmEmbedOpts;})).toBe(true);
  expect(reads,"controls and fullscreen retain the completed startup source").toBe(startupReads);
  expect(completedReads).toBe(startupReads);
  await info.attach("fullscreen-source-reads",{body:Buffer.from(JSON.stringify({startupReads,reads,completedReads})),contentType:"application/json"});
 });
}
for(const fail of [false,true]){
 test("native handler "+(fail?"failure":"success")+" has priority over browser fullscreen",async({page},info)=>{
  test.skip(info.project.name!=="desktop","Host routing is viewport independent");
  await page.addInitScript(fail=>{
   const messages:unknown[]=[];
   Object.assign(window,{__d06NativeMessages:messages,__d06BrowserRequests:0,webkit:{messageHandlers:{mm:{postMessage(message:unknown){messages.push(message);if(fail)throw new Error("native unavailable");}}}}});
   Element.prototype.requestFullscreen=async()=>{(window as EmbedWindow).__d06BrowserRequests!++;};
  },fail);
  await boot(page,"&clean=1&hdr=0");
  await page.getByRole("button",{name:"Open full chart",exact:true}).click();
  expect(await page.evaluate(()=>(window as EmbedWindow).__d06NativeMessages)).toEqual([{type:"openFullChart"}]);
  expect(await page.evaluate(()=>(window as EmbedWindow).__d06BrowserRequests)).toBe(0);
  expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
  if(fail)await expect(page.locator(".embed-fullscreen-note")).toHaveText("Couldn’t request the full chart.");
  await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
 });
}
for(const mode of ["unsupported","rejected"]){
 test(mode+" browser requests retain a usable chart",async({page},info)=>{
  test.skip(info.project.name!=="desktop","Fault routing is viewport independent");
  await page.addInitScript(mode=>{
   if(mode==="unsupported")Object.defineProperty(document,"fullscreenEnabled",{get:()=>false,configurable:true});
   else Element.prototype.requestFullscreen=async()=>{throw new DOMException("denied","NotAllowedError");};
  },mode);
  await boot(page,"&lang=zh&theme=light");
  await page.locator(".embed-fs").click();
  await expect(page.locator(".embed-fullscreen-note")).toHaveText(mode==="unsupported"?"此处无法使用全屏。":"无法进入全屏。");
  await fullscreen(page,false);await expect(page.locator(".embed-chart-host canvas").first()).toBeVisible();
  await page.screenshot({path:info.outputPath("embed-fullscreen-"+mode+".png")});
 });
}
test("a rejected exit keeps the observed fullscreen state and explains recovery",async({page},info)=>{
 test.skip(info.project.name!=="desktop","One actual browser exit-failure transition");
 await boot(page);
 await page.locator(".embed-fs").click();await fullscreen(page,true);
 await page.evaluate(()=>{
  const doc=document as Document&{__d06Exit?:()=>Promise<void>};
  doc.__d06Exit=document.exitFullscreen.bind(document);
  document.exitFullscreen=async()=>{throw new DOMException("denied","NotAllowedError");};
 });
 await page.locator(".embed-fs").click();
 await expect(page.locator(".embed-fullscreen-note")).toHaveText("Couldn’t exit full screen. Use your browser’s exit control.");
 await fullscreen(page,true);
 await page.evaluate(()=>(document as Document&{__d06Exit:()=>Promise<void>}).__d06Exit());
 await fullscreen(page,false);
});
test("ordinary web viewports permit zoom while both existing native signals retain their policy",async({page},info)=>{
 test.skip(info.project.name!=="desktop","Viewport metadata and existing capability branch");
 for(const url of ["/embed/chart?symbol=NVDA","/x/snapfail01"]){
  await page.goto(url);
  const value=await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(value).not.toMatch(/maximum-scale\s*=\s*1|user-scalable\s*=\s*(?:no|0)/);
 }
 await page.goto("/embed/chart?symbol=NVDA&shell=app");
 await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content",/user-scalable=no/);
 await page.addInitScript(()=>{
  Object.assign(window,{webkit:{messageHandlers:{mm:{postMessage(){}}}}});
  Object.defineProperty(window,"localStorage",{get(){throw new Error("storage blocked");}});
 });
 await page.goto("/embed/chart?symbol=NVDA&hdr=0&clean=1&fs=1");
 await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content",/maximum-scale=1/);
 await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content",/user-scalable=no/);
});
test("the ordinary browser permits page-scale zoom without a restrictive viewport",async({page},info)=>{
 test.skip(info.project.name!=="desktop","Chromium page-scale proof, separate from 320px reflow");
 await boot(page,"&theme=light&lang=zh");
 const cdp=await page.context().newCDPSession(page);
 await cdp.send("Emulation.setPageScaleFactor",{pageScaleFactor:2});
 await expect.poll(()=>page.evaluate(()=>window.visualViewport?.scale)).toBe(2);
 const proof=await page.evaluate(()=>({kind:"Chromium emulated page-scale zoom",scale:visualViewport?.scale,visualWidth:visualViewport?.width,layoutWidth:innerWidth,viewport:document.querySelector('meta[name="viewport"]')?.getAttribute("content")}));
 await info.attach("page-scale-zoom",{body:Buffer.from(JSON.stringify(proof)),contentType:"application/json"});
 await page.screenshot({path:info.outputPath("embed-page-scale-2.png")});
 await cdp.send("Emulation.setPageScaleFactor",{pageScaleFactor:1});await cdp.detach();
});

test("native viewport policy releases on existing client navigation",async({page},info)=>{
 test.skip(info.project.name!=="desktop","One persistent root owner navigation proof");
 await page.goto("/x/snapfail01?shell=app");
 await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
 await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content",/user-scalable=no/);
 await page.getByRole("link",{name:"Mastermind Terminal",exact:true}).click();
 await expect.poll(()=>new URL(page.url()).pathname.startsWith("/x/")).toBe(false);
 await expect(page.locator('meta[name="viewport"]')).toHaveCount(1);
 await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute("content",/maximum-scale\s*=\s*1|user-scalable\s*=\s*(?:no|0)/);
});
test("browser fullscreen restores source context for the compact clean widget",async({page},info)=>{
 await boot(page,"&clean=1&hdr=0&transparent=1&lang=zh");
 await expect(page.locator(".embed-head-quote")).toBeHidden();
 await expect(page.locator(".embed-attr")).toBeHidden();
 await page.locator(".embed-fs").click();await fullscreen(page,true);
 await expect(page.locator(".embed-head-quote")).toBeVisible();
 await expect(page.locator(".embed-date time")).toBeVisible();
 await expect(page.locator(".embed-attr")).toBeVisible();
 await page.screenshot({path:info.outputPath("embed-compact-browser-fullscreen.png")});
 await page.locator(".embed-fs").click();await fullscreen(page,false);
 await expect(page.locator(".embed-head-quote")).toBeHidden();
 await expect(page.locator(".embed-attr")).toBeHidden();
});

import {expect,test} from "@playwright/test";
import {SHARED_SHELL_PROTOCOL,SHARED_SHELL_BRIDGE_VERSION,SHARED_SHELL_DOCUMENT_VERSION} from "../lib/sharedShellContracts";

// Use the existing responsive harness and real routes. The normal customer
// configuration keeps this opt-in surface off; CI qualifies it explicitly.
test.skip(process.env.MMX_SHARED_SHELL !== "1", "Shared Shell is an explicit beta opt-in");
test.use({colorScheme:"dark"});

async function noOverflow(page:import("@playwright/test").Page) {
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const shell=page.locator('[data-shared-shell="beta"]');
 const box=await shell.boundingBox();
 expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
}

test("Paper header geometry preserves one mobile owner and a readable company search",async({page},info)=>{
 await page.goto("/discover");
 const shell=page.locator('[data-shared-shell="beta"]');
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 await expect(shell.locator("#shared-primary-navigation")).toHaveCount(1);
 if(info.project.name==="desktop"){
  const rail=await shell.locator(".appnav").boundingBox();
  const search=shell.locator(".shared-shell-company-search");
  const searchBox=await search.boundingBox();
  expect(Math.abs(searchBox!.x-(rail!.x+rail!.width+32))).toBeLessThan(2);
  expect(searchBox!.width).toBeGreaterThan(300);
  expect(searchBox!.height).toBeGreaterThanOrEqual(40);
  await expect(search).toHaveCSS("display","flex");
  const ids=await page.locator(".topbar-brand-group linearGradient").evaluateAll(nodes=>nodes.map(n=>n.id));
  expect(ids).toHaveLength(1);
  expect(await page.locator('[id="'+ids[0]+'"]').count()).toBe(1);
  await shell.locator(".appnav").getByRole("link",{name:"Discover",exact:true}).focus();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const toggle=shell.locator("[data-investor-compact-toggle]");
  await toggle.click();await expect(toggle).toHaveAttribute("aria-pressed","true");
  expect(Math.round((await shell.locator(".appnav").boundingBox())!.width)).toBe(72);
  expect(Math.round((await search.boundingBox())!.x)).toBe(104);
  await noOverflow(page);
  await toggle.click();
 }else{
  await expect(shell.locator(".topbar")).toBeHidden();
  await expect(shell.locator(".appnav")).toBeHidden();
  await expect(shell.locator(".mobilebar")).toBeVisible();
  await page.getByRole("button",{name:"Open navigation",exact:true}).click();
  await expect(page.locator(".m-drawer.open")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-drawer.open")).toBeHidden();
 }
 await noOverflow(page);
 await page.screenshot({animations:"disabled",path:info.outputPath("discover-dark-en.png")});
});

test("light and Chinese presentation stay coherent through the tools directory",async({page},info)=>{
 await page.goto("/discover");
 const theme=page.getByRole("button",{name:"Light theme",exact:true});
 await expect(theme).toBeVisible();
 if(await theme.getAttribute("aria-pressed")!=="true")await theme.click();
 await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.screenshot({animations:"disabled",path:info.outputPath("discover-light-en.png")});
 await page.getByRole("button",{name:"Chinese language",exact:true}).click();
 await expect(page.getByRole("heading",{name:"发现",exact:true})).toBeVisible();
 await noOverflow(page);
 await page.screenshot({animations:"disabled",path:info.outputPath("discover-light-zh.png")});
 await page.keyboard.press("ControlOrMeta+k");
 const directory=page.locator(".shared-shell-directory[open]");
 await expect(directory).toBeVisible();
 const bounds=await directory.boundingBox();
 expect(bounds!.x).toBeGreaterThanOrEqual(0);
 expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
 await page.screenshot({animations:"disabled",path:info.outputPath("directory-light-zh.png")});
 await page.keyboard.press("Escape");
 await expect(directory).toHaveCount(0);
});

test("mobile chrome keeps every target usable at 320px and contract widths",async({page},info)=>{
 test.skip(info.project.name!=="desktop","One explicit smallest-width stress case");
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 for(const width of [320,390,641,820,860]){
  await page.setViewportSize({width,height:844});
  for(const chinese of [false,true]){
   const bar=page.locator(".mobilebar");
   const presentation=bar.locator(".shared-shell-presentation-toggle");
   if((await presentation.nth(0).getAttribute("aria-pressed")==="true")!==chinese)await presentation.nth(0).click();
   if((await presentation.nth(1).getAttribute("aria-pressed")==="true")!==chinese)await presentation.nth(1).click();
   await expect(page.locator("html")).toHaveAttribute("data-lang",chinese?"zh":"en");
   await expect(page.locator("html")).toHaveAttribute("data-theme",chinese?"light":"dark");
   const controls=bar.locator("button:visible");
   // Menu, company search, appearance, locale and the incumbent account owner.
   await expect(controls).toHaveCount(5);
   const boxes=await controls.evaluateAll(buttons=>buttons.map(button=>{
    const box=button.getBoundingClientRect();
    const after=getComputedStyle(button,"::after");
    // The account owner's existing centred ::after expands its painted 30px avatar
    // to a 44px hit area. Verify the browser hit test, not just the declared width.
    const width=Math.max(box.width,after.content!=="none"?parseFloat(after.width)||0:0);
    const height=Math.max(box.height,after.content!=="none"?parseFloat(after.height)||0:0);
    const x=box.x+(box.width-width)/2,y=box.y+(box.height-height)/2;
    // Probe each edge midpoint; the canonical rounded buttons intentionally do
    // not paint their bounding rectangle's extreme corners.
    const reachable=[[x+1,y+height/2],[x+width-1,y+height/2],[x+width/2,y+1],[x+width/2,y+height-1]].every(([px,py])=>{
     const hit=document.elementFromPoint(px,py);return hit===button||button.contains(hit);
    });
    return {x,y,width,height,reachable,label:button.getAttribute("aria-label")};
   }));
   for(const box of boxes){
    expect(box.width,box.label??"").toBeGreaterThanOrEqual(44);
    expect(box.height,box.label??"").toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    expect(box.reachable,box.label??"").toBe(true);
   }
   for(let i=1;i<boxes.length;i++)expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].x+boxes[i-1].width);
   await page.keyboard.press("Tab");
   for(const control of await controls.all()){
    await control.focus();await expect(control).toBeFocused();
    await expect(control).toHaveCSS("outline-style","solid");
    await expect(control).toHaveCSS("outline-width","2px");
   }
   const menu=bar.getByRole("button",{name:chinese?"打开导航":"Open navigation",exact:true});
   await menu.click();await expect(page.locator(".m-drawer.open")).toBeVisible();
   await page.keyboard.press("Escape");await expect(page.locator(".m-drawer.open")).toBeHidden();
   await expect(menu).toBeFocused();
   const search=bar.getByRole("button",{name:chinese?"搜索公司":"Search companies",exact:true});
   await search.focus();await page.keyboard.press("Enter");
   await expect(page.getByRole("dialog")).toHaveCount(1);
   await expect(page.getByRole("dialog")).toBeVisible();
   await expect(page.getByRole("dialog").getByRole("combobox")).toBeFocused();
   expect(await page.getByRole("dialog").evaluate(node=>node.closest(".topbar")===null)).toBe(true);
   const scopes=page.getByRole("dialog").getByRole("group",{name:chinese?"搜索范围":"Search scope",exact:true});
   const companies=scopes.getByRole("button",{name:chinese?/^公司(?:\s|$)/:/^Companies(?:\s|$)/});
   const tools=scopes.getByRole("button",{name:chinese?/^工具(?:\s|$)/:/^Tools(?:\s|$)/});
   await expect(companies).toBeVisible();await expect(companies).toHaveAttribute("aria-pressed","true");
   await expect(tools).toBeVisible();await expect(tools).toHaveAttribute("aria-pressed","false");
   await expect(page.getByRole("dialog").getByRole("region",{name:chinese?"公司结果":"Company results",exact:true})).toBeVisible();
   const skin=await page.getByRole("dialog").evaluate(node=>{
    const surface=node.matches(".msheet")?node:node.querySelector(".smodal");
    const probe=document.createElement("div");probe.style.backgroundColor="var(--panel)";document.body.append(probe);
    const expected=getComputedStyle(probe).backgroundColor;probe.remove();
    return {expected,actual:surface?getComputedStyle(surface).backgroundColor:null,
     inherited:surface?getComputedStyle(surface).getPropertyValue("--panel"):null,
     token:getComputedStyle(document.documentElement).getPropertyValue("--panel")};
   });
   expect(skin.inherited).toBe(skin.token);
   // Light uses the canonical white research surface; dark retains the native
   // sheet's glass treatment while inheriting the same document token owner.
   if(chinese)expect(skin.actual).toBe(skin.expected);
   await page.screenshot({animations:"disabled",path:info.outputPath(`search-${width}-${chinese?"light-zh":"dark-en"}.png`)});
   await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
   await expect(search).toBeFocused();
   await noOverflow(page);
   await page.screenshot({animations:"disabled",path:info.outputPath(`chrome-${width}-${chinese?"light-zh":"dark-en"}.png`)});
  }
 }
});

test("company search selects one canonical company from desktop, tablet and phone chrome",async({page},info)=>{
 await page.route("**/data/manifest.json",route=>route.fulfill({json:{as_of:null,symbols:{
  AAPL:{name:"Apple Inc.",zh:"苹果公司",col:"#aaa",verdict:null,mkt:"NASDAQ",sec:"Equities"},
 }}}));
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 const opener=info.project.name==="desktop"
  ? page.locator(".topbar .shared-shell-company-search")
  : page.locator(".mobilebar").getByRole("button",{name:"Search companies",exact:true});
 await opener.click();
 const dialog=page.getByRole("dialog");await expect(dialog).toHaveCount(1);await expect(dialog).toBeVisible();
 await expect(dialog).toHaveAccessibleName("Search companies and tools");
 const panel=dialog.locator(".smodal").count().then(count=>count?dialog.locator(".smodal"):dialog);
 const box=await (await panel).boundingBox();
 expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
 await dialog.getByRole("combobox").fill("Apple");
 await expect(dialog.locator('[data-company-symbol="AAPL"]')).toContainText("AAPL");
 await page.screenshot({animations:"disabled",path:info.outputPath("company-search-selection.png")});
 await dialog.getByRole("combobox").press("Enter");
 await expect(dialog.getByRole("button",{name:"Open Analysis",exact:true})).toBeVisible();
 await dialog.getByRole("button",{name:"Open Analysis",exact:true}).click();
 await expect(page).toHaveURL(/\/analysis\?symbol=AAPL&company_query=Apple$/);
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await noOverflow(page);
});

test("phone company search keeps its scope in both languages and dismisses by touch",async({page},info)=>{
 test.skip(info.project.name!=="mobile","Actual phone sheet and touch context");
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 const bar=page.locator(".mobilebar");
 for(const chinese of [false,true]){
  if(chinese){await bar.getByRole("button",{name:"Light theme",exact:true}).click();await bar.getByRole("button",{name:"Chinese language",exact:true}).click();}
  const opener=bar.getByRole("button",{name:chinese?"搜索公司":"Search companies",exact:true});
  await opener.tap();
  const dialog=page.getByRole("dialog");await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveAccessibleName(chinese?"搜索公司和工具":"Search companies and tools");
  await expect(dialog).toBeVisible();
  await page.screenshot({animations:"disabled",path:info.outputPath(`phone-scope-${chinese?"light-zh":"dark-en"}.png`)});
  await page.setViewportSize({width:320,height:844});
  await expect(dialog).toBeVisible();
  await page.screenshot({animations:"disabled",path:info.outputPath(`phone-scope-320-${chinese?"light-zh":"dark-en"}.png`)});
  await page.locator(".msheet-scrim").tap({position:{x:10,y:10}});
  await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
  await page.setViewportSize({width:390,height:844});
 }
});


for (const lang of ["en", "zh"] as const) {
  test(`SS12 unknown-page recovery opens company search and returns keyboard focus at 320px (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "Original 320px phone recovery");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
    const response = await page.goto("/__beta_missing_route_ui_probe");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    const zh = lang === "zh";
    if (zh) {
      const theme = page.getByRole("button", { name: "浅色主题", exact: true });
      if (await theme.getAttribute("aria-pressed") !== "true") await theme.click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", zh ? "light" : "dark");
    const recovery = page.getByRole("main");
    const opener = recovery.getByRole("button", { name: zh ? "搜索公司" : "Search companies", exact: true });
    await expect(recovery.getByRole("heading", { name: zh ? "还记得公司名称吗？" : "Remember the company name?" })).toBeVisible();
    await opener.scrollIntoViewIfNeeded();
    expect((await opener.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`ss12-company-recovery-${lang}.png`) });
    const href = page.url();
    await opener.press("Enter");
    const dialog = page.getByRole("dialog", { name: zh ? "搜索公司和工具" : "Search companies and tools" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: zh ? "公司结果" : "Company results", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(page.url()).toBe(href);
    await noOverflow(page);
  });
}

test("Tools opens an admitted public page and Back restores query, scope and selection",async({page},info)=>{
 // /learn is an existing canonical public native member, not a fabricated fixture route.
 // Its real static page needs neither an entitlement appointment nor a data response.
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 const origin=page.url();
 const opener=info.project.name==="desktop"
  ? page.locator(".topbar .shared-shell-company-search")
  : page.locator(".mobilebar").getByRole("button",{name:"Search companies",exact:true});
 await opener.click();
 const dialog=page.getByRole("dialog");
 await expect(dialog).toHaveAccessibleName("Search companies and tools");
 const scopes=dialog.getByRole("group",{name:"Search scope",exact:true});
 await scopes.getByRole("button",{name:/^Tools(?:\s|$)/}).click();
 await dialog.getByRole("combobox").fill("/learn");
 const selected=dialog.getByRole("option",{name:"Learn Workspaces",exact:true}).filter({has:page.locator("strong",{hasText:/^Learn$/})});
 await expect(selected).toHaveCount(1);
 await selected.click();
 await expect(selected).toHaveAttribute("aria-selected","true");
 await expect(dialog.getByRole("complementary",{name:"Selected tool",exact:true}).getByRole("heading",{name:"Learn",exact:true})).toBeVisible();
 await expect(dialog.getByRole("complementary",{name:"Selected tool",exact:true}).getByText("/learn",{exact:true})).toBeVisible();
 await page.screenshot({animations:"disabled",path:info.outputPath("tools-selected-public-learn.png")});
 await dialog.getByRole("button",{name:"Open tool",exact:false}).click();
 await expect(page).toHaveURL(/\/learn$/);
 await expect(page.getByRole("heading",{level:1,name:"The gamma weather map, in six reads",exact:true})).toBeVisible();
 const lessons=page.locator("main ol > li details");
 await expect(lessons).toHaveCount(6);
 await expect(lessons.first()).toHaveAttribute("open","");
 await expect(lessons.first().locator("p")).toBeVisible();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.screenshot({animations:"disabled",path:info.outputPath("tools-public-learn-destination.png")});
 await page.goBack();
 await expect(page).toHaveURL(origin);
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole("combobox")).toHaveValue("/learn");
 await expect(scopes.getByRole("button",{name:/^Tools(?:\s|$)/})).toHaveAttribute("aria-pressed","true");
 await expect(scopes.getByRole("button",{name:/^Companies(?:\s|$)/})).toHaveAttribute("aria-pressed","false");
 await expect(selected).toHaveAttribute("aria-selected","true");
 await expect(dialog.getByRole("complementary",{name:"Selected tool",exact:true}).getByRole("heading",{name:"Learn",exact:true})).toBeVisible();
 await noOverflow(page);
 await page.screenshot({animations:"disabled",path:info.outputPath("tools-public-learn-back-restored.png")});
});


// Recovery uses the real Next layout, admission endpoint and LegacyPageHost.
// Only the cross-origin child is controlled so late/error messages are repeatable.
function recoveryChild(parentOrigin: string, holdReady: boolean) {
 return `<!doctype html><html><head><meta charset="utf-8"><title>Recovery test workspace</title></head>
 <body><button id="workspace-action">Workspace action</button><script>
 const parentOrigin=${JSON.stringify(parentOrigin)};
 const generation=new URL(location.href).searchParams.get("mmx_generation");
 let init=null;
 const send=(body)=>parent.postMessage({protocol:${JSON.stringify(SHARED_SHELL_PROTOCOL)},frameGeneration:generation,...body},parentOrigin);
 const ready=()=>{if(init)send({type:"READY",href:new URL(init.canonicalPath,location.origin).href,title:"Macro",
  contextRevision:init.contextRevision,bridgeVersion:${JSON.stringify(SHARED_SHELL_BRIDGE_VERSION)},documentVersion:${JSON.stringify(SHARED_SHELL_DOCUMENT_VERSION)},responseKind:"content"});};
 window.shellRecoveryFixture={ready,fail:()=>send({type:"ERROR",code:"initialization_failed"}),navigate:(href)=>{
  history.pushState({},"",href);
  send({type:"NAVIGATE",href:new URL(href,location.origin).href,mode:"push",sameDocument:true,requestId:crypto.randomUUID()});
 }};
 addEventListener("message",event=>{
  if(event.source!==parent||event.origin!==parentOrigin||event.data?.type!=="INIT"||event.data.frameGeneration!==generation)return;
  init=event.data;document.documentElement.dataset.initialized="true";
  if(!${JSON.stringify(holdReady)})ready();
 });
 <\/script></body></html>`;
}

test.describe("legacy workspace recovery",()=>{
 const canonical="/macro.html?filter=a%20b&filter=a+b#risk";
 const legacy="https://www.mastermind-x.com";
 type FixtureWindow=Window & {shellRecoveryFixture:{ready:()=>void;fail:()=>void}};
 async function setup(page:import("@playwright/test").Page,baseURL:string) {
  let hold=false;
  await page.context().addCookies([
   {name:"mm_e2e_rs30",value:"1",url:baseURL},
   {name:"mm_e2e_guest",value:"1",url:baseURL},
  ]);
  await page.route(legacy+"/macro.html?**",route=>route.fulfill({
   contentType:"text/html; charset=utf-8",body:recoveryChild(new URL(baseURL).origin,hold),
  }));
  // Warm this real admission route before measuring a child response deadline.
  const gate=await page.request.get(baseURL+"/api/shared-shell/status");
  expect((await gate.json()).enabled).toBe(true);
  await page.goto(canonical);
  const frame=page.locator("[data-shared-shell-frame]");
  await expect(frame).toBeVisible();
  const child=()=>page.frames().find(candidate=>candidate.url().startsWith(legacy+"/macro.html?"))!;
  await expect.poll(()=>child()?.url()).toContain("mmx_generation=");
  return {frame,child,holdNext:()=>{hold=true;}};
 }

 test("temporary status failure on tab return retries the same workspace without reloading the shell",async({page,baseURL},info)=>{
  const {frame,child}=await setup(page,baseURL!);
  const originalUrl=page.url();
  const generation=new URL(child().url()).searchParams.get("mmx_generation");
  await page.evaluate(()=>{document.documentElement.dataset.recheckLifetime="preserved";});
  let failOnce=true;
  await page.route("**/api/shared-shell/status",async route=>{
   if(failOnce){failOnce=false;await route.fulfill({status:503,json:{status:"unavailable"}});}
   else await route.continue();
  });
  await child().locator("#workspace-action").focus();
  await page.evaluate(()=>{document.dispatchEvent(new Event("visibilitychange"));});
  await expect(page.locator('[data-shared-shell-failure="gate-http"]')).toBeVisible();
  const retry=page.locator(".shared-shell-boundary").getByRole("button",{name:"Try again",exact:true});
  await expect(retry).toBeVisible();await expect(frame).toBeHidden();
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(retry).toBeVisible();await expect(frame).toBeHidden();
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("status-unavailable-retry.png")});
  await retry.click();
  await expect(frame).toBeVisible();
  await expect.poll(()=>new URL(child().url()).searchParams.get("mmx_generation")).not.toBe(generation);
  await expect(page).toHaveURL(originalUrl);
  await expect(page.locator("html")).toHaveAttribute("data-recheck-lifetime","preserved");
  await expect(frame).toBeFocused();
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("status-workspace-recovered.png")});
 });

 test("failure stays stable, then explicit retry transfers keyboard focus into the new workspace",async({page,baseURL},info)=>{
  const {frame,child,holdNext}=await setup(page,baseURL!);
  await child().locator("#workspace-action").focus();
  await expect(frame).toBeFocused();
  const generation=new URL(child().url()).searchParams.get("mmx_generation");
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.fail();});
  const boundary=page.locator(".shared-shell-boundary");
  const heading=boundary.getByRole("heading");
  await expect(heading).toBeFocused();
  await expect(frame).toBeHidden();
  await expect(frame).toHaveAttribute("inert","");
  await expect(boundary.getByRole("button",{name:"Try again",exact:true})).toBeVisible();
  const recoveryTitle=await heading.textContent();
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(heading).toHaveText(recoveryTitle!);
  await expect(frame).toBeHidden();
  for(const action of await boundary.locator("button,a").all()){
   const box=await action.boundingBox();
   expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("workspace-recovery-dark-en.png")});
  holdNext();
  await boundary.getByRole("button").click();
  await expect(heading).toBeFocused();
  await expect.poll(()=>new URL(child().url()).searchParams.get("mmx_generation")).not.toBe(generation);
  await expect(child().locator("html")).toHaveAttribute("data-initialized","true");
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(frame).toBeVisible();
  await expect(frame).toBeFocused();
  await expect(boundary).toHaveCount(0);
  expect(new URL(page.url()).pathname+new URL(page.url()).search+new URL(page.url()).hash).toBe(canonical);
 });

 test("light Chinese recovery remains usable on short screens and preserves a newer focus choice",async({page,baseURL},info)=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  const {frame,child,holdNext}=await setup(page,baseURL!);
  await page.getByRole("button",{name:"Light theme",exact:true}).click();
  await page.getByRole("button",{name:"Chinese language",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
  await expect(page.locator("html")).toHaveAttribute("data-lang","zh");
  await child().evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.fail();});
  const boundary=page.locator(".shared-shell-boundary");
  await expect(boundary.getByRole("button",{name:"重试",exact:true})).toBeVisible();
  const original=boundary.getByRole("link");
  await expect(original).toHaveAttribute("href",legacy+canonical);
  await expect(original).toHaveAttribute("target","_blank");
  await expect(original).toHaveAttribute("rel","noopener noreferrer");
  await expect(original).toHaveCSS("transition-duration","0s");
  await noOverflow(page);
  await page.screenshot({animations:"disabled",path:info.outputPath("workspace-recovery-light-zh.png")});
  if(info.project.name==="desktop"){
   for(const viewport of [{width:568,height:320},{width:320,height:480}]){
    await page.setViewportSize(viewport);
    await boundary.getByRole("heading").scrollIntoViewIfNeeded();
    const headingBox=await boundary.getByRole("heading").boundingBox();
    const boundaryBox=await boundary.boundingBox();
    expect(headingBox!.y).toBeGreaterThanOrEqual(boundaryBox!.y);
    for(const action of await boundary.locator("button,a").all()){
     await action.scrollIntoViewIfNeeded();
     const box=await action.boundingBox();
     expect(box!.height).toBeGreaterThanOrEqual(44);
     expect(box!.x).toBeGreaterThanOrEqual(0);
     expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);
     expect(await action.evaluate(element=>{
      const box=element.getBoundingClientRect();
      const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      return hit===element||element.contains(hit);
     })).toBe(true);
    }
    await noOverflow(page);
    await page.screenshot({animations:"disabled",path:info.outputPath(`workspace-recovery-${viewport.width}x${viewport.height}.png`)});
   }
  }
  const generation=new URL(child().url()).searchParams.get("mmx_generation");
  holdNext();
  await boundary.getByRole("button").click();
  await expect.poll(()=>{
   const url=child()?.url();
   const next=url?new URL(url).searchParams.get("mmx_generation"):null;
   return Boolean(next&&next!==generation);
  }).toBe(true);
  const replacement=child();
  await expect(replacement.locator("html")).toHaveAttribute("data-initialized","true");
  const outside=page.locator(".topbar button:visible,.mobilebar button:visible").first();
  await outside.focus();
  await replacement.evaluate(()=>{(window as unknown as FixtureWindow).shellRecoveryFixture.ready();});
  await expect(frame).toBeVisible();
  await expect(outside).toBeFocused();
 });
});


test("the current legacy company opens its chart and returns to the exact research location",async({page,baseURL},info)=>{
 test.skip(info.project.name!=="desktop","The current-chart toolbar is desktop chrome");
 const origin=new URL(baseURL!).origin;
 const legacy="https://www.mastermind-x.com";
 await page.context().addCookies([
  {name:"mm_e2e_rs30",value:"1",url:baseURL!},{name:"mm_e2e_guest",value:"1",url:baseURL!},
 ]);
 await page.addInitScript(({origin})=>{
  if(location.origin===origin && !sessionStorage.getItem("shell-company-cursor-seeded")){
   localStorage.setItem("mm.activeSymbol","NVDA");sessionStorage.setItem("shell-company-cursor-seeded","1");
  }
 },{origin});
 await page.route(legacy+"/stock.html**",route=>route.fulfill({
  contentType:"text/html; charset=utf-8",body:recoveryChild(origin,false),
 }));
 const initial="/stock.html?filter=a%20b&filter=a+b#AAPL";
 await page.goto(initial);
 const frame=page.locator("[data-shared-shell-frame]");
 await expect(frame).toBeVisible();
 const chart=page.getByRole("link",{name:"Open current chart",exact:true});
 let chartHref=new URL((await chart.getAttribute("href"))!,origin);
 expect(chartHref.searchParams.get("symbol")).toBe("AAPL");
 expect(chartHref.searchParams.get("ret")).toBe(origin+initial);
 const child=page.frames().find(candidate=>candidate.url().startsWith(legacy+"/stock.html"))!;
 const next="/stock.html?filter=a%20b&filter=a+b#MSFT";
 await child.evaluate(href=>{
  (window as unknown as Window & {shellRecoveryFixture:{navigate:(href:string)=>void}}).shellRecoveryFixture.navigate(href);
 },next);
 await expect(page).toHaveURL(origin+next);
 await expect.poll(async()=>new URL((await chart.getAttribute("href"))!,origin).searchParams.get("symbol")).toBe("MSFT");
 expect(page.frames()).toContain(child);
 await expect(frame).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem("mm.activeSymbol"))).toBe("NVDA");
 chartHref=new URL((await chart.getAttribute("href"))!,origin);
 expect(chartHref.searchParams.get("ret")).toBe(origin+next);
 await chart.click();
 await expect(page).toHaveURL(chartHref.href);
 await expect(page.locator(".pair b")).toHaveText("MSFT");
 await page.locator(".brand-back").click();
 await expect(page).toHaveURL(origin+next);
 await expect(page.locator("[data-shared-shell-frame]")).toBeVisible();
});

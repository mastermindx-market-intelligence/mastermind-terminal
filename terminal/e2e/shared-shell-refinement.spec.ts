import {expect,test} from "@playwright/test";

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
   await expect(page.getByRole("dialog").getByRole("tab",{name:chinese?"股票":"Stocks",exact:true})).toBeVisible();
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

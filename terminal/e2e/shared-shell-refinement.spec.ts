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

test("320px layout keeps every global control and the primary workflow usable",async({page},info)=>{
 test.skip(info.project.name!=="desktop","One explicit smallest-width stress case");
 await page.setViewportSize({width:320,height:760});
 await page.goto("/discover");
 await expect(page.getByRole("heading",{name:"Discover",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Open Stock Screener",exact:true})).toBeVisible();
 const controls=page.locator(".mobilebar .shared-shell-presentation-toggle");
 await expect(controls).toHaveCount(2);
 for(const control of await controls.all()){
  const box=await control.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
 }
 await noOverflow(page);
 await page.screenshot({animations:"disabled",path:info.outputPath("discover-320.png")});
});

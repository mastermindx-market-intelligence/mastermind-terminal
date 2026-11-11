import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
const IMAGE="**/snapshots/snapready1.png";
const wide=readFileSync("docs/pr-crops/d06-workspace-20261104/runtime/workspace-1440-restored.png");
function portrait(){
 const png=new PNG({width:300,height:1200});
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
  const i=(y*png.width+x)*4,grid=x%50===0||y%100===0;
  png.data[i]=grid?90:235;png.data[i+1]=grid?110:240;png.data[i+2]=grid?150:246;png.data[i+3]=255;
 }
 return PNG.sync.write(png);
}
for(const lang of ["en","zh"] as const){
 test("snapshot loads the actual image and preserves natural proportions in "+lang,async({page},info)=>{
  await page.addInitScript(value=>localStorage.setItem("mm.lang",value),lang);
  let release!:()=>void,reads=0;const wait=new Promise<void>(resolve=>{release=resolve;});
  await page.route(IMAGE,async route=>{reads++;await wait;await route.fulfill({status:200,contentType:"image/png",body:wide});});
  await page.goto("/x/snapready1",{waitUntil:"domcontentloaded"});
  await expect(page.locator("[data-snapshot-state]")).toHaveAttribute("data-snapshot-state","loading");
  await page.screenshot({path:info.outputPath("snapshot-loading-"+lang+".png"),fullPage:true});release();
  await expect(page.locator("[data-snapshot-state]")).toHaveAttribute("data-snapshot-state","ready");
  const img=page.locator("[data-snapshot-frame] img");
  const dims=await img.evaluate(n=>{const i=n as HTMLImageElement,r=i.getBoundingClientRect();return {natural:i.naturalWidth/i.naturalHeight,rendered:r.width/r.height};});
  expect(Math.abs(dims.natural-dims.rendered)).toBeLessThan(.01);expect(reads).toBe(1);
  await page.screenshot({path:info.outputPath("snapshot-ready-dark-"+lang+".png"),fullPage:true});
  if(process.env.MMX_SHARED_SHELL==="1"){
   await page.getByRole("button",{name:lang==="en"?"Light theme":"浅色主题",exact:true}).click();
   await expect(page.locator("html")).toHaveAttribute("data-theme","light");
   await page.screenshot({path:info.outputPath("snapshot-ready-light-"+lang+".png"),fullPage:true});
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 });
 test("snapshot image failure recovers only through explicit retry in "+lang,async({page},info)=>{
  await page.addInitScript(value=>localStorage.setItem("mm.lang",value),lang);
  let reads=0;
  await page.route(IMAGE,async route=>{reads++;await route.fulfill(reads===1?{status:200,contentType:"image/png",body:Buffer.from("invalid png")}:{status:200,contentType:"image/png",body:wide});});
  await page.goto("/x/snapready1");
  await expect(page.locator("[data-snapshot-state]")).toHaveAttribute("data-snapshot-state","error");
  const retry=page.getByRole("button",{name:lang==="en"?"Try again":"重试",exact:true});
  await retry.focus();await expect(retry).toBeFocused();
  await page.screenshot({path:info.outputPath("snapshot-image-error-"+lang+".png"),fullPage:true});
  expect(reads).toBe(1);await page.keyboard.press("Enter");
  await expect(page.locator("[data-snapshot-state]")).toHaveAttribute("data-snapshot-state","ready");
  expect(reads).toBe(2);
 });
 test("missing and unavailable snapshot reads stay distinct in "+lang,async({page},info)=>{
  await page.addInitScript(value=>localStorage.setItem("mm.lang",value),lang);
  await page.goto("/x/snapgone01");
  await expect(page.locator("[data-snapshot-state]")).toHaveAttribute("data-snapshot-state","missing");
  await expect(page.locator("[data-snapshot-frame] img")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("snapshot-missing-"+lang+".png"),fullPage:true});
  await page.goto("/x/snapfail01");
  await expect(page.locator("[data-snapshot-state]")).toHaveAttribute("data-snapshot-state","unavailable");
  await expect(page.getByRole("button",{name:lang==="en"?"Try again":"重试",exact:true})).toBeVisible();
  if(process.env.MMX_SHARED_SHELL==="1")await page.getByRole("button",{name:lang==="en"?"Light theme":"浅色主题",exact:true}).click();
  await page.screenshot({path:info.outputPath("snapshot-upstream-error-"+lang+".png"),fullPage:true});
 });
}
test("portrait snapshot remains complete at 320 pixels with a reachable footer",async({page},info)=>{
 test.skip(info.project.name!=="desktop","Explicit narrow viewport");
 await page.setViewportSize({width:320,height:900});
 await page.route(IMAGE,route=>route.fulfill({status:200,contentType:"image/png",body:portrait()}));
 await page.goto("/x/snapready1");
 await expect(page.locator("[data-snapshot-state]")).toHaveAttribute("data-snapshot-state","ready");
 const img=page.locator("[data-snapshot-frame] img");
 const dims=await img.evaluate(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height};});
 expect(dims.h/dims.w).toBeCloseTo(4,2);
 await page.locator("footer").scrollIntoViewIfNeeded();await expect(page.locator("footer")).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath("snapshot-portrait-320.png"),fullPage:true});
});

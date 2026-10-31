import {test,expect} from "@playwright/test";
import {prepare} from "./smartScreensFixture";

// Controlled local bootstrap delivery: no live authentication, owner write or Save.
for(const zh of [false,true])test(`new research discloses unavailable entry until client activation (${zh?"zh":"en"})`,async({page,baseURL},info)=>{
 await prepare(page.context(),baseURL!,`entry-activation-${info.project.name}-${zh}`,zh);
 const writes:string[]=[];page.on("request",r=>{const u=new URL(r.url());if(u.pathname.startsWith("/api/")&&u.pathname!=="/api/collect"&&!["GET","HEAD"].includes(r.method()))writes.push(r.method()+" "+u.pathname);});
 await page.route("**/api/investigations{,?*}",r=>{expect(r.request().method()).toBe("GET");return r.fulfill({json:{status:"listed",items:[]}});});
 await page.route("**/api/layouts{,?*}",r=>r.fulfill({json:{layouts:[],teams:[]}}));
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let blocked=0;
 await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/,async r=>{++blocked;await gate;await r.continue();});
 try{
  await page.goto("/analysis?view=investigations",{waitUntil:"commit"});
  const early=page.getByRole("button",{name:/^(Start new research|开始新研究)$/});
  await expect(early).toBeVisible({timeout:20000});expect(blocked).toBeGreaterThan(0);
  await expect(early).toBeDisabled();
  await early.screenshot({path:info.outputPath("entry-before-activation.png")});
  release();
  await expect(page.getByText(zh?"暂无已保存的问题。":"No saved questions yet.",{exact:true})).toBeVisible();
  const start=page.getByRole("button",{name:zh?"开始新研究":"Start new research",exact:true});
  await expect(start).toBeEnabled();await start.click();
  const title=page.getByLabel(zh?"标题":"Title",{exact:true});await expect(title).toBeVisible();await title.fill("Controlled unsaved draft");await expect(title).toHaveValue("Controlled unsaved draft");
  await page.getByLabel(zh?"研究问题":"Research question",{exact:true}).fill("Did the explicit entry open?");
  expect(writes).toEqual([]);
  if(!zh)await page.screenshot({path:info.outputPath("entry-after-activation.png")});
 }finally{release?.();}
});

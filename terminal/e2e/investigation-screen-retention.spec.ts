import {test,expect} from "@playwright/test";
import {createHash} from "node:crypto";
import {expectReadableMetadata} from "./retainedMetadataContrast";
import {prepare} from "./smartScreensFixture";
import {canonicalInvestigationJson} from "../lib/investigationContracts";
import type {InvestigationCommand} from "../lib/investigations";
import type {ScreenRecord} from "../lib/smartScreen/record";
// Real isolated Smart Screen owner route; Investigation transport is declared fixture data.
// Atomic database/auth/idempotency proof belongs to the separate disposable PostgreSQL tests.
test.setTimeout(120_000);
const screenId="d".repeat(32),at="2026-10-15T00:00:00.000Z";
const def={grammar:1,scope:{markets:["hk","us"],asset:"Equities",unpriced:false},where:{any:[{all:[{f:"chg",op:"gte",v:3},{f:"dv",op:"gte",v:1000000}]},{f:"chg",op:"lte",v:-3}]}};
for(const zh of [false,true])test(`retain exact screen A after owner B/deletion, no read repair (${zh?"zh":"en"})`,async({page,baseURL},info)=>{
 await prepare(page.context(),baseURL!,`capture-${info.project.name}-${zh}-${Date.now()}`,zh);
 const created=await page.request.put("/api/smart-screens",{data:{action:"create",id:screenId,name:"Screen A",def}});expect(created.ok()).toBe(true);
 const screenA=(await created.json()).record as ScreenRecord;
 const posts:InvestigationCommand[]=[],browserOwnerWrites:string[]=[],ownerReads:string[]=[];
 page.on("request",r=>{if(new URL(r.url()).pathname==="/api/smart-screens"){if(r.method()==="GET")ownerReads.push(r.url());else browserOwnerWrites.push(r.method());}});
 let saved:Record<string,unknown>|null=null,retained:Record<string,unknown>|null=null,missing=false;
 await page.route("**/api/layouts",r=>r.fulfill({json:{layouts:[],teams:[]}}));
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),q=new URL(request.url()).searchParams;
  if(request.method()==="POST"){
   const command=request.postDataJSON() as InvestigationCommand;posts.push(command);
   expect(command.screen_capture).toEqual({screen_id:screenId,expected_revision:1});expect(command.manifest.evidence_refs).toEqual([]);
   const record={...screenA,review:null},fingerprint=createHash("sha256").update(canonicalInvestigationJson(record)).digest("hex");
   const ref={owner:"terminal.smart_screen",object_type:"screen_definition",object_id:screenId,mode:"pinned",version_ref:command.operation_id,fingerprint};
   const manifest={...command.manifest,evidence_refs:[ref]};
   retained={found:true,...ref,source_revision:1,record};
   saved={status:"committed",id:command.id,investigation_id:command.id,revision:1,lifecycle:"active",manifest,committed_at:at,revision_id:"11111111-1111-4111-8111-111111111111",sequence:1,parent_revision_id:null,operation_id:command.operation_id,author_ref:"22222222-2222-4222-8222-222222222222",recorded_at:at,manifest_digest:createHash("sha256").update(canonicalInvestigationJson(manifest)).digest("hex")};
   await route.fulfill({json:saved});return;
  }
  expect(request.method()).toBe("GET");
  if(q.has("id")){await route.fulfill({json:{...saved,status:"found",current_revision:1,layouts:[],screen_definitions:missing?[]:[retained]}});return;}
  await route.fulfill({json:{status:"listed",items:saved?[{id:saved.id,revision:1,lifecycle:"active",title:"Research A",question:"Why these rules?",updated_at:at}]:[]}});
 });
 await page.goto("/analysis?view=investigations");
 await page.getByRole("button",{name:zh?"开始新研究":"Start new research",exact:true}).click();
 await page.getByLabel(zh?"标题":"Title",{exact:true}).fill("Research A");
 await page.getByLabel(zh?"研究问题":"Research question",{exact:true}).fill("Why these rules?");
 await page.getByRole("button",{name:zh?"浏览个人筛选":"Browse my screens",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Screen A",exact:true})).toBeVisible();
 await expectReadableMetadata(page.getByRole("region",{name:zh?"保留筛选":"Retained screens",exact:true}));
 await page.getByRole("button",{name:zh?"保留此定义":"Retain this definition",exact:true}).click();
 expect(posts).toHaveLength(0);expect(browserOwnerWrites).toEqual([]);
 await page.getByRole("button",{name:zh?"保存研究":"Save research",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Research A",exact:true})).toBeVisible();
 await expect(page.locator('[data-investigation-screen="available"]')).toHaveCount(1);
 expect(posts).toHaveLength(1);expect(ownerReads).toHaveLength(1);
 const retainedRegion=page.getByRole("region",{name:zh?"保留筛选":"Retained screens",exact:true});
 await expectReadableMetadata(retainedRegion);
 await expect(retainedRegion).toContainText(zh?"任一满足":"Any of");await expect(retainedRegion).toContainText(zh?"全部满足":"All of");await expect(retainedRegion).toContainText("$1,000,000");
 expect(await retainedRegion.locator("ul ul").evaluateAll(lists=>lists.every(list=>list.firstElementChild!.getBoundingClientRect().left>list.parentElement!.getBoundingClientRect().left+8))).toBe(true);
 // Discriminating visual control: removing nested indentation must fail that same geometry oracle.
 expect(await retainedRegion.locator("ul ul").evaluateAll(lists=>{
  const before=lists.map(list=>list.getAttribute("style"));
  try{lists.forEach(list=>{(list as HTMLElement).style.paddingInlineStart="0";(list as HTMLElement).style.borderInlineStart="0";});return lists.every(list=>list.firstElementChild!.getBoundingClientRect().left>list.parentElement!.getBoundingClientRect().left+8);}
  finally{lists.forEach((list,i)=>{if(before[i]===null)list.removeAttribute("style");else list.setAttribute("style",before[i]!);});}
 })).toBe(false);
 await retainedRegion.screenshot({path:info.outputPath("retained-a.png")});
 const updated=await page.request.put("/api/smart-screens",{data:{action:"update",id:screenId,expectedRev:1,name:"Newer B",def:{...def,where:{all:[{f:"chg",op:"gte",v:9}]}}}});expect(updated.ok()).toBe(true);
 const b=(await updated.json()).record;expect(b.rev).toBe(2);
 await page.reload();await expect(page.getByRole("heading",{name:"Screen A",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Newer B",exact:true})).toHaveCount(0);
 expect(posts).toHaveLength(1);expect(ownerReads).toHaveLength(1);
 expect((await page.request.put("/api/smart-screens",{data:{action:"delete",id:screenId,expectedRev:2}})).ok()).toBe(true);
 await page.reload();await expect(page.getByRole("heading",{name:"Screen A",exact:true})).toBeVisible();
 await page.getByRole("region",{name:zh?"保留筛选":"Retained screens",exact:true}).screenshot({path:info.outputPath("retained-after-delete.png")});
 missing=true;await page.reload();await expect(page.locator('[data-investigation-screen="unavailable"]')).toHaveCount(1);await expect(page.getByRole("heading",{name:"Screen A",exact:true})).toHaveCount(0);
 await expect(page.getByText(zh?"此确切筛选定义暂不可用，未替换为当前筛选。":"This exact screen definition is unavailable. A current screen has not replaced it.",{exact:true})).toBeVisible();
 expect(posts).toHaveLength(1);expect(ownerReads).toHaveLength(1);expect(browserOwnerWrites).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole("region",{name:zh?"保留筛选":"Retained screens",exact:true}).screenshot({path:info.outputPath("missing-no-fallback.png")});
});

test("screen conflict needs deliberate reselection; uncertain recovery keeps original capture",async({page,baseURL},info)=>{
 await prepare(page.context(),baseURL!,`screen-recovery-${info.project.name}-${Date.now()}`,false);
 expect((await page.request.put("/api/smart-screens",{data:{action:"create",id:screenId,name:"Screen A",def}})).ok()).toBe(true);
 const posts:InvestigationCommand[]=[],reconciles:InvestigationCommand[]=[],receiptReads:string[]=[],ownerReads:string[]=[];
 let saved:Record<string,unknown>|null=null,retained:Record<string,unknown>|null=null;
 page.on("request",r=>{if(new URL(r.url()).pathname==="/api/smart-screens"&&r.method()==="GET")ownerReads.push(r.url());});
 await page.route("**/api/layouts",r=>r.fulfill({json:{layouts:[],teams:[]}}));
 await page.route("**/api/investigations{,?*}",async route=>{
  const r=route.request(),q=new URL(r.url()).searchParams;
  if(r.method()==="POST"){
   const command=r.postDataJSON() as InvestigationCommand;posts.push(command);
   if(posts.length===1){await route.fulfill({status:409,json:{status:"screen_conflict"}});return;}
   expect(posts).toHaveLength(2);expect(command.screen_capture).toEqual({screen_id:screenId,expected_revision:2});
   await route.abort("failed");return; // Declared lost-answer fixture, not native network evidence.
  }
  if(r.method()==="PUT"){
   const command=r.postDataJSON() as InvestigationCommand;reconciles.push(command);expect(command).toEqual(posts[1]);
   const record={...screenB,review:null},fingerprint=createHash("sha256").update(canonicalInvestigationJson(record)).digest("hex");
   const ref={owner:"terminal.smart_screen",object_type:"screen_definition",object_id:screenId,mode:"pinned",version_ref:command.operation_id,fingerprint},manifest={...command.manifest,evidence_refs:[ref]};
   retained={found:true,...ref,source_revision:2,record};saved={status:"committed",id:command.id,investigation_id:command.id,revision:1,lifecycle:"active",manifest,committed_at:at,revision_id:"11111111-1111-4111-8111-111111111111",sequence:1,parent_revision_id:null,operation_id:command.operation_id,author_ref:"22222222-2222-4222-8222-222222222222",recorded_at:at,manifest_digest:createHash("sha256").update(canonicalInvestigationJson(manifest)).digest("hex")};
   await route.fulfill({json:saved});return;
  }
  expect(r.method()).toBe("GET");
  if(q.has("operation_id")){receiptReads.push(q.get("operation_id")!);await route.fulfill({json:{status:"not_found"}});return;}
  if(q.has("id")){await route.fulfill({json:{...saved,status:"found",current_revision:1,layouts:[],screen_definitions:[retained]}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto("/analysis?view=investigations");await page.getByRole("button",{name:"Start new research",exact:true}).click();
 await page.getByLabel("Title",{exact:true}).fill("Captured recovery");await page.getByLabel("Research question",{exact:true}).fill("Keep the selected definition?");
 await page.getByRole("button",{name:"Browse my screens",exact:true}).click();await page.getByRole("button",{name:"Retain this definition",exact:true}).click();
 const changed=await page.request.put("/api/smart-screens",{data:{action:"update",id:screenId,expectedRev:1,name:"Screen B",def}});expect(changed.ok()).toBe(true);const screenB:ScreenRecord=(await changed.json()).record;
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByText(/^Not saved: the selected screen changed/)).toBeVisible();expect(posts).toHaveLength(1);expect(posts[0].screen_capture?.expected_revision).toBe(1);
 await page.getByRole("button",{name:"Save research",exact:true}).click();expect(posts).toHaveLength(1);
 await page.getByRole("button",{name:"Browse my screens",exact:true}).click();await expect(page.getByRole("heading",{name:"Screen B",exact:true})).toBeVisible();
 await expect(page.locator("[data-screen-capture]")).toContainText("Version 1");expect(posts).toHaveLength(1);
 await page.getByRole("button",{name:"Retain this definition",exact:true}).click();await expect(page.locator("[data-screen-capture]")).toContainText("Version 2");
 await page.getByRole("button",{name:"Save research",exact:true}).click();await expect(page.getByRole("region",{name:"Original save request",exact:true})).toBeVisible();
 expect(posts).toHaveLength(2);expect(posts[1].operation_id).not.toBe(posts[0].operation_id);
 expect((await page.request.put("/api/smart-screens",{data:{action:"update",id:screenId,expectedRev:2,name:"Current C",def}})).ok()).toBe(true);
 await page.reload();await expect(page.getByRole("button",{name:"Browse my screens",exact:true})).toBeDisabled();
 await expect(page.locator("[data-screen-capture]")).toContainText("Version 2");expect(posts).toHaveLength(2);expect(ownerReads).toHaveLength(2);
 await expect.poll(()=>receiptReads).toEqual([posts[1].operation_id]);
 await page.getByRole("button",{name:"Check original outcome",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Screen B",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Current C",exact:true})).toHaveCount(0);
 expect(reconciles).toEqual([posts[1]]);expect(posts).toHaveLength(2);expect(ownerReads).toHaveLength(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole("region",{name:"Retained screens",exact:true}).screenshot({path:info.outputPath("recovered-original-capture.png")});
});

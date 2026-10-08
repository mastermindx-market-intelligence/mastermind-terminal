import { expect, test, type Page } from "@playwright/test";
const original="11111111-1111-4111-8111-111111111111";
const committed="22222222-2222-4222-8222-222222222222";
const nextRevision="33333333-3333-4333-8333-333333333333";
const line=(id:string)=>({id,kind:"hline",source:"user",schemaVersion:1,points:[{t:"2026-01-01",p:100}]});
async function seed(page:Page,entry:unknown){
 await page.addInitScript((value)=>{
  if(sessionStorage.getItem("drawing-recovery-seeded"))return;
  sessionStorage.setItem("drawing-recovery-seeded","1");
  localStorage.setItem("mm.drawing.account-outbox.v1",JSON.stringify({"account:responsive@example.com":{NVDA:value}}));
 },entry);
}
const open=async(page:Page)=>{await page.goto("/terminal?symbol=NVDA");await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();};
const json=(body:unknown)=>({status:200,contentType:"application/json",body:JSON.stringify(body)});

test("lost response retries the exact operation after reload before sending newer edits",async({page})=>{
 await seed(page,{drawings:[line("newer")],revision:null,attempt:{operationId:original,expectedRevision:null,drawings:[line("first")]}});
 const puts:any[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="GET"){await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));return;}
  const value=route.request().postDataJSON();puts.push(value);
  if(puts.length===1){await route.abort("failed");return;}
  await route.fulfill(json({ok:true,operationId:value.operationId,revision:puts.length===2?committed:nextRevision,idempotentReplay:puts.length===2,superseded:false}));
 });
 await open(page);
 await expect(page.getByTestId("drawing-save-recovery")).toContainText("Retry saving");
 await page.reload();
 await expect.poll(()=>puts.length).toBe(3);
 expect(puts[1]).toEqual(puts[0]);expect(puts[1].drawings[0].id).toBe("first");
 expect(puts[2].drawings[0].id).toBe("newer");expect(puts[2].operationId).not.toBe(original);expect(puts[2].expectedRevision).toBe(committed);
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
});

test("two devices conflict and cloud survives until an explicit recovery choice",async({page,browser,baseURL})=>{
 const secondContext=await browser.newContext({baseURL,viewport:page.viewportSize()!,hasTouch:(page.viewportSize()?.width ?? 1440)<=820});const second=await secondContext.newPage();
 let cloud:any={drawings:[],revision:null,schemaVersion:1};let commits=0;let calls=0;
 const serve=async(route:any)=>{
  if(route.request().method()==="GET"){await route.fulfill(json(cloud));return;}
  calls++;const body=route.request().postDataJSON();
  if(body.expectedRevision!==cloud.revision){await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({ok:false,code:"revision_conflict"})});return;}
  commits++;cloud={drawings:body.drawings,revision:commits===1?committed:nextRevision,schemaVersion:1};
  await route.fulfill(json({ok:true,operationId:body.operationId,revision:cloud.revision,idempotentReplay:false,superseded:false}));
 };
 try {
  await page.route("**/api/drawings**",serve);await second.route("**/api/drawings**",serve);
  await seed(page,{drawings:[line("tab-a")],revision:null});await open(page);await expect.poll(()=>commits).toBe(1);
  await seed(second,{drawings:[line("tab-b")],revision:null});await open(second);
  await expect(second.getByTestId("drawing-save-recovery")).toContainText("cloud copy changed");
  await expect(second.getByTestId("drawing-save-recovery")).toContainText("Cloud drawings (1)");
  expect(cloud.drawings[0].id).toBe("tab-a");expect(commits).toBe(1);expect(calls).toBe(2);
  await second.getByRole("button",{name:"Replace cloud with local copy",exact:true}).click();
  await expect.poll(()=>commits).toBe(2);expect(cloud.drawings[0].id).toBe("tab-b");await expect(second.getByTestId("drawing-save-recovery")).toHaveCount(0);
 } finally {await secondContext.close();}
});

test("superseded replay parks queued edits and use-cloud clears the recovered symbol",async({page})=>{
 await seed(page,{drawings:[line("queued")],revision:null,attempt:{operationId:original,expectedRevision:null,drawings:[line("old")]}});let calls=0;
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="GET"){await route.fulfill(json({drawings:[line("external")],revision:committed,schemaVersion:1}));return;}
  calls++;await route.fulfill(json({ok:true,operationId:original,revision:committed,idempotentReplay:true,superseded:true}));
 });
 await open(page);await expect(page.getByTestId("drawing-save-recovery")).toContainText("Cloud drawings (1)");expect(calls).toBe(1);
 await page.getByRole("button",{name:"Use cloud copy",exact:true}).click();await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);expect(calls).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v1"))).toBeNull();
});

test("old local clear-all is not silently replayed against a fresh cloud read",async({page})=>{
 await seed(page,[]);let puts=0;
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="GET"){await route.fulfill(json({drawings:[line("cloud")],revision:committed,schemaVersion:1}));return;}
  puts++;await route.fulfill(json({ok:true}));
 });
 await open(page);await expect(page.getByTestId("drawing-save-recovery")).toContainText("Local drawings (0)");
 await expect(page.getByTestId("drawing-save-recovery")).toContainText("Cloud drawings (1)");expect(puts).toBe(0);
});

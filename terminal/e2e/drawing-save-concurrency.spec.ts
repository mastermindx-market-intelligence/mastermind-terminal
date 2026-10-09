import { expect, test, type Page } from "@playwright/test";
const original="11111111-1111-4111-8111-111111111111";
const committed="22222222-2222-4222-8222-222222222222";
const nextRevision="33333333-3333-4333-8333-333333333333";
const line=(id:string)=>({id,kind:"hline",source:"user",schemaVersion:1,points:[{t:"2026-01-01",p:100}]});
async function seed(page:Page,entry:unknown){
 await page.addInitScript((value)=>{
  if(sessionStorage.getItem("drawing-recovery-seeded"))return;
  sessionStorage.setItem("drawing-recovery-seeded","1");
  if(Array.isArray(value)){
   localStorage.setItem("mm.drawing.account-outbox.v1",JSON.stringify({"account:responsive@example.com":{NVDA:value}}));
  }else{
   const record=(value as any)?.format===2?value:{format:2,copies:{"44444444-4444-4444-8444-444444444444":value}};
   localStorage.setItem("mm.drawing.account-outbox.v2",JSON.stringify({"account:responsive@example.com":{NVDA:record}}));
  }
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

// A site-data clear is not an acknowledgement: the retry must write the exact
// lost-response operation ahead again and resend it, not reload the cloud.
test("site-data loss before a retry keeps the unsaved drawing and resends the exact lost-response operation",async({page,context})=>{
 await seed(page,{drawings:[line("first")],revision:null,attempt:{operationId:original,expectedRevision:null,drawings:[line("first")]}});
 const puts:any[]=[];const storedAtPut:(string|null)[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="GET"){await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));return;}
  const value=route.request().postDataJSON();puts.push(value);
  storedAtPut.push(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2")));
  if(puts.length===1){await route.abort("failed");return;}
  await route.fulfill(json({ok:true,operationId:value.operationId,revision:committed,idempotentReplay:true,superseded:false}));
 });
 await open(page);
 const recovery=page.getByTestId("drawing-save-recovery");
 await expect(recovery).toContainText("Retry saving",{timeout:20_000});
 const cdp=await context.newCDPSession(page);
 await cdp.send("Storage.clearDataForOrigin",{origin:new URL(page.url()).origin,storageTypes:"local_storage"});
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2")),{timeout:20_000}).toBeNull();
 await recovery.getByRole("button",{name:"Retry save",exact:true}).click({timeout:20_000});
 await expect.poll(()=>puts.length,{timeout:20_000}).toBe(2);
 expect(puts[1]).toEqual(puts[0]);expect(puts[1].operationId).toBe(original);
 const copies=JSON.parse(storedAtPut[1]??"{}")["account:responsive@example.com"]?.NVDA?.copies??{};
 expect(Object.values(copies).map((copy:any)=>copy.attempt?.operationId)).toEqual([original]);
 await expect(recovery).toHaveCount(0,{timeout:20_000});
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
 expect(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"))).toBeNull();
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

// Preserve the actual durable fixture state when a recovery assertion fails.
test.afterEach(async({page},info)=>{
 if(info.status!==info.expectedStatus) console.log("A04_RECOVERY_FAILURE_STORAGE",await page.evaluate(()=>({legacy:localStorage.getItem("mm.drawing.account-outbox.v1"),current:localStorage.getItem("mm.drawing.account-outbox.v2")})));
});

test("competing local copies require explicit selection and are discarded individually",async({page})=>{
 await seed(page,{format:2,copies:{[original]:{drawings:[line("local-a")],revision:null},[committed]:{drawings:[line("local-b")],revision:null}}});
 let puts=0;let cloud:any={drawings:[line("cloud")],revision:nextRevision,schemaVersion:1};
 await page.route("**/api/drawings**",async route=>{
  if(route.request().method()==="GET"){await route.fulfill(json(cloud));return;}
  puts++;const body=route.request().postDataJSON();expect(body.expectedRevision).toBe(nextRevision);
  cloud={drawings:body.drawings,revision:committed,schemaVersion:1};
  await route.fulfill(json({ok:true,operationId:body.operationId,revision:committed,idempotentReplay:false,superseded:false}));
 });
 await open(page);await expect(page.getByTestId("drawing-save-recovery")).toContainText("Cloud drawings (1)");expect(puts).toBe(0);
 await page.getByRole("button",{name:/Review another local copy/}).click();
 await page.getByRole("button",{name:"Replace cloud with local copy",exact:true}).click();
 await expect.poll(()=>puts).toBe(1);expect(cloud.drawings[0].id).toBe("local-b");
 await expect(page.getByTestId("drawing-save-recovery")).toContainText("Cloud drawings (1)");
 await page.getByRole("button",{name:"Use cloud copy",exact:true}).click();
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);expect(puts).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"))).toBeNull();
});

test("selecting another copy then using cloud discards that copy without an intervening save",async({page})=>{
 await seed(page,{format:2,copies:{[original]:{drawings:[line("local-a")],revision:null},[committed]:{drawings:[line("local-b")],revision:null}}});
 let puts=0;
 await page.route("**/api/drawings**",async route=>{
  if(route.request().method()==="PUT")puts++;
  await route.fulfill(json({drawings:[line("cloud")],revision:nextRevision,schemaVersion:1}));
 });
 await open(page);await expect(page.getByTestId("drawing-save-recovery")).toContainText("Cloud drawings (1)");
 await page.getByRole("button",{name:/Review another local copy/}).click();
 await page.getByRole("button",{name:"Use cloud copy",exact:true}).click();
 await expect(page.getByTestId("drawing-save-recovery")).toContainText("Local drawings (1)");
 const remaining=await page.evaluate(()=>JSON.parse(localStorage.getItem("mm.drawing.account-outbox.v2")!)["account:responsive@example.com"].NVDA.copies);
 expect(Object.keys(remaining)).toEqual([original]);expect(remaining[original].drawings[0].id).toBe("local-a");expect(puts).toBe(0);
 await page.getByRole("button",{name:"Use cloud copy",exact:true}).click();
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);expect(puts).toBe(0);
 expect(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"))).toBeNull();
});

test("unavailable durable serialization warns to keep the tab open and never starts a save",async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,"locks",{value:undefined,configurable:true}));
 await seed(page,{drawings:[line("memory-only")],revision:null});let puts=0;
 await page.route("**/api/drawings**",async route=>{
  if(route.request().method()==="PUT")puts++;
  await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));
 });
 await open(page);await expect(page.getByTestId("drawing-save-recovery")).toContainText("Keep this tab open");expect(puts).toBe(0);
 expect(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("mm.drawing.account-outbox.v2")!)["account:responsive@example.com"].NVDA.copies as Record<string,any>)[0].drawings[0].id)).toBe("memory-only");
});

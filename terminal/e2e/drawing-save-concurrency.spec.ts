import { expect, test, type Page } from "@playwright/test";
const original="11111111-1111-4111-8111-111111111111";
const committed="22222222-2222-4222-8222-222222222222";
const nextRevision="33333333-3333-4333-8333-333333333333";
// The fixture account's auth UUID (app/terminal/page.tsx -> fixtureUserId("default")).
// Released clients keyed the v1 outbox on the email; it stays an import source only.
const owner="account:e2e-user-default";
const line=(id:string)=>({id,kind:"hline",source:"user",schemaVersion:1,points:[{t:"2026-01-01",p:100}]});
async function seed(page:Page,entry:unknown){
 await page.addInitScript((value)=>{
  if(sessionStorage.getItem("drawing-recovery-seeded"))return;
  sessionStorage.setItem("drawing-recovery-seeded","1");
  if(Array.isArray(value)){
   localStorage.setItem("mm.drawing.account-outbox.v1",JSON.stringify({"account:responsive@example.com":{NVDA:value}}));
  }else{
   const record=(value as any)?.format===2?value:{format:2,copies:{"44444444-4444-4444-8444-444444444444":value}};
   localStorage.setItem("mm.drawing.account-outbox.v2",JSON.stringify({"account:e2e-user-default":{NVDA:record}}));
  }
 },entry);
}
// Account-identity law: owner-scoped stores key on the auth UUID, never the email,
// and owner identity never travels in a URL (history, proxy logs, edge cache keys).
test("drawing reads and saves carry the auth-UUID owner, never the email, and never in a URL",async({page})=>{
 await seed(page,{drawings:[line("uuid-owned")],revision:null});
 const seen:{method:string;url:string;header:string|undefined;body?:{ownerKey?:string}}[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  const request=route.request();
  seen.push({method:request.method(),url:request.url(),header:request.headers()["x-drawing-owner"],body:request.method()==="PUT"?request.postDataJSON():undefined});
  if(request.method()==="GET"){await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));return;}
  await route.fulfill(json({ok:true,operationId:request.postDataJSON().operationId,revision:committed,idempotentReplay:false,superseded:false}));
 });
 await open(page);
 await expect.poll(()=>seen.filter((request)=>request.method==="PUT").length,{timeout:20_000}).toBe(1);
 expect(seen.filter((request)=>request.method==="GET").length).toBeGreaterThan(0);
 for(const request of seen){
  const url=new URL(request.url);
  expect(url.searchParams.has("ownerKey")).toBe(false);
  expect(decodeURIComponent(request.url)).not.toContain("@");
  if(request.method==="GET") expect(request.header).toBe(owner);
  else expect(request.body?.ownerKey).toBe(owner);
 }
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
});
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

// A site-data clear is not an acknowledgement, but it also erases the receipt
// that would prove an explicit "Use cloud" discard. The retry keeps the
// unsaved drawing and the exact lost-response operation, then waits for an
// explicit choice instead of resending it over the cloud.
test("site-data loss before a retry keeps the unsaved drawing and its exact operation for an explicit choice",async({page,context})=>{
 await seed(page,{drawings:[line("first")],revision:null,attempt:{operationId:original,expectedRevision:null,drawings:[line("first")]}});
 const puts:{operationId:string;expectedRevision:string|null;drawings:{id:string}[]}[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="GET"){await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));return;}
  const value=route.request().postDataJSON();puts.push(value);
  if(puts.length===1){await route.abort("failed");return;}
  await route.fulfill(json({ok:true,operationId:value.operationId,revision:committed,idempotentReplay:false,superseded:false}));
 });
 await open(page);
 const recovery=page.getByTestId("drawing-save-recovery");
 await expect(recovery).toContainText("Retry saving",{timeout:20_000});
 await expect.poll(()=>puts.length,{timeout:20_000}).toBe(1);
 // The failed save settles only after its final durable journal write; the shell
 // re-enables Retry save at that point. Losing site data before that write lets the
 // write restore the journal, so the site-data loss must follow the settled save.
 await expect(recovery.getByRole("button",{name:"Retry save",exact:true})).toBeEnabled({timeout:20_000});
 const cdp=await context.newCDPSession(page);
 await cdp.send("Storage.clearDataForOrigin",{origin:new URL(page.url()).origin,storageTypes:"local_storage"});
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2")),{timeout:20_000}).toBeNull();
 await recovery.getByRole("button",{name:"Retry save",exact:true}).click({timeout:20_000});
 await expect(recovery).toContainText("The cloud copy changed, or local recovery needs review",{timeout:20_000});
 await expect(recovery.getByRole("button",{name:"Replace cloud with local copy",exact:true})).toBeVisible({timeout:20_000});
 await expect(recovery.getByRole("button",{name:"Use cloud copy",exact:true})).toBeVisible({timeout:20_000});
 const stored=async()=>Object.values(JSON.parse(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"))??"{}")["account:e2e-user-default"]?.NVDA?.copies??{}) as {blocked?:string;drawings:{id:string}[];attempt?:{operationId?:string}}[];
 await expect.poll(async()=>(await stored()).map((copy)=>[copy.drawings[0]?.id,copy.attempt?.operationId,copy.blocked]),{timeout:20_000}).toEqual([["first",original,"conflict"]]);
 expect(puts).toHaveLength(1);
 // Only the explicit choice sends, as a new operation against the cloud read.
 await recovery.getByRole("button",{name:"Replace cloud with local copy",exact:true}).click({timeout:20_000});
 await expect.poll(()=>puts.length,{timeout:20_000}).toBe(2);
 expect(puts[1].operationId).not.toBe(original);expect(puts[1].expectedRevision).toBeNull();expect(puts[1].drawings.map((drawing)=>drawing.id)).toEqual(["first"]);
 await expect(recovery).toHaveCount(0,{timeout:20_000});
});

// A failed authoritative read is not an empty account: the chart says so and
// keeps every drawing tool disarmed, so nothing can replace an unseen collection.
test("a failed drawings read is shown and keeps drawing disabled",async({page})=>{
 let puts=0;
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="PUT"){puts++;await route.fulfill(json({ok:false}));return;}
  await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Could not load drawings"})});
 });
 await open(page);
 await expect(page.getByRole("alert").filter({hasText:"Saved drawings could not be loaded"})).toBeVisible({timeout:20_000});
 const lines=page.getByTestId("drawing-group-lines-main");
 if((page.viewportSize()?.width??1440)<=640){
  await page.getByTestId("roller-draw").click({timeout:20_000});
  await page.getByTestId("drawings-cat-trendlines").click({timeout:20_000});
  await page.getByTestId("drawings-tile-trendline").click({timeout:20_000});
 }else{
  await lines.click({timeout:20_000});
 }
 await expect(lines).toHaveAttribute("aria-pressed","false",{timeout:20_000});
 expect(puts).toBe(0);
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
 const remaining=await page.evaluate(()=>JSON.parse(localStorage.getItem("mm.drawing.account-outbox.v2")!)["account:e2e-user-default"].NVDA.copies);
 expect(Object.keys(remaining)).toEqual([original]);expect(remaining[original].drawings[0].id).toBe("local-a");expect(puts).toBe(0);
 await page.getByRole("button",{name:"Use cloud copy",exact:true}).click();
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);expect(puts).toBe(0);
 expect(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"))).toBeNull();
});

test("owner_conflict keeps the local copy and does not offer replace",async({page})=>{
 await seed(page,{drawings:[line("kept-local")],revision:null});
 let puts=0;
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="GET"){await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));return;}
  puts++;
  await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({ok:false,code:"owner_conflict"})});
 });
 await open(page);
 const recovery=page.getByTestId("drawing-save-recovery");
 await expect(recovery).toBeVisible({timeout:20_000});
 await expect(recovery).toContainText("different account",{timeout:20_000});
 await expect(recovery).toContainText("kept on this device");
 await expect(recovery.getByRole("button",{name:"Replace cloud with local copy",exact:true})).toHaveCount(0);
 await expect(recovery.getByRole("button",{name:"Use cloud copy",exact:true})).toHaveCount(0);
 const stored=async()=>Object.values(JSON.parse(await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"))??"{}")["account:e2e-user-default"]?.NVDA?.copies??{}) as {blocked?:string;conflictCode?:string;drawings:{id:string}[]}[];
 await expect.poll(async()=>(await stored()).map((copy)=>[copy.drawings[0]?.id,copy.blocked,copy.conflictCode]),{timeout:20_000}).toEqual([["kept-local","conflict","owner_conflict"]]);
 expect(puts).toBeGreaterThan(0);
});

test("unavailable durable serialization warns to keep the tab open and never starts a save",async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,"locks",{value:undefined,configurable:true}));
 await seed(page,{drawings:[line("memory-only")],revision:null});let puts=0;
 await page.route("**/api/drawings**",async route=>{
  if(route.request().method()==="PUT")puts++;
  await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));
 });
 await open(page);await expect(page.getByTestId("drawing-save-recovery")).toContainText("Keep this tab open");expect(puts).toBe(0);
 expect(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem("mm.drawing.account-outbox.v2")!)["account:e2e-user-default"].NVDA.copies as Record<string,any>)[0].drawings[0].id)).toBe("memory-only");
});

const r1="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const r2="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const cloudLine=(id:string,p:number)=>({id,kind:"hline",source:"user",schemaVersion:1,points:[{t:"2026-06-15",p}]});
async function pickSymbol(page:Page,symbol:string){
 await page.locator(".pair").first().click();
 const search=page.locator(".sh input");
 await expect(search).toBeVisible({timeout:20_000});
 await search.fill(symbol);
 await expect(page.locator('.sres [role="option"]').first()).toBeVisible({timeout:20_000});
 await search.press("Enter");
 await expect(page.locator(".pair b").first()).toHaveText(symbol,{timeout:20_000});
}

// D1: the first NVDA GET must not land after leave/return started a newer GET.
// Hold GET1 until GET2 exists, deliver D_old then D_new, edit, and require the PUT to keep D_new.
test("a stale overlapping drawings GET cannot overwrite a newer load before the next save",async({page})=>{
 test.skip((page.viewportSize()?.width??1440)<=860,"Symbol switch plus a pointer edit is exercised on the desktop chart.");
 let releaseStale:()=>void=()=>{};
 let releaseFresh:()=>void=()=>{};
 const staleHeld=new Promise<void>((resolve)=>{releaseStale=resolve;});
 const freshHeld=new Promise<void>((resolve)=>{releaseFresh=resolve;});
 let serveStale=true;
 let staleGets=0;
 let freshGets=0;
 let staleFulfilled=0;
 const puts:{drawings:{id:string}[];expectedRevision:string|null}[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  const request=route.request();
  if(request.method()==="PUT"){
   const value=request.postDataJSON();
   puts.push(value);
   await route.fulfill(json({ok:true,operationId:value.operationId,revision:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",idempotentReplay:false,superseded:false}));
   return;
  }
  const symbol=new URL(request.url()).searchParams.get("symbol");
  if(symbol!=="NVDA"){
   await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));
   return;
  }
  const stale=serveStale;
  if(stale){
   staleGets+=1;
   await staleHeld;
   await route.fulfill(json({drawings:[cloudLine("old-cloud",196)],revision:r1,schemaVersion:1}));
   staleFulfilled+=1;
   return;
  }
  freshGets+=1;
  await freshHeld;
  await route.fulfill(json({drawings:[cloudLine("new-cloud",204)],revision:r2,schemaVersion:1}));
 });
 await page.goto("/terminal?symbol=NVDA");
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect.poll(()=>staleGets,{timeout:20_000}).toBeGreaterThan(0);
 await pickSymbol(page,"AAPL");
 serveStale=false;
 await pickSymbol(page,"NVDA");
 await expect.poll(()=>freshGets,{timeout:20_000}).toBeGreaterThan(0);
 const staleResponse=page.waitForResponse((response)=>response.url().includes("/api/drawings")&&response.url().includes("NVDA")&&response.request().method()==="GET");
 releaseStale();
 await staleResponse;
 await page.locator(".pair b").first().evaluate((el)=>el.textContent);
 releaseFresh();
 await expect(page.locator('.pane.on .drawing-layer g[data-id="new-cloud"]')).toHaveCount(1,{timeout:20_000});
 await expect(page.locator('.pane.on .drawing-layer g[data-id="old-cloud"]')).toHaveCount(0);
 const layer=page.locator(".pane.on .drawing-layer");
 const box=await layer.boundingBox();
 expect(box).not.toBeNull();
 await page.getByTestId("drawing-group-lines-main").click();
 await page.mouse.click(box!.x+box!.width*0.23,box!.y+box!.height*0.34);
 await page.mouse.click(box!.x+box!.width*0.57,box!.y+box!.height*0.52);
 await expect.poll(()=>puts.length,{timeout:20_000}).toBeGreaterThan(0);
 const saved=puts[0].drawings.map((drawing)=>drawing.id);
 expect(saved).toContain("new-cloud");
 expect(saved).not.toContain("old-cloud");
 expect(puts[0].expectedRevision).toBe(r2);
 expect(staleFulfilled).toBeGreaterThan(0);
});

// Pre-load edit: hold the pane's drawings GET, draw, then release. The GET must
// union-merge the cloud snapshot with the local addition and save against R.
// A false "cloud copy changed" toast means the success branch parked a no-revision
// journal as legacy instead of stamping the GET.
test("drawing before the pane GET settles merges cloud ids and does not claim the cloud changed",async({page})=>{
 test.skip((page.viewportSize()?.width??1440)<=860,"Pointer edit plus a held GET is exercised on the desktop chart.");
 const cloudRevision="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const cloudId="cloud-hline";
 let releaseGet:()=>void=()=>{};
 const getHeld=new Promise<void>((resolve)=>{releaseGet=resolve;});
 let gets=0;
 const puts:{drawings:{id:string}[];expectedRevision:string|null}[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  const request=route.request();
  if(request.method()==="PUT"){
   const value=request.postDataJSON();
   puts.push(value);
   await route.fulfill(json({ok:true,operationId:value.operationId,revision:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",idempotentReplay:false,superseded:false}));
   return;
  }
  const symbol=new URL(request.url()).searchParams.get("symbol");
  if(symbol!=="NVDA"){
   await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));
   return;
  }
  gets+=1;
  await getHeld;
  await route.fulfill(json({drawings:[cloudLine(cloudId,196)],revision:cloudRevision,schemaVersion:1}));
 });
 await page.goto("/terminal?symbol=NVDA");
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect.poll(()=>gets,{timeout:20_000}).toBeGreaterThan(0);
 const layer=page.locator(".pane.on .drawing-layer");
 await expect(layer).toBeVisible();
 const box=await layer.boundingBox();
 expect(box).not.toBeNull();
 await page.getByTestId("drawing-group-lines-main").click();
 await expect(page.getByTestId("drawing-group-lines-main")).toHaveAttribute("aria-pressed","true",{timeout:20_000});
 await page.mouse.click(box!.x+box!.width*0.23,box!.y+box!.height*0.34);
 await page.mouse.click(box!.x+box!.width*0.57,box!.y+box!.height*0.52);
 await expect(layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])')).toHaveCount(1,{timeout:20_000});
 const localId=await layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])').first().getAttribute("data-id");
 expect(localId).toBeTruthy();
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
 await expect(page.getByText("cloud copy changed")).toHaveCount(0);
 releaseGet();
 await expect.poll(()=>puts.length,{timeout:20_000}).toBeGreaterThan(0);
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
 await expect(page.getByText("cloud copy changed")).toHaveCount(0);
 const saved=puts[0].drawings.map((drawing)=>drawing.id);
 expect(saved).toContain(cloudId);
 expect(saved).toContain(localId as string);
 expect(puts[0].expectedRevision).toBe(cloudRevision);
});

// D1: a stroke made while the GET is held must land in the durable journal so a
// reload (GET still held) restores it. After the GET settles, save against R.
test("a pre-GET drawing survives reload while the GET is still held and then saves against the GET revision",async({page})=>{
 test.skip((page.viewportSize()?.width??1440)<=860,"Pointer edit plus a held GET is exercised on the desktop chart.");
 const cloudRevision="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const cloudId="cloud-hline";
 let releaseGet:()=>void=()=>{};
 const getHeld=new Promise<void>((resolve)=>{releaseGet=resolve;});
 let gets=0;
 const puts:{drawings:{id:string}[];expectedRevision:string|null}[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  const request=route.request();
  if(request.method()==="PUT"){
   const value=request.postDataJSON();
   puts.push(value);
   await route.fulfill(json({ok:true,operationId:value.operationId,revision:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",idempotentReplay:false,superseded:false}));
   return;
  }
  const symbol=new URL(request.url()).searchParams.get("symbol");
  if(symbol!=="NVDA"){
   await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));
   return;
  }
  gets+=1;
  await getHeld;
  await route.fulfill(json({drawings:[cloudLine(cloudId,196)],revision:cloudRevision,schemaVersion:1}));
 });
 await page.goto("/terminal?symbol=NVDA");
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect.poll(()=>gets,{timeout:20_000}).toBeGreaterThan(0);
 const layer=page.locator(".pane.on .drawing-layer");
 await expect(layer).toBeVisible();
 const box=await layer.boundingBox();
 expect(box).not.toBeNull();
 await page.getByTestId("drawing-group-lines-main").click();
 await expect(page.getByTestId("drawing-group-lines-main")).toHaveAttribute("aria-pressed","true",{timeout:20_000});
 await page.mouse.click(box!.x+box!.width*0.23,box!.y+box!.height*0.34);
 await page.mouse.click(box!.x+box!.width*0.57,box!.y+box!.height*0.52);
 await expect(layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])')).toHaveCount(1,{timeout:20_000});
 const localId=await layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])').first().getAttribute("data-id");
 expect(localId).toBeTruthy();
 await expect.poll(async()=>{
  const raw=await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"));
  return raw&&raw.includes(localId as string);
 },{timeout:20_000}).toBe(true);
 const getsBeforeReload=gets;
 await page.reload();
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect.poll(()=>gets,{timeout:20_000}).toBeGreaterThan(getsBeforeReload);
 await expect(page.locator(`.pane.on .drawing-layer g[data-drawing-kind="trendline"][data-id="${localId}"]`)).toHaveCount(1,{timeout:20_000});
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
 releaseGet();
 await expect.poll(()=>puts.length,{timeout:20_000}).toBeGreaterThan(0);
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
 const saved=puts[0].drawings.map((drawing)=>drawing.id);
 expect(saved).toContain(cloudId);
 expect(saved).toContain(localId as string);
 expect(puts[0].expectedRevision).toBe(cloudRevision);
});

// D1/R3: pagehide, leave/return, and reload must all keep a pre-GET stroke while the
// GET is held. After release, one save against the GET revision.
test("a pre-GET drawing survives pagehide, leave/return, and reload while the GET is held",async({page})=>{
 test.skip((page.viewportSize()?.width??1440)<=860,"Pointer edit plus a held GET is exercised on the desktop chart.");
 const cloudRevision="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const cloudId="cloud-hline";
 let releaseGet:()=>void=()=>{};
 const getHeld=new Promise<void>((resolve)=>{releaseGet=resolve;});
 let gets=0;
 const puts:{drawings:{id:string}[];expectedRevision:string|null}[]=[];
 await page.route("**/api/drawings**",async(route)=>{
  const request=route.request();
  if(request.method()==="PUT"){
   const value=request.postDataJSON();
   puts.push(value);
   await route.fulfill(json({ok:true,operationId:value.operationId,revision:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",idempotentReplay:false,superseded:false}));
   return;
  }
  const symbol=new URL(request.url()).searchParams.get("symbol");
  if(symbol!=="NVDA"){
   await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));
   return;
  }
  gets+=1;
  await getHeld;
  await route.fulfill(json({drawings:[cloudLine(cloudId,196)],revision:cloudRevision,schemaVersion:1}));
 });
 await page.goto("/terminal?symbol=NVDA");
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect.poll(()=>gets,{timeout:20_000}).toBeGreaterThan(0);
 const layer=page.locator(".pane.on .drawing-layer");
 await expect(layer).toBeVisible();
 const box=await layer.boundingBox();
 expect(box).not.toBeNull();
 await page.getByTestId("drawing-group-lines-main").click();
 await expect(page.getByTestId("drawing-group-lines-main")).toHaveAttribute("aria-pressed","true",{timeout:20_000});
 await page.mouse.click(box!.x+box!.width*0.23,box!.y+box!.height*0.34);
 await page.mouse.click(box!.x+box!.width*0.57,box!.y+box!.height*0.52);
 await expect(layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])')).toHaveCount(1,{timeout:20_000});
 const localId=await layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])').first().getAttribute("data-id");
 expect(localId).toBeTruthy();
 await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));
 await expect.poll(async()=>{
  const raw=await page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2"));
  return raw&&raw.includes(localId as string);
 },{timeout:20_000}).toBe(true);
 expect(puts).toHaveLength(0);
 const getsAfterDraw=gets;
 await page.goto("/analysis");
 await page.goto("/terminal?symbol=NVDA");
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect.poll(()=>gets,{timeout:20_000}).toBeGreaterThan(getsAfterDraw);
 await expect(page.locator(`.pane.on .drawing-layer g[data-drawing-kind="trendline"][data-id="${localId}"]`)).toHaveCount(1,{timeout:20_000});
 const getsBeforeReload=gets;
 await page.reload();
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect.poll(()=>gets,{timeout:20_000}).toBeGreaterThan(getsBeforeReload);
 await expect(page.locator(`.pane.on .drawing-layer g[data-drawing-kind="trendline"][data-id="${localId}"]`)).toHaveCount(1,{timeout:20_000});
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
 expect(puts).toHaveLength(0);
 releaseGet();
 await expect.poll(()=>puts.length,{timeout:20_000}).toBe(1);
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0);
 const saved=puts[0].drawings.map((drawing)=>drawing.id);
 expect(saved).toContain(cloudId);
 expect(saved).toContain(localId as string);
 expect(puts[0].expectedRevision).toBe(cloudRevision);
});

// F2 falsifier: the pagehide listener must flush every drawPending symbol
// immediately so a revision-bearing edit's PUT starts before the page goes,
// instead of after the 600ms debounce. The pre-GET survival test above stays
// green even with the listener removed (setSymbolDrawings already writes the
// preload journal row, and the unmount flush covers leave/return); what this
// test uniquely proves is that pagehide fires the PUT before the debounce
// would have, by intercepting setTimeout before any user code arms the 600 ms
// debounce. With every delayed timer extended to 60 s, the only way a PUT can
// arrive in the test window is via the synchronous pagehide handler.
test("pagehide flushes a revision-bearing PUT before the 600ms debounce can fire",async({page})=>{
 test.skip((page.viewportSize()?.width??1440)<=860,"Page-clock flush is exercised on the desktop chart.");
 const cloudRevision="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const cloudId="cloud-hline";
 const puts:{drawings:{id:string}[];expectedRevision:string|null;operationId?:string}[]=[];
 // Replace window.setTimeout before any user script executes, so the
 // 600 ms drawing-flush debounce cannot fire within the test window. Short
 // timers (≤ 100 ms) keep their original delay so React's microtask loop and
 // Playwright's own waiting stay alive; the drawing flush specifically arms
 // setTimeout(..., 600).
 await page.addInitScript(()=>{
  const originalSetTimeout=window.setTimeout;
  window.setTimeout=((handler:TimerHandler,delay?:number,...args:unknown[])=>{
   const ms=typeof delay==="number"?delay:0;
   if(ms>100)return originalSetTimeout(handler as TimerHandler,60_000,...args);
   return originalSetTimeout(handler as TimerHandler,ms,...args);
  }) as typeof window.setTimeout;
 });
 await page.route("**/api/drawings**",async(route)=>{
  const request=route.request();
  if(request.method()==="PUT"){
   const value=request.postDataJSON();
   puts.push(value);
   // Hold the PUT response so the listener's durable journal write remains
   // observable. The listener persists the attempt BEFORE the PUT is sent, and
   // settleDrawingAttempt (which would clear the attempt) only runs after the
   // response is received. With the response paused, the journal row carries
   // the attempt indefinitely so we can prove the listener persisted it.
   await new Promise<void>(()=>{});
   return;
  }
  const symbol=new URL(request.url()).searchParams.get("symbol");
  if(symbol!=="NVDA"){
   await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));
   return;
  }
  await route.fulfill(json({drawings:[cloudLine(cloudId,196)],revision:cloudRevision,schemaVersion:1}));
 });
 await page.goto("/terminal?symbol=NVDA");
 await page.locator(".chart-wrap canvas").first().waitFor({state:"visible",timeout:20_000});
 await page.locator(`.pane.on .drawing-layer g[data-id="${cloudId}"]`).first().waitFor({state:"visible",timeout:20_000});
 const layer=page.locator(".pane.on .drawing-layer");
 await layer.waitFor({state:"visible",timeout:20_000});
 const box=await layer.boundingBox();
 expect(box).not.toBeNull();
 await page.getByTestId("drawing-group-lines-main").click();
 // Confirm the drawing tool armed itself, then click two points to draw a
 // revision-bearing trendline. After this, setSymbolDrawings arms the 600 ms
 // debounce — but our override has pushed it out to 60 s, so it cannot fire.
 await page.locator('g[data-drawing-kind="trendline"]').first().waitFor({state:"attached",timeout:20_000}).catch(()=>undefined);
 await page.mouse.click(box!.x+box!.width*0.23,box!.y+box!.height*0.34);
 await page.mouse.click(box!.x+box!.width*0.57,box!.y+box!.height*0.52);
 await layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])').first().waitFor({state:"attached",timeout:20_000});
 const localId=await layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])').first().getAttribute("data-id");
 expect(localId).toBeTruthy();
 expect(localId).not.toBe(cloudId);
 // No PUT yet: the 600 ms debounce was extended to 60 s by the init override,
 // and no clock-advance has happened. The journal row carries revision R but
 // no attempt yet.
 expect(puts).toHaveLength(0);
 await page.waitForFunction(({sym,expectedRevision,localId}:{sym:string;expectedRevision:string;localId:string|null})=>{
  const raw=localStorage.getItem("mm.drawing.account-outbox.v2");
  if(!raw)return false;
  const journal=JSON.parse(raw) as Record<string,Record<string,any>>;
  const entry=Object.values(journal["account:e2e-user-default"]?.[sym]?.copies??{})[0] as {drawings?:{id:string}[];attempt?:unknown;revision?:string}|undefined;
  return entry?.revision===expectedRevision&&!!entry?.drawings?.some((d)=>d.id===localId)&&!entry?.attempt;
 },{sym:"NVDA",expectedRevision:cloudRevision,localId},{polling:"raf",timeout:5_000});
 // Dispatch pagehide BEFORE any 60 s timer can fire. The listener must call
 // flushDrawingsRef.current(sym) synchronously and produce a PUT before any
 // timer — the debounce included — has a chance to run.
 await page.evaluate(()=>window.dispatchEvent(new Event("pagehide")));
 await page.waitForFunction(()=>{
  const raw=localStorage.getItem("mm.drawing.account-outbox.v2");
  if(!raw)return false;
  const journal=JSON.parse(raw) as Record<string,Record<string,any>>;
  const entry=Object.values(journal["account:e2e-user-default"]?.NVDA?.copies??{})[0] as {attempt?:{operationId:string;expectedRevision:string;drawings:{id:string}[]}}|undefined;
  return !!entry?.attempt&&entry.attempt.expectedRevision.length>0;
 },undefined,{polling:"raf",timeout:5_000});
 // Read the final state without further polling.
 const finalPuts=puts.slice();
 const journalAttempt=await page.evaluate(()=>{
  const raw=localStorage.getItem("mm.drawing.account-outbox.v2");
  if(!raw)return null;
  const journal=JSON.parse(raw) as Record<string,Record<string,any>>;
  const entry=Object.values(journal["account:e2e-user-default"]?.NVDA?.copies??{})[0] as {attempt?:{operationId:string;expectedRevision:string;drawings:{id:string}[]}}|undefined;
  return entry?.attempt??null;
 });
 expect(finalPuts.length).toBe(1);
 expect(finalPuts[0].expectedRevision).toBe(cloudRevision);
 expect(finalPuts[0].drawings.map((drawing)=>drawing.id)).toContain(localId as string);
 expect(finalPuts[0].drawings.map((drawing)=>drawing.id)).toContain(cloudId);
 expect(typeof finalPuts[0].operationId).toBe("string");
 expect(journalAttempt).not.toBeNull();
 expect(journalAttempt?.expectedRevision).toBe(cloudRevision);
 expect(journalAttempt?.operationId).toBe(finalPuts[0].operationId);
 expect(journalAttempt?.drawings?.map((drawing)=>drawing.id)).toContain(localId as string);
});

// P1(a): a leftover preload row whose drawings are already on the cloud must
// acknowledge. A second tab / reload that hydrates { drawings:[L], preload:true }
// against GET {C, L} used to park and offer keep-mine of [L], which deleted C.
test("a leftover preload row already on the cloud acknowledges without a prompt or PUT",async({page})=>{
 test.skip((page.viewportSize()?.width??1440)<=860,"Preload journal hydrate vs GET is exercised on the desktop chart.");
 const cloudRevision="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const cloud=[cloudLine("cloud-hline",196),cloudLine("pre-tab-a",100)];
 let puts=0;
 await seed(page,{drawings:[cloudLine("pre-tab-a",100)],preload:true});
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="PUT"){puts++;await route.fulfill(json({ok:true,operationId:route.request().postDataJSON().operationId,revision:committed,idempotentReplay:false,superseded:false}));return;}
  const symbol=new URL(route.request().url()).searchParams.get("symbol");
  if(symbol!=="NVDA"){await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));return;}
  await route.fulfill(json({drawings:cloud,revision:cloudRevision,schemaVersion:1}));
 });
 await open(page);
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0,{timeout:20_000});
 await expect(page.getByText("cloud copy changed")).toHaveCount(0);
 await expect(page.locator('.pane.on .drawing-layer g[data-id="cloud-hline"]')).toHaveCount(1,{timeout:20_000});
 await expect(page.locator('.pane.on .drawing-layer g[data-id="pre-tab-a"]')).toHaveCount(1);
 await expect.poll(async()=>page.evaluate(()=>localStorage.getItem("mm.drawing.account-outbox.v2")),{timeout:20_000}).toBeNull();
 expect(puts).toBe(0);
});

// P1(b): overlapping preload id whose cloud version differs is a real conflict.
// Keep-mine must PUT cloud ∪ pending so cloud-only drawings are not deleted.
test("keep-mine of a differing preload overlap PUTs every cloud-only id",async({page})=>{
 test.skip((page.viewportSize()?.width??1440)<=860,"Preload keep-mine PUT body is exercised on the desktop chart.");
 const cloudRevision="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const puts:{drawings:{id:string;points:{p:number}[]}[];expectedRevision:string|null}[]=[];
 await seed(page,{drawings:[cloudLine("pre-tab-a",50)],preload:true});
 await page.route("**/api/drawings**",async(route)=>{
  if(route.request().method()==="PUT"){
   const value=route.request().postDataJSON();
   puts.push(value);
   await route.fulfill(json({ok:true,operationId:value.operationId,revision:committed,idempotentReplay:false,superseded:false}));
   return;
  }
  const symbol=new URL(route.request().url()).searchParams.get("symbol");
  if(symbol!=="NVDA"){await route.fulfill(json({drawings:[],revision:null,schemaVersion:1}));return;}
  await route.fulfill(json({drawings:[cloudLine("cloud-hline",196),cloudLine("pre-tab-a",100)],revision:cloudRevision,schemaVersion:1}));
 });
 await open(page);
 const recovery=page.getByTestId("drawing-save-recovery");
 await expect(recovery).toContainText("cloud copy changed",{timeout:20_000});
 await expect(recovery.getByRole("button",{name:"Replace cloud with local copy",exact:true})).toBeVisible();
 await recovery.getByRole("button",{name:"Replace cloud with local copy",exact:true}).click();
 await expect.poll(()=>puts.length,{timeout:20_000}).toBe(1);
 expect(puts[0].expectedRevision).toBe(cloudRevision);
 expect(puts[0].drawings.map((drawing)=>drawing.id)).toEqual(["cloud-hline","pre-tab-a"]);
 expect(puts[0].drawings.find((drawing)=>drawing.id==="cloud-hline")?.points[0].p).toBe(196);
 expect(puts[0].drawings.find((drawing)=>drawing.id==="pre-tab-a")?.points[0].p).toBe(50);
 await expect(recovery).toHaveCount(0,{timeout:20_000});
});

// A3 (T1): mixed v2+legacy losing tab. Owner B has its own UUID v2 copy for a
// symbol plus an imported v1 (`legacy:`) alternative; another owner on the same
// browser holds the legacy claim. B's first locked journal write must drop the
// legacy alternative on disk, B's !attempt branch must re-derive the issue
// from the post-write entry so the chrome clears, B's own-v2 PUTs exactly once.
// The GET is held so the cloud-side park cannot race the post-write check.
test("A3: held-GET locks-patched claim drops the legacy alternative, clears the issue, PUTs own-v2 once", async ({ page }) => {
 let releaseGet:()=>void=()=>{};
 const getHeld=new Promise<void>((resolve)=>{releaseGet=resolve;});
 await page.addInitScript(() => {
  if (sessionStorage.getItem("drawing-recovery-seeded")) return;
  sessionStorage.setItem("drawing-recovery-seeded", "1");
  // v1: the email-aliased v1 outbox holds the legacy drawing keyed under
  // "legacy" inside readCopies (drawingOutbox.ts ~:180-192), so the import
  // id becomes "legacy:legacy" — a valid id in the in-memory imports dict
  // that sorts after "4444…" so own-v2 wins as the active copy and
  // legacy-v1 lands as the alternative.
  localStorage.setItem("mm.drawing.account-outbox.v1", JSON.stringify({
   "account:responsive@example.com": {
    NVDA: [{ id: "legacy-v1", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 200 }], meta: { label: "保持" } }],
   },
  }));
  // v2: own v2 only, no legacySeen so the import is not suppressed.
  localStorage.setItem("mm.drawing.account-outbox.v2", JSON.stringify({
   "account:e2e-user-default": {
    NVDA: {
     format: 2,
     copies: { "44444444-4444-4444-8444-444444444444": { drawings: [{ id: "own-v2", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 100 }], meta: { label: "保持" } }], revision: null } },
     legacySeen: {},
     legacyLinks: {},
    },
   },
  }));
  // Patch navigator.locks.request so the FIRST locked journal write sets
  // another owner's claim BEFORE delegating — places the claim after the
  // lock-free hydration read and before writeDrawingJournal drops the
  // unowned legacy alternative.
  const proto = Object.getPrototypeOf(navigator.locks) as { request: (name: string, ...rest: unknown[]) => Promise<unknown> };
  const originalRequest = proto.request;
  let firstWriteSeen = false;
  proto.request = function(name: string, ...rest: unknown[]) {
   if (!firstWriteSeen && name === "mm.drawing.account-outbox.v2") {
    firstWriteSeen = true;
    localStorage.setItem("mm.drawing.legacy-claim.v1", JSON.stringify({ "account:responsive@example.com": "account:uuid-a" }));
   }
   return originalRequest.call(this, name, ...rest);
  };
 });
 const puts: { operationId:string; expectedRevision:string|null; drawings:{id:string}[] }[] = [];
 await page.route("**/api/drawings**", async (route) => {
  if (route.request().method() === "GET") { await getHeld; await route.fulfill(json({ drawings: [], revision: null, schemaVersion: 1 })); return; }
  const value = route.request().postDataJSON();
  puts.push(value);
  await route.fulfill(json({ ok: true, operationId: value.operationId, revision: committed, idempotentReplay: false, superseded: false }));
 });
 await open(page);
 // The re-flush my fix arms must PUT own-v2 exactly once.
 await expect.poll(() => puts.length, { timeout: 20_000 }).toBe(1);
 expect(puts[0].expectedRevision).toBeNull();
 expect(puts[0].drawings.map((drawing) => drawing.id)).toEqual(["own-v2"]);
 for (const put of puts) {
  expect(put.drawings.map((drawing) => drawing.id)).not.toContain("legacy-v1");
 }
 // The recovery chrome is gone — the post-write check cleared "multiple".
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0, { timeout: 20_000 });
 // The claim set by the locks patch is intact.
 const claim = await page.evaluate(() => localStorage.getItem("mm.drawing.legacy-claim.v1"));
 expect(claim).not.toBeNull();
 expect(JSON.parse(claim!)).toEqual({ "account:responsive@example.com": "account:uuid-a" });
 // v1 bytes are unchanged.
 const v1Bytes = await page.evaluate(() => localStorage.getItem("mm.drawing.account-outbox.v1"));
 expect(v1Bytes).not.toBeNull();
 expect(JSON.parse(v1Bytes!)).toEqual({
  "account:responsive@example.com": {
   NVDA: [{ id: "legacy-v1", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 200 }], meta: { label: "保持" } }],
  },
 });
 releaseGet();
});

// A3 (T1c) CONTROL: same seed, locks patch DISABLED, so the legacy alternative
// is NOT dropped. The "Other local copy 1" button must render — proves the seed
// really created the alternative (the original A3 e2e seed keyed
// "legacy:responsive@example.com" was filtered out by readCopies, so the
// chrome never offered an alternative button).
test("A3 control: without the locks-patched claim the legacy alternative survives and the chrome offers another local copy", async ({ page }) => {
 await page.addInitScript(() => {
  if (sessionStorage.getItem("drawing-recovery-seeded")) return;
  sessionStorage.setItem("drawing-recovery-seeded", "1");
  localStorage.setItem("mm.drawing.account-outbox.v1", JSON.stringify({
   "account:responsive@example.com": {
    NVDA: [{ id: "legacy-v1", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 200 }], meta: { label: "保持" } }],
   },
  }));
  localStorage.setItem("mm.drawing.account-outbox.v2", JSON.stringify({
   "account:e2e-user-default": {
    NVDA: {
     format: 2,
     copies: { "44444444-4444-4444-8444-444444444444": { drawings: [{ id: "own-v2", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 100 }], meta: { label: "保持" } }], revision: null } },
     legacySeen: {},
     legacyLinks: {},
    },
   },
  }));
  // Deliberately no locks patch — the legacy alternative survives the write.
 });
 const puts: unknown[] = [];
 await page.route("**/api/drawings**", async (route) => {
  if (route.request().method() === "GET") { await route.fulfill(json({ drawings: [], revision: null, schemaVersion: 1 })); return; }
  puts.push(route.request().postDataJSON());
  await route.fulfill(json({ ok: true, operationId: route.request().postDataJSON().operationId, revision: committed, idempotentReplay: false, superseded: false }));
 });
 await open(page);
 // The chrome must show a "Review another local copy" button — proving the
 // seed really created the alternative. The original A3 e2e seed could never
 // produce this button because readCopies (drawingOutbox.ts ~:187) filtered
 // out the invalid "legacy:responsive@example.com" key entirely.
 await expect(page.getByTestId("drawing-save-recovery")).toBeVisible({ timeout: 20_000 });
 // Wait for the cloud copy to load so the chrome shows the full keep-mine
 // UI (with the alternative + "Use cloud copy" + "Replace cloud with
 // local copy"). Before the cloud copy loads, only "Review cloud copy" is
 // shown.
 await expect(page.getByRole("button", { name: "Use cloud copy", exact: true })).toBeVisible({ timeout: 20_000 });
 await expect(page.getByRole("button", { name: /Review another local copy/ })).toBeVisible({ timeout: 20_000 });
 // No PUT was sent — alternatives still in the journal, no flush reached PUT.
 expect(puts).toHaveLength(0);
});

// T2 (F2 keep-local): two local copies in the journal, the user picks one via
// "Replace cloud with local copy", and the PUT must carry the chosen copy's id.
// The final2 A3 widened refreshDrawingJournalSymbol to re-read on every write,
// restoring every on-disk copy and making the sorted-first copy win regardless
// of the user's choice — so the user's copy was never PUT.
test("F2 keep-local with two local copies PUTs the copy the user chose", async ({ page }) => {
 const ownA = "11111111-1111-4111-8111-111111111111";
 const ownB = "22222222-2222-4222-8222-222222222222";
 const cloudRevision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const puts: { expectedRevision:string|null; drawings:{id:string}[] }[] = [];
 await page.addInitScript(({ ownA, ownB }) => {
  if (sessionStorage.getItem("drawing-recovery-seeded")) return;
  sessionStorage.setItem("drawing-recovery-seeded", "1");
  localStorage.setItem("mm.drawing.account-outbox.v2", JSON.stringify({
   "account:e2e-user-default": {
    NVDA: {
     format: 2,
     copies: {
      [ownA]: { drawings: [{ id: "local-a", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 100 }], meta: { label: "保持" } }], revision: null },
      [ownB]: { drawings: [{ id: "local-b", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 200 }], meta: { label: "保持" } }], revision: null },
     },
     legacySeen: {},
     legacyLinks: {},
    },
   },
  }));
 }, { ownA, ownB });
 await page.route("**/api/drawings**", async (route) => {
  if (route.request().method() === "GET") { await route.fulfill(json({ drawings: [], revision: cloudRevision, schemaVersion: 1 })); return; }
  const value = route.request().postDataJSON();
  puts.push(value);
  await route.fulfill(json({ ok: true, operationId: value.operationId, revision: committed, idempotentReplay: false, superseded: false }));
 });
 await open(page);
 const recovery = page.getByTestId("drawing-save-recovery");
 await expect(recovery).toBeVisible({ timeout: 20_000 });
 // Pick local-b explicitly by clicking its alternative button (which is the
 // only alternative; the sorted-first "11111111-…" copy is local-a and is
 // the initial active).
 await expect(recovery.getByRole("button", { name: /Review another local copy/ })).toBeVisible({ timeout: 20_000 });
 await recovery.getByRole("button", { name: /Review another local copy/ }).click({ timeout: 20_000 });
 // Now click "Replace cloud with local copy" — the chosen copy must be PUT.
 await recovery.getByRole("button", { name: "Replace cloud with local copy", exact: true }).click({ timeout: 20_000 });
 await expect.poll(() => puts.length, { timeout: 20_000 }).toBe(1);
 expect(puts[0].drawings.map((drawing) => drawing.id)).toEqual(["local-b"]);
 expect(puts[0].expectedRevision).toBe(cloudRevision);
 // One local copy remains; clicking "Use cloud copy" clears the chrome.
 await recovery.getByRole("button", { name: "Use cloud copy", exact: true }).click({ timeout: 20_000 });
 await expect(recovery).toHaveCount(0, { timeout: 20_000 });
});

// T3 (F3 retry): a PUT that fails with a 5xx must surface "Retry save" and the
// banner must STAY visible across a new stroke — the previous A3 widening
// cleared the retry code after every save, including the in-flight retry.
test("F3 retry: a 5xx PUT keeps 'Retry save' visible across the next stroke and clears only on success", async ({ page }) => {
 const okOp = "33333333-3333-4333-8333-333333333333";
 const cloudRevision = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
 const puts: { operationId:string; expectedRevision:string|null; drawings:{id:string}[] }[] = [];
 let putCalls = 0;
 await page.route("**/api/drawings**", async (route) => {
  if (route.request().method() === "GET") { await route.fulfill(json({ drawings: [], revision: cloudRevision, schemaVersion: 1 })); return; }
  const value = route.request().postDataJSON();
  putCalls++;
  // PUTs 1 and 2 (the retry path before / after the new stroke) 500; PUT 3 succeeds.
  if (putCalls <= 2) { await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }); return; }
  puts.push(value);
  await route.fulfill(json({ ok: true, operationId: value.operationId, revision: okOp, idempotentReplay: false, superseded: false }));
 });
 // Seed a v2 with revision: cloudRevision so the attempt is created and the
 // first PUT reaches it; a 500 triggers the retry issue.
 await page.addInitScript(({ cloudRevision }) => {
  if (sessionStorage.getItem("drawing-recovery-seeded")) return;
  sessionStorage.setItem("drawing-recovery-seeded", "1");
  localStorage.setItem("mm.drawing.account-outbox.v2", JSON.stringify({
   "account:e2e-user-default": {
    NVDA: {
     format: 2,
     copies: { "44444444-4444-4444-8444-444444444444": { drawings: [{ id: "stroke-1", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 100 }], meta: { label: "保持" } }], revision: cloudRevision } },
     legacySeen: {},
     legacyLinks: {},
    },
   },
  }));
 }, { cloudRevision });
 await open(page);
 // First PUT 500s — the chrome must show "Retry save".
 await expect(page.getByTestId("drawing-save-recovery")).toContainText("Retry save", { timeout: 20_000 });
 // Trigger another flush by editing the existing copy in localStorage and
 // reloading. The new entry still has the same cloudRevision so the attempt
 // is created and the 500 issue remains "retry" (not "legacy" or "conflict").
 await page.evaluate(() => {
  const raw = localStorage.getItem("mm.drawing.account-outbox.v2");
  if (!raw) throw new Error("missing v2");
  const env = JSON.parse(raw) as Record<string, Record<string, { copies: Record<string, { drawings: { id:string }[]; revision: string }> }>>;
  env["account:e2e-user-default"].NVDA.copies["44444444-4444-4444-8444-444444444444"].drawings.push({ id: "stroke-2", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 200 }], meta: { label: "保持" } });
  localStorage.setItem("mm.drawing.account-outbox.v2", JSON.stringify(env));
 });
 await page.reload();
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 // The retry banner must STILL be present — the retry code must not be cleared
 // by the post-write code (the previous A3 widening wiped it after every save).
 await expect(page.getByTestId("drawing-save-recovery")).toContainText("Retry save", { timeout: 20_000 });
 // Click Retry save to trigger another PUT (which still 500s, count=2).
 await page.getByRole("button", { name: "Retry save", exact: true }).click({ timeout: 20_000 });
 // The third PUT (after the user retries again) succeeds; wait for the puts array.
 await expect.poll(() => puts.length, { timeout: 20_000 }).toBeGreaterThan(0);
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0, { timeout: 20_000 });
});// fix4 too_many end-to-end proof. Cloud GET returns 500 drawings for a symbol
// and the user has 1 disjoint pre-GET drawing. The recovery toast must show
// the tooMany sentence and EXACTLY ONE button ("Use cloud copy" — the cloud
// copy is set in the same React batch as the issue). No "Keep local" /
// "Replace cloud" button. No PUT. Clicking "Use cloud copy" renders the 500
// saved drawings, removes the local addition, clears the toast, and clears
// the journal row. A reload afterwards does not re-park or re-toast.
//
// Determinism: no held GET — the local preload row is set BEFORE the GET
// returns (the persistDrawingRecovery in the preload branch finishes before
// the GET response), so the decision is computed against the local preload
// row and lands on "park" / "too_many" with the cloud copy applied in the
// same batch. Reload re-creates the same state: the local preload row is
// gone (resolveDrawingRecovery cleared the symbol's row), so the reload
// has nothing to park against and the chrome stays hidden.
test("too_many parks with exactly one button, never offers replace or a PUT, and the journal row clears on use-cloud", async ({ page }) => {
 const cloudRevision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const localDrawing = { id: "local-extra", kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 999 }], meta: { label: "保持" } };
 const cloudDrawings = Array.from({ length: 500 }, (_, i) => ({ id: `cloud-${i}`, kind: "hline", source: "user", schemaVersion: 1, points: [{ t: "2026-01-01", p: 100 + i }], meta: { label: "保持" } }));
 // Seed: 1 pre-GET disjoint drawing for the symbol.
 await seed(page, { drawings: [localDrawing], preload: true });
 const puts: unknown[] = [];
 await page.route("**/api/drawings**", async (route) => {
  const request = route.request();
  if (request.method() === "GET") {
   await route.fulfill(json({ drawings: cloudDrawings, revision: cloudRevision, schemaVersion: 1 }));
   return;
  }
  puts.push(request.postDataJSON());
  await route.fulfill(json({ ok: true, operationId: request.postDataJSON().operationId, revision: cloudRevision, idempotentReplay: false, superseded: false }));
 });
 await open(page);
 const recovery = page.getByTestId("drawing-save-recovery");
 // (1) The recovery toast shows the tooMany sentence and EXACTLY ONE button.
 await expect(recovery).toBeVisible({ timeout: 20_000 });
 await expect(recovery).toContainText("500 saved drawings");
 await expect(recovery).toContainText("new drawings were not saved");
 await expect(recovery).toContainText("stay on this device");
 // No "Keep local" / "Replace cloud" button anywhere.
 await expect(recovery.getByRole("button", { name: "Keep local", exact: true })).toHaveCount(0);
 await expect(recovery.getByRole("button", { name: "Replace cloud with local copy", exact: true })).toHaveCount(0);
 // Only "Use cloud copy" — the cloud copy lands in the same React batch as the issue.
 await expect(recovery.getByRole("button", { name: "Use cloud copy", exact: true })).toBeVisible();
 await expect(recovery.getByRole("button", { name: "Review cloud copy", exact: true })).toHaveCount(0);
 // (2) NO PUT is sent for that symbol at any point.
 expect(puts).toHaveLength(0);
 // (3) Clicking "Use cloud copy" renders the 500 saved drawings, removes the
 // local addition, clears the toast, and clears that symbol's journal row.
 await recovery.getByRole("button", { name: "Use cloud copy", exact: true }).click();
 await expect(recovery).toHaveCount(0, { timeout: 20_000 });
 expect(puts).toHaveLength(0);
 // The local addition is gone: the journal row for NVDA is cleared.
 await expect.poll(async () => {
  const raw = await page.evaluate(() => localStorage.getItem("mm.drawing.account-outbox.v2"));
  if (!raw) return "empty";
  const env = JSON.parse(raw) as Record<string, Record<string, unknown>>;
  const nvda = env["account:e2e-user-default"]?.NVDA;
  return nvda ? "present" : "absent";
 }, { timeout: 20_000 }).toBe("empty");
 // (4) A reload afterwards does not re-park or re-toast. The journal row is
 // gone, so the reload reads no preload entry, the GET is the only source,
 // and there is nothing to park against.
 await page.reload();
 await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
 await expect(page.getByTestId("drawing-save-recovery")).toHaveCount(0, { timeout: 20_000 });
 expect(puts).toHaveLength(0);
});
import { expect, test, type Page } from "@playwright/test";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import golden from "../lib/__tests__/fixtures/aapl-event-workspace.json";
import {canonicalInvestigationJson} from "../lib/investigationContracts";
import {normalizeEventWorkspace} from "../lib/eventWorkspace";

test.setTimeout(120_000);
const id="10000000-0000-4000-8000-000000000001";
const reference={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:golden.event_id,mode:"pinned",version_ref:golden.generation_id,fingerprint:"a".repeat(64)};
const fixtureBaseline={ok:true,workspace:normalizeEventWorkspace(golden),reference,receipt:{schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",company_id:golden.issuer.company_id,event_id:golden.event_id,generation_id:golden.generation_id,fingerprint:reference.fingerprint,public_known_at:golden.lifecycle.source_available_at,platform_known_at:golden.lifecycle.observed_at,generation_emitted_at:golden.generated_at,rights:{allowed:true,policy_version:"test.transport_only",checked_at:"2026-10-04T00:00:00Z"}}};
const question="  What explains the change?\n";
const content={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Apple research",question,subjects:[{kind:"security",owner:"terminal.analysis_symbol",object_id:"AAPL"},{kind:"issuer",owner:"data_os.security_master",object_id:golden.issuer.company_id}]},layout_refs:[],thesis_refs:[],evidence_refs:[reference],continuation:{},review_baseline_ref:reference};
const committed=(target=id,manifest:unknown=content,operationId="20000000-0000-4000-8000-000000000001",revision=1)=>({status:"committed",id:target,revision,lifecycle:"active",manifest,committed_at:"2026-10-04T00:00:00Z",investigation_id:target,revision_id:`30000000-0000-4000-8000-${String(revision).padStart(12,"0")}`,sequence:revision,parent_revision_id:revision===1?null:`30000000-0000-4000-8000-${String(revision-1).padStart(12,"0")}`,operation_id:operationId,author_ref:"40000000-0000-4000-8000-000000000001",recorded_at:"2026-10-04T00:00:00Z",manifest_digest:createHash("sha256").update(canonicalInvestigationJson(manifest)).digest("hex")});
async function setup(page:Page) {
 await page.addInitScript(()=>{if(!localStorage.getItem("mm.lang"))localStorage.setItem("mm.lang","en");});
 await page.route("**/api/layouts",route=>route.fulfill({json:{layouts:[],teams:[],teamRead:{ok:true}}}));
 await page.route("**/api/investigations/baseline?*",route=>route.fulfill({json:fixtureBaseline}));
}

test("late mount inventory cannot hide a saved question",async({page},testInfo)=>{
 await setup(page);let saved:ReturnType<typeof committed>|null=null,reads=0;
 let finishInitial:(()=>Promise<void>)|undefined;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){const command=request.postDataJSON();saved=committed(command.id,command.manifest,command.operation_id);await route.fulfill({json:saved});return;}
  if(query.has("id")){await route.fulfill({json:{...saved,status:"found",current_revision:1,layouts:[]}});return;}
  if(++reads===1){finishInitial=()=>route.fulfill({json:{status:"listed",items:[]}});return;}
  await route.fulfill({json:{status:"listed",items:saved?[{id:saved.id,revision:1,lifecycle:"active",title:"Inventory race research",question,updated_at:saved.committed_at}]:[]}});
 });
 await page.goto("/analysis?view=investigations&symbol=AAPL");
 await expect.poll(()=>!!finishInitial).toBe(true);
 await page.getByRole("button",{name:"Start new research"}).click();
 await page.getByLabel("Title",{exact:true}).fill("Inventory race research");
 await page.getByLabel("Research question",{exact:true}).fill(question);
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 const library=page.getByRole("complementary",{name:"Saved questions"});
 await expect(library.getByRole("button",{name:/Inventory race research/})).toBeVisible();
 const oldResponse=page.waitForResponse(response=>response.url().endsWith("/api/investigations")&&response.request().method()==="GET");
 await finishInitial!();await oldResponse;
 // A later user-visible action gives React time to process the delayed response.
 await page.getByRole("button",{name:"Removed",exact:true}).click();
 await page.getByRole("button",{name:"Active",exact:true}).click();
 await expect(library.getByRole("button",{name:/Inventory race research/})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath("inventory-after-late-response.png"),fullPage:true});
});

test("exact save/readback/reopen and responsive retained evidence are read-only on reopen",async({page},testInfo)=>{
 await setup(page);const writes:unknown[]=[];let saved:ReturnType<typeof committed>|null=null;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){const command=request.postDataJSON();writes.push(command);saved=committed(command.id,command.manifest,command.operation_id);await route.fulfill({json:saved});return;}
  if(query.has("id")){await route.fulfill({json:{...saved,status:"found",current_revision:1,layouts:[]}});return;}
  await route.fulfill({json:{status:"listed",items:saved?[{id:saved.id,revision:1,lifecycle:"active",title:"Apple research",question,updated_at:saved.committed_at}]:[]}});
 });
 await page.goto("/analysis?view=investigations&symbol=AAPL");
 await page.getByRole("button",{name:"Start new research"}).click();
 await page.getByLabel("Title",{exact:true}).fill(content.intent.title);
 await page.getByLabel("Research question",{exact:true}).fill(question);
 await page.getByRole("button",{name:"Choose current Earnings evidence"}).click();
 await expect(page.getByRole("heading",{name:golden.issuer.display_name})).toBeVisible();
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Apple research",exact:true})).toBeVisible();
 expect(writes).toHaveLength(1);expect((writes[0] as {manifest:typeof content}).manifest.intent.question).toBe(question);
 await page.reload();
 await expect(page.getByRole("heading",{name:"Apple research",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Evidence clocks"})).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.screenshot({path:testInfo.outputPath("saved-research-retained.png"),fullPage:true});
 await expect(page.getByText("Not licensed",{exact:true})).toBeVisible();
 await page.evaluate(()=>{localStorage.setItem("mm.lang","zh");});
 await page.reload();
 await expect(page.getByRole("heading",{name:"已保存研究",exact:true})).toBeVisible();
 await expect(page.getByText("未获授权",{exact:true})).toBeVisible();
 await expect(page.getByText("市场共识",{exact:true})).toBeVisible();
 expect(writes).toHaveLength(1);
 await page.screenshot({path:testInfo.outputPath("saved-research-retained-zh.png"),fullPage:true});
});

// Every mocked answer below is one the real route can return: reconcile never answers not_found,
// and the read-only receipt GET answers not_found only when no receipt exists.
test("lost response and receipt miss preserve one operation across reload",async({page})=>{
 await setup(page);let fence=false,reconciliations=0;const commands:Array<{id:string;operation_id:string;manifest:unknown}>=[],receiptReads:string[]=[],receiptKeys:string[][]=[];
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){
   const command=request.postDataJSON();commands.push(command);
   if(commands.length===1){await route.abort("failed");return;}
   await route.fulfill({json:committed(command.id,command.manifest,command.operation_id)});return;
  }
  if(request.method()==="PUT"){reconciliations++;const command=request.postDataJSON();expect(command).toEqual(commands[0]);await route.fulfill(fence?{json:{status:"not_applied",id:command.id,operation_id:command.operation_id}}:{status:503,json:{status:"unavailable"}});return;}
  if(query.has("operation_id")){receiptKeys.push([...query.keys()]);receiptReads.push(query.get("operation_id")!);await route.fulfill({status:404,json:{status:"not_found"}});return;}
  if(query.has("id")){await route.fulfill({json:{...committed(commands[0].id,commands[0].manifest),status:"found",current_revision:1,layouts:[]}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto("/analysis?view=investigations");
 await page.getByRole("button",{name:"Start new research"}).click();
 await page.getByLabel("Title",{exact:true}).fill("Uncertain question");
 await page.getByLabel("Research question",{exact:true}).fill("My exact draft 🧠");
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByText("The save outcome is not confirmed.",{exact:false})).toBeVisible();
 await page.getByRole("button",{name:"Check original outcome"}).click();
 await expect.poll(()=>reconciliations,{timeout:20_000}).toBe(1);
 expect(receiptReads).toEqual([]);
 await page.reload();
 // Reopening reads the original receipt once, read-only, and its miss keeps the save unconfirmed.
 await expect.poll(()=>receiptReads,{timeout:20_000}).toEqual([commands[0].operation_id]);
 // The real route answers 400 to any other query key.
 expect(receiptKeys).toEqual([["operation_id"]]);
 await expect(page.getByText("The save outcome is not confirmed.",{exact:false})).toBeVisible({timeout:20_000});
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue("My exact draft 🧠");
 await expect(page.getByRole("button",{name:"Start new research"})).toBeDisabled();
 expect(commands).toHaveLength(1);expect(reconciliations).toBe(1);
 await expect(page.getByRole("button",{name:"Retry original save"})).toHaveCount(0);
 fence=true;await page.getByRole("button",{name:"Check original outcome"}).click();
 await expect(page.getByText("Save failure confirmed. No records were created.",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Try save again"}).click();
 await expect(page.getByRole("heading",{name:"Uncertain question",exact:true})).toBeVisible();
 expect(commands).toHaveLength(2);expect(commands[1].operation_id).not.toBe(commands[0].operation_id);expect({...commands[1],operation_id:commands[0].operation_id}).toEqual(commands[0]);
 expect(receiptReads).toEqual([commands[0].operation_id]);
});

test("a reload recovers a committed original from its receipt without sending it again",async({page})=>{
 await setup(page);const commands:Array<{id:string;operation_id:string;manifest:unknown}>=[],receiptReads:string[]=[],receiptKeys:string[][]=[];let reconciliations=0;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){commands.push(request.postDataJSON());await route.abort("failed");return;}
  if(request.method()==="PUT"){reconciliations++;await route.fulfill({status:503,json:{status:"unavailable"}});return;}
  // The original committed, but its response was lost in transport.
  if(query.has("operation_id")){receiptKeys.push([...query.keys()]);receiptReads.push(query.get("operation_id")!);const original=commands[0];await route.fulfill({json:committed(original.id,original.manifest,original.operation_id)});return;}
  if(query.has("id")){await route.fulfill({json:{...committed(commands[0].id,commands[0].manifest,commands[0].operation_id),status:"found",current_revision:1,layouts:[]}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto("/analysis?view=investigations");
 await page.getByRole("button",{name:"Start new research"}).click();
 await page.getByLabel("Title",{exact:true}).fill("Committed in transit");
 await page.getByLabel("Research question",{exact:true}).fill("Was my save kept?");
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByText("The save outcome is not confirmed.",{exact:false})).toBeVisible();
 expect(receiptReads).toEqual([]);
 await page.reload();
 await expect(page.getByRole("heading",{name:"Committed in transit",exact:true})).toBeVisible({timeout:20_000});
 await expect(page).toHaveURL(new RegExp(`investigation=${commands[0].id}&revision=1$`),{timeout:20_000});
 await expect(page.getByText("The save outcome is not confirmed.",{exact:false})).toHaveCount(0);
 expect(receiptReads).toEqual([commands[0].operation_id]);expect(receiptKeys).toEqual([["operation_id"]]);
 expect(commands).toHaveLength(1);expect(reconciliations).toBe(0);
});

test("at the saved-research limit the original is never sent again and the draft is kept",async({page})=>{
 await setup(page);const commands:Array<{id:string;operation_id:string;manifest:unknown}>=[],receiptReads:string[]=[],receiptKeys:string[][]=[];let reconciliations=0;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){
   commands.push(request.postDataJSON());
   if(commands.length===1){await route.abort("failed");return;}
   await route.fulfill({status:429,json:{status:"limit_reached"}});return;
  }
  // At the receipt cap the owner stores nothing and answers the original as finally not applied.
  if(request.method()==="PUT"){reconciliations++;const command=request.postDataJSON();expect(command).toEqual(commands[0]);await route.fulfill({json:{status:"not_applied",id:command.id,operation_id:command.operation_id,reason:"limit_reached"}});return;}
  if(query.has("operation_id")){receiptKeys.push([...query.keys()]);receiptReads.push(query.get("operation_id")!);await route.fulfill({status:404,json:{status:"not_found"}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 const limit="Save not completed: this account has reached its saved-research limit. No records were created. Your draft is retained.";
 await page.goto("/analysis?view=investigations");
 await page.getByRole("button",{name:"Start new research"}).click();
 await page.getByLabel("Title",{exact:true}).fill("Limit question");
 await page.getByLabel("Research question",{exact:true}).fill("Keep this draft at the limit");
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByText("The save outcome is not confirmed.",{exact:false})).toBeVisible();
 await page.getByRole("button",{name:"Check original outcome"}).click();
 await expect(page.getByText(limit,{exact:true})).toBeVisible({timeout:20_000});
 await expect(page.getByText("The save outcome is not confirmed.",{exact:false})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Try save again"})).toHaveCount(0);
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue("Keep this draft at the limit");
 expect(commands).toHaveLength(1);expect(reconciliations).toBe(1);
 await page.reload();
 await expect(page.getByText(limit,{exact:true})).toBeVisible({timeout:20_000});
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue("Keep this draft at the limit");
 expect(receiptReads).toEqual([]);expect(receiptKeys).toEqual([]);expect(commands).toHaveLength(1);
 // A new save is a new operation, and the limit refuses it too.
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 await expect.poll(()=>commands.length,{timeout:20_000}).toBe(2);
 expect(commands[1].operation_id).not.toBe(commands[0].operation_id);
 await expect(page.getByText(limit,{exact:true})).toBeVisible({timeout:20_000});
 expect(commands.filter(c=>c.operation_id===commands[0].operation_id)).toHaveLength(1);
 expect(reconciliations).toBe(1);
});

for(const lang of ["en","zh"] as const) test(`evidence review advances only through an explicit saved revision (${lang}, Terminal dark theme)`,async({page},testInfo)=>{
 await setup(page);
 await page.addInitScript(lang=>{localStorage.setItem("mm.lang",lang);},lang);
 const copy=lang==="en"?{title:"Review evidence changes",review:"Review current evidence",missing:"Not observed in the current read",removed:"Confirmed removal",advance:"Use this reviewed version in an edit",question:"Research question",save:"Save research",previous:"Previous revision",selected:"Selected generation"}:{title:"复核证据变化",review:"复核当前证据",missing:"当前读取未观察到",removed:"来源确认已删除",advance:"在编辑中使用此已复核版本",question:"研究问题",save:"保存研究",previous:"上一修订",selected:"已选择的版本"};
 const newer={...fixtureBaseline,workspace:normalizeEventWorkspace({...golden,generation_id:"b".repeat(24)}),reference:{...reference,version_ref:"b".repeat(24),fingerprint:"b".repeat(64)},receipt:{...fixtureBaseline.receipt,generation_id:"b".repeat(24),fingerprint:"b".repeat(64)}};
 const commands:Array<{expected_revision:number;action:string;manifest:typeof content}>=[];
 let reviewReads=0,head=1,second:typeof content|null=null;
 await page.route("**/api/investigations/baseline?*",route=>{
  const query=new URL(route.request().url()).searchParams;
  return route.fulfill({json:query.get("generation_id")===newer.receipt.generation_id?newer:fixtureBaseline});
 });
 await page.route("**/api/investigations/review?*",route=>{
  reviewReads++;
  return route.fulfill({json:{status:"reviewed",id,revision:1,baseline:fixtureBaseline.receipt,current:newer.receipt,coverage:"observed_owner_rows_only",removalProofAvailable:false,review:{schema:"investigation.evidence_review.v1",priorGeneration:golden.generation_id,currentGeneration:newer.receipt.generation_id,summary:"incomplete",items:[{id:"source:transcript:call",membership:"not_observed",version:"unknown",qualification:"unknown",availability:"unavailable",excluded:false,correction:false,interpretation:{comparable:false,reason:"unavailable"}}]}}});
 });
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){
   const command=request.postDataJSON();commands.push(command);head=2;second=command.manifest;
   await route.fulfill({json:{...committed(id,second,command.operation_id,2)}});return;
  }
  if(query.has("id")){const revision=Number(query.get("revision")||head);await route.fulfill({json:{...committed(id,revision===1?content:second,undefined,revision),status:"found",revision,current_revision:head,layouts:[]}});return;}
  await route.fulfill({json:{status:"listed",items:[{id,revision:head,lifecycle:"active",title:content.intent.title,question,updated_at:fixtureBaseline.receipt.rights.checked_at}]}});
 });
 await page.goto(`/analysis?view=investigations&investigation=${id}&revision=1`);
 // The actual Terminal host is deliberately dark-only (app/layout.tsx).
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await expect(page.getByRole("heading",{name:copy.title})).toBeVisible();
 expect(reviewReads).toBe(0);expect(commands).toHaveLength(0);
 await page.getByRole("button",{name:copy.review}).click();
 await expect(page.getByText(copy.missing,{exact:true})).toBeVisible();
 await expect(page.getByText(copy.removed,{exact:true})).toHaveCount(0);
 expect(commands).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.getByRole("button",{name:copy.advance}).scrollIntoViewIfNeeded();
 await page.screenshot({path:testInfo.outputPath("evidence-review-incomplete.png"),fullPage:true});
 await page.getByRole("button",{name:copy.advance}).click();
 await expect(page.getByLabel(copy.question,{exact:true})).toHaveValue(question);
 expect(commands).toHaveLength(0);
 await page.getByRole("button",{name:copy.save,exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`investigation=${id}&revision=2$`));
 expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({action:"revise",expected_revision:1,manifest:{review_baseline_ref:newer.reference}});expect(commands[0].manifest.evidence_refs).toEqual([reference,newer.reference]);
 await page.reload();await expect(page.getByRole("heading",{name:content.intent.title,exact:true})).toBeVisible();
 expect(commands).toHaveLength(1);expect(reviewReads).toBe(1);
 await page.getByRole("button",{name:copy.previous}).click();
 await expect(page).toHaveURL(new RegExp(`investigation=${id}&revision=1$`));
 await page.getByText(copy.selected,{exact:true}).click();
 await expect(page.getByText(fixtureBaseline.receipt.fingerprint,{exact:true})).toBeVisible();
 expect(commands).toHaveLength(1);expect(reviewReads).toBe(1);
 if(testInfo.project.name==="mobile"&&lang==="en"){
  await page.setViewportSize({width:320,height:844});
  await page.getByRole("button",{name:copy.review}).click();
  await expect(page.getByText(copy.missing,{exact:true})).toBeVisible();
  await page.evaluate(()=>{const root=document.querySelector("main");if(!root)return;const sizes=[...root.querySelectorAll<HTMLElement>("*")].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)] as const);for(const [el,size] of sizes)el.style.fontSize=`${size*2}px`;});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.getByRole("button",{name:copy.review}).focus();await expect(page.getByRole("button",{name:copy.review})).toBeFocused();
  await page.screenshot({path:testInfo.outputPath("evidence-review-320-double-text.png"),fullPage:true});
  expect(commands).toHaveLength(1);
 }
});

test("a rejected revision keeps its draft across reload and cannot become a new record",async({page})=>{
 await setup(page);const commands:Array<{action:string;expected_revision:number}>=[];
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){commands.push(request.postDataJSON());await route.fulfill({status:409,json:{status:"version_conflict",current_revision:2}});return;}
  if(query.has("id")){await route.fulfill({json:{...committed(),status:"found",current_revision:2,layouts:[]}});return;}
  if(query.has("operation_id")){await route.fulfill({status:404,json:{status:"not_found"}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto(`/analysis?view=investigations&investigation=${id}&revision=1`);
 await page.getByRole("button",{name:"Edit saved question"}).click();
 await page.getByLabel("Research question",{exact:true}).fill("My conflicting draft 🧠");
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByText("The save was not committed.",{exact:false})).toBeVisible();
 await page.reload();
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue("My conflicting draft 🧠");
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({action:"revise",expected_revision:1});
 await expect(page.getByRole("button",{name:"Open latest revision"})).toBeVisible();
});

test("an edited legacy calendar as-of date is saved only after a deliberate exact time",async({page},testInfo)=>{
 await setup(page);const commands:Array<{action:string;expected_revision:number;manifest:{argument_relations?:unknown;intent:{research_as_of?:string;question:string}}}>=[];
 // A record saved before exact instants: no argument_relations, and a calendar date as its as-of.
 const legacy={schema:content.schema,intent:{...content.intent,research_as_of:"2026-10-04"},layout_refs:[],thesis_refs:[],evidence_refs:[reference],continuation:{},review_baseline_ref:reference};
 let head=1,second:unknown=null;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){const command=request.postDataJSON();commands.push(command);head=2;second=command.manifest;await route.fulfill({json:committed(id,command.manifest,command.operation_id,2)});return;}
  if(query.has("id")){const revision=Number(query.get("revision")||head);await route.fulfill({json:revision===1?{status:"found",id,revision:1,current_revision:head,lifecycle:"active",manifest:legacy,committed_at:"2026-10-04T00:00:00Z",layouts:[]}:{...committed(id,second,undefined,2),status:"found",current_revision:head,layouts:[]}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto(`/analysis?view=investigations&investigation=${id}&revision=1`);
 await page.getByRole("button",{name:"Edit saved question"}).click();
 const fix=page.getByRole("group",{name:"The retained as-of date 2026-10-04 has no time of day"});
 await expect(fix).toBeVisible();
 await expect(fix.getByLabel("Date (UTC, YYYY-MM-DD)",{exact:true})).toHaveValue("");
 await expect(fix.getByLabel("Time (UTC, 24-hour HH:MM or HH:MM:SS)",{exact:true})).toHaveValue("");
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByText("Not saved: the as-of date 2026-10-04 has no time of day",{exact:false})).toBeVisible();
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue(question);
 expect(commands).toHaveLength(0);
 await fix.getByLabel("Date (UTC, YYYY-MM-DD)",{exact:true}).fill("2026-10-04");
 await fix.getByLabel("Time (UTC, 24-hour HH:MM or HH:MM:SS)",{exact:true}).fill("16:30:15");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.screenshot({path:testInfo.outputPath("legacy-as-of-exact-time.png"),fullPage:true});
 // Keyboard activation: the chosen instant is applied to the draft only; nothing is sent.
 await fix.getByRole("button",{name:"Use this exact time",exact:true}).focus();await page.keyboard.press("Enter");
 await expect(page.getByText("As-of time set to 2026-10-04T16:30:15.000Z. Choose Save research to save it.",{exact:true})).toBeVisible();
 await expect(fix).toHaveCount(0);
 expect(commands).toHaveLength(0);
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`investigation=${id}&revision=2$`));
 expect(commands).toHaveLength(1);
 expect(commands[0]).toMatchObject({action:"revise",expected_revision:1,manifest:{argument_relations:[],intent:{research_as_of:"2026-10-04T16:30:15.000Z",question}}});
});

test("a committed save preserves its exact revision URL when readback fails",async({page})=>{
 await setup(page);let writes=0;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){writes++;const command=request.postDataJSON();await route.fulfill({json:committed(command.id,command.manifest,command.operation_id)});return;}
  if(query.has("id")){await route.fulfill({status:503,json:{status:"unavailable"}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto("/analysis?view=investigations");
 await page.getByRole("button",{name:"Start new research"}).click();
 await page.getByLabel("Title",{exact:true}).fill("Saved despite read outage");
 await page.getByLabel("Research question",{exact:true}).fill("Keep the committed identity");
 await page.getByRole("button",{name:"Save research",exact:true}).click();
 await expect(page.getByText("Saved, but exact readback is unavailable.",{exact:false})).toBeVisible();
 await expect(page).toHaveURL(/investigation=[0-9a-f-]+&revision=1$/);
 await page.reload();await expect(page.getByText("This saved research link is unavailable.")).toBeVisible();expect(writes).toBe(1);
});

test("320px at doubled text keeps the question editor usable without horizontal overflow",async({page},testInfo)=>{
 await setup(page);await page.setViewportSize({width:320,height:844});
 await page.route("**/api/investigations",route=>route.fulfill({json:{status:"listed",items:[]}}));
 await page.goto("/analysis?view=investigations");
 await page.getByRole("button",{name:"Start new research"}).click();
 await page.evaluate(()=>{
  const root=document.querySelector('main');if(!root)return;
  const sizes=[...root.querySelectorAll<HTMLElement>('*')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)] as const);
  for(const [el,size] of sizes)el.style.fontSize=`${size*2}px`;
 });
 await page.getByLabel("Title",{exact:true}).fill("Readable research");
 await page.getByLabel("Research question",{exact:true}).fill("Can I keep researching with enlarged text?");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.getByRole("button",{name:"Save research",exact:true}).focus();
 await expect(page.getByRole("button",{name:"Save research",exact:true})).toBeFocused();
 await page.screenshot({path:testInfo.outputPath("320-double-text-editor.png"),fullPage:true});
});


// These source-bound captures repair the existing Analysis visual locks. They are
// emitted through the existing CI browser artifact, never fabricated by updating a hash.
test("Analysis research entries retain their responsive bilingual source evidence",async({browser},testInfo)=>{
 const project=testInfo.project.name;
 test.skip(!["desktop","tablet","mobile"].includes(project));
 const viewport=project==="desktop"?{width:1440,height:900}:project==="tablet"?{width:820,height:1180}:{width:390,height:844};
 const repo=path.resolve(process.cwd(),"..");
 const files=["terminal/components/workspaces/AnalysisWorkspace.tsx","terminal/app/company-intelligence.css","terminal/lib/i18n.tsx"];
 const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash("sha256").update(readFileSync(path.join(repo,file))).digest("hex")]));
 const before=hashes();const captures:Array<{file:string;url:string;state:string}>=[];
 for(const lang of ["en","zh"]){
  const context=await browser.newContext({viewport,hasTouch:project!=="desktop",locale:lang==="zh"?"zh-CN":"en-US",colorScheme:"dark"});
  try {
   await context.addInitScript(l=>{localStorage.setItem("mm.lang",l);localStorage.setItem("theme","dark");localStorage.setItem("theme_auto","0");},lang);
   const page=await context.newPage();
   const url=`/analysis?symbol=NVDA&lang=${lang}`;
   await page.goto(`${testInfo.project.use.baseURL}${url}`);
   await expect(page.getByRole("link",{name:lang==="zh"?"已保存研究":"Saved research",exact:true})).toBeVisible();
   await expect(page.getByLabel(lang==="zh"?"你的研究论点：NVDA":"Your theses on NVDA")).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
   const file=`analysis-entry-${project}-${lang}.png`;
   await page.screenshot({path:testInfo.outputPath(file)});captures.push({file,url,state:"context-bar-with-theses-control-and-saved-research"});
   if(project!=="tablet"){
    const spyUrl=`/analysis?symbol=SPY&lang=${lang}`;await page.goto(`${testInfo.project.use.baseURL}${spyUrl}`);
    const bar=page.locator(".analysis-context-bar");await expect(bar).toBeVisible();
    const crop=`AnalysisWorkspace-${viewport.width}${lang==="zh"?"-zh":""}.png`;
    // The server-rendered context bar can be replaced during hydration after
    // toBeVisible. Reacquire the actual box before capture, within a finite wait.
    await expect(async()=>{
     const rect=await bar.boundingBox();expect(rect).not.toBeNull();
     const x=Math.max(0,rect!.x-12),y=Math.max(0,rect!.y-12);
     await page.screenshot({path:testInfo.outputPath(crop),clip:{x,y,width:Math.min(viewport.width-x,rect!.width+24),height:rect!.height+24}});
    }).toPass({timeout:5000});
    captures.push({file:crop,url:spyUrl,state:"analysis-context-bar"});
   }
  }finally{await context.close();}
 }
 expect(hashes()).toEqual(before);
 writeFileSync(testInfo.outputPath("analysis-source-captures.json"),JSON.stringify({capturedAtHead:execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim(),capturedAt:new Date().toISOString(),layoutFiles:before,viewport,project,captures},null,2));
});

// T03i (IW2 items 1-2): a definitive layout_conflict or reference_unavailable refusal is final for that exact
// reference set. Every send writes the pending request to sessionStorage before its fetch, so an unchanged
// sessionStorage value after Save is direct proof that nothing was sent.
const pendingKey="mm.investigation.pending.v2:local-preview";
const stored=(page:Page)=>page.evaluate(k=>sessionStorage.getItem(k),pendingKey);
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
type Sent={id:string;operation_id:string;action:string;layout_capture?:{layout_id:string;expected_revision:number};manifest:{thesis_refs:unknown[];intent:{question:string}}};
const LAYOUT_CONFLICT_COPY="Not saved: the layout chosen in this draft no longer matches that layout as saved, so sending it unchanged would be refused again. Save that layout again in the Terminal and choose its new revision here, or choose another layout or No layout selected, then choose Save research. Your draft is unchanged.";
const REFERENCE_UNAVAILABLE_COPY="Not saved: a layout or Thesis version named in this draft is no longer available to your account, so sending it unchanged would be refused again. Choose another layout or No layout selected, or under Retained Theses use Remove reference or retain another version, then choose Save research. Your draft is unchanged.";

test("a refused layout revision is never sent again unchanged, across reload, until the current revision is chosen",async({page},testInfo)=>{
 await setup(page);
 const layoutId="50000000-0000-4000-8000-000000000001";let layoutRevision=3;
 // Registered after setup(), so this list answers before the empty default.
 await page.route("**/api/layouts",route=>route.fulfill({json:{layouts:[{id:layoutId,name:"Earnings layout",mine:true,config:{schema:"workspace_layout.v1",revision:layoutRevision}}],teams:[],teamRead:{ok:true}}}));
 const commands:Sent[]=[];let saved:unknown=null;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){const command=request.postDataJSON();commands.push(command);
   // The layout was saved again elsewhere, so the captured revision 3 is no longer current.
   if(commands.length===1){layoutRevision=4;await route.fulfill({status:409,json:{status:"layout_conflict"}});return;}
   // The owner stores the captured revision as the one primary layout reference.
   saved={...command.manifest,layout_refs:[{layout_id:command.layout_capture!.layout_id,layout_revision_id:"50000000-0000-4000-8000-000000000004",digest:"c".repeat(64),role:"primary"}]};
   await route.fulfill({json:committed(command.id,saved,command.operation_id)});return;}
  if(query.has("id")){const last=commands.at(-1)!;await route.fulfill({json:{...committed(last.id,saved,last.operation_id),status:"found",current_revision:1,layouts:[]}});return;}
  if(query.has("operation_id")){await route.fulfill({status:404,json:{status:"not_found"}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto("/analysis?view=investigations");
 await page.getByRole("button",{name:"Start new research"}).click({timeout:20_000});
 await page.getByLabel("Title",{exact:true}).fill("Layout conflict research",{timeout:20_000});
 await page.getByLabel("Research question",{exact:true}).fill("Keep this layout draft",{timeout:20_000});
 const layoutSelect=page.locator("label",{hasText:"Retain a named layout (optional)"}).locator("select");
 await layoutSelect.selectOption({label:"Earnings layout · Revision 3"},{timeout:20_000});
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 await expect(page.getByText(LAYOUT_CONFLICT_COPY,{exact:true})).toBeVisible({timeout:20_000});
 expect(commands).toHaveLength(1);expect(commands[0].layout_capture).toEqual({layout_id:layoutId,expected_revision:3});
 // The refused revision stays the selected choice; the refreshed list (read again after the refusal) offers the current one beside it.
 await expect(layoutSelect).toHaveValue("retained",{timeout:20_000});
 await expect(layoutSelect.locator("option",{hasText:"Earnings layout · Revision 4"})).toHaveCount(1,{timeout:20_000});
 const refused=await stored(page);
 expect(JSON.parse(refused!)).toMatchObject({phase:"rejected",reason:"layout_conflict",command:{operation_id:commands[0].operation_id}});
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 expect(await stored(page)).toBe(refused);
 await expect(page.getByText(LAYOUT_CONFLICT_COPY,{exact:true})).toBeVisible({timeout:20_000});
 await expect(page.getByText("Reopen the latest revision",{exact:false})).toHaveCount(0,{timeout:20_000});
 await page.reload();
 await expect(page.getByText(LAYOUT_CONFLICT_COPY,{exact:true})).toBeVisible({timeout:20_000});
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue("Keep this layout draft",{timeout:20_000});
 await expect(layoutSelect).toHaveValue("retained",{timeout:20_000});
 await expect(layoutSelect.locator("option:checked")).toHaveText("Earnings layout · Revision 3",{timeout:20_000});
 await expect(page.getByRole("button",{name:"Try save again"})).toHaveCount(0,{timeout:20_000});
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 expect(await stored(page)).toBe(refused);
 expect(commands).toHaveLength(1);
 expect(await noOverflow(page)).toBe(true);
 // The shell scrolls inside its own region, so capture the guidance and the retained choice in view.
 await page.getByText(LAYOUT_CONFLICT_COPY,{exact:true}).scrollIntoViewIfNeeded({timeout:20_000});
 await page.screenshot({path:testInfo.outputPath("recovered-layout-conflict-message.png")});
 await page.getByRole("button",{name:"Save research",exact:true}).scrollIntoViewIfNeeded({timeout:20_000});
 await page.screenshot({path:testInfo.outputPath("recovered-layout-conflict.png"),fullPage:true});
 // The deliberate choice: the layout's current revision, sent once under a new operation.
 await layoutSelect.selectOption({label:"Earnings layout · Revision 4"},{timeout:20_000});
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 await expect(page.getByRole("heading",{name:"Layout conflict research",exact:true})).toBeVisible({timeout:20_000});
 expect(commands).toHaveLength(2);
 expect(commands[1].layout_capture).toEqual({layout_id:layoutId,expected_revision:4});
 expect(commands[1].operation_id).not.toBe(commands[0].operation_id);
});

test("a refused Thesis version set is never sent again unchanged, across reload, until a reference is removed",async({page},testInfo)=>{
 await setup(page);
 const primary={thesis_id:"60000000-0000-4000-8000-000000000001",version_id:"60000000-0000-4000-8000-000000000002",role:"primary"};
 const context={thesis_id:"60000000-0000-4000-8000-000000000003",version_id:"60000000-0000-4000-8000-000000000004",role:"context"};
 const retained={id:"10000000-0000-4000-8000-000000000071",operation_id:"20000000-0000-4000-8000-000000000071",action:"create",expected_revision:0,
  manifest:{schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Thesis reference research",question:"Keep this Thesis draft",subjects:[{kind:"security",owner:"terminal.analysis_symbol",object_id:"AAPL"}]},layout_refs:[],thesis_refs:[primary,context],evidence_refs:[],continuation:{}}};
 // A previous page left this create without a confirmed outcome. Seed once, so a reload keeps what the page stored.
 await page.addInitScript(([k,v])=>{if(!sessionStorage.getItem(k))sessionStorage.setItem(k,v);},[pendingKey,JSON.stringify({owner:"local-preview",command:retained})] as const);
 const commands:Sent[]=[];
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){const command=request.postDataJSON();commands.push(command);
   if(commands.length===1){await route.fulfill({status:422,json:{status:"reference_unavailable"}});return;}
   await route.fulfill({json:committed(command.id,command.manifest,command.operation_id)});return;}
  if(query.has("operation_id")){await route.fulfill({json:{status:"not_applied",id:retained.id,operation_id:retained.operation_id}});return;}
  if(query.has("id")){const last=commands.at(-1)!;await route.fulfill({json:{...committed(last.id,last.manifest,last.operation_id),status:"found",current_revision:1,layouts:[]}});return;}
  await route.fulfill({json:{status:"listed",items:[]}});
 });
 await page.goto("/analysis?view=investigations");
 await expect(page.getByText("Save failure confirmed. No records were created.",{exact:true})).toBeVisible({timeout:20_000});
 await page.getByRole("button",{name:"Try save again"}).click({timeout:20_000});
 await expect(page.getByText(REFERENCE_UNAVAILABLE_COPY,{exact:true})).toBeVisible({timeout:20_000});
 expect(commands).toHaveLength(1);
 expect(commands[0]).toMatchObject({id:retained.id,manifest:{thesis_refs:[primary,context]}});
 await expect(page.getByRole("button",{name:"Try save again"})).toHaveCount(0,{timeout:20_000});
 const refused=await stored(page);
 expect(JSON.parse(refused!)).toMatchObject({phase:"rejected",reason:"reference_unavailable",command:{operation_id:commands[0].operation_id}});
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 expect(await stored(page)).toBe(refused);
 await page.reload();
 await expect(page.getByText(REFERENCE_UNAVAILABLE_COPY,{exact:true})).toBeVisible({timeout:20_000});
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue("Keep this Thesis draft",{timeout:20_000});
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 expect(await stored(page)).toBe(refused);
 expect(commands).toHaveLength(1);
 expect(await noOverflow(page)).toBe(true);
 // The shell scrolls inside its own region, so capture the guidance and the retained choice in view.
 await page.getByText(REFERENCE_UNAVAILABLE_COPY,{exact:true}).scrollIntoViewIfNeeded({timeout:20_000});
 await page.screenshot({path:testInfo.outputPath("recovered-reference-unavailable-message.png")});
 await page.getByRole("button",{name:"Save research",exact:true}).scrollIntoViewIfNeeded({timeout:20_000});
 await page.screenshot({path:testInfo.outputPath("recovered-reference-unavailable.png"),fullPage:true});
 // The deliberate correction: remove the context Thesis version, then save once.
 await page.getByRole("listitem").filter({hasText:"Context ·"}).getByRole("button",{name:"Remove reference"}).click({timeout:20_000});
 await page.getByRole("button",{name:"Save research",exact:true}).click({timeout:20_000});
 await expect(page.getByRole("heading",{name:"Thesis reference research",exact:true})).toBeVisible({timeout:20_000});
 expect(commands).toHaveLength(2);
 expect(commands[1].manifest.thesis_refs).toEqual([primary]);
 expect(commands[1].operation_id).not.toBe(commands[0].operation_id);
});

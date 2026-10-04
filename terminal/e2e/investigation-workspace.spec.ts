import { expect, test, type Page } from "@playwright/test";
import golden from "../lib/__tests__/fixtures/aapl-event-workspace.json";

test.setTimeout(120_000);
const id="10000000-0000-4000-8000-000000000001";
const reference={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:golden.event_id,mode:"pinned",version_ref:golden.generation_id,fingerprint:"a".repeat(64)};
const fixtureBaseline={ok:true,workspace:golden,reference,receipt:{schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",company_id:golden.issuer.company_id,event_id:golden.event_id,generation_id:golden.generation_id,fingerprint:reference.fingerprint,public_known_at:golden.lifecycle.source_available_at,platform_known_at:golden.lifecycle.observed_at,generation_emitted_at:golden.generated_at,rights:{allowed:true,policy_version:"test.transport_only",checked_at:"2026-10-04T00:00:00Z"}}};
const question="  What explains the change?\n";
const content={schema:"investigation_manifest.v2",intent:{title:"Apple research",question,subjects:[{kind:"security",owner:"terminal.analysis_symbol",object_id:"AAPL"},{kind:"issuer",owner:"data_os.security_master",object_id:golden.issuer.company_id}]},layout_refs:[],thesis_refs:[],evidence_refs:[reference],continuation:{},review_baseline_ref:reference};
const committed=(target=id,manifest:unknown=content)=>({status:"committed",id:target,revision:1,lifecycle:"active",manifest,committed_at:"2026-10-04T00:00:00Z"});
async function setup(page:Page) {
 await page.addInitScript(()=>{localStorage.setItem("mm.lang","en");});
 await page.route("**/api/layouts",route=>route.fulfill({json:{layouts:[],teams:[],teamRead:{ok:true}}}));
 await page.route("**/api/investigations/baseline?*",route=>route.fulfill({json:fixtureBaseline}));
}

test("exact save/readback/reopen and responsive retained evidence are read-only on reopen",async({page},testInfo)=>{
 await setup(page);const writes:unknown[]=[];let saved:ReturnType<typeof committed>|null=null;
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){const command=request.postDataJSON();writes.push(command);saved=committed(command.id,command.manifest);await route.fulfill({json:saved});return;}
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
});

test("lost response and receipt miss preserve one operation across reload",async({page})=>{
 await setup(page);const commands:Array<{id:string;operation_id:string;manifest:unknown}>=[];
 await page.route("**/api/investigations{,?*}",async route=>{
  const request=route.request(),query=new URL(request.url()).searchParams;
  if(request.method()==="POST"){
   const command=request.postDataJSON();commands.push(command);
   if(commands.length===1){await route.abort("failed");return;}
   await route.fulfill({json:committed(command.id,command.manifest)});return;
  }
  if(query.has("operation_id")){await route.fulfill({status:404,json:{status:"not_found"}});return;}
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
 await page.reload();
 await expect(page.getByLabel("Research question",{exact:true})).toHaveValue("My exact draft 🧠");
 await expect(page.getByRole("button",{name:"Start new research"})).toBeDisabled();
 expect(commands).toHaveLength(1);
 await page.getByRole("button",{name:"Retry original save"}).click();
 await expect(page.getByRole("heading",{name:"Uncertain question",exact:true})).toBeVisible();
 expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);
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

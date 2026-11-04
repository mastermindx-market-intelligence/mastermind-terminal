// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import InvestigationWorkspace,{type InvestigationOptionPlanEntry,type InvestigationOptionPlanRevisionReader} from "@/components/workspaces/InvestigationWorkspace";
import type {AuthLifecycleSnapshot} from "../supabase/authLifecycle";
import type {InvestigationCommand} from "../investigations";
import type {IntlEntrySelectors} from "@/lib/investigationIntlEntry";
import intlPacket from "./fixtures/intl_macro_risk_actual_20261104/IntlResolvedPacket.json";
import type {IntlResolvedPacket} from "@/lib/intlInvestigationCaller";
import {INVESTIGATION_INTL_RECEIVER_COPY} from "@/components/research/InvestigationIntlEvidence";
import type {InvestigationIntlRead,InvestigationIntlSelection} from "@/components/research/InvestigationIntlEvidence";
import fixture from "./fixtures/options_plan_draft_v1.json";
import {OptionsPlanResearchBridge} from "@/components/options/OptionsPlanResearchBridge";
import {validateOptionsPlanDraft,type OptionsPlanDraft} from "@/lib/optionsPlanDraft";
const planFixture=():OptionsPlanDraft=>{const parsed=validateOptionsPlanDraft(fixture);if(!parsed.ok)throw Error("Invalid existing Plan fixture");return parsed.value;};
vi.mock("@/components/mounts/InvestigationWorkspaceMount",()=>({default:(props:React.ComponentProps<typeof InvestigationWorkspace>)=><InvestigationWorkspace {...props}/>}));
vi.mock("@/components/options/OptionsPlanPayoffPanel",()=>({OptionsPlanPayoffPanel:({draft,onClose}:{draft:OptionsPlanDraft;onClose:()=>void})=><div data-testid="bridge-payoff-inputs"><output>{JSON.stringify(draft)}</output><button onClick={onClose}>Close saved Plan inputs</button></div>}));

vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/lib/useInvestigationTheme",()=>({useInvestigationTheme:()=>"dark"}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
const auth=vi.hoisted(()=>({snapshot:null as AuthLifecycleSnapshot|null,publish:null as ((snapshot:AuthLifecycleSnapshot)=>void)|null}));
vi.mock("@/lib/supabase/investigationAuthOwner",()=>({subscribeInvestigationAuthOwner:(publish:(snapshot:AuthLifecycleSnapshot)=>void)=>{auth.publish=publish;return {
 getSnapshot:()=>auth.snapshot,unsubscribe:vi.fn(),
};}}));
const owner="40000000-0000-4000-8000-000000000001",stamp="2026-10-24T08:00:00.000Z";
let root:Root,host:HTMLDivElement,entry:InvestigationOptionPlanEntry|null,reader:InvestigationOptionPlanRevisionReader|null;
let posts:InvestigationCommand[],requests:Array<{url:string;method:string}>,saved:InvestigationCommand|null;
let currentRevision:number;
const originalScrollIntoView=Object.getOwnPropertyDescriptor(Element.prototype,"scrollIntoView");
const ready=():AuthLifecycleSnapshot=>({availability:"ready",principal_partition:owner,auth_epoch:"epoch-1"});
const onEntry=(value:InvestigationOptionPlanEntry|null)=>{entry=value;};
const onReader=(value:InvestigationOptionPlanRevisionReader|null)=>{reader=value;};
const response=(body:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status}));
const button=(label:string)=>[...host.querySelectorAll("button")].find(node=>node.textContent===label)!;
async function click(label:string){expect(button(label),label).toBeDefined();await act(async()=>{button(label).click();});}
async function fill(label:string,value:string){
 const el=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;expect(el,label).not.toBeNull();
 await act(async()=>{const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});
}
async function mount(id?:string,revision?:number,key="first",historyMode:"route"|"embedded"="route",readIntlEvidence?:(selection:InvestigationIntlSelection)=>ReturnType<InvestigationIntlRead>,initialIntlEntry?:IntlEntrySelectors,intlReturnTo?:string){
 await act(async()=>{root.render(<InvestigationWorkspace key={key} ownerKey={owner} initialSymbol="AAPL" initialInvestigationId={id} initialRevision={revision}
  historyMode={historyMode} readIntlEvidence={readIntlEvidence} initialIntlEntry={initialIntlEntry} intlReturnTo={intlReturnTo} onOptionPlanAdmissionReady={onEntry} onOptionPlanRevisionReady={onReader}/>);});
}
beforeEach(()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(Element.prototype,"scrollIntoView",{configurable:true,writable:true,value:vi.fn()});
 auth.snapshot=ready();auth.publish=null;entry=null;reader=null;posts=[];requests=[];saved=null;currentRevision=2;sessionStorage.clear();
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method??"GET";requests.push({url,method});
  if(method==="POST"&&url==="/api/investigations"){
   const c=JSON.parse(String(init?.body)) as InvestigationCommand;posts.push(c);saved=c;
   return response({status:"committed",id:c.id,operation_id:c.operation_id,revision:1,lifecycle:"active",manifest:c.manifest,committed_at:stamp,
    investigation_id:c.id,revision_id:"30000000-0000-4000-8000-000000000001",sequence:1,parent_revision_id:null,author_ref:owner,recorded_at:stamp,manifest_digest:"a".repeat(64)});
  }
  if(url==="/api/investigations")return response({status:"listed",items:[]});
  if(url==="/api/layouts")return response({layouts:[]});
  if(url==="/api/alerts")return response({alerts:[]});
  if(url==="/api/alerts/receipts")return response({outbox:[]});
  if(url.startsWith("/api/investigations?")){
   const q=new URL(url,"https://terminal.test").searchParams;
   if(saved&&q.get("id")===saved.id&&q.get("revision")==="1")return response({status:"found",id:saved.id,revision:1,current_revision:currentRevision,
    lifecycle:"active",manifest:saved.manifest,committed_at:stamp,layouts:[]});
   return response({status:"not_found"},404);
  }
  throw Error(`Unexpected fixture transport: ${method} ${url}`);
 }));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();
 if(originalScrollIntoView)Object.defineProperty(Element.prototype,"scrollIntoView",originalScrollIntoView);else Reflect.deleteProperty(Element.prototype,"scrollIntoView");
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=false;});

describe("native whole Plan entry through the existing explicit Investigation command",()=>{
 it("admits a detached whole Plan with zero effects, then saves once and reopens exact revision1 despite current2",async()=>{
  await mount();expect(entry).toBeNull();await click("Start new research");expect(typeof entry).toBe("function");
  const allocate=vi.spyOn(crypto,"randomUUID");const candidate=structuredClone(fixture),before=structuredClone(candidate);
  let admitted:ReturnType<InvestigationOptionPlanEntry>|undefined;
  await act(async()=>{admitted=entry!(candidate);});
  expect(admitted?.ok).toBe(true);expect(allocate).not.toHaveBeenCalled();allocate.mockRestore();
  candidate.research.thesis="later editor edit must not replace admitted capture";
  expect(posts).toEqual([]);expect(sessionStorage.getItem(`mm.investigation.pending.v2:${owner}`)).toBeNull();
  await fill("Title","Authored research");await fill("Research question","An explicit unchanged question");
  await click("Save research");
  expect(posts).toHaveLength(1);const command=posts[0];
  expect(command.action).toBe("create");expect(command.expected_revision).toBe(0);
  expect(command.manifest.schema).toBe("investigation_manifest.v3");expect(command.manifest.option_plan).toEqual(before);
  expect(command.manifest.intent).toMatchObject({title:"Authored research",question:"An explicit unchanged question",subjects:[{owner:"terminal.analysis_symbol",kind:"security",object_id:"AAPL"}]});
  const readsBeforeProjection=requests.length;
  expect(reader?.()).toEqual({id:command.id,revision:1,plan:before});expect(requests).toHaveLength(readsBeforeProjection);
  expect(window.location.pathname).toBe("/analysis");expect(new URLSearchParams(window.location.search).get("revision")).toBe("1");
  const oldRead=reader!;auth.snapshot={...ready(),auth_epoch:"epoch-2"};expect(oldRead()).toBeNull();auth.snapshot=ready();
  await mount(command.id,1,"reopened");
  expect(oldRead()).toBeNull();expect(reader?.()).toEqual({id:command.id,revision:1,plan:before});
  const departingRead=reader!;
  await act(async()=>{button("Start new research").click();expect(departingRead()).toBeNull();});
  expect(requests.filter(r=>r.method!=="GET")).toEqual([{url:"/api/investigations",method:"POST"}]);
  expect(requests.filter(r=>r.url.includes(`id=${command.id}`)).every(r=>new URL(r.url,"https://terminal.test").searchParams.get("revision")==="1")).toBe(true);
 });
 it("refuses stale entry callbacks and refuses an admitted Plan's Save on a synchronous account/epoch change",async()=>{
  await mount();await click("Start new research");const oldEntry=entry!;expect(typeof oldEntry).toBe("function");
  auth.snapshot={...ready(),principal_partition:"another-account",auth_epoch:"epoch-B"};
  expect(oldEntry(fixture).ok).toBe(false);expect(posts).toHaveLength(0);
  auth.snapshot=ready();await act(async()=>{expect(oldEntry(fixture).ok).toBe(true);});
  await fill("Title","Retained title");await fill("Research question","No changed owner may save it");
  auth.snapshot={...ready(),auth_epoch:"epoch-2"};await click("Save research");
  expect(posts).toHaveLength(0);expect(sessionStorage.getItem(`mm.investigation.pending.v2:${owner}`)).toBeNull();
  expect(host.textContent).toContain("Your account changed");
 });
 it("invalidates a cancelled entry and registers a fresh callback for New research even while already editing",async()=>{
  await mount();await click("Start new research");const first=entry!;expect(typeof first).toBe("function");
  await click("Start new research");expect(entry).not.toBe(first);expect(first(fixture)).toEqual({ok:false,reason:"inactive"});
  const next=entry!;await act(async()=>{expect(next(fixture).ok).toBe(true);});
  await click("Cancel editing");expect(next(fixture)).toEqual({ok:false,reason:"inactive"});
  expect(posts).toEqual([]);expect(requests.every(r=>r.method==="GET")).toBe(true);
 });
 it("rechecks the synchronous owner after unknown-input validation before installing a draft",async()=>{
  await mount();await click("Start new research");const admit=entry!;
  const candidate=new Proxy(structuredClone(fixture),{ownKeys(target){auth.snapshot={...ready(),auth_epoch:"changed-during-validation"};return Reflect.ownKeys(target);}});
  expect(admit(candidate)).toEqual({ok:false,reason:"auth"});
  expect(posts).toEqual([]);expect(sessionStorage.getItem(`mm.investigation.pending.v2:${owner}`)).toBeNull();
 });
 it("keeps an embedded host URL through native New, explicit Save and exact revision reopen",async()=>{
  window.history.replaceState({},"","/options?lane=plans#selection-A");const original=window.location.href;
  await mount(undefined,undefined,"embedded","embedded");await click("Start new research");
  await act(async()=>{expect(entry!(fixture).ok).toBe(true);});
  await fill("Title","Embedded Plan");await fill("Research question","Retain the original host");await click("Save research");
  expect(posts).toHaveLength(1);expect(window.location.href).toBe(original);
  expect(reader?.()).toEqual({id:posts[0].id,revision:1,plan:fixture});
  await mount(posts[0].id,1,"embedded-reopen","embedded");
  expect(window.location.href).toBe(original);expect(reader?.()).toEqual({id:posts[0].id,revision:1,plan:fixture});
 });
 it("rebinds a saved-revision reader for ordinary same-record Edit without writing a revision",async()=>{
  currentRevision=1;await mount();await click("Start new research");
  await act(async()=>{expect(entry!(fixture).ok).toBe(true);});
  await fill("Title","Editable saved Plan");await fill("Research question","Keep the acknowledged Plan");await click("Save research");
  const beforeEdit=reader!;expect(beforeEdit()).toEqual({id:posts[0].id,revision:1,plan:fixture});
  await act(async()=>{button("Edit saved question").click();expect(beforeEdit()).toBeNull();});
  expect(reader?.()).toEqual({id:posts[0].id,revision:1,plan:fixture});
  await click("Cancel editing");expect(reader?.()).toEqual({id:posts[0].id,revision:1,plan:fixture});expect(posts).toHaveLength(1);
 });
 it("a POST 401 ends Plan admission but retains the exact uncertain operation without retry or replacement",async()=>{
  await mount();await click("Start new research");const originalEntry=entry!;
  await act(async()=>{expect(originalEntry(fixture).ok).toBe(true);});
  await fill("Title","A local pending Plan");await fill("Research question","Retain the original operation after a 401");
  const original=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input,init)=>{
   if(String(input)==="/api/investigations"&&init?.method==="POST"){
    posts.push(JSON.parse(String(init.body)) as InvestigationCommand);
    return Promise.resolve(new Response("body must not be parsed",{status:401}));
   }
   return original(input,init);
  });
  await click("Save research");
  expect(posts).toHaveLength(1);const bufferOwner=`account:${owner}`,bufferKey=`mm.investigation.pending.v2:${encodeURIComponent(bufferOwner)}`;
  const retained=sessionStorage.getItem(bufferKey)!;
  expect(sessionStorage.getItem(`mm.investigation.pending.v2:${owner}`)).toBeNull();
  expect(JSON.parse(retained)).toEqual({owner:bufferOwner,command:posts[0]});
  expect(posts[0].manifest.option_plan).toEqual(fixture);
  expect(host.textContent).toContain("Sign in again to open saved research.");
  expect(host.querySelector('input[aria-label="Title"]')).toBeNull();expect(entry).toBeNull();expect(reader).toBeNull();
  expect(originalEntry(fixture).ok).toBe(false);await act(async()=>{});
  expect(posts).toHaveLength(1);expect(sessionStorage.getItem(bufferKey)).toBe(retained);
 });

});


describe("Options host composed with the real native Save and acknowledged reader",()=>{
 async function compose(candidate:OptionsPlanDraft|null=structuredClone(planFixture()),scopeKey=JSON.stringify([owner,1]),selectionKey="selection-A",id?:string){
  await act(async()=>{root.render(<OptionsPlanResearchBridge workspaceProps={{ownerKey:owner,initialSymbol:"AAPL",initialInvestigationId:id,initialRevision:id?1:undefined}}
   candidate={candidate} isScopeCurrent={()=>auth.snapshot?.availability==="ready"&&auth.snapshot.principal_partition===owner&&auth.snapshot.auth_epoch==="epoch-1"} scopeKey={scopeKey} selectionKey={selectionKey} lang="en"/>);});
 }
 it("requires explicit New and transfer, saves a detached whole Plan once, then reopens exact1 despite head2 without recalculation",async()=>{
  const candidate=structuredClone(planFixture()),original=structuredClone(candidate);
  window.history.replaceState({},"","/options?tab=screener#selection-A");const url=window.location.href;
  await compose(candidate);expect(posts).toEqual([]);expect(requests).toEqual([]);
  await click("Open saved research");expect(button("Add Plan inputs to new research").disabled).toBe(true);
  await click("Start new research");expect(posts).toEqual([]);
  await click("Add Plan inputs to new research");expect(posts).toEqual([]);
  candidate.research.thesis="later editor change must not replace admitted snapshot";
  await fill("Title","Whole Plan from Options");await fill("Research question","Keep the exact acknowledged input");
  await click("Save research");expect(posts).toHaveLength(1);const savedId=posts[0].id;
  expect(posts[0].manifest.option_plan).toEqual(original);
  await click("Open saved Plan inputs");expect(host.querySelector('[data-testid="saved-plan-inputs"]')?.getAttribute("data-investigation-revision")).toBe("1");
  expect(JSON.parse(host.querySelector('[data-testid="bridge-payoff-inputs"] output')!.textContent!)).toEqual(original);
  expect(window.location.href).toBe(url);expect(requests.filter(r=>r.method!=="GET")).toEqual([{url:"/api/investigations",method:"POST"}]);
  await act(async()=>root.unmount());root=createRoot(host);
  await compose(null,JSON.stringify([owner,1]),"selection-A",savedId);await click("Open saved research");await click("Open saved Plan inputs");
  expect(JSON.parse(host.querySelector('[data-testid="bridge-payoff-inputs"] output')!.textContent!)).toEqual(original);
  expect(posts).toHaveLength(1);expect(window.location.href).toBe(url);
 });
 it("null inputs disable transfer; stale transfer and a previously admitted Plan Save are refused",async()=>{
  await compose();await click("Open saved research");await click("Start new research");
  await compose(null);expect(button("Add Plan inputs to new research").disabled).toBe(true);expect(posts).toEqual([]);
  await compose();auth.snapshot={...ready(),auth_epoch:"epoch-changed"};await click("Add Plan inputs to new research");
  expect(posts).toEqual([]);expect(host.textContent).toContain("This research session is unavailable");
  // A newly edited plain native draft may intentionally save without a Plan.
  // Prove the Plan-specific Save fence with inputs admitted in the original epoch.
  auth.snapshot=ready();await compose();await click("Add Plan inputs to new research");
  await fill("Title","Refused stale Plan");await fill("Research question","Must not save inputs through an old epoch");
  auth.snapshot={...ready(),auth_epoch:"epoch-after-admission"};await click("Save research");
  expect(posts).toEqual([]);expect(sessionStorage.getItem(`mm.investigation.pending.v2:${owner}`)).toBeNull();
 });
 it("scope and exact-selection replacement destroy the old host; A-B-A cannot revive its draft",async()=>{
  await compose();await click("Open saved research");await click("Start new research");await click("Add Plan inputs to new research");
  await fill("Title","Retired draft");await compose(structuredClone(planFixture()),JSON.stringify([owner,1]),"selection-B");
  expect(host.querySelector('[aria-label="Title"]')).toBeNull();expect(posts).toEqual([]);
  await compose(structuredClone(planFixture()),JSON.stringify([owner,2]),"selection-A");
  await click("Open saved research");expect(host.querySelector('[aria-label="Title"]')).toBeNull();expect(button("Add Plan inputs to new research").disabled).toBe(true);
 });
 it("clears transferred feedback for native New and requires another explicit Add",async()=>{
  await compose();await click("Open saved research");await click("Start new research");await click("Add Plan inputs to new research");
  expect(host.textContent).toContain("Plan inputs copied into this research draft");
  await click("Start new research");expect(host.textContent).not.toContain("Plan inputs copied into this research draft");
  await fill("Title","Replacement native draft");await fill("Research question","No automatic Plan transfer");await click("Save research");
  expect(posts).toHaveLength(1);expect(posts[0].manifest).not.toHaveProperty("option_plan");
 });
 it("rejects a Lab Matrix coordinate-shaped payload and a withdrawn account without allocating a Save",async()=>{
  const matrix={schema:"matrix_coordinate",strike:760,expiry:"2026-10-30",net_millions:1.2} as unknown as OptionsPlanDraft;
  await compose(matrix);await click("Open saved research");await click("Start new research");await click("Add Plan inputs to new research");
  expect(posts).toEqual([]);expect(sessionStorage.getItem(`mm.investigation.pending.v2:${owner}`)).toBeNull();
  await compose();auth.snapshot={availability:"unavailable",principal_partition:null,auth_epoch:"withdrawn"};await click("Add Plan inputs to new research");
  expect(posts).toEqual([]);expect(sessionStorage.getItem(`mm.investigation.pending.v2:${owner}`)).toBeNull();
 });

});

// These source-only receiver tests reuse the native authenticated fixture owner;
// they issue no Save and establish no actual International source admission.
describe("native International selected-detail receiver fence",()=>{
 function selectedRecord(){
  saved={id:"50000000-0000-4000-8000-000000000001",operation_id:"50000000-0000-4000-8000-000000000002",expected_revision:0,action:"create",
   manifest:{schema:"investigation_manifest.v3",argument_relations:[],option_plan:planFixture(),
    intent:{title:"Existing exact revision",question:"Original saved question",subjects:[{owner:"terminal.analysis_symbol",kind:"security",object_id:"AAPL"}]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{}}};
  return saved.id;
 }
 it("does not read without selected detail, then reads the exact acknowledged revision without Save",async()=>{
  const id=selectedRecord();const read=vi.fn((selection:InvestigationIntlSelection)=>({selection,input:{disposition:"not_admitted" as const}}));
  await mount(undefined,undefined,"intl","route",read);expect(read).not.toHaveBeenCalled();
  await mount(id,1,"intl-record","route",read);expect(read).toHaveBeenCalled();expect(read.mock.calls.every(([selection])=>selection.id===id&&selection.revision===1)).toBe(true);
  expect(posts).toEqual([]);expect(requests.every(r=>r.method==="GET")).toBe(true);
 });
 it("withholds the reader after native auth epoch changes even without a subscriber notification",async()=>{
  const id=selectedRecord();const read=vi.fn((selection:InvestigationIntlSelection)=>({selection,input:{disposition:"not_admitted" as const}}));
  await mount(id,1,"intl","route",read);expect(read).toHaveBeenCalled();read.mockClear();
  auth.snapshot={...ready(),auth_epoch:"epoch-2"};
  await mount(id,1,"intl","route",read);expect(read).not.toHaveBeenCalled();expect(posts).toEqual([]);
 });
 it("checks the same native fence after a synchronous source read revokes the principal",async()=>{
  const id=selectedRecord();const read=vi.fn((selection:InvestigationIntlSelection)=>{
   auth.snapshot={availability:"unavailable",principal_partition:null,auth_epoch:"withdrawn"};
   return {selection,input:{disposition:"denied" as const}};
  });
  await mount(id,1,"intl","route",read);expect(read).toHaveBeenCalled();
  // The supplied denied packet must not be rendered after owner withdrawal.
  expect(host.textContent).not.toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.disposition.denied);
  expect(host.textContent).toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.unavailable);
  expect(posts).toEqual([]);expect(requests.every(r=>r.method==="GET")).toBe(true);
 });
 it("mounts the unchanged actual Macro packet only for the synthetic native acknowledged selection",async()=>{
  const id=selectedRecord(),packet=structuredClone(intlPacket) as IntlResolvedPacket,before=structuredClone(packet);
  const read=vi.fn((selection:InvestigationIntlSelection)=>({selection,input:{disposition:"resolved" as const,...packet}}));
  await mount(id,1,"intl-actual","route",read);
  expect(read).toHaveBeenCalled();expect(packet).toEqual(before);
  expect(host.textContent).toContain(packet.owner.question);
  expect(host.textContent).toContain("Annual current account · extra-EA21");
  expect(host.textContent).toContain("1.7 percent_gdp");
  expect(host.textContent).toContain("No baseline comparison is available right now.");
  expect(host.textContent).not.toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.unavailable);
  expect(posts).toEqual([]);expect(requests.every(r=>r.method==="GET")).toBe(true);
  // The unit auth and saved selection are synthetic bindings, not source admission.
  auth.snapshot={...ready(),auth_epoch:"epoch-2"};read.mockClear();
  await mount(id,1,"intl-actual","route",read);expect(read).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain(packet.owner.question);
  expect(host.textContent).toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.unavailable);
 });
 it("does not call an optional source when the native owner is unavailable",async()=>{
  const id=selectedRecord();auth.snapshot={availability:"unavailable",principal_partition:null,auth_epoch:"none"};
  const read=vi.fn((selection:InvestigationIntlSelection)=>({selection,input:{disposition:"not_admitted" as const}}));
  await mount(id,1,"intl","route",read);expect(read).not.toHaveBeenCalled();expect(posts).toEqual([]);
 });
});


describe("native International authenticated asynchronous selected read",()=>{
 const context="intl-workspace-context:sha256:"+"c".repeat(64),generation="im-workspace-generation:11111111-1111-4111-8111-111111111111";
 function selected(){
  const ref={owner:"intl.workspace_generation",object_type:"selected_generation",object_id:context,mode:"pinned" as const,version_ref:generation,fingerprint:"a".repeat(64),selection:{field:"EZ.gdp_yoy"}};
  saved={id:"50000000-0000-4000-8000-000000000001",operation_id:"50000000-0000-4000-8000-000000000002",expected_revision:0,action:"create",manifest:{schema:"investigation_manifest.v3",argument_relations:[],intent:{title:"Private International record",question:"My exact authored question",subjects:[{owner:"intl.workspace_context",kind:"economy",object_id:context}]},layout_refs:[],thesis_refs:[],evidence_refs:[ref],review_baseline_ref:ref,continuation:{}}};return saved.id;
 }
 function review(reply:()=>Promise<Response>){const original=vi.mocked(fetch).getMockImplementation()!;vi.mocked(fetch).mockImplementation((input,init)=>{
  if(String(input).startsWith("/api/investigations/review?")){requests.push({url:String(input),method:init?.method??"GET"});return reply();}return original(input,init);
 });}
 const reviews=()=>requests.filter(r=>r.url.startsWith("/api/investigations/review?"));
 const frame=(disposition:string)=>({status:"international",id:saved!.id,revision:1,input:{disposition}});
 async function publish(snapshot:AuthLifecycleSnapshot){await act(async()=>{auth.snapshot=snapshot;auth.publish!(snapshot);});}
 it("waits for actual auth readiness after detail arrives and ignores identical lifecycle notifications",async()=>{
  const id=selected();auth.snapshot={availability:"unavailable",principal_partition:null,auth_epoch:"initial-pending"};review(()=>response(frame("not_admitted")));
  await mount(id,1,"intl-auth-pending");expect(reviews()).toHaveLength(0);
  await publish(ready());expect(reviews()).toHaveLength(1);expect(host.textContent).toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.disposition.not_admitted);
  await publish({...ready()});expect(reviews()).toHaveLength(1);expect(posts).toEqual([]);
 });
 it("does not let a late earlier-epoch review overwrite the newly acknowledged private projection",async()=>{
  const id=selected();let release!:(r:Response)=>void;let n=0;review(()=>++n===1?new Promise<Response>(r=>{release=r;}):response(frame("not_admitted")));
  await mount(id,1,"intl-auth-rebind");expect(reviews()).toHaveLength(1);
  await publish({...ready(),auth_epoch:"epoch-2"});expect(reviews()).toHaveLength(2);expect(host.textContent).toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.disposition.not_admitted);
  await act(async()=>release(new Response(JSON.stringify(frame("denied")),{status:200})));
  expect(host.textContent).not.toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.disposition.denied);expect(host.textContent).toContain(INVESTIGATION_INTL_RECEIVER_COPY.en.disposition.not_admitted);expect(posts).toEqual([]);
 });
});


describe("native International authoring ingress",()=>{
 const selection:IntlEntrySelectors={context:"intl-workspace-context:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",generation:"im-workspace-generation:11111111-1111-4111-8111-111111111111",fingerprint:"a".repeat(64),fields:["EZ.gdp_yoy","EZ.cpi_yoy"]};
 const source=()=>{const refs=selection.fields.map(field=>({owner:"intl.workspace_generation",object_type:"selected_generation",object_id:selection.context,mode:"pinned",version_ref:selection.generation,fingerprint:selection.fingerprint,selection:{field}}));return {status:"international_baseline",context:{researchMarket:"EZ",periodIdentity:"3m",currencyBasis:"local",returnBasis:"price"},refs,baseline:refs[0],subject:{owner:"intl.workspace_context",kind:"economy",object_id:selection.context}};};
 function transport(reply:()=>Promise<Response>){const original=vi.mocked(fetch).getMockImplementation()!;vi.mocked(fetch).mockImplementation((input,init)=>{
  if(String(input).startsWith("/api/investigations/baseline?kind=international")){requests.push({url:String(input),method:init?.method??"GET"});return reply();}
  return original(input,init);
 });}
 it("qualifies selectors before blank authoring and explicitly saves/reopens the exact question and references",async()=>{
  const qualified=source();transport(()=>response(qualified));
  const back="https://www.mastermind-x.com/intl.html?view=risk&market=EZ&horizon=3m&basis=local&return_basis=price";
  await mount(undefined,undefined,"intl-entry","route",undefined,selection,back);
  expect(host.querySelector('[aria-label="Research question"]')).toBeNull();expect(posts).toEqual([]);
  await click("Use this International selection");
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Research question"]')?.value).toBe("");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("");
  expect(host.querySelector('[aria-label="Symbol"]')).toBeNull();expect(posts).toEqual([]);
  await fill("Title","My authored International research");await fill("Research question","What does my selected economic evidence imply?");await click("Save research");
  expect(posts).toHaveLength(1);const command=posts[0];
  expect(command.manifest).toMatchObject({schema:"investigation_manifest.v3",intent:{question:"What does my selected economic evidence imply?",subjects:[qualified.subject]},evidence_refs:qualified.refs,review_baseline_ref:qualified.refs[0]});
  expect(command.manifest).not.toHaveProperty("option_plan");
  expect(new URL(window.location.href).searchParams.get("intl_return")).toBe(back);
  await mount(command.id,1,"intl-reopen","route",undefined,undefined,back);
  expect(host.textContent).toContain("What does my selected economic evidence imply?");expect(posts).toHaveLength(1);
  expect(host.querySelector<HTMLAnchorElement>('a[href^="https://www.mastermind-x.com"]')?.href).toBe(back);
  expect(requests.filter(r=>r.method!=="GET")).toEqual([{url:"/api/investigations",method:"POST"}]);
 });
 it("does not open a draft from a substituted source digest",async()=>{
  const reply=source();reply.refs[0].fingerprint="b".repeat(64);transport(()=>response(reply));
  await mount(undefined,undefined,"intl-bad","route",undefined,selection);await click("Use this International selection");
  expect(host.querySelector('[aria-label="Research question"]')).toBeNull();expect(posts).toEqual([]);
 });
 it("discards the held baseline answer after an unnotified auth epoch changes",async()=>{
  let release!:(response:Response)=>void;transport(()=>new Promise<Response>(resolve=>{release=resolve;}));
  await mount(undefined,undefined,"intl-held","route",undefined,selection);
  await act(async()=>button("Use this International selection").click());auth.snapshot={...ready(),auth_epoch:"new-epoch"};
  await act(async()=>release(new Response(JSON.stringify(source()),{status:200})));
  expect(host.querySelector('[aria-label="Research question"]')).toBeNull();expect(posts).toEqual([]);
 });
 it("refuses Save after the admitted native draft owner epoch changes",async()=>{
  transport(()=>response(source()));await mount(undefined,undefined,"intl-epoch","route",undefined,selection);await click("Use this International selection");
  await fill("Title","Held draft");await fill("Research question","Only the admitted principal may send this");
  auth.snapshot={...ready(),auth_epoch:"changed-after-entry"};await click("Save research");expect(posts).toEqual([]);
 });
});

// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import InvestigationEvidenceReview from "@/components/workspaces/InvestigationEvidenceReview";
import {InvestigationAuthContext,type InvestigationAuthProjection} from "@/components/workspaces/InvestigationAuthContext";
import type {AuthLifecycleSnapshot} from "@/lib/supabase/authLifecycle";
import type {InvestigationEvidenceRef} from "@/lib/investigationContracts";
import fixture from "./fixtures/aapl-event-workspace.json";
import {normalizeEventWorkspace,type RetainedEventWorkspaceReceipt} from "../eventWorkspace";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="10000000-0000-4000-8000-000000000001";
const otherId="20000000-0000-4000-8000-000000000002";
const workspace=normalizeEventWorkspace(fixture);
if(!workspace)throw Error("Invalid owner fixture");
const baseline={workspace,receipt:{fingerprint:"a".repeat(64),generation_id:fixture.generation_id} as RetainedEventWorkspaceReceipt};
const current={...baseline.receipt,fingerprint:"b".repeat(64),generation_id:"b".repeat(24)};
const result={status:"reviewed",id,revision:1,baseline:baseline.receipt,current,review:{schema:"investigation.evidence_review.v1",summary:"incomplete",items:[{id:"source:transcript:call",membership:"present",version:"revised",qualification:"unchanged",availability:"available",excluded:false,correction:false,interpretation:{comparable:false,reason:"not_applicable"}}]}};
const REV="Review current evidence",ADV="Use this reviewed version in an edit",REVISED="Content revised",UNAVAILABLE="The comparison is unavailable",LOADING="Checking both evidence versions",SAVED_UNCHANGED="Your saved baseline is unchanged";
// Synthetic nonsecret transport of the actual context Provider; the mutable
// fresh getter mimics owner lag, cleanup and real opaque-epoch rebinding.
function createOwner(principal="u-alpha",epoch="epoch-1"){
 const cell={availability:"ready" as AuthLifecycleSnapshot["availability"],principal,epoch,live:true};
 const getSnapshot=()=>cell.live?{availability:cell.availability,principal_partition:cell.principal,auth_epoch:cell.epoch}:null;
 return{cell,getSnapshot,projection:()=>{const snapshot=getSnapshot();if(!snapshot)throw Error("a cleaned-up owner cannot project");return{snapshot,getSnapshot};}};
}
type Deferred={promise:Promise<unknown>;resolve:(value:unknown)=>void;reject:(reason:unknown)=>void};
function deferFetch(){const queue:Deferred[]=[];const fetcher=vi.fn<(url:string,options?:RequestInit)=>Promise<unknown>>(()=>{let resolve!:(value:unknown)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});queue.push({promise,resolve,reject});return promise;});return{fetcher,queue};}
const instantFetch=(data:unknown)=>vi.fn(async()=>({ok:true,json:async()=>data}));
const flush=()=>new Promise<void>(resolve=>{setTimeout(resolve,0);});
async function settle(d:Deferred,response:{ok:boolean;data:unknown}){await act(async()=>{d.resolve({ok:response.ok,json:async()=>response.data});await flush();});}
let root:Root|undefined,host:HTMLDivElement|undefined,ownerRef:ReturnType<typeof createOwner>|undefined;
const view={key:"first",lang:"en" as "en"|"zh",id,receipt:baseline as typeof baseline & {reference?:InvestigationEvidenceRef},canAdvance:true,onSelect:vi.fn(),auth:null as InvestigationAuthProjection|null};
async function paint(patch:Partial<typeof view>={}){
 if(!host){host=document.createElement("div");document.body.append(host);root=createRoot(host);}
 Object.assign(view,patch);
 const{key,lang,id:targetId,receipt,canAdvance,onSelect,auth}=view;
 await act(async()=>{root!.render(<InvestigationAuthContext.Provider value={auth}><InvestigationEvidenceReview key={key} id={targetId} revision={1} lang={lang} baseline={receipt} canAdvance={canAdvance} onSelect={onSelect}/></InvestigationAuthContext.Provider>);});
}
function currentOwner(){return ownerRef??=createOwner();}
async function mount(onSelect=vi.fn(),owner="first",lang:"en"|"zh"="en"){await paint({key:owner,lang,onSelect,auth:currentOwner().projection()});return onSelect;}
async function click(text:string){const button=[...host!.querySelectorAll("button")].find(button=>button.textContent===text);expect(button).toBeDefined();await act(async()=>{button!.click();});}
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();root=undefined;host=undefined;ownerRef=undefined;Object.assign(view,{key:"first",lang:"en",id,receipt:baseline,canAdvance:true,onSelect:vi.fn(),auth:null});vi.unstubAllGlobals();});
describe("read-only evidence review controls",()=>{
 for(const lang of ["en","zh"] as const){
  for(const sample of [
   {name:"fractional values",unit:"usd_millions",values:[1.125,1.25,0.125]},
   {name:"zero value",unit:"usd_millions",values:[0,0.5,0.5]},
   {name:"negative value",unit:"usd_millions",values:[-0.125,0,0.125]},
   {name:"zero difference",unit:"usd_millions",values:[1.125,1.125,0]},
   {name:"unknown unit",unit:"custom_units",values:[1.125,1.25,0.125]},
  ])it(`readable comparison units preserve ${sample.name} — ${lang}`,async()=>{
   const fact={...workspace.facts[0],unit:sample.unit};
   const receipt={...baseline,workspace:{...workspace,facts:[fact]}};
   const [prior,currentValue,delta]=sample.values;
   const item={...result.review.items[0],id:`fact:${fact.fact_id}`,interpretation:{comparable:true,prior,current:currentValue,delta}};
   const fetcher=instantFetch({...result,review:{...result.review,items:[item]}});vi.stubGlobal("fetch",fetcher);
   const select=vi.fn();await paint({lang,receipt,auth:currentOwner().projection(),onSelect:select});
   await click(lang==="en"?REV:"复核当前证据");
   const unit=sample.unit==="custom_units"?"custom_units":lang==="en"?"million USD":"百万美元";
   expect([...host!.querySelectorAll("li dd")].map(e=>e.textContent)).toEqual(sample.values.map(value=>`${value} ${unit}`));
   expect(host!.textContent).not.toContain("usd_millions");
   expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledWith(`/api/investigations/review?id=${id}&revision=1`,expect.objectContaining({cache:"no-store",signal:expect.any(AbortSignal)}));expect(select).not.toHaveBeenCalled();
  });
  for(const reason of ["missing unit","incomparable"] as const)it(`readable comparison units keep ${reason} without numeric values — ${lang}`,async()=>{
   const fact={...workspace.facts[0],unit:reason==="missing unit"?null:"usd_millions"};
   const receipt={...baseline,workspace:{...workspace,facts:[fact]}};
   const interpretation=reason==="incomparable"?{comparable:false,reason:"incompatible"}:{comparable:true,prior:1.125,current:1.25,delta:0.125};
   const fetcher=instantFetch({...result,review:{...result.review,items:[{...result.review.items[0],id:`fact:${fact.fact_id}`,interpretation}]}});vi.stubGlobal("fetch",fetcher);
   const select=vi.fn();await paint({lang,receipt,auth:currentOwner().projection(),onSelect:select});await click(lang==="en"?REV:"复核当前证据");
   expect(host!.querySelectorAll("li dl")).toHaveLength(0);expect(fetcher).toHaveBeenCalledTimes(1);expect(select).not.toHaveBeenCalled();
  });
 }

 it("does not fetch on reopen and makes only an explicit GET before selecting an edit",async()=>{
  const fetcher=vi.fn(async(_url:string,_options?:RequestInit)=>({ok:true,json:async()=>result}));vi.stubGlobal("fetch",fetcher);const select=await mount();expect(fetcher).not.toHaveBeenCalled();
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe(`/api/investigations/review?id=${id}&revision=1`);
  expect((fetcher.mock.calls[0] as unknown[])[1]).toMatchObject({cache:"no-store"});expect(host!.textContent).toContain("Missing rows do not prove removal");expect(select).not.toHaveBeenCalled();
  await click(ADV);expect(select).toHaveBeenCalledTimes(1);expect(select).toHaveBeenCalledWith(current);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("failed refresh clears the old comparison and never selects a new baseline",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>result}).mockResolvedValueOnce({ok:false,json:async()=>({status:"unavailable"})});vi.stubGlobal("fetch",fetcher);const select=await mount();
  await click(REV);await click(REV);expect(host!.textContent).toContain(SAVED_UNCHANGED);expect(host!.textContent).not.toContain(ADV);expect(select).not.toHaveBeenCalled();
 });
 it("rejects a comparison for a different saved fingerprint",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...result,baseline:current})})));await mount();await click(REV);expect(host!.textContent).toContain(UNAVAILABLE);
 });
 it("aborts an old principal's request and ignores its late response",async()=>{
  let finish!:(value:unknown)=>void,signal!:AbortSignal;
  vi.stubGlobal("fetch",vi.fn((_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}));await mount();await click(REV);await mount(vi.fn(),"second");expect(signal.aborted).toBe(true);
  await act(async()=>{finish({ok:true,json:async()=>result});});expect(host!.textContent).not.toContain(REVISED);
 });
 it("renders the same conservative states in Chinese",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>result})));await mount(vi.fn(),"zh","zh");await click("复核当前证据");expect(host!.textContent).toContain("未出现的项目不代表已删除");expect(host!.textContent).toContain("内容已修订");
 });
 it("keeps missing and unavailable observations visible without claiming removal",async()=>{
  const items=[{...result.review.items[0],membership:"not_observed",version:"unknown",qualification:"unknown",availability:"unavailable",interpretation:{comparable:false,reason:"unavailable"}}];
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...result,review:{...result.review,items}})})));await mount();await click(REV);
  expect(host!.textContent).toContain("Not observed in the current read");expect(host!.textContent).toContain("Value comparison unavailable");expect(host!.textContent).not.toContain("Confirmed removal");expect(host!.textContent).not.toContain("No identified changes");
 });
 it("no projected context forbids the GET, never auto-fetches when a ready lifetime returns, and needs a fresh explicit review",async()=>{
  const fetcher=instantFetch(result);vi.stubGlobal("fetch",fetcher);const owner=currentOwner();
  await paint({auth:null});await click(REV);expect(fetcher).not.toHaveBeenCalled();expect(host!.textContent).toContain(UNAVAILABLE);
  await paint({auth:owner.projection()});expect(fetcher).not.toHaveBeenCalled();expect(host!.textContent).not.toContain(REVISED);
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(1);expect(host!.textContent).toContain(REVISED);
 });
 it("a rendered-ready projection cannot start a review while the fresh getter reports unverified",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await paint({auth:{snapshot:{availability:"ready",principal_partition:"u-alpha",auth_epoch:"epoch-1"},getSnapshot:()=>({availability:"unverified",principal_partition:"u-alpha",auth_epoch:"epoch-1"})}});
  await click(REV);expect(fetcher).not.toHaveBeenCalled();expect(host!.textContent).toContain(UNAVAILABLE);
 });
 it("a fresh ready snapshot without a usable principal still forbids the explicit GET",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await paint({auth:{snapshot:{availability:"ready",principal_partition:"u-alpha",auth_epoch:"epoch-1"},getSnapshot:()=>({availability:"ready",principal_partition:null,auth_epoch:"epoch-1"})}});
  await click(REV);expect(fetcher).not.toHaveBeenCalled();expect(host!.textContent).toContain(UNAVAILABLE);
 });
 it("a same-principal epoch change before the reply rejects the response even though the rendered snapshot still says ready",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);
  owner.cell.epoch="epoch-2";await settle(queue[0]!,{ok:true,data:result});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(host!.textContent).not.toContain(REVISED);expect(host!.textContent).not.toContain(ADV);expect(select).not.toHaveBeenCalled();
 });
 it("a reply that settles while the fresh getter reports unverified installs nothing",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);
  await paint({auth:owner.projection(),onSelect:vi.fn()});await click(REV);
  owner.cell.availability="unverified";await settle(queue[0]!,{ok:true,data:result});
  expect(host!.textContent).not.toContain(REVISED);
 });
 it("owner cleanup before a reply blocks that settlement and a later explicit review on a new lifetime settles",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);
  owner.cell.live=false;await settle(queue[0]!,{ok:true,data:result});
  expect(host!.textContent).not.toContain(REVISED);
  const next=createOwner("u-alpha","epoch-2");ownerRef=next;
  await paint({auth:next.projection()});expect(fetcher).toHaveBeenCalledTimes(1);
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(2);
  await settle(queue[1]!,{ok:true,data:result});expect(host!.textContent).toContain(REVISED);
  await click(ADV);expect(select).toHaveBeenCalledWith(current);
 });
 it("a projected getter replacement during an in-flight reply cannot install data even if the captured getter is still readable",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);
  await paint({auth:owner.projection(),onSelect:vi.fn()});await click(REV);
  const next=createOwner("u-alpha","epoch-2");ownerRef=next;await paint({auth:next.projection()});
  await settle(queue[0]!,{ok:true,data:result});
  await paint({auth:owner.projection()});
  expect(host!.textContent).not.toContain(REVISED);
 });
 it("the same user returning after another principal invalidates the old completed result by epoch alone without resurrecting or replaying it",async()=>{
  const owner=currentOwner(),fetcher=instantFetch(result);vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);expect(host!.textContent).toContain(REVISED);
  await click(ADV);expect(select).toHaveBeenCalledTimes(1);
  owner.cell.principal="u-beta";owner.cell.epoch="epoch-2";await click(ADV);expect(select).toHaveBeenCalledTimes(1);
  owner.cell.principal="u-alpha";owner.cell.epoch="epoch-3";expect(select).toHaveBeenCalledTimes(1);
  await paint({auth:owner.projection()});
  expect(host!.textContent).not.toContain(REVISED);expect(host!.textContent).not.toContain(ADV);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("a completed result cannot be selected once the fresh getter is no longer ready, without any rerender",async()=>{
  const owner=currentOwner(),fetcher=instantFetch(result);vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);await click(ADV);expect(select).toHaveBeenCalledTimes(1);
  owner.cell.availability="unavailable";await click(ADV);expect(select).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("a replaced owner lifetime hides the stale result until a fresh explicit review replaces it",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);await settle(queue[0]!,{ok:true,data:result});expect(host!.textContent).toContain(REVISED);
  const next=createOwner("u-alpha","epoch-2");ownerRef=next;await paint({auth:next.projection()});
  expect(host!.textContent).not.toContain(REVISED);expect(host!.textContent).not.toContain(ADV);expect(fetcher).toHaveBeenCalledTimes(1);
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(2);
  await settle(queue[1]!,{ok:true,data:result});expect(host!.textContent).toContain(REVISED);
  await click(ADV);expect(select).toHaveBeenCalledTimes(1);
 });
 it("a reply for a superseded saved identity is discarded and settles loading",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);
  await paint({id:otherId});await settle(queue[0]!,{ok:true,data:result});
  expect(host!.textContent).not.toContain(REVISED);
  expect(host!.textContent).not.toContain(LOADING);
  expect([...host!.querySelectorAll("button")].find(b=>b.textContent===REV)?.disabled).toBe(false);
 });
 it("an aborted older request cannot overwrite the newest request's settled result",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(1);
  owner.cell.epoch="epoch-2";await paint({auth:owner.projection()});
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(2);
  await settle(queue[1]!,{ok:true,data:result});expect(host!.textContent).toContain(REVISED);
  await act(async()=>{queue[0]!.reject(new Error("old transport failure"));await flush();});
  expect(host!.textContent).toContain(REVISED);expect(host!.textContent).not.toContain(SAVED_UNCHANGED);
  await click(ADV);expect(select).toHaveBeenCalledTimes(1);
 });
 it("an intermediate projected unknown does not lose a reply settled by the same ready lifetime",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);
  await paint({auth:{snapshot:{availability:"unverified",principal_partition:"u-alpha",auth_epoch:"epoch-1"},getSnapshot:owner.getSnapshot}});
  await settle(queue[0]!,{ok:true,data:result});expect(host!.textContent).not.toContain(ADV);
  await paint({auth:owner.projection()});expect(host!.textContent).toContain(REVISED);
  await click(ADV);expect(select).toHaveBeenCalledWith(current);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("a newly published context object over an unchanged verified lifetime preserves the completed review and selection",async()=>{
  const owner=currentOwner(),fetcher=instantFetch(result);vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:owner.projection(),onSelect:select});await click(REV);
  await paint({auth:{snapshot:{availability:"ready",principal_partition:"u-alpha",auth_epoch:"epoch-1"},getSnapshot:owner.getSnapshot}});
  await click(ADV);expect(select).toHaveBeenCalledTimes(1);expect(select).toHaveBeenCalledWith(current);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("an advance click honours the latest canAdvance before selecting",async()=>{
  const fetcher=instantFetch(result);vi.stubGlobal("fetch",fetcher);const select=vi.fn();
  await paint({auth:currentOwner().projection(),onSelect:select});await click(REV);
  await paint({canAdvance:false});await click(ADV);expect(select).not.toHaveBeenCalled();
  await paint({canAdvance:true});await click(ADV);expect(select).toHaveBeenCalledWith(current);
 });

 it("reference-only rebinding permanently discards a result even with the same receipt fingerprint",async()=>{
  const owner=currentOwner(),fetcher=instantFetch(result),select=vi.fn();vi.stubGlobal("fetch",fetcher);
  const reference={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:"first",mode:"pinned" as const,version_ref:"v1",fingerprint:baseline.receipt.fingerprint,selection:{field:"event"}};
  await paint({auth:owner.projection(),onSelect:select,receipt:{...baseline,reference}});await click(REV);expect(host!.textContent).toContain(REVISED);
  await paint({receipt:{...baseline,reference:{...reference,object_id:"second"}}});expect(host!.textContent).not.toContain(REVISED);
  await paint({receipt:{...baseline,reference:{...reference,selection:{field:"event"}}}});
  expect(host!.textContent).not.toContain(ADV);expect(fetcher).toHaveBeenCalledTimes(1);expect(select).not.toHaveBeenCalled();
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(2);await click(ADV);expect(select).toHaveBeenCalledWith(current);
 });
 it("an equivalent recreated reference preserves the in-flight request and result",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch(),select=vi.fn();vi.stubGlobal("fetch",fetcher);
  const reference={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:"first",mode:"pinned" as const,fingerprint:baseline.receipt.fingerprint};
  await paint({auth:owner.projection(),onSelect:select,receipt:{...baseline,reference}});await click(REV);
  await paint({receipt:{...baseline,reference:{...reference}}});await settle(queue[0]!,{ok:true,data:result});
  await click(ADV);expect(select).toHaveBeenCalledWith(current);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("a rejection during fresh unverified state ends only its own loading and never replays",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);
  await paint({auth:owner.projection()});await click(REV);owner.cell.availability="unverified";
  await act(async()=>{queue[0]!.reject(new Error("transport unavailable"));await flush();});
  expect(host!.textContent).not.toContain(LOADING);expect(host!.textContent).not.toContain(REVISED);
  owner.cell.availability="ready";await paint({auth:owner.projection()});expect(fetcher).toHaveBeenCalledTimes(1);
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(2);await settle(queue[1]!,{ok:true,data:result});expect(host!.textContent).toContain(REVISED);
 });
});

describe("parent invalidation counterexamples",()=>{
 it("a rejected advance cannot revive after the same epoch becomes ready",async()=>{
  const owner=currentOwner(),fetcher=instantFetch(result),select=vi.fn();vi.stubGlobal("fetch",fetcher);
  await paint({auth:owner.projection(),onSelect:select});await click(REV);expect(host!.textContent).toContain(REVISED);
  owner.cell.availability="unverified";await click(ADV);expect(select).not.toHaveBeenCalled();
  owner.cell.availability="ready";await paint({auth:owner.projection()});
  const advance=[...host!.querySelectorAll("button")].find(b=>b.textContent===ADV);
  if(advance)await act(async()=>{advance.click();});
  expect(select).not.toHaveBeenCalled();expect(host!.textContent).not.toContain(REVISED);expect(fetcher).toHaveBeenCalledTimes(1);
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(2);await click(ADV);expect(select).toHaveBeenCalledWith(current);
 });
 it("an observed unverified binding permanently discards a completed review",async()=>{
  const owner=currentOwner(),fetcher=instantFetch(result);vi.stubGlobal("fetch",fetcher);
  await paint({auth:owner.projection()});await click(REV);expect(host!.textContent).toContain(REVISED);
  owner.cell.availability="unverified";await paint({auth:owner.projection()});expect(host!.textContent).not.toContain(REVISED);
  owner.cell.availability="ready";await paint({auth:owner.projection()});
  expect(host!.textContent).not.toContain(REVISED);expect(host!.textContent).not.toContain(ADV);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("an auth-rejected response settles loading and allows a fresh explicit request",async()=>{
  const owner=currentOwner(),{fetcher,queue}=deferFetch();vi.stubGlobal("fetch",fetcher);
  await paint({auth:owner.projection()});await click(REV);owner.cell.availability="unverified";
  await settle(queue[0]!,{ok:true,data:result});expect(host!.textContent).not.toContain(REVISED);
  expect(host!.textContent).not.toContain(LOADING);
  owner.cell.availability="ready";await paint({auth:owner.projection()});expect(fetcher).toHaveBeenCalledTimes(1);
  await click(REV);expect(fetcher).toHaveBeenCalledTimes(2);await settle(queue[1]!,{ok:true,data:result});expect(host!.textContent).toContain(REVISED);
 });
});

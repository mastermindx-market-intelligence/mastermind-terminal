// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import InvestigationEvidenceReview from "@/components/workspaces/InvestigationEvidenceReview";
import fixture from "./fixtures/aapl-event-workspace.json";
import {normalizeEventWorkspace,type RetainedEventWorkspaceReceipt} from "../eventWorkspace";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="10000000-0000-4000-8000-000000000001";
const workspace=normalizeEventWorkspace(fixture);
if(!workspace)throw Error("Invalid owner fixture");
const baseline={workspace,receipt:{fingerprint:"a".repeat(64),generation_id:fixture.generation_id} as RetainedEventWorkspaceReceipt};
const current={...baseline.receipt,fingerprint:"b".repeat(64),generation_id:"b".repeat(24)};
const result={status:"reviewed",id,revision:1,baseline:baseline.receipt,current,review:{schema:"investigation.evidence_review.v1",summary:"incomplete",items:[{id:"source:transcript:call",membership:"present",version:"revised",qualification:"unchanged",availability:"available",excluded:false,correction:false,interpretation:{comparable:false,reason:"not_applicable"}}]}};
let root:Root|undefined,host:HTMLDivElement|undefined;
async function mount(onSelect=vi.fn(),owner="first",lang:"en"|"zh"="en"){
 if(!host){host=document.createElement("div");document.body.append(host);root=createRoot(host);}
 await act(async()=>{root!.render(<InvestigationEvidenceReview key={owner} id={id} revision={1} lang={lang} baseline={baseline} canAdvance onSelect={onSelect}/>);});
 return onSelect;
}
async function click(text:string){const button=[...host!.querySelectorAll("button")].find(button=>button.textContent===text);expect(button).toBeDefined();await act(async()=>{button!.click();});}
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();root=undefined;host=undefined;vi.unstubAllGlobals();});
describe("read-only evidence review controls",()=>{
 it("does not fetch on reopen and makes only an explicit GET before selecting an edit",async()=>{
  const fetcher=vi.fn(async(_url:string,_options?:RequestInit)=>({ok:true,json:async()=>result}));vi.stubGlobal("fetch",fetcher);const select=await mount();expect(fetcher).not.toHaveBeenCalled();
  await click("Review current evidence");expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe(`/api/investigations/review?id=${id}&revision=1`);
  expect((fetcher.mock.calls[0] as unknown[])[1]).toMatchObject({cache:"no-store"});expect(host!.textContent).toContain("Missing rows do not prove removal");expect(select).not.toHaveBeenCalled();
  await click("Use this reviewed version in an edit");expect(select).toHaveBeenCalledTimes(1);expect(select).toHaveBeenCalledWith(current);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("failed refresh clears the old comparison and never selects a new baseline",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>result}).mockResolvedValueOnce({ok:false,json:async()=>({status:"unavailable"})});vi.stubGlobal("fetch",fetcher);const select=await mount();
  await click("Review current evidence");await click("Review current evidence");expect(host!.textContent).toContain("Your saved baseline is unchanged");expect(host!.textContent).not.toContain("Use this reviewed version in an edit");expect(select).not.toHaveBeenCalled();
 });
 it("rejects a comparison for a different saved fingerprint",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...result,baseline:current})})));await mount();await click("Review current evidence");expect(host!.textContent).toContain("The comparison is unavailable");
 });
 it("aborts an old principal's request and ignores its late response",async()=>{
  let finish!:(value:unknown)=>void,signal!:AbortSignal;
  vi.stubGlobal("fetch",vi.fn((_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}));await mount();await click("Review current evidence");await mount(vi.fn(),"second");expect(signal.aborted).toBe(true);
  await act(async()=>{finish({ok:true,json:async()=>result});});expect(host!.textContent).not.toContain("Content revised");
 });
 it("renders the same conservative states in Chinese",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>result})));await mount(vi.fn(),"zh","zh");await click("复核当前证据");expect(host!.textContent).toContain("未出现的项目不代表已删除");expect(host!.textContent).toContain("内容已修订");
 });
 it("keeps missing and unavailable observations visible without claiming removal",async()=>{
  const items=[{...result.review.items[0],membership:"not_observed",version:"unknown",qualification:"unknown",availability:"unavailable",interpretation:{comparable:false,reason:"unavailable"}}];
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({...result,review:{...result.review,items}})})));await mount();await click("Review current evidence");
  expect(host!.textContent).toContain("Not observed in the current read");expect(host!.textContent).toContain("Value comparison unavailable");expect(host!.textContent).not.toContain("Owner-proven removal");expect(host!.textContent).not.toContain("No identified changes");
 });
});

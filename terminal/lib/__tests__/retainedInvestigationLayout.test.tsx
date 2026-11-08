// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import RetainedInvestigationLayout from "@/components/RetainedInvestigationLayout";
import native from "./fixtures/workspace/chart_layout_v2_real_capture.json";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="10000000-0000-4000-8000-000000000001",layout="20000000-0000-4000-8000-000000000001",current="30000000-0000-4000-8000-000000000001",digest="a".repeat(64);
const search=`?investigation=${id}&revision=1&layout_revision=${layout}`;
const reply={status:"found",id,revision:1,current_revision:2,manifest:{layout_refs:[{layout_id:current,layout_revision_id:layout,digest}]},layouts:[{id:layout,layout_id:current,name:"My native layout",digest,config:native.expected}]};
let root:Root|undefined,host:HTMLDivElement|undefined;
async function mount(owner:string,onOpen:(config:unknown,name:string)=>void,query=search){
 if(!host){host=document.createElement("div");document.body.append(host);root=createRoot(host);}
 await act(async()=>{root!.render(<RetainedInvestigationLayout owner={owner} search={query} onOpen={onOpen}/>);});
}
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();root=undefined;host=undefined;vi.unstubAllGlobals();});
describe("retained owner layout opens through the native host without a write",()=>{
 it("delivers the exact valid N envelope while the aggregate head is N+1",async()=>{
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>reply}));vi.stubGlobal("fetch",fetcher);const open=vi.fn();await mount("alice",open);
  expect(open.mock.calls).toEqual([[native.expected,"My native layout"]]);
  expect(fetcher.mock.calls).toHaveLength(1);expect(host?.textContent).toContain("current named layout is unchanged");
  expect((fetcher.mock.calls[0] as unknown[])[0]).toBe(`/api/investigations?id=${id}&revision=1`);
 });
 it("cannot replace a missing or altered retained row with current",async()=>{
  let ownerIndex=0;
  for(const invalid of [{...reply,layouts:[]},{...reply,revision:2},{...reply,layouts:[{...reply.layouts[0],digest:"b".repeat(64)}]}]){
   vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>invalid})));const open=vi.fn();await mount(`reader-${++ownerIndex}`,open);
   expect(open).not.toHaveBeenCalled();expect(host?.textContent).toContain("No current layout was substituted");
  }
 });
 it("rejects repeated identity selectors before any read",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await mount("alice",vi.fn(),`${search}&revision=1`);expect(fetcher).not.toHaveBeenCalled();
 });
 it("aborts a previous owner's pending read and never applies its late response",async()=>{
  let finish!:(value:unknown)=>void;let firstSignal:AbortSignal|undefined;
  vi.stubGlobal("fetch",vi.fn((_url,options)=>{if(!firstSignal){firstSignal=options.signal;return new Promise(resolve=>{finish=resolve;});}return Promise.resolve({ok:false});}));
  const open=vi.fn();await mount("alice",open);await mount("bob",open);expect(firstSignal!.aborted).toBe(true);
  await act(async()=>{finish({ok:true,json:async()=>reply});});expect(open).not.toHaveBeenCalled();
 });
});

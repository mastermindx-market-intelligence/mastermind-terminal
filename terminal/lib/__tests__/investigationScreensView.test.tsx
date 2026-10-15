// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {InvestigationScreenPicker,InvestigationScreenReader} from "@/components/workspaces/InvestigationScreens";
import {normalizeDefinition} from "@/lib/smartScreen/predicate";
import {SMART_SCREEN_LEX} from "@/lib/smartScreenLex";
import type {InvestigationEvidenceRef} from "@/lib/investigationContracts";
import type {ScreenCapture} from "@/lib/investigationScreen";
vi.mock("@/lib/smartScreenLex",async(importOriginal)=>({...await importOriginal<object>(),useSmartScreenT:()=> (key:string)=>SMART_SCREEN_LEX[key]?.[0]??key}));
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const n=normalizeDefinition({grammar:1,scope:{markets:["us","hk"],asset:"Equities",unpriced:false},where:{all:[{any:[{f:"chg",op:"gte",v:3},{f:"chg",op:"lte",v:-3}]}]}});if(!n.ok)throw Error("fixture");
const screen={schema:1,id:"a".repeat(32),rev:1,name:"Original OR",def:n.def,hash:n.hash,createdAt:"2026-10-15T00:00:00.000Z",updatedAt:"2026-10-15T00:00:00.000Z",review:null};
const ref:InvestigationEvidenceRef={owner:"terminal.smart_screen",object_type:"screen_definition",object_id:screen.id,mode:"pinned",version_ref:"11111111-1111-4111-8111-111111111111",fingerprint:"b".repeat(64)};
const lookup={found:true,...ref,source_revision:1,record:screen};
let root:Root|undefined,host:HTMLDivElement|undefined;
async function mount(element:React.ReactNode){if(!host){host=document.createElement("div");document.body.append(host);root=createRoot(host);}await act(async()=>root!.render(element));}
async function click(label:string){const b=[...host!.querySelectorAll("button")].find(b=>b.textContent===label);expect(b).toBeTruthy();await act(async()=>b!.click());}
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();host=undefined;root=undefined;vi.unstubAllGlobals();});
describe("retained screen owner consumer",()=>{
 it("adds no reader panel to research without native screen references",async()=>{
  await mount(<InvestigationScreenReader refs={[]} lookups={[]} lang="en"/>);expect(host!.textContent).toBe("");
 });
 it("renders only exact retained A with native OR; a newer current B cannot replace it",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await mount(<InvestigationScreenReader refs={[ref]} lookups={[lookup,{...lookup,version_ref:"22222222-2222-4222-8222-222222222222",record:{...screen,name:"New B",rev:2}}]} lang="en"/>);
  expect(host!.textContent).toContain("Original OR");expect(host!.textContent).toContain("Any of");expect(host!.textContent).toContain("3%");expect(host!.textContent).not.toContain("New B");expect(fetcher).not.toHaveBeenCalled();
 });
 it("refuses missing, duplicate, wrong digest or newer-grammar lookups without fallback",async()=>{
  for(const lookups of [[],[lookup,lookup],[{...lookup,fingerprint:"c".repeat(64)}],[{...lookup,record:{...screen,def:{...screen.def,grammar:2}}}]]){
   await mount(<InvestigationScreenReader refs={[ref]} lookups={lookups} lang="zh"/>);expect(host!.textContent).toContain("暂不可用");expect(host!.textContent).not.toContain("Original OR");
  }
 });
 it("browses without writing and deliberately selects one exact owner revision",async()=>{
  const read=vi.fn(async()=>({screens:[screen],readOnly:[],invalid:0})),change=vi.fn();
  await mount(<InvestigationScreenPicker refs={[]} capture={null} lang="en" disabled={false} read={read} onChange={change} onRemove={vi.fn()}/>);
  expect(read).not.toHaveBeenCalled();await click("Browse my screens");expect(change).not.toHaveBeenCalled();await click("Retain this definition");expect(change).toHaveBeenCalledWith({screen_id:screen.id,expected_revision:1});expect(read).toHaveBeenCalledTimes(1);
 });
 it("keeps selected revision1 when current owner becomes2; only a new selection changes it",async()=>{
  const change=vi.fn(),capture:ScreenCapture={screen_id:screen.id,expected_revision:1};
  await mount(<InvestigationScreenPicker refs={[]} capture={capture} lang="en" disabled={false} read={async()=>({screens:[{...screen,name:"New B",rev:2}],readOnly:[],invalid:0})} onChange={change} onRemove={vi.fn()}/>);
  await click("Browse my screens");expect(host!.querySelector('[data-screen-capture]')!.textContent).toContain("Version 1");expect(change).not.toHaveBeenCalled();await click("Retain this definition");expect(change).toHaveBeenCalledWith({screen_id:screen.id,expected_revision:2});
 });
 it("does not select unreadable records, a duplicate retained id, or while Save owns draft",async()=>{
  const change=vi.fn(),read=async()=>({screens:[screen,{...screen,id:"c".repeat(32),def:{grammar:2}}],readOnly:[],invalid:0});
  await mount(<InvestigationScreenPicker refs={[ref]} capture={null} lang="en" disabled={false} read={read} onChange={change} onRemove={vi.fn()}/>);await click("Browse my screens");await click("Retain this definition");expect(change).not.toHaveBeenCalled();expect(host!.textContent).toContain("cannot be interpreted");
  await mount(<InvestigationScreenPicker refs={[]} capture={null} lang="en" disabled read={read} onChange={change} onRemove={vi.fn()}/>);await click("Retain this definition");expect(change).not.toHaveBeenCalled();
 });
 it("discards a late owner browse after unmount",async()=>{
  let finish!:(value:unknown)=>void;const change=vi.fn();await mount(<InvestigationScreenPicker refs={[]} capture={null} lang="en" disabled={false} read={()=>new Promise(r=>{finish=r;})} onChange={change} onRemove={vi.fn()}/>);await click("Browse my screens");await mount(<div>Other owner</div>);await act(async()=>finish({screens:[screen],readOnly:[],invalid:0}));expect(host!.textContent).toBe("Other owner");expect(change).not.toHaveBeenCalled();
 });
});

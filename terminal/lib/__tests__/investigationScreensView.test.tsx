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
vi.mock("@/lib/fundamentalScanLex",async(importOriginal)=>{const lex=await importOriginal<typeof import("@/lib/fundamentalScanLex")>();return{...lex,useFundT:()=> (key:string)=>lex.FUNDAMENTAL_SCAN_LEX[key]?.[0]??key};});
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const n=normalizeDefinition({grammar:1,scope:{markets:["us","hk"],asset:"Equities",unpriced:false},where:{all:[{any:[{f:"chg",op:"gte",v:3},{f:"chg",op:"lte",v:-3}]}]}});if(!n.ok)throw Error("fixture");
const screen={schema:1,id:"a".repeat(32),rev:1,name:"Original OR",def:n.def,hash:n.hash,createdAt:"2026-10-15T00:00:00.000Z",updatedAt:"2026-10-15T00:00:00.000Z",review:null};
const ref:InvestigationEvidenceRef={owner:"terminal.smart_screen",object_type:"screen_definition",object_id:screen.id,mode:"pinned",version_ref:"11111111-1111-4111-8111-111111111111",fingerprint:"b".repeat(64)};
const lookup={found:true,...ref,source_revision:1,record:screen};
const n2=normalizeDefinition({grammar:2,scope:{markets:"all",asset:"Equities",unpriced:false},where:{all:[]},fund:[{field:"fund.net_margin_fy",op:"range",gte:0.15}]});if(!n2.ok)throw Error("fixture");
const n3=normalizeDefinition({grammar:2,scope:{markets:["us"],asset:null,unpriced:true},where:{all:[{any:[{f:"chg",op:"gte",v:3},{f:"chg",op:"lte",v:-3}]},{f:"verdict",op:"present"}]},fund:[{field:"fund.pe_ttm",op:"unknown"},{field:"fund.roe_fy",op:"range",gte:0.1,includeUnknown:true}]});if(!n3.ok)throw Error("fixture");
const screen2={schema:1,id:"d".repeat(32),rev:3,name:"Net margin",def:n2.def,hash:n2.hash,createdAt:"2026-10-15T00:00:00.000Z",updatedAt:"2026-10-15T00:00:00.000Z",review:null};
const screen3={schema:1,id:"e".repeat(32),rev:1,name:"Margin and move",def:n3.def,hash:n3.hash,createdAt:"2026-10-15T00:00:00.000Z",updatedAt:"2026-10-15T00:00:00.000Z",review:null};
const ref2:InvestigationEvidenceRef={owner:"terminal.smart_screen",object_type:"screen_definition",object_id:screen2.id,mode:"pinned",version_ref:"33333333-3333-4333-8333-333333333333",fingerprint:"b".repeat(64)};
const ref3:InvestigationEvidenceRef={...ref2,object_id:screen3.id,version_ref:"44444444-4444-4444-8444-444444444444"};
const lookup2={found:true,...ref2,source_revision:3,record:screen2};
const lookup3={found:true,...ref3,source_revision:1,record:screen3};
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
 it("shows grammar2 fund conditions in native units; an empty manifest AND no longer claims no conditions",async()=>{
  await mount(<InvestigationScreenReader refs={[ref2]} lookups={[lookup2]} lang="en"/>);
  const text=host!.textContent;
  expect(text).toContain("Net margin");expect(text).toContain("Fundamental conditions");expect(text).toContain("Net mgn FY ≥ 15%");
  expect(text).toContain("All of");expect(text).not.toContain("no conditions");
 });
 it("keeps the manifest AND/OR tree beside native fund conditions, in units and unknown wording",async()=>{
  await mount(<InvestigationScreenReader refs={[ref3]} lookups={[lookup3]} lang="en"/>);
  const text=host!.textContent;
  expect(text).toContain("Conditions");expect(text).toContain("Any of");expect(text).toContain("3%");
  expect(text).toContain("Fundamental conditions");expect(text).toContain("P/E TTM: unknown");expect(text).toContain("ROE FY ≥ 10% + unknown");
 });
 it("still renders a grammar1 screen exactly as before, with no fund section",async()=>{
  await mount(<InvestigationScreenReader refs={[ref]} lookups={[lookup]} lang="en"/>);
  const text=host!.textContent;
  expect(text).toContain("Any of");expect(text).toContain("3%");expect(text).toContain("Conditions");
  expect(text).not.toContain("Fundamental conditions");expect(text).not.toContain("15%");
 });
 it("refuses a grammar2 capture that is not the exact pinned owner version",async()=>{
  for(const lookups of [[{...lookup2,fingerprint:"c".repeat(64)}],[lookup2,lookup2],[{...lookup2,version_ref:"22222222-2222-4222-8222-222222222222"}]]){
   await mount(<InvestigationScreenReader refs={[ref2]} lookups={lookups} lang="en"/>);
   expect(host!.textContent).toContain("unavailable");expect(host!.textContent).not.toContain("Net margin");expect(host!.textContent).not.toContain("15%");
  }
 });
 it("refuses unreadable grammar2 bodies: tampered digest, future grammar, missing or empty fund",async()=>{
  for(const record of [{...screen2,hash:"0".repeat(14)},{...screen2,def:{...screen2.def,grammar:3}},{...screen2,def:{grammar:2}},{...screen2,def:{...screen2.def,fund:[]}}]){
   await mount(<InvestigationScreenReader refs={[ref2]} lookups={[{...lookup2,record}]} lang="en"/>);
   expect(host!.textContent).toContain("unavailable");expect(host!.textContent).not.toContain("Net margin");expect(host!.textContent).not.toContain("15%");
  }
 });
 it("browses and retains one exact grammar2 owner revision with its native conditions shown",async()=>{
  const read=vi.fn(async()=>({screens:[screen2],readOnly:[],invalid:0})),change=vi.fn();
  await mount(<InvestigationScreenPicker refs={[]} capture={null} lang="en" disabled={false} read={read} onChange={change} onRemove={vi.fn()}/>);
  await click("Browse my screens");expect(host!.textContent).toContain("Net mgn FY ≥ 15%");expect(host!.textContent).not.toContain("no conditions");
  await click("Retain this definition");expect(change).toHaveBeenCalledWith({screen_id:screen2.id,expected_revision:3});
 });
 it("lists readable grammar2 beside unreadable grammar records and refuses only the unreadable",async()=>{
  const read=vi.fn(async()=>({screens:[screen2,{...screen,id:"f".repeat(32),def:{grammar:3}}],readOnly:[],invalid:0})),change=vi.fn();
  await mount(<InvestigationScreenPicker refs={[]} capture={null} lang="en" disabled={false} read={read} onChange={change} onRemove={vi.fn()}/>);
  await click("Browse my screens");expect(host!.textContent).toContain("cannot be interpreted");expect(host!.textContent).toContain("Net mgn FY ≥ 15%");
  await click("Retain this definition");expect(change).toHaveBeenCalledWith({screen_id:screen2.id,expected_revision:3});expect(read).toHaveBeenCalledTimes(1);
 });
 it("shows manifest and fundamental constraints under one explicit conjunction",async()=>{
  await mount(<InvestigationScreenReader refs={[ref3]} lookups={[lookup3]} lang="en"/>);
  const all=[...host!.querySelectorAll("li")].filter(li=>li.firstChild?.textContent==="All of");
  expect(all.some(li=>li.textContent?.includes("Any of")&&li.textContent.includes("P/E TTM: unknown")&&li.textContent.includes("ROE FY ≥ 10% + unknown"))).toBe(true);
 });

});

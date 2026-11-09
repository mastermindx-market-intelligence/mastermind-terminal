// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {InvestigationThesisPicker,InvestigationThesisReader} from "@/components/workspaces/InvestigationTheses";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="10000000-0000-4000-8000-000000000001",tid="20000000-0000-4000-8000-000000000001",vid="30000000-0000-4000-8000-000000000001";
const ref={thesis_id:tid,version_id:vid,role:"primary" as const};
const version={id:vid,thesisId:tid,version:1,lifecycleState:"active",systemRecordedAt:"2026-10-04T00:00:00Z",content:{title:"Apple belief",statement:"Retained version one",catalysts:["Growth"],falsifiers:["Contraction"],risks:["Supply"],horizon:"quarters"},subject:{display:"Apple"}};
let root:Root|undefined,host:HTMLDivElement|undefined;
async function mount(element:React.ReactNode){if(!host){host=document.createElement("div");document.body.append(host);root=createRoot(host);}await act(async()=>root!.render(element));}
async function click(text:string){const button=[...host!.querySelectorAll("button")].find(b=>b.textContent===text);expect(button).toBeTruthy();await act(async()=>button!.click());}
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();root=undefined;host=undefined;vi.unstubAllGlobals();});
describe("canonical Thesis reference UI",()=>{
 it("browses and reads without writing; retains only on explicit selection",async()=>{
  const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes("?id=")?{thesis:{id:tid,current:version,history:[version],historyTruncated:false}}:{theses:[{id:tid,title:"Apple belief",currentVersion:1}],truncated:false}}));vi.stubGlobal("fetch",fetcher);const change=vi.fn();
  await mount(<InvestigationThesisPicker refs={[]} lang="en" disabled={false} onChange={change}/>);expect(fetcher).not.toHaveBeenCalled();await click("Browse my Theses");await click("Apple belief · Version 1");expect(change).not.toHaveBeenCalled();await click("Retain selected version");expect(change).toHaveBeenCalledTimes(1);expect(change).toHaveBeenCalledWith([ref]);expect(fetcher.mock.calls.every(call=>(call as unknown[])[1]!==undefined)).toBe(true);
 });
 it("discards an outstanding picker response after unmount",async()=>{
  let finish!:(v:unknown)=>void,signal!:AbortSignal;vi.stubGlobal("fetch",vi.fn((_url,options)=>{signal=options.signal;return new Promise(r=>finish=r);}));const change=vi.fn();await mount(<InvestigationThesisPicker refs={[]} lang="en" disabled={false} onChange={change}/>);await click("Browse my Theses");await mount(<div>Other account</div>);expect(signal.aborted).toBe(true);await act(async()=>finish({ok:true,json:async()=>({theses:[],truncated:false})}));expect(change).not.toHaveBeenCalled();
 });
 it("does not attach a selection while Save owns the draft",async()=>{
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes("?id=")?{thesis:{id:tid,current:version,history:[version]}}:{theses:[{id:tid,title:"Apple belief",currentVersion:1}]}})));const change=vi.fn();await mount(<InvestigationThesisPicker refs={[]} lang="en" disabled={false} onChange={change}/>);await click("Browse my Theses");await click("Apple belief · Version 1");await mount(<InvestigationThesisPicker refs={[]} lang="en" disabled onChange={change}/>);await click("Retain selected version");expect(change).not.toHaveBeenCalled();
 });
 it("reads exact saved refs only on request and clears content on failure",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({status:"resolved",id,revision:1,items:[{ref,status:"available",version}]})}).mockResolvedValueOnce({ok:false,json:async()=>({status:"unavailable"})});vi.stubGlobal("fetch",fetcher);await mount(<InvestigationThesisReader id={id} revision={1} refs={[ref]} lang="en"/>);expect(fetcher).not.toHaveBeenCalled();await click("Open retained Theses");expect(host!.textContent).toContain("Retained version one");expect(host!.textContent).toContain("Contraction");await click("Open retained Theses");expect(host!.textContent).not.toContain("Retained version one");expect(host!.textContent).toContain("unavailable");expect(fetcher.mock.calls[0][0]).toBe(`/api/investigations/theses?id=${id}&revision=1`);
 });
 it("refuses a wrong version response and names the limitation in Chinese",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({status:"resolved",id,revision:1,items:[{ref,status:"available",version:{...version,id:tid}}]})})));await mount(<InvestigationThesisReader id={id} revision={1} refs={[ref]} lang="zh"/>);await click("打开保留论点");expect(host!.textContent).not.toContain("Retained version one");expect(host!.textContent).toContain("暂不可用");
 });
});

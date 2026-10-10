// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import InvestigationReplay from "@/components/workspaces/InvestigationReplay";
import fixture from "./fixtures/aapl-event-workspace.json";
import {normalizeEventWorkspace} from "../eventWorkspace";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="10000000-0000-4000-8000-000000000001",fingerprint="a".repeat(64),generation=fixture.generation_id,cutoff="2026-08-01T00:00:00Z";
const result={status:"replayed",ok:true,id,revision:1,root_fingerprint:fingerprint,workspace:normalizeEventWorkspace(fixture),receipt:{generation_id:generation,fingerprint:"b".repeat(64),generation_emitted_at:fixture.generated_at,public_known_at:fixture.lifecycle.source_available_at,platform_known_at:fixture.lifecycle.observed_at},replay:{schema:"earnings.platform_snapshot_replay.v1",policy:"platform_snapshot",cutoff,root_generation_id:generation,selected_generation_id:generation,scope:"retained_chain_through_saved_baseline",public_known_replay:false,user_seen_replay:false}};
let root:Root|undefined,host:HTMLDivElement|undefined;
async function mount(owner="one",lang:"en"|"zh"="en"){
 if(!host){host=document.createElement("div");document.body.append(host);root=createRoot(host);}
 await act(async()=>{root!.render(<InvestigationReplay key={owner} id={id} revision={1} fingerprint={fingerprint} generation={generation} initialCutoff={cutoff} lang={lang}/>);});
}
async function open(){await act(async()=>{host!.querySelector("button")!.click();});}
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();root=undefined;host=undefined;vi.unstubAllGlobals();});
describe("retained snapshot inspection is explicit and read-only",()=>{
 it("does not request replay on open; explicit inspection makes one GET and shows owner-presented data",async()=>{
  const fetcher=vi.fn(async(_url:string,_options?:RequestInit)=>({ok:true,json:async()=>result}));vi.stubGlobal("fetch",fetcher);await mount();expect(fetcher).not.toHaveBeenCalled();await open();expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toContain("/api/investigations/replay?");expect(fetcher.mock.calls[0][1]).toMatchObject({cache:"no-store"});expect(fetcher.mock.calls[0][1]?.method??"GET").toBe("GET");expect(host!.textContent).toContain("Snapshot facts");expect(host!.textContent).toContain("Apple");expect(host!.textContent).not.toContain("analyst role is empty");
 });
 it("clears the previous result after unavailable history",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>result}).mockResolvedValueOnce({ok:false,json:async()=>({reason:"missing_history"})}));await mount();await open();expect(host!.textContent).toContain("Snapshot facts");await open();expect(host!.textContent).not.toContain("Snapshot facts");expect(host!.textContent).toContain("retained history is unavailable");
 });
 it("rejects a response for another saved baseline or requested cutoff",async()=>{
  for(const value of [{...result,root_fingerprint:"c".repeat(64)},{...result,replay:{...result.replay,cutoff:"2026-08-02T00:00:00Z"}}]){vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>value})));await mount();await open();expect(host!.textContent).not.toContain("Snapshot facts");}
 });
 it("aborts and discards a late response after the principal changes",async()=>{
  let finish!:(value:unknown)=>void,signal!:AbortSignal;vi.stubGlobal("fetch",vi.fn((_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}));await mount();await open();await mount("two");expect(signal.aborted).toBe(true);await act(async()=>finish({ok:true,json:async()=>result}));expect(host!.textContent).not.toContain("Snapshot facts");
 });
 it("states the public-known limitation in both languages",async()=>{
  await mount();expect(host!.textContent).toContain("does not establish what was publicly known");await mount("zh","zh");expect(host!.textContent).toContain("不能证明当时公众已知");
 });
});

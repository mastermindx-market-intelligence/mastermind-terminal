// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {AuthChangeEvent,Session} from "@supabase/supabase-js";
import SavedScenarioRead,{type SavedScenarioResolveGuard} from "@/components/research/SavedScenarioRead";
import {subscribeAuthLifecycle,type AuthLifecycleSubscription} from "@/lib/supabase/authLifecycle";
import {localScenarioValue,type ScenarioBasis} from "@/lib/exposureScenario";
import {scenarioNativePacket} from "./fixtures/scenarioNativePacket";
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const principal="10000000-0000-4000-8000-000000000001",id="20000000-0000-4000-8000-000000000002";
const {capture}=scenarioNativePacket();
const basis:ScenarioBasis={root:"SPY",session:"2026-10-15",referenceSpot:100,gexMn:100,vexMn:null,cexMn:null,emPct:null,qualification:"qualified",sourceRef:null};
const computed=localScenarioValue(basis,capture.inputs);if(!computed.ok)throw Error("invalid controlled basis");
const good={status:"resolved",investigation_id:id,revision:2,grant_id:null,capture,basis,result:computed};
let element:HTMLDivElement,root:Root,binding:AuthLifecycleSubscription,emit:(event:AuthChangeEvent,session:Session|null)=>void;
const fetcher=vi.fn();
function session():Session {const claims=btoa(JSON.stringify({sub:principal,session_id:"synthetic-session",aal:"aal1"})).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");return {access_token:`synthetic.${claims}.signature`,user:{id:principal}} as Session;}
async function flush(){await act(async()=>{await Promise.resolve();await Promise.resolve();});}
async function mount(guard:SavedScenarioResolveGuard){await act(async()=>root.render(<SavedScenarioRead capture={capture} lang="en" revision={{id,revision:2,grantId:null}} identity={{kind:"account",userId:principal,email:"fixture@test"}} resolveGuard={guard}/>));}
async function click(){await act(async()=>{element.querySelector<HTMLButtonElement>('button[aria-label="Resolve saved scenario"]')!.click();});}
beforeEach(async()=>{
 vi.useFakeTimers();fetcher.mockReset();vi.stubGlobal("fetch",fetcher);
 element=document.createElement("div");document.body.append(element);root=createRoot(element);
 binding=subscribeAuthLifecycle(()=>{},()=>({onAuthStateChange(callback){emit=callback;return {data:{subscription:{unsubscribe(){}}}};},getClaims:async()=>({data:{claims:{sub:principal,session_id:"synthetic-session",aal:"aal1"}},error:null})}));
 emit("SIGNED_IN",session());await act(async()=>{await vi.runAllTimersAsync();});expect(binding.getSnapshot().availability).toBe("ready");
});
afterEach(async()=>{binding.unsubscribe();await act(async()=>root.unmount());element.remove();vi.unstubAllGlobals();vi.useRealTimers();});
const guard=():SavedScenarioResolveGuard=>({getSnapshot:binding.getSnapshot,isCurrent:()=>true});
it.each(["USER_UPDATED","PASSWORD_RECOVERY","SIGNED_OUT"] as const)("refuses a stale rendered click after synchronous %s before any notification",async event=>{
 await mount(guard());emit(event,event==="SIGNED_OUT"?null:session());await click();expect(fetcher).not.toHaveBeenCalled();
});
it.each(["success","error"])("does not paint a late %s after same-user epoch invalidation without rerender",async kind=>{
 let settle!:(v:unknown)=>void;fetcher.mockReturnValue(new Promise(resolve=>{settle=resolve;}));await mount(guard());await click();expect(fetcher).toHaveBeenCalledTimes(1);
 emit("USER_UPDATED",session());settle({ok:kind==="success",json:async()=>kind==="success"?good:{status:"unavailable",reason:"source_binding_unavailable"}});await flush();
 expect(element.querySelector('[data-testid="scenario-resolution"]')?.getAttribute("data-state")).toBe("resolving");
 expect(element.textContent).not.toContain("Resolved for this exact revision");expect(element.textContent).not.toContain("could not be resolved");
});
it("keeps a verified same-token same-epoch replay eligible for the original response",async()=>{
 let settle!:(v:unknown)=>void;fetcher.mockReturnValue(new Promise(resolve=>{settle=resolve;}));await mount(guard());await click();const epoch=binding.getSnapshot().auth_epoch;
 emit("TOKEN_REFRESHED",session());expect(binding.getSnapshot().auth_epoch).toBe(epoch);
 settle({ok:true,json:async()=>good});await flush();expect(element.querySelector('[data-testid="scenario-resolution"]')?.getAttribute("data-state")).toBe("resolved");
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({investigation_id:id,revision:2,grant_id:null});
});
it.each(["host-ticket","cleanup"])("rejects a late response after %s ends the original lifetime",async kind=>{
 let current=true,settle!:(v:unknown)=>void;fetcher.mockReturnValue(new Promise(resolve=>{settle=resolve;}));await mount({...guard(),isCurrent:()=>current});await click();
 if(kind==="cleanup")binding.unsubscribe();else current=false;
 settle({ok:true,json:async()=>good});await flush();expect(element.querySelector('[data-testid="scenario-resolution"]')?.getAttribute("data-state")).toBe("resolving");
});

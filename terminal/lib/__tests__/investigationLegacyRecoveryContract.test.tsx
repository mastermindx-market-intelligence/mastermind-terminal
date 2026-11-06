// @vitest-environment jsdom
// Client recovery contract with controlled current-owner observations only.
// No BFF/SQL/issuer/provider/browser execution and no product-realm OPEN override.
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import SavedScenarioCapture from "@/components/research/SavedScenarioCapture";
import {beginInvestigationSave,recoverInvestigationSave,settleInvestigationSave,settleInvestigationOperationRead} from "@/lib/investigationSave";
import {owner,principal,command,bound,native,fence} from "./investigationNativeRecovery.fixture";

const identity=vi.hoisted(()=>({userId:"10000000-0000-4000-8000-000000000001",lang:"en" as "en"|"zh"}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:identity.lang})}));
vi.mock("@/lib/useInvestigationTheme",()=>({useInvestigationTheme:()=>"dark"}));
vi.mock("@/components/chrome/AppShell",()=>({useShellIdentity:()=>({kind:"account",userId:identity.userId,email:"controlled@test.invalid"})}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
vi.mock("@/lib/supabase/investigationAuthOwner",()=>({subscribeInvestigationAuthOwner:(publish:(snapshot:unknown)=>void)=>{
 const snapshot={availability:"ready",principal_partition:`account:${identity.userId}`,auth_epoch:"controlled-fresh-reader"};let active=true;
 publish(snapshot);return{getSnapshot:()=>active?snapshot:null,unsubscribe(){active=false;}};
}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const key=`mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
const fetcher=vi.fn();let host:HTMLDivElement,root:Root;
const response=(body:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status}));
const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(value=>value.textContent===text);
async function mount(currentOwner=owner){await act(async()=>{root.render(<InvestigationWorkspace ownerKey={currentOwner}/>);await flush();});}
async function click(text:string){expect(button(text)).toBeDefined();await act(async()=>{button(text)!.click();await flush();});}
const writes=()=>fetcher.mock.calls.filter(([url,init])=>url==="/api/investigations"&&["POST","PUT"].includes(init?.method));
function assertNativeUnresolved(observedNative=true,surface:"workspace"|"standalone"="workspace"){
 if(observedNative){
  expect(host.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain(identity.lang==="en"?"not confirmed finished":"尚未确认结束");
 }else{
  expect(host.textContent).toContain(identity.lang==="en"?"The private source capture outcome is still unknown.":"私有来源捕获结果仍未知");
 }
 expect(button("Try save again")).toBeUndefined();expect(button("Retry original save")).toBeUndefined();
 if(surface==="workspace")expect(button(identity.lang==="en"?"Start new research":"开始新研究")?.disabled).toBe(true);
 else expect(button(identity.lang==="en"?"Start a new scenario draft":"开始新方案草稿")).toBeUndefined();
 expect(button(identity.lang==="en"?"Retry checked save":"重试已核验保存")).toBeUndefined();
 expect(JSON.parse(sessionStorage.getItem(key)!).command).toEqual(command);
}
beforeEach(()=>{
 identity.userId=principal;identity.lang="en";sessionStorage.clear();fetcher.mockReset();
 vi.stubGlobal("React",React);vi.stubGlobal("fetch",fetcher);host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
function metadata(url:string){return response(url==="/api/layouts"?{layouts:[]}:{status:"listed",items:[]});}

it("forged local not_applied cannot settle unfinished native capture, including after reload",async()=>{
 sessionStorage.setItem(key,JSON.stringify({owner,command,phase:"rejected",reason:"not_applied"}));
 fetcher.mockImplementation((url:string)=>url==="/api/investigations/operation-read"?response(bound(native("started","not_applied"))):metadata(url));
 await mount();assertNativeUnresolved();
 const first=fetcher.mock.calls.filter(([url])=>url==="/api/investigations/operation-read");
 expect(first).toHaveLength(1);expect(JSON.parse(first[0][1].body)).toEqual(command);
 expect(first[0][1].headers["x-mm-scenario-owner"]).toBe(principal);
 expect(host.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain("not confirmed finished");
 expect(host.querySelector('[data-testid="native-operation-facts"]')?.textContent).toContain("save not applied");
 expect(writes()).toHaveLength(0);
 const originalCommand=JSON.parse(sessionStorage.getItem(key)!).command;
 await act(async()=>root.unmount());root=createRoot(host);await mount();assertNativeUnresolved();
 expect(fetcher.mock.calls.filter(([url])=>url==="/api/investigations/operation-read")).toHaveLength(2);
 expect(JSON.parse(sessionStorage.getItem(key)!).command).toEqual(originalCommand);expect(writes()).toHaveLength(0);
});

const surfaces=["workspace","standalone"] as const;
async function mountSurface(surface:typeof surfaces[number]){
 const capture=command.manifest.scenario_capture!;
 await act(async()=>{root.render(surface==="workspace"?<InvestigationWorkspace ownerKey={owner}/>:<SavedScenarioCapture inputs={capture.inputs} sourceReference={capture.source} lang={identity.lang}/>);await flush();});
}
it.each(surfaces.flatMap(surface=>(["en","zh"] as const).map(lang=>[surface,lang] as const)))("current full-command canonical no-effect is factual while native stays UNKNOWN (%s/%s)",async(surface,lang)=>{
 identity.lang=lang;
 sessionStorage.setItem(key,JSON.stringify({owner,command,phase:"rejected",reason:"invalid_payload"}));
 fetcher.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.startsWith("/api/investigations?operation_id="))return response({status:"not_found"},404);
  if(url==="/api/investigations"&&init?.method==="PUT")return response(fence);
  if(url==="/api/investigations/operation-read")return response(bound(native("started","not_applied")));
  return metadata(url);
 });
 await mountSurface(surface);assertNativeUnresolved(false,surface);expect(writes()).toHaveLength(0);
 await click(lang==="en"?"Check original outcome":"检查原请求结果");assertNativeUnresolved(false,surface);
 expect(writes()).toHaveLength(1);expect(writes()[0][1].method).toBe("PUT");expect(JSON.parse(writes()[0][1].body)).toEqual(command);
 expect(host.textContent).toContain(lang==="en"?"The canonical save was recorded as not applied.":"规范保存已记录为未执行");
 expect(host.textContent).not.toContain(lang==="en"?"Canonical save was rejected.":"规范保存被拒绝");
 const retained=JSON.parse(sessionStorage.getItem(key)!);expect(retained.command).toEqual(command);expect(retained.capture_outcome).toBeDefined();
 await act(async()=>root.unmount());root=createRoot(host);await mountSurface(surface);
 if(surface==="standalone")await click(lang==="en"?"Check original outcome":"检查原请求结果");
 assertNativeUnresolved(true,surface);
 expect(writes()).toHaveLength(1);expect(fetcher.mock.calls.filter(([url])=>url==="/api/investigations/operation-read")).toHaveLength(1);
});

it.each(surfaces.flatMap(surface=>(["en","zh"] as const).map(lang=>[surface,lang] as const)))("retained-local-only marker supplies no current canonical phase (%s/%s)",async(surface,lang)=>{
 identity.lang=lang;
 sessionStorage.setItem(key,JSON.stringify({owner,command,phase:"rejected",reason:"not_applied",capture_outcome:"unknown_after_canonical_not_applied"}));
 fetcher.mockImplementation((url:string)=>url==="/api/investigations/operation-read"?response({status:"unavailable"},503):metadata(url));
 await mountSurface(surface);
 if(surface==="standalone")await click(lang==="en"?"Check original outcome":"检查原请求结果");
 expect(fetcher.mock.calls.filter(([url])=>url==="/api/investigations/operation-read")).toHaveLength(1);
 expect(JSON.parse(fetcher.mock.calls.find(([url])=>url==="/api/investigations/operation-read")![1].body)).toEqual(command);
 expect(host.textContent).toContain(lang==="en"?"The private source capture outcome is still unknown.":"私有来源捕获结果仍未知");
 expect(host.textContent).not.toContain(lang==="en"?"recorded as not applied":"已记录为未执行");
 expect(host.textContent).not.toContain(lang==="en"?"Canonical save was rejected.":"规范保存被拒绝");
 expect(host.querySelector('[data-testid="native-operation-facts"]')).toBeNull();
 expect(JSON.parse(sessionStorage.getItem(key)!).command).toEqual(command);expect(writes()).toHaveLength(0);
 if(surface==="workspace")expect(button(lang==="en"?"Start new research":"开始新研究")?.disabled).toBe(true);
 else expect(button(lang==="en"?"Start a new scenario draft":"开始新方案草稿")).toBeUndefined();
 expect(button(lang==="en"?"Retry checked save":"重试已核验保存")).toBeUndefined();expect(button("Try save again")).toBeUndefined();
});

it("late legacy full-command reply cannot fence or clear an old owner after a new owner mounts",async()=>{
 const stored=JSON.stringify({owner,command,phase:"rejected",reason:"invalid_payload"});sessionStorage.setItem(key,stored);
 let finish!:(value:Response)=>void;let originalSignal:AbortSignal|undefined;const parsed=vi.fn(async()=>fence);
 fetcher.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.startsWith("/api/investigations?operation_id="))return response({status:"not_found"},404);
  if(url==="/api/investigations"&&init?.method==="PUT"){
   originalSignal=init.signal as AbortSignal;return new Promise<Response>(resolve=>{finish=resolve;});
  }
  return metadata(url);
 });
 await mount();await click("Check original outcome");expect(writes()).toHaveLength(1);
 const retainedBeforeOwnerChange=sessionStorage.getItem(key);
 expect(JSON.parse(retainedBeforeOwnerChange!).command).toEqual(command);
 expect(JSON.parse(retainedBeforeOwnerChange!).owner_recheck).toBe(true);
 identity.userId="60000000-0000-4000-8000-000000000006";await mount(`account:${identity.userId}`);
 expect(originalSignal?.aborted).toBe(true);
 await act(async()=>{finish({status:200,json:parsed} as unknown as Response);await flush();});
 expect(parsed).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe(retainedBeforeOwnerChange);
 expect(host.querySelector('[data-testid="native-operation-facts"]')).toBeNull();expect(host.textContent).not.toContain(command.manifest.intent.question);
 expect(writes()).toHaveLength(1);expect(writes()[0][1].method).toBe("PUT");
});

it("only a matching current canonical reply supplies a no-effect fact; local, foreign and cap markers cannot",()=>{
 const pending=beginInvestigationSave(owner,command,{phase:"idle"});
 const observed=settleInvestigationSave(pending,owner,fence);
 expect(observed).toMatchObject({phase:"uncertain",captureOutcome:"unknown_after_canonical_not_applied",canonicalRefusal:"not_applied"});
 const read=settleInvestigationOperationRead(pending,owner,{...fence,read_principal:principal,read_operation_id:command.operation_id,read_binding:"stored_no_effect"});
 expect(read).toMatchObject({phase:"uncertain",captureOutcome:"unknown_after_canonical_not_applied",canonicalRefusal:"not_applied"});
 const foreignRead=settleInvestigationOperationRead(pending,owner,{...fence,read_principal:command.id,read_operation_id:command.operation_id,read_binding:"stored_no_effect"});
 expect(foreignRead.phase).toBe("uncertain");expect(foreignRead).not.toHaveProperty("canonicalRefusal");
 const cap=settleInvestigationSave(pending,owner,{...fence,reason:"limit_reached"});
 expect(cap).toMatchObject({phase:"uncertain",canonicalRefusal:"limit_reached"});
 const foreign=settleInvestigationSave(pending,owner,{...fence,operation_id:command.id});
 expect(foreign.phase).toBe("uncertain");expect(foreign).not.toHaveProperty("canonicalRefusal");
 const local=recoverInvestigationSave(owner,{owner,command,capture_outcome:"unknown_after_canonical_not_applied",canonicalRefusal:"not_applied",phase:"rejected",reason:"not_applied"});
 expect(local).toMatchObject({phase:"uncertain",captureOutcome:"unknown_after_canonical_not_applied"});
 expect(local).not.toHaveProperty("canonicalRefusal");expect(local).not.toHaveProperty("nativeObservation");
});

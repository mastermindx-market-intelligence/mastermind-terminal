// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {Session} from "@supabase/supabase-js";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import {useInvestigationAuthLifecycle,type InvestigationAuthProjection} from "@/components/workspaces/InvestigationAuthContext";
import {normalizeEventWorkspace} from "../eventWorkspace";
import fixture from "./fixtures/aapl-event-workspace.json";
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
// The real subscribeInvestigationAuthOwner, authLifecycle and context stay in force. Only the SDK
// surface the owner binds is synthetic: a synchronous onAuthStateChange callback with a deferred,
// separately settled getClaims, exactly like the supplied original binding tests. Never an
// always-ready mock, never an epoch minted at this consumer. Nonsecret synthetic fixtures only.
const auth=vi.hoisted(()=>({change:null as null|((event:string,session:{access_token:string;user?:{id:string}}|null)=>void),checks:[] as ((value:unknown)=>void)[]}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{onAuthStateChange:(callback:(event:string,session:{access_token:string;user?:{id:string}}|null)=>void)=>{auth.change=callback;return {data:{subscription:{unsubscribe:()=>{auth.change=null;}}}};},getClaims:()=>new Promise<unknown>(resolve=>{auth.checks.push(resolve);})}})}));
// The review child stays real for the six original journeys. The bounded switch below only exposes
// the unchanged onSelect callback for the new Workspace-only boundary tests; the auth owner is never
// hidden behind it.
const reviewHarness=vi.hoisted(()=>({render:null as null|((props:{onSelect:(receipt:unknown,reference?:unknown)=>void})=>React.ReactElement)}));
vi.mock("@/components/workspaces/InvestigationEvidenceReview",async(importOriginal)=>{
 const actual=await importOriginal<{default:React.ComponentType<Record<string,unknown>>}>();
 return {default:(props:Record<string,unknown>)=>reviewHarness.render?reviewHarness.render(props as unknown as {onSelect:(receipt:unknown,reference?:unknown)=>void}):React.createElement(actual.default,props)};
});
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="10000000-0000-4000-8000-000000000001",oldHash="a".repeat(64),newHash="b".repeat(64);
const reference={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:fixture.event_id,mode:"pinned",version_ref:fixture.generation_id,fingerprint:oldHash};
const manifest={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Retained question",question:"Keep the saved version",subjects:[{kind:"security",owner:"terminal.analysis_symbol",object_id:"AAPL"},{kind:"issuer",owner:"data_os.security_master",object_id:fixture.issuer.company_id}]},layout_refs:[],thesis_refs:[],evidence_refs:[reference],continuation:{},review_baseline_ref:reference};
const old={ok:true,workspace:normalizeEventWorkspace(fixture),reference,receipt:{fingerprint:oldHash,generation_id:fixture.generation_id,event_id:fixture.event_id,company_id:fixture.issuer.company_id,rights:{checked_at:"2026-10-04T00:00:00Z"}}};
const next={...old,reference:{...reference,version_ref:"b".repeat(24),fingerprint:newHash},receipt:{...old.receipt,generation_id:"b".repeat(24),fingerprint:newHash}};
let root:Root,host:HTMLDivElement,completeSelection:(value:unknown)=>void,completeSave:(value:unknown)=>void,unmounted=false;
let captured:InvestigationAuthProjection|null=null;
const selectionCompleters:Array<(value:unknown)=>void>=[];
const selectionRejecters:Array<(error:Error)=>void>=[];
const commands:Array<{id:string;operation_id:string;action:string;manifest:typeof manifest}>=[];
const response=(json:unknown)=>({ok:true,json:async()=>json});
// The synthetic owner is "account-A" (the Workspace already keys owners on this nonsecret value);
// the retained-key literal is the Workspace's own storageKey("account-A").
const claimsOf=(principal="account-A",sessionId="session-A")=>({data:{claims:{sub:principal,session_id:sessionId,aal:"aal1"}},error:null});
function syntheticSession(principal="account-A",sessionId="session-A",extraClaim=false):Session {
 const payload=btoa(JSON.stringify({sub:principal,session_id:sessionId,aal:"aal1",...(extraClaim?{amr:["pwd"]}:{})})).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
 return {access_token:`synthetic.${payload}.signature`,user:{id:principal}} as unknown as Session;
}
const sessionA=syntheticSession();
const storageKeyOf=(owner="account-A")=>`mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
const sleep=(ms=20)=>new Promise<void>(resolve=>{setTimeout(resolve,ms);});
function BoundaryReview(props:{onSelect:(receipt:unknown,reference?:unknown)=>void}){
 const projection=useInvestigationAuthLifecycle();
 React.useLayoutEffect(()=>{captured=projection;},[projection]);
 return <button onClick={()=>props.onSelect(next.receipt,next.reference)}>Boundary select</button>;
}
async function click(text:string){const button=[...host.querySelectorAll("button")].find(b=>b.textContent===text);expect(button,`missing button ${text}`).toBeDefined();await act(async()=>{button!.click();});}
async function renderWorkspace(owner="account-A",revision=1){await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner} initialInvestigationId={id} initialRevision={revision}/>);});}
async function verifyReady(){
 await act(async()=>{auth.change!("SIGNED_IN",sessionA);await sleep();});
 expect(auth.checks.length,"the frozen owner deferred its own getClaims check").toBe(1);
 await act(async()=>{auth.checks.shift()!(claimsOf());await sleep();});
}
async function expectReadyProjection(){expect(captured,"the bounded child reads the Workspace provider").not.toBeNull();expect(captured!.snapshot.availability).toBe("ready");}
async function mount(owner="account-A"){await renderWorkspace(owner);await verifyReady();await click("Review current evidence");await click("Use this reviewed version in an edit");}
async function mountWorkspace(verified=true){reviewHarness.render=(props)=><BoundaryReview {...props}/>;await renderWorkspace("account-A");if(verified)await verifyReady();else await act(async()=>{await sleep();});}
beforeEach(()=>{
 vi.stubGlobal("React",React);sessionStorage.clear();commands.length=0;selectionCompleters.length=0;selectionRejecters.length=0;auth.checks.length=0;auth.change=null;reviewHarness.render=null;captured=null;unmounted=false;
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 vi.stubGlobal("fetch",vi.fn((url:string,options?:RequestInit)=>{
  if(options?.method==="POST"){commands.push(JSON.parse(String(options.body)));return new Promise(resolve=>{completeSave=resolve;});}
  if(url.startsWith("/api/investigations/baseline?")){
   if(url.includes(newHash)){const promise=new Promise<Response>((resolve,reject)=>{selectionRejecters.push(reject);const settle=(value:unknown)=>{resolve(value as Response);};completeSelection=settle;selectionCompleters.push(settle);});return promise;}
   return Promise.resolve(response(old));
  }
  if(url.startsWith("/api/investigations/review?"))return Promise.resolve(response({status:"reviewed",id,revision:1,baseline:old.receipt,current:next.receipt,review:{schema:"investigation.evidence_review.v1",items:[]}}));
  if(url.startsWith("/api/investigations?"))return Promise.resolve(response({status:"found",id,revision:1,current_revision:1,lifecycle:"active",manifest,committed_at:"2026-10-04T00:00:00Z",layouts:[]}));
  return Promise.resolve(response(url==="/api/layouts"?{layouts:[]}:{status:"listed",items:[]}));
 }));
});
afterEach(()=>{if(!unmounted)act(()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("reviewed baseline selection is atomic with entering edit",()=>{
 it("a remove started during exact reopen cancels selection and preserves the old baseline even after rejection",async()=>{
  await mount();await click("Remove from saved research");expect(commands).toHaveLength(1);expect(commands[0].manifest.review_baseline_ref.fingerprint).toBe(oldHash);
  await act(async()=>{completeSelection(response(next));});expect(host.querySelector("form")).toBeNull();expect(host.textContent).not.toContain(newHash);
  await act(async()=>{completeSave(response({status:"version_conflict",current_revision:2}));});await click("Edit saved question");await click("Save research");expect(commands).toHaveLength(2);expect(commands[1].manifest.review_baseline_ref.fingerprint).toBe(oldHash);
 });
 it("editing the saved version cancels a pending selection without leaving Save stuck in loading",async()=>{
  await mount();await click("Edit saved question");await act(async()=>{completeSelection(response(next));});
  const save=[...host.querySelectorAll("button")].find(b=>b.textContent==="Save research")!;expect(save.disabled).toBe(false);expect(host.textContent).not.toContain(newHash);
 });
 it("a storage failure during Remove cannot later install the reviewed evidence",async()=>{
  await mount();vi.stubGlobal("sessionStorage",{getItem:()=>null,removeItem:vi.fn(),clear:vi.fn(),setItem:()=>{throw Error("blocked storage");}});await click("Remove from saved research");await act(async()=>{completeSelection(response(next));});
  expect(commands).toHaveLength(0);expect(host.textContent).not.toContain(newHash);expect(host.querySelector("form")).toBeNull();
 });
 it("ending the authenticated session prevents the pending exact read from restoring evidence",async()=>{
  await mount("account-A");await act(async()=>{auth.change!("SIGNED_OUT",null);completeSelection(response(next));});
  expect(host.textContent).toContain("Your account changed or your session ended");expect(host.textContent).not.toContain(newHash);expect(host.textContent).not.toContain("Retained question");expect(commands).toHaveLength(0);
 });
});


it("a late original failure cannot reject a new save admitted after the owner fence",async()=>{
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;
 let completeFence!:(value:unknown)=>void;
 vi.mocked(fetch).mockImplementation((...args)=>{
  if(args[1]?.method==="PUT")return new Promise<Response>(resolve=>{completeFence=value=>resolve(value as Response);});
  return originalFetch(...args);
 });
 await mount();await click("Remove from saved research");
 const completeOriginal=completeSave,original=commands[0];
 await click("Check original outcome");
 await act(async()=>{completeFence(response({status:"not_applied",id:original.id,operation_id:original.operation_id}));});
 await click("Try save again");
 expect(commands).toHaveLength(2);expect(commands[1].operation_id).not.toBe(original.operation_id);
 // The old request finished without effect before the fence, but its response
 // was delayed in transport until the independently admitted new request began.
 await act(async()=>{completeOriginal(response({status:"reference_unavailable"}));});
 const start=[...host.querySelectorAll("button")].find(b=>b.textContent==="Start new research")!;
 expect(start.disabled).toBe(true);
 expect(host.textContent).toContain("The save outcome is not confirmed");
 expect(host.textContent).not.toContain("The save was not committed");
});

it("a fenced retry is not sent unless the new exact operation is retained",async()=>{
 const originalFetch=vi.mocked(fetch).getMockImplementation()!;
 let completeFence!:(value:unknown)=>void;
 vi.mocked(fetch).mockImplementation((...args)=>{
  if(args[1]?.method==="PUT")return new Promise<Response>(resolve=>{completeFence=value=>resolve(value as Response);});
  return originalFetch(...args);
 });
 await mount();await click("Remove from saved research");
 const original=commands[0];await click("Check original outcome");
 await act(async()=>{completeFence(response({status:"not_applied",id:original.id,operation_id:original.operation_id}));});
 // Preserve the old entry, simulating a write whose readback cannot confirm
 // that the fresh operation was retained. Mere entry existence is insufficient.
 const retained=sessionStorage.getItem(storageKeyOf());
 vi.stubGlobal("sessionStorage",{getItem:()=>retained,setItem:vi.fn(),removeItem:vi.fn(),clear:vi.fn()});
 await click("Try save again");
 expect(commands).toHaveLength(1);
 expect(host.textContent).toContain("This browser cannot safely retain the pending save");
});

describe("auth-owner lifetime gates the reviewed-baseline settlement",()=>{
 it("pending or unverified auth never starts the selection GET",async()=>{
  await mountWorkspace(false);
  expect(auth.change,"the real owner subscribed to the mocked SDK").not.toBeNull();
  expect(captured?.snapshot.availability,"local freshness is never fabricated").toBe("pending");
  await click("Boundary select");
  expect(selectionCompleters).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes(newHash))).toBe(false);
  expect(host.textContent).not.toContain("Checking source identity and current access");
  expect(host.textContent).not.toContain("could not be reopened");
  expect(host.querySelector("form")).toBeNull();expect(host.textContent).toContain(oldHash);
  await act(async()=>{auth.change!("SIGNED_IN",sessionA);await sleep();});
  expect(captured?.snapshot.availability).toBe("unverified");
  await click("Boundary select");
  expect(selectionCompleters).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes(newHash))).toBe(false);
  expect(host.querySelector("form")).toBeNull();expect(host.textContent).not.toContain(newHash);
 });
 it("a genuine verified focus or refresh replay with the same epoch admits the exact result",async()=>{
  await mountWorkspace();await expectReadyProjection();await click("Boundary select");await click("Boundary select");
  await act(async()=>{auth.change!("SIGNED_IN",sessionA);auth.change!("TOKEN_REFRESHED",sessionA);});
  await act(async()=>{selectionCompleters[0](response(next));});
  await act(async()=>{selectionCompleters[1](response(next));});
  expect(host.querySelector("form")).not.toBeNull();
  expect(host.textContent).toContain(newHash);
  expect(host.textContent).not.toContain("could not be reopened");
  expect(commands).toHaveLength(0);
 });
 it("a same-epoch token refresh reverified before settlement still admits the exact result",async()=>{
  await mountWorkspace();await expectReadyProjection();await click("Boundary select");
  const refreshed=syntheticSession("account-A","session-A",true);
  await act(async()=>{auth.change!("TOKEN_REFRESHED",refreshed);await sleep();});
  expect(auth.checks.length,"the new token dropped to unverified on the same epoch and rechecked").toBe(1);
  await act(async()=>{auth.checks.shift()!(claimsOf());await sleep();});
  expect(captured?.snapshot.availability).toBe("ready");
  await act(async()=>{selectionCompleters[0](response(next));});
  expect(host.querySelector("form")).not.toBeNull();
  expect(host.textContent).toContain(newHash);
  expect(host.textContent).not.toContain("could not be reopened");
 });
 it.each([["USER_UPDATED",sessionA],["PASSWORD_RECOVERY",sessionA],["SIGNED_IN",syntheticSession("account-A","session-B")]] as const)("a same-user %s before settlement rejects the successful read even without a rerender",async(event,changed)=>{
  await mountWorkspace();await click("Boundary select");
  await act(async()=>{auth.change!(event,changed as Session);});
  expect(captured?.snapshot.availability,"React's projected snapshot must still lag as ready").toBe("ready");
  await act(async()=>{selectionCompleters[0](response(next));});
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).not.toContain(newHash);
  expect(host.textContent).not.toContain("The reviewed evidence could not be reopened");
  expect(host.textContent).toContain(oldHash);
  expect(commands).toHaveLength(0);
 });
 it("signing out and back in as the same account cannot admit the old selection",async()=>{
  await mountWorkspace();await click("Boundary select");
  await act(async()=>{auth.change!("SIGNED_OUT",null);});
  await act(async()=>{auth.change!("SIGNED_IN",sessionA);await sleep();});
  await act(async()=>{selectionCompleters[0](response(next));});
  expect(host.textContent).toContain("Your account changed or your session ended");
  expect(host.textContent).not.toContain(newHash);
  expect(host.querySelector("form")).toBeNull();
  expect(commands).toHaveLength(0);
 });
 it("a rebound Workspace lifetime nulls the old getter and cannot install or clobber",async()=>{
  await mountWorkspace();await click("Boundary select");
  await expectReadyProjection();const oldProjection=captured;expect(oldProjection?.snapshot.availability).toBe("ready");
  await act(async()=>{root.render(<InvestigationWorkspace ownerKey="account-A" initialInvestigationId={id} initialRevision={2}/>);await sleep();});
  expect(oldProjection!.getSnapshot()).toBeNull();
  await act(async()=>{selectionCompleters[0](response(next));await sleep();});
  expect(host.textContent).not.toContain(newHash);
  expect(host.textContent).not.toContain("could not be reopened");
  expect(host.querySelector("form")).toBeNull();
  expect(sessionStorage.getItem(storageKeyOf())).toBeNull();
 });
 it("a late invalidated failure cannot clobber a newer valid selection",async()=>{
  await mountWorkspace();await click("Boundary select");await click("Boundary select");
  await act(async()=>{selectionCompleters[0](response({ok:false}));});
  expect(host.textContent).not.toContain("could not be reopened");
  expect(host.querySelector("form")).toBeNull();
  await act(async()=>{selectionCompleters[1](response(next));});
  expect(host.querySelector("form")).not.toBeNull();
  expect(host.textContent).toContain(newHash);
  expect(host.textContent).not.toContain("could not be reopened");
 });
 it("a same-user unverified failure leaves retained Saved storage and the original operation untouched",async()=>{
  await mountWorkspace();await expectReadyProjection();
  await click("Remove from saved research");
  await act(async()=>{completeSave(response({status:"version_conflict",current_revision:2}));await sleep();});
  expect(commands).toHaveLength(1);
  const retained=sessionStorage.getItem(storageKeyOf());
  expect(retained&&JSON.parse(retained).phase).toBe("rejected");
  const operation=JSON.parse(String(retained)).command.operation_id as string;
  await click("Boundary select");
  await act(async()=>{auth.change!("USER_UPDATED",sessionA);});
  await act(async()=>{selectionCompleters[0](response(next));await sleep();});
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).not.toContain(newHash);
  expect(sessionStorage.getItem(storageKeyOf())).toBe(retained);
  expect(commands).toHaveLength(1);
  expect(JSON.parse(String(sessionStorage.getItem(storageKeyOf()))).command.operation_id).toBe(operation);
  expect(host.textContent).toContain("Open latest revision");
 });
});

// Parent counterexamples exercise actual promise rejection, not a second resolution or response-shaped failure.
describe("fresh-auth error settlement",()=>{
 it("an unverified rejected read settles only loading and cannot publish a stale error",async()=>{
  await mountWorkspace();await click("Boundary select");
  const stored=sessionStorage.getItem(storageKeyOf());
  await act(async()=>{auth.change!("USER_UPDATED",sessionA);});
  expect(captured!.getSnapshot()?.availability).toBe("unverified");
  await act(async()=>{selectionRejecters[0](Error("synthetic read failure"));});
  expect(host.textContent).not.toContain("Checking source identity and current access");
  expect(host.textContent).not.toContain("The reviewed evidence could not be reopened");
  expect(host.textContent).toContain(oldHash);
  expect(host.textContent).not.toContain(newHash);
  expect(host.querySelector("form")).toBeNull();
  expect(sessionStorage.getItem(storageKeyOf())).toBe(stored);expect(commands).toHaveLength(0);
 });
 it("a valid rejected read reports failure while preserving the retained baseline",async()=>{
  await mountWorkspace();await click("Boundary select");
  await act(async()=>{selectionRejecters[0](Error("synthetic read failure"));});
  expect(host.textContent).not.toContain("Checking source identity and current access");
  expect(host.textContent).toContain("The reviewed evidence could not be reopened");
  expect(host.textContent).toContain(oldHash);expect(host.querySelector("form")).toBeNull();
 });
 it("a real old rejection after a newer result cannot overwrite that result",async()=>{
  await mountWorkspace();await click("Boundary select");await click("Boundary select");
  await act(async()=>{selectionCompleters[1](response(next));});
  expect(host.querySelector("form")).not.toBeNull();expect(host.textContent).toContain(newHash);
  await act(async()=>{selectionRejecters[0](Error("late synthetic read failure"));});
  expect(host.textContent).not.toContain("The reviewed evidence could not be reopened");
  expect(host.querySelector("form")).not.toBeNull();expect(host.textContent).toContain(newHash);
 });
});

// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import {normalizeEventWorkspace} from "../eventWorkspace";
import fixture from "./fixtures/aapl-event-workspace.json";
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
const auth=vi.hoisted(()=>({change:null as null|((event:string,session:null)=>void)}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{onAuthStateChange:(callback:typeof auth.change)=>{auth.change=callback;return {data:{subscription:{unsubscribe:()=>{auth.change=null;}}}};}}})}));
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="10000000-0000-4000-8000-000000000001",oldHash="a".repeat(64),newHash="b".repeat(64);
const reference={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:fixture.event_id,mode:"pinned",version_ref:fixture.generation_id,fingerprint:oldHash};
const manifest={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Retained question",question:"Keep the saved version",subjects:[{kind:"security",owner:"terminal.analysis_symbol",object_id:"AAPL"},{kind:"issuer",owner:"data_os.security_master",object_id:fixture.issuer.company_id}]},layout_refs:[],thesis_refs:[],evidence_refs:[reference],continuation:{},review_baseline_ref:reference};
const old={ok:true,workspace:normalizeEventWorkspace(fixture),reference,receipt:{fingerprint:oldHash,generation_id:fixture.generation_id,event_id:fixture.event_id,company_id:fixture.issuer.company_id,rights:{checked_at:"2026-10-04T00:00:00Z"}}};
const next={...old,reference:{...reference,version_ref:"b".repeat(24),fingerprint:newHash},receipt:{...old.receipt,generation_id:"b".repeat(24),fingerprint:newHash}};
let root:Root,host:HTMLDivElement,completeSelection:(value:unknown)=>void,completeSave:(value:unknown)=>void;
const commands:Array<{id:string;operation_id:string;action:string;manifest:typeof manifest}>=[];
const response=(json:unknown)=>({ok:true,json:async()=>json});
async function click(text:string){const button=[...host.querySelectorAll("button")].find(b=>b.textContent===text);expect(button,`missing button ${text}`).toBeDefined();await act(async()=>{button!.click();});}
async function mount(owner="local-preview"){await act(async()=>{root.render(<InvestigationWorkspace ownerKey={owner} initialInvestigationId={id} initialRevision={1}/>);});await click("Review current evidence");await click("Use this reviewed version in an edit");}
beforeEach(()=>{
 vi.stubGlobal("React",React);sessionStorage.clear();commands.length=0;host=document.createElement("div");document.body.append(host);root=createRoot(host);
 vi.stubGlobal("fetch",vi.fn((url:string,options?:RequestInit)=>{
  if(options?.method==="POST"){commands.push(JSON.parse(String(options.body)));return new Promise(resolve=>{completeSave=resolve;});}
  if(url.startsWith("/api/investigations/baseline?"))return url.includes(newHash)?new Promise(resolve=>{completeSelection=resolve;}):Promise.resolve(response(old));
  if(url.startsWith("/api/investigations/review?"))return Promise.resolve(response({status:"reviewed",id,revision:1,baseline:old.receipt,current:next.receipt,review:{schema:"investigation.evidence_review.v1",items:[]}}));
  if(url.startsWith("/api/investigations?"))return Promise.resolve(response({status:"found",id,revision:1,current_revision:1,lifecycle:"active",manifest,committed_at:"2026-10-04T00:00:00Z",layouts:[]}));
  return Promise.resolve(response(url==="/api/layouts"?{layouts:[]}:{status:"listed",items:[]}));
 }));
});
afterEach(()=>{act(()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
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
  await mount("owner-a");await act(async()=>{auth.change!("SIGNED_OUT",null);completeSelection(response(next));});
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
 const retained=sessionStorage.getItem("mm.investigation.pending.v2:local-preview");
 vi.stubGlobal("sessionStorage",{getItem:()=>retained,setItem:vi.fn(),removeItem:vi.fn(),clear:vi.fn()});
 await click("Try save again");
 expect(commands).toHaveLength(1);
 expect(host.textContent).toContain("This browser cannot safely retain the pending save");
});

// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
// Explicit synthetic process/realm for these real BFF tests. The production
// Linux boot reader and irreversible realm latch remain unchanged. A fresh
// fixture realm per case is not a product latch-reset or OPEN mechanism.
const bootFixture=vi.hoisted(()=>({bornOpen:true,closed:false}));
vi.mock("@/lib/investigationBootAdmission",()=>({
 readInvestigationBootAdmission:()=>bootFixture.bornOpen,
 hasObservedInvestigationClosure:()=>bootFixture.closed,
 observeInvestigationClosure:()=>{bootFixture.closed=true;}
}));
beforeEach(()=>{bootFixture.bornOpen=true;bootFixture.closed=false;vi.stubEnv("INVESTIGATION_API_ADMISSION","open");});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import {parseAnalysisRoute} from "../analysisRoute";

import type {InvestigationManifest} from "../investigationContracts";
const {rpc,getUser,principal}=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),principal:"90000000-0000-4000-8000-000000000009"}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc,auth:{getUser,getSession:async()=>({data:{session:{access_token:"synthetic-policy-session"}},error:null})}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:()=>({ok:true})}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/lib/useInvestigationTheme",()=>({useInvestigationTheme:()=>"dark"}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
vi.mock("@/lib/supabase/investigationAuthOwner",()=>({subscribeInvestigationAuthOwner:()=>({getSnapshot:()=>({availability:"ready",principal_partition:principal,auth_epoch:"synthetic-private-epoch"}),unsubscribe:vi.fn()})}));

import {GET,POST} from "@/app/api/investigations/route";
import {GET as baselineGET} from "@/app/api/investigations/baseline/route";
import {GET as reviewGET} from "@/app/api/investigations/review/route";
const fixture=join(__dirname,"fixtures/intl_policy_generation_actual_20261104"),generation="im-workspace-generation:f180e9f4-eeee-488d-b312-5a68d09ccf5c",fingerprint="0dc2265e5985adaff29f0c2efbf7191be9f80472a6c0f73646a4ac1b5776f8b8";

const producer=JSON.parse(readFileSync(join(fixture,"actual-producer-hrefs.json"),"utf8"));
it.each(["jp_focus","no_focus"])("actual producer GB href %s joins native blank authoring, Save and exact reopen",async navigation=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const originalScroll=Object.getOwnPropertyDescriptor(Element.prototype,"scrollIntoView");Object.defineProperty(Element.prototype,"scrollIntoView",{configurable:true,value:vi.fn()});
 const host=documentGlobal(),root=createRoot(host),action=producer.cases.find((c:{field:string;navigation:string})=>c.field==="GB.policy_rate"&&c.navigation===navigation);
 const routed=parseAnalysisRoute(Object.fromEntries(new URL(action.href,"https://terminal.test").searchParams));if(routed.kind!=="investigations"||!routed.intlEntry||!routed.intlReturnTo)throw Error("actual producer href refused");
 const selection=routed.intlEntry,back=routed.intlReturnTo;expect(selection).toEqual({context:action.context_id,generation,fingerprint,fields:action.field_ids});
 let saved:Record<string,unknown>|null=null;const history=new Map<number,Record<string,unknown>>();const posted:InvestigationManifest[]=[],calls:Array<{url:string;method:string}>=[];
 // Native owner/auth and database are explicit doubles; published generation
 // bytes, source-policy reads, codec, route owners and mounted consumer are real.
 getUser.mockResolvedValue({data:{user:{id:principal}},error:null});rpc.mockImplementation(async(name:string,p:Record<string,unknown>)=>{
  if(name==="list_investigations_v2")return {data:{status:"listed",items:[]},error:null};
  if(name==="apply_investigation_revision_v2"){
   const previous=saved,revision=Number(p.p_expected_revision)+1;expect(p.p_expected_revision).toBe(previous?.revision??0);expect(p.p_action).toBe(previous?"revise":"create");posted.push(structuredClone(p.p_manifest as InvestigationManifest));
   saved={id:p.p_id,operation_id:p.p_operation_id,revision,current_revision:revision,lifecycle:"active",manifest:structuredClone(p.p_manifest),committed_at:"2026-11-04T12:00:00.000Z",layouts:[],investigation_id:p.p_id,revision_id:crypto.randomUUID(),sequence:revision,parent_revision_id:previous?.revision_id??null,author_ref:principal,recorded_at:"2026-11-04T12:00:00.000Z",manifest_digest:"c".repeat(64)};
   history.set(revision,structuredClone(saved));return {data:{...saved,status:"committed"},error:null};
  }
  if(name==="read_investigation_v2"){expect(p.p_id).toBe(saved?.id);expect(history.has(Number(p.p_revision))).toBe(true);return {data:{...history.get(Number(p.p_revision)),current_revision:saved?.revision,status:"found"},error:null};}
  throw Error("Unexpected owner operation "+name);
 });
 vi.stubGlobal("fetch",vi.fn<typeof fetch>(async(input,init)=>{
  const url=String(input),method=init?.method??"GET";calls.push({url,method});
  if(url.startsWith("https://pub-")){const name=new URL(url).pathname.split("/").at(-1)!;expect(readdirSync(fixture)).toContain(name);expect(init?.credentials).toBe("omit");return new Response(readFileSync(join(fixture,name)),{headers:{"content-type":"application/json"}});}
  const req=()=>new Request(new URL(url,"https://terminal.test"),{method,headers:init?.headers,body:method==="POST"?init?.body:undefined});
  if(url.startsWith("/api/investigations/baseline?"))return baselineGET(req());
  if(url.startsWith("/api/investigations/review?"))return reviewGET(req());
  if(url==="/api/investigations"&&method==="POST")return POST(req());
  if(url==="/api/investigations"||url.startsWith("/api/investigations?"))return GET(req());
  if(url==="/api/layouts")return json({layouts:[]});if(url==="/api/alerts")return json({alerts:[]});if(url==="/api/alerts/receipts")return json({outbox:[]});
  throw Error("Unexpected native fetch "+method+" "+url);
 }));
 const click=async(label:string)=>act(async()=>{const b=[...host.querySelectorAll("button")].find(x=>x.textContent===label);expect(b,label).toBeDefined();b!.click();});
 const fill=async(label:string,value:string)=>act(async()=>{const el=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;expect(el).not.toBeNull();const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});
 try{
  expect(routed.intlEntry).toEqual(selection);await act(async()=>root.render(<InvestigationWorkspace key="actual-entry" ownerKey={principal} initialIntlEntry={routed.intlEntry} intlReturnTo={routed.intlReturnTo}/>));
  await click("Use this International selection");expect(host.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("");expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Research question"]')?.value).toBe("");expect(posted).toEqual([]);
  await fill("Title","Authored actual-source research");await fill("Research question","Does this exact selected UK evidence support my thesis?");await click("Save research");
  expect(posted).toHaveLength(1);const before=structuredClone(posted[0]);expect(before.intent.question).toBe("Does this exact selected UK evidence support my thesis?");expect(before.evidence_refs.map(ref=>ref.selection?.field)).toEqual(selection.fields);expect(before.intent.subjects).toEqual([{owner:"intl.workspace_context",kind:"economy",object_id:selection.context}]);expect(JSON.stringify(before)).not.toContain("JP");expect(before.evidence_refs.every(ref=>ref.object_id===selection.context&&ref.version_ref===generation&&ref.fingerprint===fingerprint)).toBe(true);
  expect(host.textContent).toContain(before.intent.question);expect(host.textContent).toContain("3.75 percent");expect(host.textContent).not.toContain("2.5 percent");
  const id=(saved as unknown as {id:string}).id;await act(async()=>root.render(<InvestigationWorkspace key="actual-reopen" ownerKey={principal} initialInvestigationId={id} initialRevision={1} intlReturnTo={back}/>));
  expect(posted).toEqual([before]);expect(host.textContent).toContain(before.intent.question);expect(host.textContent).toContain("3.75 percent");expect(host.querySelector<HTMLAnchorElement>('a[href^="https://www.mastermind-x.com/intl.html"]')?.href).toBe(back);
  expect(calls.filter(c=>c.method!=="GET")).toEqual([{url:"/api/investigations",method:"POST"}]);expect(rpc.mock.calls.filter(([name])=>name==="apply_investigation_revision_v2")).toHaveLength(1);

 }finally{
  await act(async()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.clearAllMocks();
  if(originalScroll)Object.defineProperty(Element.prototype,"scrollIntoView",originalScroll);else Reflect.deleteProperty(Element.prototype,"scrollIntoView");(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=false;
 }
});
function documentGlobal(){const host=globalThis.document.createElement("div");globalThis.document.body.append(host);return host;}
function json(value:unknown){return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});}

it.each(["born-closed","observed-closed"])("synthetic %s runtime cannot reopen before auth/body/RPC/source",async mode=>{
 getUser.mockClear();rpc.mockClear();const source=vi.fn();vi.stubGlobal("fetch",source);
 bootFixture.bornOpen=mode!=="born-closed";vi.resetModules();
 const {POST:guardedPOST}=await import("@/app/api/investigations/route");
 if(mode==="observed-closed"){
  vi.stubEnv("INVESTIGATION_API_ADMISSION","closed");expect((await guardedPOST(new Request("https://terminal.test/api/investigations",{method:"POST",body:"{}"}))).status).toBe(503);
  vi.stubEnv("INVESTIGATION_API_ADMISSION","open");
 }
 const r=new Request("https://terminal.test/api/investigations",{method:"POST",body:"{}"}),read=vi.spyOn(r.body!,"getReader");
 expect((await guardedPOST(r)).status).toBe(503);expect(getUser).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();expect(source).not.toHaveBeenCalled();
});

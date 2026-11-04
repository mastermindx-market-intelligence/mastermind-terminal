// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import InvestigationWorkspace from "@/components/workspaces/InvestigationWorkspace";
import type {IntlEntrySelectors} from "../investigationIntlEntry";
import type {InvestigationManifest} from "../investigationContracts";
const {rpc,getUser,principal}=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),principal:"90000000-0000-4000-8000-000000000009"}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc,auth:{getUser}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:()=>({ok:true})}));
vi.mock("@/lib/i18n",()=>({useLang:()=>({lang:"en"})}));
vi.mock("@/lib/useInvestigationTheme",()=>({useInvestigationTheme:()=>"dark"}));
vi.mock("next/link",()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
vi.mock("@/lib/supabase/investigationAuthOwner",()=>({subscribeInvestigationAuthOwner:()=>({getSnapshot:()=>({availability:"ready",principal_partition:principal,auth_epoch:"synthetic-private-epoch"}),unsubscribe:vi.fn()})}));
import {GET,POST} from "@/app/api/investigations/route";
import {GET as baselineGET} from "@/app/api/investigations/baseline/route";
import {GET as reviewGET} from "@/app/api/investigations/review/route";
const fixture=join(__dirname,"fixtures/intl_generation_actual_20261104/corrected"),generation="im-workspace-generation:5c75f77b-96ff-4d0d-a156-5641fc3f6140",fingerprint="4e1101d873ee047d6b49703ac977bd9587b127e9423bcac9d098dbb9ec23c39e";
const document=JSON.parse(readFileSync(join(fixture,`intl_generation_5c75f77b-96ff-4d0d-a156-5641fc3f6140_${fingerprint}.json`),"utf8"));
it("composes exact actual producer bytes through native blank authoring, explicit Save, private readback and exact reopen",async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const originalScroll=Object.getOwnPropertyDescriptor(Element.prototype,"scrollIntoView");Object.defineProperty(Element.prototype,"scrollIntoView",{configurable:true,value:vi.fn()});
 const host=documentGlobal(),root=createRoot(host),selected=document.contexts.find((c:{market:string;horizon:string;currency_basis:string})=>c.market==="EZ"&&c.horizon==="3m"&&c.currency_basis==="local");
 const selection:IntlEntrySelectors={context:selected.id,generation,fingerprint,fields:[...selected.measure_ids]};
 const back="https://www.mastermind-x.com/intl.html?view=risk&market=EZ&pins=EZ,GB&horizon=3m&basis=local&return_basis=price&group=";
 let saved:Record<string,unknown>|null=null;const posted:InvestigationManifest[]=[],calls:Array<{url:string;method:string}>=[];
 // Native owner/auth and database are explicit doubles; published generation
 // bytes, source-policy reads, codec, route owners and mounted consumer are real.
 getUser.mockResolvedValue({data:{user:{id:principal}},error:null});rpc.mockImplementation(async(name:string,p:Record<string,unknown>)=>{
  if(name==="list_investigations_v2")return {data:{status:"listed",items:[]},error:null};
  if(name==="apply_investigation_revision_v2"){
   expect(saved).toBeNull();expect(p.p_expected_revision).toBe(0);expect(p.p_action).toBe("create");posted.push(structuredClone(p.p_manifest as InvestigationManifest));
   saved={id:p.p_id,operation_id:p.p_operation_id,revision:1,current_revision:1,lifecycle:"active",manifest:structuredClone(p.p_manifest),committed_at:"2026-11-04T12:00:00.000Z",layouts:[],investigation_id:p.p_id,revision_id:"50000000-0000-4000-8000-000000000003",sequence:1,parent_revision_id:null,author_ref:principal,recorded_at:"2026-11-04T12:00:00.000Z",manifest_digest:"c".repeat(64)};
   return {data:{...saved,status:"committed"},error:null};
  }
  if(name==="read_investigation_v2"){expect(p.p_id).toBe(saved?.id);expect(p.p_revision).toBe(1);return {data:{...saved,status:"found"},error:null};}
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
  await act(async()=>root.render(<InvestigationWorkspace key="actual-entry" ownerKey={principal} initialIntlEntry={selection} intlReturnTo={back}/>));
  await click("Use this International selection");expect(host.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("");expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Research question"]')?.value).toBe("");expect(posted).toEqual([]);
  await fill("Title","Authored actual-source research");await fill("Research question","Does this exact selected Eurozone evidence support my thesis?");await click("Save research");
  expect(posted).toHaveLength(1);const before=structuredClone(posted[0]);expect(before.intent.question).toBe("Does this exact selected Eurozone evidence support my thesis?");expect(before.evidence_refs.map(ref=>ref.selection?.field)).toEqual(selection.fields);expect(before.evidence_refs.every(ref=>ref.object_id===selection.context&&ref.version_ref===generation&&ref.fingerprint===fingerprint)).toBe(true);
  expect(host.textContent).toContain(before.intent.question);for(const value of ["2.5 percent","1.7 percent_gdp","1.3 percent","3.8 percent"])expect(host.textContent).toContain(value);expect(host.textContent).not.toContain("3.75 percent");
  const id=(saved as unknown as {id:string}).id;await act(async()=>root.render(<InvestigationWorkspace key="actual-reopen" ownerKey={principal} initialInvestigationId={id} initialRevision={1} intlReturnTo={back}/>));
  expect(posted).toEqual([before]);expect(host.textContent).toContain(before.intent.question);expect(host.textContent).toContain("1.7 percent_gdp");expect(host.querySelector<HTMLAnchorElement>('a[href^="https://www.mastermind-x.com/intl.html"]')?.href).toBe(back);
  expect(calls.filter(c=>c.method!=="GET")).toEqual([{url:"/api/investigations",method:"POST"}]);expect(rpc.mock.calls.filter(([name])=>name==="apply_investigation_revision_v2")).toHaveLength(1);
 }finally{
  await act(async()=>root.unmount());host.remove();sessionStorage.clear();vi.unstubAllGlobals();vi.clearAllMocks();
  if(originalScroll)Object.defineProperty(Element.prototype,"scrollIntoView",originalScroll);else Reflect.deleteProperty(Element.prototype,"scrollIntoView");(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=false;
 }
});
function documentGlobal(){const host=globalThis.document.createElement("div");globalThis.document.body.append(host);return host;}
function json(value:unknown){return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});}

import {describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {createIntlInvestigationHandlers} from "../investigationIntlApi";
import type {IntlGenerationCodec} from "../investigationIntlNativeReads";
import type {InvestigationCommand} from "../investigations";
const context="intl-workspace-context:sha256:"+"c".repeat(64),generation="im-workspace-generation:11111111-1111-4111-8111-111111111111",principal="90000000-0000-4000-8000-000000000009",field="EZ.gdp_yoy";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function setup(deny=false){
 const policy={metadata:deny?"denied" as const:"allowed" as const,value_permission:"allowed" as const,policy_ref:"synthetic.policy",policy_document_sha256:"d".repeat(64),policy_identity:"e".repeat(64)};
 const text=JSON.stringify({schema:"intl.workspace_generation.v1",synthetic:true}),fingerprint=sha(text),name=`intl_generation_${generation.slice("im-workspace-generation:".length)}_${fingerprint}.json`;
 const descriptor=JSON.stringify({schema:"intl.workspace_generation_current.v1",asof:null,state:"ready",generation,artifact_name:name,artifact_sha256:fingerprint,artifact_bytes:Buffer.byteLength(text),current_policies:{[field]:policy}});
 const files=new Map([[name,text],["intl_generation_current.json",descriptor],[`intl_generation_descriptor_${sha(descriptor)}.json`,descriptor]]);
 const fetcher=vi.fn<typeof fetch>(async input=>{const name=new URL(String(input)).pathname.split("/").at(-1)!;return new Response(files.get(name)??"",{status:files.has(name)?200:404,headers:{"content-type":"application/json"}});});
 // Codec double tests HTTP composition, not real producer shape or publication.
 const codec:IntlGenerationCodec={parseIntlPublicationPolicies:raw=>raw as Record<string,typeof policy>,decodeIntlGeneration:(artifact,id,lang)=>({object_id:id,generation:artifact.generation,fingerprint:artifact.fingerprint,context:{researchMarket:"EZ",toolBindingVersion:"2",periodIdentity:"3m",currencyBasis:"local",returnBasis:"price"},supportedMeasureIds:[field],result:{read:"ok",membership:"complete",observations:[],tombstones:[]},publicationPolicies:{[field]:policy},display:{lang,marketLabel:"Synthetic",toolLabel:"Macro",periodLabel:"3m",basisLabel:"local",sourceGenerationAt:null,measureLabels:{[field]:"Synthetic GDP"},unmetLabels:[]},unmetPrerequisites:[]})};
 const handlers=createIntlInvestigationHandlers(codec,{fetcher,base:"https://synthetic.test"});
 const query=new URLSearchParams({kind:"international",context,generation,fingerprint,field});
 const ref={owner:"intl.workspace_generation",object_type:"selected_generation",object_id:context,mode:"pinned" as const,version_ref:generation,fingerprint,selection:{field}};
 const command:InvestigationCommand={id:"50000000-0000-4000-8000-000000000001",operation_id:"50000000-0000-4000-8000-000000000002",action:"create",expected_revision:0,manifest:{schema:"investigation_manifest.v3",intent:{title:"Authored private title",question:"Exact private question",subjects:[{owner:"intl.workspace_context",kind:"economy",object_id:context}]},evidence_refs:[ref],review_baseline_ref:ref,thesis_refs:[],layout_refs:[],argument_relations:[],continuation:{}}};
 const request=()=>new Request(`https://terminal.test/api/investigations/baseline?${query}`,{headers:{"Accept-Language":"zh"}});
 return {handlers,fetcher,files,query,command,request,name};
}
describe("existing Investigation International handler source composition",()=>{
 it("qualifies native selectors with private user scope without publishing a question or account",async()=>{
  const s=setup(),result=await s.handlers.baseline(s.request(),principal);expect(result.status).toBe(200);expect(result.body).toMatchObject({status:"international_baseline",refs:s.command.manifest.evidence_refs,baseline:s.command.manifest.review_baseline_ref,context:{researchMarket:"EZ"}});
  expect(s.fetcher).toHaveBeenCalledTimes(4);for(const [url,init] of s.fetcher.mock.calls){expect(String(url)).not.toContain(principal);expect(String(url)).not.toContain("question");expect(init?.credentials).toBe("omit");}
 });
 it("rejects invalid/mixed selectors before fetching source bytes",async()=>{
  const s=setup();s.query.append("symbol","AAPL");expect((await s.handlers.baseline(s.request(),principal)).status).toBe(400);expect(s.fetcher).not.toHaveBeenCalled();
 });
 it("refuses absent principal before source access, without treating it as a grant",async()=>{
  const s=setup();expect((await s.handlers.baseline(s.request(),"anonymous")).status).toBe(503);expect(s.fetcher).not.toHaveBeenCalled();
 });
 it("keeps missing sealed history unavailable without current substitution",async()=>{
  const s=setup();s.files.delete(s.name);expect((await s.handlers.baseline(s.request(),principal)).status).toBe(503);expect(s.fetcher).toHaveBeenCalledTimes(1);
 });
 it("current denial prevents authoring and prospective new Save",async()=>{
  const s=setup(true);expect((await s.handlers.baseline(s.request(),principal)).status).toBe(503);expect(await s.handlers.newCommand(s.request(),s.command,principal)).toBe(false);
 });
 it("returns a private response with acknowledged id/revision and preserves the authored question",async()=>{
  const s=setup(),before=structuredClone(s.command.manifest);const result=await s.handlers.review(s.request(),{id:s.command.id,revision:7,committed_at:"2026-11-04T10:00:00.000Z",manifest:s.command.manifest},principal);
  expect(result).toMatchObject({status:200,body:{status:"international",id:s.command.id,revision:7,input:{disposition:"resolved",owner:{question:before.intent.question,savedAt:"2026-11-04T10:00:00.000Z"}}}});expect(s.command.manifest).toEqual(before);
 });
 it("does not reacquire public evidence for remove/restore or unrelated native commands",async()=>{
  const s=setup();for(const action of ["remove","restore"] as const)expect(await s.handlers.newCommand(s.request(),{...s.command,action},principal)).toBe(true);
  const ordinary=structuredClone(s.command);ordinary.manifest.evidence_refs=[];delete ordinary.manifest.review_baseline_ref;ordinary.manifest.intent.subjects=[{owner:"terminal.analysis_symbol",kind:"security",object_id:"AAPL"}];expect(await s.handlers.newCommand(s.request(),ordinary,principal)).toBe(true);expect(s.fetcher).not.toHaveBeenCalled();
 });
 it("re-reads current policy per invocation rather than sharing an earlier account decision",async()=>{
  const s=setup();expect((await s.handlers.baseline(s.request(),principal)).status).toBe(200);s.files.delete("intl_generation_current.json");expect((await s.handlers.baseline(s.request(),principal)).status).toBe(503);expect(s.fetcher).toHaveBeenCalledTimes(6);
 });
});

import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
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
import {createHash} from "node:crypto";
import type {InvestigationCommand} from "../investigations";
const {rpc,getUser}=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc,auth:{getUser}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:()=>({ok:true})}));
import {GET as baselineGET} from "@/app/api/investigations/baseline/route";
import {GET as reviewGET} from "@/app/api/investigations/review/route";
import {POST,PUT} from "@/app/api/investigations/route";
const principal="90000000-0000-4000-8000-000000000009",id="50000000-0000-4000-8000-000000000001",operation="50000000-0000-4000-8000-000000000002",revisionId="50000000-0000-4000-8000-000000000003",stamp="2026-11-04T10:00:00.000Z";
const generation="im-workspace-generation:11111111-1111-4111-8111-111111111111",sid="EZ.gdp_yoy";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const context="intl-workspace-context:sha256:"+hash(JSON.stringify({binding_version:2,currency_basis:"local",horizon:"3m",market:"EZ",return_basis:"price"}));
let files:Map<string,string>,fetcher:ReturnType<typeof vi.fn<typeof fetch>>,command:InvestigationCommand,detail:Record<string,unknown>,fingerprint:string,artifactName:string;
const policy={metadata:"allowed",value_permission:"allowed",policy_ref:"synthetic.native.policy",policy_document_sha256:"d".repeat(64),policy_identity:"e".repeat(64)};
const request=(path:string)=>new Request("https://terminal.test/api/investigations"+path);
const baseline=()=>request("/baseline?"+new URLSearchParams({kind:"international",context,generation,fingerprint,field:sid}));
const review=()=>request(`/review?id=${id}&revision=1`);
const write=(method:string,value:unknown=command)=>new Request("https://terminal.test/api/investigations",{method,body:JSON.stringify(value)});
beforeEach(()=>{
 vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:principal}},error:null});
 // Synthetic native-shaped bytes exercise the real transport, codec, policy,
 // route/auth and existing RPC owner service. No live publication/SQL proof.
 const document={schema:"intl.workspace_generation.v1",asof:null,generation,binding_version:2,evaluated_at:stamp,contexts:[{id:context,market:"EZ",horizon:"3m",currency_basis:"local",return_basis:"price",measure_ids:[sid]}],measures:{[sid]:{native_measure:{quality:"qualified",reason:null,metadata:"allowed",value_permission:"allowed",value:1.7,unit:"percent",instrument:{kind:"statistical_observation",id:"synthetic.gdp",market_id:"EZ"},period:null,observation_at:"2026-10-28",calculation_at:null,source_reference:"synthetic:explicit-source",evidence_key:"synthetic.gdp"},native_evidence:{receipt_identity:{receipt_sha256:"f".repeat(64)},publication_decision:{owner_ref:"scripts/build_intl.py",policy_ref:policy.policy_ref,decision_ref:generation+":"+sid,metadata:"allowed",value_permission:"allowed",binding:{field:sid,receipt_sha256:"f".repeat(64)}},clocks:{observation_at:"2026-10-28",calculation_at:null}},content_identity:"a".repeat(64),qualification_identity:"b".repeat(64),policy_identity:policy.policy_identity}},policies:{[sid]:policy},policy_points_ref:null};
 const text=JSON.stringify(document);fingerprint=hash(text);artifactName=`intl_generation_${generation.slice("im-workspace-generation:".length)}_${fingerprint}.json`;
 const descriptor=JSON.stringify({schema:"intl.workspace_generation_current.v1",asof:null,state:"ready",generation,artifact_name:artifactName,artifact_sha256:fingerprint,artifact_bytes:Buffer.byteLength(text),current_policies:{[sid]:policy}});
 files=new Map([[artifactName,text],["intl_generation_current.json",descriptor],[`intl_generation_descriptor_${hash(descriptor)}.json`,descriptor]]);
 fetcher=vi.fn<typeof fetch>(async(input,init)=>{expect(init?.credentials).toBe("omit");const name=new URL(String(input)).pathname.split("/").at(-1)!;return new Response(files.get(name)??"",{status:files.has(name)?200:404,headers:{"content-type":"application/json"}});});vi.stubGlobal("fetch",fetcher);
 const ref={owner:"intl.workspace_generation",object_type:"selected_generation",object_id:context,mode:"pinned" as const,version_ref:generation,fingerprint,selection:{field:sid}};
 command={id,operation_id:operation,expected_revision:0,action:"create",manifest:{schema:"investigation_manifest.v3",intent:{title:"Private authored research",question:"The precise private authored question",subjects:[{owner:"intl.workspace_context",kind:"economy",object_id:context}]},evidence_refs:[ref],review_baseline_ref:ref,thesis_refs:[],layout_refs:[],argument_relations:[],continuation:{}}};
 detail={status:"found",id,revision:1,current_revision:1,lifecycle:"active",manifest:command.manifest,committed_at:stamp,layouts:[],investigation_id:id,operation_id:operation,revision_id:revisionId,sequence:1,parent_revision_id:null,author_ref:principal,recorded_at:stamp,manifest_digest:"c".repeat(64)};
 rpc.mockResolvedValue({data:detail,error:null});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("native International existing-route integration",()=>{
 it.each(["closed",""])('keeps all new paths behind the existing %s admission gate',async mode=>{
  vi.stubEnv("INVESTIGATION_API_ADMISSION",mode);for(const [handler,r] of [[baselineGET,baseline()],[reviewGET,review()],[POST,write("POST")]] as const)expect((await handler(r)).status).toBe(503);
  expect(getUser).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it("authenticates before any native-source or database access",async()=>{
  getUser.mockResolvedValue({data:{user:null},error:null});for(const [handler,r] of [[baselineGET,baseline()],[reviewGET,review()],[POST,write("POST")]] as const)expect((await handler(r)).status).toBe(401);expect(rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it("qualifies exact baseline selectors through actual immutable and current-policy bytes",async()=>{
  const result=await baselineGET(baseline());expect(result.status).toBe(200);expect(result.headers.get("cache-control")).toBe("private, no-store");expect(result.headers.get("vary")).toBe("Cookie");expect(await result.json()).toMatchObject({status:"international_baseline",refs:command.manifest.evidence_refs,context:{researchMarket:"EZ",periodIdentity:"3m",currencyBasis:"local",returnBasis:"price"}});expect(fetcher).toHaveBeenCalledTimes(4);expect(rpc).not.toHaveBeenCalled();
 });
 it("reads the authenticated exact saved revision before fetching International evidence",async()=>{
  const result=await reviewGET(review());expect(result.status).toBe(200);expect(rpc.mock.calls).toEqual([["read_investigation_v2",{p_id:id,p_revision:1}]]);expect(await result.json()).toMatchObject({status:"international",id,revision:1,input:{disposition:"resolved",owner:{question:command.manifest.intent.question,savedAt:stamp,sourceGenerationAt:null,observedAtByMeasureId:{[sid]:"2026-10-28"}},prior:{generation,observations:[{id:sid,interpretation:{value:1.7,unit:"percent"}}]}}});expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it("foreign, substituted and unsupported saved detail cannot fetch public evidence",async()=>{
  for(const data of [{status:"not_found"},{...detail,id:operation},{...detail,revision:2},{...detail,manifest:{...command.manifest,schema:"investigation_manifest.v2"}}]){rpc.mockResolvedValue({data,error:null});expect((await reviewGET(review())).status).not.toBe(200);}expect(fetcher).not.toHaveBeenCalled();
 });
 it("applies a qualified explicit Save exactly once through the original CAS/RPC owner",async()=>{
  rpc.mockResolvedValue({data:{...detail,status:"committed",operation_id:operation},error:null});const result=await POST(write("POST"));expect(result.status).toBe(200);expect(await result.json()).toMatchObject({status:"committed",operation_id:operation});expect(rpc.mock.calls).toEqual([["apply_investigation_revision_v2",{p_id:id,p_expected_revision:0,p_action:"create",p_operation_id:operation,p_manifest:command.manifest,p_layout_capture:null}]]);expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it("retains UNKNOWN on missing history before strict POST, never definitive no-effect",async()=>{
  files.delete(artifactName);const result=await POST(write("POST"));expect(result.status).toBe(503);expect(await result.json()).toEqual({status:"unavailable",reason:"international_source_unavailable"});expect(rpc).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("reconciles the exact original PUT without reacquiring source or replacing its operation",async()=>{
  files.clear();rpc.mockResolvedValue({data:{...detail,status:"committed",operation_id:operation},error:null});const result=await PUT(write("PUT"));expect(result.status).toBe(200);expect(rpc.mock.calls[0][0]).toBe("reconcile_investigation_operation_v2");expect(rpc.mock.calls[0][1]).toMatchObject({p_id:id,p_operation_id:operation,p_manifest:command.manifest});expect(fetcher).not.toHaveBeenCalled();
 });
 it("routes a valid legacy POST unchanged to original reconciliation without source preflight",async()=>{
  const legacy=structuredClone(command);legacy.manifest.schema="investigation_manifest.v2";legacy.manifest.intent.subjects=[];legacy.manifest.evidence_refs=[];delete legacy.manifest.review_baseline_ref;delete legacy.manifest.argument_relations;rpc.mockResolvedValue({data:{status:"not_applied",id,operation_id:operation},error:null});const result=await POST(write("POST",legacy));expect(result.status).toBe(200);expect(rpc.mock.calls[0][0]).toBe("reconcile_investigation_operation_v2");expect(rpc.mock.calls[0][1].p_manifest).toEqual(legacy.manifest);expect(fetcher).not.toHaveBeenCalled();
 });
 it("rejects malformed duplicate selectors without any source read",async()=>{
  const r=baseline();expect((await baselineGET(new Request(r.url+"&generation="+generation))).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
 });
 it("does not disclose values when current policy is unavailable or denied",async()=>{
  const d=JSON.parse(files.get("intl_generation_current.json")!);d.current_policies[sid].metadata="denied";const text=JSON.stringify(d);files.set("intl_generation_current.json",text);files.set(`intl_generation_descriptor_${hash(text)}.json`,text);
  expect((await baselineGET(baseline())).status).toBe(503);const result=await reviewGET(review());expect(await result.json()).toEqual({status:"international",id,revision:1,input:{disposition:"denied"}});expect((await POST(write("POST"))).status).toBe(503);
 });
});

it.each(["born-closed","observed-closed"])("synthetic %s runtime cannot reopen before auth/body/RPC/source",async mode=>{

 bootFixture.bornOpen=mode!=="born-closed";vi.resetModules();
 const {POST:guardedPOST}=await import("@/app/api/investigations/route");
 if(mode==="observed-closed"){
  vi.stubEnv("INVESTIGATION_API_ADMISSION","closed");expect((await guardedPOST(write("POST"))).status).toBe(503);
  vi.stubEnv("INVESTIGATION_API_ADMISSION","open");
 }
 const r=write("POST"),read=vi.spyOn(r.body!,"getReader");
 expect((await guardedPOST(r)).status).toBe(503);expect(getUser).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});

import {describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {createIntlGenerationReads,type IntlGenerationCodec} from "../investigationIntlNativeReads";
import type {IntlPublicationPolicy} from "../investigationIntlOwner";
const contextId="intl-workspace-context:sha256:"+"c".repeat(64),principal="90000000-0000-4000-8000-000000000009",sid="EZ.gdp_yoy";
const priorId="im-workspace-generation:11111111-1111-4111-8111-111111111111",currentId="im-workspace-generation:22222222-2222-4222-8222-222222222222";
const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
const policy=():IntlPublicationPolicy=>({metadata:"allowed",value_permission:"allowed",policy_ref:"synthetic.policy",policy_document_sha256:"d".repeat(64),policy_identity:"e".repeat(64)});
function setup(change:Partial<IntlPublicationPolicy>={}){
 // Synthetic codec doubles isolate policy/transport orchestration. They do not
 // qualify a real native generation or its source rows.
 const currentPolicy={...policy(),...change};
 const prior=JSON.stringify({schema:"intl.workspace_generation.v1",fixture:"prior"}),current=JSON.stringify({schema:"intl.workspace_generation.v1",fixture:"current"});
 const filename=(id:string,hash:string)=>`intl_generation_${id.slice("im-workspace-generation:".length)}_${hash}.json`;
 const descriptor=JSON.stringify({schema:"intl.workspace_generation_current.v1",asof:null,state:"ready",generation:currentId,artifact_name:filename(currentId,digest(current)),artifact_sha256:digest(current),artifact_bytes:Buffer.byteLength(current),current_policies:{[sid]:currentPolicy}});
 const files=new Map([[filename(priorId,digest(prior)),prior],[filename(currentId,digest(current)),current],["intl_generation_current.json",descriptor],[`intl_generation_descriptor_${digest(descriptor)}.json`,descriptor]]);
 const fetcher=vi.fn<typeof fetch>(async input=>{const name=new URL(String(input)).pathname.split("/").at(-1)!;return new Response(files.get(name)??"",{status:files.has(name)?200:404,headers:{"content-type":"application/json"}});});
 const codec:IntlGenerationCodec={decodeIntlGeneration:(artifact,id,lang)=>({object_id:id,generation:artifact.generation,fingerprint:artifact.fingerprint,context:{researchMarket:"EZ",toolBindingVersion:"2",periodIdentity:"3m",currencyBasis:"local",returnBasis:"price"},supportedMeasureIds:[sid],result:{read:"ok",membership:"complete",observations:[],tombstones:[]},publicationPolicies:{[sid]:policy()},display:{lang,marketLabel:"Synthetic market",toolLabel:"Synthetic tool",periodLabel:"3m",basisLabel:"local",sourceGenerationAt:null,measureLabels:{[sid]:"Synthetic measure"},unmetLabels:[]},unmetPrerequisites:[]}),parseIntlPublicationPolicies:raw=>raw as Record<string,IntlPublicationPolicy>};
 const reads=createIntlGenerationReads(codec,{fetcher,base:"https://artifact.test"});
 return {reads,codec,fetcher,files,descriptor,pin:{object_id:contextId,generation:priorId,fingerprint:digest(prior)}};
}
async function selected(change:Partial<IntlPublicationPolicy>={}){const s=setup(change),prior=(await s.reads.retained(s.pin))!;const current=await s.reads.current(contextId);expect(current).not.toBeNull();return {...s,prior,current:current!};}
const scope={principal,selectedMeasureIds:[sid]};
describe("request-local current publication policy qualification",()=>{
 it("requires an actual new current descriptor before granting any historical read",async()=>{const {reads,pin,fetcher}=setup();const prior=(await reads.retained(pin))!;expect((await reads.authorize(scope,prior)).disposition).toBe("unavailable");await reads.current(contextId);const decision=await reads.authorize(scope,prior);expect(decision).toMatchObject({...scope,disposition:"allowed",object_id:contextId,generation:priorId,fingerprint:pin.fingerprint,checkedAt:null});expect(decision.policyRevision).toMatch(/^[0-9a-f]{64}$/);expect(fetcher).toHaveBeenCalledTimes(4);});
 it("does not share policy decisions across separate request readers",async()=>{const a=await selected();expect((await a.reads.authorize(scope,a.prior)).disposition).toBe("allowed");const b=setup();expect((await b.reads.authorize(scope,a.prior)).disposition).toBe("unavailable");expect(b.fetcher).not.toHaveBeenCalled();});
 it.each([{metadata:"denied" as const},{value_permission:"denied" as const}])("current denial overrides historical allowed policy %j",async change=>{const {reads,prior}=await selected(change);expect((await reads.authorize(scope,prior)).disposition).toBe("denied");});
 it.each([{metadata:"unknown" as const},{value_permission:"unknown" as const},{policy_document_sha256:null},{policy_identity:null},{policy_ref:"another.family"}])("does not treat unknown/current-family substitution as a grant %j",async change=>{const {reads,prior}=await selected(change);expect((await reads.authorize(scope,prior)).disposition).toBe("unavailable");});
 it("refuses to silently requalify current bytes after policy identity changed",async()=>{const {reads,current}=await selected({policy_identity:"f".repeat(64)});expect((await reads.authorize(scope,current)).disposition).toBe("unavailable");});
 it("rejects anonymous, duplicate and outside-domain scope",async()=>{const {reads,prior}=await selected();for(const request of [{...scope,principal:"browser"},{...scope,selectedMeasureIds:[sid,sid]},{...scope,selectedMeasureIds:["other.measure"]}])expect((await reads.authorize(request,prior)).disposition).toBe("unavailable");});
 it("returns no current source if current descriptor sidecar is absent",async()=>{const s=setup();s.files.delete(`intl_generation_descriptor_${digest(s.descriptor)}.json`);expect(await s.reads.current(contextId)).toBeNull();});
 it("does not reuse a previously read current decision when another retained read begins",async()=>{const s=await selected();await s.reads.retained(s.pin);expect((await s.reads.authorize(scope,s.prior)).disposition).toBe("unavailable");});
 it("requires decoder acceptance separately from exact transport bytes",async()=>{const s=setup();s.codec.decodeIntlGeneration=()=>null;const reads=createIntlGenerationReads(s.codec,{fetcher:s.fetcher});expect(await reads.current(contextId)).toBeNull();});
});

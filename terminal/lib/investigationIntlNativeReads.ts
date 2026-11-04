import "server-only";
import {readIntlGenerationArtifact,readCurrentIntlGeneration,type IntlGenerationArtifact} from "./investigationIntlGeneration";
import {isIntlContextIdentity} from "./investigationIntlReference";
import type {IntlNativeGeneration,IntlNativeReads,IntlPublicationPolicy,IntlReadDecision} from "./investigationIntlOwner";

export type IntlGenerationCodec={
 decodeIntlGeneration:(artifact:IntlGenerationArtifact,contextId:string,lang:"en"|"zh")=>IntlNativeGeneration|null;
 parseIntlPublicationPolicies:(raw:unknown)=>Record<string,IntlPublicationPolicy>|null;
};
type Options={signal?:AbortSignal;fetcher?:typeof fetch;base?:string;lang?:"en"|"zh"};
const sha=(value:unknown)=>typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
/** One request-local native reader, not another cache, grant or policy registry.
 * Both historical and current reads need the SAME newly read current policy
 * descriptor. A historical publication decision never grants a current read. */
export function createIntlGenerationReads(codec:IntlGenerationCodec,options:Options={}):IntlNativeReads {
 let currentSnapshot:{generation:IntlNativeGeneration;policies:Record<string,IntlPublicationPolicy>;digest:string}|null=null;
 return {
  retained:async pin=>{
   currentSnapshot=null;
   if(!isIntlContextIdentity(pin.object_id))return null;
   const artifact=await readIntlGenerationArtifact(pin,options);
   return artifact&&!options.signal?.aborted?codec.decodeIntlGeneration(artifact,pin.object_id,options.lang??"en"):null;
  },
  current:async objectId=>{
   currentSnapshot=null;if(!isIntlContextIdentity(objectId))return null;
   const read=await readCurrentIntlGeneration(options);if(!read||options.signal?.aborted)return null;
   const policies=codec.parseIntlPublicationPolicies(read.descriptor.current_policies);
   const generation=codec.decodeIntlGeneration(read.artifact,objectId,options.lang??"en");
   if(!policies||!generation)return null;
   currentSnapshot={generation,policies,digest:read.descriptorDigest};return generation;
  },
  authorize:async(scope,value)=>{
   const snapshot=currentSnapshot;
   const decision=(disposition:IntlReadDecision["disposition"]):IntlReadDecision=>({disposition,principal:scope.principal,
    object_id:value.object_id,generation:value.generation,fingerprint:value.fingerprint,selectedMeasureIds:[...scope.selectedMeasureIds],policyRevision:snapshot?.digest??"",checkedAt:null});
   if(!snapshot||options.signal?.aborted||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(scope.principal)||scope.principal==="00000000-0000-0000-0000-000000000000"||value.object_id!==snapshot.generation.object_id
    ||!scope.selectedMeasureIds.length||scope.selectedMeasureIds.length>128||new Set(scope.selectedMeasureIds).size!==scope.selectedMeasureIds.length)return decision("unavailable");
   for(const id of scope.selectedMeasureIds){
    if(!value.supportedMeasureIds.includes(id)||!snapshot.generation.supportedMeasureIds.includes(id)
     ||!Object.hasOwn(snapshot.policies,id)||!Object.hasOwn(value.publicationPolicies,id))return decision("unavailable");
    const policy=snapshot.policies[id],captured=value.publicationPolicies[id];
    if(policy.metadata==="denied"||policy.value_permission==="denied")return decision("denied");
    if(policy.metadata!=="allowed"||policy.value_permission!=="allowed"||!policy.policy_ref||!sha(policy.policy_document_sha256)||!sha(policy.policy_identity)
     ||captured.policy_ref!==policy.policy_ref)return decision("unavailable");
    // Old bytes may be read under an applicable current policy for that exact
    // field family. Current bytes themselves must carry that current decision;
    // do not silently requalify an old current generation after policy change.
    if(value.generation===snapshot.generation.generation&&value.fingerprint===snapshot.generation.fingerprint&&captured.policy_identity!==policy.policy_identity)return decision("unavailable");
   }
   return decision("allowed");
  },
 };
}

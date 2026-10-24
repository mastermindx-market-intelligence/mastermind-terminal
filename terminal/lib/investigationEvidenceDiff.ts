/** Internal read projection over already-authorized owner observations. No storage, fetch,
 * rights grants or baseline mutation. An owner adapter must establish current authorization,
 * exact scope and completeness before supplying a census; a transport timestamp is not content. */
export type EvidenceAvailability = "available" | "stale" | "denied" | "unavailable" | "not_applicable";
export type EvidenceObservation = {
 id:string;
 availability:EvidenceAvailability;
 contentIdentity:string|null;
 qualificationIdentity:string|null;
 correction:boolean;
 excluded:boolean;
 interpretation:{value:number|null;unit:string|null;basis:string|null;cohort:string|null}|null;
};
export type EvidenceCensus = {
 scope:{owner:string;query:string;cohort:string;temporalPolicy:string};
 read:"ok"|"denied"|"unavailable";
 membership:"complete"|"page"|"top_k"|"unknown";
 generation:string;
 items:readonly EvidenceObservation[];
 /** Only explicit owner tombstones, never IDs inferred from a missing page. */
 tombstones:readonly string[];
};
type Interpretation = {comparable:true;prior:number;current:number;delta:number}
 | {comparable:false;reason:"unavailable"|"not_applicable"|"missing"|"incompatible"};
export type EvidenceChange = {
 id:string;
 membership:"present"|"added"|"removed"|"not_observed"|"not_previously_observed";
 version:"initial"|"unchanged"|"revised"|"unknown";
 qualification:"unchanged"|"changed"|"unknown";
 availability:EvidenceAvailability;
 excluded:boolean;
 correction:boolean;
 interpretation:Interpretation;
};
export type EvidenceReview = {
 schema:"investigation.evidence_review.v1";
 priorGeneration:string;
 currentGeneration:string;
 summary:"changed"|"unchanged"|"incomplete"|"scope_changed"|"denied"|"unavailable"|"invalid";
 items:EvidenceChange[];
};

function validCensus(c:EvidenceCensus):boolean {
 const ids=new Set(c.items.map(row=>row.id));
 return c.items.length<=10000 && c.tombstones.length<=10000 && ids.size===c.items.length
  && c.items.every(row=>typeof row.id==="string"&&row.id.length>0)
  && new Set(c.tombstones).size===c.tombstones.length
  && c.tombstones.every(id=>typeof id==="string"&&id.length>0&&!ids.has(id))
  && Object.values(c.scope).every(value=>typeof value==="string"&&value.length>0);
}
function interpretation(a?:EvidenceObservation,b?:EvidenceObservation):Interpretation {
 if(!a||!b||a.availability!=="available"||b.availability!=="available")return {comparable:false,reason:"unavailable"};
 const prior=a.interpretation,current=b.interpretation;
 if(!prior&&!current)return {comparable:false,reason:"not_applicable"};
 if(!prior||!current||typeof prior.value!=="number"||typeof current.value!=="number"
  ||!Number.isFinite(prior.value)||!Number.isFinite(current.value)
  ||!prior.unit||!current.unit||!prior.basis||!current.basis||!prior.cohort||!current.cohort)return {comparable:false,reason:"missing"};
 if(prior.unit!==current.unit||prior.basis!==current.basis||prior.cohort!==current.cohort)return {comparable:false,reason:"incompatible"};
 const delta=current.value-prior.value;
 if(!Number.isFinite(delta))return {comparable:false,reason:"incompatible"};
 return {comparable:true,prior:prior.value,current:current.value,delta};
}

export function reviewEvidence(prior:EvidenceCensus,current:EvidenceCensus):EvidenceReview {
 const result:EvidenceReview={schema:"investigation.evidence_review.v1",priorGeneration:prior.generation,currentGeneration:current.generation,summary:"unchanged",items:[]};
 // Denied/unavailable reads do not expose prior rows or an inferred empty current census.
 if(prior.read!=="ok"||current.read!=="ok"){
  result.summary=prior.read==="denied"||current.read==="denied"?"denied":"unavailable";return result;
 }
 if(!validCensus(prior)||!validCensus(current)){result.summary="invalid";return result;}
 if((Object.keys(prior.scope) as Array<keyof EvidenceCensus["scope"]>).some(key=>prior.scope[key]!==current.scope[key])){
  result.summary="scope_changed";return result;
 }
 const old=new Map(prior.items.map(row=>[row.id,row]));
 const now=new Map(current.items.map(row=>[row.id,row]));
 const removed=new Set(current.tombstones);
 let changed=false,incomplete=prior.membership!=="complete"||current.membership!=="complete";
 for(const id of new Set([...old.keys(),...now.keys()])){
  const a=old.get(id),b=now.get(id);
  const membership:EvidenceChange["membership"]=a&&b?"present":!b?(removed.has(id)||current.membership==="complete"?"removed":"not_observed"):(prior.membership==="complete"?"added":"not_previously_observed");
  const available=a?.availability==="available"&&b?.availability==="available";
  const version:EvidenceChange["version"]=!a&&b?.contentIdentity?"initial":available&&a?.contentIdentity&&b?.contentIdentity?(a.contentIdentity===b.contentIdentity?"unchanged":"revised"):"unknown";
  const qualification:EvidenceChange["qualification"]=a?.qualificationIdentity&&b?.qualificationIdentity?(a.qualificationIdentity===b.qualificationIdentity&&a.excluded===b.excluded&&a.correction===b.correction?"unchanged":"changed"):"unknown";
  const numeric=interpretation(a,b);
  const row:EvidenceChange={id,membership,version,qualification,availability:b?.availability??"unavailable",excluded:b?.excluded??false,correction:b?.correction??false,interpretation:numeric};
  result.items.push(row);
  if(membership==="removed"||membership==="added")changed=true;
  if(membership==="not_observed"||membership==="not_previously_observed")incomplete=true;
  if(a&&b){
   if(version==="revised"||qualification==="changed"||(numeric.comparable&&numeric.delta!==0))changed=true;
   if(version==="unknown"||qualification==="unknown"||b.availability!=="available"||(!numeric.comparable&&numeric.reason!=="not_applicable"))incomplete=true;
  }
 }
 result.summary=incomplete?"incomplete":changed?"changed":"unchanged";
 return result;
}

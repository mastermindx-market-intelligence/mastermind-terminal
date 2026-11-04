import "server-only";
import {createHash} from "node:crypto";
import {isIntlContextIdentity,isIntlGenerationIdentity,parseIntlPolicyPointsReference} from "./investigationIntlReference";
import type {IntlGenerationArtifact} from "./investigationIntlGeneration";
import type {IntlNativeGeneration,IntlPublicationPolicy} from "./investigationIntlOwner";

// Closed decoder for intl.workspace_generation.v1 producer bytes. Byte, hash
// and transport verification already happened in readIntlGenerationArtifact;
// this module re-checks document structure, rebinds the invoked context tuple,
// and normalizes native observations without inventing query, Saved, principal
// or publication clocks. Native content identities stay opaque: Python float
// bearing hashes are never recomputed here, they are only bound by the whole
// artifact digest and the qualification composition hash below. Malformed
// records reject the whole decode instead of being repaired into partial data.
type RecordOf=Record<string,unknown>;
type Permission="allowed"|"unknown"|"denied";
type Quality="qualified"|"stale"|"missing"|"denied"|"failed"|"unsupported"|"unknown";
type Availability="available"|"stale"|"denied"|"unavailable";

const SCHEMA="intl.workspace_generation.v1";
const DOCUMENT_KEYS=["schema","asof","generation","binding_version","evaluated_at","contexts","measures","policies"] as const;
const CONTEXT_KEYS=["id","market","horizon","currency_basis","return_basis","measure_ids"] as const;
const MEASURE_KEYS=["quality","reason","metadata","value_permission","value","unit","instrument","period","observation_at","calculation_at","source_reference","evidence_key"] as const;
const EVIDENCE_KEYS=["receipt_identity","publication_decision","clocks"] as const;
const DECISION_KEYS=["owner_ref","policy_ref","decision_ref","metadata","value_permission","binding"] as const;
const POLICY_KEYS=["metadata","value_permission","policy_ref","policy_document_sha256","policy_identity"] as const;
const DYNAMIC_KEYS=["value","unit","instrument","period","observation_at","calculation_at","source_reference","evidence_key"] as const;
const IDENTITY_KEYS=["content_identity","qualification_identity","policy_identity"] as const;
const QUALITIES=["qualified","stale","missing","denied","failed","unsupported","unknown"] as const;
const PERMISSIONS=["allowed","unknown","denied"] as const;
const UNSAFE_KEYS=["__proto__","constructor","prototype"];
const OWNER_REF="scripts/build_intl.py";
const QUALIFICATION_DOMAIN="intl.native_generation.qualification.v1";
const MAX_CONTEXTS=128,MAX_MEASURES=128,MAX_FIELDS=128,MAX_CLOCKS=16,MAX_NODES=10000,MAX_DEPTH=32,MAX_STRING=4096;
const HEX64=/^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN=/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const CLOCK_PATTERN=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/;
const ASCII_PATTERN=/^[\x20-\x7E]+$/;
const CONTROL_PATTERN=/[\u0000-\u001f\u007f]/;
// Supported qualified native IDs and their exact units. Unknown or unsupported
// IDs are never qualified; their unsupported quality still maps to plain
// unavailable, never to not_applicable.
const SUPPORTED_UNITS:Readonly<Record<string,string>>={"JP.yield_10y":"percent","JP.annual_current_account":"percent_gdp","EZ.policy_rate":"percent","EZ.gdp_yoy":"percent","EZ.cpi_yoy":"percent","EZ.annual_current_account":"percent_gdp","GB.policy_rate":"percent"};
// Fixed bilingual labels for the known native markets and tool binding only.
const MARKET_LABELS:Readonly<Record<string,readonly[string,string]>>={EZ:["Eurozone","欧元区"],JP:["Japan","日本"],GB:["United Kingdom","英国"]};
const MEASURE_LABELS:Readonly<Record<string,readonly[string,string]>>={"JP.yield_10y":["10-year government yield","十年期国债收益率"],"JP.annual_current_account":["Annual current account","年度经常账户"],"EZ.policy_rate":["ECB deposit facility rate","欧洲央行存款便利利率"],"EZ.gdp_yoy":["GDP year-on-year","国内生产总值同比"],"EZ.cpi_yoy":["CPI year-on-year","消费物价指数同比"],"EZ.annual_current_account":["Annual current account · extra-EA21","年度经常账户 · 欧元区21国外"],"GB.policy_rate":["Bank of England Bank Rate","英格兰银行基准利率"]};
const CLOCK_KEYS=["observation_at","calculation_at","period","vintage_at","dataset_updated_at","source_updated_at","requested_at","response_received_at","input_verified_at","committed_at"];
const periodOk=(value:unknown):boolean=>{
 if(value===null||text(value))return true;
 const p=exactKeys(value,["start","end","count","count_basis"]);
 return !!p&&(p.start===null||!!text(p.start))&&(p.end===null||!!text(p.end))&&(p.count===null||Number.isSafeInteger(p.count)&&Number(p.count)>=0)&&(p.count_basis===null||!!text(p.count_basis));
};
const TOOL_LABELS:readonly[string,string]=["InternationalMarkets","国际市场"];

const isRecord=(value:unknown):value is RecordOf=>typeof value==="object"&&value!==null&&!Array.isArray(value);
const exactKeys=(value:unknown,keys:readonly string[]):RecordOf|null=>{
 if(!isRecord(value))return null;
 const present=Object.keys(value);
 return present.length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(value,key))?value:null;
};
const text=(value:unknown):string|null=>typeof value==="string"&&value.length>0&&value.length<=MAX_STRING&&!CONTROL_PATTERN.test(value)?value:null;
const ascii=(value:unknown,max:number):string|null=>typeof value==="string"&&value.length>0&&value.length<=max&&ASCII_PATTERN.test(value)?value:null;
const hex64=(value:unknown):string|null=>typeof value==="string"&&HEX64.test(value)?value:null;
const permission=(value:unknown):Permission|null=>typeof value==="string"&&(PERMISSIONS as readonly string[]).includes(value)?value as Permission:null;
const clock=(value:unknown):string|null=>typeof value==="string"&&CLOCK_PATTERN.test(value)&&Number.isFinite(Date.parse(value))?value:null;
const marketOf=(sid:string):string=>sid.slice(0,sid.indexOf("."));

type WalkState={nodes:number};
const bounded=(value:unknown,depth:number,state:WalkState):boolean=>{
 if(++state.nodes>MAX_NODES||depth>MAX_DEPTH)return false;
 if(value===null)return true;
 const type=typeof value;
 if(type==="string")return (value as string).length<=MAX_STRING;
 if(type==="number")return Number.isFinite(value as number);
 if(type==="boolean")return true;
 if(!Array.isArray(value)&&!isRecord(value))return false;
 for(const key of Object.keys(value as RecordOf)){
  if(UNSAFE_KEYS.includes(key))return false;
  if(!bounded((value as RecordOf)[key],depth+1,state))return false;
 }
 return true;
};

const asciiJsonString=(value:string):string=>{
 let out="\"";
 for(const unit of value){
  const code=unit.codePointAt(0)!;
  if(unit==="\"")out+="\\\"";
  else if(unit==="\\")out+="\\\\";
  else if(code<0x20||code>0x7e){
   if(code<=0xffff)out+="\\u"+code.toString(16).padStart(4,"0");
   else{
    const offset=code-0x10000;
    out+="\\u"+(0xd800+(offset>>10)).toString(16).padStart(4,"0")+"\\u"+(0xdc00+(offset&0x3ff)).toString(16).padStart(4,"0");
   }
  }
  else out+=unit;
 }
 return out+"\"";
};
/** Matches the producer's Python canonicalization (sort_keys, compact
 * separators, ensure_ascii) for the ASCII tuple scalars this decoder hashes,
 * so context and qualification identities agree across runtimes. */
const canonicalJson=(value:unknown):string=>{
 if(value===null)return "null";
 if(typeof value==="string")return asciiJsonString(value);
 if(typeof value==="number"||typeof value==="boolean")return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(canonicalJson).join(",")+"]";
 if(isRecord(value))return "{"+Object.keys(value).sort().map(key=>asciiJsonString(key)+":"+canonicalJson(value[key])).join(",")+"}";
 throw new Error("non-canonical value");
};
const sha256Hex=(value:string):string=>createHash("sha256").update(value,"utf8").digest("hex");
const contextIdentity=(tuple:{market:string;horizon:string;currencyBasis:string}):string=>"intl-workspace-context:sha256:"+sha256Hex(canonicalJson({binding_version:2,currency_basis:tuple.currencyBasis,horizon:tuple.horizon,market:tuple.market,return_basis:"price"}));
/** Binds the native qualification identity to the actual native policy doc
 * identity. This is a composition hash only: it never grants permission. */
const intlQualificationIdentity=(nativeQualificationIdentity:string,policyIdentity:string):string=>sha256Hex(canonicalJson({domain:QUALIFICATION_DOMAIN,native_qualification_identity:nativeQualificationIdentity,policy_identity:policyIdentity}));

export function parseIntlPublicationPolicies(raw:unknown):Record<string,IntlPublicationPolicy>|null{
 if(!isRecord(raw))return null;
 const sids=Object.keys(raw);
 if(sids.length<1||sids.length>MAX_MEASURES)return null;
 const policies:Record<string,IntlPublicationPolicy>={};
 for(const sid of sids){
  if(UNSAFE_KEYS.includes(sid)||!IDENTIFIER_PATTERN.test(sid))return null;
  const entry=exactKeys(raw[sid],POLICY_KEYS);
  if(!entry)return null;
  const metadata=permission(entry.metadata),value_permission=permission(entry.value_permission);
  if(!metadata||!value_permission)return null;
  let policy_ref:string|null=null;
  if(entry.policy_ref!==null){policy_ref=text(entry.policy_ref);if(!policy_ref)return null;}
  let policy_document_sha256:string|null=null;
  if(entry.policy_document_sha256!==null){policy_document_sha256=hex64(entry.policy_document_sha256);if(!policy_document_sha256)return null;}
  let policy_identity:string|null=null;
  if(entry.policy_identity!==null){policy_identity=hex64(entry.policy_identity);if(!policy_identity)return null;}
  policies[sid]={metadata,value_permission,policy_ref,policy_document_sha256,policy_identity};
 }
 return policies;
}

type ParsedMeasure={
 sid:string;quality:Quality;availability:Availability;
 value:number|null;unit:string|null;observationAt:string|null;
 contentIdentity:string|null;qualificationIdentity:string|null;
};

const parseClocks=(value:unknown,qualified:boolean):RecordOf|null=>{
 if(!isRecord(value))return null;
 const names=Object.keys(value);
 if(names.some(name=>UNSAFE_KEYS.includes(name)))return null;
 if(qualified?names.length>MAX_CLOCKS:names.length!==0)return null;
 for(const name of names){
  if(!CLOCK_KEYS.includes(name)||(name==="period"?!periodOk(value[name]):value[name]!==null&&!text(value[name])))return null;
 }
 return value;
};

const parseMeasure=(sid:string,raw:unknown,generation:string,policy:IntlPublicationPolicy):ParsedMeasure|null=>{
 const entry=exactKeys(raw,["native_measure","native_evidence",...IDENTITY_KEYS]);
 if(!entry)return null;
 const native=exactKeys(entry.native_measure,MEASURE_KEYS);
 const evidence=exactKeys(entry.native_evidence,EVIDENCE_KEYS);
 if(!native||!evidence)return null;
 if(typeof native.quality!=="string"||!(QUALITIES as readonly string[]).includes(native.quality))return null;
 const quality=native.quality as Quality;
 const metadata=permission(native.metadata),value_permission=permission(native.value_permission);
 if(!metadata||!value_permission)return null;
 let reason:string|null=null;
 if(native.reason!==null){reason=text(native.reason);if(!reason)return null;}
 const qualified=quality==="qualified";
 const clocks=parseClocks(evidence.clocks,qualified);
 if(!clocks)return null;
 if(!qualified){
  // Negative rows are closed: every dynamic field, the receipt, the
  // publication decision and all three identities must be null, and clocks
  // must be empty. No clock or value may leak into a negative row.
  if(DYNAMIC_KEYS.some(key=>native[key]!==null))return null;
  if(evidence.receipt_identity!==null||evidence.publication_decision!==null)return null;
  if(IDENTITY_KEYS.some(key=>entry[key]!==null))return null;
  const denied=quality==="denied"||value_permission==="denied"||metadata==="denied"||policy.metadata==="denied"||policy.value_permission==="denied";
  return {sid,quality,availability:denied?"denied":quality==="stale"?"stale":"unavailable",value:null,unit:null,observationAt:null,contentIdentity:null,qualificationIdentity:null};
 }
 if(reason!==null)return null;
 // Qualified gates: every permission pair on the measure, its publication
 // policy and the receipt decision must be allowed; the value must be finite;
 // the unit must be the exact supported unit for this native ID.
 if(metadata!=="allowed"||value_permission!=="allowed"||policy.metadata!=="allowed"||policy.value_permission!=="allowed")return null;
 if(typeof native.value!=="number"||!Number.isFinite(native.value))return null;
 const unit=text(native.unit);
 if(!unit||SUPPORTED_UNITS[sid]!==unit)return null;
 const instrument=exactKeys(native.instrument,["kind","id","market_id"]);
 if(!instrument)return null;
 const kind=text(instrument.kind),instrumentId=text(instrument.id),instrumentMarket=ascii(instrument.market_id,64);
 if(!kind||!instrumentId||!instrumentMarket||instrumentMarket!==marketOf(sid))return null;
 const observationAt=native.observation_at===null?null:text(native.observation_at),sourceReference=text(native.source_reference);
 const evidenceKey=typeof native.evidence_key==="string"&&native.evidence_key.length<=128&&IDENTIFIER_PATTERN.test(native.evidence_key)?native.evidence_key:null;
 if(!periodOk(native.period)||(native.observation_at!==null&&!observationAt)||(native.calculation_at!==null&&!text(native.calculation_at))||!sourceReference||!evidenceKey)return null;
 const receiptKeys=sid==="EZ.policy_rate"?["artifact_sha256","provenance_sha256"]:["receipt_sha256"];
 const receiptIdentity=exactKeys(evidence.receipt_identity,receiptKeys);
 if(!receiptIdentity||receiptKeys.some(key=>!hex64(receiptIdentity[key])))return null;
 const decision=exactKeys(evidence.publication_decision,DECISION_KEYS);
 if(!decision)return null;
 if(decision.owner_ref!==OWNER_REF)return null;
 const decisionPolicyRef=text(decision.policy_ref);
 if(!decisionPolicyRef||decisionPolicyRef!==policy.policy_ref)return null;
 if(decision.decision_ref!==generation+":"+sid)return null;
 if(permission(decision.metadata)!=="allowed"||permission(decision.value_permission)!=="allowed")return null;
 const expectedBinding:RecordOf=sid==="EZ.policy_rate"?{market_id:"EZ",field:"policy_rate",instrument_id:"deposit_facility",source_id:"D.U2.EUR.4F.KR.DFR.LEV",artifact_sha256:receiptIdentity.artifact_sha256,provenance_sha256:receiptIdentity.provenance_sha256,observation_at:native.observation_at,value:native.value,unit:native.unit}:{field:sid,receipt_sha256:receiptIdentity.receipt_sha256};
 const binding=exactKeys(decision.binding,Object.keys(expectedBinding));
 if(!binding||Object.entries(expectedBinding).some(([key,value])=>binding[key]!==value))return null;
 if(sid==="EZ.policy_rate"&&instrumentId!=="deposit_facility")return null;
 const contentIdentity=hex64(entry.content_identity),nativeQualificationIdentity=hex64(entry.qualification_identity),policyIdentity=hex64(entry.policy_identity);
 if(!contentIdentity||!nativeQualificationIdentity||!policyIdentity)return null;
 if(policyIdentity!==policy.policy_identity||!policy.policy_document_sha256)return null;
 return {sid,quality,availability:"available",value:native.value,unit,observationAt,contentIdentity,qualificationIdentity:intlQualificationIdentity(nativeQualificationIdentity,policyIdentity)};
};

export function decodeIntlGeneration(artifact:IntlGenerationArtifact,contextId:string,lang:"en"|"zh"):IntlNativeGeneration|null{
 if(typeof contextId!=="string"||!isIntlContextIdentity(contextId)||(lang!=="en"&&lang!=="zh"))return null;
 if(!artifact||!isIntlGenerationIdentity(artifact.generation)||!hex64(artifact.fingerprint))return null;
 const document=artifact.document;
 if(!isRecord(document)||!bounded(document,0,{nodes:0}))return null;
 const keys=Object.keys(document);
 const hasPointsRef=keys.includes("policy_points_ref");
 // Optional additive pointer is syntax-checked only, never followed or used
 // as a policy grant by the B5 reader. Preview remains an explicit owner read.
 if(keys.length!==DOCUMENT_KEYS.length+(hasPointsRef?1:0)||keys.some(key=>!(DOCUMENT_KEYS as readonly string[]).includes(key)&&key!=="policy_points_ref"))return null;
 if(hasPointsRef&&document.policy_points_ref!==null&&!parseIntlPolicyPointsReference(document.policy_points_ref,artifact.generation))return null;
 if(document.schema!==SCHEMA||document.asof!==null||document.generation!==artifact.generation)return null;
 if(document.binding_version!==2)return null;
 const evaluatedAt=clock(document.evaluated_at);
 if(!evaluatedAt)return null;
 const policies=parseIntlPublicationPolicies(document.policies);
 if(!policies)return null;
 const measuresRaw=document.measures;
 if(!isRecord(measuresRaw))return null;
 const measureSids=Object.keys(measuresRaw);
 if(measureSids.length<1||measureSids.length>MAX_MEASURES)return null;
 // The global measure and policy domains are the same closed key set.
 const policySids=Object.keys(policies);
 if(measureSids.length!==policySids.length||measureSids.some(sid=>!Object.prototype.hasOwnProperty.call(policies,sid)))return null;
 const measures:Record<string,ParsedMeasure>={};
 for(const sid of measureSids){
  if(UNSAFE_KEYS.includes(sid)||!IDENTIFIER_PATTERN.test(sid))return null;
  const measure=parseMeasure(sid,measuresRaw[sid],artifact.generation,policies[sid]);
  if(!measure)return null;
  measures[sid]=measure;
 }
 const contextsRaw=document.contexts;
 if(!Array.isArray(contextsRaw)||contextsRaw.length<1||contextsRaw.length>MAX_CONTEXTS)return null;
 const seen=new Set<string>();
 let invoked:null|{id:string;market:string;horizon:string;currencyBasis:string;measureIds:string[]}=null;
 for(const raw of contextsRaw){
  const record=exactKeys(raw,CONTEXT_KEYS);
  if(!record)return null;
  const market=ascii(record.market,8),horizon=ascii(record.horizon,128),currencyBasis=ascii(record.currency_basis,64);
  if(!market||!horizon||!currencyBasis||record.return_basis!=="price")return null;
  if(typeof record.id!=="string"||!isIntlContextIdentity(record.id)||seen.has(record.id))return null;
  seen.add(record.id);
  // The advertised id must be exactly the hash of its own tuple.
  if(contextIdentity({market,horizon,currencyBasis})!==record.id)return null;
  const ids=record.measure_ids;
  if(!Array.isArray(ids)||ids.length>MAX_FIELDS)return null;
  const measureIds:string[]=[];
  for(const item of ids){
   if(typeof item!=="string"||!IDENTIFIER_PATTERN.test(item)||measureIds.includes(item))return null;
   if(!Object.prototype.hasOwnProperty.call(measures,item))return null;
   // Every explicit field is the same market as its context; no cross market
   // rows, no inferred tombstones for absent measures.
   if(marketOf(item)!==market)return null;
   measureIds.push(item);
  }
  if(record.id===contextId)invoked={id:record.id,market,horizon,currencyBasis,measureIds};
 }
 if(!invoked)return null;
 // Empty native domains remain empty, including configured markets without
 // an admitted macro source. A display code never grants field support.
 const label=MARKET_LABELS[invoked.market]??[invoked.market,invoked.market];
 const observations=invoked.measureIds.map(sid=>{
  const measure=measures[sid];
  return {
   id:sid,
   availability:measure.availability,
   qualified:measure.quality==="qualified",
   excluded:false,
   correction:false,
   contentIdentity:measure.contentIdentity,
   qualificationIdentity:measure.qualificationIdentity,
   value:measure.value,
   unit:measure.unit,
  };
 });
 const observedAtByMeasureId:Record<string,string|null>={};
 for(const sid of invoked.measureIds)observedAtByMeasureId[sid]=measures[sid].observationAt;
 return {
  object_id:invoked.id,
  generation:artifact.generation,
  fingerprint:artifact.fingerprint,
  context:{researchMarket:invoked.market,toolBindingVersion:"2",periodIdentity:invoked.horizon,currencyBasis:invoked.currencyBasis,returnBasis:"price"},
  supportedMeasureIds:[...invoked.measureIds],
  result:{read:"ok",membership:"complete",tombstones:[],observations},
  publicationPolicies:policies,
  display:{
   lang,
   measureLabels:Object.fromEntries(invoked.measureIds.map(sid=>[sid,MEASURE_LABELS[sid]?.[lang==="en"?0:1]??sid])),
   toolLabel:lang==="en"?TOOL_LABELS[0]:TOOL_LABELS[1],
   marketLabel:lang==="en"?label[0]:label[1],
   periodLabel:invoked.horizon,
   basisLabel:invoked.currencyBasis+"+price",
   sourceGenerationAt:null,
   observedAtByMeasureId,
   unmetLabels:[],
  },
  unmetPrerequisites:[],
 };
}

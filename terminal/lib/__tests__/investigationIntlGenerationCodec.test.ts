import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {decodeIntlGeneration,parseIntlPublicationPolicies} from "../investigationIntlGenerationCodec";
import type {IntlGenerationArtifact} from "../investigationIntlGeneration";

// Explicit synthetic producer-shaped fixtures only: no published artifact, no
// authenticated saved revision and no real policy claim is exercised here.
const GENERATION="im-workspace-generation:3f2a7c81-5b6e-4c9d-8a2b-1c2d3e4f5a6b";
const OTHER_GENERATION="im-workspace-generation:4c1d8e92-6a7b-4f3c-9d0e-5f6a7b8c9d0e";
const FINGERPRINT="b7".repeat(32);
const POLICY_SHA="cd".repeat(32);
const POLICY_REF="intl-publication/current";
const EVALUATED_AT="2026-11-04T02:51:00Z";
const OWNER_REF="scripts/build_intl.py";
const CONTENT_IDENTITY="ab".repeat(32);
const NATIVE_QUALIFICATION="ef".repeat(32);
const DEFAULT_POLICY_IDENTITY="9f".repeat(32);
const OBSERVED_AT="2026-10-31T00:00:00Z";

// Independent local re-derivation of the producer canonicalization so the
// codec's context and qualification identities are checked, not trusted.
const sha256=(value:string):string=>createHash("sha256").update(value,"utf8").digest("hex");
const canonical=(value:unknown):string=>{
 const quote=(value:string)=>JSON.stringify(value);
 if(value===null)return "null";
 if(typeof value==="string")return quote(value);
 if(typeof value==="number"||typeof value==="boolean")return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 return "{"+Object.keys(value as Record<string,unknown>).sort().map(key=>quote(key)+":"+canonical((value as Record<string,unknown>)[key])).join(",")+"}";
};
const expectedContextId=(market:string,horizon:string,currencyBasis:string):string=>"intl-workspace-context:sha256:"+sha256(canonical({binding_version:2,currency_basis:currencyBasis,horizon,market,return_basis:"price"}));
const expectedQualificationIdentity=(nativeQualificationIdentity:string,policyIdentity:string):string=>sha256(canonical({domain:"intl.native_generation.qualification.v1",native_qualification_identity:nativeQualificationIdentity,policy_identity:policyIdentity}));

type MeasureSpec={
 sid:string;market:string;quality:"qualified"|"stale"|"denied"|"missing"|"unsupported";
 unit?:string;value?:number|null;instrumentMarket?:string;
 policyIdentity?:string|null;policyRecordIdentity?:string|null;
 contentIdentity?:string|null;qualificationIdentity?:string|null;
 ownerRef?:string;decisionRef?:string|null;decisionPolicyRef?:string|null;
 decisionMetadata?:string;decisionValuePermission?:string;
 metadata?:string;valuePermission?:string;reason?:string|null;
 policyMetadata?:string;policyValuePermission?:string;
 receipt?:string|null;clocks?:Record<string,string>;
 observationAt?:string|null;period?:string|null;sourceReference?:string|null;evidenceKey?:string|null;
 policyDocumentSha256?:string|null;policyRef?:string|null;
};
// Explicit nulls must survive fixture building so malformed-qualified and
// leaky-negative rows really reach the codec as nulls.
const pick=<T,>(value:T|undefined,fallback:T):T=>value!==undefined?value:fallback;

const measureEntry=(spec:MeasureSpec):Record<string,unknown>=>{
 const qualified=spec.quality==="qualified";
 const unit=spec.unit??(spec.sid.endsWith("annual_current_account")?"percent_gdp":"percent");
 const policyIdentity=spec.policyIdentity??DEFAULT_POLICY_IDENTITY;
 return {
  native_measure:{
   quality:spec.quality,
   reason:qualified?pick(spec.reason,null):(spec.reason??"observation_stale"),
   metadata:spec.metadata??"allowed",
   value_permission:spec.valuePermission??"allowed",
   value:pick(spec.value,qualified?1.24:null),
   unit:pick(spec.unit,qualified?unit:null),
   instrument:qualified?{kind:"statistical_observation",id:spec.sid==="EZ.policy_rate"?"deposit_facility":spec.sid+":primary",market_id:pick(spec.instrumentMarket,spec.market)}:null,
   period:pick(spec.period,qualified?spec.market+".annual":null),
   observation_at:pick(spec.observationAt,qualified?OBSERVED_AT:null),
   calculation_at:qualified?"2026-11-01T12:00:00Z":null,
   source_reference:pick(spec.sourceReference,qualified?"indicator_engine/intl":null),
   evidence_key:pick(spec.evidenceKey,qualified?spec.sid+":primary":null),
  },
  native_evidence:{
   receipt_identity:pick<unknown>(spec.receipt,qualified?(spec.sid==="EZ.policy_rate"?{artifact_sha256:"1".repeat(64),provenance_sha256:"2".repeat(64)}:{receipt_sha256:"3".repeat(64)}):null),
   publication_decision:qualified?{
    owner_ref:spec.ownerRef??OWNER_REF,
    policy_ref:pick(spec.decisionPolicyRef,pick(spec.policyRef,POLICY_REF)),
    decision_ref:spec.decisionRef===null?null:pick(spec.decisionRef,GENERATION+":"+spec.sid),
    metadata:spec.decisionMetadata??"allowed",
    value_permission:spec.decisionValuePermission??"allowed",
    binding:spec.sid==="EZ.policy_rate"?{market_id:"EZ",field:"policy_rate",instrument_id:"deposit_facility",source_id:"D.U2.EUR.4F.KR.DFR.LEV",artifact_sha256:"1".repeat(64),provenance_sha256:"2".repeat(64),observation_at:pick(spec.observationAt,OBSERVED_AT),value:pick(spec.value,1.24),unit:pick(spec.unit,unit)}:{field:spec.sid,receipt_sha256:"3".repeat(64)},
   }:null,
   clocks:spec.clocks??(qualified?{observation_at:OBSERVED_AT}:{}),
  },
  content_identity:pick(spec.contentIdentity,qualified?CONTENT_IDENTITY:null),
  qualification_identity:pick(spec.qualificationIdentity,qualified?NATIVE_QUALIFICATION:null),
  policy_identity:pick(spec.policyIdentity,qualified?policyIdentity:null),
 };
};

const policyEntry=(spec:MeasureSpec):Record<string,unknown>=>({
 metadata:spec.policyMetadata??"allowed",
 value_permission:spec.policyValuePermission??"allowed",
 policy_ref:spec.policyRef===null?null:pick(spec.policyRef,POLICY_REF),
 policy_document_sha256:spec.policyDocumentSha256===null?null:pick(spec.policyDocumentSha256,POLICY_SHA),
 policy_identity:pick(spec.policyRecordIdentity,pick(spec.policyIdentity,DEFAULT_POLICY_IDENTITY)),
});

type DocumentOptions={market?:string;horizon?:string;currencyBasis?:string;contextId?:string;generation?:string;fingerprint?:string;bindingVersion?:unknown;asof?:unknown;evaluatedAt?:unknown;policyPointsRef?:unknown;omitPolicyFor?:string;extraKey?:string};
const buildArtifact=(specs:MeasureSpec[],options:DocumentOptions={}):IntlGenerationArtifact=>{
 const market=options.market??"JP",horizon=options.horizon??"annual",currencyBasis=options.currencyBasis??"JPY";
 const measures:Record<string,unknown>={},policies:Record<string,unknown>={},measureIds:string[]=[];
 for(const spec of specs){
  measures[spec.sid]=measureEntry(spec);
  policies[spec.sid]=policyEntry(spec);
  measureIds.push(spec.sid);
 }
 if(options.omitPolicyFor)delete policies[options.omitPolicyFor];
 const document:Record<string,unknown>={
  schema:"intl.workspace_generation.v1",
  asof:options.asof===undefined?null:options.asof,
  generation:options.generation??GENERATION,
  binding_version:options.bindingVersion===undefined?2:options.bindingVersion,
  evaluated_at:options.evaluatedAt===undefined?EVALUATED_AT:options.evaluatedAt,
  contexts:[{
   id:options.contextId??expectedContextId(market,horizon,currencyBasis),
   market,horizon,currency_basis:currencyBasis,return_basis:"price",measure_ids:measureIds,
  }],
  measures,policies,
 };
 if(options.policyPointsRef!==undefined)document.policy_points_ref=options.policyPointsRef;
 if(options.extraKey!==undefined)document[options.extraKey]="surprise";
 return {bytes:Buffer.byteLength(JSON.stringify(document)),generation:options.generation??GENERATION,fingerprint:options.fingerprint??FINGERPRINT,document};
};

const JP_CONTEXT=expectedContextId("JP","annual","JPY");
const EZ_CONTEXT=expectedContextId("EZ","annual","EUR");
const BASE_SPECS:MeasureSpec[]=[
 {sid:"JP.yield_10y",market:"JP",quality:"qualified",value:1.24},
 {sid:"JP.annual_current_account",market:"JP",quality:"stale"},
];
const decode=(artifact:IntlGenerationArtifact=buildArtifact(BASE_SPECS),contextId:string=JP_CONTEXT,lang:"en"|"zh"="en")=>decodeIntlGeneration(artifact,contextId,lang);

describe("decodeIntlGeneration structure",()=>{
 it("decodes the invoked context into native fields only",()=>{
  const parsed=decode();
  expect(parsed).not.toBeNull();
  expect(parsed!.object_id).toBe(JP_CONTEXT);
  expect(parsed!.generation).toBe(GENERATION);
  expect(parsed!.fingerprint).toBe(FINGERPRINT);
  expect(parsed!.context).toEqual({researchMarket:"JP",toolBindingVersion:"2",periodIdentity:"annual",currencyBasis:"JPY",returnBasis:"price"});
  expect(parsed!.supportedMeasureIds).toEqual(["JP.yield_10y","JP.annual_current_account"]);
  expect(parsed!.result.read).toBe("ok");
  expect(parsed!.result.membership).toBe("complete");
  expect(parsed!.result.tombstones).toEqual([]);
  expect(parsed!.unmetPrerequisites).toEqual([]);
  expect(Object.keys(parsed!).sort()).toEqual(["context","display","fingerprint","generation","object_id","publicationPolicies","result","supportedMeasureIds","unmetPrerequisites"]);
 });
 it("normalizes a qualified row with the composed qualification identity",()=>{
  const row=decode()!.result.observations[0];
  expect(row.id).toBe("JP.yield_10y");
  expect(row.qualified).toBe(true);
  expect(row.availability).toBe("available");
  expect(row.value).toBe(1.24);
  expect(row.unit).toBe("percent");
  expect(row.contentIdentity).toBe(CONTENT_IDENTITY);
  expect(row.qualificationIdentity).toBe(expectedQualificationIdentity(NATIVE_QUALIFICATION,DEFAULT_POLICY_IDENTITY));
  expect(row.excluded).toBe(false);
  expect(row.correction).toBe(false);
 });
 it("normalizes a negative row without dynamic or clock leakage",()=>{
  const parsed=decode();
  const stale=parsed!.result.observations[1];
  expect(stale.qualified).toBe(false);
  expect(stale.availability).toBe("stale");
  expect(stale.value).toBeNull();
  expect(stale.unit).toBeNull();
  expect(stale.contentIdentity).toBeNull();
  expect(stale.qualificationIdentity).toBeNull();
  expect(parsed!.display.observedAtByMeasureId!["JP.annual_current_account"]).toBeNull();
  expect(parsed!.display.observedAtByMeasureId!["JP.yield_10y"]).toBe(OBSERVED_AT);
 });
 it("maps negative qualities to availability without not_applicable",()=>{
  const specs:MeasureSpec[]=[
   {sid:"JP.yield_10y",market:"JP",quality:"missing"},
   {sid:"JP.annual_current_account",market:"JP",quality:"denied"},
  ];
  const rows=decode(buildArtifact(specs))!.result.observations;
  expect(rows[0].availability).toBe("unavailable");
  expect(rows[1].availability).toBe("denied");
 });
 it("maps permission denied on a negative row to denied availability",()=>{
  const specs:MeasureSpec[]=[{sid:"JP.yield_10y",market:"JP",quality:"stale",policyValuePermission:"denied"}];
  expect(decode(buildArtifact(specs))!.result.observations[0].availability).toBe("denied");
 });
 it("keeps an unsupported native id unqualified and unavailable",()=>{
  const specs:MeasureSpec[]=[
   {sid:"EZ.unknown_metric",market:"EZ",quality:"unsupported"},
   {sid:"EZ.policy_rate",market:"EZ",quality:"qualified",value:2.5},
  ];
  const parsed=decode(buildArtifact(specs,{market:"EZ",currencyBasis:"EUR"}),EZ_CONTEXT);
  expect(parsed!.result.observations[0].qualified).toBe(false);
  expect(parsed!.result.observations[0].availability).toBe("unavailable");
  expect(parsed!.result.observations[0].value).toBeNull();
  expect(parsed!.result.observations[1].qualified).toBe(true);
 });
 it("never invents a generation or publication clock in display",()=>{
  const parsed=decode();
  expect(parsed!.display.toolLabel).toBe("InternationalMarkets");
  expect(parsed!.display.marketLabel).toBe("Japan");
  expect(parsed!.display.periodLabel).toBe("annual");
  expect(parsed!.display.basisLabel).toBe("JPY+price");
  expect(parsed!.display.sourceGenerationAt).toBeNull();
  expect(parsed!.display.unmetLabels).toEqual([]);
 });
 it("labels the known native markets bilingually",()=>{
  expect(decode(buildArtifact(BASE_SPECS),JP_CONTEXT,"zh")!.display.marketLabel).toBe("日本");
  expect(decode(buildArtifact(BASE_SPECS),JP_CONTEXT,"zh")!.display.toolLabel).toBe("国际市场");
  const ez=decode(buildArtifact([{sid:"EZ.policy_rate",market:"EZ",quality:"qualified",value:2.5}],{market:"EZ",currencyBasis:"EUR"}),EZ_CONTEXT);
  expect(ez!.display.marketLabel).toBe("Eurozone");
  expect(ez!.context.researchMarket).toBe("EZ");
 });
 it("passes observation clocks through verbatim without date coercion",()=>{
  const artifact=buildArtifact([{...BASE_SPECS[0],observationAt:"2026-10-31T13:45:00Z"},BASE_SPECS[1]]);
  expect(decode(artifact)!.display.observedAtByMeasureId!["JP.yield_10y"]).toBe("2026-10-31T13:45:00Z");
 });
 it("returns hostile tuple text raw, leaving HTML escaping to the renderer",()=>{
  const horizon="<b>&amp;</b>";
  const parsed=decode(buildArtifact(BASE_SPECS,{horizon}),expectedContextId("JP",horizon,"JPY"));
  expect(parsed!.display.periodLabel).toBe("<b>&amp;</b>");
  expect(parsed!.context.periodIdentity).toBe("<b>&amp;</b>");
 });
});

describe("decodeIntlGeneration identity and binding gates",()=>{
 it("rejects a well formed context id that does not hash its tuple",()=>{
  expect(decode(buildArtifact(BASE_SPECS),"intl-workspace-context:sha256:"+"0".repeat(64))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{contextId:expectedContextId("JP","annual","USD")}))).toBeNull();
 });
 it("rejects an unknown invoked context",()=>{
  expect(decode(buildArtifact(BASE_SPECS),EZ_CONTEXT)).toBeNull();
 });
 it("rejects duplicate context ids",()=>{
  const artifact=buildArtifact(BASE_SPECS);
  const context=(artifact.document as Record<string,unknown>).contexts;
  (artifact.document as Record<string,unknown>).contexts=[...(context as unknown[]),...(context as unknown[])];
  expect(decode(artifact)).toBeNull();
 });
 it("rejects generation, binding and digest mismatches",()=>{
  const mismatched=buildArtifact(BASE_SPECS);
  (mismatched.document as Record<string,unknown>).generation=OTHER_GENERATION;
  expect(decode(mismatched)).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{bindingVersion:1}))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{bindingVersion:"2"}))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{fingerprint:"zz".repeat(32)}))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{}),JP_CONTEXT,"fr" as "en")).toBeNull();
 });
 it("rejects nonnull asof, invalid evaluated clocks and unknown document keys",()=>{
  expect(decode(buildArtifact(BASE_SPECS,{asof:"2026-11-04T00:00:00Z"}))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{evaluatedAt:"2026-11-04 02:51:00"}))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{evaluatedAt:"2026-11-04T11:51:00+09:00"}))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{extraKey:"x"}))).toBeNull();
 });
 it("rejects unsupported nonnull policy_points_ref and accepts null",()=>{
  expect(decode(buildArtifact(BASE_SPECS,{policyPointsRef:{kind:"im10",ref:"x"}}))).toBeNull();
  expect(decode(buildArtifact(BASE_SPECS,{policyPointsRef:null}))).not.toBeNull();
 });
 it("rejects cross market fields and absent measures",()=>{
  expect(decode(buildArtifact([{sid:"EZ.policy_rate",market:"EZ",quality:"qualified",value:2.5}],{market:"JP"}))).toBeNull();
  const artifact=buildArtifact(BASE_SPECS);
  ((artifact.document as Record<string,unknown>).contexts as Record<string,unknown>[])[0].measure_ids=["JP.yield_10y","JP.cpi_yoy"];
  expect(decode(artifact)).toBeNull();
 });
 it("rejects a missing policy record for a present measure",()=>{
  expect(decode(buildArtifact(BASE_SPECS,{omitPolicyFor:"JP.yield_10y"}))).toBeNull();
 });
});

describe("decodeIntlGeneration qualification gates",()=>{
 const expectRejected=(spec:MeasureSpec)=>{
  const other=BASE_SPECS[1];
  const artifact=buildArtifact([spec,other]);
  expect(decode(artifact)).toBeNull();
 };
 it("rejects malformed qualified rows instead of repairing them",()=>{
  expectRejected({...BASE_SPECS[0],value:null});
  expectRejected({...BASE_SPECS[0],unit:"bp"});
  expectRejected({...BASE_SPECS[0],instrumentMarket:"EZ"});
  expectRejected({...BASE_SPECS[0],sourceReference:null});
  expectRejected({...BASE_SPECS[0],evidenceKey:null});
  expectRejected({...BASE_SPECS[0],receipt:null});
  expectRejected({...BASE_SPECS[0],reason:"note"});
 });
 it("rejects unknown native ids claiming qualified",()=>{
  const specs:MeasureSpec[]=[
   {sid:"EZ.unknown_metric",market:"EZ",quality:"qualified",value:2.5},
   {sid:"EZ.policy_rate",market:"EZ",quality:"qualified",value:2.5},
  ];
  expect(decode(buildArtifact(specs,{market:"EZ",currencyBasis:"EUR"}),EZ_CONTEXT)).toBeNull();
 });
 it("rejects failed permission, decision and policy bindings",()=>{
  expectRejected({...BASE_SPECS[0],metadata:"unknown"});
  expectRejected({...BASE_SPECS[0],valuePermission:"denied"});
  expectRejected({...BASE_SPECS[0],policyMetadata:"denied"});
  expectRejected({...BASE_SPECS[0],policyValuePermission:"unknown"});
  expectRejected({...BASE_SPECS[0],ownerRef:"other/producer.py"});
  expectRejected({...BASE_SPECS[0],decisionRef:"im-workspace-generation:other:JP.yield_10y"});
  expectRejected({...BASE_SPECS[0],decisionPolicyRef:"intl-publication/other"});
  expectRejected({...BASE_SPECS[0],decisionMetadata:"unknown"});
  expectRejected({...BASE_SPECS[0],decisionValuePermission:"denied"});
  expectRejected({...BASE_SPECS[0],policyRef:null});
  expectRejected({...BASE_SPECS[0],policyDocumentSha256:null});
 });
 it("rejects identity mismatches against the policy record",()=>{
  expectRejected({...BASE_SPECS[0],policyIdentity:"aa".repeat(32),policyRecordIdentity:DEFAULT_POLICY_IDENTITY});
  expectRejected({...BASE_SPECS[0],policyIdentity:"not-hex"});
  expectRejected({...BASE_SPECS[0],contentIdentity:null});
  expectRejected({...BASE_SPECS[0],qualificationIdentity:null});
  expectRejected({...BASE_SPECS[0],policyIdentity:null});
 });
 it("rejects negative rows that leak dynamic fields or clocks",()=>{
  expectRejected({...BASE_SPECS[0],quality:"stale",value:1.0});
  expectRejected({...BASE_SPECS[0],quality:"stale",unit:"percent"});
  expectRejected({...BASE_SPECS[0],quality:"stale",clocks:{observation_at:OBSERVED_AT}});
  expectRejected({...BASE_SPECS[0],quality:"denied",receipt:"receipt/leak"});
  expectRejected({...BASE_SPECS[0],quality:"missing",contentIdentity:CONTENT_IDENTITY});
  expectRejected({...BASE_SPECS[0],quality:"unsupported",qualificationIdentity:NATIVE_QUALIFICATION});
 });
});

describe("qualification identity binding",()=>{
 it("changes with the policy identity at equal content",()=>{
  const changedPolicy="aa".repeat(32);
  const changed=decode(buildArtifact([{...BASE_SPECS[0],policyIdentity:changedPolicy},BASE_SPECS[1]]));
  expect(changed).not.toBeNull();
  const identity=changed!.result.observations[0].qualificationIdentity;
  expect(identity).toBe(expectedQualificationIdentity(NATIVE_QUALIFICATION,changedPolicy));
  expect(identity).not.toBe(expectedQualificationIdentity(NATIVE_QUALIFICATION,DEFAULT_POLICY_IDENTITY));
  expect(decode()!.result.observations[0].qualificationIdentity).toBe(expectedQualificationIdentity(NATIVE_QUALIFICATION,DEFAULT_POLICY_IDENTITY));
 });
 it("keeps native content identities opaque and byte bound",()=>{
  const alteredContent="77".repeat(32);
  const altered=decode(buildArtifact([{...BASE_SPECS[0],contentIdentity:alteredContent},BASE_SPECS[1]]));
  expect(altered!.result.observations[0].contentIdentity).toBe(alteredContent);
  // The opaque native content hash never enters the composed identity.
  expect(altered!.result.observations[0].qualificationIdentity).toBe(expectedQualificationIdentity(NATIVE_QUALIFICATION,DEFAULT_POLICY_IDENTITY));
 });
});

describe("parseIntlPublicationPolicies",()=>{
 it("parses the current descriptor exactly",()=>{
  const policies=parseIntlPublicationPolicies(buildArtifact(BASE_SPECS).document.policies);
  expect(policies).not.toBeNull();
  expect(policies!["JP.yield_10y"]).toEqual({metadata:"allowed",value_permission:"allowed",policy_ref:POLICY_REF,policy_document_sha256:POLICY_SHA,policy_identity:DEFAULT_POLICY_IDENTITY});
  expect(policies!["JP.annual_current_account"]).toEqual({metadata:"allowed",value_permission:"allowed",policy_ref:POLICY_REF,policy_document_sha256:POLICY_SHA,policy_identity:DEFAULT_POLICY_IDENTITY});
 });
 it("rejects malformed descriptors",()=>{
  const entry=JSON.parse(JSON.stringify({metadata:"allowed",value_permission:"allowed",policy_ref:POLICY_REF,policy_document_sha256:POLICY_SHA,policy_identity:DEFAULT_POLICY_IDENTITY}));
  expect(parseIntlPublicationPolicies(null)).toBeNull();
  expect(parseIntlPublicationPolicies([])).toBeNull();
  expect(parseIntlPublicationPolicies({})).toBeNull();
  expect(parseIntlPublicationPolicies({sid:{...entry,extra:1}})).toBeNull();
  expect(parseIntlPublicationPolicies({sid:{...entry,metadata:"maybe"}})).toBeNull();
  expect(parseIntlPublicationPolicies({sid:{...entry,value_permission:2}})).toBeNull();
  expect(parseIntlPublicationPolicies({sid:{...entry,policy_document_sha256:POLICY_SHA.toUpperCase()}})).toBeNull();
  expect(parseIntlPublicationPolicies({sid:{...entry,policy_identity:9}})).toBeNull();
  expect(parseIntlPublicationPolicies({sid:{...entry,policy_ref:""}})).toBeNull();
  const hostile=JSON.parse('{"JP.yield_10y":'+JSON.stringify(entry)+',"__proto__":'+JSON.stringify(entry)+"}");
  expect(parseIntlPublicationPolicies(hostile)).toBeNull();
  const oversized:Record<string,unknown>={};
  for(let index=0;index<129;index++)oversized["sid_"+index]=entry;
  expect(parseIntlPublicationPolicies(oversized)).toBeNull();
 });
});


describe("actual producer contract integration corrections",()=>{
 it("preserves a date-only observation and missing calculation/period clocks without inventing timestamps",()=>{
  const artifact=buildArtifact([{sid:"GB.policy_rate",market:"GB",quality:"qualified",value:3.75,period:null,observationAt:"2026-11-02",clocks:{}}],{market:"GB",horizon:"3m",currencyBasis:"local"});
  const measure=(artifact.document.measures as Record<string,Record<string,unknown>>)["GB.policy_rate"].native_measure as Record<string,unknown>;measure.calculation_at=null;
  const value=decodeIntlGeneration(artifact,expectedContextId("GB","3m","local"),"en");expect(value?.result.observations[0]).toMatchObject({availability:"available",value:3.75,unit:"percent"});expect(value?.display).toMatchObject({lang:"en",marketLabel:"United Kingdom",sourceGenerationAt:null,observedAtByMeasureId:{"GB.policy_rate":"2026-11-02"}});
 });
 it("allows explicit null observation clock but never replaces it with calculation/evaluated time",()=>{
  const value=decode(buildArtifact([{...BASE_SPECS[0],observationAt:null,period:null,clocks:{}},BASE_SPECS[1]]));expect(value?.result.observations[0].qualified).toBe(true);expect(value?.display.observedAtByMeasureId?.["JP.yield_10y"]).toBeNull();
 });
 it("validates a native typed period in its own source clock slot",()=>{
  const artifact=buildArtifact(BASE_SPECS),entry=(artifact.document.measures as Record<string,Record<string,unknown>>)["JP.yield_10y"];
  const period={start:"2025-01-01",end:"2025-12-31",count:1,count_basis:"annual_observation"};(entry.native_measure as Record<string,unknown>).period=period;(entry.native_evidence as Record<string,unknown>).clocks={period,observation_at:null};expect(decode(artifact)).not.toBeNull();(period as Record<string,unknown>).invented=true;expect(decode(artifact)).toBeNull();
 });
 it("rejects receipt family substitution and an unbound numeric ECB decision",()=>{
  const artifact=buildArtifact([{sid:"EZ.policy_rate",market:"EZ",quality:"qualified",value:2.5}],{market:"EZ",currencyBasis:"EUR"}),entry=(artifact.document.measures as Record<string,Record<string,unknown>>)["EZ.policy_rate"],evidence=entry.native_evidence as Record<string,unknown>;
  expect(decode(artifact,EZ_CONTEXT)).not.toBeNull();const decision=evidence.publication_decision as Record<string,unknown>;(decision.binding as Record<string,unknown>).value=2.6;expect(decode(artifact,EZ_CONTEXT)).toBeNull();(decision.binding as Record<string,unknown>).value=2.5;evidence.receipt_identity={receipt_sha256:"1".repeat(64)};expect(decode(artifact,EZ_CONTEXT)).toBeNull();
 });
 it("binds the selected EZ domain without dropping an explicitly supported independent GB context",()=>{
  const artifact=buildArtifact([{sid:"EZ.gdp_yoy",market:"EZ",quality:"qualified"}],{market:"EZ",currencyBasis:"EUR"});
  const gb=buildArtifact([{sid:"GB.policy_rate",market:"GB",quality:"qualified"}],{market:"GB",currencyBasis:"local"});
  Object.assign(artifact.document.measures as object,gb.document.measures);Object.assign(artifact.document.policies as object,gb.document.policies);(artifact.document.contexts as unknown[]).push(...gb.document.contexts as unknown[]);
  expect(decode(artifact,EZ_CONTEXT)?.supportedMeasureIds).toEqual(["EZ.gdp_yoy"]);expect(decode(artifact,expectedContextId("GB","annual","local"))?.supportedMeasureIds).toEqual(["GB.policy_rate"]);
 });
});


it("retains actual configured empty domains without adding a supported measure",()=>{
 const artifact=buildArtifact(BASE_SPECS);(artifact.document.contexts as unknown[]).push({id:expectedContextId("KR","3m","local"),market:"KR",horizon:"3m",currency_basis:"local",return_basis:"price",measure_ids:[]});
 expect(decode(artifact)).not.toBeNull();const empty=decode(artifact,expectedContextId("KR","3m","local"));expect(empty?.supportedMeasureIds).toEqual([]);expect(empty?.result.observations).toEqual([]);
});

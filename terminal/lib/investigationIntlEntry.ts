import {INTL_EVIDENCE_OWNER,INTL_SUBJECT_OWNER,parseIntlEvidenceReference,isIntlContextIdentity,isIntlGenerationIdentity} from "./investigationIntlReference";
import type {InvestigationEvidenceRef,InvestigationSubject} from "./investigationContracts";
/** Navigation selectors only. The authenticated baseline owner qualifies all
 * references; a valid URL is not source access or an admitted draft. */
export type IntlEntrySelectors={context:string;generation:string;fingerprint:string;fields:string[]};
type Query=Record<string,string|string[]|undefined>;
export const INTL_ENTRY_URL_LIMIT=2048;
export type IntlReturnContext={researchMarket:string;periodIdentity:string;currencyBasis:string;returnBasis:string};
/** Navigation market is not the evidence subject: a JP-focused overview may
 * open an EZ row. Only the authenticated baseline sets that subject/pin. Keep
 * duration/currency/return dimensions aligned; no return parameter is a grant. */
export function safeIntlReturn(value:unknown,context?:IntlReturnContext):string|null {
 if(typeof value!=="string"||value.length>INTL_ENTRY_URL_LIMIT||/[\u0000-\u0020\u007f\\%#]/.test(value))return null;
 try{const url=new URL(value),keys=[...url.searchParams.keys()];
  if(url.href!==value||url.origin!=="https://www.mastermind-x.com"||url.pathname!=="/intl.html"||url.username||url.password||url.hash
   ||keys.length<5||keys.length>7||new Set(keys).size!==keys.length||keys.some(k=>!["view","market","horizon","basis","return_basis","pins","group"].includes(k))
   ||!["macro","risk"].includes(url.searchParams.get("view")!)||!/^[A-Z]{2,3}$/.test(url.searchParams.get("market")!)
   ||!/^[1-9][0-9]{0,2}[dwmy]$/.test(url.searchParams.get("horizon")!)||!["local","usd_unhedged"].includes(url.searchParams.get("basis")!)||url.searchParams.get("return_basis")!=="price")return null;
  const pins=url.searchParams.get("pins"),members=pins?pins.split(","):[];
  if(members.length>4||new Set(members).size!==members.length||members.some(m=>!/^[A-Z]{2,3}$/.test(m))||(url.searchParams.has("group")&&url.searchParams.get("group")!==""))return null;
  if(context&&(url.searchParams.get("horizon")!==context.periodIdentity||url.searchParams.get("basis")!==context.currencyBasis||url.searchParams.get("return_basis")!==context.returnBasis))return null;
  return value;
 }catch{return null;}
}
export function parseIntlEntry(query:Query):{kind:"absent"}|{kind:"invalid"}|{kind:"entry";value:IntlEntrySelectors}{
 const keys=Object.keys(query).filter(k=>k.startsWith("intl_")&&k!=="intl_return");
 if(!keys.length)return {kind:"absent"};
 if(keys.length!==4||keys.some(k=>!["intl_context","intl_generation","intl_fingerprint","intl_field"].includes(k)))return {kind:"invalid"};
 const transport=new URLSearchParams({view:"investigations"});
 for(const [key,value] of Object.entries(query))if(key.startsWith("intl_"))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])transport.append(key,item);
 if(("/analysis?"+transport).length>INTL_ENTRY_URL_LIMIT)return {kind:"invalid"};
 const {intl_context:context,intl_generation:generation,intl_fingerprint:fingerprint,intl_field:raw}=query;
 const fields=typeof raw==="string"?[raw]:raw;
 if(!isIntlContextIdentity(context)||!isIntlGenerationIdentity(generation)
  ||typeof fingerprint!=="string"||!/^[0-9a-f]{64}$/.test(fingerprint)||!Array.isArray(fields)||!fields.length||fields.length>128||new Set(fields).size!==fields.length
  ||fields.some(field=>typeof field!=="string"||!/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(field)))return {kind:"invalid"};
 return {kind:"entry",value:{context,generation,fingerprint,fields:[...fields]}};
}
export function intlBaselineUrl(value:IntlEntrySelectors):string {
 const query=new URLSearchParams({kind:"international",context:value.context,generation:value.generation,fingerprint:value.fingerprint});
 value.fields.forEach(field=>query.append("field",field));return `/api/investigations/baseline?${query}`;
}
/** Existing baseline endpoint's closed selector vocabulary. Repeated fields
 * are ordered selection, while duplicate identity-bearing keys are refused. */
export function parseIntlBaselineSelectors(query:URLSearchParams):IntlEntrySelectors|null {
 const keys=[...query.keys()];
 if(query.get("kind")!=="international"||keys.some(k=>!["kind","context","generation","fingerprint","field"].includes(k))
  ||["kind","context","generation","fingerprint"].some(k=>query.getAll(k).length!==1))return null;
 const parsed=parseIntlEntry({intl_context:query.get("context")!,intl_generation:query.get("generation")!,intl_fingerprint:query.get("fingerprint")!,intl_field:query.getAll("field")});
 return parsed.kind==="entry"?parsed.value:null;
}
export type IntlDraftSource={refs:InvestigationEvidenceRef[];subject:InvestigationSubject;baseline:InvestigationEvidenceRef;context:IntlReturnContext};
export function parseIntlBaselineReply(raw:unknown,selection:IntlEntrySelectors):IntlDraftSource|null {
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
 const value=raw as Record<string,unknown>;
 if(value.status!=="international_baseline"||!Array.isArray(value.refs)||value.refs.length!==selection.fields.length)return null;
 const refs=value.refs.map(parseIntlEvidenceReference);
 if(refs.some((ref,i)=>!ref||ref.owner!==INTL_EVIDENCE_OWNER||ref.object_id!==selection.context||ref.version_ref!==selection.generation||ref.fingerprint!==selection.fingerprint||ref.selection?.field!==selection.fields[i]))return null;
 if(!value.subject||typeof value.subject!=="object"||Array.isArray(value.subject))return null;
 const subject=value.subject as InvestigationSubject;
 if(Object.keys(subject).length!==3||subject.owner!==INTL_SUBJECT_OWNER||subject.kind!=="economy"||subject.object_id!==selection.context)return null;
 if(!value.context||typeof value.context!=="object"||Array.isArray(value.context))return null;
 const context=value.context as IntlReturnContext;
 if(Object.keys(context).length!==4||Object.keys(context).some(k=>!["researchMarket","periodIdentity","currencyBasis","returnBasis"].includes(k))||Object.values(context).some(v=>typeof v!=="string"||!v.length))return null;
 const admitted=refs as InvestigationEvidenceRef[];
 const baseline=parseIntlEvidenceReference(value.baseline);
 if(!baseline||!admitted.some(ref=>ref.object_id===baseline.object_id&&ref.version_ref===baseline.version_ref&&ref.fingerprint===baseline.fingerprint&&ref.selection?.field===baseline.selection?.field))return null;
 return {refs:admitted,subject,baseline,context};
}

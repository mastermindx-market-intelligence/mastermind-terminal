import {INTL_CALLER_DISPOSITIONS,resolveIntlInvestigation,type IntlCallerInput} from "./intlInvestigationCaller";
import {INTL_EVIDENCE_OWNER,parseIntlEvidenceReference} from "./investigationIntlReference";
import type {InvestigationManifest} from "./investigationContracts";
import type {InvestigationIntlRead} from "../components/research/InvestigationIntlEvidence";
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
/** Private BFF response tied to the acknowledged native record. It is not a
 * public packet, admission receipt or replacement for the native auth fence. */
export function parseIntlSelectedRead(raw:unknown,detail:{id:string;revision:number;committed_at:string;manifest:InvestigationManifest}):ReturnType<InvestigationIntlRead>{
 if(!record(raw)||raw.status!=="international"||raw.id!==detail.id||raw.revision!==detail.revision||!record(raw.input))return null;
 const input=raw.input;
 if(input.disposition!=="resolved"){
  return Object.keys(input).length===1&&INTL_CALLER_DISPOSITIONS.some(d=>d===input.disposition)?{selection:{id:detail.id,revision:detail.revision},input:input as IntlCallerInput}:null;
 }
 const baseline=parseIntlEvidenceReference(detail.manifest.review_baseline_ref);
 const selected=record(input.exactContext)?input.exactContext.selectedMeasureIds:null;
 const fields=detail.manifest.evidence_refs.filter(ref=>ref.owner===INTL_EVIDENCE_OWNER).map(ref=>ref.selection?.field);
 if(!baseline||!record(input.owner)||!record(input.exactContext)||!record(input.current)||!record(input.prior)
  ||input.owner.question!==detail.manifest.intent.question||input.owner.savedAt!==detail.committed_at
  ||input.exactContext.query!==detail.manifest.intent.question||input.current.query!==detail.manifest.intent.question||input.prior.query!==detail.manifest.intent.question
  ||input.prior.generation!==baseline.version_ref||!Array.isArray(selected)
  ||fields.length!==selected.length||fields.some((field,i)=>field!==selected[i]))return null;
 try{const checked=resolveIntlInvestigation(input as IntlCallerInput);
  if(checked.kind!=="resolved"||!checked.composition.ok)return null;
  return {selection:{id:detail.id,revision:detail.revision},input:input as IntlCallerInput};
 }catch{return null;}
}

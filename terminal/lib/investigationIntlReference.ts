import type {InvestigationEvidenceRef,InvestigationManifest} from "./investigationContracts";

// Application namespaces, never a vendor permission or a source-use grant.
export const INTL_EVIDENCE_OWNER="intl.workspace_generation";
export const INTL_EVIDENCE_TYPE="selected_generation";
export const INTL_SUBJECT_OWNER="intl.workspace_context";
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export const isIntlContextIdentity=(v:unknown):v is string=>typeof v==="string"&&/^intl-workspace-context:sha256:[0-9a-f]{64}$/.test(v);
export const isIntlGenerationIdentity=(v:unknown):v is string=>typeof v==="string"&&/^im-workspace-generation:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);

/** Existing evidence envelope, pinned to exact public bytes and one measure.
 * Existence, current permission and authenticated ownership are separate reads. */
export function parseIntlEvidenceReference(raw:unknown):InvestigationEvidenceRef|null {
 if(!record(raw)||Object.keys(raw).length!==7||Object.keys(raw).some(k=>!["owner","object_type","object_id","mode","version_ref","fingerprint","selection"].includes(k))
  ||raw.owner!==INTL_EVIDENCE_OWNER||raw.object_type!==INTL_EVIDENCE_TYPE||raw.mode!=="pinned"
  ||!isIntlContextIdentity(raw.object_id)||!isIntlGenerationIdentity(raw.version_ref)||typeof raw.fingerprint!=="string"||!/^[0-9a-f]{64}$/.test(raw.fingerprint)
  ||!record(raw.selection)||Object.keys(raw.selection).length!==1||typeof raw.selection.field!=="string"||!/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(raw.selection.field))return null;
 return raw as InvestigationEvidenceRef;
}

/** Narrow reviewed v3 extension. Never loosens v1/v2 or unrelated namespaces. */
export function validIntlManifestReferences(manifest:InvestigationManifest):boolean {
 const refs=manifest.evidence_refs.filter(r=>r.owner===INTL_EVIDENCE_OWNER);
 const subjects=manifest.intent.subjects.filter(s=>s.owner===INTL_SUBJECT_OWNER);
 const baseline=manifest.review_baseline_ref;
 if(!refs.length)return !subjects.length&&baseline?.owner!==INTL_EVIDENCE_OWNER;
 if(manifest.schema!=="investigation_manifest.v3"||subjects.length!==1)return false;
 const first=parseIntlEvidenceReference(refs[0]);if(!first)return false;
 const subject=subjects[0];
 if(subject.kind!=="economy"||subject.object_id!==first.object_id||(subject.version_ref!==undefined&&subject.version_ref!==first.version_ref))return false;
 const fields=new Set<string>();
 for(const raw of refs){const ref=parseIntlEvidenceReference(raw);
  if(!ref||ref.object_id!==first.object_id||ref.version_ref!==first.version_ref||ref.fingerprint!==first.fingerprint||fields.has(ref.selection!.field))return false;
  fields.add(ref.selection!.field);
 }
 if(baseline?.owner===INTL_EVIDENCE_OWNER){
  const ref=parseIntlEvidenceReference(baseline);
  if(!ref||ref.object_id!==first.object_id||ref.version_ref!==first.version_ref||ref.fingerprint!==first.fingerprint||!fields.has(ref.selection!.field))return false;
 }
 return true;
}


/** Additive native publication pointer only, never a Saved reference or grant.
 * The B5 reader validates it without following it. Macro owns the sole preview
 * engine and current policy/series qualification. Mirrors3998a2d producer. */
export type IntlPolicyPointsReference={artifact_name:string;artifact_sha256:string;artifact_bytes:number;mapping_identity:string;qualification_identity:string};
export function parseIntlPolicyPointsReference(raw:unknown,generation:string):IntlPolicyPointsReference|null{
 if(!isIntlGenerationIdentity(generation)||!record(raw)||Object.keys(raw).length!==5
  ||Object.keys(raw).some(k=>!["artifact_name","artifact_sha256","artifact_bytes","mapping_identity","qualification_identity"].includes(k))
  ||![raw.artifact_sha256,raw.mapping_identity,raw.qualification_identity].every(v=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v))
  ||!Number.isSafeInteger(raw.artifact_bytes)||Number(raw.artifact_bytes)<1||Number(raw.artifact_bytes)>4*1024*1024
  ||raw.artifact_name!==`intl_policy_points_${generation.slice("im-workspace-generation:".length)}_${raw.artifact_sha256}.json`)return null;
 return raw as IntlPolicyPointsReference;
}

// Controlled metadata only; no investor/source-byte or runtime rights proof.
import { parseInvestigationCommand, investigationCanonicalRequest, type InvestigationNativeReceipt } from "../investigations";
export const principal="10000000-0000-4000-8000-000000000001";
export const owner=`account:${principal}`;
export const command=parseInvestigationCommand({id:"20000000-0000-4000-8000-000000000002",operation_id:"30000000-0000-4000-8000-000000000003",expected_revision:0,action:"create" as const,
 manifest:{schema:"investigation_manifest.v2" as const,intent:{title:"Original",question:"After possible private PUT",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{},argument_relations:[],scenario_capture:{
 schema:"investigation_scenario_reference.v1",model_version:"exposure-scenario/v1",inputs:{targetSpot:600,deltaSigmaPts:1,days:1},
 source:{owner:"options_hub",root:"SPX",session:"2026-10-16",source_as_of:"2026-10-16t15:30:00z",evaluated_at:"2026-10-16T15:45:00Z",lens:{kind:"one",exp:"2026-10-30"},selection_key:"2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",basis_sha256:"a".repeat(64),gex:{sha256:"b".repeat(64),byte_length:2048},moves:null}}}})!;

export const generation="40000000-0000-4000-8000-000000000004";
export function native(phase:"started"|"retained"="retained",status:"pending"|"not_applied"|"committed"="not_applied"): InvestigationNativeReceipt {
 return {status:"found",schema:"investigation.native_capture.v1",id:command.id,
 binding:{actor:principal,operation_id:command.operation_id,issuer:"https://project-fixture.invalid/auth/v1",auth_epoch:"50000000-0000-4000-8000-000000000005",request_sha256:"a".repeat(64),source_binding_sha256:"b".repeat(64)},
 generation,native_phase:phase,canonical_status:status,request:investigationCanonicalRequest(command,principal)};
}
export const fence={status:"not_applied",id:command.id,operation_id:command.operation_id};
export const committed={status:"committed",id:command.id,investigation_id:command.id,operation_id:command.operation_id,
 author_ref:principal,revision:1,sequence:1,revision_id:generation,parent_revision_id:null,manifest_digest:"c".repeat(64),
 committed_at:"2026-11-05T01:00:00Z",recorded_at:"2026-11-05T01:00:00Z",lifecycle:"active",manifest:command.manifest};
export const bound=(row=native(),canonical:unknown={...fence,read_binding:"stored_no_effect",read_principal:principal,read_operation_id:command.operation_id})=>
 ({...row,read_binding:"native_participant",read_principal:principal,read_operation_id:command.operation_id,canonical});

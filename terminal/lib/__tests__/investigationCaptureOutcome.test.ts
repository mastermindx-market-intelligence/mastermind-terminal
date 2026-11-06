import { parseInvestigationCommand } from "../investigations";
import { expect, it } from "vitest";
import { beginInvestigationSave, settleInvestigationOperationRead, retryInvestigationSave } from "../investigationSave";
import { retainInvestigationJournal, readInvestigationJournal, clearRejectedInvestigationJournal, retainInvestigationCaptureUnknown } from "../investigationJournal";
const principal="10000000-0000-4000-8000-000000000001", owner=`account:${principal}`;
const command=parseInvestigationCommand({id:"20000000-0000-4000-8000-000000000002",operation_id:"30000000-0000-4000-8000-000000000003",expected_revision:0,action:"create" as const,
 manifest:{schema:"investigation_manifest.v2" as const,intent:{title:"Original",question:"After possible private PUT",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{},scenario_capture:{
 schema:"investigation_scenario_reference.v1",model_version:"exposure-scenario/v1",inputs:{targetSpot:600,deltaSigmaPts:1,days:1},
 source:{owner:"options_hub",root:"SPX",session:"2026-10-16",source_as_of:"2026-10-16t15:30:00z",evaluated_at:"2026-10-16T15:45:00Z",lens:{kind:"one",exp:"2026-10-30"},selection_key:"2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",basis_sha256:"a".repeat(64),gex:{sha256:"b".repeat(64),byte_length:2048},moves:null}}}})!;
const fence={status:"not_applied",id:command.id,operation_id:command.operation_id,read_principal:principal,read_operation_id:command.operation_id,read_binding:"stored_no_effect"};
const pending=()=>beginInvestigationSave(owner,command,{phase:"idle"});
const store=()=>{const data=new Map<string,string>();return{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};};
it("keeps loss-after-private-PUT and zero returned handlers UNKNOWN despite a canonical DB fence",()=>{
 // A returned handler/count is no producer-settlement input. No network/PUT
 // is performed; this models the actual possible-effect failure boundary.
 const state=settleInvestigationOperationRead(pending(),owner,fence);
 expect(state).toMatchObject({phase:"uncertain",captureOutcome:"unknown_after_canonical_not_applied",command});
 expect(retryInvestigationSave(state,owner)).toBeNull();
 expect(beginInvestigationSave(owner,{...command,operation_id:command.id},state)).toBe(state);
 const later=settleInvestigationOperationRead(state,owner,{status:"not_found"});
 expect(later).toMatchObject({phase:"uncertain",captureOutcome:"unknown_after_canonical_not_applied"});
 expect(retryInvestigationSave(later,owner)).toBeNull();
});
it("retains the exact journal, denies new-draft authority and keeps conservative suppression on reload",()=>{
 const storage=store();retainInvestigationJournal(storage,owner,command);
 const state=settleInvestigationOperationRead(pending(),owner,fence);
 retainInvestigationCaptureUnknown(storage,owner,state);
 const restored=readInvestigationJournal(storage,owner);
 expect(restored).toMatchObject({status:"retained",state:{phase:"uncertain",captureOutcome:"unknown_after_canonical_not_applied",command}});
 if(restored.status!=="retained")throw Error("retained fixture required");
 expect(retryInvestigationSave(restored.state,owner)).toBeNull();
 expect(()=>clearRejectedInvestigationJournal(storage,owner,state)).toThrow();
 expect(()=>retainInvestigationJournal(storage,owner,{...command,operation_id:command.id},state)).toThrow();
 const staleLocal={phase:"rejected" as const,principal:owner,command,reason:"not_applied"};
 expect(()=>clearRejectedInvestigationJournal(storage,owner,staleLocal)).toThrow();
 expect(()=>retainInvestigationJournal(storage,owner,{...command,operation_id:command.id},staleLocal)).toThrow();
});

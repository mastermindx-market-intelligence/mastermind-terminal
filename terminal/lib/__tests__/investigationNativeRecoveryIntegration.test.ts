import { expect,it } from "vitest";
import { beginInvestigationSave,recoverInvestigationSave,settleInvestigationOperationRead,settleInvestigationSave,retryInvestigationSave,investigationOperationReadRequest,investigationNativeObservationLabel } from "../investigationSave";
import { investigationCanonicalRequest, parseInvestigationCommand, parseInvestigationNativeReceipt, readInvestigationNativeOperation } from "../investigations";
import { readInvestigationJournal,retainInvestigationJournal,retainInvestigationCaptureUnknown,clearRejectedInvestigationJournal } from "../investigationJournal";
import { principal,owner,command,native,bound,fence,committed } from "./investigationNativeRecovery.fixture";
const pending=()=>beginInvestigationSave(owner,command,{phase:"idle"});
const store=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}};
it("reads original full command from the native producer then canonical receipt without any mutation",async()=>{
 const calls:string[]=[];const db={rpc:async(name:string)=>{calls.push(name);return {data:name==="read_investigation_native_capture_v1"?native():fence,error:null}}};
 const reply=await readInvestigationNativeOperation(db,command,principal);
 const settled=settleInvestigationOperationRead(pending(),owner,reply);
 expect(settled).toMatchObject({phase:"rejected",reason:"not_applied",nativeObservation:{native_phase:"retained"}});
 expect(calls).toEqual(["read_investigation_native_capture_v1","read_investigation_operation_v2"]);
 expect(retryInvestigationSave(settled,owner)).toBeNull();
 const storage=store();retainInvestigationJournal(storage,owner,command);
 clearRejectedInvestigationJournal(storage,owner,settled);expect(readInvestigationJournal(storage,owner).status).toBe("empty");
});
it("requires live bound settlement again on reload; local rejected/native payload never confers clearance",()=>{
 const storage=store();retainInvestigationJournal(storage,owner,command);
 const settled=settleInvestigationOperationRead(pending(),owner,bound());
 const recovered=readInvestigationJournal(storage,owner);expect(recovered.status).toBe("retained");
 if(recovered.status!=="retained")throw Error("fixture");
 expect(recovered.state.phase).toBe("uncertain");
 expect(()=>clearRejectedInvestigationJournal(storage,owner,recovered.state)).toThrow();
 expect(()=>clearRejectedInvestigationJournal(storage,owner,{phase:"rejected",principal:owner,command,reason:"not_applied"})).toThrow();
 expect(settleInvestigationOperationRead(recovered.state,owner,bound())).toEqual(settled);
});
it.each([["started","pending"],["started","not_applied"],["retained","pending"]] as const)("keeps %s/%s incomplete and suppresses retry",(phase,status)=>{
 const state=settleInvestigationOperationRead(pending(),owner,bound(native(phase,status)));
 expect(state).toMatchObject({phase:"uncertain",captureOutcome:"native_participant_unresolved"});expect(retryInvestigationSave(state,owner)).toBeNull();
 const storage=store();retainInvestigationJournal(storage,owner,command);retainInvestigationCaptureUnknown(storage,owner,state);
 const restored=readInvestigationJournal(storage,owner);expect(restored).toMatchObject({status:"retained",state:{phase:"uncertain",captureOutcome:"native_participant_unresolved"}});
 expect(()=>clearRejectedInvestigationJournal(storage,owner,state)).toThrow();
 expect(investigationNativeObservationLabel(state,"en")).toContain("does not grant current private-source access");
});
it("accepts native+canonical matching commit, never a merely completed private phase",()=>{
 const result={...committed,read_binding:"native_lineage",read_principal:principal,read_operation_id:command.operation_id};
 expect(settleInvestigationOperationRead(pending(),owner,bound(native("retained","committed"),result))).toMatchObject({phase:"committed",receiptBinding:"native_lineage"});
 for(const canonical of [null,{status:"unavailable"},{...result,revision:2},{...result,read_principal:command.id},fence])
  expect(settleInvestigationOperationRead(pending(),owner,bound(native("retained","committed"),canonical)).phase).toBe("uncertain");
});
it("preserves historic producer epoch without equating it to a reauthenticated reader",()=>{
 const row=native();row.binding.auth_epoch="90000000-0000-4000-8000-000000000009";
 expect(settleInvestigationOperationRead(pending(),owner,bound(row))).toMatchObject({phase:"rejected",nativeObservation:{binding:{auth_epoch:row.binding.auth_epoch}}});
 expect(settleInvestigationOperationRead(pending(),`account:${command.id}`,bound()).phase).toBe("idle");
});
it.each(["generation","epoch","request","principal","operation","partial","extra","regression"])("refuses %s drift without clearing original journal",kind=>{
 const first=settleInvestigationOperationRead(pending(),owner,bound(native("retained","pending")));
 const reply=bound();
 if(kind==="generation")reply.generation=command.id;
 if(kind==="epoch")reply.binding.auth_epoch=command.id;
 if(kind==="request")reply.request={...reply.request,layout_capture:{}};
 if(kind==="principal")reply.read_principal=command.id;
 if(kind==="operation")reply.read_operation_id=command.id;
 if(kind==="partial")delete (reply as Record<string,unknown>).generation;
 if(kind==="extra")(reply as Record<string,unknown>).ready=true;
 if(kind==="regression")reply.native_phase="started";
 const next=settleInvestigationOperationRead(first,owner,reply);
 expect(next.phase).toBe("uncertain");expect(retryInvestigationSave(next,owner)).toBeNull();
});
it("does not let a late canonical answer erase a native observation; old/absent operations stay unknown",()=>{
 const state=settleInvestigationOperationRead(pending(),owner,bound(native("started","not_applied")));
 expect(settleInvestigationSave(state,owner,committed)).toMatchObject({phase:"uncertain",nativeObservation:{native_phase:"started"}});
 for(const reply of [{status:"not_found"},{status:"unavailable"},{status:"unauthenticated"},null])
  expect(settleInvestigationOperationRead(state,owner,reply)).toMatchObject({phase:"uncertain",nativeObservation:{native_phase:"started"}});
});
it("uses bounded body-based read for scenario and preserves legacy research GET",()=>{
 const read=investigationOperationReadRequest(command,owner);
 expect(read.url).toBe("/api/investigations/operation-read");expect(read.init?.method).toBe("POST");expect(JSON.parse(String(read.init?.body))).toEqual(command);
 const manifest={...command.manifest};delete manifest.scenario_capture;
 const legacy=investigationOperationReadRequest({...command,manifest},owner);
 expect(legacy.url).toContain("?operation_id=");expect(legacy.init).toBeUndefined();
});

it("binds a supported screen capture without allowing partial native receipts to settle it",async()=>{
 const screen={screen_id:"a".repeat(32),expected_revision:7};
 const selected={...command,screen_capture:screen};
 expect(parseInvestigationCommand(selected)).toEqual(selected);
 expect(investigationCanonicalRequest(selected,principal)).toHaveProperty("screen_capture",screen);
 expect(parseInvestigationNativeReceipt(native(),selected,principal)).toBeNull();
 const calls:{name:string,args:Record<string,unknown>}[]=[];
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:native(),error:null}}};
 const result=await readInvestigationNativeOperation(db,selected,principal);
 expect(result).toEqual({status:"unavailable"});
 expect(calls).toEqual([{name:"read_investigation_native_capture_v1",args:{p_operation_id:selected.operation_id,p_request:investigationCanonicalRequest(selected,principal)}}]);
 const pendingScreen=beginInvestigationSave(owner,selected,{phase:"idle"});
 expect(settleInvestigationOperationRead(pendingScreen,owner,bound()).phase).toBe("uncertain");
 const full=native();full.request=investigationCanonicalRequest(selected,principal);
 expect(parseInvestigationNativeReceipt(full,selected,principal)).not.toBeNull();
 expect(parseInvestigationNativeReceipt(full,{...selected,screen_capture:{...screen,expected_revision:8}},principal)).toBeNull();
 expect(parseInvestigationNativeReceipt(full,selected,command.id)).toBeNull();
 const storage=store();retainInvestigationJournal(storage,owner,selected);
 const unresolved=settleInvestigationOperationRead(pendingScreen,owner,bound());
 expect(()=>clearRejectedInvestigationJournal(storage,owner,unresolved)).toThrow();
 expect(readInvestigationJournal(storage,owner)).toMatchObject({status:"retained",state:{command:selected}});
});

it("preserves both legacy owner and native obligations across failed checks/reload; only exact canonical answers advance to native read",()=>{
 const state=recoverInvestigationSave(owner,{owner,command,phase:"rejected",reason:"invalid_payload"})!;
 expect(state).toMatchObject({phase:"uncertain",ownerRecheck:true,captureOutcome:"unknown_after_canonical_refusal"});
 const storage=store();retainInvestigationJournal(storage,owner,command);
 for(const reply of [{status:"unavailable"},{...committed,id:command.operation_id},{status:"invalid_payload"},{status:"not_applied",id:command.operation_id,operation_id:command.operation_id}]){
  const next=settleInvestigationSave(state,owner,reply);
  expect(next).toMatchObject({phase:"uncertain",ownerRecheck:true});
  retainInvestigationCaptureUnknown(storage,owner,next);
  expect(readInvestigationJournal(storage,owner)).toMatchObject({status:"retained",state:{ownerRecheck:true,captureOutcome:"unknown_after_canonical_refusal"}});
  expect(retryInvestigationSave(next,owner)).toBeNull();expect(()=>clearRejectedInvestigationJournal(storage,owner,next)).toThrow();
 }
 for(const reply of [committed,{status:"not_applied",id:command.id,operation_id:command.operation_id}]){
  const next=settleInvestigationSave(state,owner,reply);
  expect(next).toMatchObject({phase:"uncertain",captureOutcome:"unknown_after_canonical_refusal"});
  expect(next).not.toHaveProperty("ownerRecheck");expect(retryInvestigationSave(next,owner)).toBeNull();
  expect(()=>clearRejectedInvestigationJournal(storage,owner,next)).toThrow();
 }
});

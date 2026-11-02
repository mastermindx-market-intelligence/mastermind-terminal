import { describe, expect, it } from "vitest";
import { applyInvestigationRevision, reconcileInvestigationOperation, matchesInvestigationCommand, parseInvestigationCommand, type InvestigationCommand } from "../investigations";
import { beginInvestigationSave, recoverInvestigationSave, settleInvestigationSave, investigationCommandToReconcile, resendsRefusedReferences } from "../investigationSave";
const id="10000000-0000-4000-8000-000000000001",op="20000000-0000-4000-8000-000000000001",other="30000000-0000-4000-8000-000000000001";
const capture={screen_id:"a".repeat(32),expected_revision:7};
const base={id,operation_id:op,expected_revision:0,action:"create" as const,manifest:{schema:"investigation_manifest.v2" as const,intent:{title:"Research",question:"Why?",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],argument_relations:[],continuation:{}}};
const command={...base,screen_capture:capture};
const ref={owner:"terminal.smart_screen",object_type:"screen_definition",object_id:capture.screen_id,mode:"pinned" as const,version_ref:op,fingerprint:"b".repeat(64)};
const result={status:"committed" as const,id,revision:1,lifecycle:"active" as const,manifest:{...base.manifest,evidence_refs:[ref]},committed_at:"2026-10-15T00:00:00Z",investigation_id:id,revision_id:other,sequence:1,parent_revision_id:null,operation_id:op,author_ref:id,recorded_at:"2026-10-15T00:00:00Z",manifest_digest:"c".repeat(64)};
describe("atomic screen capture command boundary",()=>{
 it("sends capture only in the original apply/reconcile RPC and preserves legacy arguments",async()=>{
  expect(parseInvestigationCommand(command)).toEqual(command);
  const calls:{name:string,args:Record<string,unknown>}[]=[];
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return{data:result,error:null};}};
  expect(await applyInvestigationRevision(db,command)).toEqual(result);
  expect(await reconcileInvestigationOperation(db,command)).toEqual(result);
  expect(calls.map(c=>c.name)).toEqual(["apply_investigation_revision_v2","reconcile_investigation_operation_v2"]);
  for(const c of calls) {expect(c.args.p_screen_capture).toEqual(capture);expect(c.args.p_operation_id).toBe(op);expect(c.args).not.toHaveProperty("user_id");}
  calls.length=0;await applyInvestigationRevision(db,base);expect(calls[0].args).not.toHaveProperty("p_screen_capture");
 });
 it("refuses unsupported capture/ref shapes and captures on lifecycle-only actions",()=>{
  for(const bad of [{...capture,principal:id},{...capture,expected_revision:0},{...capture,expected_revision:1_000_000_001},{...capture,expected_revision:1.2},{...capture,screen_id:"A".repeat(32)}]) expect(parseInvestigationCommand({...command,screen_capture:bad})).toBeNull();
  for(const action of ["remove","restore"]) expect(parseInvestigationCommand({...command,action})).toBeNull();
  for(const bad of [{...ref,mode:"follow_head"},{...ref,selection:{field:"name"}},{...ref,fingerprint:"short"},{...ref,version_ref:"head"}]) expect(parseInvestigationCommand({...base,manifest:{...base.manifest,evidence_refs:[bad]}})).toBeNull();
  expect(parseInvestigationCommand({...command,manifest:result.manifest})).toBeNull();
 });
 it("binds the one inserted reference to the source and original operation and preserves every other field",()=>{
  expect(matchesInvestigationCommand(result,command)).toBe(true);
  for(const bad of [{...ref,version_ref:other},{...ref,object_id:"d".repeat(32)},{...ref,fingerprint:"short"}]) expect(matchesInvestigationCommand({...result,manifest:{...result.manifest,evidence_refs:[bad]}},command)).toBe(false);
  expect(matchesInvestigationCommand({...result,manifest:{...result.manifest,evidence_refs:[ref,ref]}},command)).toBe(false);
  expect(matchesInvestigationCommand({...result,manifest:{...result.manifest,intent:{...result.manifest.intent,question:"Changed"}}},command)).toBe(false);
  expect(matchesInvestigationCommand({...result,manifest:base.manifest},command)).toBe(false);
 });
 it("retains the exact capture through an uncertain save/reload and cannot settle a different version",()=>{
  const raw=JSON.parse(JSON.stringify(command));
  const pending=beginInvestigationSave(id,raw,{phase:"idle"});expect(pending.phase).toBe("pending");
  raw.screen_capture.expected_revision=9;
  const uncertain=settleInvestigationSave(pending,id,{status:"unavailable"});expect(uncertain.phase).toBe("uncertain");
  const original=investigationCommandToReconcile(uncertain,id);expect(original).toEqual(command);
  const recovered=recoverInvestigationSave(id,{owner:id,command:original});expect(recovered?.phase).toBe("uncertain");
  const wrong={...result,manifest:{...result.manifest,evidence_refs:[{...ref,version_ref:other}]}};
  expect(settleInvestigationSave(recovered!,id,wrong).phase).toBe("uncertain");
  expect(settleInvestigationSave(recovered!,id,result).phase).toBe("committed");
 });
 it("a known screen conflict blocks an unchanged resend but allows an explicit source revision correction",()=>{
  const pending=beginInvestigationSave(id,command,{phase:"idle"});const rejected=settleInvestigationSave(pending,id,{status:"screen_conflict"});expect(rejected.phase).toBe("rejected");
  expect(resendsRefusedReferences(rejected,id,{...command,operation_id:other})).toBe(true);
  expect(resendsRefusedReferences(rejected,id,{...command,operation_id:other,screen_capture:{...capture,expected_revision:8}} as InvestigationCommand)).toBe(false);
 });
});

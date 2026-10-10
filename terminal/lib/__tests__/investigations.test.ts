import { describe, expect, it } from "vitest";
import { applyInvestigationRevision, parseInvestigationCommand, readInvestigation, readInvestigationOperation } from "../investigations";
const command = { id: "10000000-0000-4000-8000-000000000001", operation_id: "20000000-0000-4000-8000-000000000001", action: "create" as const, expected_revision: 0,
  manifest: { schema: "investigation_manifest.v2" as const,argument_relations:[], intent: { title: "Research", question: " Why?\r\n", subjects: [] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} } };
const identity={investigation_id:"10000000-0000-4000-8000-000000000001",revision_id:"30000000-0000-4000-8000-000000000001",sequence:1,parent_revision_id:null,operation_id:"20000000-0000-4000-8000-000000000001",author_ref:"40000000-0000-4000-8000-000000000001",recorded_at:"2026-10-04T00:00:00Z",manifest_digest:"a".repeat(64)};
describe("Investigation owner service", () => {
  it("admits exact Thesis references but delegates ownership to the atomic database boundary", async () => {
    const refs=[{thesis_id:command.id,version_id:command.operation_id,role:"alternative" as const}];
    const selected={...command,manifest:{...command.manifest,thesis_refs:refs}};
    expect(parseInvestigationCommand(selected)).toEqual(selected);
    const calls:unknown[]=[];
    expect(await applyInvestigationRevision({rpc:async(name,args)=>{calls.push({name,args});return {data:{status:"reference_unavailable"},error:null};}},selected)).toEqual({status:"reference_unavailable"});
    expect(calls).toEqual([{name:"apply_investigation_revision_v2",args:{p_id:command.id,p_expected_revision:0,p_action:"create",p_operation_id:command.operation_id,p_manifest:selected.manifest,p_layout_capture:null}}]);
    expect(parseInvestigationCommand({...selected,manifest:{...selected.manifest,thesis_refs:[{...refs[0],belief:"shadow"}]}})).toBeNull();
  });
  it("refuses caller-supplied identity, unknown fields and predecessor contracts", () => {
    expect(parseInvestigationCommand({...command,user_id: command.id})).toBeNull();
    expect(parseInvestigationCommand({...command,manifest:{...command.manifest,schema:"investigation_manifest.v1"}})).toBeNull();
    expect(parseInvestigationCommand({...command,expected_revision:1.5})).toBeNull();
    expect(parseInvestigationCommand(command)?.manifest.intent.question).toBe(" Why?\r\n");
  });
  it("sends one RPC with the original operation and no claimed principal", async () => {
    const receipt={...identity,status:"committed",id:command.id,revision:1,lifecycle:"active",manifest:command.manifest,committed_at:"2026-10-04T00:00:00Z"};
    const calls: unknown[]=[];
    const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return{data:receipt,error:null};}};
    expect(await applyInvestigationRevision(db,command)).toEqual(receipt);
    expect(calls).toEqual([{name:"apply_investigation_revision_v2",args:{p_id:command.id,p_expected_revision:0,p_action:"create",p_operation_id:command.operation_id,p_manifest:command.manifest,p_layout_capture:null}}]);
  });
  it("keeps outage and absent operation distinct without any mutation", async () => {
    expect(await readInvestigationOperation({rpc:async()=>({data:null,error:{message:"offline"}})},command.operation_id)).toEqual({status:"unavailable"});
    const calls:string[]=[];
    expect(await readInvestigationOperation({rpc:async(name)=>{calls.push(name);return{data:{status:"not_found"},error:null};}},command.operation_id)).toEqual({status:"not_found"});
    expect(calls).toEqual(["read_investigation_operation_v2"]);
  });
  it("rejects a wrong revision returned by an exact-revision read", async () => {
    const db={rpc:async()=>({data:{status:"found",id:command.id,revision:2,manifest:command.manifest,layouts:[]},error:null})};
    expect(await readInvestigation(db,command.id,1)).toEqual({status:"unavailable"});
  });
  it("does not report a malformed or foreign committed response as success", async () => {
    expect(await applyInvestigationRevision({rpc:async()=>({data:{...identity,status:"committed",id:command.operation_id},error:null})},command)).toEqual({status:"unavailable"});
  });
});

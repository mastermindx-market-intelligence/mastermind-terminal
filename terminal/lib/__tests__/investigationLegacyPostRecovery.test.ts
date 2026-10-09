import { beforeEach, describe, expect, it, vi } from "vitest";
// Real route and owner service. Only external authentication, rate limiting and RPC transport are stubbed.
const {rpc,getUser,rateLimit}=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),rateLimit:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc,auth:{getUser}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit,tooMany:()=>new Response(JSON.stringify({status:"rate_limited"}),{status:429})}));
import {POST,PUT} from "@/app/api/investigations/route";
const id="10000000-0000-4000-8000-000000000001",operation="20000000-0000-4000-8000-000000000001";
const principal="40000000-0000-4000-8000-000000000001",layout="50000000-0000-4000-8000-000000000001",revision="60000000-0000-4000-8000-000000000001";
const legacy=()=>({id,operation_id:operation,action:"create",expected_revision:0,manifest:{schema:"investigation_manifest.v2",intent:{title:"Research",question:"Exact retained question",subjects:[]},layout_refs:[],thesis_refs:[],evidence_refs:[],continuation:{}}});
const committed=(input=legacy())=>({status:"committed",id,revision:1,lifecycle:"active",manifest:input.manifest,committed_at:"2026-10-09T00:00:00.000Z"});
const req=(input:unknown,method="POST")=>new Request("https://terminal.test/api/investigations",{method,body:JSON.stringify(input)});
const expectedArgs=(input:ReturnType<typeof legacy>&{layout_capture?:unknown})=>({p_id:input.id,p_expected_revision:input.expected_revision,p_action:input.action,p_operation_id:input.operation_id,p_manifest:input.manifest,p_layout_capture:input.layout_capture??null});
beforeEach(()=>{rpc.mockReset();getUser.mockReset();rateLimit.mockReset();getUser.mockResolvedValue({data:{user:{id:principal}},error:null});rateLimit.mockReturnValue({ok:true});});
describe("legacy POST retry uses the original request's reconciliation owner",()=>{
 it("recovers an existing legacy commit without applying or normalizing the old request",async()=>{
  const input=legacy();rpc.mockResolvedValue({data:committed(input),error:null});
  const response=await POST(req(input));expect(response.status).toBe(200);expect(await response.json()).toEqual(committed(input));
  expect(rpc.mock.calls).toEqual([["reconcile_investigation_operation_v2",expectedArgs(input)]]);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(response.headers.get("Vary")).toBe("Cookie");
 });
 it("preserves the legacy date and capture revision ID for full-request reconciliation",async()=>{
  const input={...legacy(),manifest:{...legacy().manifest,intent:{...legacy().manifest.intent,research_as_of:"2026-10-04"}},layout_capture:{layout_id:layout,expected_revision:3,revision_id:revision}};
  const result={status:"not_applied",id,operation_id:operation};rpc.mockResolvedValue({data:result,error:null});
  const response=await POST(req(input));expect(response.status).toBe(200);expect(await response.json()).toEqual(result);
  expect(rpc.mock.calls).toEqual([["reconcile_investigation_operation_v2",expectedArgs(input)]]);
 });
 it.each([undefined,"limit_reached"])("preserves a matching no-effect answer with reason %s",async reason=>{
  const result={status:"not_applied",id,operation_id:operation,...(reason?{reason}:{})};rpc.mockResolvedValue({data:result,error:null});
  const response=await POST(req(legacy()));expect(response.status).toBe(200);expect(await response.json()).toEqual(result);
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(["reconcile_investigation_operation_v2"]);
 });
 it.each(["missing","throws","not_found","wrong_fence","wrong_receipt"])("keeps %s reconciliation unavailable instead of claiming invalid payload/no effect",async kind=>{
  if(kind==="throws")rpc.mockRejectedValue(new Error("transport unavailable"));
  else if(kind==="missing")rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});
  else rpc.mockResolvedValue({data:kind==="not_found"?{status:"not_found"}:kind==="wrong_fence"?{status:"not_applied",id,operation_id:revision}:{...committed(),id:revision},error:null});
  const response=await POST(req(legacy()));
  // An explicit owner miss remains inconclusive to the old client; no fabricated fence.
  expect(response.status).toBe(kind==="not_found"?404:503);expect(await response.json()).toEqual({status:kind==="not_found"?"not_found":"unavailable"});
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(["reconcile_investigation_operation_v2"]);
 });
 it.each(["action","capture revision"])("forwards changed %s to the full-request owner and preserves idempotency_conflict",async change=>{
  const input=change==="action"?{...legacy(),action:"revise"}:{...legacy(),layout_capture:{layout_id:layout,expected_revision:4,revision_id:revision}};
  rpc.mockResolvedValue({data:{status:"idempotency_conflict"},error:null});
  const response=await POST(req(input));expect(response.status).toBe(409);expect(await response.json()).toEqual({status:"idempotency_conflict"});
  expect(rpc.mock.calls).toEqual([["reconcile_investigation_operation_v2",expectedArgs(input)]]);
 });
 it.each([{...legacy(),operation_id:"bad"},{...legacy(),action:"unknown"},{...legacy(),manifest:{...legacy().manifest,surprise:true}},{...legacy(),actor:principal}])("keeps truly malformed input at zero RPCs",async input=>{
  const response=await POST(req(input));expect(response.status).toBe(400);expect(await response.json()).toEqual({status:"invalid_payload"});expect(rpc).not.toHaveBeenCalled();
 });
 it("keeps strict current writes on apply and the PUT recovery path on reconcile",async()=>{
  const current={...legacy(),manifest:{...legacy().manifest,argument_relations:[]}};rpc.mockResolvedValue({data:{status:"limit_reached"},error:null});
  expect((await POST(req(current))).status).toBe(429);expect((await PUT(req(legacy(),"PUT"))).status).toBe(429);
  expect(rpc.mock.calls).toEqual([["apply_investigation_revision_v2",expectedArgs(current)],["reconcile_investigation_operation_v2",expectedArgs(legacy())]]);
 });
 it("keeps unsigned callers outside both owners",async()=>{
  getUser.mockResolvedValue({data:{user:null},error:null});const response=await POST(req(legacy()));expect(response.status).toBe(401);expect(rpc).not.toHaveBeenCalled();
 });
 it("keeps rate rejection before session or RPC",async()=>{
  rateLimit.mockReturnValue({ok:false});expect((await POST(req(legacy()))).status).toBe(429);expect(getUser).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 it("keeps request size limits before RPC",async()=>{
  const input={...legacy(),padding:"x".repeat(133*1024)};expect((await POST(req(input))).status).toBe(413);expect(rpc).not.toHaveBeenCalled();
 });
});

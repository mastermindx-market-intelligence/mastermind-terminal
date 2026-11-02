import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({createClient: async () => ({rpc,auth:{getUser}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:()=>({ok:true})}));
import { GET } from "@/app/api/investigations/route";
const id="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{rpc.mockReset();getUser.mockReset();getUser.mockResolvedValue({data:{user:{id}},error:null});});
const U="https://terminal.test/api/investigations";
const Q="?admission=terminal.options_exposure:options_matrix_selection";
describe("investigation admission probe",()=>{
 it("admits a registered evidence pair through the admitted_v2 probe",async()=>{
  rpc.mockResolvedValue({data:true,error:null});
  const response=await GET(new Request(U+Q));
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"admission",admitted:true});
  expect(rpc.mock.calls).toEqual([["investigation_evidence_admitted_v2",{owner:"terminal.options_exposure",object_type:"options_matrix_selection"}]]);
 });
 it("reports a registered pair the database does not admit",async()=>{
  rpc.mockResolvedValue({data:false,error:null});
  const response=await GET(new Request(U+Q));
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"admission",admitted:false});
 });
 it("refuses unregistered owners and object types before the probe",async()=>{
  for(const q of ["?admission=terminal.options_exposure:dealer_inventory","?admission=earnings.workspace_generation:options_matrix_selection","?admission=terminal.options_exposure:event_workspace"]){
   const response=await GET(new Request(U+q));
   expect(response.status).toBe(400);expect(await response.json()).toEqual({status:"invalid_payload"});
  }
  expect(rpc).not.toHaveBeenCalled();
 });
 it("refuses malformed and conflicting admission selectors",async()=>{
  for(const q of ["?admission=","?admission=terminal.options_exposure","?admission=:options_matrix_selection","?admission=a:b:c",Q+":x","?admission=%20terminal.options_exposure:options_matrix_selection","?admission=TERMINAL.OPTIONS_EXPOSURE:options_matrix_selection",Q+"&id=x",Q+"&admission=x"]){
   const response=await GET(new Request(U+q));
   expect(response.status).toBe(400);expect(await response.json()).toEqual({status:"invalid_payload"});
  }
  expect(rpc).not.toHaveBeenCalled();
 });
 it("maps a failed probe read to unavailable",async()=>{
  rpc.mockResolvedValue({data:null,error:{message:"x"}});
  const response=await GET(new Request(U+Q));
  expect(response.status).toBe(503);expect(await response.json()).toEqual({status:"unavailable"});
  rpc.mockResolvedValue({data:true,error:{message:"x"}});
  const errored=await GET(new Request(U+Q));
  expect(errored.status).toBe(503);expect(await errored.json()).toEqual({status:"unavailable"});
 });
 it("maps a rejected probe call to unavailable",async()=>{
  rpc.mockRejectedValue(new Error("x"));
  const response=await GET(new Request(U+Q));
  expect(response.status).toBe(503);expect(await response.json()).toEqual({status:"unavailable"});
 });
 it("refuses probe results that are not a boolean",async()=>{
  rpc.mockResolvedValue({data:null,error:null});
  const r1=await GET(new Request(U+Q));expect(r1.status).toBe(503);expect(await r1.json()).toEqual({status:"unavailable"});
  rpc.mockResolvedValue({data:"true",error:null});
  const r2=await GET(new Request(U+Q));expect(r2.status).toBe(503);expect(await r2.json()).toEqual({status:"unavailable"});
 });
 it("keeps the admission responses private and uncacheable",async()=>{
  rpc.mockResolvedValue({data:true,error:null});
  expect((await GET(new Request(U+Q))).headers.get("Cache-Control")).toBe("private, no-store");
  rpc.mockResolvedValue({data:null,error:{message:"x"}});
  expect((await GET(new Request(U+Q))).headers.get("Cache-Control")).toBe("private, no-store");
 });
 it("refuses anonymous admission probes before touching the database",async()=>{
  getUser.mockResolvedValue({data:{user:null},error:null});
  const response=await GET(new Request(U+Q));
  expect(response.status).toBe(401);expect(await response.json()).toEqual({status:"unauthenticated"});
  expect(rpc).not.toHaveBeenCalled();
 });
});

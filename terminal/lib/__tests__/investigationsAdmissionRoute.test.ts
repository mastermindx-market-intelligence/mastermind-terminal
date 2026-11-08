// Fixture process born OPEN; kernel-reader behavior is tested separately with mocked IO.
const bootFixture=vi.hoisted(()=>({closed:false}));
vi.mock("@/lib/investigationBootAdmission",()=>({readInvestigationBootAdmission:()=>true,
 hasObservedInvestigationClosure:()=>bootFixture.closed,observeInvestigationClosure:()=>{bootFixture.closed=true}}));
// Fresh controlled request realm per case, never a production latch reset.
beforeEach(()=>{bootFixture.closed=false});
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, getUser, createClient } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), createClient: vi.fn(async () => ({ rpc, auth: { getUser } })) }));
vi.mock("@/lib/supabase/server", () => ({createClient}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:()=>({ok:true})}));
let GET:typeof import("@/app/api/investigations/route").GET;
beforeEach(async()=>{vi.resetModules();({GET}=await import("@/app/api/investigations/route"))});
const id="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{rpc.mockReset();getUser.mockReset();createClient.mockClear();getUser.mockResolvedValue({data:{user:{id}},error:null});});
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
// Closed-mode matrix for the ingress gate: INVESTIGATION_API_ADMISSION is the production
// default (unset) plus the representative closed literals. Closed mode must refuse the
// handler BEFORE any session/client/probe work — including for selectors that are
// themselves malformed, so a bad selector can never widen the surface — and the shared
// 503 envelope is returned verbatim with the route's own private headers.
const CLOSED_ADMISSION_VALUES: Array<string | undefined> = [undefined, "closed", "", "OPEN", " open", "open\n", "open,"];
const CLOSED_MODE_SELECTORS = [Q, "?admission=", "?admission=terminal.options_exposure", "?admission=:options_matrix_selection", "?admission=a:b:c", Q+"&id=x", "?admission=%20terminal.options_exposure:options_matrix_selection", "?admission=TERMINAL.OPTIONS_EXPOSURE:options_matrix_selection"];
describe("investigation admission gate closed mode",()=>{
 afterEach(()=>{vi.unstubAllEnvs();});
 it.each(CLOSED_ADMISSION_VALUES)("admission value %j refuses every request before any session, client or probe work",async(value)=>{
  if(value===undefined) vi.stubEnv("INVESTIGATION_API_ADMISSION",undefined as unknown as string);
  else vi.stubEnv("INVESTIGATION_API_ADMISSION",value);
  for(const q of CLOSED_MODE_SELECTORS){
   const request=new Request(U+q);
   const response=await GET(request);
   expect(response.status).toBe(503);
   expect(await response.json()).toEqual({status:"unavailable"});
   expect(response.headers.get("Cache-Control")).toBe("private, no-store");
   expect(response.headers.get("Vary")).toBe("Cookie");
   expect(request.bodyUsed).toBe(false);
  }
  expect(createClient).not.toHaveBeenCalled();
  expect(getUser).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
 });
 it("flips per request: an admitted probe passes while the next closed request is refused",async()=>{
  rpc.mockResolvedValue({data:true,error:null});
  const response=await GET(new Request(U+Q));
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"admission",admitted:true});
  vi.stubEnv("INVESTIGATION_API_ADMISSION","closed");
  const closed=await GET(new Request(U+Q));
  expect(closed.status).toBe(503);expect(await closed.json()).toEqual({status:"unavailable"});
  expect(createClient).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledOnce();
 });
});

// Fixture process born OPEN; kernel-reader behavior is tested separately with mocked IO.
const bootFixture=vi.hoisted(()=>({closed:false}));
vi.mock("@/lib/investigationBootAdmission",()=>({readInvestigationBootAdmission:()=>true,
 hasObservedInvestigationClosure:()=>bootFixture.closed,observeInvestigationClosure:()=>{bootFixture.closed=true}}));
// Fresh controlled process per case, never a production latch reset.
beforeEach(()=>{bootFixture.closed=false});
import { beforeEach,expect,it,vi } from "vitest";
const {rpc,getUser,rateLimit,tooMany}=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),rateLimit:vi.fn(),tooMany:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc,auth:{getUser}})}));
vi.mock("@/lib/rateLimit",()=>({rateLimit,tooMany}));
let POST:typeof import("@/app/api/investigations/operation-read/route").POST;
beforeEach(async()=>{vi.unstubAllEnvs();vi.resetModules();({POST}=await import("@/app/api/investigations/operation-read/route"))});
import {command,principal,native,fence} from "./investigationNativeRecovery.fixture";
import {investigationCanonicalRequest} from "../investigations";
const request=(body:unknown=command,headers:Record<string,string>={},suffix="")=>new Request("https://terminal.test/api/investigations/operation-read"+suffix,{method:"POST",headers:{"x-mm-scenario-owner":principal,...headers},body:typeof body==="string"?body:JSON.stringify(body)});
beforeEach(()=>{vi.unstubAllEnvs();rpc.mockReset();getUser.mockReset();rateLimit.mockReset();tooMany.mockReset();getUser.mockResolvedValue({data:{user:{id:principal}},error:null});rateLimit.mockReturnValue({ok:true});rpc.mockImplementation(async(name:string)=>({data:name==="read_investigation_native_capture_v1"?native():fence,error:null}));});
it("uses actual owner/full request/explicit null and only bound read RPCs",async()=>{
 const response=await POST(request());expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({read_binding:"native_participant",native_phase:"retained",canonical_status:"not_applied"});
 expect(rpc.mock.calls).toEqual([["read_investigation_native_capture_v1",{p_operation_id:command.operation_id,p_request:investigationCanonicalRequest(command,principal)}],["read_investigation_operation_v2",{p_operation_id:command.operation_id}]]);
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");
});
it("honors CLOSED before authentication/database/body and preserves denial privacy",async()=>{
 vi.stubEnv("INVESTIGATION_API_ADMISSION","closed");expect((await POST(request())).status).toBe(503);expect(getUser).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
});
it("honors current auth expiry and owner mismatch without touching receipts",async()=>{
 getUser.mockResolvedValueOnce({data:{user:null},error:null});expect((await POST(request())).status).toBe(401);
 expect((await POST(request(command,{"x-mm-scenario-owner":command.id}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();
});
it("retains existing rate-limit privacy controls",async()=>{
 rateLimit.mockReturnValue({ok:false});tooMany.mockReturnValue(new Response("limited",{status:429}));const response=await POST(request());
 expect(response.status).toBe(429);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(getUser).not.toHaveBeenCalled();
});
it.each(["broken-json","oversize","query","principal-override","legacy-only"])("refuses %s before any RPC",async kind=>{
 const body=kind==="broken-json"?"{":kind==="oversize"?"x".repeat(132*1024+1):kind==="principal-override"?{...command,principal}:kind==="legacy-only"?{operation_id:command.operation_id}:command;
 const response=await POST(request(body,{},kind==="query"?"?operation_id="+command.operation_id:""));expect([400,413]).toContain(response.status);expect(rpc).not.toHaveBeenCalled();
});
it.each([null,{status:"not_found"},{status:"found",generation:null}])("keeps unavailable/missing/partial native outcome inconclusive",async data=>{
 rpc.mockResolvedValue({data,error:null});const response=await POST(request());expect([404,503]).toContain(response.status);expect(rpc).toHaveBeenCalledTimes(1);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({rpc:vi.fn(),auth:{getUser:vi.fn()}}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>db}));
import { GET, PUT } from "@/app/api/drawings/route";
const operationId="11111111-1111-4111-8111-111111111111";
const revision="22222222-2222-4222-8222-222222222222";
const drawing={id:"user-line",schemaVersion:1,source:"user",kind:"hline",points:[{t:"2026-01-01",p:100}]};
const request=(body:unknown)=>new Request("https://example.test/api/drawings",{method:"PUT",body:JSON.stringify({ownerKey:"account:owner@example.com",...(body as Record<string,unknown>)})});
beforeEach(()=>{vi.clearAllMocks();db.auth.getUser.mockResolvedValue({data:{user:{id:"owner",email:"owner@example.com"}}});});
describe("transactional drawing API",()=>{
 it("returns the observed snapshot token and no internal operation metadata",async()=>{
  db.rpc.mockResolvedValue({data:{drawings:[drawing],revision:"legacy:"+"a".repeat(64),schemaVersion:1,metadata:{secret:"internal"}},error:null});
  const response=await GET(new Request("https://example.test/api/drawings?symbol=NVDA"));
  expect(await response.json()).toEqual({drawings:[drawing],revision:"legacy:"+"a".repeat(64),schemaVersion:1});
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(db.rpc).toHaveBeenCalledWith("read_drawings_collection",{p_symbol:"NVDA"});
 });
 it("an unavailable or malformed cloud read never becomes empty drawings",async()=>{
  for(const data of [null,{drawings:[],schemaVersion:1},{drawings:[drawing],revision:null,schemaVersion:1}]){
   db.rpc.mockResolvedValue({data,error:null});const response=await GET(new Request("https://example.test/api/drawings?symbol=NVDA"));
   expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty("drawings");
  }
 });
 it("rejects an old blind replacement client without touching storage",async()=>{
  expect((await PUT(request({symbol:"NVDA",drawings:[drawing]}))).status).toBe(400);
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it("rejects the actual unupgraded client body without an injected owner key",async()=>{
  const old=new Request("https://example.test/api/drawings",{method:"PUT",body:JSON.stringify({symbol:"NVDA",drawings:[]})});
  const response=await PUT(old);expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ok:false,code:"owner_conflict"});expect(db.rpc).not.toHaveBeenCalled();
 });
 it("rejects malformed points and generated data rather than normalizing them into another operation",async()=>{
  for(const value of [{...drawing,points:[{t:"today",p:100},{t:"today",p:null}]},{...drawing,source:"ai"}]){
   expect((await PUT(request({symbol:"NVDA",drawings:[value],expectedRevision:null,operationId}))).status).toBe(422);
  }
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it("returns a stale revision conflict from the single RPC",async()=>{
  db.rpc.mockResolvedValue({data:{ok:false,code:"revision_conflict"},error:null});
  const response=await PUT(request({symbol:"NVDA",drawings:[],expectedRevision:revision,operationId}));
  expect(response.status).toBe(409);expect(await response.json()).toEqual({ok:false,code:"revision_conflict"});
  expect(db.rpc).toHaveBeenCalledTimes(1);
 });
 it("preserves exact JSON and acknowledges the actual operation and replay disposition",async()=>{
  const candidate={...drawing,meta:{label:"保持"},points:[{t:1700000000,p:100}]};
  db.rpc.mockResolvedValue({data:{ok:true,revision,idempotentReplay:true,superseded:true},error:null});
  const response=await PUT(request({symbol:"NVDA",drawings:[candidate],expectedRevision:null,operationId}));
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,operationId,revision,idempotentReplay:true,superseded:true});
  expect(db.rpc).toHaveBeenCalledWith("replace_drawings_collection",{p_symbol:"NVDA",p_drawings:[candidate],p_expected_revision:null,p_operation_id:operationId});
 });
 it("fails closed when the migration or a valid save receipt is absent",async()=>{
  for(const result of [{data:null,error:{code:"PGRST202"}},{data:{ok:true},error:null}]){
   db.rpc.mockResolvedValue(result);expect((await PUT(request({symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(503);
  }
 });
 it("rejects a cookie-account change before either read or write reaches storage",async()=>{
  expect((await PUT(request({ownerKey:"account:other@example.com",symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(409);
  expect((await GET(new Request("https://example.test/api/drawings?symbol=NVDA&ownerKey=account:other@example.com"))).status).toBe(409);
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it("does not expose an account snapshot to a guest",async()=>{
  db.auth.getUser.mockResolvedValue({data:{user:null}});expect((await GET(new Request("https://example.test/api/drawings?symbol=NVDA"))).status).toBe(401);
  expect(db.rpc).not.toHaveBeenCalled();
 });
});

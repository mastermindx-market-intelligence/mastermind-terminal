import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({rpc:vi.fn(),auth:{getUser:vi.fn()}}));
const jar = vi.hoisted(() => new Map<string,string>());
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>db}));
vi.mock("next/headers",()=>({cookies:async()=>({get:(name:string)=>jar.has(name)?{name,value:jar.get(name)}:undefined})}));
import { GET, PUT } from "@/app/api/drawings/route";
import { DRAWING_OWNER_HEADER, parseDrawingSaveReceipt, parseDrawingSnapshot } from "@/lib/drawingPersistence";
import { FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";
import { GUEST_COOKIE } from "@/lib/layoutsFixtureDb";
const operationId="11111111-1111-4111-8111-111111111111";
const revision="22222222-2222-4222-8222-222222222222";
const drawing={id:"user-line",schemaVersion:1,source:"user",kind:"hline",points:[{t:"2026-01-01",p:100}]};
const request=(body:unknown)=>new Request("https://example.test/api/drawings",{method:"PUT",body:JSON.stringify({ownerKey:"account:owner",...(body as Record<string,unknown>)})});
const read=(owner?:string,url="https://example.test/api/drawings?symbol=NVDA")=>new Request(url,owner===undefined?{}:{headers:{[DRAWING_OWNER_HEADER]:owner}});
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
  expect((await PUT(request({ownerKey:"account:other",symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(409);
  expect((await GET(read("account:other"))).status).toBe(409);
  expect(db.rpc).not.toHaveBeenCalled();
 });
 // Account-identity law: owner-scoped stores key on the auth UUID, never the email.
 it("keys drawing ownership on the auth UUID, never the email",async()=>{
  // Same email, different auth account (an email reassigned to a new user): refused.
  db.auth.getUser.mockResolvedValue({data:{user:{id:"successor",email:"owner@example.com"}}});
  expect((await PUT(request({symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(409);
  expect((await GET(read("account:owner"))).status).toBe(409);
  // An email-form key is never an owner key, even for the account that holds that email.
  db.auth.getUser.mockResolvedValue({data:{user:{id:"owner",email:"owner@example.com"}}});
  expect((await PUT(request({ownerKey:"account:owner@example.com",symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(409);
  expect((await GET(read("account:owner@example.com"))).status).toBe(409);
  expect(db.rpc).not.toHaveBeenCalled();
  // The same account after an email change keeps its drawings.
  db.auth.getUser.mockResolvedValue({data:{user:{id:"owner",email:"renamed@example.com"}}});
  db.rpc.mockResolvedValue({data:{ok:true,revision,idempotentReplay:false,superseded:false},error:null});
  expect((await PUT(request({symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(200);
  db.rpc.mockResolvedValue({data:{drawings:[],revision,schemaVersion:1},error:null});
  expect((await GET(read("account:owner"))).status).toBe(200);
 });
 it("reads the expected owner from a header and ignores an owner key in the URL",async()=>{
  db.rpc.mockResolvedValue({data:{drawings:[],revision,schemaVersion:1},error:null});
  expect((await GET(read("account:owner","https://example.test/api/drawings?symbol=NVDA&ownerKey=account:other"))).status).toBe(200);
  expect((await GET(read("account:other","https://example.test/api/drawings?symbol=NVDA&ownerKey=account:owner"))).status).toBe(409);
 });
 it("does not expose an account snapshot to a guest",async()=>{
  db.auth.getUser.mockResolvedValue({data:{user:null}});expect((await GET(new Request("https://example.test/api/drawings?symbol=NVDA"))).status).toBe(401);
  expect(db.rpc).not.toHaveBeenCalled();
 });
});

// The Playwright server signs the page in without a Supabase session. Its
// drawings identity must match the page so the readiness gate opens, while
// every validation and the guest refusal stay exactly as in production.
describe("e2e fixture drawings account",()=>{
 const env={fixture:process.env.TERMINAL_E2E_FIXTURE,email:process.env.TERMINAL_E2E_EMAIL};
 const fixtureRequest=(body:Record<string,unknown>)=>new Request("https://example.test/api/drawings",{method:"PUT",body:JSON.stringify({ownerKey:"account:e2e-user-default",...body})});
 beforeEach(()=>{process.env.TERMINAL_E2E_FIXTURE="1";process.env.TERMINAL_E2E_EMAIL="responsive@example.com";jar.clear();});
 afterEach(()=>{
  if(env.fixture===undefined) delete process.env.TERMINAL_E2E_FIXTURE; else process.env.TERMINAL_E2E_FIXTURE=env.fixture;
  if(env.email===undefined) delete process.env.TERMINAL_E2E_EMAIL; else process.env.TERMINAL_E2E_EMAIL=env.email;
  jar.clear();
 });
 it("reads a valid empty snapshot for the signed-in fixture account without storage",async()=>{
  const response=await GET(read("account:e2e-user-default"));
  expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(parseDrawingSnapshot(await response.json())).toEqual({drawings:[],revision:null,schemaVersion:1});
  expect(db.rpc).not.toHaveBeenCalled();expect(db.auth.getUser).not.toHaveBeenCalled();
 });
 it("keeps the guest refusal, account check and symbol check",async()=>{
  expect((await GET(read("account:other"))).status).toBe(409);
  expect((await GET(read("account:responsive@example.com"))).status).toBe(409);
  expect((await GET(read("account:e2e-user-default","https://example.test/api/drawings"))).status).toBe(400);
  jar.set(GUEST_COOKIE,"1");
  expect((await GET(new Request("https://example.test/api/drawings?symbol=NVDA"))).status).toBe(401);
  expect((await PUT(fixtureRequest({symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(401);
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it("acknowledges a valid save with a receipt the client accepts and still rejects invalid saves",async()=>{
  const attempt={operationId,expectedRevision:null,drawings:[drawing]};
  const response=await PUT(fixtureRequest({symbol:"NVDA",...attempt}));
  expect(response.status).toBe(200);
  expect(parseDrawingSaveReceipt(await response.json(),attempt as Parameters<typeof parseDrawingSaveReceipt>[1])).toMatchObject({operationId,idempotentReplay:false,superseded:false});
  expect((await PUT(fixtureRequest({symbol:"NVDA",drawings:[drawing]}))).status).toBe(400);
  expect((await PUT(fixtureRequest({symbol:"NVDA",drawings:[{...drawing,source:"ai"}],expectedRevision:null,operationId}))).status).toBe(422);
  expect((await PUT(fixtureRequest({ownerKey:"account:other",symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(409);
  expect((await PUT(fixtureRequest({ownerKey:"account:responsive@example.com",symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(409);
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it("uses the same fixture user id the page receives, per fixture store",async()=>{
  jar.set(FIXTURE_STORE_COOKIE,"tab-b");
  expect((await GET(read("account:e2e-user-tab-b"))).status).toBe(200);
  expect((await GET(read("account:e2e-user-default"))).status).toBe(409);
  expect((await PUT(fixtureRequest({symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(409);
 });
 it("is off unless the fixture variable is exactly set",async()=>{
  process.env.TERMINAL_E2E_FIXTURE="0";db.auth.getUser.mockResolvedValue({data:{user:null}});
  expect((await GET(read("account:e2e-user-default"))).status).toBe(401);
  expect((await PUT(fixtureRequest({symbol:"NVDA",drawings:[],expectedRevision:null,operationId}))).status).toBe(401);
 });
 it("is off in a production build even when the fixture variable is set",async()=>{
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("TERMINAL_E2E_FIXTURE","1");
  try{
   db.auth.getUser.mockResolvedValue({data:{user:null}});
   expect((await GET(read("account:e2e-user-default"))).status).toBe(401);
   expect((await PUT(fixtureRequest({symbol:"NVDA",drawings:[drawing],expectedRevision:null,operationId}))).status).toBe(401);
   expect(db.auth.getUser).toHaveBeenCalledTimes(2);expect(db.rpc).not.toHaveBeenCalled();
  }finally{vi.unstubAllEnvs();}
 });
});

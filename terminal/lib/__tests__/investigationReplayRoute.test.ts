import {beforeEach,describe,expect,it,vi} from "vitest";
const {getUser,read,replay,authorize}=vi.hoisted(()=>({getUser:vi.fn(),read:vi.fn(),replay:vi.fn(),authorize:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser}})}));
vi.mock("@/lib/investigations",async()=>({...await vi.importActual<typeof import("@/lib/investigations")>("@/lib/investigations"),readInvestigation:read}));
vi.mock("@/lib/eventWorkspace",async()=>({...await vi.importActual<typeof import("@/lib/eventWorkspace")>("@/lib/eventWorkspace"),resolveRetainedEventWorkspaceAtCutoff:replay,authorizeRetainedPublicEventContext:authorize}));
import {GET} from "@/app/api/investigations/replay/route";
const id="10000000-0000-4000-8000-000000000001",fingerprint="a".repeat(64),company="cik:0000320193";
const ref={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:"evt_cik0000320193_2026q3_results",mode:"pinned",version_ref:"a".repeat(24),fingerprint};
const manifest={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Research",question:"What changed?",subjects:[{owner:"data_os.security_master",kind:"issuer",object_id:company}]},layout_refs:[],thesis_refs:[],evidence_refs:[ref],review_baseline_ref:ref,continuation:{}};
const query=new URLSearchParams({id,revision:"1",policy:"platform_snapshot",cutoff:"2026-08-01T00:00:00Z"});
const request=(q=query.toString())=>new Request(`https://terminal.test/api/investigations/replay?${q}`);
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:"owner"}},error:null});read.mockResolvedValue({status:"found",id,revision:1,manifest});replay.mockResolvedValue({ok:true,workspace:{generation_id:"b".repeat(24)},receipt:{fingerprint:"b".repeat(64)},replay:{policy:"platform_snapshot"}});});
describe("read-only authenticated retained snapshot route",()=>{
 it("uses the exact owned revision and current rights, with private no-store results",async()=>{
  const before=JSON.stringify(manifest),response=await GET(request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:"replayed",id,revision:1,root_fingerprint:fingerprint});
  expect(read.mock.calls[0].slice(1)).toEqual([id,1]);expect(replay.mock.calls[0][0]).toEqual({event_id:ref.object_id,generation_id:ref.version_ref,company_id:company,fingerprint});expect(replay.mock.calls[0][1]).toEqual({policy:"platform_snapshot",cutoff:"2026-08-01T00:00:00Z"});expect(typeof replay.mock.calls[0][3].authorize).toBe("function");expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");expect(JSON.stringify(manifest)).toBe(before);
 });
 it("does not load evidence for anonymous or foreign records",async()=>{
  getUser.mockResolvedValue({data:{user:null},error:null});expect((await GET(request())).status).toBe(401);expect(read).not.toHaveBeenCalled();getUser.mockResolvedValue({data:{user:{id:"other"}},error:null});read.mockResolvedValue({status:"not_found"});expect((await GET(request())).status).toBe(404);expect(replay).not.toHaveBeenCalled();
 });
 it("reports unsupported knowledge policies explicitly",async()=>{
  replay.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"unsupported_policy"});const q=new URLSearchParams(query);q.set("policy","public_known");const result=await GET(request(q.toString()));expect(result.status).toBe(422);expect(await result.json()).toMatchObject({ok:false,reason:"unsupported_policy"});
 });
 it("preserves missing history and denied access instead of returning current content",async()=>{
  for(const reason of ["missing_history","denied"]){replay.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason});expect(await (await GET(request())).json()).toMatchObject({ok:false,reason});}
 });
 it("rejects ambiguous selectors and caller-supplied baseline overrides",async()=>{
  for(const suffix of ["&revision=1","&generation_id=other","&fingerprint=bad"]){expect((await GET(request(query+suffix))).status).toBe(400);}const q=new URLSearchParams(query);q.set("policy","current");expect((await GET(request(q.toString()))).status).toBe(400);expect(read).not.toHaveBeenCalled();expect(replay).not.toHaveBeenCalled();
 });
});

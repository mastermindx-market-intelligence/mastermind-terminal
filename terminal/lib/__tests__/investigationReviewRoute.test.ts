import {beforeEach,describe,expect,it,vi} from "vitest";
import fixture from "./fixtures/aapl-event-workspace.json";
const {getUser,read,current,retained,authorize}=vi.hoisted(()=>({getUser:vi.fn(),read:vi.fn(),current:vi.fn(),retained:vi.fn(),authorize:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser}})}));
vi.mock("@/lib/investigations",async()=>({...await vi.importActual<typeof import("@/lib/investigations")>("@/lib/investigations"),readInvestigation:read}));
vi.mock("@/lib/eventWorkspace",async()=>({...await vi.importActual<typeof import("@/lib/eventWorkspace")>("@/lib/eventWorkspace"),resolveCurrentEventWorkspaceFromR2:current,resolveRetainedEventWorkspaceFromR2:retained,authorizeRetainedPublicEventContext:authorize}));
import {GET} from "@/app/api/investigations/review/route";
const id="10000000-0000-4000-8000-000000000001";
const reference={owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:fixture.event_id,mode:"pinned",version_ref:fixture.generation_id,fingerprint:"a".repeat(64)};
const manifest={schema:"investigation_manifest.v2",argument_relations:[],intent:{title:"Research",question:"What changed?",subjects:[{owner:"data_os.security_master",kind:"issuer",object_id:fixture.issuer.company_id}]},layout_refs:[],thesis_refs:[],evidence_refs:[reference],review_baseline_ref:reference,continuation:{}};
const owner={ok:true,workspace:fixture,receipt:{owner:"earnings.workspace_generation",company_id:fixture.issuer.company_id,event_id:fixture.event_id,generation_id:fixture.generation_id,workspace_schema:fixture.schema,authority:fixture.authority,rights:{allowed:true}}};
const request=(query=`id=${id}&revision=1`)=>new Request(`https://terminal.test/api/investigations/review?${query}`);
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:"unit-owner"}},error:null});read.mockResolvedValue({status:"found",id,revision:1,manifest});current.mockResolvedValue({ok:true,state:"ready",workspace:fixture});retained.mockResolvedValue(owner);});
describe("authenticated read-only Investigation evidence review",()=>{
 it("uses the exact saved revision and returns a private conservative comparison",async()=>{
  const before=JSON.stringify(manifest);const response=await GET(request());
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:"reviewed",revision:1,coverage:"observed_owner_rows_only",removalProofAvailable:false,review:{summary:"incomplete"}});
  expect(read.mock.calls[0].slice(1)).toEqual([id,1]);expect(retained.mock.calls[0][0]).toMatchObject({generation_id:reference.version_ref,fingerprint:reference.fingerprint});
  expect(retained).toHaveBeenCalledTimes(2);expect(retained.mock.calls.every(call=>typeof call[2].authorize==="function")).toBe(true);
  expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");expect(JSON.stringify(manifest)).toBe(before);
 });
 it("rejects anonymous and foreign reads before fetching owner evidence",async()=>{
  getUser.mockResolvedValue({data:{user:null},error:null});expect((await GET(request())).status).toBe(401);expect(read).not.toHaveBeenCalled();
  getUser.mockResolvedValue({data:{user:{id:"unit-other"}},error:null});read.mockResolvedValue({status:"not_found"});expect((await GET(request())).status).toBe(404);expect(retained).not.toHaveBeenCalled();expect(current).not.toHaveBeenCalled();
 });
 it("does not replace an unavailable retained baseline with current evidence",async()=>{
  retained.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"missing_generation"});
  const response=await GET(request());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({reason:"historical_unavailable"});expect(current).not.toHaveBeenCalled();
 });
 it("scope changes and stale current reads cannot be called unchanged",async()=>{
  current.mockResolvedValue({ok:true,state:"ready",workspace:{...fixture,event_id:"a-different-event"}});
  expect(await (await GET(request())).json()).toEqual({status:"scope_changed"});expect(retained).toHaveBeenCalledTimes(1);
  current.mockResolvedValue({ok:true,state:"stale",workspace:fixture});expect((await GET(request())).status).toBe(503);
 });
 it("rejects missing/repeated selectors, invalid IDs and oversized revisions",async()=>{
  for(const query of [`id=${id}`,`id=${id}&revision=1&revision=1`,`id=no&revision=1`,`id=${id}&revision=2147483648`])expect((await GET(request(query))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
 });
});

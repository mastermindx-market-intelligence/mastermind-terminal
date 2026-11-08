import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({access:vi.fn(),upstream:vi.fn(),rate:vi.fn()}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:state.rate,tooMany:()=>new Response("rate limited",{status:429})}));
vi.mock("@/lib/entitlement",()=>({getLiveOptionsAccess:state.access}));
vi.mock("@/lib/flowSource",()=>({isValidF:()=>true,fixtureFor:vi.fn(),attachFlowScores:()=>{},tryFetchUpstreamResult:state.upstream}));
vi.mock("@/lib/optionsAlphaCandidatePair",()=>({fetchOptionsAlphaCandidatePair:vi.fn()}));
vi.mock("@/lib/ndxFamilyAdmission",()=>({isGexFamilyFeed:()=>false,isUnadmittedGexFamilyArtifact:()=>false}));
const url="http://localhost/api/flow?f=prophet_idx";
const source={schema:"prophet.index/v1",asof:"2026-11-02",source_asof:"2026-10-30",open_count:0,plans:[],internal_history:"not an overview field"};
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();vi.stubEnv("FLOW_FIXTURE","0");state.rate.mockReturnValue({ok:true});state.access.mockResolvedValue("allowed");state.upstream.mockResolvedValue({status:"data",data:source});});
afterEach(()=>vi.unstubAllEnvs());
describe("compact Prophet view over the incumbent route",()=>{
 it.each([["denied",403],["unavailable",503]] as const)("%s is enforced before the source read",async(access,status)=>{
  state.access.mockResolvedValue(access);const {GET}=await import("@/app/api/flow/route");expect((await GET(new Request(url+"&view=intelligence"))).status).toBe(status);expect(state.upstream).not.toHaveBeenCalled();
 });
 it("rate limits the summary just like the full feed",async()=>{state.rate.mockReturnValue({ok:false});const {GET}=await import("@/app/api/flow/route");expect((await GET(new Request(url+"&view=intelligence"))).status).toBe(429);expect(state.upstream).not.toHaveBeenCalled();});
 it("does not poison the existing cache with a projected body",async()=>{
  const {GET}=await import("@/app/api/flow/route");const compact=await GET(new Request(url+"&view=intelligence"));expect((await compact.json()).schema).toBe("mmx.intelligence.prophet.v1");
  expect(await(await GET(new Request(url))).json()).toEqual(source);expect(state.upstream).toHaveBeenCalledTimes(1);
  state.access.mockResolvedValue("denied");expect((await GET(new Request(url+"&view=intelligence"))).status).toBe(403);
 });
 it("only the exact Prophet selection receives the projection",async()=>{const {GET}=await import("@/app/api/flow/route");expect(await(await GET(new Request("http://localhost/api/flow?f=feed&view=intelligence"))).json()).toEqual(source);});
});

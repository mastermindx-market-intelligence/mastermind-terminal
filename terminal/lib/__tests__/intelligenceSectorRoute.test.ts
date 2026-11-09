import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Synthetic session/unit responses only. No authenticated or upstream proof.
const state = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), rate: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: state }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [{name:"sb-test-auth-token",value:"unit-only"}] }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: state.rate }));
vi.mock("@/lib/upstreams", () => ({ NW_BASE: "https://mastermind-x.com" }));
vi.mock("@/lib/adminGate", () => ({ isAdminRequest: vi.fn() }));
vi.mock("@/lib/marketRisk", () => ({ qualifyRiskEnvelope: vi.fn() }));
vi.mock("@/lib/finvizMembershipManifest", () => ({ qualifyFinvizMembershipManifest: vi.fn() }));
import { GET } from "@/app/api/sector-intelligence/route";
const source = {meta:{asOf:"2026-10-30",n_sectors:1,benchmark:"SPY",rs_history:{
  schema:"sector_cycles.rs_history.v1",mode:"reconstructed_price_history",naturally_observed:false,
  basis:"tr",benchmark:"SPY",horizons_sessions:[21,63],max_points_per_sector:252}},sectors:[
  {id:"xlk",ticker:"XLK",kind:"sector",name:"Technology",rs_history:[{date:"2026-10-30",rs_21d:1,rs_63d:2}],
    now:{phase:"Downturn",pos:41,pos_v2:96},price:[{v:100}]}]};
const request = (query = "source=history&view=intelligence", credential = true) => new Request(
  `http://localhost/api/sector-intelligence?${query}`, credential ? {headers:{Cookie:"sb-test-auth-token=unit-only; other=private"}} : undefined);
beforeEach(() => {
  vi.clearAllMocks(); state.rate.mockReturnValue({ok:true,retryAfterSec:30});
  state.getUser.mockResolvedValue({data:{user:{id:"unit-owner"}},error:null});
  state.getSession.mockResolvedValue({data:{session:{user:{id:"unit-owner"},access_token:"unit-token"}}});
  state.fetch.mockImplementation(async () => Response.json(source)); vi.stubGlobal("fetch",state.fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe("compact cycles over the current member/source gateway", () => {
  it("refuses missing credentials before auth or fetch",async () => {
    expect((await GET(request(undefined,false))).status).toBe(401);
    expect(state.getUser).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("refuses a mismatched current session before fetch",async () => {
    state.getSession.mockResolvedValue({data:{session:{user:{id:"other"},access_token:"unit-token"}}});
    expect((await GET(request())).status).toBe(401); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("keeps gateway rate refusal and retry header",async () => {
    state.rate.mockReturnValue({ok:false,retryAfterSec:30});const r=await GET(request());
    expect(r.status).toBe(429); expect(r.headers.get("Retry-After")).toBe("30");expect(state.fetch).not.toHaveBeenCalled();
  });
  it.each([403,404,429])("preserves owner HTTP %s and failure receipt",async status => {
    state.fetch.mockResolvedValue(new Response("{}",{status,headers:{"Retry-After":"17"}})); const r=await GET(request());
    expect(r.status).toBe(status); expect((await r.json()).receipt.source).toBe("history");
    if(status===429) expect(r.headers.get("Retry-After")).toBe("17");
  });
  it("projects the canonical owner result after the same fixed-origin, filtered-cookie read",async () => {
    const r=await GET(request()), value=await r.json();
    expect(value).toMatchObject({schema:"mmx.intelligence.cycles.v1",sourceAsOf:"2026-10-30",benchmark:"SPY",coverage:1,
      rows:[{id:"xlk",position:41,phase:"Downturn",model:"published"}]});
    expect(JSON.stringify(value)).not.toContain("price");expect(JSON.stringify(value)).not.toContain("observedAt");
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const [url,init]=state.fetch.mock.calls[0];expect(String(url)).toBe("https://www.mastermind-x.com/sectordata/sector_cycles.json");
    expect(init).toMatchObject({redirect:"manual",cache:"no-store",headers:{Cookie:"sb-test-auth-token=unit-only"}});
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("leaves the ordinary full history body and receipt intact",async () => {
    const value=await (await GET(request("source=history"))).json();
    expect(value.data).toEqual(source);expect(value.receipt.path).toBe("/sectordata/sector_cycles.json");
    expect(value.receipt.observedAt).toBeTypeOf("string");
  });
  it("does not turn malformed success into an empty fresh summary",async () => {
    state.fetch.mockResolvedValue(Response.json({...source,meta:{...source.meta,n_sectors:2}}));
    const r=await GET(request());expect(r.status).toBe(503);expect(await r.json()).toEqual({error:"intelligence_summary_unavailable"});
  });
  it("does not expand source enrollment with the summary selector",async () => {
    expect((await GET(request("source=https://foreign.invalid/data&view=intelligence"))).status).toBe(400);
    expect(state.fetch).not.toHaveBeenCalled();
  });
});

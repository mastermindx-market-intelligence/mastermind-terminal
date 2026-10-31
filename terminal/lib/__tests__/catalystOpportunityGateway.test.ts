import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fixture from "./fixtures/catalystOpportunity.json";
const config = vi.hoisted(()=>({base:"https://www.mastermind-x.com"}));
const auth = vi.hoisted(()=>vi.fn());
const limiter = vi.hoisted(()=>vi.fn());
vi.mock("@/app/api/billing/gateway",()=>({get BILLING_BASE(){return config.base;},billingAuthResult:auth}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:limiter}));
import { GET } from "@/app/api/catalyst-opportunities/route";
import { CATALYST_MAX_BYTES, CATALYST_DEADLINE_MS } from "../catalystOpportunityServer";
let upstream:ReturnType<typeof vi.fn>;
const request = (suffix="", signal?:AbortSignal) => new Request("https://terminal.example/api/catalyst-opportunities"+suffix,{signal});
const response = (value:unknown=fixture,status=200) => new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
function privateHeaders(r:Response){expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("vary")).toBe("Authorization, Cookie");expect(r.headers.get("x-content-type-options")).toBe("nosniff");}
beforeEach(()=>{vi.clearAllMocks();config.base="https://www.mastermind-x.com";auth.mockResolvedValue({status:"ok",token:"test-session"});limiter.mockReturnValue({ok:true});upstream=vi.fn().mockResolvedValue(response());vi.stubGlobal("fetch",upstream);});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

describe("Catalyst fixed-owner gateway",()=>{
  it("reuses verified session auth and forwards to only the fixed entitled owner route",async()=>{
    const r=await GET(request());expect(r.status).toBe(200);privateHeaders(r);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url,init]=upstream.mock.calls[0];
    expect(url).toBe("https://www.mastermind-x.com/api/catalyst-opportunities/v1");
    expect(init).toMatchObject({method:"GET",cache:"no-store",redirect:"manual",headers:{Authorization:"Bearer test-session"}});
    expect((await r.json()).cases).toHaveLength(2);
  });
  it("denies before any source fetch, including an invalid query",async()=>{
    auth.mockResolvedValue({status:"denied"});
    const r=await GET(request("?url=https://evil.example"));expect(r.status).toBe(401);privateHeaders(r);expect(upstream).not.toHaveBeenCalled();
  });
  it("does not turn an authentication outage into an entitlement denial",async()=>{
    auth.mockResolvedValue({status:"unavailable"});
    const r=await GET(request());expect(r.status).toBe(503);privateHeaders(r);expect(upstream).not.toHaveBeenCalled();
  });
  it.each(["?as_of=2020-01-01","?path=/private","?source=other","?x=1&x=2"])("rejects request-selected sources or cutoffs",async q=>{
    const r=await GET(request(q));expect(r.status).toBe(400);privateHeaders(r);expect(upstream).not.toHaveBeenCalled();
  });
  it.each(["http://www.mastermind-x.com","https://evil.example","https://www.mastermind-x.com@evil.example","https://www.mastermind-x.com:8443","https://www.mastermind-x.com/private"])("never sends the token to an unapproved origin",async base=>{
    config.base=base;const r=await GET(request());expect(r.status).toBe(503);privateHeaders(r);expect(upstream).not.toHaveBeenCalled();
  });
  it("canonicalizes the known bare origin without following a redirect",async()=>{
    config.base="https://mastermind-x.com";await GET(request());expect(upstream.mock.calls[0][0]).toContain("https://www.mastermind-x.com/");
  });
  it.each([401,403])("preserves actual owner access denial without exposing its body",async status=>{
    upstream.mockResolvedValue(response({private_detail:"sensitive"},status));const r=await GET(request());
    expect(r.status).toBe(status);privateHeaders(r);expect(await r.text()).not.toContain("sensitive");
  });
  it("refuses redirects, does not chase them, and does not expose upstream errors",async()=>{
    upstream.mockResolvedValue(new Response("sensitive",{status:307,headers:{Location:"https://evil.example"}}));
    const r=await GET(request());expect(r.status).toBe(503);expect(upstream).toHaveBeenCalledTimes(1);expect(await r.text()).not.toContain("sensitive");privateHeaders(r);
  });
  it("withholds widened authority",async()=>{
    const input=structuredClone(fixture);input.authority.can_rank=true;upstream.mockResolvedValue(response(input));
    const r=await GET(request());expect(r.status).toBe(503);privateHeaders(r);
  });
  it("bounds the actual stream even without a content-length header",async()=>{
    upstream.mockResolvedValue(new Response("x".repeat(CATALYST_MAX_BYTES+1),{headers:{"Content-Type":"application/json"}}));
    const r=await GET(request());expect(r.status).toBe(503);privateHeaders(r);
  });
  it("refuses non-JSON and invalid UTF-8",async()=>{
    upstream.mockResolvedValue(new Response("<html>sensitive</html>",{headers:{"Content-Type":"text/html"}}));
    expect((await GET(request())).status).toBe(503);
    upstream.mockResolvedValue(new Response(new Uint8Array([255]),{headers:{"Content-Type":"application/json"}}));
    expect((await GET(request())).status).toBe(503);
  });
  it("times out a nonreturning source request without retry",async()=>{
    vi.useFakeTimers();upstream.mockImplementation(()=>new Promise(()=>{}));
    const pending=GET(request());await vi.advanceTimersByTimeAsync(CATALYST_DEADLINE_MS+1);
    const r=await pending;expect(r.status).toBe(503);privateHeaders(r);expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("times out a nonreturning body",async()=>{
    vi.useFakeTimers();upstream.mockResolvedValue(new Response(new ReadableStream(),{headers:{"Content-Type":"application/json"}}));
    const pending=GET(request());await vi.advanceTimersByTimeAsync(CATALYST_DEADLINE_MS+1);
    const r=await pending;expect(r.status).toBe(503);privateHeaders(r);
  });
  it("never fetches after caller cancellation",async()=>{
    const controller=new AbortController();controller.abort();const r=await GET(request("",controller.signal));
    expect(r.status).toBe(503);expect(upstream).not.toHaveBeenCalled();privateHeaders(r);
  });
  it("applies the existing rate limiter",async()=>{
    limiter.mockReturnValue({ok:false,retryAfterSec:12});const r=await GET(request());
    expect(r.status).toBe(429);expect(r.headers.get("retry-after")).toBe("12");expect(upstream).not.toHaveBeenCalled();privateHeaders(r);
  });
});

// Same gateway policy, a second fixed incumbent owner. No new credential plane.
import defenseFixture from "./fixtures/catalystDefenseOwner.json";
import { GET as defenseGET } from "@/app/api/catalyst-opportunities/defense/route";
describe("Catalyst Defense fixed-owner integration",()=>{
  beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));upstream.mockResolvedValue(response(defenseFixture));});
  it("reuses the verified session and incumbent site-full Defense endpoint",async()=>{
    const r=await defenseGET(request());expect(r.status).toBe(200);privateHeaders(r);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][0]).toBe("https://www.mastermind-x.com/api/government-revenue/defense-economics");
    expect(upstream.mock.calls[0][1]).toMatchObject({redirect:"manual",cache:"no-store",headers:{Authorization:"Bearer test-session"}});
    expect(await r.json()).toEqual(defenseFixture);
    expect(limiter).toHaveBeenCalledWith(expect.any(Request),{name:"catalyst-opportunities",max:60});
  });
  it("denies before reading Defense sources",async()=>{
    auth.mockResolvedValue({status:"denied"});const r=await defenseGET(request("?source=private"));
    expect(r.status).toBe(401);expect(upstream).not.toHaveBeenCalled();privateHeaders(r);
  });
  it.each([401,403,503,307])("preserves safe behavior for owner HTTP %s",async status=>{
    upstream.mockResolvedValue(response({sensitive:"private diagnostics"},status));const r=await defenseGET(request());
    expect(r.status).toBe(status===307?503:status);privateHeaders(r);expect(await r.text()).not.toContain("private diagnostics");
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("rejects request-selected owners and observation cutoffs",async()=>{
    const r=await defenseGET(request("?url=https://evil.example&as_of=2020-01-01"));
    expect(r.status).toBe(400);expect(upstream).not.toHaveBeenCalled();privateHeaders(r);
  });
  it("does not route a token to an unapproved base",async()=>{
    config.base="https://evil.example";const r=await defenseGET(request());
    expect(r.status).toBe(503);expect(upstream).not.toHaveBeenCalled();privateHeaders(r);
  });
  it("refuses future-published evidence",async()=>{
    const p=structuredClone(defenseFixture);p.generated_at="2026-10-18T00:00:00Z";upstream.mockResolvedValue(response(p));
    const r=await defenseGET(request());expect(r.status).toBe(503);privateHeaders(r);
  });
  it("refuses widened Defense trade authority",async()=>{
    const p=structuredClone(defenseFixture);p.profiles[0].authority.can_size=true;upstream.mockResolvedValue(response(p));
    const r=await defenseGET(request());expect(r.status).toBe(503);privateHeaders(r);
  });
});

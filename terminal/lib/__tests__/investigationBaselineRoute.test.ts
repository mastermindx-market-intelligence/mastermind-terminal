import {beforeEach,describe,expect,it,vi} from "vitest";
import golden from "./fixtures/aapl-event-workspace.json";
const {getUser,current,retained}=vi.hoisted(()=>({getUser:vi.fn(),current:vi.fn(),retained:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser}})}));
vi.mock("@/lib/eventWorkspace",async()=>{
 const real=await vi.importActual<typeof import("@/lib/eventWorkspace")>("@/lib/eventWorkspace");
 return {...real,resolveCurrentEventWorkspaceFromR2:current};
});
vi.mock("@/lib/investigationIssuerRelease",()=>({resolveInvestigationIssuerRelease:retained}));
import {GET} from "@/app/api/investigations/baseline/route";
const request=(q:string)=>new Request(`https://terminal.test/api/investigations/baseline?${q}`);
beforeEach(()=>{vi.clearAllMocks();getUser.mockResolvedValue({data:{user:{id:"real-session-placeholder-in-unit-test"}},error:null});current.mockResolvedValue({ok:true,state:"ready",workspace:golden});retained.mockResolvedValue({ok:false,code:"HISTORICAL_UNAVAILABLE",reason:"missing_generation"});});
describe("personal retained Earnings BFF",()=>{
 it("refuses unauthenticated reads before any owner lookup",async()=>{getUser.mockResolvedValue({data:{user:null},error:null});expect((await GET(request("symbol=AAPL"))).status).toBe(401);expect(current).not.toHaveBeenCalled();expect(retained).not.toHaveBeenCalled();});
 it("passes the exact old pin to its owner without selecting current",async()=>{
  const pin={event_id:golden.event_id,generation_id:golden.generation_id,company_id:golden.issuer.company_id,fingerprint:"a".repeat(64)};
  const response=await GET(request(new URLSearchParams(pin).toString()));
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"HISTORICAL_UNAVAILABLE"});expect(current).not.toHaveBeenCalled();
  expect(retained.mock.calls[0][0]).toEqual(pin);expect(retained.mock.calls[0][2].authorize).toBeUndefined();expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
 it("rejects stale current or wrong subject without retaining a replacement",async()=>{
  current.mockResolvedValue({ok:true,state:"stale",workspace:golden});expect((await GET(request("symbol=AAPL"))).status).toBe(503);expect(retained).not.toHaveBeenCalled();
  current.mockResolvedValue({ok:true,state:"ready",workspace:golden});expect((await GET(request("symbol=MSFT"))).status).toBe(503);expect(retained).not.toHaveBeenCalled();
 });
 it("rejects repeated and mixed selectors",async()=>{
  for(const q of ["symbol=AAPL&symbol=AAPL","symbol=AAPL&event_id=x","event_id=x"])expect((await GET(request(q))).status).toBe(400);
  expect(current).not.toHaveBeenCalled();expect(retained).not.toHaveBeenCalled();
 });
});

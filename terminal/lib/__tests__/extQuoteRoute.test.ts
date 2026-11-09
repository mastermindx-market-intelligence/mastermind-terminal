/** The existing public extended-quote route admits only cleared BOATS facts. */
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {GET} from "@/app/api/ext-quote/route";
const now=Date.UTC(2026,9,12,0,1);
const row={extPrice:100,extChg:1,extTs:now/1000,extSource:"tiingo_boats",extBasis:"LIVE",
 extSession:"overnight",extVenue:"BOATS",extPriceKind:"LAST_TRADE",extReceivedTs:now/1000,
 extPublishedTs:now/1000,extExpiresTs:now/1000+30,extCaptureId:"12345678-1234-1234-1234-123456789abc",extGeneration:1};
let originalFetch:typeof fetch;let calls:string[];let ip=0;
const req=(syms:string)=>new Request(`http://localhost/api/ext-quote?syms=${syms}`,{headers:{"cf-connecting-ip":`203.0.113.${++ip}`}});
function hub(body:unknown,status=200){globalThis.fetch=vi.fn(async(url:any)=>{
 calls.push(String(url));return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}) as any;}
const quotes=async(syms="AMD")=>(await(await GET(req(syms))).json()).quotes;
beforeEach(()=>{originalFetch=globalThis.fetch;calls=[];vi.spyOn(Date,"now").mockReturnValue(now);});
afterEach(()=>{globalThis.fetch=originalFetch;vi.restoreAllMocks();});
describe("BOATS public boundary",()=>{
 it("relays only the approved provenance/clock fields and preserves null semantics",async()=>{
  hub({AMD:{...row,raw_message:"synthetic fixture",last:90},AAPL:{last:200}});
  expect(await quotes("AMD,AAPL")).toEqual({AMD:row,AAPL:null});
 });
 it.each(["yahoo-relay","webull","alpaca_overnight","polygon_live",undefined])("does not infer rights from source %s",async(source)=>{
  hub({AMD:{...row,extSource:source}});expect((await quotes()).AMD).toBeNull();
 });
 it.each(["extBasis","extVenue","extPriceKind","extReceivedTs","extPublishedTs","extExpiresTs","extCaptureId","extGeneration"])("rejects missing %s",async(field)=>{
  const q:Record<string,unknown>={...row};delete q[field];hub({AMD:q});expect((await quotes()).AMD).toBeNull();
 });
 it("expires a retained trade without a new publication",async()=>{
  vi.spyOn(Date,"now").mockReturnValue(now+30_000);hub({AMD:row});expect((await quotes()).AMD).toBeNull();
 });
 it.each([
  {extPrice:0},{extPrice:-1},{extChg:"invalid"},{extTs:now/1000+1},
  {extPublishedTs:now/1000+1},{extExpiresTs:now/1000+31},{extSession:"post"},
  {extBasis:"UNOFFICIAL"},{extVenue:"NASDAQ"},{extGeneration:0},{extCaptureId:"guessed-id"},
 ])("rejects invalid price/provenance/time %#",async(extra)=>{
  hub({AMD:{...row,...extra}});expect((await quotes()).AMD).toBeNull();
 });
 it("can serve the price with no invented change when the regular close is missing",async()=>{
  hub({AMD:{...row,extChg:null}});expect((await quotes()).AMD.extChg).toBeNull();
 });
 it("uses only the incumbent hub with explicit source eligibility",async()=>{
  hub({AMD:row});await quotes();expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("127.0.0.1");expect(calls[0]).toContain("extSource=tiingo_boats");
 });
 it("returns 503 for transport failure rather than an authoritative empty snapshot",async()=>{
  globalThis.fetch=vi.fn(async()=>{throw new Error("ECONNREFUSED");}) as any;
  const r=await GET(req("AMD"));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:"quote_hub_unavailable"});
 });
 it("returns 503 for hub failure or malformed response",async()=>{
  hub({error:"busy"},500);expect((await GET(req("AMD"))).status).toBe(503);
  hub([]);expect((await GET(req("AMD"))).status).toBe(503);
 });
 it("disables cache for both nonempty and empty successful requests",async()=>{
  hub({AMD:row});expect((await GET(req("AMD"))).headers.get("Cache-Control")).toBe("no-store");
  expect((await GET(req(""))).headers.get("Cache-Control")).toBe("no-store");
 });
});

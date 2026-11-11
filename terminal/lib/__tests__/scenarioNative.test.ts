import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import producer from "./fixtures/exposure-projection-dex-v2.json";
import { createExposureMapReader } from "../exposureMap";
import { scenarioBasisFromRead } from "@/components/exposure-map/exposureScenarioBasis";
import { SCENARIO_VERSION, localScenarioValue } from "../exposureScenario";
import { decodeNativeScenario, parseScenarioNativeIntent, requestNativeScenario, SCENARIO_NATIVE_URL, type ScenarioNativeIntent } from "../scenarioNative";
import { parseScenarioCapture } from "../investigationScenario";
const id="10000000-0000-4000-8000-000000000001", grant="20000000-0000-4000-8000-000000000002", operation="30000000-0000-4000-8000-000000000003";
const hash=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
const instant="2026-10-15T20:01:00Z", lens={kind:"all"} as const;
const gex={schema:"options_hub.gex/v1",root:"SPY",asof:"2026-10-15",spot_ref:100,by_strike:[],exposure_projection:producer};
const bytes=Buffer.from(JSON.stringify(gex));
const reader=createExposureMapReader(gex,"SPY",null,"2026-10-15",Date.parse(instant));
const read=reader(lens,"gamma");
const basis=scenarioBasisFromRead(read,reader,lens,"SPY",null)!;
const capture=parseScenarioCapture({schema:"investigation_scenario_reference.v1",model_version:SCENARIO_VERSION,
 inputs:{targetSpot:101,deltaSigmaPts:0,days:0},source:{owner:"options_hub",root:"SPY",session:"2026-10-15",
 source_as_of:read.sourceAsOf,evaluated_at:instant,lens,selection_key:read.selectionKey,
 basis_sha256:hash(Buffer.from(JSON.stringify({model_version:SCENARIO_VERSION,basis}))),
 gex:{sha256:hash(bytes),byte_length:bytes.length},moves:null}})!;
const intent:ScenarioNativeIntent={mode:"resolve",investigation_id:id,revision:4,grant_id:null};
const envelope=()=>({status:"resolved",...intent,capture:structuredClone(capture),gex:{...capture.source.gex,base64:bytes.toString("base64")},moves:null});
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it("reproduces the existing qualified native basis and full-precision calculation from exact retained bytes",()=>{
 expect(capture).not.toBeNull(); expect(read.qualification).toBe("qualified");
 expect(decodeNativeScenario(envelope(),intent)).toEqual({status:"resolved",investigation_id:id,revision:4,grant_id:null,capture,basis,result:localScenarioValue(basis,capture.inputs)});
});
it("binds exact mode, canonical UUID, revision and recipient grant",()=>{
 for(const change of [{mode:"qualify"},{investigation_id:operation},{revision:5},{grant_id:grant},{status:"qualified"}]) expect(decodeNativeScenario({...envelope(),...change},intent)).toEqual({status:"unavailable"});
 const recipient={...intent,grant_id:grant};
 expect(decodeNativeScenario({...envelope(),grant_id:grant},recipient).status).toBe("resolved");
 expect(decodeNativeScenario(envelope(),recipient).status).toBe("unavailable");
});
it("requires qualified prospective capture identity and exact CAS next revision before any IO",async()=>{
 const prospective={mode:"qualify",investigation_id:id,revision:1,grant_id:null,expected_revision:0,operation_id:operation,capture} as const;
 expect(parseScenarioNativeIntent(prospective)).not.toBeNull();
 expect(decodeNativeScenario({...envelope(),mode:"qualify",revision:1},prospective).status).toBe("resolved");
 const changed={...capture,inputs:{...capture.inputs,days:1}};
 expect(decodeNativeScenario({...envelope(),mode:"qualify",revision:1,capture:changed},prospective).status).toBe("unavailable");
 const fetcher=vi.fn();
 expect(await requestNativeScenario({...prospective,revision:2},"server-token",{fetcher})).toEqual({status:"unavailable"});
 expect(fetcher).not.toHaveBeenCalled();
});
it("rejects raw byte, size, digest, base64, kind, source-clock, model and basis substitutions",()=>{
 const original=envelope();
 const changes=[{...original,gex:{...original.gex,byte_length:1}},{...original,gex:{...original.gex,sha256:"a".repeat(64)}},
 {...original,gex:{...original.gex,base64:original.gex.base64+"\n"}},
 {...original,capture:{...capture,model_version:"other"}},
 {...original,capture:{...capture,source:{...capture.source,basis_sha256:"a".repeat(64)}}},
 {...original,capture:{...capture,source:{...capture.source,source_as_of:null}}},
 {...original,capture:{...capture,source:{...capture.source,selection_key:"2026-10-16|2026-10-16T20:00:00Z"}}}];
 for(const value of changes) expect(decodeNativeScenario(value,intent)).toEqual({status:"unavailable"});
});
it("uses captured selection time and refuses explicit unresolved moves without silently dropping them",()=>{
 const original=envelope();
 const past={...capture,source:{...capture.source,evaluated_at:"2026-10-15T19:00:00Z"}};
 expect(decodeNativeScenario({...original,capture:past},intent).status).toBe("unavailable");
 expect(decodeNativeScenario({...original,moves:{}},intent).status).toBe("unavailable");
 const moveRaw=Buffer.from(JSON.stringify({schema:"options_hub.moves/v1",root:"SPY",asof:"2026-10-15",spot_ref:100,expected_move:null}));
 const ref={sha256:hash(moveRaw),byte_length:moveRaw.length};
 expect(decodeNativeScenario({...original,capture:{...capture,source:{...capture.source,moves:ref}},moves:{...ref,base64:moveRaw.toString("base64")}},intent).status).toBe("unavailable");
});
it("does not accept legacy/dated projection or unavailable native calculation as zero",()=>{
 const unqualified={...gex,exposure_projection:undefined};const raw=Buffer.from(JSON.stringify(unqualified));const ref={sha256:hash(raw),byte_length:raw.length};
 expect(decodeNativeScenario({...envelope(),capture:{...capture,source:{...capture.source,gex:ref}},gex:{...ref,base64:raw.toString("base64")}},intent).status).toBe("unavailable");
 expect(decodeNativeScenario({...envelope(),capture:{...capture,inputs:{targetSpot:1000,deltaSigmaPts:0,days:0}}},intent).status).toBe("unavailable");
});
it("transports only to the fixed private origin with exact server bearer, no cache or redirect",async()=>{
 const fetcher=vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit)=>response(envelope()));
 expect((await requestNativeScenario(intent,"server-token",{fetcher})).status).toBe("resolved");
 expect(fetcher.mock.calls[0][0]).toBe(SCENARIO_NATIVE_URL);
 const options=fetcher.mock.calls[0][1] as RequestInit;
 expect(options.redirect).toBe("manual");expect(options.cache).toBe("no-store");expect(options.headers).toMatchObject({Authorization:"Bearer server-token"});
 expect(JSON.parse(String(options.body))).toEqual(intent);
});
it("refuses redirects, oversized/deep/duplicate JSON, token injection, malformed status and failed HTTP success",async()=>{
 for(const [body,status,headers] of [["{}",302,{}],["{}",200,{"content-length":String(14*1024*1024)}],["{\"status\":\"denied\",\"status\":\"resolved\"}",200,{}],[JSON.stringify(envelope()),403,{}]] as const){
  const fetcher=vi.fn(async()=>new Response(body,{status,headers:{"content-type":"application/json",...headers}}));
  expect(await requestNativeScenario(intent,"server-token",{fetcher})).toEqual({status:"unavailable"});
 }
 const fetcher=vi.fn();expect(await requestNativeScenario(intent,"bad\ntoken",{fetcher})).toEqual({status:"unavailable"});expect(fetcher).not.toHaveBeenCalled();
 expect(decodeNativeScenario({status:"denied",diagnostic:"secret"},intent).status).toBe("unavailable");
});
it("performs an actual bounded HTTP round trip with the fixed production-target request retained by the test seam",async()=>{
 let got:unknown=null;const server=createServer(async(req,res)=>{let body="";for await(const chunk of req)body+=chunk;got={url:req.url,authorization:req.headers.authorization,body:JSON.parse(body)};res.writeHead(200,{"content-type":"application/json","cache-control":"private, no-store"});res.end(JSON.stringify(envelope()));});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=(server.address() as {port:number}).port;
 try{
  const fetcher:typeof fetch=(url,options)=>{expect(String(url)).toBe(SCENARIO_NATIVE_URL);return fetch(`http://127.0.0.1:${port}/api/options/scenario-source/resolve`,options);};
  expect((await requestNativeScenario(intent,"controlled-session",{fetcher})).status).toBe("resolved");
  expect(got).toEqual({url:"/api/options/scenario-source/resolve",authorization:"Bearer controlled-session",body:intent});
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

it("bounds a stalled fetch and a stalled body even when a test transport ignores AbortSignal",async()=>{
 vi.useFakeTimers();
 const fetcher:typeof fetch=()=>new Promise(()=>{});
 const pending=requestNativeScenario(intent,"server-token",{fetcher});
 await vi.advanceTimersByTimeAsync(12_000);expect(await pending).toEqual({status:"unavailable"});
 const stalled=requestNativeScenario(intent,"server-token",{fetcher:async()=>new Response(new ReadableStream(),{headers:{"content-type":"application/json"}})});
 await vi.advanceTimersByTimeAsync(12_000);expect(await stalled).toEqual({status:"unavailable"});
});

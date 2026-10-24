import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { scenarioNativePacket } from "./fixtures/scenarioNativePacket";
import { acquiredScenarioBytes, scenarioReferenceFromAcquisition } from "../scenarioAcquisition";
import { tryFetchUpstreamResult } from "../flowSource";
import { R2_BASE } from "../upstreams";
const packet = scenarioNativePacket(), raw = Buffer.from(packet.gex_base64, "base64");
const data = () => ({ ...JSON.parse(raw.toString()), _scenario_source_identity: {
 schema:"options_hub.acquired_bytes/v1",kind:"gex",root:"SPY",session:"2026-10-15",...packet.capture.source.gex } });
const args = () => ({ source:data(),moves:null,root:"SPY",lens:{kind:"all"} as const,evaluatedAt:Date.parse(packet.capture.source.evaluated_at) });
afterEach(()=>vi.unstubAllGlobals());
it("builds the reference from acquired ORIGINAL identity and exact native captured basis",async()=>{
 const reference=await scenarioReferenceFromAcquisition(args());
 expect(reference).not.toBeNull();expect(reference?.gex).toEqual(packet.capture.source.gex);
 expect(reference?.basis_sha256).toBe(packet.capture.source.basis_sha256);
 expect(reference?.selection_key).toBe(packet.capture.source.selection_key);
});
it("refuses missing/forged-shape/stale identity and never fingerprints browser JSON",async()=>{
 const source=data();delete (source as Record<string,unknown>)._scenario_source_identity;
 expect(await scenarioReferenceFromAcquisition({...args(),source})).toBeNull();
 for(const patch of [{stale:true},{_scenario_source_identity:{...data()._scenario_source_identity,kind:"moves"}},
  {_scenario_source_identity:{...data()._scenario_source_identity,root:"QQQ"}}]) expect(await scenarioReferenceFromAcquisition({...args(),source:{...data(),...patch}})).toBeNull();
 expect(await scenarioReferenceFromAcquisition({...args(),stale:true})).toBeNull();
});
it("preserves original R2 whitespace/number bytes rather than browser/backend serialization",async()=>{
 const bytes=Buffer.from(JSON.stringify(JSON.parse(raw.toString()),null,2)+"\n");
 vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL)=>String(url).startsWith(R2_BASE)?new Response(bytes):new Response("unavailable",{status:503})));
 const outcome=await tryFetchUpstreamResult("gex:SPY");expect(outcome.status).toBe("data");
 if(outcome.status!=="data")throw Error("missing");
 expect(acquiredScenarioBytes(outcome.data,"gex","SPY","2026-10-15")).toEqual({sha256:createHash("sha256").update(bytes).digest("hex"),byte_length:bytes.length});
 expect((outcome.data._scenario_source_identity as {sha256:string}).sha256).not.toBe(packet.capture.source.gex.sha256);
});
it("preserves Hub producer identity rather than hashing the Hub reserialized response",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(data())));
 const outcome=await tryFetchUpstreamResult("gex:SPY");expect(outcome.status).toBe("data");
 if(outcome.status==="data")expect(acquiredScenarioBytes(outcome.data,"gex","SPY","2026-10-15")).toEqual(packet.capture.source.gex);
});
it("binds optional moves identity only when native math uses it, refusing stale or unbound moves",async()=>{
 const moves={schema:"options_hub.moves/v1",root:"SPY",asof:"2026-10-15",spot_ref:100,expected_move:{pct:3.92,band_mult:1.96,horizon_days:1}};
 expect(await scenarioReferenceFromAcquisition({...args(),moves})).toBeNull();
 const bytes=Buffer.from(JSON.stringify(moves));
 const expected={sha256:createHash("sha256").update(bytes).digest("hex"),byte_length:bytes.length};
 const acquired={...moves,_scenario_source_identity:{schema:"options_hub.acquired_bytes/v1",kind:"moves",root:"SPY",session:"2026-10-15",...expected}};
 expect((await scenarioReferenceFromAcquisition({...args(),moves:acquired}))?.moves).toEqual(expected);
 expect(await scenarioReferenceFromAcquisition({...args(),moves:{...acquired,stale:true}})).toBeNull();
});

it("keeps larger display payloads available without fabricating a capture-sized identity",async()=>{
 const value={schema:"options_hub.moves/v1",root:"SPY",asof:"2026-10-15",padding:"x".repeat(1024*1024),_scenario_source_identity:{sha256:"spoof"}};
 vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL)=>String(url).startsWith(R2_BASE)?Response.json(value):new Response("missing",{status:404})));
 const outcome=await tryFetchUpstreamResult("moves:SPY");expect(outcome.status).toBe("data");
 if(outcome.status==="data")expect(outcome.data._scenario_source_identity).toBeUndefined();
});

/** Controlled packet from the existing native projection fixture; no live rights/data claim. */
import { createHash } from "node:crypto";
import producer from "./exposure-projection-dex-v2.json";
import { createExposureMapReader } from "@/lib/exposureMap";
import { scenarioBasisFromRead } from "@/components/exposure-map/exposureScenarioBasis";
import { SCENARIO_VERSION } from "@/lib/exposureScenario";
import { parseScenarioCapture } from "@/lib/investigationScenario";
export function scenarioNativePacket() {
  const evaluated_at="2026-10-15T20:01:00Z",lens={kind:"all"} as const;
  const gex={schema:"options_hub.gex/v1",root:"SPY",asof:"2026-10-15",spot_ref:100,by_strike:[],exposure_projection:producer};
  const raw=Buffer.from(JSON.stringify(gex)); const hash=(v:Uint8Array)=>createHash("sha256").update(v).digest("hex");
  const reader=createExposureMapReader(gex,"SPY",null,"2026-10-15",Date.parse(evaluated_at)),read=reader(lens,"gamma");
  const basis=scenarioBasisFromRead(read,reader,lens,"SPY",null)!;
  const capture=parseScenarioCapture({schema:"investigation_scenario_reference.v1",model_version:SCENARIO_VERSION,
    inputs:{targetSpot:101,deltaSigmaPts:0,days:0},source:{owner:"options_hub",root:"SPY",session:"2026-10-15",source_as_of:read.sourceAsOf,
      evaluated_at,lens,selection_key:read.selectionKey,basis_sha256:hash(Buffer.from(JSON.stringify({model_version:SCENARIO_VERSION,basis}))),
      gex:{sha256:hash(raw),byte_length:raw.length},moves:null}})!;
  return {capture,gex_base64:raw.toString("base64")};
}

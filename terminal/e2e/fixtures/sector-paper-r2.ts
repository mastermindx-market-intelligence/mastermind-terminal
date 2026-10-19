/** Native Paper acceptance fixture only. Never imported by production.
 * Measured contract: checked-in 2026-10-09 fixture; illustrative three-point
 * trajectories and transport receipts are synthetic. The separate archived
 * confluence/theme source remains dated 2026-09-23. This proves no live market fact.
 */
import type { Route } from "@playwright/test";
import measured from "../../lib/__tests__/fixtures/measured_read_v1.json";
import { sectorFixture } from "./sector-company-v3";

const ids: Record<string, string> = { XLB:"xlb", XLC:"xlc", XLE:"xle", XLF:"xlf", XLI:"xli", XLK:"xlk", XLP:"xlp", XLRE:"xlre", XLU:"xlu", XLV:"xlv", XLY:"xly" };
const sectors=measured.groups.map(group=>({
  id:ids[group.group_id], ticker:group.group_id, name:group.name_en, name_zh:group.name_zh,
  momentum:{rs_21d:group.current.rs_21d,rs_63d:group.current.rs_63d,
    rs_21d_rank:group.current.rank,rs_rank:group.current.rank,above_200d:true,lead:"leading"},
  heat:{breadth_pct:58,adv:46,dec:33,heat_1M:7.01},
  cycle:{phaseLabel:"Rolling over"},conviction:{label_en:"Cautious"},rotation:{state:"TURN SIGNALED"},
}));
const history={meta:{asOf:"2026-10-09",rs_history:{schema:"sector_cycles.rs_history.v1",
  mode:"reconstructed_price_history",naturally_observed:false,basis:"tr",benchmark:"SPY",
  horizons_sessions:[21,63],max_points_per_sector:252}},
  sectors:measured.groups.filter(group=>group.current.status==="measured").map(group=>({
    id:ids[group.group_id],ticker:group.group_id,kind:"sector",
    rs_history:["2026-10-07","2026-10-08","2026-10-09"].map((date,index)=>({
      date,rs_21d:(group.current.rs_21d || 0)-(2-index)*.15,
      rs_63d:(group.current.rs_63d || 0)-(2-index)*.1,
    })),
  })),
};
const paths: Record<string,string>={sector:"/sectordata/sector_central.json",history:"/sectordata/sector_cycles.json",
  events:"/marketdata/rotation_events.json",risk:"/marketdata/risk_envelope.json",heatmap:"/marketdata/sp500_heatmap.json"};
export type PaperFixtureMode="ready"|"access"|"no-history";
export async function paperSectorFixture(route:Route,mode:PaperFixtureMode="ready"){
  const source=new URL(route.request().url()).searchParams.get("source") || "";
  if(mode!=="access" && (source==="confluence" || source==="themes"))return sectorFixture(route);
  const status=mode==="access" ? "access" : source==="sector" || (source==="history" && mode!=="no-history") ? "ready" : "unavailable";
  return route.fulfill({status:status==="access"?401:status==="ready"?200:404,json:{
    data:status==="ready" ? source==="sector" ? {as_of:"2026-10-09",sectors,measured_read:measured} : history : null,
    receipt:{source,path:paths[source] || "",status,asOf:status==="ready"?"2026-10-09":null,
      observedAt:status==="ready"?"2026-10-09T23:00:00Z":null,stale:false,
      contentHash:status==="ready"?"e2e-synthetic-"+source+"-2026-10-09":null},
  }});
}

import { describe, expect, it } from "vitest";
import fixture from "./fixtures/measured_read_v1.json";
import { DEFAULT_SECTOR_STATE, type FeedMap, type FeedStatus } from "../sectorIntelligence";
import { paperSectorBrief, paperLeadershipHistory, qualifyPaperReturnSeries, resolvePaperSectorState, writePaperSectorState, normalizePaperSectorNative, paperSectorReturnContext } from "../sectorPaper";

const copy = () => JSON.parse(JSON.stringify(fixture));
const feeds = (data: unknown = { measured_read: copy() }, status: FeedStatus = "ready"): FeedMap => ({
  sector: { data, receipt: { source:"sector", path:"/marketdata/sector_central.json", status,
    asOf:"2026-10-09", observedAt:"2026-10-09T23:00:00Z", stale:false, contentHash:"fixture" } },
});
const history = () => ({ definition:"cumulative_total_return_from_common_start", unit:"fraction",
  groupId:"XLE", benchmark:"SPY", currency:"USD", startSession:"2026-10-07", endSession:"2026-10-09",
  sourceId:"synthetic-test-source", membershipRevision:null,
  points:[{session:"2026-10-07",groupReturn:0,benchmarkReturn:0},
    {session:"2026-10-08",groupReturn:null,benchmarkReturn:0.01},
    {session:"2026-10-09",groupReturn:0.024,benchmarkReturn:0.015}] });

describe("Paper Brief consumes the native measured contract", () => {
  it("preserves the source rank, percent units, identity and separate 9/11 coverage", () => {
    const f=feeds(), before=JSON.stringify(f), model=paperSectorBrief(f);
    expect(model).toMatchObject({state:"ready",asOf:"2026-10-09",benchmark:"SPY",measured:9,expected:11,partial:true});
    expect(model.leader).toMatchObject({groupId:"XLE",rank:1,rs21d:2.4,rs63d:4.1});
    expect(model.priorities.map(row=>row.groupId)).toEqual(["XLE","XLY","XLC"]);
    expect(model.unmeasured.map(row=>row.groupId)).toEqual(["XLRE","XLU"]);
    expect(JSON.stringify(f)).toBe(before);
  });
  it.each(["access","error","unavailable","invalid","loading"] as const)("preserves %s instead of empty success", status => {
    expect(paperSectorBrief(feeds(null,status)).state).toBe(status);
  });
  it("keeps an absent measurement distinct from malformed measurement", () => {
    expect(paperSectorBrief(feeds({})).state).toBe("unavailable");
    expect(paperSectorBrief(feeds({measured_read:{status:"available",groups:[]}})).state).toBe("invalid");
  });
  it.each(["duplicate_id","missing_rank","duplicate_rank","bad_measure","bad_count","bad_session"])("rejects inconsistent %s", fault => {
    const f=copy(), first=f.groups.find((row: {current:{status:string}})=>row.current.status==="measured");
    if(fault==="duplicate_id")f.groups[1].group_id=f.groups[0].group_id;
    if(fault==="missing_rank")first.current.rank=null;
    if(fault==="duplicate_rank")f.groups.filter((row: {current:{status:string}})=>row.current.status==="measured")[1].current.rank=first.current.rank;
    if(fault==="bad_measure")first.current.rs_21d=true;
    if(fault==="bad_count")f.cohort.expected_n=10;
    if(fault==="bad_session")f.generation.session_end="2026-10-08";
    expect(paperSectorBrief(feeds({measured_read:f})).state).toBe("invalid");
  });
  it("does not infer freshness from fetch time", () => {
    const f=feeds();f.sector!.receipt.stale=true;
    expect(paperSectorBrief(f)).toMatchObject({stale:true,asOf:"2026-10-09"});
  });
});

describe("Paper cumulative-return chart admission", () => {
  it("accepts explicit common-start total-return history and retains independent missing legs", () => {
    expect(qualifyPaperReturnSeries(history())?.points[1]).toEqual({session:"2026-10-08",groupReturn:null,benchmarkReturn:0.01});
  });
  it.each(["relative_wealth","rs_ratio","rolling_return"])("rejects %s under cumulative-return labels", definition => {
    expect(qualifyPaperReturnSeries({...history(),definition})).toBeNull();
  });
  it("rejects a percent unit, boolean return, false zero and missing identity", () => {
    expect(qualifyPaperReturnSeries({...history(),unit:"percent"})).toBeNull();
    const boolean=history();boolean.points[1].groupReturn=true as unknown as number;
    expect(qualifyPaperReturnSeries(boolean)).toBeNull();
    const start=history();start.points[0].benchmarkReturn=0.01;
    expect(qualifyPaperReturnSeries(start)).toBeNull();
    expect(qualifyPaperReturnSeries({...history(),sourceId:""})).toBeNull();
    expect(qualifyPaperReturnSeries({...history(),membershipRevision:undefined})).toBeNull();
  });
  it("rejects duplicate, reversed, impossible and mismatched dates", () => {
    for(const date of ["2026-10-07","2026-10-06","2026-02-30"]){
      const f=history();f.points[1].session=date;expect(qualifyPaperReturnSeries(f)).toBeNull();
    }
    expect(qualifyPaperReturnSeries({...history(),endSession:"2026-10-10"})).toBeNull();
  });
});

describe("Paper navigation composes with the existing URL owner", () => {
  it("starts fresh sector visits at Brief and preserves a legacy native detail bookmark", () => {
    expect(resolvePaperSectorState(new URLSearchParams("tab=sectors"),DEFAULT_SECTOR_STATE)).toEqual({route:"brief",lens:"rotation"});
    expect(resolvePaperSectorState(new URLSearchParams("tab=sectors&sector=xlk"),{...DEFAULT_SECTOR_STATE,workspace:"detail"})).toEqual({route:"explore",lens:"rotation"});
  });
  it("keeps native selection, unrelated parameters and hash when changing the Paper destination", () => {
    const url=new URL("https://example.test/discover?tab=sectors&sector=xlk&sectorMatrixIndustry=Software&accountView=mine#evidence");
    const href=writePaperSectorState(url,{route:"explore",lens:"breadth"});
    const result=new URL(href,url.origin);
    expect(result.searchParams.get("sector")).toBe("xlk");
    expect(result.searchParams.get("sectorMatrixIndustry")).toBe("Software");
    expect(result.searchParams.get("accountView")).toBe("mine");
    expect(result.hash).toBe("#evidence");
    expect(resolvePaperSectorState(result.searchParams,DEFAULT_SECTOR_STATE)).toEqual({route:"explore",lens:"breadth"});
  });
});

const nativeHistory=():FeedMap=>({history:{data:{meta:{asOf:"2026-10-09",rs_history:{schema:"sector_cycles.rs_history.v1",mode:"reconstructed_price_history",naturally_observed:false,basis:"tr",benchmark:"SPY",horizons_sessions:[21,63],max_points_per_sector:252}},
  sectors:[{id:"xle",ticker:"XLE",kind:"sector",rs_history:[{date:"2026-10-08",rs_21d:2.1,rs_63d:3.8},{date:"2026-10-09",rs_21d:2.4,rs_63d:4.1}]}]},
  receipt:{source:"history",status:"ready",path:"/marketdata/sector_cycles.json",asOf:"2026-10-09",observedAt:null,contentHash:"history-generation",stale:false}}});
describe("Native leadership chart source binding",()=>{
  it("joins native id/ticker fields, retains percent units and names the reconstructed measurement",()=>{
    const value=paperLeadershipHistory(nativeHistory(),"XLE","2026-10-09","SPY");
    expect(value).toMatchObject({definition:"sector_relative_wealth_history",unit:"percent",reconstructed:true,sourceVersion:"history-generation"});
    expect(value!.points[1]).toEqual({session:"2026-10-09",short:2.4,long:4.1});
  });
  it("refuses mismatched identity, benchmark, future source date and unversioned history",()=>{
    expect(paperLeadershipHistory(nativeHistory(),"XLK","2026-10-09","SPY")).toBeNull();
    expect(paperLeadershipHistory(nativeHistory(),"XLE","2026-10-09","QQQ")).toBeNull();
    expect(paperLeadershipHistory(nativeHistory(),"XLE","2026-10-08","SPY")).toBeNull();
    const noVersion=nativeHistory();noVersion.history!.receipt.contentHash=null;
    expect(paperLeadershipHistory(noVersion,"XLE","2026-10-09","SPY")).toBeNull();
    const mismatchedClock=nativeHistory();mismatchedClock.history!.receipt.asOf="2026-10-08";
    expect(paperLeadershipHistory(mismatchedClock,"XLE","2026-10-09","SPY")).toBeNull();
  });
});

describe("Paper measurement identity and optional secondary horizon",()=>{
  it.each(["units","metric","kind","cohort","benchmark","basis","horizon","window","definition"])("rejects a changed %s before labeling native percentages",fault=>{
    const f=copy(), row=f.groups.find((g:{current:{status:string}})=>g.current.status==="measured");
    if(fault==="units")row.current.units="fraction";
    if(fault==="metric")row.current.metric="return_difference";
    if(fault==="kind")row.group_kind="theme";
    if(fault==="cohort")f.generation.cohort_id="other_groups";
    if(fault==="benchmark")f.generation.benchmark="QQQ";
    if(fault==="basis")f.generation.price_basis="price_return";
    if(fault==="horizon")f.cohort.horizon="rs_21d";
    if(fault==="window")f.cohort.window_sessions=21;
    if(fault==="definition")f.definition_id="leadership_rotation_context/2";
    expect(paperSectorBrief(feeds({measured_read:f})).state).toBe("invalid");
  });
  it("retains a valid 63-session rank when the optional 21-session reading is missing",()=>{
    const f=copy();f.groups.find((g:{current:{rank:number|null}})=>g.current.rank===1).current.rs_21d=null;
    const read=paperSectorBrief(feeds({measured_read:f}));
    expect(read).toMatchObject({state:"ready",measured:9,expected:11,leader:{groupId:"XLE",rank:1,rs63d:4.1,rs21d:null}});
    expect(read.unmeasured).toHaveLength(2);
  });
});

describe("Paper destinations keep their native instrument and history-entry origin", () => {
  it.each([["breadth","breadth"],["rotation","rotation"],["market-map","discover"],["confluence","discover"],["themes","discover"]] as const)("normalizes the %s instrument on direct entry", (lens,workspace) => {
    expect(normalizePaperSectorNative({...DEFAULT_SECTOR_STATE,workspace:"discover"},{route:"explore",lens}).workspace).toBe(workspace);
  });
  it("preserves the dossier and the native context of other Paper destinations", () => {
    const native={...DEFAULT_SECTOR_STATE,workspace:"detail" as const,sector:"xle"};
    expect(normalizePaperSectorNative(native,{route:"explore",lens:"breadth"})).toBe(native);
    expect(normalizePaperSectorNative(native,{route:"research",lens:"breadth"})).toBe(native);
  });
  it("restores a Research origin while preserving its native sector context", () => {
    expect(paperSectorReturnContext({version:1,href:"/discover?tab=sectors&sector=xle&sectorWorkspace=detail&sectorPaperRoute=research&sectorPaperLens=rotation"},"https://app.mastermind-x.com"))
      .toMatchObject({native:{sector:"xle",workspace:"detail"},paper:{route:"research",lens:"rotation"}});
  });
  it("rejects foreign, malformed and recursive dossier origins", () => {
    const origin="https://app.mastermind-x.com";
    for(const href of ["https://elsewhere.example/discover?tab=sectors","/terminal?tab=sectors","/discover?tab=heatmap","/discover?tab=sectors&sectorWorkspace=detail&sectorPaperRoute=explore"]){
      expect(paperSectorReturnContext({version:1,href},origin)).toBeNull();
    }
    expect(paperSectorReturnContext({version:2,href:"/discover?tab=sectors"},origin)).toBeNull();
    expect(paperSectorReturnContext(null,origin)).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import * as snapshot from "../../../ingest/native_suite_snapshot";
import { SUITE_ORDER, suiteDefaults, getSuiteMeta } from "../suites/meta";

const target = resolve(process.cwd(), "../ingest/native_suite_observation.ts");
const host = { tier: "pro", code_sha256: "a".repeat(64) };
const sha = (x: unknown) => createHash("sha256").update(snapshot.stableNativeJson(x)).digest("hex");
async function api() {
  expect(existsSync(target), "compact native observation is not implemented").toBe(true);
  return vi.importActual<any>(target);
}
function request(suite = "rsix") {
  return { schema: "chart.native_snapshot_request.v1", suite, symbol: "SYNTHETIC", timeframe: "D",
    data_revision: "explicit-synthetic-observation-v1", bar_state: "declared_closed", params: suiteDefaults(suite),
    bars: Array.from({ length: 420 }, (_, i) => {
      const c = 100 + i * 0.018 + Math.sin(i / 6) * 7 + Math.sin(i / 31) * 3, o = c - Math.sin(i / 3);
      return { time: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0,10), o, h: Math.max(o,c)+1.2, l: Math.min(o,c)-1.2, c, v: 100000+i*31 };
    }) };
}
function at(source: any, pointer: string): any {
  return pointer.split("/").slice(1).reduce((value, key) => value[key.replace(/~1/g,"/").replace(/~0/g,"~")], source);
}
async function controlled(modify: (full: any) => void) {
  const fn = (await api()).nativeSuiteObservation;
  const full = structuredClone(await snapshot.nativeSuiteSnapshot(request(), host)) as any;
  expect(full.status).toBe("observed"); modify(full);
  full.fingerprints.result_sha256 = sha(full.bundle);
  vi.spyOn(snapshot, "nativeSuiteSnapshot").mockResolvedValueOnce(full);
  return { full, view: await fn(request(), host) };
}
afterEach(() => vi.restoreAllMocks());

describe("compact observation over actual native computation", () => {
  it.each(SUITE_ORDER)("binds %s identity and copies source facts without reinterpreting them", async suite => {
    const { nativeSuiteObservation } = await api(); const input = request(suite);
    const full = await snapshot.nativeSuiteSnapshot(input, host) as any;
    const view = await nativeSuiteObservation(input, host);
    expect(view.status).toBe("observed"); expect(view.schema).toBe("chart.native_observation.v1");
    expect(view.source.snapshot_sha256).toBe(sha(full));
    expect(view.source.input).toEqual(full.input); expect(view.source.fingerprints).toEqual(full.fingerprints);
    expect(view.source.code_sha256).toBe(host.code_sha256); expect(view.source.settings_ref).toBe("/settings");
    expect(view.basis).toMatchObject(full.basis);
    expect(view.basis).toMatchObject({ facts_are: "source_data_not_instructions", y_values: "native_coordinate_not_assumed_price", empty_result: "not_a_no_setup_judgment" });
    for (const fact of view.series) {
      expect(at(full, fact.source_ref).id).toBe(fact.id);
      for (const sample of fact.samples) {
        const raw = at(full, sample.source_ref);
        expect(sample.index).toBe(raw.i); expect(sample.value).toBe(fact.kind === "columns" ? raw.v : raw.p);
        expect(sample.age_bars).toBe(full.input.bar_count - 1 - raw.i);
      }
    }
    for (const fact of view.events) {
      const raw = at(full,fact.source_ref), timing = at(full,fact.timing_ref).timing;
      expect(fact.type).toBe(raw.type); expect(fact.direction).toBe(raw.dir);
      expect(fact.native_value).toBe(raw.p ?? null); expect(fact.native_strength).toBe(raw.strength ?? null);
      expect(fact.timing).toEqual(timing); expect(fact.age_bars).toBe(full.input.bar_count-1-timing.confirmedI);
    }
    for (const fact of view.geometry) {
      const raw = at(full,fact.source_ref); expect(fact.id).toBe(raw.id);
      if (raw.kind === "line") expect(fact.coordinates).toEqual({ a: raw.a, b: raw.b });
      else expect(fact.coordinates).toEqual({ i1:raw.i1, i2:raw.i2, p1:raw.p1, p2:raw.p2 });
    }
    expect(view.coverage.bundle_counts.prims).toBe(full.bundle.prims.length);
    expect(view.coverage.bundle_counts.events).toBe(full.bundle.events.length);
    expect(view).not.toHaveProperty("bundle"); expect(Buffer.byteLength(snapshot.stableNativeJson(view))).toBeLessThanOrEqual(12288);
  });
  it("keeps free-tier locks and does not call the empty output no setup", async () => {
    const r = request("structure"); for(const m of getSuiteMeta("structure")!.modules) r.params[`${m.key}.on`] = false;
    r.params["sr.on"] = true;
    const v = await (await api()).nativeSuiteObservation(r,{ ...host,tier:"free" });
    expect(v.modules.find((m:any)=>m.id === "structure/sr")).toMatchObject({ configured_on:true, locked:true });
    expect(v.series).toEqual([]); expect(v.basis.empty_result).toBe("not_a_no_setup_judgment");
    expect(v.basis.module_health).toBe("unknown");
  });
  it("preserves disabled modules instead of silently enabling research studies", async () => {
    const r = request(); for(const m of getSuiteMeta("rsix")!.modules) r.params[`${m.key}.on`]=false;
    const v = await (await api()).nativeSuiteObservation(r,host);
    expect(v.modules.every((m:any)=>m.configured_on===false)).toBe(true);
    expect(v.series).toEqual([]); expect(v.events).toEqual([]);
  });
  it("passes through upstream refusals rather than producing neutral observations", async () => {
    const v=await (await api()).nativeSuiteObservation({...request(),timeframe:"15m"},host);
    expect(v).toEqual({schema:"chart.native_observation.v1",status:"refused",error:"unsupported_timeframe"});
  });
  it("does not mutate native memo output or input while projecting", async () => {
    const r=request(); const before=structuredClone(r); const full=await snapshot.nativeSuiteSnapshot(r,host);
    const v=await (await api()).nativeSuiteObservation(r,host); v.source.input.symbol="changed";
    if(v.series[0])v.series[0].samples[0].value=-999;
    expect(r).toEqual(before); expect(await snapshot.nativeSuiteSnapshot(r,host)).toEqual(full);
  });
  it("is deterministic and preserves changed-input identity", async () => {
    const fn=(await api()).nativeSuiteObservation, r=request(); const a=await fn(r,host);
    expect(await fn(r,host)).toEqual(a); r.bars[10].v+=1; const b=await fn(r,host);
    expect(b.source.fingerprints.input_sha256).not.toBe(a.source.fingerprints.input_sha256);
    expect(b.source.snapshot_sha256).not.toBe(a.source.snapshot_sha256);
  });
});

describe("controlled native-output edge cases (not predictive evidence)", () => {
  it("selects newest confirmation rather than latest anchor or array tail", async () => {
    const {view}=await controlled(full=>{
      full.bundle.events=[{type:"delayed",dir:"bull",i:100,confirmedAt:419,strength:12,p:-3},{type:"recent-anchor",dir:"bear",i:418}];
      full.event_timing=[{event_index:0,timing:{anchorI:100,confirmedI:419,anchorT:1000,confirmedT:4190}},{event_index:1,timing:{anchorI:418,confirmedI:418,anchorT:4180,confirmedT:4180}}];
    });
    expect(view.events.map((e:any)=>e.type)).toEqual(["delayed","recent-anchor"]);
    expect(view.events[0]).toMatchObject({age_bars:0,native_value:-3,native_strength:12});
  });
  it("does not turn invalid confirmation metadata into an immediate event",async()=>{
    const {view}=await controlled(full=>{
      full.bundle.events=[{type:"invalid",dir:"bull",i:3}];full.event_timing=[{event_index:0,timing:null}];full.invalid_event_timing_count=1;
    });
    expect(view.events).toEqual([]);expect(view.coverage.events.invalid).toBe(1);
  });
  it("keeps a missing latest series value null rather than backfilling",async()=>{
    const {view}=await controlled(full=>{full.bundle.prims=[{kind:"poly",id:"gap",pts:[{i:418,p:3},{i:419,p:null}]}];});
    expect(view.series[0].samples.map((s:any)=>s.value)).toEqual([null,3]);
    expect(view.series[0].samples[0]).toMatchObject({index:419,age_bars:0});
  });
  it("labels an older final sample by its age instead of presenting it as current",async()=>{
    const {view}=await controlled(full=>{full.bundle.prims=[{kind:"gradline",id:"historic",pts:[{i:201,p:0},{i:200,p:-5}]}];});
    expect(view.series[0].samples[0]).toMatchObject({index:201,value:0,age_bars:218});
  });
  it("does not cast oscillator coordinates into dollar prices or probabilities",async()=>{
    const {view}=await controlled(full=>{full.bundle.prims=[{kind:"columns",id:"osc",items:[{i:419,v:-55}]}];});
    expect(view.series[0].samples[0].value).toBe(-55);
    expect(view.basis.y_values).toBe("native_coordinate_not_assumed_price");
    expect(view.basis.strength).toBe("native_score_not_probability");
  });
  it("keeps right-edge geometry as geometry, not future time or confirmed support",async()=>{
    const {view}=await controlled(full=>{full.bundle.prims=[{kind:"zone",id:"native-band",i1:300,i2:"right",p1:-5,p2:4}];});
    expect(view.geometry[0].coordinates).toEqual({i1:300,i2:"right",p1:-5,p2:4});
    expect(view.basis.geometry_knowability).toBe("not_established_by_geometry");
  });
  it("preserves native table text, columns, and its resampling footnote as data",async()=>{
    const {full,view}=await controlled(full=>{full.bundle.tables=[{id:"mtf",title:"Dashboard",columns:[{key:"tf",label:"Timeframe"}],rows:[{label:"4H",cells:[{text:"53.2"}]}],footnote:"Resampled from chart bars; not independent 4H feed"}];});
    expect(view.tables[0].footnote).toBe(full.bundle.tables[0].footnote);
    expect(view.tables[0].columns).toEqual(full.bundle.tables[0].columns);
    expect(view.tables[0].cells).toEqual(["53.2"]);
    expect(at(full,view.tables[0].source_ref)).toEqual(full.bundle.tables[0].rows[0]);
  });
  it("bounds whole Unicode facts without cutting text, hiding omissions, or starving small groups",async()=>{
    const {view}=await controlled(full=>{
      full.bundle.prims=[{kind:"poly",id:"normal",pts:[{i:419,p:52}]}];
      full.bundle.events=Array.from({length:20},(_,i)=>({type:"event"+i,dir:"bull",i:399+i,label:i===19?"界".repeat(5000):"intact"}));
      full.event_timing=full.bundle.events.map((e:any,event_index:number)=>({event_index,timing:{anchorI:e.i,confirmedI:e.i,anchorT:e.i*100,confirmedT:e.i*100}}));
    });
    expect(Buffer.byteLength(snapshot.stableNativeJson(view))).toBeLessThanOrEqual(12288);
    expect(view.events.length).toBeGreaterThan(0); expect(view.events.length).toBeLessThanOrEqual(8);
    expect(view.events.every((e:any)=>e.label==="intact")).toBe(true); expect(view.series).toHaveLength(1);
    expect(view.coverage.events.omitted).toBe(20-view.events.length);
    expect(view.coverage.selective).toBe(true);
  });
  it("never uses presentational selection as an opportunity score",async()=>{
    const {view}=await controlled(full=>{full.bundle.prims=[];full.bundle.events=[];full.event_timing=[];});
    expect(view.basis.signal_authority).toBe(false);expect(view.basis.predictive_validation).toBe(false);
    expect(view.basis.selection).toBe("deterministic_presentation_not_opportunity_ranking");
    expect(view).not.toHaveProperty("score");expect(view).not.toHaveProperty("entry");
  });
});


describe("compact observation final integrity cases",()=>{
  it.each([
    [{i:419,p:2},{i:419,p:3}],
    [{i:419,p:2},{i:420,p:3}],
  ])("does not hide duplicate or future samples behind an older finite reading %j",async(...pts:any[])=>{
    const {view}=await controlled(full=>{full.bundle.prims=[{kind:"poly",id:"ambiguous",pts}];});
    expect(view.series).toEqual([]);expect(view.coverage.series).toMatchObject({available:1,eligible:0,invalid:1,returned:0,omitted:0});
  });
  it("omits invalid geometry with disclosed coverage, not a fabricated zero",async()=>{
    const {view}=await controlled(full=>{full.bundle.prims=[{kind:"zone",id:"gap",i1:300,i2:"right",p1:null,p2:4}];});
    expect(view.geometry).toEqual([]);expect(view.coverage.geometry.invalid).toBe(1);
  });
  it("omits a table row whole when its required footnote cannot fit",async()=>{
    const {view}=await controlled(full=>{full.bundle.tables=[{id:"t",columns:[],rows:[{label:"4H",cells:[{text:"not independent"}]}],footnote:"界".repeat(5000)}];});
    expect(view.tables).toEqual([]);expect(view.coverage.tables).toMatchObject({available:1,eligible:1,returned:0,omitted:1});
  });
  it("refuses rather than stripping oversized essential provenance",async()=>{
    const {view}=await controlled(full=>{full.basis.extra="界".repeat(5000);});
    expect(view).toMatchObject({status:"refused",error:"essential_observation_too_large"});
  });
  it("does not bypass the full-snapshot output cap to force a compact success",async()=>{
    const fn=(await api()).nativeSuiteObservation;
    vi.spyOn(snapshot,"nativeSuiteSnapshot").mockResolvedValueOnce({schema:"chart.native_snapshot.v1",status:"refused",error:"output_too_large"});
    expect(await fn(request(),host)).toMatchObject({status:"refused",error:"output_too_large"});
  });
  it("accounts for every available candidate and preserves every table source footnote",async()=>{
    const {view}=await controlled(full=>{
      full.bundle.tables=[{id:"display",columns:[{key:"v",num:true}],rows:Array.from({length:9},(_,i)=>({label:String(i),cells:[{text:"--"}]})),footnote:"Native basis"}];
    });
    for(const group of ["series","events","geometry","tables"]){
      const c=view.coverage[group];expect(c.available).toBe(c.invalid+c.returned+c.omitted);expect(c.returned).toBe(view[group].length);
    }
    expect(view.tables).toHaveLength(4);expect(view.tables.every((r:any)=>r.footnote==="Native basis")).toBe(true);
  });
});

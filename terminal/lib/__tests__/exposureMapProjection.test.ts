import { describe, it, expect } from "vitest";
import datedProducerV2 from "./fixtures/exposure-projection-dated-v2.json";
import producerV2 from "./fixtures/exposure-projection-v2.json";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, projectionNodes, projectedExposureScenario, selectedProjectionCells } from "../exposureMapProjection";
import { readExposureMap } from "../exposureMap";
import { exposureNodes } from "../marketStructure";

// Synthetic fixture exported directly from Macro's build_exposure_projection
// using tests/test_options_exposure_projection.py::book, put OI changed to 50.
const now = Date.parse("2026-10-19T20:00:00Z");
const parse = (p: unknown) => qualifiedExposureProjection(p, "SPY", "2026-10-15", now);
const shock = { spotPercent: 1, ivPoints: 1, calendarDays: 1 };
const datedReceipt = () => ({ ...structuredClone(producer), kind:"dated_provider_approximation",
  valuation:{basis:"provider_eod_approximation",source_session:"2026-10-15",observation_clock:"session_only",
    methodology_ref:"https://www.thetadata.net/docs/Articles/Data-And-Requests/Option-Greeks.html",
    endpoint:"/v3/option/history/greeks/eod",requested_version:"1",serving_build:null,tenor_policy:"provider_eod_whole_days_0dte_0.15"},
  capabilities:{dated_cells:true,instantaneous:false,next_live:false,joint_scenario:false,repricing:false,historical_pit:false},
  clocks:{...producer.clocks,option_observed_at:null,underlying_observed_at:null},
  cells:producer.cells.map(c => ({...structuredClone(c),
    vanna:{...c.vanna,net:null,gross:null,qualified:0,missing:2,status:"unavailable"},
    charm:{...c.charm,net:null,gross:null,qualified:0,missing:2,status:"unavailable"},
    joint:{...c.joint,complete:false,qualified:0,missing:2}})),
});
const scopedReceipt = () => ({ ...datedReceipt(), security_id: "SEC:US-ARCX-SPY", contract_identity: {
  schema: "options.dated_contract_identity/v1", scope: "selected_contracts", root: "SPY", source_session: "2026-10-15",
  security_id: "SEC:US-ARCX-SPY", listing_key: "US-ARCX-SPY", input_sha256: producer.input_sha256,
  effective_from: "2026-10-15", effective_to: "2026-10-16", known_at: producer.clocks.available_at,
  contract_keys: [["2026-10-23", "100", "C"], ["2026-10-23", "100", "P"]],
  root_alias_created: false, historical_first_availability_established: false,
  source_evidence_representation: "captured_parsed_reference_observation",
  reference_observation_sha256: "a".repeat(64), source_response_sha256: "b".repeat(64),
  security_master_sha256: "c".repeat(64), listing_sha256: "d".repeat(64),
  listing_receipt_sha256: "e".repeat(64), binding_sha256: "f".repeat(64),
} });
describe("qualified producer → consumer contract", () => {
  it("keeps exact contract gross and scales dollars to millions once", () => {
    const p = parse(producer)!; expect(p).not.toBeNull();
    const result = projectionNodes(p, { kind: "all" }, "gamma", shock);
    expect(result.rows).toEqual([{ strike: 100, netMn: .005, grossMn: .015 }]);
    const summary = exposureNodes(result.rows, 100, 1);
    expect(summary.grossTotalMn).toBe(.015); expect(summary.nodes[0].grossShare).toBe(1);
    // -(5000 gamma - 1000 vanna + 500 charm) USD delta.
    expect(projectedExposureScenario(p, p.cells[0], shock)).toBeCloseTo(-.0045, 12);
  });
  it("selects exact joint expirations without distributing marginals", () => {
    const p = parse(producer)!;
    expect(projectionNodes(p, { kind: "zero" }, "gamma", shock).rows).toEqual([]);
    expect(projectionNodes(p, { kind: "one", exp: "2026-10-23" }, "charm", shock).rows[0].netMn).toBeCloseTo(.0005);
  });
  it("separates source 0DTE from the actual economic expiry boundary", () => {
    const p = parse(producer)!;
    expect(selectedProjectionCells(p, { kind: "next-live" }, now)).toHaveLength(1);
    expect(selectedProjectionCells(p, { kind: "week" }, now)).toHaveLength(1);
    expect(selectedProjectionCells(p, { kind: "next-live" }, Date.parse("2026-10-23T20:00:00Z"))).toEqual([]);
    expect(selectedProjectionCells(p, { kind: "week" }, Date.parse("2026-10-24T12:00:00Z"))).toEqual([]);
    p.cells[0].economic_expiry_at = null;
    expect(selectedProjectionCells(p, { kind: "next-live" }, now)).toEqual([]);
    expect(selectedProjectionCells(p, { kind: "all" }, now)).toHaveLength(1);
  });
  it("requires matching members and models only for active nonzero shock terms", () => {
    const p = parse(producer)!; const q = structuredClone(p);
    q.cells[0].vanna.qualified_population_id = "f".repeat(64);
    expect(projectedExposureScenario(q, q.cells[0], shock)).toBeNull();
    expect(projectedExposureScenario(q, q.cells[0], { ...shock, ivPoints: 0 })).toBeCloseTo(-.0055);
    q.greek_provenance!.charm!.model_ref = "different";
    expect(projectedExposureScenario(q, q.cells[0], { ...shock, ivPoints: 0 })).toBeNull();
    q.cells[0].charm.net = null;
    expect(projectedExposureScenario(q, q.cells[0], { ...shock, ivPoints: 0 })).toBeNull();
    expect(projectedExposureScenario(q, q.cells[0], { spotPercent: 1, ivPoints: 0, calendarDays: 0 })).toBeCloseTo(-.005);
  });
  it("preserves observed zero OI without certifying a nonzero cancellation", () => {
    const raw = { ...structuredClone(producer), greek_provenance: null };
    for (const m of ["gamma", "vanna", "charm"] as const) { raw.cells[0][m].net = 0; raw.cells[0][m].gross = 0; }
    const p = parse(raw)!; expect(p).not.toBeNull();
    expect(projectedExposureScenario(p, p.cells[0], shock)).toBe(0);
    raw.cells[0].gamma.net = 1e-14; expect(parse(raw)).toBeNull();
    raw.cells[0].gamma.net = 0;
    raw.cells[0].gamma.gross = 1; expect(parse(raw)).toBeNull();
  });
  it("refuses malformed identity, future clocks, duplicate cells and impossible coverage", () => {
    for (const change of [
      (p: typeof producer) => { p.root = "QQQ"; },
      (p: typeof producer) => { p.input_sha256 = "unbound"; },
      (p: typeof producer) => { p.clocks.available_at = "2026-10-20T00:00:00Z"; },
      (p: typeof producer) => { p.cells.push(p.cells[0]); },
      (p: typeof producer) => { p.cells[0].gamma.missing = 1; },
      (p: typeof producer) => { p.cells[0].gamma.gross = 1; },
    ]) { const p = structuredClone(producer); change(p); expect(parse(p)).toBeNull(); }
  });
  it("retains explicitly labeled legacy references when the optional projection exceeds its budget", () => {
    const payload = { root: "SPY", asof: "2026-10-15", spot_ref: 100, by_strike: [{ strike: 100, gamma_net: 99 }], exposure_projection: { ...producer, cells: [], cells_status: "payload_limit" } };
    const read = readExposureMap(payload, "SPY", null, { kind: "all" }, "gamma", "2026-10-19", now);
    expect(read.state).toBe("data"); expect(read.qualification).toBe("legacy"); expect(read.summary.netTotalMn).toBe(99);
    expect(readExposureMap(payload,"SPY",null,{kind:"all"},"combined","2026-10-19",now).state).toBe("unavailable");
  });
  it("bounds the local scenario and preserves an explicit all-zero shock", () => {
    const p = parse(producer)!;
    for (const s of [{ ...shock, spotPercent: 4 }, { ...shock, ivPoints: 6 }, { ...shock, calendarDays: -1 }, { ...shock, spotPercent: NaN }]) expect(projectedExposureScenario(p, p.cells[0], s)).toBeNull();
    expect(projectedExposureScenario(p, p.cells[0], { spotPercent: 0, ivPoints: 0, calendarDays: 0 })).toBe(0);
  });
  it("decodes the actual compact producer witness without losing cancellation or gross", () => {
    const p = parse(producerV2)!;
    expect(p).not.toBeNull(); expect(p.cells).toHaveLength(1);
    const rows = projectionNodes(p,{kind:"all"},"gamma",shock,now).rows;
    expect(rows[0].netMn).toBe(0); expect(rows[0].grossMn).toBe(.02);
    const altered = structuredClone(producerV2); altered.cells[0][0] = -1;
    expect(parse(altered)).toBeNull();
    const wrongUnit = structuredClone(producerV2); wrongUnit.metric_units.vanna = "percent";
    expect(parse(wrongUnit)).toBeNull();
  });
  it("retains joint completeness without withholding an independently qualified single Greek", () => {
    for (const raw of [structuredClone(producer), structuredClone(producerV2)]) {
      if (raw.schema.endsWith("/v2")) ((raw as typeof producerV2).cells[0][4] as unknown[])[6] = false;
      else (raw as typeof producer).cells[0].joint.complete = false;
      const p = parse(raw)!;
      expect(p).not.toBeNull(); expect(p.cells[0].joint.complete).toBe(false);
      expect(projectedExposureScenario(p, p.cells[0], shock)).toBeNull();
      expect(projectedExposureScenario(p, p.cells[0], { spotPercent: 1, ivPoints: 0, calendarDays: 0 })).not.toBeNull();
    }
    const bad = structuredClone(producer);
    bad.cells[0].joint.missing = 1;
    expect(parse(bad)).toBeNull();
  });
  it("bounds both wire versions before expansion or node aggregation", () => {
    for (const source of [producer, producerV2]) {
      const raw = { ...source, cells: Array(50_001).fill(source.cells[0]), cell_count: 50_001 };
      expect(parse(raw)).toBeNull();
    }
  });
  it("captions qualified values with their observation clock and never claims market completeness", () => {
    const raw = { root: "SPY", asof: "2026-10-15T20:15:00Z", spot_ref: 100, by_strike: [], exposure_projection: producer };
    const r = readExposureMap(raw, "SPY", null, { kind: "all" }, "gamma", "2026-10-19", now);
    expect(r.state).toBe("data");
    expect(r.sourceAsOf).toBe(producer.clocks.option_observed_at);
    expect(r.sourceAsOf).not.toBe(raw.asof);
    expect(r.summary.fullCount).toBeNull(); expect(r.summary.population).toBe("unknown");
  });
  it("decodes the actual dated producer v2 witness", () => {
    const p = qualifiedExposureProjection(datedProducerV2,"SPY",datedProducerV2.clocks.source_session,Date.parse("2026-10-21T00:00:00Z"));
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("dated_provider_approximation");
    expect(projectionNodes(p!,{kind:"all"},"gamma",shock).rows[0]).toMatchObject({netMn:0,grossMn:.02});
    expect(projectedExposureScenario(p!,p!.cells[0],shock)).toBeNull();
  });
  it("supports dated Gamma without fabricating instantaneous clocks or scenario authority", () => {
    const p = parse(datedReceipt())!; expect(p).not.toBeNull();
    expect(projectionNodes(p,{kind:"all"},"gamma",shock).rows[0].netMn).toBe(.005);
    expect(selectedProjectionCells(p,{kind:"next-live"},now)).toEqual([]);
    expect(selectedProjectionCells(p,{kind:"week"},now)).toEqual([]);
    expect(projectedExposureScenario(p,p.cells[0],shock)).toBeNull();
    expect(projectedExposureScenario(p,p.cells[0],{spotPercent:0,ivPoints:0,calendarDays:0})).toBeNull();
    const raw = {root:"SPY",asof:"2026-10-15T20:15:00Z",spot_ref:100,by_strike:[],exposure_projection:datedReceipt()};
    const read = (metric:"gamma"|"combined"|"vanna") => readExposureMap(raw,"SPY",null,{kind:"all"},metric,"2026-10-19",now);
    expect(read("gamma")).toMatchObject({state:"data",qualification:"dated",sourceAsOf:"2026-10-15"});
    expect(read("combined").state).toBe("unavailable"); expect(read("vanna").state).toBe("unavailable");
  });
  it("refuses capability, tenor and missing-clock promotion of a dated approximation", () => {
    const active = datedReceipt(); active.capabilities.joint_scenario = true; expect(parse(active)).toBeNull();
    const version = datedReceipt(); version.valuation.requested_version = "latest"; expect(parse(version)).toBeNull();
    const promoted = datedReceipt(); promoted.kind = "modeled_exposure"; expect(parse(promoted)).toBeNull();
    const vanna = datedReceipt(); Object.assign(vanna.cells[0].vanna,{net:0,gross:0}); expect(parse(vanna)).toBeNull();
    const clock = datedReceipt(); clock.clocks.available_at = "2099-01-01T00:00:00Z"; expect(parse(clock)).toBeNull();
  });
  it("preserves the exact selected-series identity and its known-by time", () => {
    expect(parse(scopedReceipt())).not.toBeNull();
    const changes: Array<(p: ReturnType<typeof scopedReceipt>) => void> = [
      p => { p.contract_identity.known_at = "2026-10-19T21:00:00Z"; },
      p => { p.contract_identity.known_at = "2026-10-15T00:00:00"; },
      p => { p.contract_identity.effective_to = "2026-11-15"; },
      p => { p.contract_identity.input_sha256 = "0".repeat(64); },
      p => { p.contract_identity.root_alias_created = true; },
      p => { p.contract_identity.historical_first_availability_established = true; },
      p => { p.contract_identity.source_response_sha256 = "missing"; },
      p => { p.contract_identity.contract_keys[1] = p.contract_identity.contract_keys[0]; },
      p => { p.contract_identity.contract_keys[0][2] = "X"; },
      p => { p.contract_identity.contract_keys[0][1] = "100.00"; },
      p => { p.contract_identity.contract_keys[0][0] = "2026-10-30"; },
      p => { p.cells[0].strike = 101; },
      p => { p.contract_identity.contract_keys.pop(); },
      p => { p.cells[0].gamma.qualified = 3; },
      p => { p.kind = "modeled_exposure"; },
    ];
    for (const change of changes) {
      const p = scopedReceipt(); change(p); expect(parse(p)).toBeNull();
    }
  });
  it("uses the dated capture price independently of the legacy chain and retains an unknown", () => {
    const p = { ...datedReceipt(), underlying_reference: { value: 105 as number | null, currency: "USD",
      basis: "uniform_selected_contract_underlying_price", source_session: "2026-10-15", instantaneous: false } };
    const read = () => readExposureMap({ root: "SPY", asof: "2026-10-15", spot_ref: 999, by_strike: [], exposure_projection: p },
      "SPY", null, {kind:"all"}, "gamma", "2026-10-19", now);
    expect(read()).toMatchObject({ state: "data", spot: 105, qualification: "dated" });
    p.underlying_reference.value = null;
    p.underlying_reference.basis = "nonuniform_or_missing_selected_underlying_prices";
    expect(read().spot).toBeNull(); expect(read().state).toBe("data");
    p.underlying_reference.value = 105; expect(parse(p)).toBeNull();
    p.underlying_reference.basis = "uniform_selected_contract_underlying_price";
    for (const value of [0, -1, NaN, Infinity]) {
      p.underlying_reference.value = value; expect(parse(p)).toBeNull();
    }
    p.underlying_reference.value = 105;
    p.underlying_reference.source_session = "2026-10-16"; expect(parse(p)).toBeNull();
    p.underlying_reference.source_session = "2026-10-15";
    p.underlying_reference.instantaneous = true; expect(parse(p)).toBeNull();
  });

});

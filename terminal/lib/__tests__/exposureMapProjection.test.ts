import { describe, it, expect } from "vitest";
import datedProducerV2 from "./fixtures/exposure-projection-dated-v2.json";
import observedProducerV2 from "./fixtures/exposure-projection-observed-v2.json";
import producerV2 from "./fixtures/exposure-projection-v2.json";
import dexProducerV2 from "./fixtures/exposure-projection-dex-v2.json";
import producer from "./fixtures/exposure-projection.json";
import { qualifiedExposureProjection, projectionNodes, projectedExposureScenario, selectedProjectionCells,
  qualifiedDeltaExtension, deltaProjectionNodes, DELTA_UNIT, DELTA_RAW_UNIT, type DeltaRead, type DeltaRefusal } from "../exposureMapProjection";
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
    vanna:{...c.vanna,net:null,gross:null,known_net:null,known_gross:null,qualified:0,missing:2,status:"unavailable"},
    charm:{...c.charm,net:null,gross:null,known_net:null,known_gross:null,qualified:0,missing:2,status:"unavailable"},
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
const observedReceipt = () => {
  const selected = scopedReceipt();
  const { source_response_sha256, ...identity } = selected.contract_identity;
  return { ...selected, contract_identity: { ...identity,
    schema: "options.dated_contract_identity/v2", scope: "observed_contracts",
    source_evidence_representation: "captured_reference_population_observation",
    observed_contract_keys: structuredClone(identity.contract_keys),
    reference_pages: [{ params: { underlying_ticker: "SPY", as_of: "2026-10-15", "expiration_date.gte": "2026-10-15",
      expired: "false", order: "asc", sort: "ticker", limit: 1000 } as Record<string, unknown>,
      response_sha256: source_response_sha256, completed_at: identity.known_at, response_bytes: 1200, contracts: 2 }],
    source_evidence_basis: "native_acquisition",
    source_input_artifacts: [] as Array<{ kind: string; sha256: string; read_at: string }>,
  } };
};
// QQQ synthetic dated observed receipt on the actual native first effective
// date: the same two-contract book with every clock, session and reference
// scope moved onto QQQ consistently. Synthetic protocol evidence, never a
// claim about a real provider snapshot.
const qqqSession = "2026-10-20";
const qqqNow = Date.parse("2026-10-20T20:00:00Z");
const qqqParse = (p: unknown, session = qqqSession) => qualifiedExposureProjection(p, "QQQ", session, qqqNow);
const nextDay = (session: string) => new Date(Date.parse(session) + 86_400_000).toISOString().slice(0, 10);
const qqqReceipt = (session = qqqSession) => {
  const base = observedReceipt();
  const identity = base.contract_identity;
  const knownAt = `${session}T20:00:00Z`;
  return { ...base, root: "QQQ", security_id: "SEC:US-XNAS-QQQ",
    clocks: { ...base.clocks, source_session: session, oi_report_date: session,
      oi_available_at: `${session}T12:00:00Z`, greeks_available_at: `${session}T19:01:00Z`, available_at: knownAt },
    valuation: { ...base.valuation, source_session: session },
    contract_identity: { ...identity, root: "QQQ", source_session: session,
      security_id: "SEC:US-XNAS-QQQ", listing_key: "US-XNAS-QQQ",
      effective_from: session, effective_to: nextDay(session), known_at: knownAt,
      reference_pages: [{ params: { underlying_ticker: "QQQ", as_of: session,
        "expiration_date.gte": session, expired: "false", order: "asc", sort: "ticker", limit: 1000 } as Record<string, unknown>,
        response_sha256: identity.reference_pages[0].response_sha256,
        completed_at: knownAt, response_bytes: 1200, contracts: 2 }] },
  };
};
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
    for (const m of ["gamma", "vanna", "charm"] as const) Object.assign(raw.cells[0][m], {net:0,gross:0,known_net:0,known_gross:0});
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

  it("admits a declared observed population across expiries without changing the selected-series contract", () => {
    const p = observedReceipt();
    p.cells = Array.from({ length: 12 }, (_, i) => ({ ...structuredClone(p.cells[0]),
      expiry: i % 2 ? "2026-10-30" : "2026-10-23", strike: 100 + i }));
    p.cell_count = p.cells.length;
    p.contract_identity.observed_contract_keys = p.cells.flatMap(c =>
      ["C", "P"].map(right => [c.expiry, String(c.strike), right]));
    p.contract_identity.contract_keys = structuredClone(p.contract_identity.observed_contract_keys);
    p.contract_identity.reference_pages[0].contracts = 24;
    const receipt = parse(p);
    expect(receipt).not.toBeNull();
    expect(selectedProjectionCells(receipt!, { kind: "one", exp: "2026-10-30" })).toHaveLength(6);
    expect(projectionNodes(receipt!, { kind: "all" }, "gamma", shock).coverage).toMatchObject({ qualified: 24, missing: 0 });
    expect(selectedProjectionCells(receipt!, { kind: "next-live" }, now)).toEqual([]);
    expect(projectedExposureScenario(receipt!, receipt!.cells[0], shock)).toBeNull();
    p.contract_identity.schema = "options.dated_contract_identity/v1";
    expect(parse(p)).toBeNull();
  });

  it("decodes the actual Python producer's synthetic observed-book witness without dropping its missing member", () => {
    // Exported by the native producer: 120 synthetic contracts across three
    // expiries; one exact reference deliberately omitted. This is protocol
    // integration evidence, not a provider capture or production qualification.
    const p = qualifiedExposureProjection(observedProducerV2, "SPY", "2026-10-19", Date.parse("2026-10-21T00:00:00Z"));
    expect(p).not.toBeNull();
    expect(p!.cells).toHaveLength(60);
    const result = projectionNodes(p!, { kind: "all" }, "gamma", shock);
    expect(result.coverage).toMatchObject({ qualified: 119, missing: 1 });
    expect(result.coveredOnly).toBe(true);
    // The one missing reference is excluded only from the explicitly
    // provisional measured subtotal.
    expect(result.rows).toHaveLength(60);
    const measured = exposureNodes(result.rows, 100, null, "covered");
    expect(measured.netTotalMn).toBeCloseTo(.01, 12);
    expect(measured.grossTotalMn).toBeCloseTo(1.19, 12);
    expect(new Set(p!.cells.map(c => c.expiry)).size).toBe(3);
    expect(projectedExposureScenario(p!, p!.cells[0], shock)).toBeNull();
    expect(qualifiedExposureProjection(observedProducerV2, "SPY", "2026-10-19",
      Date.parse("2026-10-20T08:30:00Z"))).toBeNull();
  });

  it("aggregates measured contributions across expiries at a shared strike", () => {
    const raw = structuredClone(producer), second = structuredClone(raw.cells[0]);
    second.expiry = "2026-10-30";
    Object.assign(second.gamma, { qualified:1,missing:1,net:null,gross:null,
      known_net:10000,known_gross:10000,status:"partial" });
    Object.assign(second.joint, {complete:false,qualified:0,missing:2});
    raw.cells.push(second); raw.cell_count = 2;
    const p = parse(raw)!;
    expect(p).not.toBeNull();
    expect(projectionNodes(p, {kind:"all"}, "gamma", shock)).toMatchObject({
      rows:[{strike:100,netMn:.015,grossMn:.025}],coverage:{qualified:3,missing:1},coveredOnly:true,
    });
    expect(projectionNodes(p, {kind:"one",exp:"2026-10-23"}, "gamma", shock)).toMatchObject({
      rows:[{strike:100,netMn:.005,grossMn:.015}],coverage:{qualified:2,missing:0},coveredOnly:false,
    });
    expect(projectionNodes(p, {kind:"all"}, "combined", shock).rows[0].netMn).toBeNull();
  });

  it("keeps missing reference members in the observed denominator without promoting their exposure", () => {
    const p = observedReceipt();
    p.contract_identity.contract_keys.pop();
    expect(parse(p)).toBeNull(); // Two qualified contracts cannot come from one bound reference.
    Object.assign(p.cells[0].gamma, { qualified: 1, missing: 1, net: null, gross: null, status: "partial" });
    const receipt = parse(p);
    expect(receipt).not.toBeNull();
    expect(projectionNodes(receipt!, { kind: "all" }, "gamma", shock).coverage).toMatchObject({ qualified: 1, missing: 1 });
    p.contract_identity.contract_keys = [];
    expect(parse(p)).toBeNull();
    Object.assign(p.cells[0].gamma, { qualified: 0, missing: 2, status: "unavailable", known_net: null, known_gross: null });
    expect(parse(p)).not.toBeNull();
    p.contract_identity.observed_contract_keys.pop();
    expect(parse(p)).toBeNull();
  });

  it("uses only validated measured Gamma while withholding a full-book or joint claim", () => {
    const p = observedReceipt();
    p.contract_identity.contract_keys.pop();
    Object.assign(p.cells[0].gamma, { qualified: 1, missing: 1, net: null, gross: null,
      known_net: 10000, known_gross: 10000, status: "partial" });
    const read = () => readExposureMap({root:"SPY",asof:"2026-10-15",spot_ref:100,by_strike:[],exposure_projection:p},
      "SPY",null,{kind:"all"},"gamma","2026-10-19",now);
    expect(read()).toMatchObject({ state:"data", coverage:{qualified:1,missing:1},
      summary:{coveredOnly:true,netTotalMn:.01,grossTotalMn:.01} });
    expect(parse(p)!.cells[0].gamma.net).toBeNull();
    expect(projectedExposureScenario(parse(p)!, parse(p)!.cells[0], shock)).toBeNull();
    const changes: Array<(q: ReturnType<typeof observedReceipt>) => void> = [
      q => { q.cells[0].gamma.known_net = Infinity; },
      q => { q.cells[0].gamma.known_gross = -1; },
      q => { q.cells[0].gamma.known_gross = 1; },
      q => { q.cells[0].gamma.known_gross = 0; },
      q => { q.cells[0].gamma.qualified = 0; q.cells[0].gamma.missing = 2; },
      q => { q.greek_provenance.gamma.source_ref = "other-snapshot"; },
      q => { q.cells[0].gamma.status = "unavailable"; },
    ];
    for (const change of changes) { const q = structuredClone(p); change(q); expect(parse(q)).toBeNull(); }
  });

  it("checks actual page scope, clocks, caps and cursor cycles in observed identity evidence", () => {
    const changes: Array<(p: ReturnType<typeof observedReceipt>) => void> = [
      p => { p.contract_identity.reference_pages = []; },
      p => { p.contract_identity.reference_pages[0].params.underlying_ticker = "QQQ"; },
      p => { p.contract_identity.reference_pages[0].params.apiKey = "not-a-secret"; },
      p => { p.contract_identity.reference_pages[0].params.limit = "1000"; },
      p => { p.contract_identity.reference_pages[0].response_sha256 = "invalid"; },
      p => { p.contract_identity.reference_pages[0].completed_at = "2026-10-20T00:00:00Z"; },
      p => { p.contract_identity.reference_pages[0].response_bytes = 0; },
      p => { p.contract_identity.reference_pages[0].response_bytes = 1024 * 1024 + 1; },
      p => { p.contract_identity.reference_pages[0].contracts = 1001; },
      p => { p.contract_identity.reference_pages[0].contracts = 1; },
      p => { p.contract_identity.reference_observation_sha256 = p.contract_identity.reference_pages[0].response_sha256; },
      p => { p.contract_identity.reference_pages[0].completed_at = "2026-02-30T12:00:00Z"; },
      p => { p.contract_identity.contract_keys[0][1] = "100.00"; },
      p => { p.contract_identity.contract_keys.push(p.contract_identity.contract_keys[0]); },
      p => { p.contract_identity.observed_contract_keys[0][0] = "2026-10-14"; },
      p => { p.contract_identity.observed_contract_keys.push(p.contract_identity.observed_contract_keys[0]); },
      p => { p.contract_identity.observed_contract_keys = Array(100_001).fill(p.contract_identity.observed_contract_keys[0]); },
      p => { p.contract_identity.source_evidence_basis = "unknown"; },
      p => { p.contract_identity.source_evidence_basis = "retained_native_store_read"; },
    ];
    for (const change of changes) {
      const p = observedReceipt(); change(p); expect(parse(p)).toBeNull();
    }
    const p = observedReceipt(), page = p.contract_identity.reference_pages[0];
    p.contract_identity.reference_pages.push({ ...page, params: { cursor: "cursor-a" }, contracts: 0 });
    expect(parse(p)).not.toBeNull();
    p.contract_identity.reference_pages[1].params.underlying_ticker = ["SPY"];
    expect(parse(p)).toBeNull();
    delete p.contract_identity.reference_pages[1].params.underlying_ticker;
    p.contract_identity.reference_pages.push({ ...page, params: { cursor: "cursor-a", underlying_ticker: "SPY" }, contracts: 0 });
    expect(parse(p)).toBeNull();
    p.contract_identity.reference_pages[2].params.cursor = "cursor-b";
    expect(parse(p)).not.toBeNull();
    p.contract_identity.reference_pages[2].params.as_of = "2026-10-16";
    expect(parse(p)).toBeNull();
    p.contract_identity.reference_pages = Array.from({ length: 21 }, (_, i) => ({ ...page,
      params: i ? { cursor: `cursor-${i}` } : page.params }));
    expect(parse(p)).toBeNull();
    p.contract_identity.reference_pages = p.contract_identity.reference_pages.slice(0, 9)
      .map(page => ({ ...page, response_bytes: 1024 * 1024 }));
    expect(parse(p)).toBeNull();
  });

  it("requires a canonical source session but permits inspection of a dated historical book", () => {
    for (const session of ["10/15/2026", "2026-10-15T00:00:00Z", "2026-02-30"]) {
      const raw = datedReceipt();
      raw.clocks.source_session = session; raw.clocks.oi_report_date = session;
      expect(qualifiedExposureProjection(raw, "SPY", session, now)).toBeNull();
    }
    // Effective dates describe series identity on the source session, not a
    // view-time TTL. Later acquired historical books must remain inspectable.
    expect(parse(scopedReceipt())).not.toBeNull();
    expect(parse({ ...scopedReceipt(), contract_identity: { ...scopedReceipt().contract_identity,
      reference_pages: [] } })).toBeNull();
  });

  it("preserves current possession of a retained pair without inventing historical availability", () => {
    const p = observedReceipt();
    p.contract_identity.source_evidence_basis = "retained_native_store_read";
    p.contract_identity.source_input_artifacts = ["greeks", "oi"].map(kind =>
      ({ kind, sha256: "a".repeat(64), read_at: p.contract_identity.known_at }));
    expect(parse(p)).not.toBeNull();
    p.contract_identity.source_input_artifacts[1].kind = "greeks";
    expect(parse(p)).toBeNull();
    p.contract_identity.source_input_artifacts[1].kind = "oi";
    p.contract_identity.source_input_artifacts[0].read_at = "2026-10-20T00:00:00Z";
    expect(parse(p)).toBeNull();
    p.contract_identity.source_input_artifacts[0].read_at = p.contract_identity.known_at;
    p.contract_identity.historical_first_availability_established = true;
    expect(parse(p)).toBeNull();
  });

  it("admits the exact QQQ observed identity on its actual native first effective date", () => {
    const p = qqqParse(qqqReceipt())!;
    expect(p).not.toBeNull();
    expect(p.root).toBe("QQQ");
    expect(p.security_id).toBe("SEC:US-XNAS-QQQ");
    expect(p.clocks.source_session).toBe(qqqSession);
    expect(p.clocks.available_at).toBe("2026-10-20T20:00:00Z");
    expect(projectionNodes(p, { kind: "all" }, "gamma", shock).rows[0].netMn).toBe(.005);
    expect(selectedProjectionCells(p, { kind: "next-live" }, qqqNow)).toEqual([]);
    expect(projectedExposureScenario(p, p.cells[0], shock)).toBeNull();
    // The enclosing root and session are part of the identity, not just labels.
    expect(parse(qqqReceipt())).toBeNull();
    expect(qualifiedExposureProjection(qqqReceipt(), "SPY", qqqSession, qqqNow)).toBeNull();
    const changes: Array<(q: ReturnType<typeof qqqReceipt>) => void> = [
      q => { q.contract_identity.root = "SPY"; },
      q => { q.contract_identity.security_id = "SEC:US-ARCX-SPY"; },
      q => { q.contract_identity.listing_key = "US-ARCX-SPY"; },
      q => { q.contract_identity.security_id = "SEC:US-XNAS-QQQ"; q.contract_identity.listing_key = "US-ARCX-SPY"; },
      q => { q.contract_identity.root_alias_created = true; },
      q => { q.contract_identity.known_at = "2026-10-21T00:00:00Z"; },
      q => { q.clocks.available_at = "2099-01-01T00:00:00Z"; },
    ];
    for (const change of changes) { const q = qqqReceipt(); change(q); expect(qqqParse(q)).toBeNull(); }
    // An internally consistent but unlisted root is refused outright: no
    // generic inference or alias widens the admitted identity table.
    const unknown = qqqReceipt();
    unknown.root = "IWM"; unknown.security_id = "SEC:US-ARCX-IWM";
    unknown.contract_identity.root = "IWM";
    unknown.contract_identity.security_id = "SEC:US-ARCX-IWM";
    unknown.contract_identity.listing_key = "US-ARCX-IWM";
    expect(qualifiedExposureProjection(unknown, "IWM", qqqSession, qqqNow)).toBeNull();
  });

  it("binds every observed reference page to the chosen QQQ identity root", () => {
    const p = qqqReceipt();
    const page = p.contract_identity.reference_pages[0];
    p.contract_identity.reference_pages.push({ ...page, params: { cursor: "cursor-a", underlying_ticker: "SPY" }, contracts: 0 });
    expect(qqqParse(p)).toBeNull(); // Later-page scope cannot cross to another root.
    p.contract_identity.reference_pages[1].params.underlying_ticker = "QQQ";
    expect(qqqParse(p)).not.toBeNull();
    p.contract_identity.reference_pages[0].params.underlying_ticker = "SPY";
    expect(qqqParse(p)).toBeNull(); // First-page scope must equal the identity root.
  });

  it("refuses QQQ before its actual native first effective date and under dated identity v1", () => {
    for (const session of ["2026-10-16", "2026-10-19"]) {
      expect(qqqParse(qqqReceipt(session), session)).toBeNull();
    }
    expect(qualifiedExposureProjection(qqqReceipt("2026-10-21"), "QQQ", "2026-10-21",
      Date.parse("2026-10-21T20:00:00Z"))).not.toBeNull();
    // A fully well-formed v1 QQQ binding on the QQQ session is still refused:
    // dated identity v1 stays SPY-only.
    const v1 = qqqReceipt();
    const v1Identity: Record<string, unknown> = { ...v1.contract_identity };
    for (const key of ["observed_contract_keys", "reference_pages", "source_evidence_basis", "source_input_artifacts"]) {
      delete v1Identity[key];
    }
    v1.contract_identity = { ...v1Identity, schema: "options.dated_contract_identity/v1",
      scope: "selected_contracts", source_evidence_representation: "captured_parsed_reference_observation",
      source_response_sha256: v1.contract_identity.reference_pages[0].response_sha256 } as unknown as typeof v1.contract_identity;
    expect(qqqParse(v1)).toBeNull();
    // The identical v1 SPY binding on its own session is unaffected.
    expect(parse(scopedReceipt())).not.toBeNull();
  });

});

describe("qualified per-cell delta extension (freeze F1 §2)", () => {
  type DexRaw = typeof dexProducerV2;
  const dexRaw = () => structuredClone(dexProducerV2);
  const ext = (raw: DexRaw) => raw.delta_extension as unknown as Record<string, unknown>;
  const dexCells = (raw: DexRaw) => ext(raw).cells as unknown[][];
  const goodP = parse(dexRaw())!;
  const dx = (mutate?: (raw: DexRaw) => void, root = "SPY", session = "2026-10-15") => {
    const raw = dexRaw(); mutate?.(raw);
    return qualifiedDeltaExtension(raw, goodP, root, session);
  };
  const qualified = (read: DeltaRead) => {
    if (read.status !== "qualified") throw new Error(`refused: ${read.reason}`);
    return read.delta;
  };

  it("rejects a silent fourth metric tuple and a four-member metric order", () => {
    const tuple4 = (r: unknown) => ((r as { cells: unknown[] }).cells[0] as unknown[])[3] as unknown[];
    const fourth = structuredClone(producerV2);
    tuple4(fourth).push(structuredClone(tuple4(fourth)[0]));
    expect(parse(fourth)).toBeNull();
    const order = structuredClone(producerV2) as unknown as { metric_order: string[] };
    order.metric_order = ["gamma", "vanna", "charm", "delta"];
    expect(parse(order)).toBeNull();
    const pyUnits = structuredClone(producerV2) as unknown as { metric_units: Record<string, unknown> };
    pyUnits.metric_units.delta = "usd_delta_notional";
    expect(parse(pyUnits)).toBeNull();
  });

  it("ignores the delta extension in every incumbent reader result", () => {
    const withExt = { ...structuredClone(producerV2), delta_extension: structuredClone(dexProducerV2.delta_extension) };
    const read = parse(withExt)!;
    expect(read).not.toBeNull();
    const without = structuredClone(read) as typeof read & { delta_extension?: unknown };
    delete without.delta_extension;
    expect(without).toEqual(parse(producerV2));
    expect(projectionNodes(read, { kind: "all" }, "gamma", shock))
      .toEqual(projectionNodes(parse(producerV2)!, { kind: "all" }, "gamma", shock));
  });

  it("qualifies an index-aligned DEX extension and reuses parent tables and receipt", () => {
    const d = qualified(dx());
    expect(d.unit).toBe(DELTA_UNIT);
    expect(d.kind).toBe("modeled_exposure");
    expect(d.inputSha256).toBe(dexProducerV2.input_sha256);
    expect(d.populationId).toBe(dexProducerV2.population.id);
    const cell = d.cells.get("2026-10-23|100")!;
    expect(cell).toMatchObject({ net: 900000, gross: 900000, call: 500000, put: 400000, status: "complete_observed" });
    // Indices resolve through the parent tables, never a second copy.
    expect(cell.qualified_population_id).toBe(dexProducerV2.population_ids[0]);
    expect(d.summary).toMatchObject({ net: 900000, gross: 900000, call: 500000, put: 400000 });
    expect(dx(undefined, "IWM")).toEqual({ status: "refused", reason: "wrong_root" });
  });

  it("keeps the positive short-put DEX contribution from native negative delta", () => {
    const d = qualified(dx());
    const cell = d.cells.get("2026-10-23|100")!;
    // call OI 100 × Δ +0.5 × S 100 → +500,000; put OI 100 × native Δ −0.4
    // × sign −1 → +400,000. Never abs(), never re-signed by the consumer.
    expect(cell.call).toBe(500000); expect(cell.put).toBe(400000); expect(cell.net).toBe(900000);
    expect(deltaProjectionNodes(goodP, d, { kind: "all" }, now).rows)
      .toEqual([{ strike: 100, netMn: 0.9, grossMn: 0.9 }, { strike: 101, netMn: 0, grossMn: 0 }]);
    const flipped = (raw: DexRaw) => { (dexCells(raw)[0][2] as unknown[])[11] = -400000; };
    expect(dx(flipped)).toEqual({ status: "refused", reason: "invalid_metric" });
  });

  it.each([
    ["absent", (raw: DexRaw) => { delete (raw as unknown as { delta_extension?: unknown }).delta_extension; }],
    ["not_v2_wire", (raw: DexRaw) => { (raw as unknown as { schema: string }).schema = "options_hub.exposure_projection/v3"; }],
    ["mixed_encoding", (raw: DexRaw) => { dexCells(raw)[0].push(0); }],
    ["wrong_root", (raw: DexRaw) => { ext(raw).root = "QQQ"; }],
    ["receipt_mismatch", (raw: DexRaw) => { ext(raw).input_sha256 = "1".repeat(64); }],
    ["oversized", (raw: DexRaw) => { ext(raw).cell_count = 5; }],
    ["misaligned", (raw: DexRaw) => { (dexCells(raw)[1] as unknown[])[1] = 102; }],
    ["payload_limit", (raw: DexRaw) => { ext(raw).cells_status = "payload_limit"; }],
    ["source_unqualified", (raw: DexRaw) => { ext(raw).cells_status = "source_unqualified"; }],
  ] as Array<[DeltaRefusal, (raw: DexRaw) => void]>)("refuses %s", (reason, mutate) => {
    const raw = dexRaw(); mutate(raw);
    expect(qualifiedDeltaExtension(raw, goodP, "SPY", "2026-10-15")).toEqual({ status: "refused", reason });
    // The parent gamma reader is untouched by every extension tamper.
    expect(reason === "not_v2_wire" ? goodP : parse(raw)).not.toBeNull();
  });

  it("refuses a v1 payload carrying the extension or a per-cell delta member", () => {
    const extension = structuredClone(dexProducerV2.delta_extension);
    const v1 = { ...structuredClone(producer), delta_extension: extension };
    expect(qualifiedDeltaExtension(v1, parse(producer)!, "SPY", "2026-10-15"))
      .toEqual({ status: "refused", reason: "mixed_encoding" });
    const cellDelta = structuredClone(producer) as unknown as { cells: Array<Record<string, unknown>>, delta_extension?: unknown };
    cellDelta.cells[0].delta = cellDelta.cells[0].gamma;
    cellDelta.delta_extension = structuredClone(extension);
    expect(qualifiedDeltaExtension(cellDelta, parse(producer)!, "SPY", "2026-10-15"))
      .toEqual({ status: "refused", reason: "mixed_encoding" });
  });

  it("withholds only DEX at payload_limit and never promotes the legacy delta reference", () => {
    const raw = dexRaw(); ext(raw).cells_status = "payload_limit";
    expect(qualifiedDeltaExtension(raw, goodP, "SPY", "2026-10-15")).toEqual({ status: "refused", reason: "payload_limit" });
    const source = { root: "SPY", asof: "2026-10-15", spot_ref: 100,
      by_strike: [{ strike: 100, delta_net: 7 }], exposure_projection: raw };
    const read = readExposureMap(structuredClone(source), "SPY", null, { kind: "all" }, "delta", "2026-10-19", now);
    expect(read).toMatchObject({ state: "data", qualification: "legacy" });
    expect(read.summary.netTotalMn).toBe(7);
    const okRead = readExposureMap({ ...structuredClone(source), exposure_projection: dexRaw() },
      "SPY", null, { kind: "all" }, "delta", "2026-10-19", now);
    expect(okRead).toMatchObject({ state: "data", qualification: "qualified",
      coverage: { expected: null, received: 8, qualified: 8, missing: 0 } });
    expect(okRead.summary.netTotalMn).toBe(0.9);
  });

  it("refuses a call or put side that is neither null nor a finite number", () => {
    const side = (value: unknown) => dx((raw) => { (dexCells(raw)[0][2] as unknown[])[10] = value; });
    expect(side("500000")).toEqual({ status: "refused", reason: "invalid_metric" });
    expect(side({})).toEqual({ status: "refused", reason: "invalid_metric" });
    // The untouched fixture still qualifies with both sides reconciled.
    expect(qualified(dx()).cells.get("2026-10-23|100")).toMatchObject({ call: 500000, put: 400000, net: 900000 });
  });

  it("pins the declared raw unit on both the extension and the delta receipt", () => {
    expect(dx((raw) => { delete ext(raw).raw_unit; })).toEqual({ status: "refused", reason: "receipt_mismatch" });
    expect(dx((raw) => { ext(raw).raw_unit = "foo"; })).toEqual({ status: "refused", reason: "receipt_mismatch" });
    expect(dx((raw) => { delete (raw.greek_provenance as unknown as Record<string, Record<string, unknown>>).delta!.unit; }))
      .toEqual({ status: "refused", reason: "provenance_unqualified" });
    expect(dx((raw) => { ((raw.greek_provenance as unknown as Record<string, Record<string, unknown>>).delta as Record<string, unknown>).unit = "foo"; }))
      .toEqual({ status: "refused", reason: "provenance_unqualified" });
  });

  const tampered = (mutate: (raw: DexRaw) => void): DeltaRead => {
    const raw = dexRaw(); mutate(raw);
    return qualifiedDeltaExtension(raw, goodP, "SPY", "2026-10-15");
  };
  const provenance = (raw: DexRaw) =>
    (raw.greek_provenance as unknown as Record<string, Record<string, unknown>>).delta!;
  type Tamper = [string, DeltaRefusal, (raw: DexRaw) => void];
  const TAMPERS: Tamper[] = [
    ["a v3 extension schema", "mixed_encoding", (raw) => { ext(raw).schema = "options_hub.exposure_delta_extension/v2"; }],
    ["a v2 extension encoding", "mixed_encoding", (raw) => { ext(raw).encoding = "dex-tuple-v2"; }],
    ["a widened row_fields", "mixed_encoding", (raw) => { ext(raw).row_fields = ["expiry_index", "strike", "metric", "right"]; }],
    ["a shortened metric_fields", "mixed_encoding", (raw) => { ext(raw).metric_fields = (ext(raw).metric_fields as string[]).slice(1); }],
    ["an extra capabilities key", "mixed_encoding", (raw) => { (ext(raw).capabilities as Record<string, unknown>).repricing = true; }],
    ["a 14-field summary", "mixed_encoding", (raw) => { (ext(raw).summary as unknown[]).push(0); }],
    ["a foreign population_id", "receipt_mismatch", (raw) => { ext(raw).population_id = "e".repeat(64); }],
    ["a mismatched kind", "receipt_mismatch", (raw) => { ext(raw).kind = "dated_provider_approximation"; }],
    ["a flipped position_basis", "receipt_mismatch", (raw) => { ext(raw).position_basis = "assumed_long_put_short_call"; }],
    ["a cents scale", "receipt_mismatch", (raw) => { ext(raw).scale = "cents"; }],
    ["a foreign unit", "receipt_mismatch", (raw) => { ext(raw).unit = "usd_delta_per_1pct_spot"; }],
    ["a 50,001-cell extension", "oversized", (raw) => {
      const cell = structuredClone(dexCells(raw)[0]);
      for (let i = 0; i < 50_001; i++) dexCells(raw).push(structuredClone(cell));
    }],
    ["an expiry_index out of range", "misaligned", (raw) => { (dexCells(raw)[0] as unknown[])[0] = 9; }],
    ["a status_index out of the table", "misaligned", (raw) => { (dexCells(raw)[0][2] as unknown[])[4] = 99; }],
    ["a population_index out of the table", "misaligned", (raw) => { (dexCells(raw)[0][2] as unknown[])[9] = 99; }],
    ["a foreign delta source_ref", "provenance_unqualified", (raw) => { provenance(raw).source_ref = "owner:immutable-snapshot-2"; }],
    ["an empty delta model_ref", "provenance_unqualified", (raw) => { provenance(raw).model_ref = ""; }],
    ["a foreign delta receipt unit", "provenance_unqualified", (raw) => { provenance(raw).unit = "delta_per_1.00_vol"; }],
  ];
  it.each(TAMPERS)("refuses %s with %s", (_label, reason, mutate) => {
    expect(tampered(mutate)).toEqual({ status: "refused", reason });
  });

  it("admits a dated Gamma-class DEX extension on the dated witness", () => {
    const raw = structuredClone(datedProducerV2) as unknown as Record<string, unknown>;
    const datedExt = structuredClone(dexProducerV2.delta_extension) as unknown as Record<string, unknown>;
    const tuple = structuredClone((dexProducerV2.delta_extension.cells as unknown[][])[0][2]);
    datedExt.kind = "dated_provider_approximation";
    datedExt.input_sha256 = raw.input_sha256;
    datedExt.population_id = (raw.population as { id: string }).id;
    datedExt.cell_count = 1;
    datedExt.cells = [[0, 100.0, tuple]];
    raw.delta_extension = datedExt;
    (raw.greek_provenance as unknown as Record<string, unknown>).delta = {
      source_ref: raw.source_snapshot_ref, model_ref: "owner:provider-model-1",
      method: "provider_observed", tenor_policy: "provider_eod_whole_days_0dte_0.15", unit: DELTA_RAW_UNIT };
    const p = parse(raw);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("dated_provider_approximation");
    const read = qualifiedDeltaExtension(raw, p!, "SPY", "2026-10-15");
    if (read.status !== "qualified") throw new Error(`refused: ${read.reason}`);
    expect(read.delta.kind).toBe("dated_provider_approximation");
    expect(read.delta.cells.get("2026-10-23|100")).toMatchObject({ net: 900000, gross: 900000 });
  });

  it("requires delta provenance and never zero-fills a missing delta cell", () => {
    expect(dx((raw) => { delete (raw.greek_provenance as unknown as Record<string, unknown>).delta; }))
      .toEqual({ status: "refused", reason: "provenance_unqualified" });
    expect(dx((raw) => { (dexCells(raw)[1][2] as unknown[])[3] = 1; }))
      .toEqual({ status: "refused", reason: "invalid_metric" });
    const unavailable = qualified(dx((raw) => {
      dexCells(raw)[3][2] = [null, 2, 0, 2, 0, null, null, null, null, 0, null, null, {}];
    }));
    // The unknown cell stays unknown in the qualified map…
    expect(unavailable.cells.get("2026-10-30|101")).toMatchObject({ net: null, gross: null, status: "unavailable" });
    // …and only the explicitly labeled measured subtotal omits it from a row.
    expect(deltaProjectionNodes(goodP, unavailable, { kind: "all" }, now)).toMatchObject({
      rows: [{ strike: 100, netMn: 0.9, grossMn: 0.9 }, { strike: 101, netMn: 0, grossMn: 0 }], coveredOnly: true,
    });
  });
});

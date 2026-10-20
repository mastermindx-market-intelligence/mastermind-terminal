import { describe, expect, it } from "vitest";
import { exposureValue, readExposureMap } from "../exposureMap";
const payload = { root: "SPY", asof: "2026-07-10T20:15:00Z", spot_ref: 105, convention: "+call/-put", by_strike_full_n: 2,
  by_expiry: [{ exp: "2026-07-10" }, { exp: "2026-07-17" }],
  by_strike: [{ strike: 100, gamma_net: 1, gamma_call: 10, gamma_put: -9 }, { strike: 110, gamma_net: 5, gamma_call: 6, gamma_put: -1 }] };
const matrix = { root: "SPY", asof: "2026-07-10T21:04:11Z", _build_meta: { asof_date: "2026-07-10" },
  strikes: [100, 110], expiries: ["2026-07-10", "2026-07-17"], cells: [
    { strike: 100, expiry: "2026-07-10", gex: 4e6 }, { strike: 110, expiry: "2026-07-10", gex: 0 },
    { strike: 100, expiry: "2026-07-17", gex: -3e6 }, { strike: 110, expiry: "2026-07-17", gex: 5e6 }] };
describe("Exposure Map existing-owner adapter", () => {
  it("preserves distinct gross and net leaders without a viewport input", () => {
    const read = readExposureMap(payload, "SPY", matrix, { kind: "all" }, "gamma", "2026-07-12");
    expect(read.summary.grossLeader?.strike).toBe(100); expect(read.summary.netLeader?.strike).toBe(110);
    expect(read.session).toBe("2026-07-10");
  });
  it("anchors 0DTE to the source session over the weekend, never fabricating gross from net", () => {
    const read = readExposureMap(payload, "SPY", matrix, { kind: "zero" }, "gamma", "2026-07-12");
    expect(read.summary.nodes.map((n) => n.netMn)).toEqual([4, 0]);
    expect(read.summary.netTotalMn).toBe(4); expect(read.summary.grossTotalMn).toBeNull();
    const missing = readExposureMap(payload, "SPY", { ...matrix, cells: matrix.cells.filter((c) => c.strike !== 110) }, { kind: "zero" }, "gamma", "2026-07-12");
    expect(missing.summary.netTotalMn).toBeNull(); expect(missing.summary.netLeader).toBeNull();
  });
  it("never substitutes another exact expiry or synthesizes joint Vanna from its marginal", () => {
    expect(readExposureMap(payload, "SPY", matrix, { kind: "one", exp: "2026-07-14" }, "gamma", "2026-07-12").state).toBe("unavailable");
    expect(readExposureMap(payload, "SPY", matrix, { kind: "zero" }, "vanna", "2026-07-12").state).toBe("unavailable");
  });
  it("withdraws foreign, future and malformed sources", () => {
    const read = (p: unknown) => readExposureMap(p, "SPY", matrix, { kind: "all" }, "gamma", "2026-07-10", Date.parse("2026-07-10T20:30:00Z"));
    expect(read({ ...payload, root: "QQQ" }).state).toBe("wrong_root");
    expect(read({ ...payload, asof: "2026-07-10T21:00:00Z" }).state).toBe("future");
    expect(read({ ...payload, asof: "2026-02-30" }).state).toBe("malformed");
    expect(read({ ...payload, by_strike: [payload.by_strike[0], payload.by_strike[0]] }).state).toBe("malformed");
    expect(readExposureMap(payload, "SPY", { ...matrix, root: "QQQ" } as typeof matrix, { kind: "zero" }, "gamma", "2026-07-12").state).toBe("wrong_root");
  });
  it("shows tiny measured values rather than an apparent zero", () => {
    expect(exposureValue(1e-8)).toBe("1.00e-8"); expect(exposureValue(null)).toBe("—"); expect(exposureValue(-0)).toBe("0");
  });
  it("keeps dated reference data when the optional projection explicitly cannot qualify", () => {
    const p = { ...payload, exposure_projection: { schema:"options_hub.exposure_projection/v2", root: "SPY", clocks: { source_session: "2026-07-10" }, cells_status: "source_unqualified", cells: [] } };
    const read = readExposureMap(p, "SPY", matrix, { kind: "all" }, "gamma", "2026-07-12");
    expect(read.state).toBe("data"); expect(read.qualification).toBe("legacy");
    expect(read.summary.netTotalMn).toBe(6);
    expect(readExposureMap(p, "SPY", matrix, {kind:"all"}, "combined", "2026-07-12").state).toBe("unavailable");
    expect(readExposureMap({...p, exposure_projection:{...p.exposure_projection, root:"QQQ"}}, "SPY", matrix, {kind:"all"}, "gamma", "2026-07-12").state).toBe("unavailable");
  });
  it("accepts the producer's explicit absent-receipt clocks while rejecting false receipt identities for every metric", () => {
    const base = {...payload, by_strike: payload.by_strike.map(r => ({...r, delta_net:3}))};
    const absent = {schema:"options_hub.exposure_projection/v2", root:"SPY", clocks:{source_session:null}, cells_status:"source_unqualified", cells:[]};
    for (const metric of ["gamma","delta"] as const) {
      const read = (receipt:unknown) => readExposureMap({...base, exposure_projection:receipt},"SPY",matrix,{kind:"all"},metric,"2026-07-12");
      expect(read(absent).state).toBe("data");
      expect(read({...absent, schema:"unknown"}).state).toBe("unavailable");
      expect(read({...absent, root:"QQQ"}).state).toBe("unavailable");
      expect(read({...absent, clocks:{source_session:"2026-07-09"}}).state).toBe("unavailable");
      expect(read({...absent, cells_status:"payload_limit"}).state).toBe("unavailable");
    }
  });
  it("exposes published all-expiry Charm and inventory Delta without inventing joint cells", () => {
    const p = {...payload, by_strike: payload.by_strike.map(r => ({...r, charm_net:2, delta_net:3}))};
    expect(readExposureMap(p,"SPY",matrix,{kind:"all"},"charm","2026-07-12").summary.netTotalMn).toBe(4);
    expect(readExposureMap(p,"SPY",matrix,{kind:"all"},"delta","2026-07-12").summary.netTotalMn).toBe(6);
    expect(readExposureMap(p,"SPY",matrix,{kind:"zero"},"charm","2026-07-12").state).toBe("unavailable");
  });

});

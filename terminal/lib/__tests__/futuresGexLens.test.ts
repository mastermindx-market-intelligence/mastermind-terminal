import { describe, it, expect } from "vitest";
import { buildFuturesGexFrame, type FuturesGexFrameInput } from "../futuresGexFrame";
import { selectFuturesGexLens, type FuturesMatrixSource } from "../futuresGexLens";
import type { ExpiryLens } from "../gexLadder";
const time = Date.parse("2026-10-09T18:00:00Z");
const receipt = { artifactId: "synthetic:matrix", sessionDate: "2026-10-09", sourceAsOfMs: time - 2000, availableAtMs: time - 1000 };
const payload = { schema: "options_structure.matrix/v1", root: "SPX", asof: "2026-10-09",
  strikes: [7500, 7510, 7520], expiries: ["2026-10-09", "2026-10-16"], cells: [
    { strike: 7500, expiry: "2026-10-09", gex: -80e6 }, { strike: 7500, expiry: "2026-10-16", gex: -20e6 },
    { strike: 7510, expiry: "2026-10-16", gex: 12e6 },
    { strike: 7520, expiry: "2026-10-09", gex: null }, { strike: 7520, expiry: "2026-10-16", gex: 5e6 },
  ] };
function selection(lens: ExpiryLens, matrix: FuturesMatrixSource = { payload, receipt }, extra = {}) {
  return selectFuturesGexLens({ matrix, lens, root: "SPX", sourceSession: "2026-10-09",
    strikes: [7500, 7510, 7520, 7530], decisionTimeMs: time, maxAgeMs: 5000, ...extra });
}
function frame(lens: ExpiryLens): FuturesGexFrameInput {
  return { expiryLens: lens, matrix: { payload, receipt },
    quotes: { pair: "ES", indexRoot: "SPX", futuresContract: "ESZ6", indexPrice: 7500, futuresPrice: 7520,
      indexTimestampMs: time - 1000, futuresTimestampMs: time - 500 },
    quoteAvailability: { indexAvailableAtMs: time - 900, futuresAvailableAtMs: time - 400,
      indexFeedBasis: "realtime", futuresFeedBasis: "realtime" },
    contract: { symbol: "ESZ6", definitionId: "synthetic:def", validFromMs: time - 100000, validUntilMs: time + 100000 },
    source: { schema: "options_hub.gex/v1", root: "SPX", asof: "2026-10-09", by_strike: [
      { strike: 7500, gamma_net: -100 }, { strike: 7510, gamma_net: 12 }, { strike: 7520, gamma_net: null }, { strike: 7530, gamma_net: 10 }] },
    sourceReceipt: { ...receipt, artifactId: "synthetic:gex" },
    policy: { decisionTimeMs: time, maxQuoteAgeMs: 5000, maxExposureAgeMs: 5000, maxClockSkewMs: 1000, method: "ratio" } };
}
describe("futures expiry lens over the existing matrix owner", () => {
  it("converts dollars to millions once and preserves missing vs true zero", () => {
    const result = selection({ kind: "zero" });
    expect(result.status).toBe("ok"); if (result.status !== "ok") return;
    expect([...result.byStrike.entries()]).toEqual([[7500, -80], [7510, 0], [7520, null], [7530, null]]);
    expect(result.selectedExpiries).toEqual(["2026-10-09"]);
  });
  it("uses ex-zero and named dates consistently without requiring known all-expiry gamma", () => {
    const result = selection({ kind: "ex-zero" });
    expect(result.status).toBe("ok"); if (result.status !== "ok") return;
    expect([...result.byStrike.values()]).toEqual([-20, 12, 5, null]);
    const named = selection({ kind: "one", exp: "2026-10-16" });
    expect(named).toEqual(result);
  });
  it("known daily plus later cuts conserve each fully observed strike", () => {
    const a = selection({ kind: "zero" }), b = selection({ kind: "ex-zero" });
    if (a.status !== "ok" || b.status !== "ok") throw Error("fixture");
    expect(a.byStrike.get(7500)! + b.byStrike.get(7500)!).toBe(-100);
    expect(a.byStrike.get(7510)! + b.byStrike.get(7510)!).toBe(12);
  });
  it("unknown selected cell poisons the partial sum, never silently skips a missing leg", () => {
    const p = structuredClone(payload); p.expiries.push("2026-10-23");
    p.cells.push({ strike: 7500, expiry: "2026-10-23", gex: null });
    const r = selection({ kind: "ex-zero" }, { payload: p, receipt });
    if (r.status !== "ok") throw Error("fixture");
    expect(r.byStrike.get(7500)).toBeNull();
  });
  it("anchors the expiry date to source session even on a later replay wall clock", () => {
    const r = selection({ kind: "zero" }, undefined, { decisionTimeMs: time + 86400000, maxAgeMs: 90000000 });
    expect(r.status).toBe("ok"); if (r.status !== "ok") return;
    expect(r.selectedExpiries).toEqual(["2026-10-09"]);
  });
  for (const lens of [{ kind: "all" }, { kind: "invalid" }, { kind: "one" }, { kind: "one", exp: "2026-02-30" }])
    it(`refuses invalid/direct-all selector ${JSON.stringify(lens)}`, () => {
      expect(selection(lens as ExpiryLens)).toMatchObject({ status: "unavailable", reason: "invalid_expiry_lens" });
    });
  it("does not fabricate a selected expiry or borrow another source session", () => {
    expect(selection({ kind: "one", exp: "2026-10-30" })).toMatchObject({ reason: "expiry_unavailable" });
    expect(selection({ kind: "zero" }, { payload: { ...payload, asof: "2026-10-08" }, receipt })).toMatchObject({ reason: "matrix_session" });
  });
  for (const edit of [
    (m: FuturesMatrixSource) => { m.receipt.availableAtMs = time + 1; },
    (m: FuturesMatrixSource) => { m.receipt.sourceAsOfMs = time - 6000; },
    (m: FuturesMatrixSource) => { m.receipt.availableAtMs = m.receipt.sourceAsOfMs - 1; },
  ]) it("rejects unavailable or stale matrix clocks", () => {
    const m = structuredClone({ payload, receipt }); edit(m);
    expect(selection({ kind: "zero" }, m)).toMatchObject({ status: "unavailable", reason: "matrix_clock" });
  });
  it("rejects duplicate cells, inconsistent axes, wrong root and nonfinite gamma", () => {
    const cases = [
      { ...payload, cells: [...payload.cells, payload.cells[0]] },
      { ...payload, strikes: [7500] }, { ...payload, root: "NDX" },
      { ...payload, cells: [{ strike: 7500, expiry: "2026-10-09", gex: Infinity }] },
    ];
    for (const p of cases) expect(selection({ kind: "zero" }, { payload: p, receipt }).status).toBe("unavailable");
  });
  it("retains true zero across a declared but empty covered matrix", () => {
    const r = selection({ kind: "zero" }, { payload: { ...payload, cells: [] }, receipt });
    if (r.status !== "ok") throw Error("fixture");
    expect([...r.byStrike.values()]).toEqual([0, 0, 0, null]);
  });
  it("frame exposes selected provenance and does not rescale source exposure when mapping", () => {
    const r = buildFuturesGexFrame(frame({ kind: "zero" }));
    expect(r.status).toBe("ok"); if (r.status !== "ok") return;
    expect(r.projection.mapped.map(x => x.gammaNetMn)).toEqual([-80, 0, null, null]);
    expect(r.provenance).toMatchObject({ matrixArtifactId: receipt.artifactId, expiryLens: "zero",
      selectedExpiries: ["2026-10-09"], expiryCutBasis: "source_session_date_not_trading_cutoff" });
  });
  it("reports the oldest contributing exposure age and latest contributing availability", () => {
    const input = frame({ kind: "zero" });
    input.matrix = structuredClone(input.matrix!);
    input.matrix.receipt.sourceAsOfMs = time - 4000;
    input.matrix.receipt.availableAtMs = time - 100;
    const r = buildFuturesGexFrame(input);
    if (r.status !== "ok") throw Error("fixture");
    expect(r.provenance.exposureAgeMs).toBe(4000);
    expect(r.provenance.frameAvailableAtMs).toBe(time - 100);
  });
  it("all-expiry frame needs no matrix; missing matrix on a narrow cut is not a fallback", () => {
    const all = frame({ kind: "all" }); delete all.matrix;
    expect(buildFuturesGexFrame(all).status).toBe("ok");
    all.expiryLens = { kind: "zero" };
    expect(buildFuturesGexFrame(all)).toEqual({ status: "unavailable", reason: "matrix_unavailable" });
  });
});

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { projectFuturesGex, type FuturesGexQuotePair } from "../futuresGexProjection";
import { buildFuturesGexFrame, type FuturesGexFrameInput } from "../futuresGexFrame";
const now = Date.parse("2026-10-09T18:00:00Z");
const q: FuturesGexQuotePair = { pair: "ES", indexRoot: "SPX", futuresContract: "ESZ6",
  indexPrice: 7500, futuresPrice: 7616.25,
  indexTimestampMs: now - 1000, futuresTimestampMs: now - 500 };
const makeInput = (): FuturesGexFrameInput => ({
  quotes: structuredClone(q),
  quoteAvailability: { indexAvailableAtMs: now - 900, futuresAvailableAtMs: now - 400,
    indexFeedBasis: "realtime", futuresFeedBasis: "realtime" },
  contract: { symbol: "ESZ6", definitionId: "fixture:def:ESZ6",
    validFromMs: now - 86400000, validUntilMs: now + 86400000 },
  source: { schema: "options_hub.gex/v1", root: "SPX", asof: "2026-10-09",
    coverage: { oi_date: "t-1" }, by_strike: [
      { strike: 7500, gamma_net: -250 }, { strike: 7510, gamma_net: 0 },
      { strike: 7520, gamma_net: null },
    ] },
  sourceReceipt: { artifactId: "fixture:SPX:gex:20261009:1359", sessionDate: "2026-10-09",
    sourceAsOfMs: now - 60000, availableAtMs: now - 59000 },
  policy: { decisionTimeMs: now, maxQuoteAgeMs: 5000, maxExposureAgeMs: 120000,
    maxClockSkewMs: 2000, method: "ratio" },
});
function refused(input: FuturesGexFrameInput, reason: string) {
  assert.deepEqual(buildFuturesGexFrame(input), { status: "unavailable", reason });
}
describe("futures GEX coordinate kernel", () => {
  it("preserves source strike, zero, unknown and signed million-dollar exposure", () => {
    const r = projectFuturesGex(q, [{ strike: 7500, gammaNetMn: -250 },
      { strike: 7512.5, gammaNetMn: 0 }, { strike: 7490, gammaNetMn: null }])!;
    assert.equal(r.mapped[0].futuresPrice, 7616.25);
    assert.equal(r.mapped[1].futuresPrice, 7628.75);
    assert.equal(r.mapped[2].gammaNetMn, null);
    assert.equal(r.mapped[0].gammaNetMn, -250);
    assert.equal(r.exposureUnit, "usd_millions_per_1pct_index_move");
  });
  it("implements explicit ratio without scaling the source gamma dollars", () => {
    const r = projectFuturesGex(q, [{ strike: 7800, gammaNetMn: 73.42 }], 5000, "ratio")!;
    assert.equal(r.mapped[0].futuresPrice, 7800 * (7616.25 / 7500));
    assert.equal(r.mapped[0].gammaNetMn, 73.42);
    assert.equal(r.method, "ratio");
  });
  it("maps NDX to NQ and rounds only the display label", () => {
    const r = projectFuturesGex({ ...q, pair: "NQ", indexRoot: "NDX",
      futuresContract: "NQZ6", indexPrice: 25500.1, futuresPrice: 25525.35 },
      [{ strike: 25600.1, gammaNetMn: 80 }])!;
    assert.ok(Math.abs(r.mapped[0].futuresPrice - 25625.35) < 1e-8);
    assert.equal(r.mapped[0].displayTickPrice, 25625.25);
  });
  for (const [key, value] of [
    ["indexRoot", "NDX"], ["pair", "CL"], ["futuresContract", "NQZ6"],
    ["futuresContract", "ES=F"], ["futuresContract", "ESF6"], ["futuresContract", 123],
    ["indexPrice", 0], ["futuresPrice", NaN], ["futuresPrice", Infinity],
    ["indexTimestampMs", 0], ["indexTimestampMs", 1.5],
    ["indexTimestampMs", Number.MAX_SAFE_INTEGER + 1],
  ] as const) it(`rejects invalid ${key}=${String(value)}`, () => {
    assert.equal(projectFuturesGex({ ...q, [key]: value } as FuturesGexQuotePair, []), null);
  });
  it("enforces the skew boundary", () => {
    assert.equal(projectFuturesGex(q, [], 499), null);
    assert.ok(projectFuturesGex(q, [], 500));
    assert.equal(projectFuturesGex(q, [], -1), null);
  });
  it("rejects malformed runtime inputs and duplicate strikes", () => {
    assert.equal(projectFuturesGex(null as never, []), null);
    assert.equal(projectFuturesGex(q, "x" as never), null);
    assert.equal(projectFuturesGex(q, [{ strike: 7500, gammaNetMn: NaN }]), null);
    assert.equal(projectFuturesGex(q, [{ strike: 1, gammaNetMn: 1 }, { strike: 1, gammaNetMn: 2 }]), null);
    assert.equal(projectFuturesGex(q, [], 5e3, "other" as never), null);
  });
  it("recomputes a roll independently and never mutates source", () => {
    const rows = Object.freeze([Object.freeze({ strike: 7500, gammaNetMn: -50 })]);
    assert.equal(projectFuturesGex(q, rows)!.mapped[0].futuresPrice, 7616.25);
    assert.equal(projectFuturesGex({ ...q, futuresContract: "ESH7", futuresPrice: 7628.25 }, rows)!.mapped[0].futuresPrice, 7628.25);
    assert.equal(rows[0].strike, 7500);
  });
  it("holds anchor/ordering/rounding invariants over 1,000 deterministic cases", () => {
    for (let n = 1; n <= 1000; n++) {
      const base = 5000 + n / 10, future = base + (n % 80) - 40;
      for (const method of ["basis", "ratio"] as const) {
        const r = projectFuturesGex({ ...q, indexPrice: base, futuresPrice: future },
          [{ strike: base, gammaNetMn: -n }, { strike: base + 10, gammaNetMn: null }], 5000, method)!;
        assert.ok(Math.abs(r.mapped[0].futuresPrice - future) < 1e-8);
        assert.ok(r.mapped[1].futuresPrice > r.mapped[0].futuresPrice);
        assert.ok(Math.abs(r.mapped[0].displayTickPrice - future) <= .12500001);
        assert.equal(r.mapped[0].gammaNetMn, -n);
      }
    }
  });
});
describe("source and point-in-time frame boundary", () => {
  it("consumes the existing source shape, units, inventory basis and provenance", () => {
    const r = buildFuturesGexFrame(makeInput());
    assert.equal(r.status, "ok"); if (r.status !== "ok") return;
    assert.equal(r.projection.mapped[0].gammaNetMn, -250);
    assert.equal(r.provenance.inventoryBasis, "t-1");
    assert.equal(r.provenance.expiryLens, "all");
    assert.equal(r.provenance.dealerPositioning, "estimate");
    assert.equal(r.provenance.quoteAgeMs, 1000);
    assert.equal(r.provenance.exposureAgeMs, 60000);
  });
  it("unwraps only the exact root envelope", () => {
    const i = makeInput(); i.source = { SPX: i.source };
    assert.equal(buildFuturesGexFrame(i).status, "ok");
  });
  const cases: Array<[string, (i: FuturesGexFrameInput) => void, string]> = [
    ["stale synchronized quotes", i => {
      i.quotes.indexTimestampMs = now - 60001; i.quotes.futuresTimestampMs = now - 60000;
    }, "stale_quote"],
    ["closed cash index versus moving futures", i => { i.quotes.indexTimestampMs = now - 3600000; }, "stale_quote"],
    ["future index availability", i => { i.quoteAvailability.indexAvailableAtMs = now + 1; }, "not_yet_available"],
    ["future futures availability", i => { i.quoteAvailability.futuresAvailableAtMs = now + 1; }, "not_yet_available"],
    ["late-published historic GEX", i => { i.sourceReceipt.availableAtMs = now + 1; }, "not_yet_available"],
    ["future source observation", i => {
      i.sourceReceipt.sourceAsOfMs = now + 1; i.sourceReceipt.availableAtMs = now + 2;
    }, "not_yet_available"],
    ["impossible publication clock", i => { i.sourceReceipt.availableAtMs = now - 60001; }, "invalid_clock"],
    ["impossible index capture clock", i => { i.quoteAvailability.indexAvailableAtMs = now - 1001; }, "invalid_clock"],
    ["unknown feed basis", i => { i.quoteAvailability.indexFeedBasis = "live-ish" as never; }, "invalid_clock"],
    ["unknown artifact identity", i => { i.sourceReceipt.artifactId = ""; }, "missing_receipt"],
    ["impossible source session", i => { i.sourceReceipt.sessionDate = "2026-02-30"; }, "missing_receipt"],
    ["stale exposure", i => { i.sourceReceipt.sourceAsOfMs = now - 120001; }, "stale_exposure"],
    ["contract mismatch", i => { i.contract.symbol = "ESH7"; }, "invalid_contract"],
    ["missing contract definition", i => { i.contract.definitionId = ""; }, "invalid_contract"],
    ["contract expired at boundary", i => { i.contract.validUntilMs = now; }, "contract_inactive"],
    ["contract not yet active", i => { i.contract.validFromMs = now + 1; }, "contract_inactive"],
    ["quote predates contract", i => { i.contract.validFromMs = now - 100; }, "contract_inactive"],
    ["inverted contract interval", i => { i.contract.validFromMs = i.contract.validUntilMs; }, "invalid_contract"],
    ["unknown projection policy", i => { i.policy.method = "automatic" as never; }, "invalid_policy"],
    ["invalid age policy", i => { i.policy.maxQuoteAgeMs = -1; }, "invalid_policy"],
    ["unsafe decision clock", i => { i.policy.decisionTimeMs = NaN; }, "invalid_policy"],
    ["source schema mismatch", i => { (i.source as Record<string, unknown>).schema = "matrix/v1"; }, "source_schema"],
    ["wrong source root", i => { (i.source as Record<string, unknown>).root = "NDX"; }, "source_root"],
    ["wrong source session", i => { (i.source as Record<string, unknown>).asof = "2026-10-08"; }, "source_session"],
    ["missing rows", i => { delete (i.source as Record<string, unknown>).by_strike; }, "source_rows"],
    ["empty rows", i => { (i.source as Record<string, unknown>).by_strike = []; }, "empty_source"],
    ["unknown-only rows", i => { (i.source as Record<string, unknown>).by_strike = [{ strike: 7500, gamma_net: null }]; }, "empty_source"],
    ["NaN exposure", i => { (i.source as Record<string, unknown>).by_strike = [{ strike: 7500, gamma_net: NaN }]; }, "source_rows"],
    ["duplicate source strikes", i => { (i.source as Record<string, unknown>).by_strike = [{ strike: 7500, gamma_net: 1 }, { strike: 7500, gamma_net: 2 }]; }, "invalid_projection"],
    ["quote skew", i => { i.policy.maxClockSkewMs = 499; }, "invalid_projection"],
  ];
  for (const [name, mutate, reason] of cases) it(`refuses ${name}`, () => {
    const input = makeInput(); mutate(input); refused(input, reason);
  });
  it("includes exact freshness and publication boundaries", () => {
    const i = makeInput(); i.policy.maxQuoteAgeMs = 1000; i.policy.maxExposureAgeMs = 60000;
    i.sourceReceipt.availableAtMs = now;
    assert.equal(buildFuturesGexFrame(i).status, "ok");
  });
  it("preserves delayed labeling even under an explicitly relaxed age policy", () => {
    const i = makeInput(); i.quoteAvailability.indexFeedBasis = "delayed";
    const r = buildFuturesGexFrame(i);
    assert.equal(r.status, "ok"); if (r.status !== "ok") return;
    assert.equal(r.provenance.indexFeedBasis, "delayed");
  });
  it("distinguishes genuine zero exposure from unknown inventory", () => {
    const i = makeInput(); i.source = { schema: "options_hub.gex/v1", root: "SPX",
      asof: "2026-10-09", by_strike: [{ strike: 7500, gamma_net: 0 }] };
    const r = buildFuturesGexFrame(i); assert.equal(r.status, "ok"); if (r.status !== "ok") return;
    assert.equal(r.projection.mapped[0].gammaNetMn, 0); assert.equal(r.provenance.inventoryBasis, null);
  });
  it("leaves all caller data unchanged", () => {
    const i = makeInput(), before = structuredClone(i); buildFuturesGexFrame(i); assert.deepEqual(i, before);
  });
  it("rejects absent or malformed runtime envelopes without throwing", () => {
    assert.deepEqual(buildFuturesGexFrame(null as never), { status: "unavailable", reason: "invalid_input" });
    const i = makeInput(); i.sourceReceipt = null as never; refused(i, "missing_receipt");
  });
});

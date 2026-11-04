import { describe, expect, it } from "vitest";
import {
  chartDisplayTimezone,
  displayEpochToUtcMs,
  largeTradesModeLabel,
  projectLargeTradeClusters,
  resolveLargeTradesClock,
  utcMsToDisplayEpoch,
} from "@/lib/largeTrades/chartProjection";
import type {
  LargeTradeCluster,
  LargeTradesEnvelope,
  TradeProvenance,
} from "@/lib/largeTrades/types";

const ET = "America/New_York";
const ms = (iso: string) => Date.parse(iso);
const ns = (value: number) => (BigInt(value) * BigInt(1_000_000)).toString();
const NOW = ms("2026-10-11T08:00:00.000Z");

// Explicit synthetic records: this suite proves clock and rendering contracts,
// not feed licensing, source coverage, inferred direction, or a trading signal.
function envelope(mode: TradeProvenance["dataMode"] = "fixture"): LargeTradesEnvelope {
  const historical = mode === "historical";
  const fixture = mode === "fixture";
  return {
    schema: "mastermind.large_trades.v1",
    instrument: {
      symbol: "MNQZ6", instrumentId: "test:MNQZ6", assetClass: "future",
      quantityUnit: "contracts", priceScale: 100, tickSizeInt: 25, timezone: ET,
    },
    provenance: {
      provider: "deterministic_test", dataset: "synthetic_execution_records", venue: "TEST",
      scope: "venue", dataMode: mode,
      evidenceMode: fixture ? "FIXTURE" : historical ? "HISTORICAL_REPLAY" : "ACTUAL_AS_SEEN",
      sourceId: "projection-test", sourceSha256: null, sourceRef: "test:projection",
      generatedAtNs: ns(NOW), acquiredAtNs: historical ? ns(NOW - 1_000) : null,
      receiptBasis: fixture ? "fixture" : historical ? "archive_acquisition" : "original_receive",
      coverage: "complete", sequenceGaps: 0, delayMs: mode === "delayed" ? 900_000 : 0,
      conditionPolicy: "synthetic executions only", attribution: "Deterministic test fixture",
      termsUrl: null,
    },
    range: { startNs: ns(NOW - 30_000), endNs: ns(NOW) },
    prints: [], responses: [], responseCoverage: "unavailable", responseKnownAtNs: null,
  };
}

function cluster(iso: string, change: Partial<LargeTradeCluster> = {}): LargeTradeCluster {
  const at = ns(ms(iso));
  return {
    id: iso, session: "2026-01-15", startNs: at, endNs: at, knownAtNs: at,
    quantity: 100, tradeCount: 1, buyQuantity: 0, sellQuantity: 100, unknownQuantity: 0,
    side: "sell", sideMethod: "exchange", minPriceInt: 2_134_225, maxPriceInt: 2_134_250,
    weightedPrice: 21_342.375, lastPriceInt: 2_134_250,
    notionalNumerator: "213423750", threshold: 100, baselineSamples: 0,
    calibrationReady: true, sourceIds: ["test-print"], orderCount: null,
    response: {
      state: "unobservable", reason: "No qualified response records in this test",
      knownAtNs: null, endpointNs: null, responseTicks: null, absorption: "unavailable",
      evidence: "unavailable", predictiveSignal: false,
    },
    ...change,
  };
}

describe("large-trades chart display clock", () => {
  it.each([
    ["2026-01-15T14:30:45.123Z", "2026-01-15T09:30:45.123Z"],
    ["2026-07-15T13:30:45.123Z", "2026-07-15T09:30:45.123Z"],
    ["2026-01-16T04:59:59.500Z", "2026-01-15T23:59:59.500Z"],
    ["2026-03-08T06:59:59.999Z", "2026-03-08T01:59:59.999Z"],
    ["2026-03-08T07:00:00.000Z", "2026-03-08T03:00:00.000Z"],
  ])("maps UTC %s to the existing ET wall-clock axis %s", (utc, display) => {
    // The expected axis is independently specified, not produced by the conversion under test.
    expect(utcMsToDisplayEpoch(ms(utc), ET)).toBe(ms(display) / 1000);
    expect(displayEpochToUtcMs(ms(display), ET)).toBe(ms(utc));
  });

  it("refuses the two UTC interpretations of the autumn repeated hour", () => {
    const display = ms("2026-11-01T01:30:00.000Z");
    expect(utcMsToDisplayEpoch(ms("2026-11-01T05:30:00.000Z"), ET)).toBe(display / 1000);
    expect(utcMsToDisplayEpoch(ms("2026-11-01T06:30:00.000Z"), ET)).toBe(display / 1000);
    expect(displayEpochToUtcMs(display, ET)).toBeNull();
  });

  it("refuses a nonexistent spring-forward wall clock", () => {
    expect(displayEpochToUtcMs(ms("2026-03-08T02:30:00.000Z"), ET)).toBeNull();
  });

  it.each([NaN, Infinity, -1])("refuses an invalid display clock (%s)", (value) => {
    expect(displayEpochToUtcMs(value, ET)).toBeNull();
  });

  it("uses the current chart market basis for US, Canadian, CN, HK, and crypto symbols", () => {
    expect(chartDisplayTimezone("AAPL")).toBe(ET);
    expect(chartDisplayTimezone("SHOP.TO")).toBe(ET);
    expect(chartDisplayTimezone("600519.SS")).toBe("Asia/Shanghai");
    expect(chartDisplayTimezone("0700.HK")).toBe("Asia/Hong_Kong");
    expect(chartDisplayTimezone("BTC-USD")).toBe(ET);
  });
});

describe("large-trades replay knowledge", () => {
  const replay = { clock: "intraday", at: ms("2026-01-15T09:30:45.123Z") } as const;
  const marketNs = ns(ms("2026-01-15T14:30:45.123Z"));

  it("caps ACTUAL_AS_SEEN knowledge at the historical decision instant", () => {
    const source = envelope("live");
    expect(resolveLargeTradesClock(source, replay, ET, NOW)).toEqual({
      state: "ready", clock: { marketCutoffNs: marketNs, knowledgeCutoffNs: marketNs },
    });
    expect(source.provenance.evidenceMode).toBe("ACTUAL_AS_SEEN");
  });

  it("allows later archive acquisition knowledge only in labeled historical reconstruction", () => {
    const source = envelope("historical");
    expect(resolveLargeTradesClock(source, replay, ET, NOW)).toEqual({
      state: "ready", clock: { marketCutoffNs: marketNs, knowledgeCutoffNs: ns(NOW) },
    });
    expect(BigInt(source.provenance.acquiredAtNs!)).toBeGreaterThan(BigInt(marketNs));
    expect(source.provenance.evidenceMode).toBe("HISTORICAL_REPLAY");
  });

  it("uses the observation clock for both cutoffs outside replay", () => {
    expect(resolveLargeTradesClock(envelope("live"), null, ET, NOW)).toEqual({
      state: "ready", clock: { marketCutoffNs: ns(NOW), knowledgeCutoffNs: ns(NOW) },
    });
  });

  it("does not interpret a session-date replay cursor as an intraday instant", () => {
    expect(resolveLargeTradesClock(envelope(), { clock: "session", at: replay.at }, ET, NOW))
      .toEqual({ state: "unsupported_replay_clock" });
  });

  it.each(["2026-03-08T02:30:00.000Z", "2026-11-01T01:30:00.000Z"])(
    "blocks ambiguous or nonexistent replay wall-clock %s",
    (at) => {
      expect(resolveLargeTradesClock(envelope(), { clock: "intraday", at: ms(at) }, ET, NOW))
        .toEqual({ state: "ambiguous_replay_time" });
    },
  );

  it("cannot advance either actual-as-seen clock beyond the current observation time", () => {
    expect(resolveLargeTradesClock(
      envelope("live"), { clock: "intraday", at: ms("2026-12-01T09:30:00.000Z") }, ET, NOW,
    )).toEqual({
      state: "ready", clock: { marketCutoffNs: ns(NOW), knowledgeCutoffNs: ns(NOW) },
    });
  });
});

describe("transaction markers on real chart intervals", () => {
  const first = ms("2026-01-15T09:30:00.000Z") / 1000;
  const bars = [{ time: first }, { time: first + 60 }, { time: first + 300 }];

  it("anchors to the containing existing bar and refuses missing intervals and future-bar snapping", () => {
    const records = [
      cluster("2026-01-15T14:29:59.999Z", { id: "before-first" }),
      cluster("2026-01-15T14:30:00.000Z", { id: "first-open" }),
      cluster("2026-01-15T14:30:59.999Z", { id: "first-end" }),
      cluster("2026-01-15T14:31:00.000Z", { id: "second-open" }),
      cluster("2026-01-15T14:32:00.000Z", { id: "gap-start" }),
      cluster("2026-01-15T14:34:59.999Z", { id: "before-future-bar" }),
      cluster("2026-01-15T14:35:00.000Z", { id: "last-open" }),
      cluster("2026-01-15T14:36:00.000Z", { id: "after-last" }),
    ];
    const projected = projectLargeTradeClusters(records, bars, "1m", ET, 100);
    expect(projected.map((p) => [p.cluster.id, p.chartTime])).toEqual([
      ["first-open", first], ["first-end", first], ["second-open", first + 60],
      ["last-open", first + 300],
    ]);
    expect(projected[1].exactDisplayEpoch).toBe(ms("2026-01-15T09:30:59.999Z") / 1000);
    expect(projected[1].cluster).toBe(records[2]);
  });

  it("preserves subsecond execution placement on the supported second bar interval", () => {
    const record = cluster("2026-01-15T14:30:45.999Z");
    const projected = projectLargeTradeClusters(
      [record], [{ time: first + 45 }, { time: first + 46 }], "1s", ET, 100,
    );
    expect(projected).toHaveLength(1);
    expect(projected[0].chartTime).toBe(first + 45);
    expect(projected[0].exactDisplayEpoch).toBe(first + 45.999);
    expect(projected[0].cluster.endNs).toBe(ns(ms("2026-01-15T14:30:45.999Z")));
  });

  it("does not bridge an overnight chart gap", () => {
    expect(projectLargeTradeClusters(
      [cluster("2026-01-15T21:00:00.000Z")],
      [{ time: first }, { time: first + 86_400 }], "1m", ET, 100,
    )).toEqual([]);
  });

  it.each([
    { axis: [] }, { axis: [{ time: "2026-01-15" }] }, { axis: [{ time: NaN }] },
    { axis: [{ time: first }, { time: first }] },
    { axis: [{ time: first + 60 }, { time: first }] },
  ])("refuses an absent, nonnumeric, duplicate, or descending bar axis ($axis)", ({ axis }) => {
    expect(projectLargeTradeClusters([cluster("2026-01-15T14:30:30.000Z")], axis, "1m", ET, 100))
      .toEqual([]);
  });

  it.each(["1D", "1W", "not-a-timeframe"])("does not invent transaction placement on %s", (tf) => {
    expect(projectLargeTradeClusters([cluster("2026-01-15T14:30:30.000Z")], bars, tf, ET, 100))
      .toEqual([]);
  });

  it("scales uncapped circle area by quantity while retaining exact price, quantity, and trade count", () => {
    const records = [100, 400, 1301, 1_000_000].map((quantity) =>
      cluster("2026-01-15T14:30:30.000Z", { id: "quantity-" + quantity, quantity, tradeCount: 3 }),
    );
    const projected = projectLargeTradeClusters(records, bars, "1m", ET, 100);
    expect(projected.map((p) => p.diameter)).toEqual([24, 48, 64, 64]);
    expect(projected[1].diameter ** 2 / projected[0].diameter ** 2).toBe(4);
    expect(projected.map((p) => p.cluster.quantity)).toEqual([100, 400, 1301, 1_000_000]);
    expect(projected.every((p) => p.price === 21_342.375)).toBe(true);
    expect(projected[2].cluster.tradeCount).toBe(3);
    expect(projected[2].cluster.orderCount).toBeNull();
    expect(projected[2].cluster).toBe(records[2]);
  });

  it.each([0, -1, NaN, Infinity])("refuses invalid chart price %s", (weightedPrice) => {
    expect(projectLargeTradeClusters(
      [cluster("2026-01-15T14:30:30.000Z", { weightedPrice })], bars, "1m", ET, 100,
    )).toEqual([]);
  });
});

describe("large-trades freshness labeling", () => {
  it("keeps a fresh original-receive feed live", () => {
    expect(largeTradesModeLabel(envelope("live"), NOW)).toBe("live");
  });

  it("removes Live after the transaction clock becomes stale even if publication is fresh", () => {
    const source = envelope("live");
    source.range.endNs = ns(NOW - 60_001);
    expect(largeTradesModeLabel(source, NOW)).toBe("stale");
  });

  it("removes Live after publication stops even if the last event clock is recent", () => {
    const source = envelope("live");
    source.provenance.generatedAtNs = ns(NOW - 60_001);
    expect(largeTradesModeLabel(source, NOW)).toBe("stale");
  });

  it.each(["event", "publication"])("removes Live for a future %s clock", (clock) => {
    const source = envelope("live");
    if (clock === "event") source.range.endNs = ns(NOW + 1);
    else source.provenance.generatedAtNs = ns(NOW + 1);
    expect(largeTradesModeLabel(source, NOW)).toBe("stale");
  });

  it.each(["delayed", "historical", "fixture", "unavailable"] as const)(
    "never upgrades a %s source to Live because its file is recent", (mode) => {
      expect(largeTradesModeLabel(envelope(mode), NOW)).toBe(mode);
    },
  );
});

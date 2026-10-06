import { describe, it, expect } from "vitest";
import { capJson, curateGex, curateMarketRisk } from "../copilotTools";

const NOW = Date.parse("2026-07-14T00:00:00Z");

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("capJson evidence envelope", () => {
  it("preserves identity, clocks, basis, coverage and limitations under payload pressure", () => {
    const payload: Record<string, unknown> = {
      symbol: "SPY",
      root: "SPY",
      schema: "options_hub.gex/v1",
      asof: "2026-07-10T20:15:00Z",
      built: "2026-07-10T20:15:00Z",
      freshness: "stale",
      stale: true,
      age_hours: 90,
      basis: "dealer-sign per engine/gex_model",
      coverage: { n_days: 6, since: "2026-07-02", note: "C".repeat(1200) },
      limitations: "L".repeat(1200),
      narrative: "n".repeat(8000),
      story: "s".repeat(8000),
      extra1: "e".repeat(4000),
      extra2: "f".repeat(4000),
      rows: Array.from({ length: 300 }, (_, i) => ({ i, txt: "t".repeat(80) })),
    };
    const capped = capJson(payload);
    expect(capped.truncated).toBe(true);
    expect(capped.cap_unit).toBe("utf8_bytes");
    expect(capped.symbol).toBe("SPY");
    expect(capped.root).toBe("SPY");
    expect(capped.schema).toBe("options_hub.gex/v1");
    expect(capped.asof).toBe("2026-07-10T20:15:00Z");
    expect(capped.built).toBe("2026-07-10T20:15:00Z");
    expect(capped.freshness).toBe("stale");
    expect(capped.stale).toBe(true);
    expect(capped.age_hours).toBe(90);
    expect(capped.basis).toBe("dealer-sign per engine/gex_model");
    expect(typeof capped.limitations).toBe("string");
    expect((capped.limitations as string).length).toBeGreaterThan(0);
    expect(capped.coverage).toBeTruthy();
    expect(capped.narrative).toBeUndefined();
    expect(capped.rows).toBeUndefined();
    const serialized = JSON.stringify(capped);
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(utf8Bytes(capped)).toBeLessThanOrEqual(2000);
  });

  it("budgets Unicode payloads in utf8 bytes and never emits clipped JSON", () => {
    const payload = { symbol: "X", story: "€".repeat(700) };
    expect(JSON.stringify(payload).length).toBeLessThan(2000);
    expect(utf8Bytes(payload)).toBeGreaterThan(2000);
    const capped = capJson(payload);
    expect(capped.truncated).toBe(true);
    expect(capped.cap_unit).toBe("utf8_bytes");
    expect(capped.symbol).toBe("X");
    const serialized = JSON.stringify(capped);
    expect(utf8Bytes(capped)).toBeLessThanOrEqual(2000);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it("enforces the utf8 budget when nested protected state/ladder/facts exceed it", () => {
    const fat = {
      root: "SPY",
      session: "2026-10-02",
      asof: "2026-10-02T20:00:00Z",
      net_gex_bn: 12.5,
      gamma_flip: 500,
      limitations: "dealer sign is an assumption; levels are display-only",
      coverage: { n_days: 6, since: "2026-07-02" },
      state: {
        root: "SPY",
        asof: "2026-10-02T20:00:00Z",
        net_gex_bn: 12.5,
        facts: Array.from({ length: 80 }, (_, i) => ({ i, note: "σ".repeat(40) })),
      },
      ladder: {
        root: "QQQ",
        asof: "2026-09-30T20:00:00Z",
        call_walls: Array.from({ length: 80 }, (_, i) => ({ strike: 400 + i, gamma: 1, note: "€".repeat(40) })),
      },
      facts: Array.from({ length: 40 }, (_, i) => ({ i, blob: "限".repeat(30) })),
    };
    const capped = capJson(fat);
    const serialized = JSON.stringify(capped);
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(capped.cap_unit).toBe("utf8_bytes");
    expect(utf8Bytes(capped)).toBeLessThanOrEqual(2000);
    expect(capped.truncated).toBe(true);
    expect(typeof capped.limitations === "string" && (capped.limitations as string).length > 0).toBe(true);
    expect(Array.isArray(capped.facts) && (capped.facts as unknown[]).length > 10).toBe(false);
    expect(
      capped.state &&
        typeof capped.state === "object" &&
        Array.isArray((capped.state as Record<string, unknown>).facts) &&
        ((capped.state as Record<string, unknown>).facts as unknown[]).length > 10,
    ).toBe(false);
  });

  it("does not keep financial numbers after dropping limitations under oversize pressure", () => {
    const fat = {
      symbol: "SPY",
      root: "SPY",
      limitations: "L".repeat(1800),
      coverage: { note: "C".repeat(1800) },
      net_gex_bn: 12.5,
      call_wall: 500,
      state: {
        net_gex_bn: 9.1,
        magnet: 498,
        pin_probability: 0.4,
        rows: Array.from({ length: 50 }, (_, i) => ({ i, txt: "n".repeat(80) })),
      },
      ladder: {
        net_gex_bn: 2.2,
        call_walls: Array.from({ length: 50 }, (_, i) => ({ strike: 400 + i, gamma: 3 })),
      },
    };
    const capped = capJson(fat);
    const serialized = JSON.stringify(capped);
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(utf8Bytes(capped)).toBeLessThanOrEqual(2000);
    expect(typeof capped.limitations === "string" && (capped.limitations as string).length > 0).toBe(true);
    const droppedLimitations = capped.limitations == null;
    const keptNumbers = capped.net_gex_bn != null || capped.call_wall != null;
    expect(droppedLimitations && keptNumbers).toBe(false);
  });
});

describe("curator consumer statuses", () => {
  it("retains unavailable, stale and mixed-source statuses and never presents unknown as fresh", () => {
    const unknownRisk = curateMarketRisk(
      { display: { verdict: "RISK_ON", score: 71, label_en: "Risk on" } },
      NOW,
    );
    const staleRisk = curateMarketRisk(
      { built: "2026-07-10T06:00:00Z", display: { verdict: "RISK_ON", score: 71 } },
      NOW,
    );
    const mixedGex = curateGex(
      {
        root: "QQQ",
        asof: "2026-09-30T20:00:00Z",
        net_gex_bn: 2,
        by_strike: [{ strike: 600, gamma_call: 3 }],
      },
      { root: "SPY", asof: "2026-10-02T20:00:00Z", net_gex_bn: 1, spot: 500 },
    );
    const unavailable = { no_data: true, reason: "no fundamentals file for symbol" };

    expect(unknownRisk.freshness).toBe("unknown");
    expect(unknownRisk.stale).not.toBe(false);
    expect(staleRisk.freshness).toBe("stale");
    expect(staleRisk.stale).toBe(true);
    expect(mixedGex.mixed_source).toBe(true);
    expect(unavailable.no_data).toBe(true);

    const cappedUnknown = capJson({
      symbol: "MKT",
      freshness: unknownRisk.freshness,
      stale: unknownRisk.stale,
      clock_status: unknownRisk.clock_status,
      limitations: "unknown clock is not a fresh verdict",
      story: "s".repeat(8000),
    });
    expect(cappedUnknown.freshness).toBe("unknown");
    expect(cappedUnknown.stale).not.toBe(false);
    expect(cappedUnknown.clock_status).toBe("missing");

    const cappedMixed = capJson({
      symbol: "SPY",
      mixed_source: mixedGex.mixed_source,
      limitations: mixedGex.limitations,
      gex: mixedGex,
      story: "s".repeat(8000),
    });
    expect(cappedMixed.mixed_source).toBe(true);
    expect(typeof cappedMixed.limitations).toBe("string");
    expect(utf8Bytes(cappedMixed)).toBeLessThanOrEqual(2000);
  });
});

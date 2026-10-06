import { describe, it, expect } from "vitest";
import * as copilotTools from "../copilotTools";
import { capJson, curateGex, curateMarketRisk } from "../copilotTools";

const NOW = Date.parse("2026-07-14T00:00:00Z");

type PresentFn = (tools: Array<Record<string, unknown>>) => Record<string, unknown>;

function presentEvidence(tools: Array<Record<string, unknown>>): Record<string, unknown> {
  const fn = (copilotTools as { presentCopilotEvidence?: PresentFn }).presentCopilotEvidence;
  expect(typeof fn).toBe("function");
  return fn!(tools);
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
    expect(capped.symbol).toBe("SPY");
    expect(capped.root).toBe("SPY");
    expect(capped.schema).toBe("options_hub.gex/v1");
    expect(capped.asof).toBe("2026-07-10T20:15:00Z");
    expect(capped.built).toBe("2026-07-10T20:15:00Z");
    expect(capped.freshness).toBe("stale");
    expect(capped.stale).toBe(true);
    expect(capped.age_hours).toBe(90);
    expect(capped.basis).toBe("dealer-sign per engine/gex_model");
    expect(capped.coverage).toEqual({ n_days: 6, since: "2026-07-02", note: "C".repeat(1200) });
    expect(capped.limitations).toBe("L".repeat(1200));
    expect(capped.narrative).toBeUndefined();
    expect(capped.rows).toBeUndefined();
    expect(() => JSON.parse(JSON.stringify(capped))).not.toThrow();
  });

  it("budgets Unicode payloads in utf8 bytes and never emits clipped JSON", () => {
    const payload = { symbol: "X", story: "€".repeat(700) };
    expect(JSON.stringify(payload).length).toBeLessThan(2000);
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeGreaterThan(2000);
    const capped = capJson(payload);
    expect(capped.truncated).toBe(true);
    expect(capped.cap_unit).toBe("utf8_bytes");
    expect(capped.symbol).toBe("X");
    const serialized = JSON.stringify(capped);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(2000);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});

describe("presentCopilotEvidence consumer", () => {
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
    const out = presentEvidence([
      { tool: "get_market_state", market_risk: unknownRisk },
      { tool: "get_market_state", market_risk: staleRisk },
      { tool: "get_options_summary", symbol: "SPY", gex: mixedGex },
      { tool: "get_fundamentals", no_data: true, reason: "no fundamentals file for symbol" },
    ]);

    expect(out.synthesis).toBe("unavailable");
    expect(out.trade_authority).toBe(false);

    const facts = out.facts as Array<Record<string, unknown>>;
    expect(Array.isArray(facts)).toBe(true);

    const statuses = facts.map((f) => f.status);
    expect(statuses).toContain("unavailable");
    expect(statuses).toContain("stale");
    expect(statuses.some((s) => s === "mixed_source" || s === "unavailable")).toBe(true);

    const unknownFact = facts.find((f) => f.tool === "get_market_state" && f.clock === "unknown");
    const fallbackUnknown = facts.find(
      (f) => f.tool === "get_market_state" && f.status !== "stale" && f.status !== "fresh",
    );
    const unknown = unknownFact ?? fallbackUnknown;
    expect(unknown).toBeTruthy();
    expect(unknown!.status).not.toBe("fresh");
    expect(unknown!.presentable_as_fresh).not.toBe(true);

    expect(facts.some((f) => f.status === "fresh" && f.clock === "unknown")).toBe(false);
    expect(facts.some((f) => f.presentable_as_fresh === true && (f.status === "unknown" || f.clock === "unknown"))).toBe(
      false,
    );
  });
});

import { expect, test } from "@playwright/test";

/**
 * Deterministic Copilot evidence consumer: the /api/copilot route must retain
 * unavailable / stale / mixed-source semantics without a live model.
 *
 * This is not live-model or production-browser proof. It posts curated tool
 * facts with synthesize:false and reads the enforced envelope.
 */

test.setTimeout(60_000);

const NOW_BUILT_MISSING = {
  tool: "get_market_state",
  market_risk: {
    verdict: "RISK_ON",
    score: 71,
    label: "Risk on",
    built: null,
    age_hours: null,
    stale: null,
    freshness: "unknown",
  },
};

const STALE_RISK = {
  tool: "get_market_state",
  market_risk: {
    verdict: "RISK_ON",
    score: 71,
    built: "2026-07-10T06:00:00Z",
    stale: true,
    freshness: "stale",
    age_hours: 90,
  },
};

const MIXED_GEX = {
  tool: "get_options_summary",
  symbol: "SPY",
  gex: {
    mixed_source: true,
    reason: "GEX state and ladder disagree on root/session",
    state: { root: "SPY", asof: "2026-10-02T20:00:00Z", net_gex_bn: 1 },
    ladder: { root: "QQQ", asof: "2026-09-30T20:00:00Z", call_walls: [{ strike: 600, gamma: 3 }] },
  },
};

const UNAVAILABLE = {
  tool: "get_fundamentals",
  no_data: true,
  reason: "no fundamentals file for symbol",
};

test("copilot evidence consumer retains unavailable/stale/mixed-source without a live model", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "envelope enforcement is an API consumer, not a viewport matrix",
  );

  const res = await request.post("/api/copilot", {
    data: {
      message: "What is the market risk and SPY dealer positioning?",
      synthesize: false,
      tool_results: [NOW_BUILT_MISSING, STALE_RISK, MIXED_GEX, UNAVAILABLE],
    },
    headers: { "content-type": "application/json" },
  });

  expect(res.ok(), `expected envelope JSON, got ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.synthesis).toBe("unavailable");
  expect(body.trade_authority).toBe(false);

  const facts = body.facts as Array<Record<string, unknown>>;
  expect(Array.isArray(facts)).toBe(true);
  const statuses = facts.map((f) => f.status);
  expect(statuses).toContain("unavailable");
  expect(statuses).toContain("stale");
  expect(statuses).toContain("mixed_source");
  expect(facts.some((f) => f.status === "fresh" && f.clock === "unknown")).toBe(false);
  expect(facts.some((f) => f.presentable_as_fresh === true && f.status !== "fresh")).toBe(false);
});

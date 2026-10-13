import { expect, test } from "@playwright/test";

/**
 * Auth-boundary regression for the preserved /api/copilot rollback proxy.
 *
 * The shipped Terminal UI uses /api/brain/*. This route is retained for
 * rollback and is not the live copilot consumer. Client-authored tool_results
 * must not skip the existing getUser/getSession gate.
 *
 * This is not live-model proof, not Brain/Macro tool-to-UI proof, and not
 * responsive layout acceptance. The same API assertion runs on every Playwright
 * project because the gate is request-level. Remaining user-path proof is owed
 * through owning Brain/Macro contracts.
 */

test.setTimeout(60_000);

test("unauthenticated /api/copilot stays 401 even with synthesize:false tool_results", async ({
  request,
}) => {
  const res = await request.post("/api/copilot", {
    data: {
      message: "What is the market risk and SPY dealer positioning?",
      synthesize: false,
      tool_results: [
        {
          tool: "get_market_state",
          market_risk: { verdict: "RISK_ON", stale: null, freshness: "unknown" },
        },
      ],
    },
    headers: { "content-type": "application/json" },
  });

  expect(res.status()).toBe(401);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.code).toBe("unauthenticated");
  expect(body.facts).toBeUndefined();
  expect(body.synthesis).toBeUndefined();
});

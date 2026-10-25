import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: true }),
  tooMany: () => new Response("rate limited", { status: 429 }),
}));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: async () => "allowed" }));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({
  fetchOptionsAlphaCandidatePair: async () => ({}),
}));
vi.mock("@/lib/flowSource", () => ({
  isValidF: (f: string) => f === "gex:NDX" || f === "gex:SPY",
  fixtureFor: async (f: string) => f === "gex:NDX"
    ? { root: "NDX", schema: "options_hub.gex/v1", family_source: { state: "OFFLINE_SOURCE_QUALIFIED_NOT_PUBLISHABLE" } }
    : { root: "SPY", schema: "options_hub.gex/v1", by_strike: [] },
  attachFlowScores: () => undefined,
  tryFetchUpstream: async () => null,
  tryFetchUpstreamResult: async () => ({ status: "unavailable" }),
}));

import { GET } from "@/app/api/flow/route";

describe("fixture HTTP source boundary", () => {
  it("refuses an offline two-root family in dev fixture mode instead of serving HTTP 200", async () => {
    const prev = process.env.FLOW_FIXTURE;
    process.env.FLOW_FIXTURE = "1";
    try {
      const response = await GET(new Request("http://localhost/api/flow?f=gex%3ANDX"));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "feed unavailable" });
      const ordinary = await GET(new Request("http://localhost/api/flow?f=gex%3ASPY"));
      expect(ordinary.status).toBe(200);
      expect((await ordinary.json()).root).toBe("SPY");
    } finally {
      if (prev === undefined) delete process.env.FLOW_FIXTURE;
      else process.env.FLOW_FIXTURE = prev;
    }
  });
});

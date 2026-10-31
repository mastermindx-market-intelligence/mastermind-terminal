import { describe, expect, it, vi } from "vitest";

const admission = vi.hoisted(() => ({ mockedData: null as Record<string, unknown> | null }));

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: true }),
  tooMany: () => new Response("rate limited", { status: 429 }),
}));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: async () => "allowed" }));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({
  fetchOptionsAlphaCandidatePair: async () => ({}),
}));
vi.mock("@/lib/flowSource", () => ({
  isValidF: (f: string) => f === "gex:NDX" || f === "gex:SPY" || f === "gex:SPX",
  fixtureFor: async (f: string) => f === "gex:NDX"
    ? { root: "NDX", schema: "options_hub.gex/v1", family_source: { state: "OFFLINE_SOURCE_QUALIFIED_NOT_PUBLISHABLE" } }
    : { root: "SPY", schema: "options_hub.gex/v1", by_strike: [] },
  attachFlowScores: () => undefined,
  tryFetchUpstream: async () => null,
  tryFetchUpstreamResult: async () => admission.mockedData
    ? { status: "data", data: admission.mockedData }
    : { status: "unavailable" },
}));

import { GET } from "@/app/api/flow/route";

describe("fixture HTTP source boundary", () => {
  it("refuses an offline two-root family even if an adapter returns an unchecked data outcome", async () => {
    const prev = process.env.FLOW_FIXTURE;
    delete process.env.FLOW_FIXTURE;
    try {
      admission.mockedData = { schema: "options_hub.gex/v1", root: "NDX",
        family_source: { state: "OFFLINE_SOURCE_QUALIFIED_NOT_PUBLISHABLE" } };
      const response = await GET(new Request("http://localhost/api/flow?f=gex%3ANDX"));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      admission.mockedData = null;
      if (prev === undefined) delete process.env.FLOW_FIXTURE;
      else process.env.FLOW_FIXTURE = prev;
    }
  });

  it("refuses a newly disqualified warm cached GEX frame", async () => {
    const prev = process.env.FLOW_FIXTURE;
    delete process.env.FLOW_FIXTURE;
    const plain: Record<string, unknown> = { schema: "options_hub.gex/v1", root: "SPX", by_strike: [] };
    admission.mockedData = plain;
    try {
      const first = await GET(new Request("http://localhost/api/flow?f=gex%3ASPX"));
      expect(first.status).toBe(200);
      // Exercise defense in depth against a source/cache mutation without
      // making a new network request or claiming a publisher receipt.
      plain.family_source = { state: "OFFLINE_SOURCE_QUALIFIED_NOT_PUBLISHABLE" };
      const repeat = await GET(new Request("http://localhost/api/flow?f=gex%3ASPX"));
      expect(repeat.status).toBe(503);
      expect(repeat.headers.get("cache-control")).toBe("no-store");
    } finally {
      admission.mockedData = null;
      if (prev === undefined) delete process.env.FLOW_FIXTURE;
      else process.env.FLOW_FIXTURE = prev;
    }
  });

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

import { describe, expect, it, vi } from "vitest";
import type { IntradayAssemblyTrace } from "../intradayEvidence";
import type { Bar6 } from "../intradayShared";

// Consumer acceptance stays RED until the existing route actually carries its evidence.
// This test does not change the route, inject a production provider, or bypass an auth gate.
const fixture = vi.hoisted(() => ({
  epoch: Date.UTC(2026, 5, 15, 9, 30) / 1000,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ intradayFixture: async () => null }));
vi.mock("@/lib/intradaySources", async (original) => ({
  ...await original<typeof import("@/lib/intradaySources")>(),
  fetchIntraday: async () => [],
}));
vi.mock("@/lib/intradayStore", () => ({
  withStoredHistory: async (_sym: string, _tf: string, _ext: boolean, _live: Bar6[],
    capture?: (trace: IntradayAssemblyTrace) => void) => {
    capture?.({ origins: [[fixture.epoch, "stored_1h"]], storeReads: [
      { base: "5m", status: "missing", content_sha256: null },
      { base: "1h", status: "available", content_sha256: "a".repeat(64) },
    ] });
    return [[fixture.epoch, 100, 102, 99, 101, 50]];
  },
}));
import { GET } from "@/app/api/intraday/route";

describe("existing intraday API source-evidence consumer", () => {
  it("discloses a provider-hourly fallback without changing the returned candle", async () => {
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "0");
    vi.stubEnv("FLOW_FIXTURE", "0");
    try {
      const response = await GET(new Request("https://unit.test/api/intraday?sym=LINEAGE&tf=4h&date=2026-06-15"));
      const body = await response.json();
      expect(body.bars).toEqual([[fixture.epoch, 100, 102, 99, 101, 50]]);
      expect(body.source_evidence, "The actual route must consume the assembly trace, not just export an unused helper")
        .toBeDefined();
      expect(body.source_evidence.construction).toBe("stored_1h");
      expect(body.source_evidence.source_counts.stored_1h).toBe(1);
      expect(body.source_evidence.response_scope.requested_date).toBe("2026-06-15");
      expect(body.source_evidence.research_admission).toBe("not_assessed");
      expect(body.source_evidence.warnings).toContain("provider_hourly_open_alignment_not_guaranteed");
      expect(body.source_evidence).not.toHaveProperty("origins");
    } finally { vi.unstubAllEnvs(); }
  });
});

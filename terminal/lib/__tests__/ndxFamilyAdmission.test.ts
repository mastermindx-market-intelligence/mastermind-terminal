import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUnadmittedGexFamilyArtifact } from "@/lib/ndxFamilyAdmission";
import { loadFlowFreshResult, tryFetchUpstream, tryFetchUpstreamResult } from "@/lib/flowSource";
import { R2_BASE } from "@/lib/upstreams";

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: true }),
  tooMany: () => new Response("rate limited", { status: 429 }),
}));
vi.mock("@/lib/entitlement", () => ({ getLiveOptionsAccess: async () => "allowed" }));
vi.mock("@/lib/optionsAlphaCandidatePair", () => ({
  fetchOptionsAlphaCandidatePair: async () => ({}),
}));

const session = "2026-10-23";
const ordinary = (root = "SPY") => ({
  schema: "options_hub.gex/v1", root, asof: session,
  net_gex_bn: 0.24, by_strike: [{ strike: 580, net: 24 }],
});
const candidate = (patch: Record<string, unknown> = {}) => ({
  ...ordinary("NDX"),
  family_source: {
    schema: "mastermind.index_options_family_source.v1",
    root: "NDX", source_roots: ["NDX", "NDXP"], session,
    root_contract_counts: { NDX: 3, NDXP: 2 },
    historical_first_available_at: null, complete_chain_receipt: false,
    redistribution_grant: null, projection_state: "unavailable_root_identity_not_bound_to_v2",
    state: "OFFLINE_SOURCE_QUALIFIED_NOT_PUBLISHABLE",
  },
  ...patch,
});
type Answer = number | Record<string, unknown>;
function upstreams(backend: Answer, r2: Answer) {
  const send = vi.fn(async (input: RequestInfo | URL) => {
    const value = String(input).startsWith(R2_BASE) ? r2 : backend;
    if (typeof value === "number") return new Response("{}", { status: value });
    return Response.json(value);
  });
  vi.stubGlobal("fetch", send);
  return send;
}
let savedFixture: string | undefined;
beforeEach(() => {
  savedFixture = process.env.FLOW_FIXTURE;
  delete process.env.FLOW_FIXTURE;
});
afterEach(() => {
  if (savedFixture === undefined) delete process.env.FLOW_FIXTURE;
  else process.env.FLOW_FIXTURE = savedFixture;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NDX+NDXP family source-admission boundary", () => {
  it("rejects the producer's actual offline state, unknown versions and malformed markers", () => {
    const current = candidate();
    expect(isUnadmittedGexFamilyArtifact("gex:NDX", current)).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gex_at:NDX:" + session, current)).toBe(true);
    for (const family_source of [
      null, [], {}, { schema: "future.family.v9", redistribution_grant: true },
      { source_roots: ["NDX"] }, { source_roots: ["NDX", "QQQ"] },
      { source_roots: ["NDX", "NDXP"], complete_chain_receipt: true },
    ]) {
      expect(isUnadmittedGexFamilyArtifact("gex:NDX", candidate({ family_source }))).toBe(true);
    }
    expect(isUnadmittedGexFamilyArtifact("gex:SPY", candidate({ root: "SPY" }))).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gex:NDX", candidate({ asof: "2030-01-01" }))).toBe(true);
  });

  it("does not alter unrelated root feeds or native single-root GEX without a family marker", () => {
    expect(isUnadmittedGexFamilyArtifact("gex:NDX", ordinary("NDX"))).toBe(false);
    expect(isUnadmittedGexFamilyArtifact("gex:SPY", ordinary())).toBe(false);
    expect(isUnadmittedGexFamilyArtifact("gex_dates:NDX", candidate())).toBe(false);
    expect(isUnadmittedGexFamilyArtifact("vol:NDX", candidate())).toBe(false);
  });

  it("refuses a backend family candidate before R2 could substitute a valid-looking NDX body", async () => {
    const fetchMock = upstreams(candidate(), ordinary("NDX"));
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses the R2 family candidate after backend miss; no acquired bytes identity escapes", async () => {
    const fetchMock = upstreams(503, candidate());
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await tryFetchUpstream("gex:NDX")).toBeNull();
  });

  it("refuses dated GEX and a wrong-root family marker, without proven absence", async () => {
    upstreams(candidate(), 404);
    expect(await tryFetchUpstreamResult("gex_at:NDX:" + session)).toEqual({ status: "unavailable" });
    upstreams(candidate({ root: "QQQ" }), ordinary("NDX"));
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable" });
  });

  it("permits ordinary SPY and NDX single-root payloads with the old transport semantics", async () => {
    upstreams(ordinary(), 404);
    expect(await tryFetchUpstreamResult("gex:SPY")).toEqual({ status: "data", data: ordinary() });
    upstreams(ordinary("NDX"), 404);
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "data", data: ordinary("NDX") });
    upstreams(503, ordinary());
    const result = await tryFetchUpstreamResult("gex:SPY");
    expect(result.status).toBe("data");
    if (result.status === "data") {
      expect(result.data.by_strike).toEqual(ordinary().by_strike);
      expect(result.data.root).toBe("SPY");
    }
    upstreams(503, 404);
    expect(await tryFetchUpstreamResult("gex:SPY")).toEqual({ status: "absent" });
  });

  it("feeds the shared stream source only unavailable, never a data object", async () => {
    upstreams(candidate(), ordinary("NDX"));
    expect(await loadFlowFreshResult("gex:NDX")).toEqual({ status: "unavailable" });
  });
});

describe("real /api/flow GET admission", () => {
  const request = (f: string) => new Request("http://localhost:3108/api/flow?f=" + encodeURIComponent(f));
  const get = async () => {
    vi.resetModules();
    return (await import("@/app/api/flow/route")).GET;
  };

  it("responds 503/no-store to live offline-family candidate, not 200 or misleading 404", async () => {
    const fetchMock = upstreams(candidate(), ordinary("NDX"));
    const res = await (await get())(request("gex:NDX"));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "feed unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("responds 503/no-store to dated and R2-only family candidates", async () => {
    upstreams(503, candidate());
    const res = await (await get())(request("gex_at:NDX:" + session));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "feed unavailable" });
  });

  it("preserves a real standard SPY root's HTTP 200 and value", async () => {
    upstreams(ordinary(), 404);
    const res = await (await get())(request("gex:SPY"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ordinary());
  });
});

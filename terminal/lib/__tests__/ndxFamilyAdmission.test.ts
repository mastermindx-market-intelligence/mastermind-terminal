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
type Answer = number | Record<string, unknown> | unknown[];
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
    expect(isUnadmittedGexFamilyArtifact("gex:SPX", ordinary("SPX"))).toBe(false);
    expect(isUnadmittedGexFamilyArtifact("gex:NDX", [candidate()])).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gex:SPY", [])).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gexstate:NDX", candidate())).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gexstate_index", candidate())).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gex_dates:NDX", candidate())).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gex_dates:NDX", ["2026-10-22", "2026-10-23"])).toBe(false);
    expect(isUnadmittedGexFamilyArtifact("gex_dates:NDX", [{ family_source: null }])).toBe(true);
    expect(isUnadmittedGexFamilyArtifact("gexstate_index", [{root:"NDX"}, {root:"NDXP"}])).toBe(false);
    expect(isUnadmittedGexFamilyArtifact("gexstate:SPY", ordinary())).toBe(false);
    expect(isUnadmittedGexFamilyArtifact("vol:NDX", candidate())).toBe(false);
  });

  it("refuses a backend family candidate before R2 could substitute a valid-looking NDX body", async () => {
    const fetchMock = upstreams(candidate(), ordinary("NDX"));
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable", refusal: "unadmitted_gex_family" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses the R2 family candidate after backend miss; no acquired bytes identity escapes", async () => {
    const fetchMock = upstreams(503, candidate());
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable", refusal: "unadmitted_gex_family" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await tryFetchUpstream("gex:NDX")).toBeNull();
  });

  it("refuses dated GEX and a wrong-root family marker, without proven absence", async () => {
    upstreams(candidate(), 404);
    expect(await tryFetchUpstreamResult("gex_at:NDX:" + session)).toEqual({ status: "unavailable", refusal: "unadmitted_gex_family" });
    upstreams(candidate({ root: "QQQ" }), ordinary("NDX"));
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable", refusal: "unadmitted_gex_family" });
  });

  it("refuses state and index family markers before any GEX read becomes data", async () => {
    const body = candidate({ net_gex_bn: 1.5 });
    for (const f of ["gexstate:NDX", "gexstate_index", "gex_dates:NDX"]) {
      const fetchMock = upstreams(body, ordinary("NDX"));
      expect(await tryFetchUpstreamResult(f)).toEqual({
        status: "unavailable", refusal: "unadmitted_gex_family",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await loadFlowFreshResult(f)).toEqual({
        status: "unavailable", refusal: "unadmitted_gex_family",
      });
    }
  });

  it("refuses array-wrapped GEX family payloads through both backend and R2", async () => {
    let fetchMock = upstreams([candidate()], ordinary("NDX"));
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable", refusal: "unadmitted_gex_family" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock = upstreams(503, [candidate()]);
    expect(await tryFetchUpstreamResult("gex:NDX")).toEqual({ status: "unavailable", refusal: "unadmitted_gex_family" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(await loadFlowFreshResult("gex:NDX")).toEqual({ status: "unavailable", refusal: "unadmitted_gex_family" });
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

  it("does not serve or cache array-wrapped offline family JSON as HTTP 200", async () => {
    const fetchMock = upstreams([candidate()], ordinary("NDX"));
    const handler = await get();
    for (let i = 0; i < 2; i++) {
      const res = await handler(request("gex:NDX"));
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "feed unavailable" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops stale NDX GEX SWR after the upstream changes to an offline family", async () => {
    let clock = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const fetchMock = upstreams(ordinary("NDX"), 404);
    const handler = await get();
    expect((await handler(request("gex:NDX"))).status).toBe(200);
    clock += 31_000;
    upstreams(candidate(), ordinary("NDX"));
    for (let i = 0; i < 3; i++) {
      const result = await handler(request("gex:NDX"));
      expect(result.status).toBe(503);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.json()).toEqual({ error: "feed unavailable" });
      clock += 31_000;
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves stale single-root GEX during a transient outage, not a family refusal", async () => {
    let clock = 1_800_000_100_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    upstreams(ordinary("SPY"), 404);
    const handler = await get();
    expect((await handler(request("gex:SPY"))).status).toBe(200);
    clock += 31_000;
    upstreams(503, 503);
    const stale = await handler(request("gex:SPY"));
    expect(stale.status).toBe(200);
    expect((await stale.json()).stale).toBe(true);
  });

  it("returns 503 at real GET for a family-marked GEX state key", async () => {
    const fetchMock = upstreams(candidate({net_gex_bn:1.5}), ordinary("NDX"));
    const result = await (await get())(request("gexstate:NDX"));
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a real standard SPY root's HTTP 200 and value", async () => {
    upstreams(ordinary(), 404);
    const res = await (await get())(request("gex:SPY"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ordinary());
  });
});

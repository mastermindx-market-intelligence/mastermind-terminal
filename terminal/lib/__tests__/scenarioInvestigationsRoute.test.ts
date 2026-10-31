import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Focused route tests for the scenario owner binding AND the real source-preflight boundary:
// the actual exported Investigation route over controlled db/auth/source doubles, with the REAL
// private qualifyScenarioCaptureSave and Node verifier in the path. Ordinary controlled Vitest doubles only —
// no real database, so no production acceptance is claimed.
const { rpc, getUser, getSession } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, auth: { getUser, getSession } }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }) }));
import { GET, POST, PUT } from "@/app/api/investigations/route";
import { qualifyScenarioCaptureSave } from "@/lib/investigationScenarioServer";

const user = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const inv = "30000000-0000-4000-8000-000000000003";
const op = "40000000-0000-4000-8000-000000000004";

const BASIS_DIGEST = "b17d2f1a0c93e5d6a4b8f0e1d2c3a4b5968778695a4b3c2d1e0f9a8b7c6d5e4f";
const GEX_DIGEST = "5e4f3e2d3c4b5a69788796a5b4c3d2e1f0a19b8a7968594a3b2c1d0e9f8e7d6c";

/** A reference-only capture satisfying the frozen contract — exactly what the repaired UI posts. */
const REF = {
  schema: "investigation_scenario_reference.v1",
  model_version: "exposure-scenario/v1",
  inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
  source: {
    owner: "options_hub", root: "SPX", session: "2026-10-16",
    source_as_of: "2026-10-16T15:30:00Z", evaluated_at: "2026-10-16T15:45:00Z",
    lens: { kind: "one", exp: "2026-10-30" },
    selection_key: "2026-10-30|2026-10-30T21:00:00Z",
    basis_sha256: BASIS_DIGEST,
    gex: { sha256: GEX_DIGEST, byte_length: 2048 },
    moves: null,
  },
};
/** The REJECTED original payload: a full-value capture with basis and result. */
const FULL_VALUE = {
  schema: "investigation_scenario_capture.v1",
  model_version: "exposure-scenario/v1",
  basis: { root: "SPX", session: "2026-10-16", qualification: "qualified", referenceSpot: 600, gexMn: -1383, vexMn: null, cexMn: null, emPct: 1.2 },
  source_as_of: "2026-10-16T15:30:00Z",
  inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
  result: { totalMn: 184.70211915, moveFraction: 0.01, terms: { spotMn: 1, volMn: 2, timeMn: 3 }, missing: [] },
};

const manifest = (scenario_capture: unknown) => ({
  schema: "investigation_manifest.v2" as const,
  argument_relations: [],
  intent: { title: "Hedge demand at 600", question: "What does the ladder demand if spot slips?", subjects: [{ owner: "terminal.analysis_symbol", kind: "security" as const, object_id: "SPX" }] },
  layout_refs: [] as const,
  thesis_refs: [] as const,
  evidence_refs: [] as const,
  continuation: {},
  scenario_capture,
});
const scenarioCommand = { id: inv, operation_id: op, expected_revision: 0, action: "create" as const, manifest: manifest(REF) };
const removeCommand = { id: inv, operation_id: op, expected_revision: 1, action: "remove" as const, manifest: manifest(REF) };
const legacyManifest = { ...manifest(undefined) };
delete (legacyManifest as Record<string, unknown>).scenario_capture;
const legacyCommand = { id: inv, operation_id: op, expected_revision: 0, action: "create" as const, manifest: legacyManifest };

const committed=(command:{manifest:unknown},revision:number,lifecycle="active")=>({status:"committed",id:inv,revision,lifecycle,
 manifest:command.manifest,committed_at:"2026-10-16T20:00:00Z",investigation_id:inv,sequence:revision,
 revision_id:"50000000-0000-4000-8000-000000000005",operation_id:op,author_ref:user,
 parent_revision_id:revision===1?null:"60000000-0000-4000-8000-000000000006",recorded_at:"2026-10-16T20:00:00Z",manifest_digest:"a".repeat(64)});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("https://terminal.test/api/investigations", { method: "POST", headers, body: JSON.stringify(body) }));

beforeEach(() => {
  rpc.mockReset();
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "controlled-session" } }, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "unavailable", reason: "source_binding_unavailable" })));
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: user } }, error: null });
});

afterEach(() => vi.unstubAllGlobals());

describe("scenario owner binding and source preflight on the Investigation route", () => {
  it("refuses a scenario save without the owner header before any preflight or RPC", async () => {
    const response = await post(scenarioCommand);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a scenario save whose header names a different account: no write, no false commit", async () => {
    const response = await post(scenarioCommand, { "Content-Type": "application/json", "x-mm-scenario-owner": other });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("keeps authentication as the first gate: an anonymous scenario save is 401 before the header check", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await post(scenarioCommand, { "x-mm-scenario-owner": user })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect((await GET(new Request(`https://terminal.test/api/investigations?id=${inv}`))).status).toBe(401);
    expect((await GET(new Request(`https://terminal.test/api/investigations?id=${inv}`))).headers.get("cache-control")).toBe("private, no-store");
  });

  it("runs the REAL private preflight: absent native bindings refuse before apply", async () => {
    // The real default (no configured protected destination/current authorizer): ref authored
    // exactly as the repaired UI does, session user as principal.
    expect(await qualifyScenarioCaptureSave(REF, user)).toEqual({ ok: false, reason: "source_context_unavailable" });
    const response = await post(scenarioCommand, { "Content-Type": "application/json", "x-mm-scenario-owner": user });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable", reason: "source_unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a full-value scenario payload at the closed command parser before preflight or apply", async () => {
    expect(await qualifyScenarioCaptureSave(FULL_VALUE, user)).toEqual({ ok: false, reason: "invalid_source_reference" });
    const response = await post({ ...scenarioCommand, manifest: manifest(FULL_VALUE) }, { "Content-Type": "application/json", "x-mm-scenario-owner": user });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("remove/restore preserve the reference metadata without acquiring the source: no preflight refusal", async () => {
    rpc.mockResolvedValue({ data: committed(removeCommand,2,"removed"), error: null });
    const response = await post(removeCommand, { "Content-Type": "application/json", "x-mm-scenario-owner": user });
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0][0]).toBe("apply_investigation_revision_v2");
    expect((rpc.mock.calls[0][1] as Record<string, unknown>).p_action).toBe("remove");
    // The stored reference travels verbatim; the route never reads or resolves the source.
    const sent = (rpc.mock.calls[0][1] as { p_manifest: { scenario_capture?: unknown } }).p_manifest;
    expect(sent.scenario_capture).toEqual(REF);
  });

  it("keeps new non-scenario saves header-free and unchanged", async () => {
    rpc.mockResolvedValue({ data: committed(legacyCommand as typeof scenarioCommand,1), error: null });
    const response = await post(legacyCommand);
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0][0]).toBe("apply_investigation_revision_v2");
  });

  it("still binds reads to the session alone and refuses anonymous traffic before the database", async () => {
    rpc.mockResolvedValue({ data: { status: "not_found" }, error: null });
    const found = await GET(new Request(`https://terminal.test/api/investigations?id=${inv}&revision=1`));
    expect(found.status).toBe(404);
    expect(rpc.mock.calls[0]).toEqual(["read_investigation_v2", { p_id: inv, p_revision: 1 }]);
  });
});

it.each(["PUT","legacyPOST"])("keeps %s scenario recovery on the original full-request owner without source retention",async mode=>{
 const legacy={...scenarioCommand,manifest:{...scenarioCommand.manifest}} as typeof scenarioCommand&{manifest:Record<string,unknown>};
 delete (legacy.manifest as Record<string,unknown>).argument_relations;
 rpc.mockResolvedValue({data:{status:"not_applied",id:inv,operation_id:op},error:null});
 const request=new Request("https://terminal.test/api/investigations",{method:mode==="PUT"?"PUT":"POST",body:JSON.stringify(legacy)});
 const response=await (mode==="PUT"?PUT:POST)(request);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"not_applied",id:inv,operation_id:op});
 expect(rpc.mock.calls.map(([name])=>name)).toEqual(["reconcile_investigation_operation_v2"]);
 expect(rpc.mock.calls[0][1].p_manifest).toEqual(legacy.manifest);
 expect(getSession).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

/**
 * What the investigation code does while migrations 0042, 0047, 0052 and 0053 are NOT installed in
 * production and INVESTIGATION_V3_WRITES_OPEN is false. The database is a stand-in for the production
 * catalog read on 2026-11-10 (read-only): `valid_investigation_manifest_v2` = the 0040 body
 * (md5 16f7838c…), and `investigation_evidence_admitted_v2`, `investigation_subject_admitted_v2` and
 * `valid_investigation_scenario_reference_v1` are ABSENT. FIXTURE results: the claim that the installed 0040
 * validator refuses Sector/Prophet shapes is carried by the real-engine PostgreSQL corpus test
 * `tests/test_investigation_postgres.py::test_full_paired_manifest_corpus_at_the_sql_admission_boundary`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, createClient } = vi.hoisted(() => ({
  rpc: vi.fn(), getUser: vi.fn(), createClient: vi.fn(async () => ({ rpc, auth: { getUser } })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));

import { GET, POST } from "@/app/api/investigations/route";
import { followState } from "@/lib/investigationFollow";
import { beginInvestigationSave, settleInvestigationSave } from "@/lib/investigationSave";
import { INVESTIGATION_V3_WRITES_OPEN, parseInvestigationCommand } from "@/lib/investigations";

const USER = "10000000-0000-4000-8000-000000000001";
const ID = "20000000-0000-4000-8000-000000000001";
const OP = "30000000-0000-4000-8000-000000000001";
const SHA = "a3573d7cefe87da155ef7575feb2071b4c32c9f562f42d5724b3ec54332d9eab";
const U = "https://terminal.test/api/investigations";
const missing = { message: 'function public.investigation_evidence_admitted_v2(owner => text, object_type => text) does not exist', code: "42883" };

const base = (schema: string, evidence: unknown[], extra: Record<string, unknown> = {}) => ({
  id: ID, operation_id: OP, expected_revision: 0, action: "create",
  manifest: {
    schema, intent: { title: "Financials leadership", question: "Is it supported by participation?", subjects: [{ kind: "sector", owner: "macro.sector", object_id: "xlf" }] },
    layout_refs: [], thesis_refs: [], evidence_refs: evidence, continuation: {}, ...extra,
  },
});
const sectorEvidence = [{ owner: "macro.sector", object_type: "sector_observation", object_id: "xlf", mode: "pinned", version_ref: "real-g1", fingerprint: SHA }];
const post = (body: unknown) => POST(new Request(U, { method: "POST", headers: { "x-mm-investigation-owner": USER }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("INVESTIGATION_API_ADMISSION", "open");
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); rpc.mockReset(); });

describe("admission probes while the probe functions are absent", () => {
  it("evidence probe answers 503 unavailable (no saved or admitted claim)", async () => {
    rpc.mockResolvedValue({ data: null, error: missing });
    const response = await GET(new Request(`${U}?admission=macro.sector:sector_observation`, { headers: { "x-mm-investigation-owner": USER } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("subject probe answers 503 unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { ...missing, message: "function public.investigation_subject_admitted_v2 does not exist" } });
    const response = await GET(new Request(`${U}?subject_admission=macro.sector:sector`, { headers: { "x-mm-investigation-owner": USER } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("a Sector probe without the actor fence is refused before any database call", async () => {
    const response = await GET(new Request(`${U}?admission=macro.sector:sector_observation`));
    expect(response.status).toBe(412);
    expect(await response.json()).toEqual({ status: "owner_mismatch" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saving a Sector reading against the installed (0040) validator", () => {
  it("the installed validator refuses the shape; the route answers 400 invalid_payload and the control reads rejected, never saved", async () => {
    rpc.mockResolvedValue({ data: { status: "invalid_payload" }, error: null });
    const body = base("investigation_manifest.v2", sectorEvidence);
    const response = await post(body);
    expect(response.status).toBe(400);
    const answer = await response.json();
    expect(answer).toEqual({ status: "invalid_payload" });
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["apply_investigation_revision_v2"]);
    const command = parseInvestigationCommand(body)!;
    const pending = beginInvestigationSave(USER, command, { phase: "idle" });
    const settled = settleInvestigationSave(pending, USER, answer);
    expect(settled).toMatchObject({ phase: "rejected", reason: "invalid_payload" });
    expect(settled.phase).not.toBe("committed");
  });
  it("a lost reply (route 503 / transport failure) stays uncertain, never saved and never failed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    const response = await post(base("investigation_manifest.v2", sectorEvidence));
    expect(response.status).toBe(503);
    const command = parseInvestigationCommand(base("investigation_manifest.v2", sectorEvidence))!;
    const settled = settleInvestigationSave(beginInvestigationSave(USER, command, { phase: "idle" }), USER, await response.json());
    expect(settled).toMatchObject({ phase: "uncertain" });
  });
});

describe("v3 writes are closed", () => {
  it("the gate is literally false and the parser refuses every v3 command", () => {
    expect(INVESTIGATION_V3_WRITES_OPEN).toBe(false);
    expect(parseInvestigationCommand(base("investigation_manifest.v3", sectorEvidence, { user_decision: { disposition: "watch", reason: "", decided_at: "2026-11-10T08:00:00Z", milestones: [] } }))).toBeNull();
  });
  it("a v3 POST is refused 400 before any database call", async () => {
    const response = await post(base("investigation_manifest.v3", sectorEvidence, { user_decision: { disposition: "watch", reason: "", decided_at: "2026-11-10T08:00:00Z", milestones: [] } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "invalid_payload" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("prophet.research evidence in a v2 command is refused by the registry before any database call", async () => {
    const prophet = [{ owner: "prophet.research", object_type: "today_selection", object_id: "o", mode: "pinned", version_ref: "v", fingerprint: SHA }];
    const response = await post(base("investigation_manifest.v2", prophet));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("Follow claims no notification: v3 gate closed, and with it forced open there is still no producer", () => {
    expect(followState()).toEqual({ state: "closed", reason: "v3_writes_closed", notificationClaimed: false });
    expect(followState(undefined, true)).toMatchObject({ state: "saved_preference_only", reason: "no_producer", notificationClaimed: false });
  });
});

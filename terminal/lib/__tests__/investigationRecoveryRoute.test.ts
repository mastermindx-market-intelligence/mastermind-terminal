import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvestigationCommand } from "../investigations";
import { beginInvestigationSave, investigationCommandToReconcile, retryInvestigationSave, settleInvestigationSave } from "../investigationSave";

// Keep the route, owner service and client recovery real; only external auth/RPC is stubbed.
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, auth: { getUser } }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }) }));
import { GET, POST, PUT } from "@/app/api/investigations/route";

const id = "10000000-0000-4000-8000-000000000001";
const operation = "20000000-0000-4000-8000-000000000001";
const otherOperation = "20000000-0000-4000-8000-000000000002";
const revision = "30000000-0000-4000-8000-000000000001";
const principal = "40000000-0000-4000-8000-000000000001";
const layout = "50000000-0000-4000-8000-000000000001";
const layoutRevision = "60000000-0000-4000-8000-000000000001";
const stamp = "2026-10-04T00:00:00Z";
const url = "https://terminal.test/api/investigations";
const command = (): InvestigationCommand => ({
  id, operation_id: operation, action: "create", expected_revision: 0,
  manifest: { schema: "investigation_manifest.v2", argument_relations: [],
    intent: { title: "Research", question: "Exact saved question", subjects: [] },
    layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} },
});
const receipt = (input = command()) => ({
  status: "committed", id, revision: 1, lifecycle: "active", manifest: input.manifest,
  committed_at: stamp, investigation_id: id, revision_id: revision, sequence: 1,
  parent_revision_id: null, operation_id: operation, author_ref: principal,
  recorded_at: stamp, manifest_digest: "a".repeat(64),
});
const request = (method: string, input: unknown) => new Request(url, { method, body: JSON.stringify(input) });

beforeEach(() => {
  rpc.mockReset(); getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: principal } }, error: null });
});

describe("Investigation API operation recovery", () => {
  it("rejects a well-formed receipt for a different operation on GET", async () => {
    rpc.mockResolvedValue({ data: { ...receipt(), operation_id: otherOperation }, error: null });
    const response = await GET(new Request(`${url}?operation_id=${operation}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(rpc.mock.calls).toEqual([["read_investigation_operation_v2", { p_operation_id: operation }]]);
  });

  for (const [method, route, owner] of [
    ["POST", POST, "apply_investigation_revision_v2"],
    ["PUT", PUT, "reconcile_investigation_operation_v2"],
  ] as const) {
    it.each([
      ["operation", { operation_id: otherOperation }],
      ["revision", { revision: 2, sequence: 2, parent_revision_id: revision }],
      ["lifecycle", { lifecycle: "removed" }],
      ["manifest", { manifest: { ...command().manifest, intent: { ...command().manifest.intent, question: "Different saved question" } } }],
    ])(`${method} rejects a valid receipt with the wrong %s`, async (_name, change) => {
      rpc.mockResolvedValue({ data: { ...receipt(), ...change }, error: null });
      const response = await route(request(method, command()));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "unavailable" });
      expect(rpc.mock.calls).toEqual([[owner, {
        p_id: id, p_expected_revision: 0, p_action: "create", p_operation_id: operation,
        p_manifest: command().manifest, p_layout_capture: null,
      }]]);
    });

    it(`${method} accepts the exact receipt with reordered JSON keys`, async () => {
      const input = command();
      const result = { ...receipt(), manifest: { ...input.manifest,
        intent: { subjects: [], question: "Exact saved question", title: "Research" } } };
      rpc.mockResolvedValue({ data: result, error: null });
      const response = await route(request(method, input));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
    });

    it(`${method} accepts the server-minted layout revision but refuses another layout`, async () => {
      const input = { ...command(), layout_capture: { layout_id: layout, expected_revision: 7 } };
      const result = { ...receipt(), manifest: { ...input.manifest,
        layout_refs: [{ layout_id: layout, layout_revision_id: layoutRevision, digest: "b".repeat(64), role: "primary" }] } };
      rpc.mockResolvedValue({ data: result, error: null });
      const accepted = await route(request(method, input));
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual(result);
      rpc.mockResolvedValue({ data: { ...result, manifest: { ...result.manifest,
        layout_refs: [{ layout_id: otherOperation, layout_revision_id: layoutRevision, digest: "b".repeat(64), role: "primary" }] } }, error: null });
      const refused = await route(request(method, input));
      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({ status: "unavailable" });
    });
  }

  it("preserves uncertainty and the original key until its committed receipt is recovered", async () => {
    const input = command();
    const pending = beginInvestigationSave(principal, input, { phase: "idle" });
    let state = settleInvestigationSave(pending, principal, null);
    rpc.mockResolvedValueOnce({ data: { ...receipt(), operation_id: otherOperation }, error: null })
      .mockResolvedValueOnce({ data: receipt(), error: null });
    const refused = await PUT(request("PUT", investigationCommandToReconcile(state, principal)));
    expect(refused.status).toBe(503);
    state = settleInvestigationSave(state, principal, await refused.json());
    expect(state.phase).toBe("uncertain");
    expect(retryInvestigationSave(state, principal)).toBeNull();
    expect(investigationCommandToReconcile(state, principal)).toEqual(input);
    const recovered = await PUT(request("PUT", investigationCommandToReconcile(state, principal)));
    expect(recovered.status).toBe(200);
    state = settleInvestigationSave(state, principal, await recovered.json());
    expect(state).toEqual({ phase: "committed", principal, result: receipt() });
    expect(rpc.mock.calls.map(([name, args]) => [name, args.p_operation_id])).toEqual([
      ["reconcile_investigation_operation_v2", operation], ["reconcile_investigation_operation_v2", operation],
    ]);
  });

  it("permits replacement only after the exact owner not-applied fence", async () => {
    const pending = beginInvestigationSave(principal, command(), { phase: "idle" });
    const uncertain = settleInvestigationSave(pending, principal, null);
    rpc.mockResolvedValueOnce({ data: { status: "not_applied", id, operation_id: otherOperation }, error: null })
      .mockResolvedValueOnce({ data: { status: "not_applied", id, operation_id: operation }, error: null });
    const wrongFence = await PUT(request("PUT", command()));
    expect(wrongFence.status).toBe(503);
    const held = settleInvestigationSave(uncertain, principal, await wrongFence.json());
    expect(retryInvestigationSave(held, principal)).toBeNull();
    const exactFence = await PUT(request("PUT", command()));
    expect(exactFence.status).toBe(200);
    const fenced = settleInvestigationSave(held, principal, await exactFence.json());
    const replacement = retryInvestigationSave(fenced, principal)!;
    expect(replacement.operation_id).not.toBe(operation);
    expect({ ...replacement, operation_id: operation }).toEqual(command());
  });

  it("returns the at-cap no-effect answer as final and never sends the original again", async () => {
    const uncertain = settleInvestigationSave(beginInvestigationSave(principal, command(), { phase: "idle" }), principal, null);
    const atCap = { status: "not_applied", id, operation_id: operation, reason: "limit_reached" };
    rpc.mockResolvedValueOnce({ data: { ...atCap, reason: "quota" }, error: null })
      .mockResolvedValueOnce({ data: atCap, error: null })
      .mockResolvedValueOnce({ data: { status: "limit_reached" }, error: null });
    // A reason this route does not know is not a fence.
    const unknown = await PUT(request("PUT", command()));
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toEqual({ status: "unavailable" });
    const final = await PUT(request("PUT", command()));
    expect(final.status).toBe(200);
    expect(await final.json()).toEqual(atCap);
    const limited = settleInvestigationSave(uncertain, principal, atCap);
    expect(limited).toEqual({ phase: "rejected", principal, command: command(), reason: "limit_reached" });
    expect(retryInvestigationSave(limited, principal)).toBeNull();
    // A new save is a new operation, and the cap refuses it too.
    const next = beginInvestigationSave(principal, { ...command(), operation_id: otherOperation }, limited);
    expect(next.phase).toBe("pending");
    const refused = await POST(request("POST", { ...command(), operation_id: otherOperation }));
    expect(refused.status).toBe(429);
    expect(settleInvestigationSave(next, principal, await refused.json())).toMatchObject({ phase: "rejected", reason: "limit_reached" });
    expect(rpc.mock.calls.map(([name, args]) => [name, args.p_operation_id])).toEqual([
      ["reconcile_investigation_operation_v2", operation], ["reconcile_investigation_operation_v2", operation],
      ["apply_investigation_revision_v2", otherOperation],
    ]);
  });

  it("reads and reconciles a pre-kernel receipt without fabricating wrapper identity", async () => {
    const manifest = command().manifest;
    delete manifest.argument_relations;
    const input = { ...command(), manifest };
    const legacy = { status: "committed", id, revision: 1, lifecycle: "active", manifest, committed_at: stamp };
    rpc.mockResolvedValue({ data: legacy, error: null });
    const read = await GET(new Request(`${url}?operation_id=${operation}`));
    expect(read.status).toBe(200); expect(await read.json()).toEqual(legacy);
    const recovered = await PUT(request("PUT", input));
    expect(recovered.status).toBe(200); expect(await recovered.json()).toEqual(legacy);
    rpc.mockResolvedValue({ data: { ...legacy, operation_id: otherOperation }, error: null });
    expect((await GET(new Request(`${url}?operation_id=${operation}`))).status).toBe(503);
    expect((await PUT(request("PUT", input))).status).toBe(503);
  });

  it("preserves the exact retained revision ID in a legacy capture recovery", async () => {
    const manifest = command().manifest;
    delete manifest.argument_relations;
    const input = { ...command(), manifest,
      layout_capture: { layout_id: layout, expected_revision: 7, revision_id: layoutRevision } };
    const legacy = { status: "committed", id, revision: 1, lifecycle: "active", committed_at: stamp,
      manifest: { ...manifest, layout_refs: [{ layout_id: layout, layout_revision_id: layoutRevision,
        digest: "b".repeat(64), role: "primary" }] } };
    rpc.mockResolvedValue({ data: legacy, error: null });
    const recovered = await PUT(request("PUT", input));
    expect(recovered.status).toBe(200); expect(await recovered.json()).toEqual(legacy);
    rpc.mockResolvedValue({ data: { ...legacy, manifest: { ...legacy.manifest,
      layout_refs: [{ ...legacy.manifest.layout_refs[0], layout_revision_id: otherOperation }] } }, error: null });
    expect((await PUT(request("PUT", input))).status).toBe(503);
  });

  it.each(["remove", "restore"] as const)("recovers the original %s commit at its own revision", async action => {
    const input = { ...command(), action, expected_revision: 8 };
    const result = { ...receipt(), revision: 9, sequence: 9, parent_revision_id: revision,
      lifecycle: action === "remove" ? "removed" : "active" };
    rpc.mockResolvedValue({ data: result, error: null });
    const recovered = await PUT(request("PUT", input));
    expect(recovered.status).toBe(200); expect(await recovered.json()).toEqual(result);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("reconcile_investigation_operation_v2");
  });
});

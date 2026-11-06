import { beforeEach, expect, it, vi } from "vitest";
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, auth: { getUser } }) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }) }));
import { GET } from "@/app/api/investigations/route";
import { beginInvestigationSave, settleInvestigationOperationRead, retryInvestigationSave } from "../investigationSave";
import { readInvestigationJournal, retainInvestigationJournal, clearRejectedInvestigationJournal } from "../investigationJournal";
import type { InvestigationCommand } from "../investigations";

const principal = "10000000-0000-4000-8000-000000000001", owner = `account:${principal}`;
const command: InvestigationCommand = { id: "20000000-0000-4000-8000-000000000002", operation_id: "30000000-0000-4000-8000-000000000003", expected_revision: 0, action: "create",
  manifest: { schema: "investigation_manifest.v2", intent: { title: "Original", question: "Exact draft", subjects: [] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} } };
const fence = () => ({ status: "not_applied", id: command.id, operation_id: command.operation_id });
const committed = () => ({ status: "committed", id: command.id, investigation_id: command.id, operation_id: command.operation_id, author_ref: principal,
  revision: 1, sequence: 1, revision_id: "40000000-0000-4000-8000-000000000004", parent_revision_id: null,
  lifecycle: "active", manifest: command.manifest, manifest_digest: "a".repeat(64), committed_at: "2026-11-05T01:00:00Z", recorded_at: "2026-11-05T01:00:00Z" });
const pending = () => beginInvestigationSave(owner, command, { phase: "idle" });
const storage = () => { const data = new Map<string,string>(); return { getItem: (k:string) => data.get(k) ?? null, setItem: (k:string,v:string) => { data.set(k,v); }, removeItem: (k:string) => { data.delete(k); } }; };
async function read(data:unknown) {
  rpc.mockResolvedValue({ data, error: null });
  const response = await GET(new Request(`https://terminal.test/api/investigations?operation_id=${command.operation_id}`));
  return { response, value: await response.json() };
}
beforeEach(() => { rpc.mockReset(); getUser.mockReset(); getUser.mockResolvedValue({ data: { user: { id: principal } }, error: null }); });

it("projects the native durable fence through authenticated GET into original-draft NO_EFFECT without mutation", async () => {
  const { response, value } = await read(fence());
  expect(response.status).toBe(200);
  expect(value).toEqual({ ...fence(), read_principal: principal, read_operation_id: command.operation_id, read_binding: "stored_no_effect" });
  const settled = settleInvestigationOperationRead(pending(), owner, value);
  expect(settled).toMatchObject({ phase: "rejected", reason: "not_applied", command });
  expect(retryInvestigationSave(settled, owner)).toBeNull();
  expect(rpc.mock.calls).toEqual([["read_investigation_operation_v2", { p_operation_id: command.operation_id }]]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("binds a completed read to the original operation, principal, manifest and revision lineage", async () => {
  const { value } = await read(committed());
  expect(settleInvestigationOperationRead(pending(), owner, value)).toMatchObject({ phase: "committed", receiptBinding: "native_lineage" });
  for (const changed of [
    { ...value, operation_id: command.id }, { ...value, read_principal: command.id },
    { ...value, read_operation_id: command.id },
    { ...value, author_ref: command.id }, { ...value, parent_revision_id: command.id },
    { ...value, manifest: { ...command.manifest, intent: { ...command.manifest.intent, question: "Other draft" } } },
    { ...value, revision: 2, sequence: 2, parent_revision_id: command.id },
  ]) expect(settleInvestigationOperationRead(pending(), owner, changed).phase).toBe("uncertain");
});

it("preserves the exact supported legacy completed receipt without inventing 0030 lineage", async () => {
  const native = { status: "committed", id: command.id, revision: 1, lifecycle: "active", manifest: command.manifest, committed_at: "2026-11-05T01:00:00Z" };
  const { response, value } = await read(native);
  expect(response.status).toBe(200);
  expect(settleInvestigationOperationRead(pending(), owner, value)).toMatchObject({ phase: "committed", receiptBinding: "legacy_recorded_completion" });
  expect(settleInvestigationOperationRead(pending(), owner, { ...value, read_binding: "native_lineage" }).phase).toBe("uncertain");
  expect(value).not.toHaveProperty("parent_revision_id"); expect(value).not.toHaveProperty("manifest_digest");
  for (const data of [{ ...native, operation_id: command.operation_id }, { ...native, parent_revision_id: null }]) {
    expect((await read(data)).response.status).toBe(503);
  }
});

it("never makes a bare label, capacity result, miss or possible later completion into NO_EFFECT", async () => {
  for (const data of [{ status: "not_applied" }, { ...fence(), reason: "limit_reached" }, { status: "not_found" }, { status: "pending" }]) {
    const { value } = await read(data);
    const settled = settleInvestigationOperationRead(pending(), owner, value);
    expect(settled.phase).toBe("uncertain");
    expect(retryInvestigationSave(settled, owner)).toEqual(command);
  }
  expect(rpc.mock.calls.every(([name]) => name === "read_investigation_operation_v2")).toBe(true);
});

it("rejects malformed native read lineage before emitting a successful GET", async () => {
  for (const data of [{ ...committed(), operation_id: command.id }, { ...committed(), author_ref: command.id },
    { ...committed(), parent_revision_id: command.id }, { ...committed(), revision: 2, sequence: 2 },
    { ...committed(), manifest_digest: "wrong" }, { ...committed(), recorded_at: "2026-11-06T01:00:00Z" }]) {
    const { response, value } = await read(data);
    expect(response.status).toBe(503); expect(value).toEqual({ status: "unavailable" });
  }
});

it("keeps the original local journal inconclusive after reload and needs the live bound fence for deliberate replacement", async () => {
  const store = storage(); retainInvestigationJournal(store, owner, command);
  const found = readInvestigationJournal(store, owner);
  expect(found).toMatchObject({ status: "retained", state: { phase: "uncertain" } });
  expect(() => clearRejectedInvestigationJournal(store, owner)).toThrow();
  const { value } = await read(fence());
  const settled = settleInvestigationOperationRead(pending(), owner, value);
  clearRejectedInvestigationJournal(store, owner, settled);
  expect(readInvestigationJournal(store, owner).status).toBe("empty");
});

it("does not poll a miss or infer that an original operation cannot complete later", async () => {
  rpc.mockResolvedValueOnce({ data: { status: "not_found" }, error: null }).mockResolvedValueOnce({ data: committed(), error: null });
  const url = `https://terminal.test/api/investigations?operation_id=${command.operation_id}`;
  const first = await GET(new Request(url));
  const unknown = settleInvestigationOperationRead(pending(), owner, await first.json());
  expect(unknown.phase).toBe("uncertain"); expect(rpc).toHaveBeenCalledTimes(1);
  const later = await GET(new Request(url)); // a separate deliberate read, never a mutation
  expect(settleInvestigationOperationRead(unknown, owner, await later.json()).phase).toBe("committed");
  expect(rpc.mock.calls).toEqual(Array(2).fill(["read_investigation_operation_v2", { p_operation_id: command.operation_id }]));
});

it("refuses local, foreign or other-operation claims when changing the retained draft", async () => {
  const store = storage(); retainInvestigationJournal(store, owner, command);
  const { value } = await read(fence());
  const live = settleInvestigationOperationRead(pending(), owner, value);
  expect(live.phase).toBe("rejected");
  if (live.phase !== "rejected") throw Error("fixture must be rejected");
  for (const changed of [{ ...live, principal: command.id }, { ...live, command: { ...command, operation_id: command.id } }]) {
    expect(() => clearRejectedInvestigationJournal(store, owner, changed)).toThrow();
  }
  const key = `mm.investigation.pending.v2:${encodeURIComponent(owner)}`;
  store.setItem(key, JSON.stringify({ owner, command, phase: "rejected", reason: "not_applied" }));
  expect(readInvestigationJournal(store, owner)).toMatchObject({ status: "retained", state: { phase: "uncertain" } });
  expect(() => clearRejectedInvestigationJournal(store, owner)).toThrow();
  retainInvestigationJournal(store, owner, { ...command, operation_id: command.id }, live);
  expect(readInvestigationJournal(store, owner)).toMatchObject({ status: "retained", state: { phase: "uncertain", command: { operation_id: command.id } } });
});

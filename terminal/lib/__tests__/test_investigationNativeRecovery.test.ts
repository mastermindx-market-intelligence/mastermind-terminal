// P12.T11.S17.S4 — source tests for the native-owner receipt read interface in
// ../investigations: parseInvestigationNativeReceipt and
// readInvestigationNativeOperation only. Fakes are limited to db.rpc; only the
// read-only RPC names are asserted and no capture/apply/reconcile path runs.
import { describe, expect, it } from "vitest";
import {
  investigationCanonicalRequest,
  parseInvestigationCommand,
  parseInvestigationNativeReceipt,
  readInvestigationNativeOperation,
  type InvestigationCommand,
  type InvestigationDb,
} from "../investigations";

const principal = "10000000-0000-4000-8000-000000000001";
const owner = `account:${principal}`;
const otherPrincipal = "10000000-0000-4000-8000-000000000009";

const fixtureCommandRaw = {
  id: "20000000-0000-4000-8000-000000000002",
  operation_id: "30000000-0000-4000-8000-000000000003",
  expected_revision: 0,
  action: "create" as const,
  manifest: {
    schema: "investigation_manifest.v2" as const,
    intent: { title: "Original", question: "After possible private PUT", subjects: [] },
    layout_refs: [],
    thesis_refs: [],
    evidence_refs: [],
    continuation: {},
    scenario_capture: {
      schema: "investigation_scenario_reference.v1",
      model_version: "exposure-scenario/v1",
      inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
      source: {
        owner: "options_hub",
        root: "SPX",
        session: "2026-10-16",
        source_as_of: "2026-10-16t15:30:00z",
        evaluated_at: "2026-10-16T15:45:00Z",
        lens: { kind: "one", exp: "2026-10-30" },
        selection_key:
          "2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",
        basis_sha256: "a".repeat(64),
        gex: { sha256: "b".repeat(64), byte_length: 2048 },
        moves: null,
      },
    },
  },
};

const command: InvestigationCommand = parseInvestigationCommand(fixtureCommandRaw)!;

const baseBinding = () => ({
  actor: principal,
  operation_id: command.operation_id,
  issuer: "https://auth.example.supabase.co/auth/v1",
  auth_epoch: "40000000-0000-4000-8000-000000000004",
  request_sha256: "c".repeat(64),
  source_binding_sha256: "d".repeat(64),
});

const baseRaw = (
  cmd: InvestigationCommand = command,
  overrides: { native_phase?: string; canonical_status?: string } = {},
) => ({
  status: "found",
  schema: "investigation.native_capture.v1",
  id: cmd.id,
  binding: baseBinding(),
  generation: "50000000-0000-4000-8000-000000000005",
  native_phase: overrides.native_phase ?? "started",
  canonical_status: overrides.canonical_status ?? "pending",
  // RPC JSON decoding creates independent memory, never aliases the original command.
  request: JSON.parse(JSON.stringify(investigationCanonicalRequest(cmd, principal))),
});

type RpcCall = { name: string; args: Record<string, unknown> };
const readOnlyDb = (nativeData: unknown, canonicalData: unknown) => {
  const calls: RpcCall[] = [];
  const db: InvestigationDb = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "read_investigation_native_capture_v1") return { data: nativeData, error: null };
      if (name === "read_investigation_operation_v2") return { data: canonicalData, error: null };
      throw new Error(`unexpected rpc request: ${name}`);
    },
  };
  return { db, calls };
};

const expectAccepted = (raw: unknown) => {
  const parsed = parseInvestigationNativeReceipt(raw, command, principal);
  if (!parsed) throw new Error("expected the controlled receipt to be accepted");
  return parsed;
};

describe("parseInvestigationNativeReceipt", () => {
  it("accepts the started/pending controlled receipt as a detached deep copy", () => {
    const raw = baseRaw();
    const parsed = expectAccepted(raw);
    expect(parsed).toEqual(raw);
    expect(parsed).not.toBe(raw);
    expect(parsed.binding).not.toBe(raw.binding);
    expect(parsed.request).not.toBe(raw.request);
    // Historical epoch is a row fact: a valid UUID is accepted even though the
    // fresh reader has no obligation to match it.
    expect(parsed.binding.auth_epoch).toBe("40000000-0000-4000-8000-000000000004");
    // The full original canonical request is preserved, with explicit layout_capture:null.
    expect(parsed.request.layout_capture).toBeNull();
    expect(Object.keys(parsed.request)).toEqual([
      "principal", "action", "target", "expected_revision", "manifest", "layout_capture",
    ]);
    expect(parsed.request.principal).toBe(principal);
    expect(parsed.request.action).toBe("create");
    expect(parsed.request.target).toBe(command.id);
    expect(parsed.request.expected_revision).toBe(0);
    expect(parsed.request.manifest).toEqual(command.manifest);
  });

  it("accepts retained terminal producers (committed and not_applied)", () => {
    const committed = expectAccepted(baseRaw(command, { native_phase: "retained", canonical_status: "committed" }));
    expect(committed.native_phase).toBe("retained");
    expect(committed.canonical_status).toBe("committed");
    const notApplied = expectAccepted(baseRaw(command, { native_phase: "retained", canonical_status: "not_applied" }));
    expect(notApplied.canonical_status).toBe("not_applied");
  });

  it("refuses a missing or an extra top-level field", () => {
    const missing = baseRaw() as Record<string, unknown>;
    delete missing.generation;
    expect(parseInvestigationNativeReceipt(missing, command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), capture_note: "extra" }, command, principal)).toBeNull();
  });

  it("refuses non-object payloads", () => {
    expect(parseInvestigationNativeReceipt(null, command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt([baseRaw()], command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt("found", command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt(8, command, principal)).toBeNull();
  });

  it("refuses another investigation id or wrong envelope markers", () => {
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), id: "20000000-0000-4000-8000-000000000099" }, command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), status: "ok" }, command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), schema: "investigation.native_capture.v2" }, command, principal)).toBeNull();
  });

  it("refuses unknown native_phase and canonical_status values", () => {
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), native_phase: "applied" }, command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), canonical_status: "applied" }, command, principal)).toBeNull();
    // Parent source had already removed String(...) coercion before cc4b froze.
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), canonical_status: ["pending"] }, command, principal)).toBeNull();
  });

  it("refuses a committed canonical status on a started producer", () => {
    expect(parseInvestigationNativeReceipt(baseRaw(command, { native_phase: "started", canonical_status: "committed" }), command, principal)).toBeNull();
  });

  it("refuses an account-prefixed owner or a different binding actor", () => {
    expect(parseInvestigationNativeReceipt(baseRaw(), command, owner)).toBeNull();
    const mismatched = baseRaw();
    (mismatched.binding as Record<string, unknown>).actor = otherPrincipal;
    expect(parseInvestigationNativeReceipt(mismatched, command, principal)).toBeNull();
  });

  it("refuses a mismatched binding operation_id", () => {
    const raw = baseRaw();
    (raw.binding as Record<string, unknown>).operation_id = "30000000-0000-4000-8000-000000000099";
    expect(parseInvestigationNativeReceipt(raw, command, principal)).toBeNull();
  });

  it("refuses a stored request that differs in any canonical field", () => {
    const wrongTarget = baseRaw();
    (wrongTarget.request as Record<string, unknown>).target = "20000000-0000-4000-8000-000000000099";
    expect(parseInvestigationNativeReceipt(wrongTarget, command, principal)).toBeNull();

    const wrongRevision = baseRaw();
    (wrongRevision.request as Record<string, unknown>).expected_revision = 1;
    expect(parseInvestigationNativeReceipt(wrongRevision, command, principal)).toBeNull();

    const wrongAction = baseRaw();
    (wrongAction.request as Record<string, unknown>).action = "revise";
    expect(parseInvestigationNativeReceipt(wrongAction, command, principal)).toBeNull();
  });

  it("refuses a full-manifest substitution inside the stored request", () => {
    const tampered = baseRaw();
    const manifest = (tampered.request as Record<string, unknown>).manifest as Record<string, unknown>;
    (manifest.intent as Record<string, unknown>).title = "Tampered";
    expect(parseInvestigationNativeReceipt(tampered, command, principal)).toBeNull();

    const widened = baseRaw();
    (widened.request as Record<string, unknown>).manifest = { ...command.manifest, extra_key: 1 };
    expect(parseInvestigationNativeReceipt(widened, command, principal)).toBeNull();
  });

  it("requires the explicit layout_capture:null field", () => {
    const replaced = baseRaw();
    (replaced.request as Record<string, unknown>).layout_capture = {
      layout_id: "60000000-0000-4000-8000-000000000006",
      expected_revision: 1,
      revision_id: "70000000-0000-4000-8000-000000000007",
    };
    expect(parseInvestigationNativeReceipt(replaced, command, principal)).toBeNull();

    const missing = baseRaw();
    delete (missing.request as Record<string, unknown>).layout_capture;
    expect(parseInvestigationNativeReceipt(missing, command, principal)).toBeNull();
  });

  it("refuses binding objects with a missing or extra field", () => {
    const missing = baseRaw();
    delete (missing.binding as Record<string, unknown>).issuer;
    expect(parseInvestigationNativeReceipt(missing, command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt(
      { ...baseRaw(), binding: { ...baseBinding(), session_index: 7 } },
      command, principal,
    )).toBeNull();
  });

  it("refuses a malformed issuer, auth_epoch, or digest field", () => {
    const bad = (binding: Record<string, unknown>) => ({ ...baseRaw(), binding: { ...baseBinding(), ...binding } });
    expect(parseInvestigationNativeReceipt(bad({ issuer: "http://auth.example.supabase.co/auth/v1" }), command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt(bad({ issuer: "https://auth.example.supabase.co/auth/v1/" }), command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt(bad({ issuer: "https://Auth.Example.Supabase.Co/auth/v1" }), command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt(bad({ auth_epoch: "epoch-1" }), command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt(bad({ request_sha256: "C".repeat(64) }), command, principal)).toBeNull();
    expect(parseInvestigationNativeReceipt(bad({ source_binding_sha256: "d".repeat(63) }), command, principal)).toBeNull();
  });

  it("refuses a non-UUID generation", () => {
    expect(parseInvestigationNativeReceipt({ ...baseRaw(), generation: "generation-1" }, command, principal)).toBeNull();
  });
});

describe("readInvestigationNativeOperation", () => {
  it("performs only the native read for a pending producer, with the exact full canonical request", async () => {
    const { db, calls } = readOnlyDb(baseRaw(), null);
    const result = await readInvestigationNativeOperation(db, fixtureCommandRaw, principal);
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected a found native receipt");
    expect(result.read_binding).toBe("native_participant");
    expect(result.read_principal).toBe(principal);
    expect(result.read_operation_id).toBe(command.operation_id);
    // Separate observations: a canonical receipt cannot settle a started producer.
    expect(result.canonical).toEqual({ status: "unavailable" });
    expect(calls.map((call) => call.name)).toEqual(["read_investigation_native_capture_v1"]);
    expect(Object.keys(calls[0].args)).toEqual(["p_operation_id", "p_request"]);
    expect(calls[0].args.p_operation_id).toBe(command.operation_id);
    expect(calls[0].args.p_request).toEqual(investigationCanonicalRequest(command, principal));
    expect((calls[0].args.p_request as Record<string, unknown>).layout_capture).toBeNull();
    expect((calls[0].args.p_request as Record<string, unknown>).manifest).toEqual(command.manifest);
  });

  it("adds the canonical read for a retained terminal producer", async () => {
    const legacyCommitted = {
      status: "committed",
      id: command.id,
      revision: 1,
      lifecycle: "active",
      manifest: command.manifest,
      committed_at: "2026-10-16T15:45:00Z",
    };
    const { db, calls } = readOnlyDb(
      baseRaw(command, { native_phase: "retained", canonical_status: "committed" }),
      legacyCommitted,
    );
    const result = await readInvestigationNativeOperation(db, fixtureCommandRaw, principal);
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected a found native receipt");
    expect(result.native_phase).toBe("retained");
    const canonical = result.canonical;
    if (canonical.status !== "committed") throw new Error("expected a terminal canonical read");
    // The exact binding label belongs to the receipt classifier in
    // investigationOperationReceipt, outside this task's scope; both labels are
    // read-only terminal completions and neither mutates anything.
    expect(["native_lineage", "legacy_recorded_completion"]).toContain(canonical.read_binding);
    expect(calls.map((call) => call.name)).toEqual([
      "read_investigation_native_capture_v1",
      "read_investigation_operation_v2",
    ]);
    expect(calls[1].args).toEqual({ p_operation_id: command.operation_id });
  });

  it("preserves the stored no-effect miss for a retained not_applied producer", async () => {
    const { db, calls } = readOnlyDb(
      baseRaw(command, { native_phase: "retained", canonical_status: "not_applied" }),
      { status: "not_found" },
    );
    const result = await readInvestigationNativeOperation(db, fixtureCommandRaw, principal);
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected a found native receipt");
    expect(result.canonical).toEqual({ status: "not_found" });
    expect(calls.map((call) => call.name)).toEqual([
      "read_investigation_native_capture_v1",
      "read_investigation_operation_v2",
    ]);
  });

  it("preserves an explicit not_found miss and refuses malformed capture payloads", async () => {
    const miss = readOnlyDb({ status: "not_found" }, null);
    expect(await readInvestigationNativeOperation(miss.db, fixtureCommandRaw, principal)).toEqual({ status: "not_found" });
    const widened = readOnlyDb({ status: "not_found", detail: "duplicate" }, null);
    expect(await readInvestigationNativeOperation(widened.db, fixtureCommandRaw, principal)).toEqual({ status: "unavailable" });
    const malformed = readOnlyDb({ status: "found" }, null);
    expect(await readInvestigationNativeOperation(malformed.db, fixtureCommandRaw, principal)).toEqual({ status: "unavailable" });
  });

  it("reports unavailable on an rpc error without a canonical follow-up", async () => {
    const calls: RpcCall[] = [];
    const db: InvestigationDb = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: null, error: { message: "boom" } };
      },
    };
    expect(await readInvestigationNativeOperation(db, fixtureCommandRaw, principal)).toEqual({ status: "unavailable" });
    expect(calls.map((call) => call.name)).toEqual(["read_investigation_native_capture_v1"]);
  });

  it("reports unavailable when the read transport throws", async () => {
    const db: InvestigationDb = {
      rpc: async () => { throw new Error("transport down"); },
    };
    expect(await readInvestigationNativeOperation(db, fixtureCommandRaw, principal)).toEqual({ status: "unavailable" });
  });

  it("refuses commands outside the native recovery surface without any rpc", async () => {
    const { db, calls } = readOnlyDb(baseRaw(), null);
    expect(await readInvestigationNativeOperation(db, { ...fixtureCommandRaw, action: "remove" as const }, principal)).toEqual({ status: "invalid_payload" });
    expect(await readInvestigationNativeOperation(db, { ...fixtureCommandRaw, action: "restore" as const }, principal)).toEqual({ status: "invalid_payload" });
    expect(await readInvestigationNativeOperation(db, { ...fixtureCommandRaw, expected_revision: 1 }, principal)).toEqual({ status: "invalid_payload" });
    expect(await readInvestigationNativeOperation(db, { ...fixtureCommandRaw, action: "revise" as const, expected_revision: 0 }, principal)).toEqual({ status: "invalid_payload" });
    expect(await readInvestigationNativeOperation(db, fixtureCommandRaw, owner)).toEqual({ status: "invalid_payload" });
    expect(await readInvestigationNativeOperation(db, { ...fixtureCommandRaw, manifest: { ...fixtureCommandRaw.manifest, scenario_capture: undefined } }, principal)).toEqual({ status: "invalid_payload" });
    expect(await readInvestigationNativeOperation(db, { ...fixtureCommandRaw, etag: "witness" }, principal)).toEqual({ status: "invalid_payload" });
    expect(calls).toEqual([]);
  });

  it("reads a revise producer at its nonzero expected revision", async () => {
    const reviseRaw = { ...fixtureCommandRaw, action: "revise" as const, expected_revision: 2 };
    const reviseCommand = parseInvestigationCommand(reviseRaw);
    if (!reviseCommand) throw new Error("expected the revise fixture to be a valid command");
    const { db, calls } = readOnlyDb(baseRaw(reviseCommand), null);
    const result = await readInvestigationNativeOperation(db, reviseRaw, principal);
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected a found native receipt");
    expect(result.canonical).toEqual({ status: "unavailable" });
    expect(calls.map((call) => call.name)).toEqual(["read_investigation_native_capture_v1"]);
    expect(calls[0].args.p_request).toEqual(investigationCanonicalRequest(reviseCommand, principal));
  });
});

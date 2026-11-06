import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { researchReceipt } from "../../e2e/helpers/optionsR1Research";
import { canonicalInvestigationJson } from "../investigationContracts";
import { matchesInvestigationCommand, type InvestigationCommand } from "../investigations";

const command = (): InvestigationCommand => ({
  id: "10000000-0000-4000-8000-000000000001", operation_id: "20000000-0000-4000-8000-000000000001",
  action: "create", expected_revision: 0,
  manifest: { schema: "investigation_manifest.v2", argument_relations: [],
    intent: { title: "Research", question: "Exact saved question", subjects: [] },
    layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} },
});

describe("Options research fixture owner receipts", () => {
  it("discriminates the inherited legacy shape from a current revision receipt", () => {
    const c = command(), current = researchReceipt(c);
    const old = { status: "committed", id: c.id, revision: 1, lifecycle: "active", manifest: c.manifest, committed_at: current.committed_at };
    expect(matchesInvestigationCommand(old, c)).toBe(false);
    expect(matchesInvestigationCommand({ ...old, operation_id: c.operation_id }, c)).toBe(false);
    expect(matchesInvestigationCommand(current, c)).toBe(true);
    expect(current.parent_revision_id).toBeNull();
    expect(current.manifest_digest).toBe(createHash("sha256").update(canonicalInvestigationJson(c.manifest)).digest("hex"));
  });
  it("chains a revised receipt without changing the previous saved revision", () => {
    const c = command(), first = researchReceipt(c), snapshot = structuredClone(first);
    const next: InvestigationCommand = { ...c, operation_id: "20000000-0000-4000-8000-000000000002", action: "revise", expected_revision: 1,
      manifest: { ...c.manifest, intent: { ...c.manifest.intent, question: "A revised exact question" } } };
    const second = researchReceipt(next, first);
    expect(matchesInvestigationCommand(second, next)).toBe(true);
    expect(second.parent_revision_id).toBe(first.revision_id);
    expect(second.revision_id).not.toBe(first.revision_id);
    expect(first).toEqual(snapshot);
    expect(second.recorded_at).toBe(second.committed_at);
  });
  for (const change of ["missing_operation", "wrong_operation", "wrong_parent", "wrong_body"] as const) {
    it(`keeps the real client refusal for ${change}`, () => {
      const c = command(), receipt = researchReceipt(c);
      const bad = { ...receipt } as Record<string, unknown>;
      if (change === "missing_operation") delete bad.operation_id;
      if (change === "wrong_operation") bad.operation_id = "20000000-0000-4000-8000-000000000099";
      if (change === "wrong_parent") bad.parent_revision_id = "30000000-0000-4000-8000-000000000099";
      if (change === "wrong_body") bad.manifest = { ...c.manifest, intent: { ...c.manifest.intent, question: "Another command" } };
      expect(matchesInvestigationCommand(bad, c)).toBe(false);
    });
  }
});

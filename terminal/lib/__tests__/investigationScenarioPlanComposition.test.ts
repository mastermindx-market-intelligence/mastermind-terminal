import { describe, expect, it, vi } from "vitest";
import { parseInvestigationCommand, applyInvestigationRevision } from "../investigations";
import { validateStoredInvestigationManifest } from "../investigationContracts";
const reference = {
  schema: "investigation_scenario_reference.v1", model_version: "exposure-scenario/v1",
  inputs: { targetSpot: 600, deltaSigmaPts: 1, days: 1 },
  source: { owner: "options_hub", root: "SPX", session: "2026-10-16", source_as_of: "2026-10-16t15:30:00z", evaluated_at: "2026-10-16T15:45:00Z",
    lens: { kind: "one", exp: "2026-10-30" }, selection_key: "2026-10-30|2026-10-30T09:30:00-04:00,2026-10-30|2026-10-30T16:00:00-04:00",
    basis_sha256: "a".repeat(64), gex: { sha256: "b".repeat(64), byte_length: 2048 }, moves: null },
};
const id="11111111-1111-4111-8111-111111111111", operation_id="22222222-2222-4222-8222-222222222222";
const command = () => ({ id, operation_id, expected_revision: 0, action: "create", manifest: {
  schema: "investigation_manifest.v2", argument_relations: [], intent: { title: "Reference only", question: "Original inputs?", subjects: [] },
  layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {}, scenario_capture: structuredClone(reference),
} });
describe("original0042 reference and new Plan version composition", () => {
  it("passes the exact value-free v2 reference through the existing RPC without changing its clocks or nulls", async () => {
    const c=command(), parsed=parseInvestigationCommand(c); expect(parsed).not.toBeNull();
    const rpc=vi.fn(async()=>({data:{status:"invalid_payload"},error:null}));
    await applyInvestigationRevision({rpc},parsed!);
    expect(rpc).toHaveBeenCalledWith("apply_investigation_revision_v2",expect.objectContaining({p_manifest:c.manifest,p_operation_id:operation_id}));
    expect(parsed?.manifest.scenario_capture).toEqual(reference);
  });
  it.each(["investigation_manifest.v1","investigation_manifest.v3","investigation_manifest.v4"])("refuses scenario references in %s",schema => {
    const c=command();c.manifest.schema=schema;expect(parseInvestigationCommand(c)).toBeNull();
  });
  it.each(["basis","result","summary","storage_key"])("refuses protected %s values rather than silently stripping them",field => {
    const c=command();Object.assign(c.manifest.scenario_capture,{[field]:{value:1}});expect(parseInvestigationCommand(c)).toBeNull();
  });
  it("reads the historical v2 reference without inventing relations, while new commands require them",()=>{
    const c=command();const legacy={...c.manifest} as Record<string,unknown>;delete legacy.argument_relations;
    expect(validateStoredInvestigationManifest(legacy).ok).toBe(true);
    expect(parseInvestigationCommand({...c,manifest:legacy})).toBeNull();
  });
});

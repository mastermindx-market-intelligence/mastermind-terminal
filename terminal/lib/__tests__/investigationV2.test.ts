import { describe, expect, it } from "vitest";
import textVectors from "./fixtures/investigation_text_vectors_v2.json";
import { validateInvestigationManifest } from "../investigationContracts";

const manifest = (schema = "investigation_manifest.v2", question = "Why now?") => ({
  schema, ...(schema === "investigation_manifest.v2" ? {argument_relations:[]} : {}), intent: { title: "Retained research", question, subjects: [] },
  layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {},
});
describe("versioned Investigation envelope", () => {
  it.each(textVectors.vectors)("paired Python/TypeScript text: $name", vector => {
    const input=manifest();
    input.intent[vector.field as "question" | "title"] = vector.text;
    const result=validateInvestigationManifest(input);
    expect(result.ok).toBe(vector.valid);
    if (result.ok) expect(result.value.intent[vector.field as "question" | "title"]).toBe(vector.text);
    else expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({code:vector.code})]));
  });
  it("retains all 4000 authored scalars including astral Unicode in v2", () => {
    const input = manifest(undefined, " 🧠\r\n" + "x".repeat(3996));
    const result = validateInvestigationManifest(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.intent.question).toBe(input.intent.question);
    expect(validateInvestigationManifest(manifest(undefined, "🧠".repeat(4001))).ok).toBe(false);
  });
  it("admits envelopes over 64 KiB only in v2 and still enforces 128 KiB", () => {
    const admission = {evidence: [{owner: "earnings.workspace_generation", object_types: ["event_workspace"]}]};
    const refs = Array.from({length:100},(_,i)=>({owner:"earnings.workspace_generation",object_type:"event_workspace",object_id:"🧠".repeat(140)+i,mode:"pinned",version_ref:"v".repeat(256)}));
    const input={...manifest(),evidence_refs:refs};
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeGreaterThan(65536);
    expect(validateInvestigationManifest(input,admission).ok).toBe(true);
    expect(validateInvestigationManifest({...input,schema:"investigation_manifest.v1"},admission).ok).toBe(false);
    const huge={...input,evidence_refs:Array.from({length:128},(_,i)=>({...refs[0],object_id:"🧠".repeat(250)+i}))};
    expect(validateInvestigationManifest(huge,admission).ok).toBe(false);
  });
  it("keeps the published v1 question boundary", () => {
    expect(validateInvestigationManifest(manifest("investigation_manifest.v1", "x".repeat(2000))).ok).toBe(true);
    expect(validateInvestigationManifest(manifest("investigation_manifest.v1", "x".repeat(2001))).ok).toBe(false);
  });
  it("rejects invented fact bodies and unknown successor versions", () => {
    expect(validateInvestigationManifest({ ...manifest(), facts: { price: 100 } }).ok).toBe(false);
    expect(validateInvestigationManifest(manifest("investigation_manifest.v99")).ok).toBe(false);
  });
  it("does not admit the proposed Options selection by changing only an owner allowlist", () => {
    const admission = { evidence: [{ owner: "options_structure.matrix", object_types: ["matrix_snapshot"] }] };
    const ref = { owner: "options_structure.matrix", object_type: "matrix_snapshot", object_id: "SPY",
      mode: "pinned", version_ref: `sha256:${"a".repeat(64)}:bytes:512:session:2026-10-08`, fingerprint: "a".repeat(64) };
    const input = { ...manifest(), evidence_refs: [ref] };
    // The fixture-only allowlist isolates selection/version validation; it does
    // not alter the application's actual admission registry.
    expect(validateInvestigationManifest(input, admission).ok).toBe(true);
    const selection = { schema: "options_matrix_selection.v1",
      primary: { expiry: "2026-10-16", side: "call", strike: "600" }, comparisons: [],
      view: { lens: "chain", metric: "volume", side: "all", expiry: "all", display_mode: "table" } };
    expect(validateInvestigationManifest({ ...input, evidence_refs: [{ ...ref, selection }] }, admission).ok).toBe(false);
    expect(validateInvestigationManifest({ ...input, schema: "investigation_manifest.v3" }, admission).ok).toBe(false);
  });
  it("counts evidence separately from the bounded layout and Thesis references", () => {
    const input = manifest();
    const refs = Array.from({ length: 128 }, (_, i) => ({owner: "earnings.workspace_generation", object_type: "event_workspace", object_id: `evt_${i}`, mode: "pinned", version_ref: "generation"}));
    const admission = {evidence: [{owner: "earnings.workspace_generation", object_types: ["event_workspace"]}]};
    expect(validateInvestigationManifest({...input, evidence_refs: refs}, admission).ok).toBe(true);
    expect(validateInvestigationManifest({...input, evidence_refs: refs, layout_refs: [{layout_id:"10000000-0000-4000-8000-000000000001", layout_revision_id:"10000000-0000-4000-8000-000000000002", digest:"a".repeat(64),role:"primary"}]}, admission).ok).toBe(true);
  });
});

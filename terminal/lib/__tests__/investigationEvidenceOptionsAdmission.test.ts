import { describe, expect, it } from "vitest";
import { validateInvestigationManifest } from "../investigationContracts";
import { INVESTIGATION_ADMISSION } from "../investigations";

const DIGEST = "7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6";
const manifest = (object_type: string) => ({
  schema: "investigation_manifest.v2", argument_relations:[],
  intent: { title: "XLK gamma at 450", question: "Does the matched change hold?", subjects: [] },
  layout_refs: [], thesis_refs: [],
  evidence_refs: [{ owner: "terminal.options_exposure", object_type, object_id: "XLK/2026-10-16/450/gamma/one:2026-10-17",
    mode: "pinned", version_ref: `exposure_chart_request.v1:${DIGEST}`, fingerprint: DIGEST }],
  continuation: {},
});

describe("investigation admission for Options evidence (W2C)", () => {
  it("manifest with options evidence validates under the admission", () => {
    for (const type of ["exposure_chart_request", "sector_origin", "rotation_measurement"]) {
      const result = validateInvestigationManifest(manifest(type), INVESTIGATION_ADMISSION);
      expect(result.ok, type).toBe(true);
    }
    const stranger = validateInvestigationManifest(manifest("dealer_inventory"), INVESTIGATION_ADMISSION);
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.errors.map(error => error.code)).toContain("unsupported_owner_kind");
  });

  it("the earnings adapter is still admitted exactly as before", () => {
    expect(INVESTIGATION_ADMISSION.evidence).toContainEqual({ owner: "earnings.workspace_generation", object_types: ["event_workspace"] });
  });
});

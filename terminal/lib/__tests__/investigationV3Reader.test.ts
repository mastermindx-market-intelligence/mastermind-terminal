/**
 * Prophet D05 investigation_manifest.v3 — READ extension only (lane 6 v3 reader phase).
 * v3 validates for display/readback; v3 WRITES stay closed: parseInvestigationCommand refuses it and
 * INVESTIGATION_ADMISSION does not list prophet.research until retention and current-rights are
 * qualified (lane 9). Executable corpus parity lives in investigationManifestParity.test.ts.
 */
import { describe, expect, it } from "vitest";
import { validateInvestigationManifest } from "../investigationContracts";
import { INVESTIGATION_ADMISSION, parseInvestigationCommand, readInvestigation } from "../investigations";

const ID = "5b1c0d2e-3f4a-4b6c-8d7e-9f0a1b2c3d4e";
const OP = "6c2d1e3f-4a5b-4c7d-9e8f-0a1b2c3d4e5f";
const SHA = "a3573d7cefe87da155ef7575feb2071b4c32c9f562f42d5724b3ec54332d9eab";
const v3 = () => ({
  schema: "investigation_manifest.v3",
  intent: { title: "Financials leadership", question: "Is the leadership supported by participation?", subjects: [] },
  layout_refs: [], thesis_refs: [],
  evidence_refs: [{ owner: "macro.sector", object_type: "sector_observation", object_id: "xlf", mode: "pinned", version_ref: "real-g1", fingerprint: SHA, context_ref: "abc.def" }],
  continuation: {},
  user_decision: { disposition: "watch", reason: "", decided_at: "2026-11-10T08:00:00Z", milestones: [] },
});

describe("investigation_manifest.v3 is readable but not yet writable", () => {
  it("validates under the shared admission (Sector evidence + context_ref + user_decision)", () => {
    expect(validateInvestigationManifest(v3(), INVESTIGATION_ADMISSION).ok).toBe(true);
  });
  it("the shared admission registry does not list prophet.research (writes closed until lane 9)", () => {
    expect(INVESTIGATION_ADMISSION.evidence?.some(a => a.owner === "prophet.research")).toBe(false);
    const manifest = { ...v3(), evidence_refs: [{ owner: "prophet.research", object_type: "today_selection", object_id: "o", mode: "pinned", version_ref: "v", fingerprint: SHA }] };
    const result = validateInvestigationManifest(manifest, INVESTIGATION_ADMISSION);
    expect(result.ok).toBe(false);
  });
  it("parseInvestigationCommand refuses a v3 command", () => {
    expect(parseInvestigationCommand({ id: ID, operation_id: OP, expected_revision: 0, action: "create", manifest: v3() })).toBeNull();
  });
  it("readInvestigation displays an already-created v3 record", async () => {
    const data = { status: "found", id: ID, revision: 1, current_revision: 1, lifecycle: "active", committed_at: "2026-11-10T08:00:00Z", layouts: [], manifest: v3() };
    const db = { rpc: async () => ({ data, error: null }) };
    expect(await readInvestigation(db as never, ID, 1)).toEqual(data);
  });
});

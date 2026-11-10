/**
 * Sector Intelligence admission (packet SI-P16-LANE6) — the Terminal-side registry half of
 * migration 0049: a Sector/GMI reading must save through the SAME Investigation v2 manifest
 * and admission adapters, never a second store. These tests pin the caller-supplied
 * admission surface under INVESTIGATION_ADMISSION (the SQL allow-list equality is pinned
 * by the 0049 migration contract test), the fence owner classification, and the pure fence
 * decision table from packet §3.3.
 */
import { describe, expect, it } from "vitest";
import { validateInvestigationManifest } from "../investigationContracts";
import { INVESTIGATION_ADMISSION, INVESTIGATION_FENCE_OWNERS, investigationFenceRequired, investigationOwnerFence } from "../investigations";

const SHA = "a3573d7cefe87da155ef7575feb2071b4c32c9f562f42d5724b3ec54332d9eab";
const evidenceManifest = (owner: string, object_type: string, object_id: string, version_ref: string) => ({
  schema: "investigation_manifest.v2",
  intent: { title: "Financials leadership", question: "Is the 63-session leadership supported by participation?", subjects: [] },
  layout_refs: [], thesis_refs: [],
  evidence_refs: [{ owner, object_type, object_id, mode: "pinned", version_ref, fingerprint: SHA }],
  continuation: {},
});
const subjectManifest = (owner: string, kind: string, object_id: string) => ({
  schema: "investigation_manifest.v2",
  intent: { title: "Financials leadership", question: "Is the 63-session leadership supported by participation?", subjects: [{ kind, owner, object_id }] },
  layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {},
});

describe("investigation admission for Sector Intelligence evidence (packet 3.2)", () => {
  it("manifest with native sector evidence validates under the admission", () => {
    const result = validateInvestigationManifest(evidenceManifest("macro.sector", "sector_observation", "xlf", "captured-sector-1"), INVESTIGATION_ADMISSION);
    expect(result.ok).toBe(true);
    const basket = validateInvestigationManifest(evidenceManifest("macro.sector", "basket_observation", "b-us_defensives", "captured-sector-1"), INVESTIGATION_ADMISSION);
    expect(basket.ok).toBe(true);
    const curation = validateInvestigationManifest(evidenceManifest("theme_graph.curation_assertion", "curation_assertion", "ev:0123456789abcdef", "gmirca_0123456789abcdef0123456789abcdef"), INVESTIGATION_ADMISSION);
    expect(curation.ok).toBe(true);
    // A stranger type under an admitted owner is refused by the registry, not the grammar.
    const stranger = validateInvestigationManifest(evidenceManifest("macro.sector", "dealer_inventory", "xlf", "captured-sector-1"), INVESTIGATION_ADMISSION);
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.errors.map(error => error.code)).toContain("unsupported_owner_kind");
  });

  it("the pre-existing adapters are preserved exactly", () => {
    expect(INVESTIGATION_ADMISSION.evidence).toContainEqual({ owner: "earnings.workspace_generation", object_types: ["event_workspace"] });
    expect(INVESTIGATION_ADMISSION.evidence).toContainEqual({ owner: "terminal.options_exposure", object_types: ["exposure_chart_request", "sector_origin", "rotation_measurement", "options_matrix_selection"] });
    expect(INVESTIGATION_ADMISSION.subjects).toContainEqual({ owner: "terminal.analysis_symbol", kinds: ["security"] });
    expect(INVESTIGATION_ADMISSION.subjects).toContainEqual({ owner: "data_os.security_master", kinds: ["security", "issuer"] });
  });

  it("sector and theme-graph subjects validate on their owner-resolved id grammars", () => {
    for (const [owner, kind, id] of [
      ["macro.sector", "sector", "xlf"],
      ["theme_graph.identity", "theme", "theme:ai_supply_chain"],
      ["theme_graph.identity", "basket", "basket:baskets:nuclear_power"],
      ["theme_graph.identity", "company", "co:us:AAPL"],
      ["theme_graph.identity", "company", "co:us:AAPL#2"],
    ] as const) {
      const result = validateInvestigationManifest(subjectManifest(owner, kind, id), INVESTIGATION_ADMISSION);
      expect(result.ok, `${owner}/${kind}/${id}`).toBe(true);
    }
    // The identity seam stays closed: finance-research sector:financials is NOT the
    // native xlf id, and a theme_graph company id is never a security/issuer.
    const seam = validateInvestigationManifest(subjectManifest("macro.sector", "sector", "sector:financials"), INVESTIGATION_ADMISSION);
    expect(seam.ok).toBe(false);
    const asSecurity = validateInvestigationManifest(subjectManifest("theme_graph.identity", "security", "co:us:AAPL"), INVESTIGATION_ADMISSION);
    expect(asSecurity.ok).toBe(false);
    const strangerKind = validateInvestigationManifest(subjectManifest("macro.sector", "industry", "xlf"), INVESTIGATION_ADMISSION);
    expect(strangerKind.ok).toBe(false);
  });
});

describe("x-mm-investigation-owner expected-actor fence (packet 3.3)", () => {
  it("classifies the fence owners and never authenticates", () => {
    expect(INVESTIGATION_FENCE_OWNERS).toEqual(["macro.sector", "theme_graph.identity", "theme_graph.curation_assertion"]);
    // A manifest touching any Sector/GMI store in subjects, evidence or review baseline
    // is Sector use; an Options-only manifest is not.
    expect(investigationFenceRequired(subjectManifest("macro.sector", "sector", "xlf"))).toBe(true);
    expect(investigationFenceRequired(evidenceManifest("macro.sector", "sector_observation", "xlf", "captured-sector-1"))).toBe(true);
    expect(investigationFenceRequired(evidenceManifest("theme_graph.curation_assertion", "curation_assertion", "ev:0123456789abcdef", "gmirca_0123456789abcdef0123456789abcdef"))).toBe(true);
    expect(investigationFenceRequired({ ...evidenceManifest("macro.sector", "sector_observation", "xlf", "captured-sector-1"), review_baseline_ref: { owner: "theme_graph.curation_assertion", object_type: "curation_assertion", object_id: "ev:0123456789abcdef", mode: "pinned", version_ref: "gmirca_0123456789abcdef0123456789abcdef", fingerprint: SHA } })).toBe(true);
    expect(investigationFenceRequired(evidenceManifest("terminal.options_exposure", "options_matrix_selection", "XLK/2026-10-16/450/gamma/one:2026-10-17", `exposure_chart_request.v1:${SHA}`))).toBe(false);
    expect(investigationFenceRequired({ schema: "investigation_manifest.v2", intent: { title: "t", question: "q", subjects: [] }, layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {} })).toBe(false);
  });

  it("decides the fence truth table: present header must name the authenticated user; Sector use requires it", () => {
    const user = "11111111-1111-4111-8111-111111111111";
    // Legacy header-less client on non-Sector use keeps compatible behavior.
    expect(investigationOwnerFence(null, user, false)).toEqual({ status: "ok" });
    // Sector/GMI use requires the header outright.
    expect(investigationOwnerFence(null, user, true)).toEqual({ status: "owner_mismatch" });
    // A present header must name the authenticated UUID (trimmed), on either use.
    expect(investigationOwnerFence(user, user, false)).toEqual({ status: "ok" });
    expect(investigationOwnerFence(` ${user} `, user, true)).toEqual({ status: "ok" });
    expect(investigationOwnerFence("22222222-2222-4222-8222-222222222222", user, false)).toEqual({ status: "owner_mismatch" });
    expect(investigationOwnerFence("22222222-2222-4222-8222-222222222222", user, true)).toEqual({ status: "owner_mismatch" });
    expect(investigationOwnerFence("", user, false)).toEqual({ status: "owner_mismatch" });
    expect(investigationOwnerFence("", user, true)).toEqual({ status: "owner_mismatch" });
  });
});

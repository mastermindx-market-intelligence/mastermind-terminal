import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateInvestigationManifest, type InvestigationEvidenceRef } from "../investigationContracts";
import { INVESTIGATION_ADMISSION } from "../investigations";
import type { ExposureChartRequest } from "../exposureChartLink";
import type { ExposureOrigin } from "../exposureOrigin";
import {
  OPTIONS_EVIDENCE_OBJECT_TYPES, OPTIONS_EVIDENCE_OWNER, canonicalJson, evaluateOptionsEvidence, isOptionsEvidenceRef,
  optionsEvidenceRefs, optionsEvidenceStateLabel, sha256Hex, type OptionsEvidenceState,
} from "../investigationEvidenceOptions";

const FP = "7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6";
const FP2 = "0a9b8c7d6e5f40312233445566778899aabbccddeeff00112233445566778899";
const request = (fingerprint = FP): ExposureChartRequest => ({
  v: 1, root: "XLK", session: "2026-10-16", strike: 450, archived: false, metric: "gamma",
  lens: { kind: "one", exp: "2026-10-17" }, shock: { spotPercent: 0, ivPoints: 0, calendarDays: 0 }, fingerprint,
});
const origin = (contentHash: string | null = `sha256:${FP.toUpperCase()}`): ExposureOrigin => ({
  v: 1, kind: "sector", returnHref: "/discover?tab=sectors", sector: "xlk", group: "software", company: "MSFT",
  index: 2, count: 20, sort: "source", query: "", asOf: "2026-10-16", contentHash, method: "incumbent_rs_63_21/v1", benchmark: "SPY",
});
const rotation = { method: "relative_trend_ema", version: "v1", sector: "xlk", observationDate: "2026-10-16", vintage: FP2 };

describe("optionsEvidenceRefs", () => {
  it("mints a pinned request reference with a content-addressed version and the read fingerprint", async () => {
    const refs = await optionsEvidenceRefs({ request: request() });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      owner: OPTIONS_EVIDENCE_OWNER, object_type: "exposure_chart_request", object_id: "XLK/2026-10-16/450/gamma/one:2026-10-17",
      mode: "pinned", version_ref: `exposure_chart_request.v1:${await sha256Hex(canonicalJson(request()))}`, fingerprint: FP,
    });
    const wide = await optionsEvidenceRefs({ request: { ...request(), lens: { kind: "week" } } });
    expect(wide[0].object_id).toBe("XLK/2026-10-16/450/gamma/week");
    expect(wide[0].version_ref).not.toBe(refs[0].version_ref);
  });

  it("mints an origin reference whose fingerprint is the normalised content hash or absent", async () => {
    const [hashed] = await optionsEvidenceRefs({ origin: origin() });
    expect(hashed).toEqual({ owner: OPTIONS_EVIDENCE_OWNER, object_type: "sector_origin", object_id: "xlk/software/MSFT",
      mode: "pinned", version_ref: "exposure_origin.v1@2026-10-16", fingerprint: FP });
    const [bare] = await optionsEvidenceRefs({ origin: origin("roster-20-v3") });
    expect(bare).toEqual({ owner: OPTIONS_EVIDENCE_OWNER, object_type: "sector_origin", object_id: "xlk/software/MSFT",
      mode: "pinned", version_ref: "exposure_origin.v1@2026-10-16" });
    expect("fingerprint" in bare).toBe(false);
    const [undated] = await optionsEvidenceRefs({ origin: { ...origin(null), asOf: null } });
    expect(undated.version_ref).toBe("exposure_origin.v1@undated");
    expect("fingerprint" in undated).toBe(false);
  });

  it("mints a rotation measurement reference carrying the vintage", async () => {
    const [ref] = await optionsEvidenceRefs({ rotation });
    expect(ref).toEqual({ owner: OPTIONS_EVIDENCE_OWNER, object_type: "rotation_measurement",
      object_id: "relative_trend_ema:xlk:2026-10-16", mode: "pinned", version_ref: `v1@${FP2}`, fingerprint: FP2 });
    const [unversioned] = await optionsEvidenceRefs({ rotation: { ...rotation, vintage: undefined } });
    expect(unversioned.version_ref).toBe("v1");
    expect("fingerprint" in unversioned).toBe(false);
    const [opaque] = await optionsEvidenceRefs({ rotation: { ...rotation, vintage: "nightly-2026-10-16" } });
    expect(opaque.version_ref).toBe("v1@nightly-2026-10-16");
    expect("fingerprint" in opaque).toBe(false);
  });

  it("never mints a follow-head reference or a selection and keeps request, origin and rotation in that order", async () => {
    const refs = await optionsEvidenceRefs({ rotation, origin: origin(), request: request() });
    expect(refs.map(ref => ref.object_type)).toEqual(["exposure_chart_request", "sector_origin", "rotation_measurement"]);
    for (const ref of refs) {
      expect(ref.mode).toBe("pinned");
      expect("selection" in ref).toBe(false);
      expect(isOptionsEvidenceRef(ref)).toBe(true);
    }
    expect(await optionsEvidenceRefs({})).toEqual([]);
    expect(isOptionsEvidenceRef({ owner: "earnings.workspace_generation", object_type: "event_workspace", object_id: "x", mode: "pinned", version_ref: "1" })).toBe(false);
    expect(isOptionsEvidenceRef({ owner: OPTIONS_EVIDENCE_OWNER, object_type: "dealer_inventory", object_id: "x", mode: "pinned", version_ref: "1" })).toBe(false);
    expect([...OPTIONS_EVIDENCE_OBJECT_TYPES]).toEqual(["exposure_chart_request", "sector_origin", "rotation_measurement"]);
  });

  it("the minted references validate inside a v2 manifest under the admission", async () => {
    const refs = await optionsEvidenceRefs({ request: request(), origin: origin(), rotation });
    const result = validateInvestigationManifest({
      schema: "investigation_manifest.v2", intent: { title: "XLK gamma at 450", question: "Does the matched change hold?", subjects: [] },
      layout_refs: [], thesis_refs: [], evidence_refs: refs, continuation: {},
    }, INVESTIGATION_ADMISSION);
    expect(result.ok).toBe(true);
  });

  it("throws when a minted identifier would exceed the manifest limit", async () => {
    await expect(optionsEvidenceRefs({ origin: { ...origin(), company: "M".repeat(260) } })).rejects.toThrow("evidence_ref_too_long");
    await expect(optionsEvidenceRefs({ rotation: { ...rotation, vintage: "v".repeat(260) } })).rejects.toThrow("evidence_ref_too_long");
  });

  it("canonical JSON is key-order independent and whitespace-free", async () => {
    expect(canonicalJson({ b: [1, { z: 1, a: 2 }], a: "x" })).toBe('{"a":"x","b":[1,{"a":2,"z":1}]}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("evaluateOptionsEvidence", () => {
  it("reopening reports matches, source corrected and unavailable per saved reference and skips other owners", async () => {
    const saved = await optionsEvidenceRefs({ request: request(), origin: origin(), rotation });
    const foreign: InvestigationEvidenceRef = { owner: "earnings.workspace_generation", object_type: "event_workspace", object_id: "ev-1", mode: "pinned", version_ref: "1" };
    const statuses = await evaluateOptionsEvidence([...saved, foreign], {
      request: request(FP2), origin: origin(), rotation: { ...rotation, observationDate: "2026-10-23" },
    });
    expect(statuses.map(status => [status.ref.object_type, status.state])).toEqual([
      ["exposure_chart_request", "source_corrected"], ["sector_origin", "matches"], ["rotation_measurement", "unavailable"],
    ]);
    expect(statuses[0]).toMatchObject({ savedFingerprint: FP, currentFingerprint: FP2 });
    expect(statuses[1]).toMatchObject({ savedFingerprint: FP, currentFingerprint: FP });
    expect(statuses[2]).toMatchObject({ savedFingerprint: FP2, currentFingerprint: null });
    expect(statuses.map(status => status.ref)).toEqual(saved);
    expect(await evaluateOptionsEvidence([foreign], { request: request() })).toEqual([]);
    expect(await evaluateOptionsEvidence(saved, {})).toEqual(saved.map(ref => ({ ref, state: "unavailable", savedFingerprint: ref.fingerprint ?? null, currentFingerprint: null })));
  });

  it("a saved reference without a fingerprint compares its version and a re-dated roster is a correction", async () => {
    const saved = await optionsEvidenceRefs({ origin: origin("roster-20-v3") });
    expect((await evaluateOptionsEvidence(saved, { origin: origin("roster-20-v4") }))[0].state).toBe("matches");
    expect((await evaluateOptionsEvidence(saved, { origin: { ...origin("roster-20-v3"), asOf: "2026-10-17" } }))[0].state).toBe("source_corrected");
    expect((await evaluateOptionsEvidence(saved, { origin: origin() }))[0]).toMatchObject({ state: "source_corrected", savedFingerprint: null, currentFingerprint: FP });
  });

  it("state labels are plain language in both languages", () => {
    const states: OptionsEvidenceState[] = ["matches", "source_corrected", "unavailable"];
    expect(states.map(state => optionsEvidenceStateLabel(state, "en"))).toEqual(["Matches the saved source", "Source corrected since this revision", "Current source unavailable"]);
    expect(states.map(state => optionsEvidenceStateLabel(state, "zh"))).toEqual(["与保存时来源一致", "来源在此版本后已修正", "当前来源不可用"]);
    for (const state of states) for (const lang of ["en", "zh"] as const) expect(optionsEvidenceStateLabel(state, lang)).not.toMatch(/_|fingerprint|sha256/);
  });

  it("the adapter never reads follow-head state or a selection and never forecasts", () => {
    const source = readFileSync(new URL("../investigationEvidenceOptions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/follow_head|selection|forecast|predict/);
  });
});

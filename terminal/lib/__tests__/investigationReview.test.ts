import { describe, expect, it } from "vitest";
import { validateInvestigationManifest } from "../investigationContracts";
import { INVESTIGATION_ADMISSION } from "../investigations";
import { assessmentRevision, projectReview, receiptsFrom, type FireReceipt } from "../investigationReview";
import type { InvestigationManifest } from "../investigationContracts";
import type { OwnerAlertRow } from "../investigationWatch";

const link = { investigation_id: "00000000-0000-4000-8000-000000000001", revision: 3 };
const FIRE = "b".repeat(64), CORRECTED_FIRE = "c".repeat(64);
const manifest = (): InvestigationManifest => ({
  schema: "investigation_manifest.v2",
  intent: { title: "NVDA · 230 wall", question: "Did NVDA reach the 230 wall before the rotation faded?", subjects: [{ kind: "security", owner: "terminal.analysis_symbol", object_id: "NVDA" }] },
  layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {},
});
const alertRow = (over: Partial<OwnerAlertRow>): OwnerAlertRow => ({
  id: "alert-1", symbol: "NVDA", active: false,
  condition: { type: "price", op: "above", value: 230, evidence: link, triggered: { at: "2026-10-21T15:40:03Z", value: 230.12, note: "price 230.12 above 230 (hub)" } },
  ...over,
});

describe("investigation review projector", () => {
  it("produces the next manifest with the review block and leaves the current manifest untouched", () => {
    const current = manifest();
    const before = JSON.stringify(current);
    const next = assessmentRevision(current, "inconclusive", FIRE, "the wall held through the session");
    expect(JSON.stringify(current)).toBe(before);
    expect(current.review).toBeUndefined();
    expect(next).not.toBe(current);
    expect(next.review).toEqual({ assessment: "inconclusive", fire_event_id: FIRE, note: "the wall held through the session" });
    expect(JSON.parse(JSON.stringify({ ...next, review: undefined }))).toEqual(JSON.parse(JSON.stringify(current)));
    expect(Object.keys(assessmentRevision(current, "confirmed")).length).toBe(Object.keys(current).length + 1);
    expect("review" in assessmentRevision(manifest(), "contradicted", null, null)).toBe(true);
    expect(assessmentRevision(manifest(), "confirmed", undefined, undefined).review).toEqual({ assessment: "confirmed" });
    expect(() => assessmentRevision(current, "mixed" as never)).toThrow(/invalid_assessment/);
  });

  it("accepts confirmed, contradicted and inconclusive and nothing else", () => {
    for (const assessment of ["confirmed", "contradicted", "inconclusive"] as const) {
      const next = assessmentRevision(manifest(), assessment);
      expect(next.review?.assessment).toBe(assessment);
      expect(validateInvestigationManifest(next, INVESTIGATION_ADMISSION).ok).toBe(true);
    }
    for (const assessment of ["maybe", "", "CONFIRMED", 1, null]) {
      expect(() => assessmentRevision(manifest(), assessment as never)).toThrow();
    }
  });

  it("links the assessment to the fire event id when one is given and validates under the admission", () => {
    const next = assessmentRevision(manifest(), "confirmed", FIRE);
    expect(next.review).toEqual({ assessment: "confirmed", fire_event_id: FIRE });
    const checked = validateInvestigationManifest(next, INVESTIGATION_ADMISSION);
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("admission refused the review manifest");
    expect(checked.value.review?.fire_event_id).toBe(FIRE);
    // Without a receipt there is no id: the block stays valid with the assessment alone.
    expect(validateInvestigationManifest(assessmentRevision(manifest(), "inconclusive"), INVESTIGATION_ADMISSION).ok).toBe(true);
  });

  it("lists what changed, what stayed supported and what is unavailable from the evidence status", () => {
    const ref = (object_id: string, version_ref?: string) => ({ owner: "terminal.options_exposure", object_type: "exposure_chart_request", object_id, mode: "pinned" as const, ...(version_ref ? { version_ref } : {}) });
    const status = [
      { ref: ref("NVDA/a"), state: "matches", savedFingerprint: "a".repeat(64), currentFingerprint: "a".repeat(64) },
      { ref: ref("NVDA/b"), state: "source_corrected", savedFingerprint: "a".repeat(64), currentFingerprint: "f".repeat(64) },
      { ref: ref("NVDA/c"), state: "unavailable", savedFingerprint: null, currentFingerprint: null },
    ];
    const view = projectReview([{ revision: 2, committed_at: "2026-10-20T09:00:00Z", manifest: manifest() }, { revision: 3, committed_at: "2026-10-21T14:02:00Z", manifest: assessmentRevision(manifest(), "confirmed") }], status, []);
    expect(view.rows.map(r => [r.kind, r.object_id])).toEqual([["still_supported", "NVDA/a"], ["changed", "NVDA/b"], ["unavailable", "NVDA/c"]]);
    expect(view.rows[1].detail).toContain(`${"a".repeat(64)} → ${"f".repeat(64)}`);
    expect(view.revisions.map(r => [r.revision, r.assessment])).toEqual([[3, "confirmed"], [2, null]]);
    expect(projectReview([{ revision: 1, manifest: manifest() }], null, []).rows).toEqual([]);
  });

  it("names the condition that fired with its id, vintage, observed value and delivery state", () => {
    const outbox = [{ alert_id: "alert-1", fire_event_id: FIRE, status: "sent", payload: { fired_at: "2026-10-21T15:40:03Z", condition_plain: "Last price above 230.00", source_asof: "2026-10-21T16:30:04Z" } }];
    const receipts = receiptsFrom([alertRow({})], outbox, link.investigation_id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toEqual({
      fire_event_id: FIRE, alert_id: "alert-1", fired_at: "2026-10-21T15:40:03Z",
      condition_plain: "Last price above 230.00", observed: 230.12, source_note: "price 230.12 above 230 (hub)",
      vintage: "2026-10-21T16:30:04Z", delivery: "sent", corrects: null,
    });
    expect(projectReview([{ revision: 3, manifest: manifest() }], null, receipts).fired?.fire_event_id).toBe(FIRE);
    // No outbox read: one honest row per fired alert, the id left null for the view to word.
    const without = receiptsFrom([alertRow({})], null, link.investigation_id);
    expect(without).toEqual([{ fire_event_id: null, alert_id: "alert-1", fired_at: "2026-10-21T15:40:03Z", condition_plain: null, observed: 230.12, source_note: "price 230.12 above 230 (hub)", vintage: null, delivery: null, corrects: null }]);
    expect(receiptsFrom([alertRow({ condition: { type: "price", op: "above", value: 230 } })], null, link.investigation_id)).toEqual([]);
  });

  it("lists a correcting receipt after the receipt it corrects, never in its place", () => {
    const outbox = [
      { alert_id: "alert-1", fire_event_id: CORRECTED_FIRE, status: "sent", payload: { fired_at: "2026-10-21T16:05:00Z", source_asof: "2026-10-21T16:05:00Z", corrects: { lane: "alerts_engine", id: FIRE } } },
      { alert_id: "alert-1", fire_event_id: FIRE, status: "sent", payload: { fired_at: "2026-10-21T15:40:03Z", source_asof: "2026-10-21T15:40:03Z" } },
    ];
    const receipts: FireReceipt[] = receiptsFrom([alertRow({})], outbox, link.investigation_id);
    expect(receipts.map(r => r.fire_event_id)).toEqual([CORRECTED_FIRE, FIRE]);
    const view = projectReview([{ revision: 3, manifest: manifest() }], null, receipts);
    expect(view.fired?.fire_event_id).toBe(CORRECTED_FIRE);
    expect(view.fired?.corrects).toEqual({ lane: "alerts_engine", id: FIRE });
    // The corrected receipt is still listed; the correction never replaced it.
    expect(view.fired?.fired_at).toBe("2026-10-21T16:05:00Z");
    expect(receipts.some(r => r.fire_event_id === FIRE && !r.corrects)).toBe(true);
  });
});

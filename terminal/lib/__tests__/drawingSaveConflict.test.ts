import { describe, expect, it } from "vitest";
import {
  applyDrawingSaveConflict,
  classifyDrawingSaveConflict,
  drawingSaveConflictCopy,
  drawingSaveIssueFromConflict,
  drawingSaveIssueFromEntry,
  drawingSaveIssueFromLoadPark,
  drawingSaveIssueOffersReplace,
  drawingSaveRecoveryMessage,
} from "@/lib/drawingSaveConflict";
import type { DrawingJournalEntry } from "@/lib/drawingPersistence";

describe("classifyDrawingSaveConflict", () => {
  it("parks only a revision conflict for replace/use-cloud", () => {
    expect(classifyDrawingSaveConflict("revision_conflict")).toEqual({
      kind: "revision_conflict",
      offerReplace: true,
    });
  });
  it("fails closed on owner_conflict without offering replace", () => {
    expect(classifyDrawingSaveConflict("owner_conflict")).toEqual({
      kind: "owner_conflict",
      offerReplace: false,
    });
  });
  it("treats a payload mismatch as an explicit choice, not a silent overwrite", () => {
    expect(classifyDrawingSaveConflict("operation_payload_mismatch")).toEqual({
      kind: "operation_payload_mismatch",
      offerReplace: true,
    });
  });
  it("fails closed when the 409 body has no code", () => {
    expect(classifyDrawingSaveConflict(undefined)).toEqual({ kind: "unknown", offerReplace: false });
    expect(classifyDrawingSaveConflict("other")).toEqual({ kind: "unknown", offerReplace: false });
  });
});

describe("drawing save conflict copy", () => {
  it("keeps owner-change copy in plain language in English and Chinese", () => {
    const en = drawingSaveConflictCopy("owner", "en");
    const zh = drawingSaveConflictCopy("owner", "zh");
    expect(en).toMatch(/different account/i);
    expect(en).toMatch(/kept on this device/i);
    expect(zh).toMatch(/另一个账户/);
    expect(zh).toMatch(/此设备/);
    expect(zh).not.toBe(en);
    for (const text of [en, zh]) {
      expect(text).not.toMatch(/owner_conflict|revision_conflict|operation_payload_mismatch/);
    }
  });
  it("maps issues onto replace vs fail-closed recovery chrome", () => {
    expect(drawingSaveIssueFromConflict("owner_conflict", false)).toBe("owner_conflict");
    expect(drawingSaveIssueFromConflict("operation_payload_mismatch", false)).toBe("payload_mismatch");
    expect(drawingSaveIssueFromConflict("revision_conflict", true)).toBe("conflict_unknown");
    expect(drawingSaveIssueOffersReplace("owner_conflict")).toBe(false);
    expect(drawingSaveIssueOffersReplace("save_rejected")).toBe(false);
    expect(drawingSaveIssueOffersReplace("conflict")).toBe(true);
    expect(drawingSaveIssueOffersReplace("payload_mismatch")).toBe(true);
    expect(drawingSaveIssueOffersReplace("conflict_unknown")).toBe(true);
    expect(drawingSaveIssueOffersReplace("preload")).toBe(true);
  });
  it("does not use the replace chrome copy for an account change", () => {
    const t = (key: string) => key;
    expect(drawingSaveRecoveryMessage("owner_conflict", "en", t)).toBe(drawingSaveConflictCopy("owner", "en"));
    expect(drawingSaveRecoveryMessage("owner_conflict", "zh", t)).toBe(drawingSaveConflictCopy("owner", "zh"));
  });
  it("describes a parked pre-load copy in plain language and offers keep-mine / keep-saved", () => {
    const t = (key: string) => key;
    expect(drawingSaveRecoveryMessage("preload", "en", t)).toBe(drawingSaveConflictCopy("preload", "en"));
    expect(drawingSaveRecoveryMessage("preload", "zh", t)).toBe(drawingSaveConflictCopy("preload", "zh"));
    expect(drawingSaveConflictCopy("preload", "en")).toMatch(/before your saved drawings finished loading/i);
    expect(drawingSaveConflictCopy("preload", "zh")).toMatch(/载入完成前/);
    expect(drawingSaveIssueOffersReplace("preload")).toBe(true);
  });
  it("maps each load-park reason to the matching issue and recovery sentence", () => {
    const t = (key: string) => key === "drawingSaveConflict"
      ? "The cloud copy changed, or local recovery needs review. Your local drawings are kept. Choose which copy to use."
      : key;
    expect(drawingSaveIssueFromLoadPark("preload")).toBe("preload");
    expect(drawingSaveRecoveryMessage(drawingSaveIssueFromLoadPark("preload"), "en", t)).toBe(drawingSaveConflictCopy("preload", "en"));
    expect(drawingSaveRecoveryMessage(drawingSaveIssueFromLoadPark("preload"), "zh", t)).toBe(drawingSaveConflictCopy("preload", "zh"));

    expect(drawingSaveIssueFromLoadPark("overlap")).toBe("conflict");
    expect(drawingSaveIssueFromLoadPark("overlap", "conflict")).toBe("conflict");
    const overlapEn = drawingSaveRecoveryMessage(drawingSaveIssueFromLoadPark("overlap"), "en", t);
    const overlapZh = drawingSaveRecoveryMessage(drawingSaveIssueFromLoadPark("overlap"), "zh", t);
    expect(overlapEn).toBe(t("drawingSaveConflict"));
    expect(overlapZh).toBe(t("drawingSaveConflict"));
    expect(overlapEn).not.toMatch(/before your saved drawings finished loading/i);
    expect(drawingSaveIssueOffersReplace(drawingSaveIssueFromLoadPark("overlap"))).toBe(true);

    expect(drawingSaveIssueFromLoadPark("conflict")).toBe("conflict");
    expect(drawingSaveIssueFromLoadPark("conflict", "legacy")).toBe("legacy");
    expect(drawingSaveRecoveryMessage(drawingSaveIssueFromLoadPark("conflict"), "en", t)).toBe(t("drawingSaveConflict"));

    expect(drawingSaveIssueFromLoadPark("too_many")).toBe("too_many");
    expect(drawingSaveIssueOffersReplace("too_many")).toBe(false);
    const tooManyEn = drawingSaveRecoveryMessage("too_many", "en", t);
    const tooManyZh = drawingSaveRecoveryMessage("too_many", "zh", t);
    expect(tooManyEn).toMatch(/500/);
    expect(tooManyEn).toMatch(/saved drawings are kept/i);
    expect(tooManyEn).toMatch(/stay on this device/i);
    expect(tooManyEn).not.toMatch(/before your saved drawings finished loading/i);
    expect(tooManyZh).toMatch(/500/);
    expect(tooManyZh).toMatch(/已保存/);
    expect(tooManyZh).toMatch(/此设备/);
    expect(tooManyZh).not.toBe(tooManyEn);
  });
  it("parks the local journal copy and records the 409 code", () => {
    const owner: DrawingJournalEntry = { drawings: [] };
    expect(applyDrawingSaveConflict(owner, { ok: false, code: "owner_conflict" })).toBe("owner_conflict");
    expect(owner.blocked).toBe("conflict");
    expect(owner.conflictCode).toBe("owner_conflict");
    expect(drawingSaveIssueFromEntry(owner)).toBe("owner_conflict");

    const mismatch: DrawingJournalEntry = { drawings: [] };
    expect(applyDrawingSaveConflict(mismatch, { ok: false, code: "operation_payload_mismatch" })).toBe("payload_mismatch");
    expect(mismatch.blocked).toBe("conflict");
    expect(mismatch.conflictCode).toBe("operation_payload_mismatch");

    const lost: DrawingJournalEntry = { drawings: [] };
    expect(applyDrawingSaveConflict(lost, { ok: false, code: "revision_conflict", operationUnknownPossible: true })).toBe("conflict_unknown");
    expect(lost.operationUnknownPossible).toBe(true);
    expect(lost.conflictCode).toBe("revision_conflict");
  });
});

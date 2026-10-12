import { describe, expect, it } from "vitest";
import {
  applyDrawingSaveConflict,
  classifyDrawingSaveConflict,
  drawingSaveConflictCopy,
  drawingSaveIssueChoices,
  drawingSaveIssueFromConflict,
  drawingSaveIssueFromEntry,
  drawingSaveIssueFromLoadPark,
  drawingSaveIssueOffersReplace,
  drawingSaveRecoveryMessage,
} from "@/lib/drawingSaveConflict";
import type { DrawingJournalEntry } from "@/lib/drawingPersistence";
import { readDrawingJournal, writeDrawingJournal, type DrawingJournalLocks } from "@/lib/drawingOutbox";

let lockTail = Promise.resolve();
const locks = {
  request: (_name: string, fn: () => unknown) => {
    const task = lockTail.then(fn);
    lockTail = task.then(() => {}, () => {});
    return task;
  },
} as DrawingJournalLocks;
class MemoryStorage {
  values = new Map<string, string>();
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
}

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
    expect(tooManyEn).toMatch(/new drawings were not saved/i);
    expect(tooManyEn).toMatch(/stay on this device/i);
    expect(tooManyEn).toMatch(/use cloud copy/i);
    expect(tooManyEn).toMatch(/delete saved drawings before adding new ones/i);
    expect(tooManyEn).not.toMatch(/before your saved drawings finished loading/i);
    expect(tooManyZh).toMatch(/500/);
    expect(tooManyZh).toMatch(/未保存/);
    expect(tooManyZh).toMatch(/此设备/);
    expect(tooManyZh).toMatch(/云端副本/);
    expect(tooManyZh).not.toBe(tooManyEn);
  });
  it("offers only Use cloud copy / Review cloud copy for too_many — never Replace cloud with local copy", () => {
    // The cap cannot be replaced by the smaller local copy; that would just delete
    // the 500 saved drawings. Use cloud copy is the only exit once the copy is loaded.
    expect(drawingSaveIssueChoices("too_many", true)).toEqual(["use_cloud"]);
    expect(drawingSaveIssueChoices("too_many", false)).toEqual(["review_cloud"]);
    expect(drawingSaveIssueChoices("too_many", true)).not.toContain("keep_local");
    expect(drawingSaveIssueChoices("too_many", false)).not.toContain("keep_local");
    expect(drawingSaveIssueChoices("too_many", true)).not.toContain("retry_save");
    expect(drawingSaveIssueChoices("too_many", false)).not.toContain("retry_save");
  });
  it("keeps the existing keep-mine / keep-saved choices for non-too_many issues", () => {
    // The recovery chrome for non-cap conflicts stays unchanged: with a cloud
    // copy loaded the user can keep the local copy or use the cloud; without
    // it, they can review the cloud copy first.
    const replaceIssues = ["conflict", "conflict_unknown", "payload_mismatch", "preload", "overlap", "multiple", "legacy"];
    for (const issue of replaceIssues) {
      expect(drawingSaveIssueChoices(issue, true)).toEqual(["use_cloud", "keep_local"]);
      expect(drawingSaveIssueChoices(issue, false)).toEqual(["review_cloud"]);
    }
    expect(drawingSaveIssueChoices("retry", true)).toEqual(["retry_save"]);
    expect(drawingSaveIssueChoices("storage", false)).toEqual(["retry_save"]);
    expect(drawingSaveIssueChoices("owner_conflict", true)).toEqual([]);
    expect(drawingSaveIssueChoices("save_rejected", false)).toEqual([]);
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

describe("P0 unrecognised 409 stays save_rejected through catch and reload", () => {
  const unrecognisedPayloads: unknown[] = [
    null,
    { ok: false },
    { code: "quota_exceeded" },
  ];

  it("apply + catch overwrite (drawingSaveIssueFromEntry) stay save_rejected with no Replace", () => {
    for (const payload of unrecognisedPayloads) {
      const entry: DrawingJournalEntry = { drawings: [] };
      const thrownIssue = applyDrawingSaveConflict(entry, payload);
      expect(thrownIssue).toBe("save_rejected");
      const catchIssue = drawingSaveIssueFromEntry(entry) ?? "retry";
      expect(catchIssue).toBe("save_rejected");
      expect(drawingSaveIssueOffersReplace(catchIssue)).toBe(false);
      expect(entry.blocked).toBe("conflict");
      expect(entry.conflictCode).toBe("unknown");
    }
  });

  it("journal restore of an unrecognised 409 stays save_rejected with no Replace", async () => {
    const storage = new MemoryStorage();
    const entry: DrawingJournalEntry = { drawings: [], revision: null };
    expect(applyDrawingSaveConflict(entry, { ok: false, code: "quota_exceeded" })).toBe("save_rejected");
    expect(await writeDrawingJournal(storage, "account:a", { NVDA: entry }, locks)).toBe(true);
    const recovered = readDrawingJournal(storage, "account:a").NVDA;
    const restoredIssue = drawingSaveIssueFromEntry(recovered);
    expect(restoredIssue).toBe("save_rejected");
    expect(drawingSaveIssueOffersReplace(restoredIssue!)).toBe(false);
  });

  it("a previous-build blocked:conflict entry with no conflictCode still offers Replace", () => {
    const legacy = drawingSaveIssueFromEntry({ blocked: "conflict" });
    expect(legacy).toBe("conflict");
    expect(drawingSaveIssueOffersReplace(legacy!)).toBe(true);
  });

  it("owner_conflict still fails closed and revision_conflict still offers Replace", () => {
    const owner: DrawingJournalEntry = { drawings: [] };
    expect(applyDrawingSaveConflict(owner, { ok: false, code: "owner_conflict" })).toBe("owner_conflict");
    expect(drawingSaveIssueFromEntry(owner)).toBe("owner_conflict");
    expect(drawingSaveIssueOffersReplace("owner_conflict")).toBe(false);

    const revision: DrawingJournalEntry = { drawings: [] };
    expect(applyDrawingSaveConflict(revision, { ok: false, code: "revision_conflict" })).toBe("conflict");
    expect(drawingSaveIssueFromEntry(revision)).toBe("conflict");
    expect(drawingSaveIssueOffersReplace("conflict")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeDrawings, type Drawing } from "../drawings";
import { translate, type AiObject } from "../chartBus";
import { aiDrawingCollectionError, drawingSourceConflict, readStoredAiDrawing,
  readDrawingRecovery, replaceAiPartition, storeAiDrawing, storedAiLayerHidden, storedAiObjects } from "../drawingAiPersistence";
import { DRAWING_JOURNAL_KEY, readDrawingJournal, writeDrawingJournal, type DrawingJournalLocks } from "../drawingOutbox";
import { prepareDrawingAttempt } from "../drawingPersistence";

const human: Drawing = { id: "human", kind: "hline", schemaVersion: 1, source: "user", points: [{ t: "2026-01-01", p: 100 }] };
const legacyKey = "mm.drawing.account-outbox.v1";
const operationId = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
let lockTail = Promise.resolve();
const locks = { request: (_name: string, fn: () => unknown) => {
  const task = lockTail.then(fn); lockTail = task.then(() => {}, () => {}); return task;
} } as DrawingJournalLocks;
function ai(id = "ai_fib"): AiObject {
  const result = translate({ on: true, v: 2, batch_id: "saved-analysis", seq: 3, op: "draw.tool", id,
    caption: "Retracement with custom levels", args: { kind: "fib",
      points: [{ t: 1767225600, p: 80 }, { t: 1769817600, p: 120 }],
      fibonacci: { levels: [-.5, 0, .5, 1, 1.618], reverse: true, labels: "both" },
    } }, { tfs: ["D"], indicators: [] });
  if (!result.ok || !result.draw?.[0]) throw new Error("fixture translation failed");
  return result.draw[0];
}
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("canonical AI drawing persistence", () => {
  it("round-trips native geometry, custom Fibonacci settings, provenance and both visibility levels", () => {
    const object = { ...ai(), hidden: true };
    const encoded = storeAiDrawing(object, true);
    const decoded = readStoredAiDrawing(normalizeDrawings(JSON.parse(JSON.stringify([encoded])))[0])!;
    expect(decoded).toMatchObject({ by: "ai", source: "ai", command_id: "ai_fib",
      batch_id: "saved-analysis", seq: 3, op: "draw.tool", caption: object.caption, hidden: true });
    expect(decoded.points).toEqual(object.points);
    expect(decoded.meta?.fibLevelStyles).toEqual(object.meta?.fibLevelStyles);
    expect(decoded.meta?.fibReverse).toBe(true);
    expect(storedAiLayerHidden([decoded])).toBe(true);
    const shown = readStoredAiDrawing(storeAiDrawing(decoded, false))!;
    expect(shown.hidden).toBe(true);
    expect(storedAiLayerHidden([shown])).toBe(false);
    expect((shown as Record<string, unknown>).target).toBeUndefined();
  });

  it("preserves the human partition and rejects a cross-source id collision without replacing it", () => {
    const added = replaceAiPartition([human], [ai()], false);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.drawings[0]).toBe(human);
    const cleared = replaceAiPartition(added.drawings, [], false);
    expect(cleared).toEqual({ ok: true, drawings: [human] });
    const collision = { ...human, id: "ai_fib" };
    expect(replaceAiPartition([collision], [ai()], false)).toEqual({ ok: false, error: "duplicate_drawing_id" });
  });

  it("applies the combined 500-object cap and the separate 60-AI cap without truncating", () => {
    const humans = Array.from({ length: 498 }, (_, i) => ({ ...human, id: "human_" + i }));
    expect(replaceAiPartition(humans, [ai("ai_a"), ai("ai_b")], false).ok).toBe(true);
    expect(replaceAiPartition(humans, [ai("ai_a"), ai("ai_b"), ai("ai_c")], false))
      .toEqual({ ok: false, error: "drawing_collection_limit" });
    expect(replaceAiPartition([], Array.from({ length: 61 }, (_, i) => ai("ai_" + i)), false))
      .toEqual({ ok: false, error: "ai_object_limit" });
    expect(humans).toHaveLength(498);
  });

  it.each([
    { schema: "unknown" }, { op: "chart.set_symbol" }, { command_id: "human" },
    { batch_id: "x".repeat(41) }, { seq: -1 }, { seq: .5 },
    { caption: "x".repeat(141) }, { caption: "bad\ncaption" }, { target: "replay me" },
  ])("refuses invalid stored provenance %j", change => {
    const stored = storeAiDrawing(ai(), false);
    stored.meta = { ...stored.meta, chart_ai: { ...(stored.meta!.chart_ai as object), ...change } };
    expect(readStoredAiDrawing(stored)).toBeNull();
    expect(aiDrawingCollectionError([stored])).toBe("invalid_ai_drawing");
  });

  it("refuses malformed AI anchors before normalization can drop a point", () => {
    expect(() => storeAiDrawing({ ...ai(), points: [
      { t: "1767225600", p: 80 }, { t: "1769817600", p: 120 }, { t: "bad", p: NaN },
    ] }, false)).toThrow();
  });

  it.each(["1.7e9", "0x6553f100", "1700000000.5"])("rejects noncanonical AI time %s", time => {
    const object = ai();
    object.points = [{ ...object.points[0], t: time }, object.points[1]];
    expect(() => storeAiDrawing(object, false)).toThrow();
  });

  it("rejects an array-valued middle time before a legal polyline could be shortened", () => {
    const malformed = { ...ai(), kind: "polyline", points: [
      { t: "1700000000", p: 100 }, { t: [1700000600], p: 105 }, { t: "1700001200", p: 110 },
    ] } as unknown as AiObject;
    expect(() => storeAiDrawing(malformed, false)).toThrow("invalid_ai_drawing");
    const encoded = { ...storeAiDrawing(ai(), false), kind: "polyline", points: malformed.points };
    expect(readDrawingRecovery([human, encoded])).toBeNull();
  });

  it("leaves the durable v2 journal unchanged when any raw object or anchor is invalid", async () => {
    const storage = new MemoryStorage();
    const good = storeAiDrawing(ai(), false);
    const journal = readDrawingJournal(storage, "account:a");
    journal.NVDA = { drawings: [human, good], revision };
    expect(await writeDrawingJournal(storage, "account:a", journal, locks, null)).toBe(true);
    const before = storage.getItem(DRAWING_JOURNAL_KEY);
    const malformed = { ...good, points: [...good.points, { t: "bad", p: NaN }] };
    journal.NVDA.drawings = [human, malformed];
    expect(await writeDrawingJournal(storage, "account:a", journal, locks, null)).toBe(false);
    expect(storage.getItem(DRAWING_JOURNAL_KEY)).toBe(before);
    journal.NVDA.drawings = [human, {} as Drawing];
    expect(await writeDrawingJournal(storage, "account:a", journal, locks, null)).toBe(false);
    expect(storage.getItem(DRAWING_JOURNAL_KEY)).toBe(before);
  });

  it("does not infer source ownership through contradictory markers", () => {
    expect(drawingSourceConflict({ ...human, source: "unknown" })).toBe(true);
    expect(drawingSourceConflict({ ...human, source: ["user"] })).toBe(true);
    expect(drawingSourceConflict({ ...human, meta: { chart_ai: {} } })).toBe(true);
    expect(drawingSourceConflict({ ...human, id: "ai_forged" })).toBe(true);
    expect(drawingSourceConflict({ ...human, id: " ai_reserved" })).toBe(true);
    expect(readDrawingRecovery([{ ...human, id: " ai_reserved" }])).toBeNull();
    expect(drawingSourceConflict(human)).toBe(false);
  });

  it("keeps the existing v2 mixed journal and exact attempts separate from legacy user-only imports", async () => {
    const storage = new MemoryStorage();
    storage.setItem(legacyKey, JSON.stringify({
      "account:legacy": { OLD: [], NVDA: [human] },
      "account:old-email@example.com": { NVDA: [human] },
    }));
    const legacyBytes = storage.getItem(legacyKey);
    expect(readDrawingJournal(storage, "account:legacy")).toMatchObject({
      OLD: { drawings: [], blocked: "legacy" }, NVDA: { drawings: [human], blocked: "legacy" },
    });
    const stored = storeAiDrawing({ ...ai(), hidden: true }, true);
    const journal = readDrawingJournal(storage, "account:uuid-a");
    journal.NVDA = { drawings: [human, stored], revision };
    const attempt = prepareDrawingAttempt(journal.NVDA, () => operationId)!;
    journal.NVDA.drawings = [human];
    expect(await writeDrawingJournal(storage, "account:uuid-a", journal, locks, null)).toBe(true);
    const recovered = readDrawingJournal(storage, "account:uuid-a").NVDA;
    expect(recovered.drawings).toEqual([human]);
    expect(prepareDrawingAttempt(recovered, () => { throw new Error("must reuse exact operation"); })).toEqual(attempt);
    expect(storedAiObjects(recovered.attempt!.drawings)[0].hidden).toBe(true);
    expect(readDrawingJournal(storage, "account:uuid-b")).toEqual({});
    expect(storage.getItem(legacyKey)).toBe(legacyBytes);
    expect(readDrawingJournal(storage, "account:old-email@example.com").NVDA.drawings[0].id).toBe("human");
  });
});

import { describe, expect, it } from "vitest";
import { cleanCaption, translate, type AiObject } from "../chartBus";
import { AI_DRAWING_SCHEMA, readStoredAiDrawing, storeAiDrawing, storedAiKindMatchesOperation } from "../drawingAiPersistence";
import { parseDrawingSnapshot, parsePersistedDrawings, prepareDrawingAttempt, type DrawingJournalEntry } from "../drawingPersistence";
import { DRAWING_JOURNAL_KEY, readDrawingJournal, writeDrawingJournal, type DrawingJournalLocks } from "../drawingOutbox";
import type { Drawing } from "../drawings";

const op = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const manual: Drawing = { id: "human", schemaVersion: 1, source: "user", kind: "hline", points: [{ t: "2026-01-01", p: 100 }] };
const ai = () => storeAiDrawing({
  id: "ai_child", command_id: "ai_parent", by: "ai", source: "ai", auto: true,
  kind: "hline", points: [{ t: "1700000000", p: 101 }],
  op: "draw.hline", batch_id: "saved", seq: 2, caption: "Level",
} as AiObject, false);
const snapshot = (drawings: Drawing[], aiDrawingSchema?: string) =>
  ({ drawings, revision: drawings.length ? revision : null, schemaVersion: 1, aiDrawingSchema });
class Storage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
let tail = Promise.resolve();
const locks = { request: (_name: string, run: () => unknown) => {
  const task = tail.then(run); tail = task.then(() => {}, () => {}); return task;
} } as DrawingJournalLocks;

describe("installed AI drawing capability and exact mixed snapshots", () => {
  it("requires the SQL read literal for mixed snapshots, including valid restored provenance", () => {
    const drawings = [manual, ai()];
    expect(parseDrawingSnapshot(snapshot(drawings))).toBeNull();
    expect(parseDrawingSnapshot(snapshot(drawings, "chart.ai_drawing.v999"))).toBeNull();
    const accepted = parseDrawingSnapshot(snapshot(drawings, AI_DRAWING_SCHEMA))!;
    expect(accepted.aiDrawingSchema).toBe(AI_DRAWING_SCHEMA);
    expect(accepted.drawings).toBe(drawings);
    expect(accepted.drawings[1]).toBe(drawings[1]);
  });
  it("keeps human reads available without promoting an absent or unknown capability", () => {
    for (const capability of [undefined, "chart.ai_drawing.v999"]) {
      expect(parseDrawingSnapshot(snapshot([manual], capability))?.drawings).toEqual([manual]);
      expect(parseDrawingSnapshot(snapshot([manual], capability))?.aiDrawingSchema).toBeUndefined();
    }
    expect(parseDrawingSnapshot(snapshot([], AI_DRAWING_SCHEMA))?.aiDrawingSchema).toBe(AI_DRAWING_SCHEMA);
  });
  it("does not normalize attempted numeric anchors or arbitrary admitted metadata", () => {
    const drawing = ai();
    (drawing.points[0] as unknown as { t: number }).t = 1700000000;
    drawing.meta = { ...drawing.meta, label: "保持", custom: { x: "unchanged" } };
    const drawings = [manual, drawing];
    const bytes = JSON.stringify(drawings);
    expect(parsePersistedDrawings(drawings)).toBe(drawings);
    expect(JSON.stringify(drawings)).toBe(bytes);
  });
  it("allows independently retained children and repeated sequence numbers without inventing sibling requirements", () => {
    const first = ai(), second = ai();
    second.id = "ai_other_child";
    expect(parsePersistedDrawings([first, second])).not.toBeNull();
    expect(readStoredAiDrawing(first)?.command_id).toBe("ai_parent");
  });
  it.each(["unknown", "draw.set_symbol", "chart.set_symbol"])("rejects an unsupported stored operation %s", operation => {
    const drawing = ai();
    (drawing.meta!.chart_ai as Record<string, unknown>).op = operation;
    expect(parsePersistedDrawings([drawing])).toBeNull();
  });
  it.each([
    ["trendline", "draw.channel", true], ["trendline", "draw.path", true],
    ["hline", "draw.risk_box", true], ["rect", "draw.risk_box", true],
    ["text", "draw.marker", true], ["rect", "draw.label", false],
    ["ray", "draw.hline", false], ["anchoredvwap", "draw.tool", false],
  ] as const)("keeps translator kind/op compatibility: %s %s", (kind, operation, expected) => {
    expect(storedAiKindMatchesOperation(kind, operation)).toBe(expected);
  });
  it("rejects contradictory sources and inconsistent layer visibility without dropping one row", () => {
    const first = ai(), second = storeAiDrawing({ ...readStoredAiDrawing(ai())!, id: "ai_second" }, true);
    expect(parsePersistedDrawings([manual, first, second])).toBeNull();
    for (const change of [{ by: "user" }, { auto: false }, { source: "user" }]) {
      expect(parsePersistedDrawings([{ ...first, ...change }])).toBeNull();
    }
  });
});

describe("Unicode and epoch boundaries before mixed persistence", () => {
  it.each(["id", "command_id", "batch_id", "caption", "text", "label", "nested"] as const)(
    "refuses an unpaired surrogate in %s without repairing attempted JSON", field => {
      const drawing = ai();
      const value = field === "id" || field === "command_id" ? "ai_\ud800" : "\ud800";
      if (field === "id" || field === "text") (drawing as unknown as Record<string, unknown>)[field] = value;
      else if (field === "label" || field === "nested") drawing.meta = { ...drawing.meta, [field]: field === "nested" ? { value } : value };
      else (drawing.meta!.chart_ai as Record<string, unknown>)[field] = value;
      const bytes = JSON.stringify(drawing);
      expect(readStoredAiDrawing(drawing)).toBeNull();
      expect(parsePersistedDrawings([drawing])).toBeNull();
      expect(JSON.stringify(drawing)).toBe(bytes);
    });
  it("retains complete emoji at the 140-unit boundary and never splits a fresh label", () => {
    expect(cleanCaption("x".repeat(138) + "😀")).toBe("x".repeat(138) + "😀");
    expect(cleanCaption("x".repeat(139) + "😀")).toBe("x".repeat(139));
    for (const operation of ["draw.label", "draw.hline", "draw.trendline"] as const) {
      const translated = translate({ on: true, v: 2, op: operation, id: "ai_text", batch_id: "unicode", seq: 0,
        caption: "x".repeat(139) + "😀", args: { p: 101, at: 1700000000,
          p1: { t: 1700000000, p: 100 }, p2: { t: 1700000600, p: 102 }, text: "x".repeat(139) + "😀" } },
      { tfs: ["D"], indicators: [] });
      expect(translated.ok).toBe(true);
      if (!translated.ok || !translated.draw) throw new Error("translation refused");
      const stored = storeAiDrawing(translated.draw[0], false);
      expect(readStoredAiDrawing(stored)?.caption).toBe("x".repeat(139));
      expect(stored.text ?? stored.meta?.label).toBe("x".repeat(139));
    }
  });
  it.each(["1700000000.0", "1.7e9", "+1700000000", " 1700000000", "1700000000.5", "631151999", "4102444801"])(
    "refuses noncanonical or out-of-range string epoch %s", time => {
      const drawing = ai(); drawing.points[0].t = time;
      expect(readStoredAiDrawing(drawing)).toBeNull();
    });
  it.each([631152000, 1700000000, 4102444800])("accepts the integer numeric epoch %s without conversion", time => {
    const drawing = ai();
    (drawing.points[0] as unknown as { t: number }).t = time;
    expect(parsePersistedDrawings([drawing])?.[0].points[0].t).toBe(time);
  });
});

describe("mixed v2 replay retains the incumbent journal fences", () => {
  it("replays an exact mixed attempt after newer human edits and a reload", async () => {
    const storage = new Storage(), journal = readDrawingJournal(storage, "account:a");
    const entry: DrawingJournalEntry = { drawings: [manual, ai()], revision };
    journal.NVDA = entry;
    const attempted = prepareDrawingAttempt(entry, () => op)!;
    const attemptedJson = JSON.stringify(attempted);
    entry.drawings = [manual];
    expect(await writeDrawingJournal(storage, "account:a", journal, locks, null)).toBe(true);
    const recovered = readDrawingJournal(storage, "account:a").NVDA;
    const replay = prepareDrawingAttempt(recovered, () => { throw new Error("new operation forbidden"); });
    expect(JSON.stringify(replay)).toBe(attemptedJson);
    expect(recovered.drawings).toEqual([manual]);
    expect(readDrawingJournal(storage, "account:b")).toEqual({});
  });
  it.each(["working", "attempt"] as const)("does not import or rewrite legacy AI %s bytes", async where => {
    const storage = new Storage();
    const raw = { drawings: where === "working" ? [manual, ai()] : [manual], revision,
      attempt: { operationId: op, expectedRevision: revision, drawings: [manual, ai()] } };
    const legacy = JSON.stringify({ "account:a": { NVDA: raw } });
    storage.setItem("mm.drawing.account-outbox.v1", legacy);
    expect(readDrawingJournal(storage, "account:a")).toEqual({});
    expect(await writeDrawingJournal(storage, "account:a", {}, locks, null)).toBe(false);
    expect(storage.getItem("mm.drawing.account-outbox.v1")).toBe(legacy);
    expect(storage.getItem(DRAWING_JOURNAL_KEY)).toBeNull();
  });
});

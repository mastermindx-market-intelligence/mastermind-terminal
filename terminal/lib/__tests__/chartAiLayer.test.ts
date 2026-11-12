import { describe, expect, it } from "vitest";
import { applyToStore, translate, updateIndicatorVisibility, type AiObject, type ChartCommandV2, type IndicatorSpec } from "@/lib/chartBus";
import { editAiObjects, groupAiDrawings } from "@/lib/chartAiLayer";

const caps = { tfs: ["D"], indicators: ["ema", "rsi", "macd"] };
const command = (overrides: Partial<ChartCommandV2> = {}): ChartCommandV2 => ({
  on: true, v: 2, op: "draw.path", id: "ai_structure", batch_id: "analysis", seq: 0,
  args: { points: Array.from({ length: 25 }, (_, index) => ({ t: 1721606400 + index * 86400, p: 100 + index })) },
  ...overrides,
});
const apply = (store: Record<string, AiObject[]>, cmd: ChartCommandV2) => applyToStore(store, "SYNTHETIC", cmd, translate(cmd, caps));

describe("logical AI drawing ownership", () => {
  it("counts a 24-segment path as one operation, while retaining the object budget", () => {
    const first = apply({}, command());
    expect(first.ack.ok).toBe(true);
    expect(first.store.SYNTHETIC).toHaveLength(24);
    const second = apply(first.store, command({ op: "draw.hline", id: "ai_level", seq: 1, args: { p: 110 } }));
    expect(second.ack.ok).toBe(true);
    expect(groupAiDrawings(second.store.SYNTHETIC)).toHaveLength(2);
    const over = apply(second.store, command({ id: "ai_over", seq: 2,
      args: { points: Array.from({ length: 40 }, (_, index) => ({ t: 1721606400 + index * 86400, p: 100 })) } }));
    expect(over.ack).toMatchObject({ ok: false, error: "object_cap_exceeded" });
    expect(over.store).toBe(second.store);
  });

  it("replaces a complete construction when its new geometry has fewer children", () => {
    const first = apply({}, command());
    const extra = apply(first.store, command({ op: "draw.hline", id: "ai_structure_note", seq: 1, args: { p: 101 } }));
    const revised = apply(extra.store, command({ batch_id: "revision", args: { points: [{ t: 1721606400, p: 99 }, { t: 1721692800, p: 110 }] } }));
    expect(revised.ack.ok).toBe(true);
    expect(revised.store.SYNTHETIC.map(object => object.id)).toEqual(["ai_structure_note", "ai_structure_0"]);
    expect(revised.store.SYNTHETIC[1].command_id).toBe("ai_structure");
  });

  it("never steals another object's exact id through a compound suffix", () => {
    const first = apply({}, command({ op: "draw.hline", id: "ai_structure_0", args: { p: 100 } }));
    expect(apply(first.store, command()).ack).toMatchObject({ ok: false, error: "ai_object_id_conflict" });
  });

  it("enforces 24 distinct drawing commands even when each has only one object", () => {
    let store: Record<string, AiObject[]> = {};
    for (let seq = 0; seq < 24; seq++) {
      const result = apply(store, command({ op: "draw.hline", id: `ai_${seq}`, seq, args: { p: 100 + seq } }));
      expect(result.ack.ok).toBe(true); store = result.store;
    }
    expect(apply(store, command({ op: "draw.hline", id: "ai_over", seq: 24, args: { p: 150 } })).ack)
      .toMatchObject({ ok: false, error: "batch_cap_exceeded" });
  });

  it("hides and deletes exact elements; stale selections leave the collection unchanged", () => {
    const objects = apply({}, command()).store.SYNTHETIC;
    const hidden = editAiObjects(objects, [objects[1].id], "hide")!;
    expect(hidden.filter(object => object.hidden).map(object => object.id)).toEqual([objects[1].id]);
    expect(objects.some(object => object.hidden)).toBe(false);
    const trimmed = editAiObjects(hidden, [objects[2].id], "remove")!;
    expect(trimmed).toHaveLength(23);
    expect(groupAiDrawings(trimmed)).toHaveLength(1);
    expect(editAiObjects(trimmed, [objects[0].id, objects[2].id], "remove")).toBeNull();
    expect(editAiObjects(trimmed, ["user_drawing"], "remove")).toBeNull();
  });
});

describe("indicator attachment and visibility are explicit", () => {
  const current: IndicatorSpec[] = [{ name: "ema", params: { ma1Len: 20 } }, { name: "rsi", params: { length: 14 } }, { name: "script:user" }];
  const edit = (args: Record<string, unknown>) => translate(command({ op: "chart.set_indicators", id: undefined,
    args: { mode: "patch", indicators: [], ...args } }), caps, current);

  it("can show an already configured RSI without losing its settings or other studies", () => {
    const result = edit({ show: ["rsi"] });
    expect(result).toMatchObject({ ok: true, setIndicators: current, indicatorVisibility: { show: ["rsi"], hide: [] } });
    expect(updateIndicatorVisibility(["rsi", "ema"], current, current, { show: ["rsi"], hide: [] })).toEqual(["ema"]);
  });

  it("keeps a hidden study hidden during a parameter edit, and shows newly attached studies", () => {
    const result = edit({ indicators: [{ name: "rsi", params: { length: 21 } }, { name: "macd" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(updateIndicatorVisibility(["rsi", "macd"], current, result.setIndicators!)).toEqual(["rsi"]);
    expect(result.setIndicators).toContainEqual({ name: "rsi", params: { length: 21 } });
    expect(result.setIndicators).toContainEqual({ name: "script:user", params: undefined });
  });

  it("hiding retains membership and removing drops stale visibility", () => {
    expect(edit({ hide: ["rsi"] })).toMatchObject({ ok: true, setIndicators: current });
    expect(updateIndicatorVisibility(["rsi"], current, current.filter(spec => spec.name !== "rsi"))).toEqual([]);
  });

  it.each([
    [{ show: ["rsi"], hide: ["rsi"] }, "conflicting_indicator_visibility"],
    [{ show: ["rsi", "rsi"] }, "bad_indicator_visibility"],
    [{ show: null }, "bad_indicator_visibility"],
    [{ hide: "rsi" }, "bad_indicator_visibility"],
    [{ show: ["invented"] }, "visibility_requires_attached_indicator"],
    [{ show: ["rsi"], remove: ["rsi"] }, "visibility_requires_attached_indicator"],
  ])("refuses ambiguous or invalid visibility edits: %j", (args, error) => {
    expect(edit(args as Record<string, unknown>)).toMatchObject({ ok: false, error });
  });
});

// @vitest-environment jsdom
import React, { act, useLayoutEffect, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChartBus, type ChartBus, type ChartBusHost } from "../useChartBus";
import { replaceAiPartition, storedAiObjects, storeAiDrawing } from "../drawingAiPersistence";
import type { Drawing } from "../drawings";
import type { AiObject } from "../chartBus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const manual: Drawing = { id: "human", source: "user", kind: "hline", points: [{ t: "2026-01-01", p: 90 }] };
const saved = (id = "ai_saved", hidden = false) => storeAiDrawing({
  id, by: "ai", source: "ai", command_id: id, op: "draw.hline", batch_id: "restored", seq: 0,
  kind: "hline", points: [{ t: "1767225600", p: 100 }], hidden, caption: "Stored level",
} as AiObject, false);
function owner(key: string, initial: Record<string, Drawing[]> = { NVDA: [manual] }) {
  return { key, generation: {}, origin: key + Math.random().toString(36).slice(2), collections: initial,
    writes: [] as Drawing[][], notify: () => {}, reject: "" };
}
type Owner = ReturnType<typeof owner>;
let bus: ChartBus;
let setters: ReturnType<typeof vi.fn>;
function Harness({ current, flushContext }: { current: Owner; flushContext?: () => void }) {
  const [, render] = useReducer(x => x + 1, 0);
  useLayoutEffect(() => {
    current.notify = () => render();
    return () => { current.notify = () => {}; };
  }, [current]);
  const host: ChartBusHost = {
    drawingOwner: {
      key: current.key, generation: current.generation, collections: current.collections,
      replaceAi: (symbol, objects, hidden) => {
        if (current.reject) return { ok: false, error: current.reject };
        const result = replaceAiPartition(current.collections[symbol] ?? [], objects, hidden);
        if (!result.ok) return result;
        current.collections = { ...current.collections, [symbol]: result.drawings };
        current.writes.push(result.drawings); current.notify();
        return { ok: true, objects: storedAiObjects(result.drawings) };
      },
    },
    activeSymbol: "NVDA", currentTf: "D", activePaneId: 0, bars: [],
    capabilities: { tfs: ["D"], indicators: ["rsi"] }, sessionIndicators: [],
    userDrawings: (current.collections.NVDA ?? []).filter(d => d.source === "user"),
    getContextIdentity: () => ({ origin_id: current.origin, context_revision: 1 }),
    setSymbol: setters, setTf: setters, setIndicators: setters, setRange: setters, flushContext,
  };
  const value = useChartBus(host);
  useLayoutEffect(() => { bus = value; });
  return null;
}
const command = (current: Owner, id = "ai_new", seq = 0) => ({
  on: true, v: 2, op: "draw.hline", id, batch_id: "active-plan", seq, args: { p: 110 },
  target: { schema: "chart.command_target.v1", origin_id: current.origin, context_revision: 1,
    symbol: "NVDA", tf: "D", pane_id: 0 },
});
const expected = (current: Owner) => ({ origin_id: current.origin, context_revision: 1 });

describe("canonical chart drawing owner lifecycle", () => {
  let container: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers(); setters = vi.fn();
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
  const mount = async (current: Owner, flushContext?: () => void) =>
    act(async () => root.render(<Harness current={current} flushContext={flushContext} />));

  it("hydrates stored AI without replaying commands, then preserves the human partition through edits", async () => {
    const current = owner("account:a", { NVDA: [manual, saved("ai_saved", true)] });
    await mount(current);
    expect(bus.legend.objects).toMatchObject([{ id: "ai_saved", hidden: true, batch_id: "restored" }]);
    expect(bus.aiDrawingsFor("NVDA")).toEqual([]);
    expect(current.writes).toHaveLength(0);
    expect(setters).not.toHaveBeenCalled();
    act(() => bus.legend.editObjects(["ai_saved"], "show"));
    expect(current.collections.NVDA[0]).toBe(manual);
    expect(bus.aiDrawingsFor("NVDA")).toHaveLength(1);
    act(() => bus.legend.clear());
    expect(current.collections.NVDA).toEqual([manual]);
  });

  it("retires paced commands, old inventory actions and dispatchers on A -> B -> A with identical chart identity", async () => {
    const a = owner("account:a", { NVDA: [manual, saved()] });
    await mount(a);
    const retired = bus, oldContext = bus.context!;
    retired.queue.delayMs = 1000;
    act(() => retired.dispatchV2(command(a)));
    const b = owner("account:b", { NVDA: [manual, saved()] });
    await mount(b);
    expect(bus.context).not.toBe(oldContext);
    const bContext = bus.context;
    act(() => {
      retired.legend.clear(); retired.legend.toggleHidden();
      retired.legend.editObjects(["ai_saved"], "remove");
      retired.dispatchV2(command(b));
      retired.noteViewport(0, { from: 1, to: 2 });
      retired.queue.applyInstantly();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(a.writes).toHaveLength(0); expect(b.writes).toHaveLength(0);
    expect(bus.legend.objects).toHaveLength(1); expect(retired.context).toBeNull();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(a.origin);
    const aAgain = owner("account:a", { NVDA: [manual, saved()] });
    await mount(aAgain);
    act(() => { retired.legend.clear(); retired.dispatchV2(command(aAgain)); });
    expect(aAgain.writes).toHaveLength(0);
    expect(bus.context).not.toBe(bContext);
    act(() => bus.dispatchV2(command(aAgain)));
    expect(aAgain.writes).toHaveLength(1);
    expect(bus.legend.count).toBe(2);
  });

  it("does not admit effects when flushContext commits a different principal while the command is on the stack", async () => {
    const a = owner("account:a"), b = owner("account:b");
    await mount(a, () => flushSync(() => root.render(<Harness current={b} />)));
    act(() => bus.dispatchV2(command(a)));
    expect(a.writes).toHaveLength(0); expect(b.writes).toHaveLength(0);
    expect(setters).not.toHaveBeenCalled();
    expect(bus.legend.count).toBe(0);
  });

  it("keeps failed local replacements out of the working store and emits an honest negative ACK", async () => {
    const current = owner("account:a"); current.reject = "drawing_collection_limit";
    await mount(current);
    act(() => bus.dispatchV2(command(current)));
    expect(bus.legend.count).toBe(0);
    current.reject = "";
    act(() => bus.dispatchV2(command(current, "ai_after", 1)));
    expect(bus.legend.objects.map(d => d.id)).toEqual(["ai_after"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.acks).toMatchObject([
      { id: "ai_new", ok: false, error: "drawing_collection_limit" }, { id: "ai_after", ok: true },
    ]);
  });

  it("refuses unresolved or failed initial loads while a known empty collection can prepare normally", async () => {
    const current = owner("account:a", {});
    await mount(current);
    let result: unknown;
    await act(async () => { result = await bus.prepareChartState(expected(current)); });
    expect(result).toEqual({ ok: false, reason: "state_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => bus.dispatchV2(command(current)));
    expect(current.writes).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => { current.collections = { NVDA: [] }; current.notify(); });
    await act(async () => { result = await bus.prepareChartState(expected(current)); });
    expect(result).toMatchObject({ ok: true, origin_id: current.origin });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).session.drawings).toEqual([]);
  });

  it.each(["resolve", "reject"] as const)("a late A POST %s cannot release B's held mirror or restore A's receipts", async outcome => {
    const held: Array<{ resolve: (response: { ok: boolean }) => void; reject: () => void }> = [];
    fetchMock.mockImplementation(() => new Promise((resolve, reject) => held.push({
      resolve, reject: () => reject(new Error("late failure")),
    })));
    const a = owner("account:a"); await mount(a);
    act(() => bus.dispatchV2(command(a)));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const aSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    const retired = bus;
    const b = owner("account:b"); await mount(b);
    expect(aSignal.aborted).toBe(true);
    let done = false, result: unknown;
    const prepared = bus.prepareChartState(expected(b)).then(value => { done = true; result = value; });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (outcome === "resolve") held[0].resolve({ ok: true }); else held[0].reject();
      await Promise.resolve();
    });
    expect(done).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).acks).toEqual([]);
    expect(await retired.prepareChartState(expected(a))).toMatchObject({ ok: false });
    await act(async () => { held[1].resolve({ ok: true }); await prepared; });
    expect(result).toMatchObject({ ok: true, origin_id: b.origin });
  });
});

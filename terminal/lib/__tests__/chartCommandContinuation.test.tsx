// @vitest-environment jsdom
import React, { act, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiContextProvider, type AiContextProvider } from "../aiContext";
import { ALL_OPS, CHART_COMMAND_TARGET_SCHEMA, type ChartCommandTarget, type IndicatorSpec, validateEnvelope } from "../chartBus";
import { useChartBus, type ChartBus } from "../useChartBus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Control = { bus: ChartBus; target: () => ChartCommandTarget; manualSettings: (len: number) => void; manualPane: (pane: number) => void };
let control: Control;
function Harness() {
  const provider = useRef<AiContextProvider | null>(null);
  if (!provider.current) provider.current = createAiContextProvider();
  const [symbol, setSymbol] = useState("NVDA");
  const [tf, setTf] = useState("D");
  const [pane, setPane] = useState(0);
  const [indicators, setIndicators] = useState<IndicatorSpec[]>([{ name: "rsi", params: { length: 14 } }]);
  const settingsKey = JSON.stringify(indicators);
  useLayoutEffect(() => provider.current!.noteContextChange({ symbol, timeframe: tf, paneId: pane, settingsKey }), [symbol, tf, pane, settingsKey]);
  const identity = () => provider.current!.getAiContext();
  const bus = useChartBus({
    activeSymbol: symbol, currentTf: tf, activePaneId: pane, bars: [], userDrawings: [],
    capabilities: { tfs: ["D", "W"], indicators: ["rsi", "ema"] }, sessionIndicators: indicators,
    getContextIdentity: identity,
    flushContext: () => flushSync(() => {}),
    setSymbol: s => flushSync(() => setSymbol(s)),
    setTf: value => flushSync(() => setTf(value)),
    setIndicators: value => flushSync(() => setIndicators(value)),
    setRange: () => true,
  });
  useLayoutEffect(() => {
    control = { bus, target: () => ({ schema: CHART_COMMAND_TARGET_SCHEMA,
      origin_id: identity().origin_id, context_revision: identity().context_revision,
      pane_id: pane, symbol, tf }),
      manualSettings: len => flushSync(() => setIndicators([{ name: "rsi", params: { length: len } }])),
      manualPane: value => flushSync(() => setPane(value)) };
  }, [bus, pane, symbol, tf]);
  return null;
}

function command(op: string, args: Record<string, unknown>, seq = 0, at = control.target()) {
  return { on: true, v: 2, batch_id: "continuation", seq, op, args,
    ...(op.startsWith("draw.") ? { id: "ai_line" } : {}), target: at };
}

describe("all chart effects require exact execution context", () => {
  for (const op of ALL_OPS.filter(op => !op.startsWith("scene."))) {
    it(op, () => {
      expect(validateEnvelope({ on: true, v: 2, batch_id: "b", seq: 0, op, id: "ai_required", args: {} }))
        .toMatchObject({ ok: false, error: "command_target_required" });
    });
  }
});

describe("committed chart command successor receipts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fetchMock.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function receipts() {
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    return fetchMock.mock.calls.flatMap(call => JSON.parse(String((call[1] as RequestInit).body)).acks);
  }
  it("reports the admitted predecessor and committed indicator successor", async () => {
    const before = control.target();
    act(() => control.bus.dispatchV2(command("chart.set_indicators", {
      mode: "patch", indicators: [{ name: "rsi", params: { length: 21 } }],
    })));
    const after = control.target();
    expect(after.context_revision).toBe(before.context_revision + 1);
    expect(await receipts()).toContainEqual(expect.objectContaining({
      ok: true, application: { schema: "chart.command_application.v1", predecessor: before, successor: after },
    }));
  });
  it("a manual settings edit invalidates a queued action on the same symbol and pane", async () => {
    const original = control.target();
    control.bus.queue.delayMs = 50;
    act(() => control.bus.dispatchV2(command("draw.hline", { p: 100 }, 0, original)));
    act(() => control.manualSettings(35));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(control.bus.aiDrawingsFor("NVDA")).toEqual([]);
    expect(await receipts()).toContainEqual(expect.objectContaining({ ok: false, error: "command_target_revision_mismatch" }));
  });
  it("switching away and back never restores an old pane revision", async () => {
    const original = control.target();
    act(() => control.manualPane(1));
    act(() => control.manualPane(0));
    expect(control.target().context_revision).toBe(original.context_revision + 2);
    act(() => control.bus.dispatchV2(command("draw.hline", { p: 100 }, 0, original)));
    expect(control.bus.aiDrawingsFor("NVDA")).toEqual([]);
    expect(await receipts()).toContainEqual(expect.objectContaining({ ok: false, error: "command_target_revision_mismatch" }));
  });
  it("a dependent action needs the symbol setter's committed successor", async () => {
    const before = control.target();
    act(() => control.bus.dispatchV2(command("chart.set_symbol", { symbol: "AAPL" }, 0, before)));
    const after = control.target();
    expect(after.symbol).toBe("AAPL");
    act(() => control.bus.dispatchV2(command("draw.hline", { p: 100 }, 1, before)));
    act(() => control.bus.dispatchV2(command("draw.hline", { p: 110 }, 2, after)));
    expect(control.bus.aiDrawingsFor("AAPL")).toHaveLength(1);
    const acks = await receipts();
    expect(acks).toContainEqual(expect.objectContaining({ seq: 0, ok: true,
      application: { schema: "chart.command_application.v1", predecessor: before, successor: after } }));
    expect(acks).toContainEqual(expect.objectContaining({ seq: 1, ok: false, error: "command_target_revision_mismatch" }));
    expect(acks).toContainEqual(expect.objectContaining({ seq: 2, ok: true }));
  });
});

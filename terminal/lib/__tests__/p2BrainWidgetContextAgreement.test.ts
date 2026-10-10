// @vitest-environment jsdom
// P2 source integration proof: compare #802's one mounted Chart Bus owner with
// the real BrainWidget singleton's live W1-C getter. The external mm_brain.js
// network script is NOT executed here, so this is not production Brain receipt proof.
import React, { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import BrainWidget from "@/components/BrainWidget";
import { useChartBus, type ChartBus, type ChartBusHost } from "@/lib/useChartBus";
import { createAiContextProvider, type AiContextClientV1 } from "@/lib/aiContext";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noOp = () => undefined;
const fetcher = vi.fn(async () => ({ ok: true }));
let provider: ReturnType<typeof createAiContextProvider>;
let bus: ChartBus;
let root: Root;
let container: HTMLDivElement;

function Mount({ symbol, timeframe }: { symbol: string; timeframe: string }) {
  const host: ChartBusHost = {
    activeSymbol: symbol, currentTf: timeframe, activePaneId: 0,
    bars: [], capabilities: { tfs: ["1D", "1W"], indicators: [] },
    sessionIndicators: [], userDrawings: [],
    getContextIdentity: () => {
      const c = provider.getAiContext();
      return { origin_id: c.origin_id, context_revision: c.context_revision };
    },
    setSymbol: vi.fn(), setTf: vi.fn(), setIndicators: vi.fn(), setRange: vi.fn(),
  };
  const owner = useChartBus(host);
  useLayoutEffect(() => {
    bus = owner;
    provider.noteContextChange({ symbol, timeframe });
  }, [owner, symbol, timeframe]);
  return React.createElement(BrainWidget, {
    active: symbol, onCommand: noOp, onAnnotate: noOp,
    getAiContext: provider.getAiContext,
  });
}
async function render(symbol: string, timeframe: string) {
  await act(async () => {
    root.render(React.createElement(StrictMode, null, React.createElement(Mount, { symbol, timeframe })));
  });
}
function brainRead(): () => AiContextClientV1 {
  const cfg = (window as unknown as MastermindBrainHost).MM_BRAIN_CFG;
  const getter = cfg?.getAiContext;
  expect(typeof getter).toBe("function");
  return getter as () => AiContextClientV1;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockClear();
  provider = createAiContextProvider({ symbol: "AAPL", timeframe: "1D" });
  const w = window as unknown as MastermindBrainHost & Record<string, unknown>;
  delete w.MM_BRAIN_CFG;
  delete w.MMBrain;
  delete w.__MM_BRAIN_ACTIVE_SYMBOL__;
  document.querySelectorAll('script[src*="mm_brain.js"]').forEach(el => el.remove());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll('script[src*="mm_brain.js"]').forEach(el => el.remove());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("P2 native Chart Bus / real BrainWidget getter compatibility", () => {
  it("reads the current widget's W1-C getter against the same mounted chart session after a symbol/timeframe change", async () => {
    await render("AAPL", "1D");
    const native = bus.context;
    const first = bus.readSemanticBrainCompatibility(brainRead());
    expect(first).toMatchObject({ status: "compatible", symbol: "AAPL", timeframe: "1D" });
    await render("NVDA", "1W");
    expect(bus.context).toBe(native);
    const after = bus.readSemanticBrainCompatibility(brainRead());
    expect(after).toMatchObject({ status: "compatible", symbol: "NVDA", timeframe: "1W" });
    if (first.status !== "compatible" || after.status !== "compatible") return;
    expect(after.chart.epoch).toBe(first.chart.epoch);
    expect(after.chart.group_revision).toBeGreaterThan(first.chart.group_revision);
    expect(after.brain.origin_id).toBe(first.brain.origin_id);
    expect(after.brain.context_revision).toBeGreaterThan(first.brain.context_revision);
    expect(native?.snapshot("active-chart")?.value).toEqual({
      kind: "security", id: "NVDA", timeframe: "1W", pane_id: 0,
    });
  });

  it("reports a Brain-only mismatch without changing chart state, pinning, or mirroring extra state", async () => {
    await render("AAPL", "1D");
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const writes = fetcher.mock.calls.length;
    const session = bus.context!;
    const saved = session.snapshot("active-chart");
    const receipts = session.receipts().length;
    provider.noteContextChange({ symbol: "NVDA", timeframe: "1D" });
    expect(bus.readSemanticBrainCompatibility(brainRead())).toEqual({
      status: "incompatible", reason: "symbol_mismatch",
    });
    provider.noteContextChange({ symbol: "AAPL", timeframe: "1D" });
    expect(bus.readSemanticBrainCompatibility(brainRead())).toMatchObject({ status: "compatible" });
    expect(session.snapshot("active-chart")).toEqual(saved);
    expect(session.receipts()).toHaveLength(receipts);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(fetcher.mock.calls.length).toBe(writes);
  });

  it("does not reuse an unmounted Brain/Chart session as a new live agreement", async () => {
    await render("AAPL", "1D");
    const read = brainRead();
    expect(bus.readSemanticBrainCompatibility(read)).toMatchObject({ status: "compatible" });
    const retiredSession = bus.context!;
    await act(async () => { root.render(null); });
    expect(bus.context).toBeNull();
    expect(retiredSession.snapshot("active-chart")).toBeNull();
    expect(bus.readSemanticBrainCompatibility(read)).toEqual({
      status: "unsupported", reason: "chart_session_unavailable",
    });
    expect((window as unknown as MastermindBrainHost).MM_BRAIN_CFG?.getAiContext).toBeUndefined();
  });
});

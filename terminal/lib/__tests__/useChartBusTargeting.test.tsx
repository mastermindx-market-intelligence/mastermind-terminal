// @vitest-environment jsdom

import React, { useLayoutEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHART_COMMAND_TARGET_SCHEMA,
  validateEnvelope,
  type ChartCommandTarget,
  type IndicatorSpec,
} from "../chartBus";
import { useChartBus, type ChartBus, type ChartBusHost } from "../useChartBus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ host, onBus }: { host: ChartBusHost; onBus: (bus: ChartBus) => void }) {
  const bus = useChartBus(host);
  useLayoutEffect(() => onBus(bus), [bus, onBus]);
  return null;
}

const target = (overrides: Partial<ChartCommandTarget> = {}): ChartCommandTarget => ({
  schema: CHART_COMMAND_TARGET_SCHEMA,
  origin_id: "origin-target",
  context_revision: 1,
  pane_id: 0,
  symbol: "NVDA",
  tf: "D",
  ...overrides,
});
function patchCommand(seq = 1, targetOverride: Partial<ChartCommandTarget> = {}) {
  return {
    on: true as const,
    v: 2 as const,
    batch_id: "target-batch",
    seq,
    op: "chart.set_indicators" as const,
    target: target(targetOverride),
    args: {
      mode: "patch",
      indicators: [{ name: "rsi", params: { len: 21 } }],
    },
  };
}

describe("Chart Bus exact-target boundary", () => {
  it("requires a closed host target for additive indicator edits and selective clear", () => {
    const missingPatch = validateEnvelope({
      on: true, v: 2, batch_id: "b", seq: 0,
      op: "chart.set_indicators",
      args: { mode: "patch", indicators: [{ name: "rsi" }] },
    });
    expect(missingPatch).toMatchObject({ ok: false, error: "command_target_required" });

    const missingClear = validateEnvelope({
      on: true, v: 2, batch_id: "b", seq: 1,
      op: "ai.clear", args: { ids: ["ai_a"] },
    });
    expect(missingClear).toMatchObject({ ok: false, error: "command_target_required" });

    const malformed = validateEnvelope({
      ...patchCommand(),
      target: { ...target(), extra: "model-controlled" },
    });
    expect(malformed).toMatchObject({ ok: false, error: "bad_command_target" });
  });
});

describe("useChartBus targeted edits", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let bus: ChartBus | null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = null;
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeHost(opts: {
    symbol?: string;
    tf?: string;
    revision?: number;
    pane?: number;
    setIndicators?: (specs: IndicatorSpec[]) => void;
    setTf?: (tf: string) => void;
  } = {}): ChartBusHost {
    return {
      activeSymbol: opts.symbol ?? "NVDA",
      bars: [],
      capabilities: { tfs: ["D", "W"], indicators: ["ema", "rsi"] },
      sessionIndicators: [
        { name: "ema", params: { len: 20 } },
        { name: "rsi", params: { len: 14 } },
      ],
      currentTf: opts.tf ?? "D",
      activePaneId: opts.pane ?? 0,
      userDrawings: [],
      getContextIdentity: () => ({
        origin_id: "origin-target",
        context_revision: opts.revision ?? 1,
      }),
      setSymbol: () => {},
      setTf: opts.setTf ?? (() => {}),
      setIndicators: opts.setIndicators ?? (() => {}),
      setRange: () => {},
    };
  }
  async function mount(host: ChartBusHost) {
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host,
        onBus: (value) => { bus = value; },
      }));
    });
  }

  async function clearInitialMirror() {
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fetchMock.mockClear();
  }

  it("applies a matching patch and preserves unmentioned studies", async () => {
    const applied: IndicatorSpec[][] = [];
    await mount(makeHost({ setIndicators: (specs) => applied.push(specs) }));
    await clearInitialMirror();

    act(() => bus!.dispatchV2(patchCommand()));
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual([
      { name: "ema", params: { len: 20 } },
      { name: "rsi", params: { len: 21 } },
    ]);

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.acks[0]).toMatchObject({
      batch_id: "target-batch", seq: 1, ok: true,
    });
  });

  it("keeps selective AI clear atomic when an id is stale, then removes only a valid selection", async () => {
    await mount(makeHost());
    await clearInitialMirror();

    await act(async () => {
      bus!.dispatchV2({
        on: true, v: 2, batch_id: "draws", seq: 10,
        op: "draw.hline", id: "ai_keep", args: { p: 100 },
      });
      bus!.dispatchV2({
        on: true, v: 2, batch_id: "draws", seq: 11,
        op: "draw.hline", id: "ai_drop", args: { p: 110 },
      });
    });
    expect(bus!.aiDrawingsFor("NVDA").map((row) => row.id)).toEqual(["ai_keep", "ai_drop"]);

    await act(async () => {
      bus!.dispatchV2({
        on: true, v: 2, batch_id: "clear", seq: 12,
        op: "ai.clear",
        target: target(),
        args: { ids: ["ai_drop", "ai_missing"] },
      });
    });
    expect(bus!.aiDrawingsFor("NVDA").map((row) => row.id)).toEqual(["ai_keep", "ai_drop"]);

    await act(async () => {
      bus!.dispatchV2({
        on: true, v: 2, batch_id: "clear", seq: 13,
        op: "ai.clear",
        target: target(),
        args: { ids: ["ai_drop"] },
      });
    });
    expect(bus!.aiDrawingsFor("NVDA").map((row) => row.id)).toEqual(["ai_keep"]);

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const bodies = fetchMock.mock.calls
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
      .filter((body) => Array.isArray(body.acks) && body.acks.length);
    const acks = bodies.flatMap((body) => body.acks);
    expect(acks).toContainEqual(expect.objectContaining({
      batch_id: "clear", seq: 12, ok: false, error: "unknown_ai_object",
    }));
    expect(acks).toContainEqual(expect.objectContaining({
      batch_id: "clear", seq: 13, ok: true,
    }));
  });

  it("refuses a queued patch if the committed chart revision changes before execution", async () => {
    const applied: IndicatorSpec[][] = [];
    await mount(makeHost({ setIndicators: (specs) => applied.push(specs) }));
    await clearInitialMirror();
    bus!.queue.delayMs = 50;

    act(() => bus!.dispatchV2(patchCommand(2)));
    await mount(makeHost({
      symbol: "AAPL",
      revision: 2,
      setIndicators: (specs) => applied.push(specs),
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(applied).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const ackBodies = fetchMock.mock.calls
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
      .filter((body) => Array.isArray(body.acks) && body.acks.length);
    expect(ackBodies.at(-1).acks[0]).toMatchObject({
      batch_id: "target-batch",
      seq: 2,
      ok: false,
      error: "command_target_revision_mismatch",
    });
  });

  it("refuses a targeted edit while a symbol/timeframe transition is pending", async () => {
    const applied: IndicatorSpec[][] = [];
    const tfCalls: string[] = [];
    await mount(makeHost({
      setTf: (tf) => tfCalls.push(tf),
      setIndicators: (specs) => applied.push(specs),
    }));
    await clearInitialMirror();

    act(() => bus!.dispatchV2({
      on: true, v: 2, batch_id: "transition", seq: 0,
      op: "chart.set_tf", args: { tf: "W" },
    }));
    expect(tfCalls).toEqual(["W"]);

    act(() => bus!.dispatchV2({
      ...patchCommand(3),
      batch_id: "transition",
    }));
    expect(applied).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const bodies = fetchMock.mock.calls
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
      .filter((body) => Array.isArray(body.acks) && body.acks.length);
    const acks = bodies.flatMap((body) => body.acks);
    expect(acks).toContainEqual(expect.objectContaining({
      batch_id: "transition",
      seq: 3,
      ok: false,
      error: "command_target_transition_pending",
    }));
  });
});

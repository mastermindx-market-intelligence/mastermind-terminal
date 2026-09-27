// @vitest-environment jsdom
// Deferred combined-pass specification for read-only mounted-pane Copilot context.
// Authored during feature construction; the Chairman requested execution at the final pass.

import React, { useLayoutEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHART_PANE_CONTEXT_SCHEMA,
  useChartBus,
  type ChartBus,
  type ChartBusHost,
} from "../useChartBus";
import { prepareChartStatePayload, type ChartStatePayload } from "../chartStatePayload";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ host, onBus }: { host: ChartBusHost; onBus: (bus: ChartBus) => void }) {
  const bus = useChartBus(host);
  useLayoutEffect(() => onBus(bus), [bus, onBus]);
  return null;
}

function hostWithPanes(count = 2): ChartBusHost {
  const identity = (pane_id: number) => ({
    symbol: pane_id === 0 ? "NVDA" : "AAPL",
    tf: pane_id === 0 ? "D" : "W",
  });
  const marker = (pane_id: number) => ({
    schema: "chart.native_live_observations.v1",
    status: "unavailable",
    reason: "fixture_native_unavailable",
    pane_id,
  });
  const presentation = (pane_id: number) => ({
    schema: "chart.presentation.v1",
    status: "observed",
    ...identity(pane_id),
    pane_id,
    chart_type: pane_id === 0 ? "candles" : "line",
    price_scale: { mode: "normal", inverted: false, side: "right", auto: true },
    session: {
      replay: false, day_trade_mode: false,
      extended_hours: { requested: false, eligible: false, effective: false },
    },
    display: {
      price_line: true, last_value: true, grid_h: true, grid_v: true,
      ohlc: true, volume: false, indicator_titles: true, watermark: true,
      candle_body: true, candle_borders: true, candle_wicks: true,
      extended_price_line: true, precision: "auto",
    },
    visual_intelligence: { context: true, regime: false, volume: false, levels: false, events: false },
    comparisons: [],
  });
  const price = (pane_id: number) => ({
    ...identity(pane_id),
    replay: false,
    bars: [{ time: pane_id === 0 ? 1500 : 3500, o: 100, h: 102, l: 99, c: 101, v: 1000 }],
  });
  return {
    activeSymbol: "NVDA",
    bars: [],
    capabilities: { tfs: ["D", "W"], indicators: [] },
    sessionIndicators: [],
    currentTf: "D",
    activePaneId: 0,
    userDrawings: [],
    getContextIdentity: () => ({ origin_id: "origin-pane-test", context_revision: 4 }),
    getRenderedPriceWindowSource: () => price(0),
    getPresentationSnapshot: () => presentation(0),
    getNativeObservationSnapshot: () => marker(0),
    getPaneContextSnapshots: () => Array.from({ length: count }, (_, pane_id) => ({
      pane_id,
      ...identity(pane_id),
      price_window_source: price(pane_id),
      presentation: presentation(pane_id),
      native_observations: marker(pane_id),
    })),
    setSymbol: () => {},
    setTf: () => {},
    setIndicators: () => {},
    setRange: () => true,
  };
}

describe("useChartBus mounted-pane context mirror", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let bus: ChartBus | undefined;
  const bodies: any[] = [];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return { ok: true };
  });

  beforeEach(() => {
    vi.useFakeTimers();
    bodies.length = 0;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mirrors separate mounted panes without changing the exact context revision", async () => {
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWithPanes(2),
        onBus: (value: ChartBus) => { bus = value; },
      }));
    });
    act(() => {
      bus!.noteViewport(0, { from: 1_000_000, to: 2_000_000 });
      bus!.noteViewport(1, { from: 3_000_000, to: 4_000_000 });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    const body = bodies.at(-1);
    expect(body.origin_id).toBe("origin-pane-test");
    expect(body.context_revision).toBe(4);
    expect(body.session.pane_contexts).toMatchObject({
      schema: CHART_PANE_CONTEXT_SCHEMA,
      status: "observed",
      active_pane_id: 0,
      pane_count: 2,
      control_authority: "active_pane_only",
    });
    expect(body.session.price_window.status).toBe("observed");
    expect(body.session.pane_contexts.panes).toEqual([
      expect.objectContaining({
        pane_id: 0, symbol: "NVDA", tf: "D",
        visible_range: { from: 1000, to: 2000 },
        price_window_ref: "session.price_window",
        presentation_ref: "session.presentation",
        native_observations_ref: "session.native_observations",
      }),
      expect.objectContaining({
        pane_id: 1, symbol: "AAPL", tf: "W",
        visible_range: { from: 3000, to: 4000 },
        presentation: expect.objectContaining({
          schema: "chart.presentation.v1", status: "observed", chart_type: "line",
        }),
        price_window: expect.objectContaining({
          schema: "chart.price_window.v1", status: "observed", symbol: "AAPL", tf: "W",
        }),
      }),
    ]);
    expect(body.session.presentation).toMatchObject({
      schema: "chart.presentation.v1", status: "observed", chart_type: "candles",
    });
    expect(body.session.pane_contexts.panes[0]).not.toHaveProperty("presentation");
    expect(body.session.pane_contexts.panes[0]).not.toHaveProperty("price_window");
    expect(body.session.pane_contexts.panes[0]).not.toHaveProperty("native_observations");
  });

  it("does not add the multi-pane packet to a single-pane layout", async () => {
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWithPanes(1),
        onBus: (value: ChartBus) => { bus = value; },
      }));
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(bodies.at(-1).session.pane_contexts).toBeNull();
  });

  it("payload pressure withholds pane contexts before active native evidence", () => {
    const huge = "x".repeat(20_000);
    const input: ChartStatePayload = {
      client: "terminal",
      origin_id: "origin-pane-test",
      context_revision: 4,
      session: {
        symbol: "NVDA", tf: "D", pane_id: 0, indicators: [],
        native_observations: { schema: "chart.native_live_observations.v1",
          status: "unavailable", reason: "active-native-kept" },
        pane_contexts: { schema: CHART_PANE_CONTEXT_SCHEMA, status: "observed",
          active_pane_id: 0, pane_count: 2, control_authority: "active_pane_only",
          panes: [{ pane_id: 0, symbol: "NVDA", tf: "D", blob: huge },
            { pane_id: 1, symbol: "AAPL", tf: "W", blob: huge }] },
        drawings: [],
        capabilities: {},
      },
      acks: [],
    };
    const prepared = prepareChartStatePayload(input, 12_000);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const body = JSON.parse(prepared.text);
    expect(body.session.pane_contexts).toEqual({
      schema: CHART_PANE_CONTEXT_SCHEMA,
      status: "unavailable",
      reason: "chart_state_budget",
    });
    expect(body.session.native_observations.reason).toBe("active-native-kept");
    expect(body.session.mirror_coverage.omitted_fields).toContain("pane_contexts");
  });
});

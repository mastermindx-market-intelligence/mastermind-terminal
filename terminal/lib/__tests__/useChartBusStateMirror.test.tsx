// @vitest-environment jsdom

import React, { useLayoutEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Drawing } from "../drawings";
import { type ChartBus } from "../useChartBus";
import { useTestChartBus as useChartBus, type TestChartBusHost as ChartBusHost } from "./fixtures/chartBusOwner";
import { describeAiDrawingCapabilities } from "../chartDrawingTools";
import { translate } from "../chartBus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ host, onBus }: { host: ChartBusHost; onBus?: (bus: ChartBus) => void }) {
  const bus = useChartBus(host);
  useLayoutEffect(() => {
    onBus?.(bus);
  }, [bus, onBus]);
  return null;
}

function drawing(price: number): Drawing {
  return {
    id: "u_line",
    kind: "hline",
    source: "user",
    points: [{ t: "2026-07-01", p: price }],
  };
}

function hostWith(
  userDrawings: Drawing[],
  context = { origin_id: "origin-test", context_revision: 4 },
): ChartBusHost {
  return {
    activeSymbol: "NVDA",
    bars: [],
    capabilities: { tfs: ["D"], indicators: [] },
    sessionIndicators: [],
    currentTf: "D",
    activePaneId: 0,
    userDrawings,
    getContextIdentity: () => context,
    setSymbol: () => {},
    setTf: () => {},
    setIndicators: () => {},
    setRange: () => {},
  };
}

describe("useChartBus state mirror", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return { ok: true };
  });

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
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

  it("refreshes an unchanged idle chart after its server registration disappears", async () => {
    let bus!: ChartBus;
    let registered: any = null;
    const receive = async (_input: RequestInfo | URL, init?: RequestInit) => {
      registered = JSON.parse(String(init?.body)); return { ok: true };
    };
    fetchMock.mockImplementationOnce(receive).mockImplementationOnce(receive);
    await act(async () => {
      root!.render(React.createElement(Harness, { host: hostWith([drawing(100)]), onBus: value => { bus = value; } }));
      await vi.advanceTimersByTimeAsync(250);
    });
    // The server can lose its process-local record while this chart stays mounted.
    registered = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(601_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let result;
    await act(async () => { result = await bus.prepareChartState({ origin_id: "origin-test", context_revision: 4 }); });
    expect(result).toEqual({ ok: true, origin_id: "origin-test", context_revision: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(registered).toMatchObject({ origin_id: "origin-test", context_revision: 4,
      session: { symbol: "NVDA", tf: "D", drawings: [{ id: "u_line" }] } });
  });

  it("waits for the sole in-flight mirror and one fresh delivery before reporting readiness", async () => {
    let bus!: ChartBus, finishFirst!: (value: { ok: boolean }) => void, finishFresh!: (value: { ok: boolean }) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishFresh = resolve; }));
    await act(async () => { root!.render(React.createElement(Harness, {
      host: hostWith([]), onBus: value => { bus = value; },
    })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    let ready: unknown;
    const pending = bus.prepareChartState({ origin_id: "origin-test", context_revision: 4 }).then(value => { ready = value; });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(ready).toBeUndefined();
    await act(async () => { finishFirst({ ok: true }); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(ready).toBeUndefined();
    await act(async () => { finishFresh({ ok: true }); await pending; });
    expect(ready).toMatchObject({ ok: true, origin_id: "origin-test", context_revision: 4 });
  });

  it("cancels only the waiting turn while an existing mirror preserves and delivers its ACKs", async () => {
    let bus!: ChartBus, finishFirst!: (value: { ok: boolean }) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    await act(async () => { root!.render(React.createElement(Harness, {
      host: hostWith([]), onBus: value => { bus = value; },
    })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    act(() => bus.dispatchV2({ on: true, v: 2, batch_id: "waiting-ack", seq: 0,
      op: "draw.hline", id: "ai_waiting", args: { p: 100 },
      target: { schema: "chart.command_target.v1", origin_id: "origin-test", context_revision: 4,
        pane_id: 0, symbol: "NVDA", tf: "D" } }));
    const controller = new AbortController();
    const pending = bus.prepareChartState({ origin_id: "origin-test", context_revision: 4 }, controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { finishFirst({ ok: true }); await vi.advanceTimersByTimeAsync(250); });
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies.flatMap(body => body.acks)).toEqual([expect.objectContaining({ batch_id: "waiting-ack", seq: 0, ok: true })]);
  });

  it("does not retarget preparation when the chart changes during an in-flight delivery", async () => {
    let bus!: ChartBus, finishFirst!: (value: { ok: boolean }) => void;
    let identity = { origin_id: "origin-test", context_revision: 4 };
    const host = { ...hostWith([]), getContextIdentity: () => identity };
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    await act(async () => { root!.render(React.createElement(Harness, {
      host, onBus: value => { bus = value; },
    })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const pending = bus.prepareChartState({ ...identity });
    identity = { ...identity, context_revision: 5 };
    await act(async () => { finishFirst({ ok: true }); });
    await expect(pending).resolves.toEqual({ ok: false, reason: "context_changed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports authentication failure without scheduling a blind retry", async () => {
    let bus!: ChartBus;
    await act(async () => { root!.render(React.createElement(Harness, {
      host: hostWith([]), onBus: value => { bus = value; },
    })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 401 }));
    await expect(bus.prepareChartState({ origin_id: "origin-test", context_revision: 4 }))
      .resolves.toEqual({ ok: false, reason: "sign_in_required" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds a stalled fresh delivery and rejects a retired chart owner", async () => {
    let bus!: ChartBus;
    await act(async () => { root!.render(React.createElement(Harness, {
      host: hostWith([]), onBus: value => { bus = value; },
    })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const pending = bus.prepareChartState({ origin_id: "origin-test", context_revision: 4 });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await expect(pending).resolves.toEqual({ ok: false, reason: "state_post_timeout" });
    act(() => root!.unmount()); root = undefined;
    await expect(bus.prepareChartState({ origin_id: "origin-test", context_revision: 4 }))
      .resolves.toEqual({ ok: false, reason: "host_unmounted" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mirrors exact native kinds and effective custom Fibonacci settings for a later chart read", async () => {
    const points = [{ t: 1770000000, p: 100 }, { t: 1770086400, p: 120 }, { t: 1770172800, p: 110 }];
    const capabilities = { tfs: ["D"], indicators: [], drawing_tools: describeAiDrawingCapabilities() };
    const host: ChartBusHost = { ...hostWith([]),
      capabilities,
      getRenderedPriceWindowSource: () => ({ symbol: "NVDA", tf: "D", replay: false,
        bars: points.map(point => ({ time: point.t, o: point.p, h: point.p + 1, l: point.p - 1, c: point.p, v: 100 })) }),
    };
    let bus: ChartBus;
    await act(async () => {
      root!.render(React.createElement(Harness, { host, onBus: value => { bus = value; } }));
    });
    const target = { schema: "chart.command_target.v1", origin_id: "origin-test", context_revision: 4,
      pane_id: 0, symbol: "NVDA", tf: "D" };
    act(() => {
      ["channel", "pitchfork", "fibtrend"].forEach((kind, seq) => {
        bus!.dispatchV2({ on: true, v: 2, batch_id: "brain_roundtrip", seq, op: "draw.tool",
          id: "ai_" + kind, target, args: { kind, points,
            style: { color: "#845ef7", width: 2, dash: "dashed", fill_opacity: 0.12 },
            ...(kind === "fibtrend" ? { fibonacci: { levels: [-0.5, 0, 1.618], reverse: true, labels: "price" } } : {}) } });
      });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));
    const body = bodies.at(-1)!;
    expect(bodies.flatMap(row => row.acks)).toHaveLength(3);
    expect(bodies.flatMap(row => row.acks).every(row => row.ok)).toBe(true);
    expect(body.session.drawings.map((row: any) => row.args.kind)).toEqual(["channel", "pitchfork", "fibtrend"]);
    const fib = body.session.drawings[2];
    expect(fib).toMatchObject({ id: "ai_fibtrend", command_id: "ai_fibtrend", kind: "fibtrend", op: "draw.tool" });
    expect(fib.args.fibonacci).toEqual({ levels: [-0.5, 0, 1.618], reverse: true, labels: "price" });
    expect(fib.args.style).toMatchObject({ color: "#845ef7", width: 2, dash: "dashed", fill_opacity: 0.12 });
    const reconstructed = translate({ on: true, v: 2, batch_id: "reread", seq: 0,
      op: "draw.tool", id: fib.command_id, args: fib.args }, { tfs: [], indicators: [] });
    expect(reconstructed.ok).toBe(true);
    if (reconstructed.ok) expect(reconstructed.draw![0].kind).toBe("fibtrend");
  });

  it("posts one exact-origin snapshot on initial mount and ignores an equivalent rerender", async () => {
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([drawing(100)]),
      }));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    const firstBody = JSON.parse(String(firstInit.body));
    expect(firstBody.origin_id).toBe("origin-test");
    expect(firstBody.context_revision).toBe(4);
    expect(firstBody.session.symbol).toBe("NVDA");

    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([drawing(100)]),
      }));
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts an edited user drawing even when the drawing count is unchanged", async () => {
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([drawing(100)]),
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([drawing(125)]),
      }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/brain/chart/state");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.session.drawings).toEqual([
      {
        id: "u_line",
        by: "user",
        op: "draw.hline",
        args: { p: 125 },
      },
    ]);
  });

  it("mirrors only the active pane viewport and preserves loaded data range separately", async () => {
    const busRef = { current: null as ChartBus | null };
    const host = {
      ...hostWith([]),
      bars: [
        { time: "2026-01-02", h: 11, l: 9, c: 10 },
        { time: "2026-01-05", h: 12, l: 10, c: 11 },
      ],
    };
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host,
        onBus: (bus) => { busRef.current = bus; },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fetchMock.mockClear();

    act(() => (busRef.current as any).noteViewport(1, {
      from: Date.parse("2025-12-20T00:00:00Z"),
      to: Date.parse("2026-01-03T00:00:00Z"),
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => (busRef.current as any).noteViewport(0, {
      from: Date.parse("2025-12-29T00:00:00Z"),
      to: Date.parse("2026-01-07T00:00:00Z"),
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.session.pane_id).toBe(0);
    expect(body.session.visible_range).toEqual({
      from: Date.parse("2025-12-29T00:00:00Z") / 1000,
      to: Date.parse("2026-01-07T00:00:00Z") / 1000,
    });
    expect(body.session.data_range).toEqual({
      from: Date.parse("2026-01-02T00:00:00Z") / 1000,
      to: Date.parse("2026-01-05T00:00:00Z") / 1000,
    });
  });

  it("mirrors replay-safe rendered price bars and uses the active viewport tail", async () => {
    const busRef = { current: null as ChartBus | null };
    const rendered = Array.from({ length: 20 }, (_, i) => ({
      time: "2026-02-" + String(i + 1).padStart(2, "0"),
      o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000 + i,
    }));
    const host: ChartBusHost = {
      ...hostWith([]),
      getRenderedPriceWindowSource: () => ({
        symbol: "NVDA", tf: "D", bars: rendered.slice(0, 15), replay: true,
      }),
    };
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host,
        onBus: (bus) => { busRef.current = bus; },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fetchMock.mockClear();

    act(() => busRef.current!.noteViewport(0, {
      from: Date.parse("2026-02-05T00:00:00Z"),
      to: Date.parse("2026-02-11T00:00:00Z"),
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.session.price_window).toMatchObject({
      schema: "chart.price_window.v1",
      status: "observed",
      symbol: "NVDA",
      tf: "D",
      source_bar_count: 15,
      selection: {
        scope: "visible_tail",
        eligible_bars: 7,
        returned_bars: 7,
        omitted_older_bars: 0,
        order: "oldest_to_newest",
      },
      basis: { data_status: "replay_slice", last_bar_closed: "unknown" },
    });
    expect(body.session.price_window.bars.map((row: any) => row.time)).toEqual([
      "2026-02-05", "2026-02-06", "2026-02-07", "2026-02-08",
      "2026-02-09", "2026-02-10", "2026-02-11",
    ]);
    expect(body.session.price_window.bars.at(-1).age_bars_from_loaded_end).toBe(4);
  });

  it("never lets a viewport update postpone a higher-priority ACK mirror", async () => {
    const busRef = { current: null as ChartBus | null };
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([]),
        onBus: (bus) => { busRef.current = bus; },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fetchMock.mockClear();

    act(() => busRef.current!.dispatchV2({
      on: true, v: 2, batch_id: "ack-priority", seq: 0,
      op: "draw.hline", id: "ai_priority", args: { p: 100 },
      target: { schema: "chart.command_target.v1", origin_id: "origin-test", context_revision: 4,
        pane_id: 0, symbol: "NVDA", tf: "D" },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    act(() => (busRef.current as any).noteViewport(0, {
      from: Date.parse("2026-01-01T00:00:00Z"),
      to: Date.parse("2026-01-10T00:00:00Z"),
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(49); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.acks[0]).toMatchObject({ batch_id: "ack-priority", seq: 0, ok: true });
    expect(body.session.visible_range).not.toBeNull();
  });

  it("mirrors committed presentation on a single-pane chart without inventing pane context", async () => {
    const presentation = {
      schema: "chart.presentation.v1",
      status: "observed",
      symbol: "NVDA",
      tf: "D",
      pane_id: 0,
      chart_type: "line",
      price_scale: { mode: "log", inverted: false, side: "right", auto: true },
      session: {
        replay: false, day_trade_mode: false,
        extended_hours: { requested: false, eligible: true, effective: false },
      },
      display: {
        price_line: true, last_value: true, grid_h: true, grid_v: true,
        ohlc: true, volume: false, indicator_titles: true, watermark: true,
        candle_body: true, candle_borders: true, candle_wicks: true,
        extended_price_line: true, precision: "auto",
      },
      visual_intelligence: {
        context: true, regime: false, volume: false, levels: false, events: false,
      },
      comparisons: [],
    };
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: { ...hostWith([]), getPresentationSnapshot: () => presentation },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.session.presentation).toEqual(presentation);
    expect(body.session.pane_contexts).toBeNull();
  });

  it("mirrors the existing Data Window projection without turning failure into a market conclusion", async () => {
    const readout = {
      schema: "chart.data_readout.v1",
      status: "partial",
      reason: "readout_lookup_unavailable",
      basis: { empty_result: "not_a_no_setup_judgment" },
    };
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: { ...hostWith([]), getReadoutSnapshot: () => readout },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.session.data_readout).toEqual(readout);

    fetchMock.mockClear();
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: {
          ...hostWith([], { origin_id: "origin-test", context_revision: 5 }),
          activeSymbol: "AAPL",
          getReadoutSnapshot: () => { throw new Error("stale readout owner"); },
        },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.session.data_readout).toBeNull();
  });

  it("retains unsent command acknowledgements after a failed mirror POST", async () => {
    const busRef = { current: null as ChartBus | null };
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([]),
        onBus: (bus) => { busRef.current = bus; },
      }));
    });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const rejectedTf = (seq: number) => ({
      on: true,
      v: 2,
      batch_id: "retry-acks",
      seq,
      op: "chart.set_tf",
      args: { tf: "7D" },
    });

    act(() => busRef.current!.dispatchV2(rejectedTf(1)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(99);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => busRef.current!.dispatchV2(rejectedTf(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    const retryBody = JSON.parse(String(retryInit.body));
    expect(retryBody.origin_id).toBe("origin-test");
    expect(retryBody.context_revision).toBe(4);
    expect(retryBody.acks.map((ack: { seq: number }) => ack.seq)).toEqual([1, 2]);
  });

  it("retains acknowledgements when the mirror returns a non-2xx response", async () => {
    const busRef = { current: null as ChartBus | null };
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([]),
        onBus: (bus) => { busRef.current = bus; },
      }));
    });

    fetchMock.mockResolvedValueOnce({ ok: false });
    const rejectedTf = (seq: number) => ({
      on: true,
      v: 2,
      batch_id: "http-retry-acks",
      seq,
      op: "chart.set_tf",
      args: { tf: "7D" },
    });

    act(() => busRef.current!.dispatchV2(rejectedTf(11)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => busRef.current!.dispatchV2(rejectedTf(12)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    const retryBody = JSON.parse(String(retryInit.body));
    expect(retryBody.acks.map((ack: { seq: number }) => ack.seq)).toEqual([11, 12]);
  });
});

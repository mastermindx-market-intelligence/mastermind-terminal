// @vitest-environment jsdom

import React, { useLayoutEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Drawing } from "../drawings";
import { useChartBus, type ChartBus, type ChartBusHost } from "../useChartBus";

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

function hostWith(userDrawings: Drawing[]): ChartBusHost {
  return {
    activeSymbol: "NVDA",
    bars: [],
    capabilities: { tfs: ["D"], indicators: [] },
    sessionIndicators: [],
    currentTf: "D",
    userDrawings,
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

  it("does not post merely because TerminalShell produced a fresh equivalent drawings array", async () => {
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([drawing(100)]),
      }));
    });

    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([drawing(100)]),
      }));
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts an edited user drawing even when the drawing count is unchanged", async () => {
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: hostWith([drawing(100)]),
      }));
    });
    expect(fetchMock).not.toHaveBeenCalled();

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
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => busRef.current!.dispatchV2(rejectedTf(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    const retryBody = JSON.parse(String(retryInit.body));
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
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => busRef.current!.dispatchV2(rejectedTf(12)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    const retryBody = JSON.parse(String(retryInit.body));
    expect(retryBody.acks.map((ack: { seq: number }) => ack.seq)).toEqual([11, 12]);
  });
});

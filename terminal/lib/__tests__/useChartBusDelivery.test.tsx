// @vitest-environment jsdom
// Authored integration cases. No execution result is claimed for the feature-first phase.
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChartBus, type ChartBus, type ChartBusHost } from "../useChartBus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Harness({ host, take }: { host: ChartBusHost; take: (bus: ChartBus) => void }) {
  const bus = useChartBus(host);
  useLayoutEffect(() => take(bus), [bus, take]);
  return null;
}
function host(symbol = "SYNTHETIC", revision = 4): ChartBusHost {
  return { activeSymbol: symbol, bars: [], capabilities: { tfs: ["D"], indicators: [] },
    sessionIndicators: [], currentTf: "D", activePaneId: 0, userDrawings: [],
    getContextIdentity: () => ({ origin_id: "delivery_fixture", context_revision: revision }),
    setSymbol: () => {}, setTf: () => {}, setIndicators: () => {}, setRange: () => {} };
}

describe("existing chart mirror delivery", () => {
  let root: Root | undefined;
  let node: HTMLDivElement;
  let bus: ChartBus;
  const take = (value: ChartBus) => { bus = value; };
  const fetchMock = vi.fn();
  const body = (i: number) => JSON.parse(String((fetchMock.mock.calls[i][1] as RequestInit).body));
  const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const render = async (h = host()) => {
    await act(async () => { root!.render(React.createElement(Harness, { host: h, take })); });
  };
  const reject = (seq: number) => bus.dispatchV2({ on: true, v: 2,
    batch_id: "brain_delivery", seq, id: `ai_${seq}`, op: "unsupported_fixture_op" });

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    node = document.createElement("div"); document.body.appendChild(node);
    root = createRoot(node);
  });
  afterEach(() => {
    act(() => root?.unmount());
    node.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it("coalesces an in-flight snapshot into the latest committed context", async () => {
    let finish: ((value: { ok: boolean }) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise<{ ok: boolean }>((resolve) => { finish = resolve; }));
    await render(); await tick(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await render(host("SECOND", 5)); await tick(250);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { finish!({ ok: true }); });
    await tick(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(1).session.symbol).toBe("SECOND");
    expect(body(1).context_revision).toBe(5);
  });

  it("drains every queued receipt in FIFO batches without another market tick", async () => {
    await render();
    act(() => { for (let seq = 0; seq < 70; seq++) reject(seq); });
    await tick(400);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const receipts = fetchMock.mock.calls.flatMap((_call, i) => body(i).acks);
    expect(receipts.map((a: any) => a.seq)).toEqual(Array.from({ length: 70 }, (_, i) => i));
    expect(receipts.every((a: any) => a.batch_id === "brain_delivery" && a.ok === false)).toBe(true);
  });

  it("restores failed receipts ahead of later acknowledgements exactly once", async () => {
    let fail: ((reason?: unknown) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { fail = rejectPromise; }));
    await render(); act(() => reject(0)); await tick(100);
    act(() => reject(1)); await tick(100);
    await act(async () => { fail!(new Error("fixture network error")); });
    await tick(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(1).acks.map((a: any) => a.seq)).toEqual([0, 1]);
    await tick(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not consume acknowledgements when the context getter throws", async () => {
    await render({ ...host(), getContextIdentity: () => { throw new Error("fixture identity failure"); } });
    act(() => reject(0)); await tick(100);
    expect(fetchMock).not.toHaveBeenCalled();
    await render(); act(() => bus.noteReadoutChange()); await tick(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body(0).acks.map((a: any) => a.seq)).toEqual([0]);
  });

  it("releases a hung request and retains receipts for an actual pending update", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    await render(); await tick(250);
    act(() => reject(0)); await tick(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(4100);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(1).acks.map((a: any) => a.seq)).toEqual([0]);
  });

  it("does not create a periodic retry after a failed request with no new input", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await render(); act(() => reject(0)); await tick(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not launch a deferred upload after unmount", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    await render(); await tick(250);
    act(() => reject(0)); await tick(100);
    act(() => { root!.unmount(); root = undefined; });
    await tick(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

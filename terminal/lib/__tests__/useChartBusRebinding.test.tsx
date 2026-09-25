// @vitest-environment jsdom

import React, { useLayoutEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useChartBus, type ChartBus, type ChartBusHost } from "../useChartBus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const command = {
  on: true,
  v: 2,
  batch_id: "rebind",
  seq: 1,
  op: "chart.set_tf",
  args: { tf: "D" },
};

function Harness({
  host,
  fire,
}: {
  host: ChartBusHost;
  fire: boolean;
}) {
  const bus: ChartBus = useChartBus(host);
  useLayoutEffect(() => {
    if (fire) bus.dispatchV2(command);
  }, [bus, fire]);
  return null;
}

describe("useChartBus host rebinding", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it("routes a synchronous command to the host from the render that just committed", async () => {
    const calls: string[] = [];
    const makeHost = (label: string, activeSymbol: string): ChartBusHost => ({
      activeSymbol,
      bars: [],
      capabilities: { tfs: ["D"], indicators: [] },
      sessionIndicators: [],
      currentTf: "3D",
      userDrawings: [],
      getContextIdentity: () => ({ origin_id: "origin-rebind", context_revision: 1 }),
      setSymbol: (symbol) => { calls.push(`${label}:symbol:${symbol}`); },
      setTf: (tf) => { calls.push(`${label}:tf:${tf}`); },
      setIndicators: () => { calls.push(`${label}:indicators`); },
      setRange: () => { calls.push(`${label}:range`); },
    });

    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: makeHost("A", "NVDA"),
        fire: false,
      }));
    });

    calls.length = 0;
    await act(async () => {
      root!.render(React.createElement(Harness, {
        host: makeHost("B", "AAPL"),
        fire: true,
      }));
    });

    expect(calls).toEqual(["B:tf:D"]);
  });
});

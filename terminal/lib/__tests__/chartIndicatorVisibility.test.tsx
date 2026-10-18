// @vitest-environment jsdom
import React, { act, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateIndicatorVisibility, describeIndicatorVisibility, translate, type IndicatorSpec } from "@/lib/chartBus";
import { useChartBus, type ChartBus } from "@/lib/useChartBus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Initial = { initialIndicators?: IndicatorSpec[]; initialHidden?: string[]; showKeys?: string[] };
function Fixture({ ignoreVisibility, take, initialIndicators, initialHidden }: Initial & { ignoreVisibility: boolean; take: (bus: ChartBus) => void }) {
  const [indicators, setIndicators] = useState<IndicatorSpec[]>(initialIndicators ?? [{ name: "ema", params: { len: 20 } }, { name: "rsi", params: { len: 14 } }]);
  const [hidden, setHidden] = useState<string[]>(initialHidden ?? ["rsi"]);
  const identity = useRef({ key: JSON.stringify({ indicators, hidden }), revision: 1 });
  const key = JSON.stringify({ indicators, hidden });
  useLayoutEffect(() => { if (identity.current.key !== key) identity.current = { key, revision: identity.current.revision + 1 }; }, [key]);
  const bus = useChartBus({ activeSymbol: "SYNTHETIC", bars: [], currentTf: "D", activePaneId: 0, userDrawings: [],
    capabilities: { tfs: ["D"], indicators: ["ema", "rsi", "structure"] }, sessionIndicators: indicators, hiddenIndicators: hidden,
    getContextIdentity: () => ({ origin_id: "visible_fixture", context_revision: identity.current.revision }),
    flushContext: () => flushSync(() => {}), setSymbol: () => {}, setTf: () => {}, setRange: () => {},
    setIndicators: (next, visibility) => flushSync(() => {
      setIndicators(next);
      if (!ignoreVisibility) setHidden(previous => updateIndicatorVisibility(previous, indicators, next, visibility));
    }),
  });
  useLayoutEffect(() => take(bus), [bus, take]);
  return null;
}

describe("indicator visibility application receipts", () => {
  let root: Root; let node: HTMLDivElement; let bus: ChartBus;
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers(); fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", fetchMock);
    node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  async function show(ignoreVisibility: boolean, initial: Initial = {}) {
    await act(async () => root.render(<Fixture {...initial} ignoreVisibility={ignoreVisibility} take={value => { bus = value; }} />));
    act(() => bus.dispatchV2({ on: true, v: 2, batch_id: "show", seq: 1, op: "chart.set_indicators",
      args: { mode: "patch", indicators: [], show: initial.showKeys ?? ["rsi"] },
      target: { schema: "chart.command_target.v1", origin_id: "visible_fixture", context_revision: 1, pane_id: 0, symbol: "SYNTHETIC", tf: "D" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    return fetchMock.mock.calls.map(call => JSON.parse(call[1].body)).find(body => body.acks.length);
  }

  it("shows hidden RSI, preserves EMA/settings, and mirrors the applied successor", async () => {
    const body = await show(false);
    expect(body.acks[0]).toMatchObject({ ok: true, application: { predecessor: { context_revision: 1 }, successor: { context_revision: 2 } } });
    expect(body.session.indicator_visibility).toMatchObject({ schema: "chart.indicator_visibility.v1", hidden: [], effective_hidden: [], keys: ["ema", "rsi"] });
    expect(body.session.indicators).toEqual([{ name: "ema", params: { len: 20 } }, { name: "rsi", params: { len: 14 } }]);
  });

  it("cannot ACK success when the chart owner leaves the study hidden", async () => {
    const body = await show(true);
    expect(body.acks[0]).toMatchObject({ ok: false, error: "chart_context_receipt_failed" });
    expect(body.session.indicator_visibility.hidden).toEqual(["rsi"]);
  });

  it("refuses before effect when a requested native module remains blocked by its hidden parent", async () => {
    const body = await show(false, { initialIndicators: [{ name: "structure", params: { "sr.on": true } }],
      initialHidden: ["structure", "suite:structure/sr"], showKeys: ["suite:structure/sr"] });
    expect(body.acks[0]).toMatchObject({ ok: false, error: "visibility_blocked_by_hidden_parent" });
    expect(body.session.indicator_visibility.hidden).toEqual(["structure", "suite:structure/sr"]);
    expect(body.context_revision).toBe(1);
  });

  it("commits and acknowledges an explicit parent plus native module reveal while retaining sibling choices", async () => {
    const body = await show(false, { initialIndicators: [{ name: "structure", params: { "sr.on": true, "ms.on": true, "sr.minTouches": 3 } }],
      initialHidden: ["structure", "suite:structure/sr", "suite:structure/ms", "cmp:SPY", "pine:custom"],
      showKeys: ["structure", "suite:structure/sr"] });
    expect(body.acks[0]).toMatchObject({ ok: true, application: { successor: { context_revision: 2 } } });
    expect(body.session.indicator_visibility.hidden).toEqual(["suite:structure/ms"]);
    expect(body.session.indicator_visibility.effective_hidden).not.toContain("suite:structure/sr");
    expect(body.session.indicators[0].params["sr.minTouches"]).toBe(3);
  });
});

describe("native module visibility shares the existing hidden owner", () => {
  const current: IndicatorSpec[] = [{ name: "ema", params: { len: 37 } }, { name: "rsi", params: { len: 21 } },
    { name: "structure", params: { "sr.on": true, "ms.on": false, "sr.minTouches": 3 } }];
  const hidden = ["suite:structure/sr", "cmp:SPY", "pine:custom", "suite-pane:legacy", "rsi"];
  const edit = (args: Record<string, unknown>) => translate({ on: true, v: 2, batch_id: "module", seq: 1,
    op: "chart.set_indicators", args: { mode: "patch", indicators: [], ...args } },
    { tfs: ["D"], indicators: ["ema", "rsi", "structure"] }, current);

  it("preserves hidden native children, comparisons, scripts and conventional studies during an unrelated patch", () => {
    const result = edit({ indicators: [{ name: "rsi", params: { len: 34 } }] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(updateIndicatorVisibility(hidden, current, result.setIndicators!)).toEqual(hidden);
    expect(result.setIndicators).toContainEqual(current[2]);
  });

  it("reveals an attached native child using the actual legend key without changing its parameters or siblings", () => {
    const result = edit({ show: ["suite:structure/sr"] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    const flags = updateIndicatorVisibility(hidden, current, result.setIndicators!, result.indicatorVisibility);
    expect(flags).toEqual(hidden.filter(key => key !== "suite:structure/sr"));
    const state = describeIndicatorVisibility(result.setIndicators!, flags);
    expect(state.keys).toContain("suite:structure/sr");
    expect(state.keys).not.toContain("suite:structure/ms");
    expect(state.parents["suite:structure/sr"]).toEqual(["structure"]);
    expect(state.effective_hidden).not.toContain("suite:structure/sr");
    expect(result.setIndicators).toEqual(current);
  });

  it("requires prospective enablement and refuses a show blocked by an explicitly hidden parent", () => {
    expect(edit({ show: ["suite:structure/ms"] })).toMatchObject({ ok: false, error: "visibility_requires_attached_indicator" });
    expect(edit({ indicators: [{ name: "structure", params: { "ms.on": true } }], show: ["suite:structure/ms"] })).toMatchObject({ ok: true });
    expect(edit({ hide: ["structure"], show: ["suite:structure/sr"] })).toMatchObject({ ok: false, error: "conflicting_indicator_visibility" });
    const state = describeIndicatorVisibility(current, ["structure"]);
    expect(state.effective_hidden).toContain("suite:structure/sr");
    expect(state.hidden).toEqual(["structure"]);
  });
});

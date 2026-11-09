// @vitest-environment jsdom
// Authored interface/lifecycle cases; final runtime qualification remains deferred.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BrainWidget from "../../components/BrainWidget";
import type { MastermindBrainHost, ChartStopRequest } from "../mastermindBrain";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request: ChartStopRequest = { scope: "received_batches", batch_ids: ["brain_a"] };
const noop = () => {};

describe("BrainWidget reply Stop bridge", () => {
  let root: Root | undefined, box: HTMLDivElement;
  const host = () => window as unknown as MastermindBrainHost;
  beforeEach(() => {
    box = document.createElement("div"); document.body.appendChild(box);
    delete host().MMBrain; delete host().MM_BRAIN_CFG;
    document.querySelectorAll('script[src*="mm_brain.js"]').forEach(node => node.remove());
  });
  afterEach(() => {
    act(() => root?.unmount()); box.remove(); root = undefined;
    delete host().MMBrain; delete host().MM_BRAIN_CFG;
  });
  const mount = (onChartStop?: (value: ChartStopRequest) => { scope: "received_batches"; cancelled: number }) => {
    act(() => {
      root ??= createRoot(box);
      root.render(React.createElement(BrainWidget, {
        active: "NVDA", onCommand: noop, onAnnotate: noop, onChartStop,
      }));
    });
  };

  it("binds scoped Stop on the very first mount", () => {
    const callback = vi.fn(() => ({ scope: "received_batches" as const, cancelled: 2 }));
    mount(callback);
    expect(host().MM_BRAIN_CFG?.onChartStop?.(request)).toEqual({ scope: "received_batches", cancelled: 2 });
    expect(callback).toHaveBeenCalledWith(request);
  });
  it("updates callbacks without retaining a stale mounted owner", () => {
    const first = vi.fn(() => ({ scope: "received_batches" as const, cancelled: 1 }));
    const next = vi.fn(() => ({ scope: "received_batches" as const, cancelled: 3 }));
    mount(first);
    const retired = host().MM_BRAIN_CFG?.onChartStop;
    mount(next);
    expect(retired?.(request)).toBeUndefined();
    expect(host().MM_BRAIN_CFG?.onChartStop?.(request)?.cancelled).toBe(3);
    expect(first).not.toHaveBeenCalled();
  });
  it("relinquishes its binding and disables a saved callback on unmount", () => {
    const callback = vi.fn(() => ({ scope: "received_batches" as const, cancelled: 1 }));
    mount(callback);
    const retired = host().MM_BRAIN_CFG?.onChartStop;
    act(() => root?.unmount()); root = undefined;
    expect(host().MM_BRAIN_CFG?.onChartStop).toBeUndefined();
    expect(retired?.(request)).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
  });
  it("does not remove a replacement owner's callback during cleanup", () => {
    mount(() => ({ scope: "received_batches", cancelled: 1 }));
    const replacement = vi.fn(() => ({ scope: "received_batches" as const, cancelled: 4 }));
    host().MM_BRAIN_CFG!.onChartStop = replacement;
    act(() => root?.unmount()); root = undefined;
    expect(host().MM_BRAIN_CFG?.onChartStop).toBe(replacement);
  });
  it("an old host without the optional callback cannot claim a cancellation result", () => {
    mount();
    expect(host().MM_BRAIN_CFG?.onChartStop?.(request)).toBeUndefined();
  });
});

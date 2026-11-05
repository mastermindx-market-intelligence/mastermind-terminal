// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BrainWidget from "../../components/BrainWidget";
import type { MastermindBrainHost, ChartStatePreparationResult } from "../mastermindBrain";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, box: HTMLDivElement;
const host = () => window as unknown as MastermindBrainHost;
const request = { origin_id: "chart-owner", context_revision: 7 };
const ready = { ok: true as const, ...request };
beforeEach(() => {
  box = document.createElement("div"); document.body.appendChild(box);
  delete host().MMBrain; delete host().MM_BRAIN_CFG;
  document.querySelectorAll('script[src*="mm_brain.js"]').forEach(node => node.remove());
});
afterEach(() => {
  act(() => root?.unmount()); root = undefined; box.remove();
  delete host().MMBrain; delete host().MM_BRAIN_CFG;
});
function mount(prepareChartState?: () => Promise<ChartStatePreparationResult>) {
  act(() => {
    root ??= createRoot(box);
    root.render(React.createElement(BrainWidget, { active: "NVDA", onCommand: () => {}, prepareChartState }));
  });
}
it("binds preparation on first mount and forwards the exact target and cancellation signal", async () => {
  const prepare = vi.fn(async () => ready), signal = new AbortController().signal;
  mount(prepare);
  await expect(host().MM_BRAIN_CFG!.prepareChartState!(request, signal)).resolves.toEqual(ready);
  expect(prepare).toHaveBeenCalledWith(request, signal);
});
it("retires saved callbacks when a new mounted binding replaces them", async () => {
  const first = vi.fn(async () => ready), next = vi.fn(async () => ready);
  mount(first); const retired = host().MM_BRAIN_CFG!.prepareChartState!;
  mount(next);
  await expect(retired(request)).resolves.toEqual({ ok: false, reason: "host_unmounted" });
  await expect(host().MM_BRAIN_CFG!.prepareChartState!(request)).resolves.toEqual(ready);
  expect(first).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1);
});
it("cannot refresh after unmount or clear a replacement owner's callback", async () => {
  const prepare = vi.fn(async () => ready), replacement = vi.fn(async () => ready);
  mount(prepare); const retired = host().MM_BRAIN_CFG!.prepareChartState!;
  host().MM_BRAIN_CFG!.prepareChartState = replacement;
  act(() => root!.unmount()); root = undefined;
  expect(host().MM_BRAIN_CFG!.prepareChartState).toBe(replacement);
  await expect(retired(request)).resolves.toEqual({ ok: false, reason: "host_unmounted" });
  expect(prepare).not.toHaveBeenCalled();
});
it("leaves general hosts without a chart preparation callback", () => {
  mount(); expect(host().MM_BRAIN_CFG!.prepareChartState).toBeUndefined();
});

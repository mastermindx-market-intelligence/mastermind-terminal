// @vitest-environment jsdom
import React, { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { footerRenders } = vi.hoisted(() => ({ footerRenders: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useT: () => { footerRenders(); return (key: string) => key; } }));
import ChartFrameBar, { DEFAULT_CHART_SETTINGS } from "@/components/ChartFrameBar";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("chart footer clock isolation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hidden = false;
  const onSettings = vi.fn();
  const frame = () => <ChartFrameBar timeframe="D" chartApi={null} settings={DEFAULT_CHART_SETTINGS} onSettings={onSettings} />;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 21, 12, 34, 56));
    hidden = false; footerRenders.mockClear(); onSettings.mockClear();
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    vi.restoreAllMocks(); vi.useRealTimers();
  });
  it("updates the displayed time for 60 seconds without re-rendering the footer controls", async () => {
    await act(async () => root.render(frame()));
    expect(container.querySelector(".cfb-clock")?.textContent).toContain("12:34:56");
    const before = footerRenders.mock.calls.length;
    for (let second = 0; second < 60; second++) await act(async () => vi.advanceTimersByTime(1000));
    expect(container.querySelector(".cfb-clock")?.textContent).toContain("12:35:56");
    expect(footerRenders.mock.calls.length - before).toBe(0);
    expect(onSettings).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });
  it("stops timer work when hidden and immediately catches up on visibility return", async () => {
    await act(async () => root.render(frame()));
    hidden = true; await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    const before = container.querySelector(".cfb-clock")?.textContent;
    await act(async () => vi.advanceTimersByTime(65_000));
    expect(container.querySelector(".cfb-clock")?.textContent).toBe(before);
    hidden = false; await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector(".cfb-clock")?.textContent).toContain("12:36:01");
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(1);
  });
  it("keeps server markup free of a server-local timestamp", () => {
    const html = renderToString(frame());
    expect(html).not.toContain('class="cfb-clock');
    expect(html).not.toContain("12:34:56");
  });
  it("survives StrictMode and removes its interval and visibility listener on unmount", async () => {
    const remove = vi.spyOn(document, "removeEventListener");
    await act(async () => root.render(<StrictMode>{frame()}</StrictMode>));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    expect(remove.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start an interval when a chart first mounts in a hidden document", async () => {
    hidden = true; await act(async () => root.render(frame()));
    expect(vi.getTimerCount()).toBe(0);
    hidden = false; await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector(".cfb-clock")?.textContent).toContain("12:34:56");
    expect(vi.getTimerCount()).toBe(1);
  });
});

// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartFrameBar, { DEFAULT_CHART_SETTINGS } from "@/components/ChartFrameBar";
import type { ChartEngine } from "@/lib/chart-engine/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; const move = vi.fn();
const api = { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: 100 }), timeToCoordinate: () => 40, coordinateToLogical: () => 60, setVisibleLogicalRange: move }) } as unknown as ChartEngine;
function render(request = 0) {
  act(() => root.render(<><ChartFrameBar timeframe="D" chartApi={api} settings={DEFAULT_CHART_SETTINGS} onSettings={() => {}} openGotoRequest={request} /><button id="outside">Outside</button></>));
}
beforeEach(() => {
  localStorage.clear(); move.mockClear(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const trigger = () => host.querySelector<HTMLButtonElement>(".cfb-cal")!;
const input = () => host.querySelector<HTMLInputElement>(".cfb-date-input")!;
const go = () => host.querySelector<HTMLButtonElement>(".cfb-goto-go")!;
const popup = () => host.querySelector<HTMLElement>(".cfb-goto-pop");
const open = () => act(() => { trigger().focus(); trigger().click(); });
const type = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
const key = (el: HTMLElement, key: string, isComposing = false) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true, cancelable: true })); });

describe("Go-to-date disclosure", () => {
  it("opens a named popup with immediate input focus and disabled empty submission", () => {
    open(); expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(popup()!.id);
    expect(popup()!.getAttribute("role")).toBe("dialog");
    expect(input().getAttribute("aria-label")).toBe(trigger().getAttribute("aria-label"));
    expect(document.activeElement).toBe(input()); expect(go().disabled).toBe(true);
  });
  it("returns focus on Escape from the Go button without moving the chart", () => {
    open(); type("2024-06-15"); act(() => go().focus()); key(go(), "Escape");
    expect(popup()).toBeNull(); expect(document.activeElement).toBe(trigger()); expect(move).not.toHaveBeenCalled();
  });
  it("submits through the existing date calculation and restores the trigger", () => {
    open(); type("2024-06-15"); key(input(), "Enter", true); expect(move).not.toHaveBeenCalled();
    key(input(), "Enter"); expect(move).toHaveBeenCalledWith({ from: 10, to: 110 });
    expect(popup()).toBeNull(); expect(document.activeElement).toBe(trigger());
  });
  it("preserves outside focus and has no delayed focus reclaim after dismissal", () => {
    open(); const outside = host.querySelector<HTMLButtonElement>("#outside")!;
    act(() => { outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); outside.focus(); });
    expect(popup()).toBeNull(); act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(outside);
  });
  it("closes when focus leaves the disclosure, but moving back to its trigger does not reopen it", () => {
    open(); act(() => trigger().focus()); expect(popup()).not.toBeNull();
    act(() => trigger().click()); expect(popup()).toBeNull();
    open(); act(() => host.querySelector<HTMLButtonElement>("#outside")!.focus()); expect(popup()).toBeNull();
  });
  it("accepts a new command request through the same popup without delayed autofocus", () => {
    render(1); expect(popup()).not.toBeNull(); expect(document.activeElement).toBe(input());
    key(input(), "Escape"); render(1); expect(popup()).toBeNull();
    render(2); expect(document.activeElement).toBe(input());
  });
});

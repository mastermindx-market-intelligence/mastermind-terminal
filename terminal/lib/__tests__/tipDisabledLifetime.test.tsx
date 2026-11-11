// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tip } from "@/components/ui/Tip";

let host: HTMLDivElement;
let root: Root;
let mounted = false;
let strict = false;
let callbacks: Map<number, FrameRequestCallback>;
let nextFrame: number;
let testEpoch = 0;
const childEvents = { enter: vi.fn(), leave: vi.fn(), focus: vi.fn(), blur: vi.fn(), click: vi.fn() };

function render(disabled = false, label = "Trend line") {
  const element = <Tip label={label} delay={200} disabled={disabled}>
    <button type="button" data-testid="tool" onMouseEnter={childEvents.enter} onMouseLeave={childEvents.leave}
      onFocus={childEvents.focus} onBlur={childEvents.blur} onClick={childEvents.click}>Draw</button>
  </Tip>;
  act(() => root.render(strict ? <StrictMode>{element}</StrictMode> : element));
  mounted = true;
}
function trigger() { return host.querySelector<HTMLButtonElement>("button")!; }
function tooltip() { return document.querySelector<HTMLElement>("[role=tooltip]"); }
function hover() { act(() => trigger().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))); }
function leave() { act(() => trigger().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }))); }
function focus() { act(() => trigger().focus()); }
function blur() { act(() => trigger().blur()); }
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function frame() {
  const queued = [...callbacks.values()]; callbacks.clear();
  act(() => queued.forEach(fn => fn(Date.now())));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(Date.parse("2026-10-14T19:40:00Z") + ++testEpoch * 10000));
  vi.clearAllMocks(); strict = false; callbacks = new Map(); nextFrame = 1;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("requestAnimationFrame", vi.fn((fn: FrameRequestCallback) => { const id = nextFrame++; callbacks.set(id, fn); return id; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in this mounted synthetic suite"); }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); mounted = false;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove(); expect(document.querySelector("[role=tooltip]")).toBeNull();
  expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("Tip disabled lifetime at the preserved DrawingSidebar breakpoint boundary", () => {
  it("cancels a pending hover delay when disabled, before it can open", () => {
    render(); hover(); expect(vi.getTimerCount()).toBe(1);
    render(true); expect(vi.getTimerCount()).toBe(0);
    advance(250); expect(tooltip()).toBeNull();
  });
  it.each(["Trend line", "趋势线"])("does not resurrect an elapsed disabled hover when enabled: %s", label => {
    render(false, label); hover(); render(true, label); advance(250);
    render(false, label); expect(tooltip()).toBeNull();
    expect(trigger().getAttribute("aria-describedby")).toBeNull();
  });
  it("does not let an old pending hover open after a quick disable and enable", () => {
    render(); hover(); advance(100); render(true); render(); advance(100);
    expect(tooltip()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["hover", "focus"])("retires an already open %s tooltip when disabled", mode => {
    render(); if (mode === "hover") { hover(); advance(200); } else focus();
    expect(tooltip()).not.toBeNull(); frame(); expect(tooltip()?.dataset.open).toBe("1");
    const button = trigger(); render(true); expect(tooltip()).toBeNull();
    expect(trigger()).toBe(button); // The actual trigger subtree and its listeners survive.
    render(); expect(tooltip()).toBeNull(); expect(button.getAttribute("aria-describedby")).toBeNull();
  });
  it("starts a fresh hover delay after re-enabling, with no stale deadline", () => {
    render(); hover(); advance(150); render(true); render(); hover(); advance(50);
    expect(tooltip()).toBeNull(); advance(149); expect(tooltip()).toBeNull();
    advance(1); expect(tooltip()?.textContent).toBe("Trend line");
  });
  it("starts a fresh enter animation after re-enabling", () => {
    render(); hover(); advance(200); frame(); expect(tooltip()?.dataset.open).toBe("1");
    render(true); render(); hover(); advance(200);
    expect(tooltip()?.dataset.open).toBe("0"); frame(); expect(tooltip()?.dataset.open).toBe("1");
  });
  it("keeps disabled hover and focus inert while preserving child handlers and clicks", () => {
    render(true); hover(); focus(); act(() => trigger().click()); advance(1000);
    expect(tooltip()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    expect(childEvents.enter).toHaveBeenCalledTimes(1); expect(childEvents.focus).toHaveBeenCalledTimes(1);
    expect(childEvents.click).toHaveBeenCalledTimes(1); blur(); leave();
    expect(childEvents.blur).toHaveBeenCalledTimes(1); expect(childEvents.leave).toHaveBeenCalledTimes(1);
  });
  it("preserves ordinary delayed hover, linked accessible description, and instant close", () => {
    render(); hover(); advance(199); expect(tooltip()).toBeNull(); advance(1);
    expect(tooltip()?.textContent).toBe("Trend line"); expect(trigger().getAttribute("aria-describedby")).toBe(tooltip()?.id);
    leave(); expect(tooltip()).toBeNull(); expect(trigger().getAttribute("aria-describedby")).toBeNull();
  });
  it("preserves immediate focus-open and ordinary blur-close", () => {
    render(); focus(); expect(tooltip()).not.toBeNull();
    blur(); expect(tooltip()).toBeNull();
  });
  it("preserves warm-open after a real hover close", () => {
    render(); hover(); advance(200); leave(); advance(100); hover();
    expect(tooltip()).not.toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans up pending work on unmount and does not reopen a removed portal", () => {
    render(); hover(); act(() => root.unmount()); mounted = false;
    expect(vi.getTimerCount()).toBe(0); advance(500); expect(tooltip()).toBeNull();
  });
  it("survives StrictMode replay and repeated breakpoint transitions without phantom opens", () => {
    strict = true; render(); hover(); render(true); advance(200); render();
    expect(tooltip()).toBeNull(); focus(); expect(tooltip()).not.toBeNull();
    render(true); render(); expect(tooltip()).toBeNull();
  });
});

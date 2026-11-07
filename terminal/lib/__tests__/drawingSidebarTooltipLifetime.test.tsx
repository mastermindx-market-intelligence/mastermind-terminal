// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DrawingSidebar, { type DrawingSidebarProps } from "@/components/DrawingSidebar";

// Actual DrawingSidebar, Tip, drawing-tool registry and useSyncExternalStore media hook.
// Only translation, host media/geometry/frame APIs and command effects are inert fixtures.
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }));
let root: Root;
let host: HTMLDivElement;
let width = 1440;
let epoch = 0;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 1;
let media: EventTarget & { readonly matches: boolean; media: string };
const tool = vi.fn();
const props: DrawingSidebarProps = {
  tool: null, creationDisabledReason: null, magnet: "off", sticky: false, stayActive: false,
  pinned: false, drawingsVisible: true, drawingsLocked: false, drawingCount: 0, userDrawingCount: 0,
  detectedDrawingCount: 0, indicatorCount: 0, canUndo: false, canRedo: false,
  drawStyle: { color: "#4d82ff", width: 1.5, dash: "solid" }, onTool: tool,
  onMagnet: vi.fn(), onSticky: vi.fn(), onPinned: vi.fn(), onToggleVisibility: vi.fn(),
  onToggleLock: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onClear: vi.fn(), onDrawStyle: vi.fn(),
};
const cursor = () => host.querySelector<HTMLButtonElement>("[data-testid=drawing-tool-cursor]")!;
const tips = () => document.querySelectorAll("[role=tooltip]");
function hover() { act(() => cursor().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))); }
function resize(next: number) {
  act(() => { width = next; media.dispatchEvent(new Event("change")); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(Date.parse("2026-10-14T21:00:00Z") + ++epoch * 10000));
  vi.clearAllMocks(); width = 1440; frames = new Map(); nextFrame = 1;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  media = Object.assign(new EventTarget(), { media: "(max-width: 860px)", get matches() { return width <= 860; } });
  // Object.assign evaluates getters; define the live snapshot explicitly.
  Object.defineProperty(media, "matches", { get: () => width <= 860 });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    if (query !== "(max-width: 860px)") throw new Error(`Unexpected media query: ${query}`);
    return media;
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn((fn: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, fn); return id; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden"); }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<DrawingSidebar {...props} />));
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); expect(tips().length).toBe(0);
  expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("actual DrawingSidebar responsive tooltip lifecycle", () => {
  it.each([820, 390])("retires a queued cursor tooltip across 1440 → %i → 1440", compact => {
    const original = cursor(); hover(); resize(compact);
    expect(cursor()).toBe(original);
    expect(host.querySelector("[data-testid=drawing-toolbar]")?.getAttribute("aria-orientation")).toBe("horizontal");
    act(() => vi.advanceTimersByTime(250)); expect(tips().length).toBe(0);
    resize(1440); expect(cursor()).toBe(original); expect(tips().length).toBe(0);
    expect(original.getAttribute("aria-describedby")).toBeNull(); expect(tool).not.toHaveBeenCalled();
    hover(); act(() => vi.advanceTimersByTime(200)); expect(tips().length).toBe(1);
    expect(tips()[0].textContent).toBe("toolCursor");
  });
  it.each([820, 390])("retires an open cursor tooltip across 1440 → %i → 1440", compact => {
    const original = cursor(); hover(); act(() => vi.advanceTimersByTime(200)); expect(tips().length).toBe(1);
    resize(compact); expect(tips().length).toBe(0);
    resize(1440); expect(cursor()).toBe(original); expect(tips().length).toBe(0);
    act(() => original.click()); expect(tool).toHaveBeenCalledTimes(1); expect(tool).toHaveBeenCalledWith(null);
  });
});

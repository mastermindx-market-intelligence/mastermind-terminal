// @vitest-environment jsdom
// Real hook and React lifecycle; external script/auth/network are controlled by this fixture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useBrainOpenIntent } from "../useBrainOpenIntent";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
type Controls = ReturnType<typeof useBrainOpenIntent>;
const useIntent = useBrainOpenIntent;

describe("Brain opening intent follows existing readiness", () => {
  let root: Root | null, container: HTMLDivElement, controls: Controls;
  let include: ReturnType<typeof vi.fn>, open: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>;
  let shown: boolean;
  const host = () => {
    open = vi.fn(() => { shown = true; }); close = vi.fn(() => { shown = false; });
    (window as any).MMBrain = { open, close, toggle: () => shown ? close() : open(), mounted: true };
  };
  const emit = () => act(() => { window.dispatchEvent(new Event("mm-brain-ready")); });
  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  const mount = (query = "", strict = false) => {
    window.history.replaceState({}, "", `/terminal${query}`);
    function Probe() { controls = useIntent(include); return null; }
    root = createRoot(container);
    act(() => { root!.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Probe)) : React.createElement(Probe)); });
  };
  const unmount = () => { if (root) { act(() => root!.unmount()); root = null; } };
  beforeEach(() => { vi.useFakeTimers(); shown = false; root = null; include = vi.fn(); delete (window as any).MMBrain; container = document.createElement("div"); document.body.append(container); });
  afterEach(() => { unmount(); container.remove(); vi.useRealTimers(); delete (window as any).MMBrain; });

  it("opens a warm query immediately even when readiness preceded subscription", () => { host(); emit(); mount("?ai=1"); expect(open).toHaveBeenCalledTimes(1); expect(include).toHaveBeenCalledWith(true); });
  it("opens a cold query on readiness after the former 800ms deadline", () => { mount("?ai=1"); advance(1200); host(); emit(); expect(open).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); });
  it("opens on readiness without waiting for an arbitrary timer", () => { mount("?ai=1"); advance(30); host(); emit(); expect(open).toHaveBeenCalledTimes(1); });
  it("coalesces multiple cold explicit opens", () => { mount(); act(() => { controls.openBrain(); controls.openBrain(); controls.openBrain(); }); host(); emit(); expect(open).toHaveBeenCalledTimes(1); });
  it("coalesces repeated cold copilot events", () => { mount(); act(() => { window.dispatchEvent(new Event("mm:copilot")); window.dispatchEvent(new Event("mm:copilot")); }); advance(1200); host(); emit(); expect(open).toHaveBeenCalledTimes(1); });
  it("does not auto-open from readiness without a query or explicit request", () => { mount(); host(); emit(); expect(open).not.toHaveBeenCalled(); expect(include).not.toHaveBeenCalled(); });
  it("consumes query intent once across duplicate readiness", () => { mount("?ai=1"); host(); emit(); emit(); expect(open).toHaveBeenCalledTimes(1); });
  it("never reopens after explicit close and a delayed duplicate ready event", () => { mount("?ai=1"); advance(30); host(); emit(); act(() => close()); emit(); advance(2000); expect(open).toHaveBeenCalledTimes(1); expect(shown).toBe(false); });
  it("manual warm open/close consumes earlier cold query before delayed readiness", () => { mount("?ai=1"); advance(30); host(); act(() => { controls.toggleBrain(); controls.toggleBrain(); }); emit(); advance(2000); expect(open).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1); expect(shown).toBe(false); });
  it("unmount abandons intent and removes the event listener", () => { mount("?ai=1"); unmount(); host(); emit(); act(() => window.dispatchEvent(new Event("mm:copilot"))); advance(2000); expect(open).not.toHaveBeenCalled(); });
  it("route departure cannot open the next route's singleton", () => { mount("?ai=1"); advance(100); unmount(); window.history.replaceState({}, "", "/analysis"); host(); emit(); advance(2000); expect(open).not.toHaveBeenCalled(); });
  it("explicit cancellation for workspace exclusion prevents delayed open", () => { mount("?ai=1"); act(() => controls.cancelPendingBrainOpen()); host(); emit(); advance(2000); expect(open).not.toHaveBeenCalled(); });
  it("a later explicit open is permitted after cancellation", () => { mount("?ai=1"); act(() => { controls.cancelPendingBrainOpen(); controls.openBrain(); }); host(); emit(); expect(open).toHaveBeenCalledTimes(1); });
  it("two cold toggle clicks cancel pending opening intent", () => { mount(); act(() => { controls.toggleBrain(); controls.toggleBrain(); }); host(); emit(); expect(open).not.toHaveBeenCalled(); });
  it("a cold toggle still opens once after readiness", () => { mount(); act(() => controls.toggleBrain()); host(); emit(); expect(open).toHaveBeenCalledTimes(1); });
  it("warm toggle preserves open then close", () => { host(); mount(); act(() => { controls.toggleBrain(); controls.toggleBrain(); }); expect(open).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1); });
  it("StrictMode cold query opens once, with no dangling timer", () => { mount("?ai=1", true); host(); emit(); advance(2000); expect(open).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); });
  it("StrictMode warm query is consumed only once", () => { host(); mount("?ai=1", true); expect(open).toHaveBeenCalledTimes(1); });
  it("a malformed readiness event without a callable API does not claim success", () => { mount("?ai=1"); (window as any).MMBrain = { mounted: true }; emit(); host(); emit(); expect(open).toHaveBeenCalledTimes(1); });
  it("unavailable host does not start a timer, script, fetch or login", () => { const fetchSpy = vi.spyOn(globalThis, "fetch"); mount(); act(() => controls.openBrain()); advance(10000); expect(fetchSpy).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); expect(document.querySelectorAll("script")).toHaveLength(0); expect(window.location.pathname).toBe("/terminal"); fetchSpy.mockRestore(); });
  it("retained callbacks cannot open after unmount", () => { mount(); const retained = controls.openBrain; unmount(); host(); act(() => retained()); expect(open).not.toHaveBeenCalled(); });
});

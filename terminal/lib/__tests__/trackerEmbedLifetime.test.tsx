// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
 pathname: "/terminal", track: vi.fn(), flush: vi.fn(), newSession: vi.fn(() => true),
 setFingerprint: vi.fn(), deviceFingerprint: vi.fn(() => "synthetic-fingerprint"),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mock.pathname }));
vi.mock("@/lib/analytics", () => ({ track: mock.track, flush: mock.flush, newSession: mock.newSession, setFingerprint: mock.setFingerprint }));
vi.mock("@/lib/fingerprint", () => ({ deviceFingerprint: mock.deviceFingerprint }));
import Tracker from "@/components/Tracker";

let root: Root;
let host: HTMLDivElement;
let button: HTMLButtonElement;
let mounted = false;
let scheduled: Map<number, () => void>;
let cancelIdle: ReturnType<typeof vi.fn>;
let nextIdle: number;
let strict = false;
function render(pathname: string) {
 mock.pathname = pathname;
 window.history.replaceState({}, "", pathname);
 act(() => root.render(strict ? <StrictMode><Tracker /></StrictMode> : <Tracker />));
 mounted = true;
}
function resetCalls() {
 mock.track.mockClear(); mock.flush.mockClear(); mock.deviceFingerprint.mockClear(); mock.setFingerprint.mockClear();
}
function fireInteractions() {
 button.click();
 window.dispatchEvent(new CustomEvent("mm:track", { detail: { type: "ticker_view", ticker: "SYNTHETIC" } }));
 window.dispatchEvent(new Event("pagehide"));
 Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
 document.dispatchEvent(new Event("visibilitychange"));
}
function runIdle() {
 const callbacks = [...scheduled.values()]; scheduled.clear();
 act(() => callbacks.forEach(fn => fn()));
}
function useTimeoutFallback() {
 Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: undefined });
 Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: undefined });
}
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T19:00:00Z"));
 vi.clearAllMocks(); mock.newSession.mockReturnValue(true); strict = false;
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 scheduled = new Map(); nextIdle = 1;
 cancelIdle = vi.fn((id: number) => { scheduled.delete(id); });
 Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: vi.fn((fn: () => void) => { const id = nextIdle++; scheduled.set(id, fn); return id; }) });
 Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: cancelIdle });
 Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
 host = document.createElement("div"); button = document.createElement("button"); button.textContent = "Synthetic control";
 document.body.append(host, button); root = createRoot(host); mounted = false;
 // Any accidental transport is a test failure. Analytics and fingerprint are mocked before import.
 vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in this synthetic suite"); }));
 Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: vi.fn(() => { throw new Error("Beacon is forbidden in this synthetic suite"); }) });
});
afterEach(() => {
 if (mounted) act(() => root.unmount());
 expect(fetch).not.toHaveBeenCalled(); expect(navigator.sendBeacon).not.toHaveBeenCalled();
 host.remove(); button.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("Tracker's existing embed exclusion survives its actual mounted lifetime", () => {
 it("does not set up listeners, fingerprint jobs, sessions or pageviews on an initial embed route", () => {
  render("/embed/chart"); fireInteractions(); runIdle(); act(() => vi.runAllTimers());
  expect(mock.track).not.toHaveBeenCalled(); expect(mock.flush).not.toHaveBeenCalled();
  expect(mock.newSession).not.toHaveBeenCalled(); expect(mock.deviceFingerprint).not.toHaveBeenCalled();
 });
 it("removes every global tracking listener when a preserved root enters embed", () => {
  render("/terminal"); runIdle(); render("/embed/chart"); resetCalls(); fireInteractions();
  expect(mock.track).not.toHaveBeenCalled(); expect(mock.flush).not.toHaveBeenCalled();
 });
 it("cancels a pending idle fingerprint job on entering embed, and fences a captured late callback", () => {
  render("/terminal"); const late = [...scheduled.values()][0]; render("/embed/chart"); resetCalls();
  expect(cancelIdle).toHaveBeenCalledWith(1); expect(scheduled.size).toBe(0);
  act(() => late()); expect(mock.deviceFingerprint).not.toHaveBeenCalled(); expect(mock.setFingerprint).not.toHaveBeenCalled();
 });
 it("cancels the timeout fallback on entering embed", () => {
  useTimeoutFallback(); render("/terminal"); expect(vi.getTimerCount()).toBe(1);
  render("/embed/chart"); expect(vi.getTimerCount()).toBe(0); resetCalls();
  act(() => vi.advanceTimersByTime(1000)); expect(mock.deviceFingerprint).not.toHaveBeenCalled();
 });
 it("starts the existing normal-route listeners after an initial embed route", () => {
  render("/embed/chart"); render("/terminal"); resetCalls(); button.click();
  window.dispatchEvent(new CustomEvent("mm:track", {detail:{type:"ticker_view",ticker:"SYNTHETIC"}}));
  runIdle();
  expect(mock.track.mock.calls.map(([event]) => event.type)).toEqual(["click","ticker_view"]);
  expect(mock.deviceFingerprint).toHaveBeenCalledTimes(1); expect(mock.setFingerprint).toHaveBeenCalledWith("synthetic-fingerprint");
 });
 it("restores one listener set after normal-to-embed-to-normal and repeated embed transitions", () => {
  render("/terminal"); render("/embed/chart"); render("/analysis"); render("/embed/chart"); render("/terminal");
  resetCalls(); button.click(); runIdle();
  expect(mock.track).toHaveBeenCalledTimes(1); expect(mock.track.mock.calls[0][0].type).toBe("click");
  expect(mock.deviceFingerprint).toHaveBeenCalledTimes(1);
 });
 it("keeps setup stable across ordinary routes and preserves pageview, route, bus and exit events", () => {
  render("/terminal"); const first = [...scheduled.keys()]; render("/analysis");
  expect([...scheduled.keys()]).toEqual(first);
  expect(mock.track.mock.calls.map(([event]) => event.type)).toEqual(["session_start","pageview","route"]);
  expect(mock.track.mock.calls[2][0]).toMatchObject({path:"/analysis",ref:"/terminal"});
  resetCalls(); fireInteractions();
  expect(mock.track.mock.calls.map(([event]) => event.type)).toEqual(["click","ticker_view","exit","exit"]);
  expect(mock.flush).toHaveBeenCalledTimes(2);
 });
 it("does not recalculate a completed fingerprint after returning from embed", () => {
  render("/terminal"); runIdle(); expect(mock.deviceFingerprint).toHaveBeenCalledTimes(1);
  render("/embed/chart"); render("/analysis");
  expect(scheduled.size).toBe(0); runIdle();
  expect(mock.deviceFingerprint).toHaveBeenCalledTimes(1); expect(mock.setFingerprint).toHaveBeenCalledTimes(1);
 });
 it("cannot revive an old idle job when this root returns to a normal route", () => {
  render("/terminal"); const late = [...scheduled.values()][0]; render("/embed/chart"); render("/analysis");
  resetCalls(); act(() => late()); expect(mock.deviceFingerprint).not.toHaveBeenCalled();
  runIdle(); expect(mock.deviceFingerprint).toHaveBeenCalledTimes(1);
 });
 it("cancels idle work on unmount even if a captured callback is delivered afterward", () => {
  render("/terminal"); const late = [...scheduled.values()][0]; act(() => root.unmount()); mounted = false;
  resetCalls(); act(() => late()); fireInteractions();
  expect(cancelIdle).toHaveBeenCalledWith(1); expect(mock.deviceFingerprint).not.toHaveBeenCalled();
  expect(mock.track).not.toHaveBeenCalled(); expect(mock.flush).not.toHaveBeenCalled();
 });
 it("cancels timeout work on unmount", () => {
  useTimeoutFallback(); render("/terminal"); act(() => root.unmount()); mounted = false; resetCalls();
  expect(vi.getTimerCount()).toBe(0); act(() => vi.advanceTimersByTime(1000));
  expect(mock.deviceFingerprint).not.toHaveBeenCalled();
 });
 it("leaves only the current fingerprint job and listeners through StrictMode setup-cleanup-setup", () => {
  strict = true; render("/terminal"); resetCalls(); runIdle(); button.click();
  expect(mock.deviceFingerprint).toHaveBeenCalledTimes(1); expect(mock.track).toHaveBeenCalledTimes(1);
 });
 it("fences idle jobs when cancellation is unavailable without changing the embed route rule", () => {
  Object.defineProperty(window, "cancelIdleCallback", { configurable:true, value:undefined });
  render("/terminal"); const late=[...scheduled.values()][0]; render("/embed/chart"); resetCalls(); act(() => late());
  expect(mock.deviceFingerprint).not.toHaveBeenCalled(); expect(mock.setFingerprint).not.toHaveBeenCalled();
 });
});


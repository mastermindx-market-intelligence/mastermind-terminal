// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdaptiveToolbar } from "../useAdaptiveToolbar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const { ref, mode } = useAdaptiveToolbar("en|D,W|1|W");
  return <div ref={ref} data-mode={mode} className="chart-tabs">
    <span className="ct" data-width="100">Price chart</span>
    <div className="tools">
      <div data-toolbar-item data-toolbar-core="true" data-toolbar-timeframes data-width="200">
        <button className="tfbtn on" data-width="30">W</button>
        <button className="tfbtn-edit" data-width="30">Edit</button>
      </div>
      <button data-toolbar-item data-toolbar-core="true" data-width="100">Chart</button>
      <button data-toolbar-item data-width="300">Indicators</button>
      <div data-toolbar-more data-width="40">More</div>
    </div>
  </div>;
}

describe("adaptive toolbar hidden-to-visible geometry", () => {
  let host: HTMLDivElement, root: Root;
  let visible: boolean, available: number, scale: number;
  let resize: () => void, fontsReady: () => void;
  let originalFonts: PropertyDescriptor | undefined;
  let disconnected: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    visible = true; available = 500; scale = 1;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    disconnected = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() { disconnected(); }
    });
    originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>(resolve => { fontsReady = resolve; }) } });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return visible ? available : 0; });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = visible ? Number(this.dataset.width ?? available) * scale : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: visible ? 44 : 0, width, height: visible ? 44 : 0, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (visible ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ paddingLeft: "0", paddingRight: "0", marginLeft: "0", marginRight: "0", columnGap: "0", gap: "0" }) as CSSStyleDeclaration);
  });
  afterEach(() => {
    act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
    else Reflect.deleteProperty(document, "fonts");
  });
  const mode = () => host.firstElementChild?.getAttribute("data-mode");
  const mount = () => act(() => root.render(<Harness />));
  it("measures real controls on first reveal after a hidden phone mount", () => {
    visible = false; mount(); visible = true; act(() => resize());
    expect(mode()).toBe("overflow");
  });
  it("invalidates hidden geometry so changed text is measured on reveal", () => {
    mount(); expect(mode()).toBe("overflow");
    visible = false; act(() => resize()); scale = 2; visible = true; act(() => resize());
    expect(mode()).toBe("compact");
  });
  it("keeps the measured full, overflow and compact width choices", () => {
    mount(); expect(mode()).toBe("overflow");
    available = 800; act(() => resize()); expect(mode()).toBe("full");
    available = 150; act(() => resize()); expect(mode()).toBe("compact");
  });
  it("disconnects observation and ignores late font readiness after unmount", async () => {
    mount(); act(() => root.unmount()); root = createRoot(host);
    expect(disconnected).toHaveBeenCalledOnce();
    await act(async () => { fontsReady(); await Promise.resolve(); });
    expect(host.childElementCount).toBe(0);
  });
});

// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartFrameBar, { DEFAULT_CHART_SETTINGS } from "@/components/ChartFrameBar";
import type { ChartEngine } from "@/lib/chart-engine/api";
import { EnginePriceScaleMode } from "@/lib/chart-engine";
import { symbolSearchSeedFromKey, hasOpenModal, shouldOpenPaletteFromKey } from "@/lib/commandPalette/catalog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function chart() {
  let range = { from: 0, to: 100 };
  const setRange = vi.fn((next: typeof range) => { range = next; });
  return { api: { timeScale: () => ({ getVisibleLogicalRange: () => range, setVisibleLogicalRange: setRange }) } as unknown as ChartEngine, setRange };
}
let host: HTMLDivElement; let root: Root;
let a: ReturnType<typeof chart>; let b: ReturnType<typeof chart>;
let changeA: ReturnType<typeof vi.fn>; let changeB: ReturnType<typeof vi.fn>;
const settings = { ...DEFAULT_CHART_SETTINGS, mode: EnginePriceScaleMode.Normal, invertScale: false };
function render(active: number) {
  act(() => root.render(<>
    <ChartFrameBar isActive={active === 0} timeframe="D" chartApi={a.api} settings={settings} onSettings={changeA} />
    <ChartFrameBar isActive={active === 1} timeframe="D" chartApi={b.api} settings={settings} onSettings={changeB} />
  </>));
}
function key(value: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); }); return e;
}
beforeEach(() => {
  localStorage.clear(); a = chart(); b = chart(); changeA = vi.fn(); changeB = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); render(0);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("Mounted chart shortcut ownership", () => {
  it("pans and zooms only the active frame, then transfers ownership", () => {
    key("ArrowLeft"); expect(a.setRange).toHaveBeenLastCalledWith({ from: -10, to: 90 }); expect(b.setRange).not.toHaveBeenCalled();
    key("+"); expect(a.setRange).toHaveBeenLastCalledWith({ from: 0, to: 80 }); expect(b.setRange).not.toHaveBeenCalled();
    render(1); const calls = a.setRange.mock.calls.length;
    key("ArrowRight", { shiftKey: true }); expect(b.setRange).toHaveBeenLastCalledWith({ from: 50, to: 150 });
    key("-"); expect(b.setRange).toHaveBeenLastCalledWith({ from: 37.5, to: 162.5 }); expect(a.setRange).toHaveBeenCalledTimes(calls);
    key("ArrowLeft", { repeat: true }); expect(b.setRange).toHaveBeenCalledTimes(3);
  });
  it("scopes all Alt toggles to the selected frame", () => {
    key("i", { altKey: true }); key("p", { altKey: true }); key("l", { altKey: true });
    expect(changeA.mock.calls.map(([patch]) => patch)).toEqual([{ invertScale: true }, { mode: EnginePriceScaleMode.Percentage }, { mode: EnginePriceScaleMode.Logarithmic }]);
    expect(changeB).not.toHaveBeenCalled();
    render(1); key("i", { altKey: true }); expect(changeA).toHaveBeenCalledTimes(3); expect(changeB).toHaveBeenCalledWith({ invertScale: true });
  });
  it("yields before either branch to handled events, composition and browser modifiers", () => {
    const prevented = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }); prevented.preventDefault();
    act(() => document.body.dispatchEvent(prevented));
    for (const init of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }]) {
      key("ArrowLeft", init); key("i", { ...init, altKey: true });
    }
    expect(a.setRange).not.toHaveBeenCalled(); expect(b.setRange).not.toHaveBeenCalled();
    expect(changeA).not.toHaveBeenCalled(); expect(changeB).not.toHaveBeenCalled();
  });
  it("respects editable and native control ownership even when the event targets body", () => {
    const controls = document.createElement("div");
    controls.innerHTML = '<input><textarea></textarea><select><option>A</option></select><div contenteditable="true" tabindex="0"><span>Editable</span></div><div role="combobox" tabindex="0"></div><button><span>Action</span></button><a href="#" tabindex="0">Link</a><div role="slider" tabindex="0"></div>';
    document.body.append(controls);
    for (const target of controls.children) {
      (target as HTMLElement).focus(); key("ArrowLeft"); key("i", { altKey: true });
    }
    (document.activeElement as HTMLElement).blur();
    key("ArrowLeft", {}, controls.querySelector("button span")!);
    key("i", { altKey: true }, controls.querySelector("button span")!);
    expect(a.setRange).not.toHaveBeenCalled(); expect(changeA).not.toHaveBeenCalled();
  });
  it("yields while a visible modal owns the page, including body-retargeted keys", () => {
    const dialog = document.createElement("div"); dialog.setAttribute("aria-modal", "true"); document.body.append(dialog);
    key("ArrowLeft"); key("i", { altKey: true }); expect(a.setRange).not.toHaveBeenCalled(); expect(changeA).not.toHaveBeenCalled();
    dialog.hidden = true; key("ArrowLeft"); expect(a.setRange).toHaveBeenCalledTimes(1);
  });
  it("removes global listeners when all frames unmount", () => {
    act(() => root.render(null)); key("ArrowLeft"); key("i", { altKey: true });
    expect(a.setRange).not.toHaveBeenCalled(); expect(b.setRange).not.toHaveBeenCalled();
    expect(changeA).not.toHaveBeenCalled(); expect(changeB).not.toHaveBeenCalled();
  });
});

describe("Symbol search keyboard ownership", () => {
  const env = () => ({ target: document.body, active: document.body, modalOpen: false });
  it("preserves bare symbol seeds and explicit search shortcuts", () => {
    expect(symbolSearchSeedFromKey({ key: "A" }, env())).toBe("A");
    expect(symbolSearchSeedFromKey({ key: "7" }, env())).toBe("7");
    expect(symbolSearchSeedFromKey({ key: "k", metaKey: true }, env())).toBe("");
    expect(symbolSearchSeedFromKey({ key: "K", ctrlKey: true }, env())).toBe("");
    expect(symbolSearchSeedFromKey({ key: "+" }, env())).toBeNull();
  });
  it("does not reopen search from handled, repeating, composing or modal-owned keys", () => {
    for (const init of [{ defaultPrevented: true }, { repeat: true }, { isComposing: true }, { keyCode: 229 }, { altKey: true }]) {
      expect(symbolSearchSeedFromKey({ key: "A", ...init }, env())).toBeNull();
      expect(symbolSearchSeedFromKey({ key: "k", ctrlKey: true, ...init }, env())).toBeNull();
    }
    expect(symbolSearchSeedFromKey({ key: "A" }, { ...env(), modalOpen: true })).toBeNull();
    expect(symbolSearchSeedFromKey({ key: "k", metaKey: true }, { ...env(), modalOpen: true })).toBeNull();
    expect(shouldOpenPaletteFromKey({ key: ">", defaultPrevented: true }, env())).toBe(false);
  });
  it("keeps typing in selects, editable descendants and custom text fields", () => {
    const group = document.createElement("div");
    group.innerHTML = '<select></select><div contenteditable="true"><b>Text</b></div><div role="textbox"></div><div role="combobox"><span>Text</span></div>';
    document.body.append(group);
    for (const target of group.querySelectorAll("select, b, [role=textbox], span")) {
      expect(symbolSearchSeedFromKey({ key: "A" }, { ...env(), target })).toBeNull();
      expect(symbolSearchSeedFromKey({ key: "k", metaKey: true }, { ...env(), active: target })).toBeNull();
    }
  });
  it("recognizes native modality without treating every open dialog as modal", () => {
    const dialog = document.createElement("dialog"); dialog.open = true; document.body.append(dialog);
    // jsdom does not implement showModal/:modal. Model only that browser selector;
    // actual show() versus showModal() ownership is exercised in Playwright.
    const query = document.querySelectorAll.bind(document);
    let modal = false;
    vi.spyOn(document, "querySelectorAll").mockImplementation(((selector: string) => selector === "dialog:modal" ? (modal ? [dialog] : []) : query(selector)) as typeof document.querySelectorAll);
    expect(hasOpenModal(document)).toBe(false);
    modal = true; expect(hasOpenModal(document)).toBe(true);
    dialog.hidden = true; expect(hasOpenModal(document)).toBe(false);
  });
});

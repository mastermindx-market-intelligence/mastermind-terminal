// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompareSettings from "@/components/CompareSettings";
import { type CmpCfg } from "@/lib/compare";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let methods: ReadonlyArray<readonly ["showModal" | "close", PropertyDescriptor | undefined]>;
const changed = vi.fn();
const initial: CmpCfg = { color: "rgba(25, 194, 194, 0.4)", lineStyle: 2, lineWidth: 2, mode: "percent", anchor: "2024-01-02" };

function Owner() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(initial);
  return <><button className="opener" onClick={() => setOpen(true)}>SPY settings</button>
    {open && <CompareSettings sym="SPY" cfg={cfg} onChange={(patch) => {
      changed(patch); setCfg((old) => ({ ...old, ...patch }));
    }} onClose={() => setOpen(false)} />}
    <output>{JSON.stringify(cfg)}</output></>;
}

beforeEach(() => {
  changed.mockClear();
  methods = (["showModal", "close"] as const).map((key) => [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)] as const);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.hidden ? [] : [new DOMRect(0, 0, 40, 32)]) as unknown as DOMRectList;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<Owner />));
});

afterEach(() => {
  act(() => root.unmount()); host.remove();
  for (const [key, descriptor] of methods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
  vi.restoreAllMocks();
});

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.getAttribute("aria-label") || el.textContent) === name);
  expect(found, name).toBeDefined(); return found!;
}
function open() {
  const opener = button("SPY settings");
  act(() => { opener.focus(); opener.click(); });
  return host.querySelector<HTMLDialogElement>("dialog")!;
}
function key(el: HTMLElement, value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(event); }); return event;
}

describe("comparison settings interaction", () => {
  it("opens one native modal, contains sequential focus and restores the opener", () => {
    const oldOverflow = document.body.style.overflow;
    const dialog = open();
    expect(dialog).toBeInstanceOf(HTMLDialogElement);
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe("hidden");
    const close = button("Close"), done = button("Done");
    act(() => done.focus()); key(done, "Tab"); expect(document.activeElement).toBe(close);
    key(close, "Tab", true); expect(document.activeElement).toBe(done);
    act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(button("SPY settings"));
    expect(document.body.style.overflow).toBe(oldOverflow);
  });

  it("shows the actual RGB color and preserves its saved opacity when choosing a swatch", () => {
    open();
    expect(host.querySelector<HTMLInputElement>('input[type="color"]')!.value).toBe("#19c2c2");
    expect(button("Color: #19c2c2").getAttribute("aria-pressed")).toBe("true");
    act(() => button("Color: #26c281").click());
    expect(changed).toHaveBeenLastCalledWith({ color: "rgba(38, 194, 129, 0.4)" });
    expect(button("Color: #26c281").getAttribute("aria-pressed")).toBe("true");
  });

  it("exposes selected controls, bounds thickness and preserves unrelated comparison terms", () => {
    open();
    expect(button("Dashed").getAttribute("aria-pressed")).toBe("true");
    act(() => button("Dotted").click());
    expect(changed).toHaveBeenLastCalledWith({ lineStyle: 1 });
    const width = host.querySelector<HTMLInputElement>('input[aria-label="Thickness"]');
    expect(width).not.toBeNull();
    act(() => button("Decrease thickness").click());
    expect(width!.value).toBe("1");
    expect(button("Decrease thickness").disabled).toBe(true);
    act(() => button("Increase thickness").click());
    act(() => button("Increase thickness").click());
    act(() => button("Increase thickness").click());
    expect(width!.value).toBe("4");
    expect(button("Increase thickness").disabled).toBe(true);
    expect(JSON.parse(host.querySelector("output")!.textContent!).anchor).toBe(initial.anchor);
  });

  it("keeps live changes and focus through owner rerenders, then closes through Done", () => {
    const dialog = open(); const dotted = button("Dotted");
    act(() => { dotted.focus(); dotted.click(); });
    expect(host.querySelector("dialog")).toBe(dialog);
    expect(document.activeElement).toBe(dotted);
    act(() => button("Done").click());
    open();
    expect(button("Dotted").getAttribute("aria-pressed")).toBe("true");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("keeps dialog keystrokes out of page-level symbol search", () => {
    const dialog = open(); const pageKey = vi.fn(); window.addEventListener("keydown", pageKey);
    try { key(dialog, "A"); expect(pageKey).not.toHaveBeenCalled(); }
    finally { window.removeEventListener("keydown", pageKey); }
  });
});

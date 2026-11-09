// @vitest-environment jsdom
import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WatchlistDisplaySettings from "@/components/WatchlistDisplaySettings";
import { DEFAULT_WATCHLIST_SETTINGS, type WatchlistSettings } from "@/lib/watchlistSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;

function Harness({ present = true }: { present?: boolean }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<WatchlistSettings>({ ...DEFAULT_WATCHLIST_SETTINGS, cols: { ...DEFAULT_WATCHLIST_SETTINGS.cols }, colW: { sym: 180 } });
  const launcher = useRef<HTMLButtonElement>(null);
  return <div className="rail-body">
    <button id="launcher" ref={launcher} aria-expanded={open} onClick={() => { const next = !open; setOpen(false); setOpen(next); }}>Display</button>
    {present && <WatchlistDisplaySettings id="display-settings" open={open} settings={settings} onChange={setSettings}
      launcherRef={launcher} onClose={() => setOpen(false)} />}
    <button id="outside" onClick={() => setOpen(false)}>Outside</button>
    <output>{JSON.stringify(settings)}</output>
  </div>;
}

const launcher = () => host.querySelector<HTMLButtonElement>("#launcher")!;
const panel = () => host.querySelector<HTMLElement>('[role="dialog"]');
const input = (key: string) => host.querySelector<HTMLInputElement>(`[data-watchlist-setting="${key}"] input`)!;
const snapshot = () => JSON.parse(host.querySelector("output")!.textContent!);
const open = () => act(() => { launcher().focus(); launcher().click(); });
const click = (el: HTMLElement) => act(() => { el.focus(); el.click(); });
const escape = (el: HTMLElement, composing = false) => act(() => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: composing, bubbles: true, cancelable: true }));
});

beforeEach(() => {
  localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.style.display === "none" ? [] : [new DOMRect(0, 0, 20, 20)]) as unknown as DOMRectList;
  });
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("watchlist display disclosure", () => {
  it("opens a named nonmodal panel at the native table-view switch", () => {
    open(); expect(panel()!.getAttribute("aria-label")).toBe("Watchlists: Settings");
    expect(panel()!.hasAttribute("aria-modal")).toBe(false);
    expect(document.activeElement).toBe(panel()!.querySelector('[role="switch"]'));
    expect((document.activeElement as HTMLInputElement).checked).toBe(true);
  });

  it("changes only the chosen column and keeps focus through controlled rerender", () => {
    open(); click(input("last"));
    expect(input("last").checked).toBe(false); expect(document.activeElement).toBe(input("last"));
    expect(input("ext").checked).toBe(true); expect(input("extPct").checked).toBe(true);
    expect(snapshot().colW).toEqual({ sym: 180 });
    click(input("ext")); expect(snapshot().cols).toMatchObject({ last: false, ext: false, extPct: true });
    expect(document.activeElement).toBe(input("ext")); expect(panel()).not.toBeNull();
  });

  it("keeps the table switch and radio choices in the existing settings state", () => {
    open(); click(panel()!.querySelector<HTMLInputElement>('[role="switch"]')!);
    expect(snapshot().tableView).toBe(false);
    const name = panel()!.querySelector<HTMLInputElement>('input[type="radio"][value="name"]')!;
    click(name); expect(name.checked).toBe(true); expect(snapshot().disp).toBe("name");
    expect(panel()!.querySelector<HTMLInputElement>('input[value="symbol"]')!.checked).toBe(false);
    expect(document.activeElement).toBe(name); expect(snapshot().cols.last).toBe(true);
  });

  it("Escape belongs to the disclosure and restores its visible launcher", () => {
    const leak = vi.fn(); window.addEventListener("keydown", leak);
    open(); act(() => input("volume").focus()); escape(input("volume"));
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(launcher()); expect(leak).not.toHaveBeenCalled();
    window.removeEventListener("keydown", leak);
  });

  it("does not dismiss while composing or move focus to a hidden launcher", () => {
    open(); escape(input("last"), true); expect(panel()).not.toBeNull();
    launcher().style.display = "none"; escape(input("last"));
    expect(panel()).toBeNull(); expect(document.activeElement).not.toBe(launcher());
  });

  it("preserves outside focus and never reclaims it during unmount", () => {
    open(); const outside = host.querySelector<HTMLButtonElement>("#outside")!;
    act(() => outside.focus()); expect(panel()).toBeNull(); expect(document.activeElement).toBe(outside);
    open(); act(() => root.render(<Harness present={false} />));
    expect(document.activeElement).not.toBe(launcher());
  });

  it("allows focus to return to the launcher before its click closes without reopening", () => {
    open(); act(() => launcher().focus()); expect(panel()).not.toBeNull();
    act(() => launcher().click()); expect(panel()).toBeNull();
    open(); expect(panel()).not.toBeNull();
  });

  it("bounds the scroll panel to the clipping rail and recalculates on resize", () => {
    let bottom = 400;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("rail-body") ? new DOMRect(0, 100, 340, bottom - 100) : new DOMRect(0, 200, 232, 400);
    });
    open(); expect(panel()!.style.maxHeight).toBe("192px");
    bottom = 330; act(() => window.dispatchEvent(new Event("resize")));
    expect(panel()!.style.maxHeight).toBe("122px");
    expect(document.activeElement).toBe(panel()!.querySelector('[role="switch"]'));
  });
});

// @vitest-environment jsdom
import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TimeframePicker from "@/components/TimeframePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; const select = vi.fn();
const available = new Set(["D", "2D", "W"]);
const groups = [["Seconds", ["1s"]], ["Days", ["D", "2D"]], ["Weeks", ["W"]]] as const;

function Harness() {
  const [open, setOpen] = useState(false), [timeframe, setTimeframe] = useState("D");
  const [favorites, setFavorites] = useState(["D"]); const launcher = useRef<HTMLButtonElement>(null);
  return <>
    <button id="launcher" ref={launcher} aria-expanded={open} onClick={() => { const next = !open; setOpen(false); setOpen(next); }}>Timeframes</button>
    <TimeframePicker id="timeframe-options" open={open} mobile={false} timeframe={timeframe} groups={groups}
      available={available} favorites={favorites} disabledReason={() => "US stocks only"} launcherRef={launcher}
      onSelect={(value) => { select(value); setTimeframe(value); }}
      onFavorite={(value) => setFavorites((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])}
      onClose={() => setOpen(false)} />
    <button id="outside">Outside</button><output>{JSON.stringify({ timeframe, favorites })}</output>
  </>;
}

const launcher = () => host.querySelector<HTMLButtonElement>("#launcher")!;
const panel = () => host.querySelector<HTMLElement>('[role="dialog"]');
const button = (value: string, action = "select") => host.querySelector<HTMLButtonElement>(`[data-timeframe-row="${value}"] [data-timeframe-action="${action}"]`)!;
const snapshot = () => JSON.parse(host.querySelector("output")!.textContent!);
const open = () => act(() => { launcher().focus(); launcher().click(); });
const click = (control: HTMLElement) => act(() => { control.focus(); control.click(); });
const key = (control: HTMLElement, name: string, options: { prevented?: boolean; composing?: boolean; ctrl?: boolean } = {}) => act(() => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, isComposing: options.composing, ctrlKey: options.ctrl });
  if (options.prevented) event.preventDefault(); control.dispatchEvent(event);
});

beforeEach(() => {
  select.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 20, 20)] as unknown as DOMRectList);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("native timeframe picker", () => {
  it("opens a named popup on the currently selected interval", () => {
    open(); expect(panel()!.getAttribute("aria-label")).toBe("Timeframe");
    expect(document.activeElement).toBe(button("D")); expect(button("D").getAttribute("aria-pressed")).toBe("true");
    expect(button("2D").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps unavailable intervals disabled with their existing reason while allowing favorites", () => {
    open(); const unavailable = button("1s"); expect(unavailable.disabled).toBe(true);
    expect(document.getElementById(unavailable.getAttribute("aria-describedby")!)!.textContent).toBe("US stocks only");
    act(() => unavailable.click()); expect(select).not.toHaveBeenCalled();
    click(button("1s", "favorite")); expect(snapshot()).toEqual({ timeframe: "D", favorites: ["D", "1s"] });
    expect(panel()).not.toBeNull();
  });

  it("toggles favorites independently and retains focus after the controlled update", () => {
    open(); click(button("2D", "favorite"));
    expect(snapshot()).toEqual({ timeframe: "D", favorites: ["D", "2D"] });
    expect(button("2D", "favorite").getAttribute("aria-label")).toBe("Remove 2D from favorites");
    expect(document.activeElement).toBe(button("2D", "favorite")); expect(select).not.toHaveBeenCalled();
    click(button("2D", "favorite")); expect(snapshot().favorites).toEqual(["D"]); expect(panel()).not.toBeNull();
  });

  it("moves with arrows/Home/End without selecting, and skips disabled interval controls", () => {
    open(); const leak = vi.fn(); window.addEventListener("keydown", leak);
    key(button("D"), "ArrowDown"); expect(document.activeElement).toBe(button("2D"));
    key(button("2D"), "End"); expect(document.activeElement).toBe(button("W"));
    key(button("W"), "Home"); expect(document.activeElement).toBe(button("D"));
    key(button("D"), "ArrowUp"); expect(document.activeElement).toBe(button("W"));
    expect(select).not.toHaveBeenCalled(); expect(leak).not.toHaveBeenCalled(); window.removeEventListener("keydown", leak);
  });

  it("leaves handled, composing and modified keys with their owner", () => {
    open(); key(button("D"), "ArrowDown", { prevented: true }); expect(document.activeElement).toBe(button("D"));
    key(button("D"), "ArrowDown", { composing: true }); expect(document.activeElement).toBe(button("D"));
    key(button("D"), "ArrowDown", { ctrl: true }); expect(document.activeElement).toBe(button("D"));
    key(button("D"), "Escape", { composing: true }); expect(panel()).not.toBeNull();
  });

  it("selects through the existing callback and returns to the launcher", () => {
    open(); click(button("W")); expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith("W");
    expect(snapshot().timeframe).toBe("W"); expect(panel()).toBeNull(); expect(document.activeElement).toBe(launcher());
    open(); expect(document.activeElement).toBe(button("W")); key(button("W"), "Escape");
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(launcher()); expect(select).toHaveBeenCalledTimes(1);
  });

  it("preserves outside focus and lets the trigger toggle close without reopening", () => {
    open(); act(() => launcher().focus()); expect(panel()).not.toBeNull(); act(() => launcher().click()); expect(panel()).toBeNull();
    open(); const outside = host.querySelector<HTMLButtonElement>("#outside")!; act(() => outside.focus());
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(outside);
  });
});

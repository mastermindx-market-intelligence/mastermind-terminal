// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RollerStrip from "@/components/mobile/RollerStrip";

vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => key }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, row: number, ink: number, now: number;
const observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
const pick = vi.fn();
const symbols = ["NVDA", "AAPL"];
const timeframes = ["1h", "D", "2D", "W", "2W"];

beforeEach(() => {
  vi.stubGlobal("React", React);
  row = 23; ink = 50; now = 0; observers.length = 0; pick.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return { x: 0, y: 0, left: 0, top: 0, right: ink, bottom: row, width: ink, height: row, toJSON: () => ({}) };
  });
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    constructor(readonly notify: () => void) { observers.push(this); }
    observe() {}
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(items = symbols) {
  act(() => root.render(<RollerStrip symbols={items} symbol="NVDA" onSymbol={pick} onTapSymbol={vi.fn()}
    timeframes={timeframes} timeframe="W" onTimeframe={pick} onDraw={vi.fn()} drawActive={false}
    onMore={vi.fn()} moreBadge={false} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} />));
}
const wheel = (kind = "symbol") => host.querySelector(`[data-testid="roller-${kind}"]`) as HTMLElement;
function resize() { act(() => observers.forEach(observer => observer.notify())); }
function pointer(type: string, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientY: y });
  Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } });
  act(() => wheel("interval").dispatchEvent(event));
}

it("keeps the normal chamber floor and grows/shrinks with intrinsic text", () => {
  mount(); expect(wheel().style.width).toBe("83.4px");
  row = 46; ink = 100; resize(); expect(wheel().style.width).toBe("106px");
  expect(wheel("interval").firstElementChild?.getAttribute("style")).toContain("translateY(-138px)");
  row = 23; ink = 50; resize(); expect(wheel().style.width).toBe("83.4px");
  expect(wheel("interval").firstElementChild?.getAttribute("style")).toContain("translateY(-69px)");
});
it("commits exactly one enlarged detent during drag and settles on it", () => {
  mount(); row = 46; resize(); pointer("pointerdown", 100);
  now = 100; pointer("pointermove", 146);
  expect(pick.mock.calls).toEqual([["2D"]]);
  now = 200; pointer("pointermove", 146); pointer("pointerup", 146);
  expect(pick.mock.calls.every(([value]) => value === "2D")).toBe(true);
});
it("projects a flick using the measured pitch", () => {
  mount(); row = 46; resize(); pointer("pointerdown", 100);
  now = 90; pointer("pointermove", 146); pointer("pointerup", 146);
  expect(pick.mock.calls).toEqual([["2D"], ["D"]]);
});
it("keyboard selection remains one item at enlarged text size", () => {
  mount(); row = 46; resize();
  act(() => wheel("interval").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(pick.mock.calls).toEqual([["2W"]]);
});
it("observes symbols arriving after an empty list and disconnects on replacement", () => {
  mount([]); expect(observers).toHaveLength(1);
  mount(); expect(observers).toHaveLength(2);
  const original = observers[1]; mount(["NVDA", "MSFT"]);
  expect(original.disconnect).toHaveBeenCalledOnce();
});

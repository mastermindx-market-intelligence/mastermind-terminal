// @vitest-environment jsdom
/**
 * E20 chart command palette — the dialog's own behaviour: a stale highlight never runs on the
 * first confirmation, IME composition never confirms, disabled rows explain themselves, keys
 * typed in the palette never reach the page's own hotkeys, and focus stays inside the open palette.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CommandPalette from "@/components/commandPalette/CommandPalette";
import { paletteContextToken, resolvePaletteRun, type PaletteContext } from "@/lib/commandPalette/catalog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ctx(over: Partial<PaletteContext> = {}): PaletteContext {
  return {
    paneIndex: 0,
    panes: ["NVDA", "AAPL"],
    symbol: "NVDA",
    timeframe: "D",
    researchPage: null,
    tableView: false,
    watchlist: ["NVDA", "AAPL", "MSFT"],
    timeframes: [{ tf: "D", available: true }, { tf: "W", available: true }],
    templates: [],
    indicatorCount: 0,
    drawing: { canUndo: false, canRedo: false },
    replay: { on: false, blocked: "multi-chart" },
    phone: false,
    researchOnAnalysisPage: false,
    review: null,
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
let live: PaletteContext;
let ran: string[];
let closed: number;
let runLang: "en" | "zh" = "en";

const onRun = (id: string, seen: string) => {
  const decision = resolvePaletteRun(id, seen, live, runLang);
  if (decision.ok) ran.push(`${id}@${decision.action.target}`);
  return decision;
};

function render(lang: "en" | "zh" = "en") {
  runLang = lang;
  act(() => {
    root.render(<CommandPalette lang={lang} context={live} phone={false} onRun={onRun} onClose={() => { closed += 1; }} />);
  });
}

const input = () => document.querySelector<HTMLInputElement>("input[role=combobox]")!;
const notice = () => document.querySelector("[data-palette-notice]")!.textContent;
const typeQuery = (value: string) => {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (k: string, init: KeyboardEventInit = {}) => {
  act(() => { input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  live = ctx();
  ran = [];
  closed = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("CommandPalette", () => {
  it("opens as a labelled modal dialog naming its target, with the search field focused", () => {
    render();
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Actions");
    expect(document.querySelector("[data-palette-target]")?.textContent).toBe("Acting on Chart 1 of 2 · NVDA · D");
    expect(document.activeElement).toBe(input());
  });

  it("runs the highlighted match on Enter and closes", () => {
    render();
    typeQuery("next symbol");
    key("Enter");
    expect(ran).toEqual(["watchlist:next@Moves to Chart 2 · AAPL, already open"]);
    expect(closed).toBe(1);
  });

  it("AC-E20-02: a context change while choosing runs nothing on the first Enter, then runs on the named chart", () => {
    render();
    typeQuery("next symbol");
    // The person clicks the other chart while the palette is open.
    live = ctx({ paneIndex: 1, symbol: "AAPL" });
    render();
    expect(document.querySelector("[data-command-palette]")?.getAttribute("data-stale")).toBe("1");
    expect(document.querySelector("[role=option][aria-selected=true]")).toBeNull();
    key("Enter");
    expect(ran).toEqual([]);
    expect(closed).toBe(0);
    expect(notice()).toContain("The chart changed to Chart 2 of 2 · AAPL · D");
    expect(document.querySelector("[data-palette-target]")?.textContent).toBe("Acting on Chart 2 of 2 · AAPL · D");
    key("Enter");
    expect(ran).toEqual(["watchlist:next@Chart 2: AAPL → MSFT"]);
    expect(closed).toBe(1);
  });

  it("AC-E20-02: a click on a row after a change is refused the same way", () => {
    render();
    live = ctx({ timeframe: "W" });
    render();
    const row = document.querySelector<HTMLElement>("[data-action-id='research:statements']")!;
    act(() => row.click());
    expect(ran).toEqual([]);
    expect(notice()).toContain("Chart 1 of 2 · NVDA · W");
    act(() => row.click());
    expect(ran).toEqual(["research:statements@For NVDA"]);
  });

  it("AC-E20-03: Enter during IME composition does not run anything", () => {
    render("zh");
    typeQuery("报表");
    key("Enter", { isComposing: true });
    key("Enter", { keyCode: 229 } as KeyboardEventInit);
    expect(ran).toEqual([]);
    expect(closed).toBe(0);
    key("Enter");
    expect(ran).toEqual(["research:statements@针对 NVDA"]);
  });

  it("AC-E20-03: keys typed in the palette never reach the page's hotkeys", () => {
    const pageHotkey = vi.fn();
    window.addEventListener("keydown", pageHotkey);
    render();
    key("a");
    key(">");
    key("ArrowDown");
    window.removeEventListener("keydown", pageHotkey);
    expect(pageHotkey).not.toHaveBeenCalled();
  });

  it("AC-E20-03: a press on the palette's own text keeps focus in the search field", () => {
    render();
    const press = (el: Element) => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      act(() => { el.dispatchEvent(event); });
      return event.defaultPrevented;
    };
    // The target line, a group label, the title, the key hint and the padding are not controls:
    // pressing them must not move focus off the field to the page underneath.
    expect(press(document.querySelector("[data-palette-target]")!)).toBe(true);
    expect(press(document.querySelector("[role=group] > [role=presentation]")!)).toBe(true);
    expect(press(document.querySelector("[role=dialog] h2")!)).toBe(true);
    expect(press(document.querySelector("[role=dialog] p[aria-hidden=true]")!)).toBe(true);
    expect(press(document.querySelector("[data-command-palette]")!)).toBe(true);
    // Its real controls still take focus.
    expect(press(input())).toBe(false);
    expect(press(document.querySelector("button[aria-label=Close]")!)).toBe(false);
  });

  it("AC-E20-03: focus that leaves the open palette comes straight back", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render();
    expect(document.activeElement).toBe(input());
    act(() => outside.focus());
    expect(document.activeElement).toBe(input());
    act(() => input().blur());
    expect(document.activeElement).toBe(input());
  });

  it("AC-E20-03: a run that opens its own dialog keeps the focus that dialog takes", () => {
    const other = document.createElement("input");
    document.body.appendChild(other);
    render();
    typeQuery("add or edit");
    key("Enter");
    expect(ran).toEqual(["studies:open@All charts"]);
    expect(closed).toBe(1);
    // The study dialog focuses its own field; the closing palette must not pull focus back.
    act(() => other.focus());
    expect(document.activeElement).toBe(other);
  });

  it("AC-E20-03 (phone): the sheet keeps focus in the palette and a typed letter searches it", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    const pageHotkey = vi.fn();
    window.addEventListener("keydown", pageHotkey);
    act(() => {
      root.render(<CommandPalette lang="en" context={live} phone onRun={onRun} onClose={() => { closed += 1; }} />);
    });
    const body = document.querySelector<HTMLElement>("[data-command-palette]")!;
    // Opening does not summon the keyboard: focus parks on the palette, not on its field.
    expect(document.activeElement).toBe(body);
    // A press on the sheet's own title or grabber focuses the sheet; focus comes back.
    act(() => document.querySelector<HTMLElement>("[role=dialog]")!.focus());
    expect(document.activeElement).toBe(body);
    act(() => { body.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true, cancelable: true })); });
    window.removeEventListener("keydown", pageHotkey);
    expect(pageHotkey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
    expect(ran).toEqual([]);
  });

  it("AC-E20-04: a disabled row explains itself and running it reports why instead of succeeding", () => {
    render();
    const row = document.querySelector<HTMLElement>("[data-action-id='chart:replay']")!;
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.textContent).toContain("Bar Replay works on one chart");
    act(() => row.click());
    expect(ran).toEqual([]);
    expect(closed).toBe(0);
    expect(notice()).toMatch(/^Not available: Bar Replay works on one chart/);
  });

  it("skips no rows: arrow keys reach disabled rows so their reason can be read", () => {
    render();
    typeQuery("remove all");
    expect(document.querySelector("[role=option][aria-selected=true]")?.getAttribute("data-action-id")).toBe("studies:remove-all");
    key("Enter");
    expect(ran).toEqual([]);
    expect(notice()).toBe("Not available: No studies on the charts");
  });

  it("Escape closes and returns focus to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    render();
    expect(document.activeElement).toBe(input());
    key("Escape");
    expect(closed).toBe(1);
    expect(document.activeElement).toBe(opener);
  });

  it("shows a clear empty state in Chinese", () => {
    render("zh");
    typeQuery("zzqq");
    expect(document.querySelector("[role=listbox]")?.textContent).toBe("没有与“zzqq”匹配的操作");
  });

  it("the token it compares is the shell's own context token", () => {
    expect(paletteContextToken(ctx())).not.toBe(paletteContextToken(ctx({ paneIndex: 1, symbol: "AAPL" })));
  });
});

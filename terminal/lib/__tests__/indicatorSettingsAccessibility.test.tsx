// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import IndicatorSettings from "@/components/IndicatorSettings";
import IndicatorSource from "@/components/IndicatorSource";
import { IND_DEFS, defaultVis, withDefaults } from "@/lib/indicators";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function press(element: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => { element.dispatchEvent(event); });
  return event;
}

// IndicatorSettings moves focus into its dialog on the next animation frame.
async function nextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

// Sequential focus navigation order for a subtree without positive tabindex: every element whose
// tabIndex is >= 0 and that is not disabled, in document order. A control outside this list cannot
// be reached with Tab, whatever its key handlers do.
function tabOrder(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>("*")]
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
}

// Walk Tab forward from the focused element until `target` holds focus — the keyboard journey,
// not a direct .focus() on a control a keyboard user could never land on.
function tabTo(scope: Element, target: Element) {
  const order = tabOrder(scope);
  expect(order).toContain(target);
  let i = order.indexOf(document.activeElement as HTMLElement);
  while (document.activeElement !== target) {
    i += 1;
    expect(i).toBeLessThan(order.length);
    act(() => order[i].focus());
    expect(document.activeElement).toBe(order[i]);
  }
}

// A native <button> turns Enter/Space into a click. jsdom does not synthesize that activation, so
// native buttons on the journey (the owner's opener, tabs, Defaults) are clicked as the browser would.
function activateNativeButton(button: HTMLButtonElement) {
  expect(button.tagName).toBe("BUTTON");
  act(() => button.click());
}

type Spies = {
  onChange: ReturnType<typeof vi.fn>;
  onPineChange: ReturnType<typeof vi.fn>;
  onReset: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
};
const spies = (): Spies => ({ onChange: vi.fn(), onPineChange: vi.fn(), onReset: vi.fn(), onClose: vi.fn() });

// Stands in for TerminalShell: owns open state and the params, merges each patch over the
// registry defaults the way setIndParam does, and unmounts the dialog on close.
function SettingsOwner({ indKey, initial = {}, pine, spy }: {
  indKey: string;
  initial?: Record<string, unknown>;
  pine?: { name: string; params: Record<string, unknown> };
  spy: Spies;
}) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<Record<string, unknown>>(initial);
  const [pineParams, setPineParams] = useState<Record<string, unknown>>(pine?.params ?? {});
  return (
    <>
      <button type="button" className="opener" onClick={() => setOpen(true)}>Settings</button>
      {open && (
        <IndicatorSettings
          indKey={indKey}
          params={params}
          onChange={(patch) => { spy.onChange(patch); setParams((p) => ({ ...withDefaults(indKey, p), ...patch })); }}
          pine={pine ? { name: pine.name, params: pineParams } : null}
          onPineChange={(patch) => { spy.onPineChange(patch); setPineParams((p) => ({ ...p, ...patch })); }}
          onReset={() => { spy.onReset(); setParams(withDefaults(indKey, {})); }}
          onClose={() => { spy.onClose(); setOpen(false); }}
        />
      )}
    </>
  );
}

async function openSettings(view: HTMLElement): Promise<HTMLElement> {
  const opener = view.querySelector<HTMLButtonElement>(".opener")!;
  act(() => opener.focus());
  activateNativeButton(opener);
  await nextFrame();
  const dialog = view.querySelector<HTMLElement>(".ind-set");
  expect(dialog).not.toBeNull();
  expect(document.activeElement).toBe(dialog);
  return dialog!;
}

function rowControl<T extends HTMLElement = HTMLElement>(dialog: HTMLElement, label: string, selector: string): T {
  const row = [...dialog.querySelectorAll<HTMLElement>(".is-row")]
    .find((candidate) => candidate.querySelector(".is-label")?.textContent === label);
  expect(row).toBeDefined();
  const control = row!.querySelector<T>(selector);
  expect(control).not.toBeNull();
  return control!;
}

function tabButton(dialog: HTMLElement, label: string): HTMLButtonElement {
  const button = [...dialog.querySelectorAll<HTMLButtonElement>(".is-tab")].find((b) => b.textContent === label);
  expect(button).toBeDefined();
  return button!;
}

describe("Indicator Settings keyboard journey", () => {
  it("reaches a classic boolean by Tab and toggles it exactly once per Enter or Space", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" initial={{ length: 21 }} spy={spy} />);
    const dialog = await openSettings(view);

    const toggle = rowControl(dialog, "Show OB/OS lines", '.is-switch[role="switch"]');
    tabTo(dialog, toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    expect(press(toggle, "Enter").defaultPrevented).toBe(true);
    expect(spy.onChange).toHaveBeenCalledTimes(1);
    expect(spy.onChange).toHaveBeenLastCalledWith({ showLevels: false });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    expect(press(toggle, " ").defaultPrevented).toBe(true);
    expect(spy.onChange).toHaveBeenCalledTimes(2);
    expect(spy.onChange).toHaveBeenLastCalledWith({ showLevels: true });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    press(toggle, "a");
    expect(spy.onChange).toHaveBeenCalledTimes(2);
    // The patch carried only the toggled key; the saved length survived both toggles.
    expect(rowControl<HTMLInputElement>(dialog, "Length", 'input[type="number"]').value).toBe("21");
  });

  it("toggles a timeframe Visibility checkbox from the keyboard without disturbing the other timeframes", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" spy={spy} />);
    const dialog = await openSettings(view);

    const visibility = tabButton(dialog, "Visibility");
    tabTo(dialog, visibility);
    activateNativeButton(visibility);

    const days = dialog.querySelector<HTMLElement>('.vis-row .is-cbx[role="checkbox"]');
    expect(days).not.toBeNull();
    tabTo(dialog, days!);
    expect(days!.getAttribute("aria-checked")).toBe("true");

    expect(press(days!, " ").defaultPrevented).toBe(true);
    expect(spy.onChange).toHaveBeenCalledTimes(1);
    expect(spy.onChange).toHaveBeenLastCalledWith({ _vis: { ...defaultVis(), days: { on: false, min: 1, max: 366 } } });
    expect(days!.getAttribute("aria-checked")).toBe("false");

    press(days!, "Enter");
    expect(spy.onChange).toHaveBeenCalledTimes(2);
    expect(spy.onChange).toHaveBeenLastCalledWith({ _vis: defaultVis() });
    expect(days!.getAttribute("aria-checked")).toBe("true");
  });

  it("toggles a Pine boolean input from the keyboard through onPineChange only", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="pine" pine={{ name: "Fixture", params: { enabled: true, length: 9 } }} spy={spy} />);
    const dialog = await openSettings(view);

    const toggle = rowControl(dialog, "enabled", '.is-switch[role="switch"]');
    tabTo(dialog, toggle);

    expect(press(toggle, "Enter").defaultPrevented).toBe(true);
    expect(spy.onPineChange).toHaveBeenCalledTimes(1);
    expect(spy.onPineChange).toHaveBeenLastCalledWith({ enabled: false });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    press(toggle, " ");
    expect(spy.onPineChange).toHaveBeenCalledTimes(2);
    expect(spy.onPineChange).toHaveBeenLastCalledWith({ enabled: true });
    expect(spy.onChange).not.toHaveBeenCalled();
    expect(rowControl<HTMLInputElement>(dialog, "length", 'input[type="number"]').value).toBe("9");
  });

  it("closes from the ✕ with Enter or Space and hands focus back to the opener", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" spy={spy} />);
    const opener = view.querySelector<HTMLButtonElement>(".opener")!;

    for (const [n, key] of [[1, "Enter"], [2, " "]] as const) {
      const dialog = await openSettings(view);
      const close = dialog.querySelector<HTMLElement>(".is-head .x");
      expect(close).not.toBeNull();
      expect(close!.getAttribute("role")).toBe("button");
      tabTo(dialog, close!);

      expect(press(close!, key).defaultPrevented).toBe(true);
      expect(spy.onClose).toHaveBeenCalledTimes(n);
      expect(view.querySelector(".ind-set")).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
    expect(spy.onChange).not.toHaveBeenCalled();
  });

  it("closes with Escape and returns focus to the opener", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" spy={spy} />);
    const dialog = await openSettings(view);

    press(dialog, "Escape");
    expect(spy.onClose).toHaveBeenCalledTimes(1);
    expect(view.querySelector(".ind-set")).toBeNull();
    expect(document.activeElement).toBe(view.querySelector(".opener"));
  });

  // The live opener is the legend ⚙, which only :hover reveals. While the scrim covers its row the ⚙ is
  // display:none, so the browser refuses focus at close time and re-reveals it a frame later. jsdom has
  // no layout, so a disabled opener stands in for "not focusable yet".
  it("returns focus to an opener that only becomes focusable a frame after close", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" spy={spy} />);
    const opener = view.querySelector<HTMLButtonElement>(".opener")!;
    const dialog = await openSettings(view);

    opener.disabled = true;
    press(dialog, "Escape");
    expect(spy.onClose).toHaveBeenCalledTimes(1);
    expect(view.querySelector(".ind-set")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    opener.disabled = false;
    await nextFrame();
    expect(document.activeElement).toBe(opener);
  });

  it("does not pull focus back from a control the user reached before the opener reappeared", async () => {
    const spy = spies();
    const view = mount(<><SettingsOwner indKey="rsi" spy={spy} /><button type="button" className="elsewhere">Elsewhere</button></>);
    const opener = view.querySelector<HTMLButtonElement>(".opener")!;
    const elsewhere = view.querySelector<HTMLButtonElement>(".elsewhere")!;
    const dialog = await openSettings(view);

    opener.disabled = true;
    press(dialog, "Escape");
    act(() => elsewhere.focus());
    opener.disabled = false;
    await nextFrame();
    await nextFrame();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("activates Reset settings from the Defaults menu by keyboard", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" initial={{ showLevels: false }} spy={spy} />);
    const dialog = await openSettings(view);
    const toggle = rowControl(dialog, "Show OB/OS lines", '.is-switch[role="switch"]');
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    const defaults = dialog.querySelector<HTMLButtonElement>(".is-def-btn")!;
    tabTo(dialog, defaults);
    activateNativeButton(defaults);

    const reset = dialog.querySelector<HTMLElement>(".is-def-row");
    expect(reset).not.toBeNull();
    expect(reset!.getAttribute("role")).toBe("button");
    tabTo(dialog, reset!);

    expect(press(reset!, "Enter").defaultPrevented).toBe(true);
    expect(spy.onReset).toHaveBeenCalledTimes(1);
    expect(dialog.querySelector(".is-def-menu")).toBeNull();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(spy.onChange).not.toHaveBeenCalled();
    expect(spy.onClose).not.toHaveBeenCalled();
  });

  it("keeps pointer activation at one callback per click", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" spy={spy} />);
    const dialog = await openSettings(view);

    act(() => rowControl(dialog, "Show OB/OS lines", ".is-switch").click());
    expect(spy.onChange).toHaveBeenCalledTimes(1);
    expect(spy.onChange).toHaveBeenLastCalledWith({ showLevels: false });

    act(() => dialog.querySelector<HTMLElement>(".is-head .x")!.click());
    expect(spy.onClose).toHaveBeenCalledTimes(1);
    expect(view.querySelector(".ind-set")).toBeNull();
  });

  it("keeps valid color values intact on the Style tab", async () => {
    const spy = spies();
    const view = mount(<SettingsOwner indKey="rsi" spy={spy} />);
    const dialog = await openSettings(view);
    activateNativeButton(tabButton(dialog, "Style"));

    const picker = rowControl<HTMLInputElement>(dialog, "RSI color", 'input[type="color"]');
    expect(picker.value).toBe(String(withDefaults("rsi").col).toLowerCase());

    const swatch = [...dialog.querySelectorAll<HTMLButtonElement>(".is-sw")].find((b) => b.title === "#26c281")!;
    act(() => swatch.click());
    expect(spy.onChange).toHaveBeenCalledTimes(1);
    expect(spy.onChange).toHaveBeenLastCalledWith({ col: "#26c281" });
    expect(picker.value).toBe("#26c281");
  });
});

function SourceOwner({ indKey, onClose }: { indKey: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="opener" onClick={() => setOpen(true)}>Source</button>
      {open && <IndicatorSource indKey={indKey} onClose={() => { onClose(); setOpen(false); }} />}
    </>
  );
}

function openSource(view: HTMLElement): HTMLElement {
  const opener = view.querySelector<HTMLButtonElement>(".opener")!;
  act(() => opener.focus());
  activateNativeButton(opener);
  const dialog = view.querySelector<HTMLElement>(".ind-src");
  expect(dialog).not.toBeNull();
  return dialog!;
}

describe("Indicator Source keyboard close", () => {
  it("is a labelled modal that takes focus, closes from the ✕ with Space or Enter, and returns focus", () => {
    const onClose = vi.fn();
    const view = mount(<SourceOwner indKey="rsi" onClose={onClose} />);
    const opener = view.querySelector<HTMLButtonElement>(".opener")!;

    for (const [n, key] of [[1, " "], [2, "Enter"]] as const) {
      const dialog = openSource(view);
      expect(dialog.getAttribute("role")).toBe("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("rsi.pine");
      expect(document.activeElement).toBe(dialog);
      expect(dialog.querySelector(".src-code")?.textContent).toBe(IND_DEFS.rsi.source);

      const close = dialog.querySelector<HTMLElement>(".is-head .x");
      expect(close).not.toBeNull();
      expect(close!.getAttribute("role")).toBe("button");
      tabTo(dialog, close!);

      expect(press(close!, key).defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(n);
      expect(view.querySelector(".ind-src")).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
  });

  it("still closes once from Escape and from the footer Close button", () => {
    const onClose = vi.fn();
    const view = mount(<SourceOwner indKey="rsi" onClose={onClose} />);
    const opener = view.querySelector<HTMLButtonElement>(".opener")!;

    press(openSource(view), "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(view.querySelector(".ind-src")).toBeNull();
    expect(document.activeElement).toBe(opener);

    const footerClose = openSource(view).querySelector<HTMLButtonElement>(".is-foot button")!;
    activateNativeButton(footerClose);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(view.querySelector(".ind-src")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to an opener that only becomes focusable a frame after close", async () => {
    const onClose = vi.fn();
    const view = mount(<SourceOwner indKey="rsi" onClose={onClose} />);
    const opener = view.querySelector<HTMLButtonElement>(".opener")!;
    const dialog = openSource(view);

    opener.disabled = true;
    press(dialog, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(view.querySelector(".ind-src")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    opener.disabled = false;
    await nextFrame();
    expect(document.activeElement).toBe(opener);
  });
});

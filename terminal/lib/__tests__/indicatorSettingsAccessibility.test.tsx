// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import IndicatorSettings from "@/components/IndicatorSettings";
import IndicatorSource from "@/components/IndicatorSource";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: React.ComponentProps<typeof IndicatorSettings>): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<IndicatorSettings {...props} />));
  return host;
}

function mountSource(props: React.ComponentProps<typeof IndicatorSource>): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<IndicatorSource {...props} />));
  return host;
}

function press(element: Element, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("Indicator Settings keyboard controls", () => {
  it("lets a keyboard user toggle a classic boolean input and close the dialog", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const view = mount({
      indKey: "rsi",
      params: {},
      onChange,
      onClose,
    });

    const toggle = view.querySelector<HTMLElement>('.is-row .is-switch[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.tabIndex).toBe(0);
    toggle!.focus();
    expect(document.activeElement).toBe(toggle);

    press(toggle!, "Enter");
    expect(onChange).toHaveBeenCalledWith({ showLevels: false });

    const close = view.querySelector<HTMLElement>(".is-head .x");
    expect(close).not.toBeNull();
    expect(close!.getAttribute("role")).toBe("button");
    expect(close!.tabIndex).toBe(0);
    press(close!, "Enter");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("makes visibility checkboxes keyboard-operable", () => {
    const onChange = vi.fn();
    const view = mount({
      indKey: "rsi",
      params: {},
      onChange,
      onClose: vi.fn(),
    });

    const visibilityTab = [...view.querySelectorAll<HTMLButtonElement>(".is-tab")]
      .find((button) => button.textContent === "Visibility");
    expect(visibilityTab).toBeDefined();
    act(() => visibilityTab!.click());

    const checkbox = view.querySelector<HTMLElement>('.vis-row .is-cbx[role="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox!.tabIndex).toBe(0);
    checkbox!.focus();
    expect(document.activeElement).toBe(checkbox);

    press(checkbox!, " ");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveProperty("_vis");
  });

  it("lets Pine boolean inputs toggle from the keyboard too", () => {
    const onPineChange = vi.fn();
    const view = mount({
      indKey: "pine",
      params: {},
      onChange: vi.fn(),
      onClose: vi.fn(),
      pine: { name: "Fixture", params: { enabled: true } },
      onPineChange,
    });

    const toggle = view.querySelector<HTMLElement>('.is-row .is-switch[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.tabIndex).toBe(0);

    press(toggle!, " ");
    expect(onPineChange).toHaveBeenCalledWith({ enabled: false });
  });

  it("lets a keyboard user activate Reset settings from the Defaults menu", () => {
    const onReset = vi.fn();
    const view = mount({
      indKey: "rsi",
      params: {},
      onChange: vi.fn(),
      onClose: vi.fn(),
      onReset,
    });

    const defaults = view.querySelector<HTMLButtonElement>(".is-def-btn");
    expect(defaults).not.toBeNull();
    act(() => defaults!.click());

    const reset = view.querySelector<HTMLElement>(".is-def-row");
    expect(reset).not.toBeNull();
    expect(reset!.getAttribute("role")).toBe("button");
    expect(reset!.tabIndex).toBe(0);

    press(reset!, "Enter");
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("makes the built-in source dialog's header close control keyboard-operable", () => {
    const onClose = vi.fn();
    const view = mountSource({ indKey: "rsi", onClose });

    const close = view.querySelector<HTMLElement>(".ind-src .is-head .x");
    expect(close).not.toBeNull();
    expect(close!.getAttribute("role")).toBe("button");
    expect(close!.tabIndex).toBe(0);

    press(close!, " ");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the true RGB hue in color inputs even when an indicator default is translucent rgba", () => {
    const view = mount({
      indKey: "vol",
      params: {},
      onChange: vi.fn(),
      onClose: vi.fn(),
    });

    const styleTab = [...view.querySelectorAll<HTMLButtonElement>(".is-tab")]
      .find((button) => button.textContent === "Style");
    expect(styleTab).toBeDefined();
    act(() => styleTab!.click());

    const colors = [...view.querySelectorAll<HTMLInputElement>('input[type="color"]')]
      .map((input) => input.value.toLowerCase());
    expect(colors).toEqual(["#26c281", "#f0566b"]);
  });
});

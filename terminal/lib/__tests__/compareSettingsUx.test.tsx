// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompareSettings from "@/components/CompareSettings";
import { type CmpCfg } from "@/lib/compare";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seed: CmpCfg = {
  color: "rgba(38, 194, 129, 0.4)", lineWidth: 2, lineStyle: 0,
  mode: "percent", anchor: "2024-01-02",
};

describe("comparison settings preserve color and interaction ownership", () => {
  let root: Root, host: HTMLDivElement;
  let legendFixture: HTMLDivElement | undefined;
  let methods: ReadonlyArray<readonly ["showModal" | "close", PropertyDescriptor | undefined]>;
  const change = vi.fn(), close = vi.fn();

  function Harness({ initial, sym = "AAPL" }: { initial: CmpCfg; sym?: string }) {
    const [cfg, setCfg] = useState(initial);
    return <>
      <CompareSettings sym={sym} cfg={cfg} onClose={close} onChange={(patch) => {
        change(patch); setCfg((old) => ({ ...old, ...patch }));
      }} />
      <output>{JSON.stringify(cfg)}</output>
    </>;
  }
  async function render(initial = seed, sym = "AAPL") {
    await act(async () => root.render(<Harness initial={initial} sym={sym} />));
  }
  const input = (type: string) => host.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;
  const button = (name: string) => {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((element) => (element.getAttribute("aria-label") || element.textContent) === name);
    expect(found, name).toBeDefined();
    return found!;
  };
  async function fill(type: string, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(type), value);
      input(type).dispatchEvent(new Event("input", { bubbles: true }));
      input(type).dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function commit() {
    await act(async () => input("number").dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    methods = (["showModal", "close"] as const).map((key) =>
      [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)] as const);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true, value() { this.setAttribute("open", ""); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true, value() { this.removeAttribute("open"); },
    });
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (this.hidden ? [] : [new DOMRect(0, 0, 44, 44)]) as unknown as DOMRectList;
    });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    legendFixture?.remove(); legendFixture = undefined;
    for (const [key, descriptor] of methods) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
    }
    vi.restoreAllMocks();
  });

  it.each([
    [seed.color, "#26c281"], ["#abc", "#aabbcc"], ["#26c28166", "#26c281"],
  ])("displays actual RGB channels for %s", async (color, expected) => {
    await render({ ...seed, color }); expect(input("color").value).toBe(expected);
  });
  it("keeps existing opacity when a new color is chosen", async () => {
    await render(); await fill("color", "#4d82ff");
    expect(change).toHaveBeenLastCalledWith({ color: "rgba(77, 130, 255, 0.4)" });
  });
  it("allows clearing thickness without mutating the chart, then restores an empty commit", async () => {
    await render(); await fill("number", "");
    expect(input("number").value).toBe(""); expect(change).not.toHaveBeenCalled();
    await commit();
    expect(input("number").value).toBe("2"); expect(change).not.toHaveBeenCalled();
  });
  it("withholds out-of-range widths during typing and bounds the committed value", async () => {
    await render(); await fill("number", "9"); expect(change).not.toHaveBeenCalled();
    expect(input("number").value).toBe("9");
    await commit();
    expect(change).toHaveBeenLastCalledWith({ lineWidth: 4 });
    expect(input("number").value).toBe("4");
    expect(button("Increase thickness").disabled).toBe(true);
  });
  it("previews a valid integer once and preserves unrelated comparison terms", async () => {
    await render(); await fill("number", "3");
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenLastCalledWith({ lineWidth: 3 });
    expect(input("number").value).toBe("3");
    await commit();
    expect(change).toHaveBeenCalledTimes(1);
    expect(JSON.parse(host.querySelector("output")!.textContent!).anchor).toBe(seed.anchor);
  });
  it("withholds fractional widths until the existing bounded integer commit", async () => {
    await render(); await fill("number", "2.5");
    expect(input("number").value).toBe("2.5"); expect(change).not.toHaveBeenCalled();
    await commit();
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenLastCalledWith({ lineWidth: 3 });
    expect(input("number").value).toBe("3");
  });
  it("withholds negative drafts and applies the minimum only on commit", async () => {
    await render(); await fill("number", "-2"); expect(change).not.toHaveBeenCalled();
    await commit();
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenLastCalledWith({ lineWidth: 1 });
    expect(button("Decrease thickness").disabled).toBe(true);
  });
  it("does not carry an uncommitted draft into a different comparison", async () => {
    await render(); await fill("number", "9"); expect(change).not.toHaveBeenCalled();
    await render(seed, "MSFT");
    expect(input("number").value).toBe("2"); expect(change).not.toHaveBeenCalled();
  });
  it("owns a named native dialog, labels inputs and supplies a real Close button", async () => {
    await render(); const dialog = host.querySelector("dialog");
    expect(dialog?.open).toBe(true);
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.textContent).toContain("AAPL");
    expect(input("number").getAttribute("aria-label")).toBe("Thickness");
    await act(async () => button("Close").click());
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("exposes selected scale and translated line-style controls without changing unrelated settings", async () => {
    await render(); const dashed = button("Dashed");
    await act(async () => dashed.click());
    expect(change).toHaveBeenLastCalledWith({ lineStyle: 2 });
    expect(dashed.getAttribute("aria-pressed")).toBe("true");
    expect(button("Percent").getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(host.querySelector("output")!.textContent!).anchor).toBe(seed.anchor);
  });

  function DismissibleOwner() {
    const [open, setOpen] = useState(true);
    return open ? <CompareSettings sym="AAPL" cfg={seed} onChange={change}
      onClose={() => { close(); setOpen(false); }} /> : null;
  }
  function legend() {
    legendFixture = document.createElement("div");
    legendFixture.innerHTML = `
      <div class="pane"><div class="lg-row is-cmp" role="group" aria-label="AAPL" tabindex="-1"></div></div>
      <div class="pane on">
        <div class="lg-row is-cmp" role="group" aria-label="MSFT" tabindex="-1"></div>
        <div class="lg-row is-cmp" role="group" aria-label="AAPL" tabindex="-1" hidden></div>
        <div class="lg-row is-cmp" role="group" aria-label="AAPL" tabindex="-1" data-return-row>
          <button type="button" aria-label="Settings">Settings</button>
        </div>
      </div>`;
    document.body.append(legendFixture);
    return {
      row: legendFixture.querySelector<HTMLElement>("[data-return-row]")!,
      opener: legendFixture.querySelector<HTMLButtonElement>("[data-return-row] button")!,
    };
  }
  it("returns focus to the matching visible comparison when its touch opener vanished before mount", async () => {
    const oldOverflow = document.body.style.overflow;
    const { row, opener } = legend();
    opener.focus(); expect(document.activeElement).toBe(opener);
    opener.remove(); expect(document.activeElement).toBe(document.body);
    await act(async () => root.render(<DismissibleOwner />));
    const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
    expect(dialog.open).toBe(true); expect(document.activeElement).toBe(dialog);
    await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(document.body.style.overflow).toBe(oldOverflow);
  });
  it("preserves a surviving Settings opener instead of redirecting focus to its comparison row", async () => {
    const { row, opener } = legend();
    opener.focus();
    await act(async () => root.render(<DismissibleOwner />));
    const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
    await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(document.activeElement).toBe(opener);
    expect(document.activeElement).not.toBe(row);
  });
});

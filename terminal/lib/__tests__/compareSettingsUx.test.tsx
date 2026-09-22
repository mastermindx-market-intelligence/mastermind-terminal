// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompareSettings from "@/components/CompareSettings";
import { type CmpCfg } from "@/lib/compare";
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => key }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const seed: CmpCfg = { color: "rgba(38, 194, 129, 0.4)", lineWidth: 2, lineStyle: 0, mode: "percent" };
describe("comparison settings preserve color and interaction ownership", () => {
  let root: Root, host: HTMLDivElement;
  const change = vi.fn(), close = vi.fn();
  function Harness({ initial }: { initial: CmpCfg }) {
    const [cfg, setCfg] = useState(initial);
    return <CompareSettings sym="AAPL" cfg={cfg} onClose={close} onChange={(patch) => { change(patch); setCfg((old) => ({ ...old, ...patch })); }} />;
  }
  async function render(initial = seed) { await act(async () => root.render(<Harness initial={initial} />)); }
  const input = (type: string) => host.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;
  async function fill(type: string, value: string) { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(type), value);
    input(type).dispatchEvent(new Event("input", { bubbles: true }));
    input(type).dispatchEvent(new Event("change", { bubbles: true }));
  }); }
  beforeEach(() => {
    vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  it.each([[seed.color, "#26c281"], ["#abc", "#aabbcc"], ["#26c28166", "#26c281"]])("displays actual RGB channels for %s", async (color, expected) => {
    await render({ ...seed, color }); expect(input("color").value).toBe(expected);
  });
  it("keeps existing opacity when a new color is chosen", async () => {
    await render(); await fill("color", "#4d82ff"); expect(change).toHaveBeenLastCalledWith({ color: "rgba(77, 130, 255, 0.4)" });
  });
  it("allows clearing thickness without mutating the chart, then reverts an empty commit", async () => {
    await render(); await fill("number", ""); expect(input("number").value).toBe(""); expect(change).not.toHaveBeenCalled();
    await act(async () => input("number").dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(input("number").value).toBe("2"); expect(change).not.toHaveBeenCalled();
  });
  it("does not send invalid widths during typing and bounds the committed value", async () => {
    await render(); await fill("number", "9"); expect(change).not.toHaveBeenCalled();
    await act(async () => input("number").dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(change).toHaveBeenLastCalledWith({ lineWidth: 4 });
    console.log("WIDTH_CONTROLS", [...host.querySelectorAll("button")].map(b => [b.getAttribute("aria-label"), b.disabled]));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="cmpThickness +"]')?.disabled).toBe(true);
  });
  it("owns a named native dialog, labels inputs and supplies a real Close button", async () => {
    await render(); const dialog = host.querySelector("dialog"); expect(dialog?.open).toBe(true);
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.textContent).toContain("AAPL");
    expect(input("number").getAttribute("aria-label")).toBe("cmpThickness");
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="smClose"]'); expect(button).not.toBeNull();
    await act(async () => button!.click()); expect(close).toHaveBeenCalledTimes(1);
  });
  it("exposes selected scale and translated line-style controls without changing unrelated settings", async () => {
    await render(); const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "drawingDashDashed");
    expect(button).toBeDefined(); await act(async () => button!.click()); expect(change).toHaveBeenLastCalledWith({ lineStyle: 2 });
    expect(button!.getAttribute("aria-pressed")).toBe("true");
  });
});

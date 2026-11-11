// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IndicatorsModal, { type IndicatorsModalProps } from "@/components/IndicatorsModal";
import { LangProvider } from "@/lib/i18n";
import type { UserScript } from "@/lib/userScripts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const script: UserScript = { id: "custom-study-1", name: "Alpha", source: "", lang: "pine", params: {}, updated_at: "2026-11-09T00:00:00Z" };
let host: HTMLDivElement, root: Root, props: IndicatorsModalProps;
const originalScrollTo = HTMLElement.prototype.scrollTo;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute("data-lang", "en");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.isConnected && !this.closest("[hidden], [inert]") ? [new DOMRect(0, 0, 100, 40)] : []) as unknown as DOMRectList;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { open: true, active: new Set(), onClose: vi.fn(), onToggle: vi.fn(), accessState: "verified",
    scripts: [script], onRenameScript: vi.fn() };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); HTMLElement.prototype.scrollTo = originalScrollTo;
});
function tree() { return <LangProvider><IndicatorsModal {...props} /></LangProvider>; }
async function render(update: Partial<IndicatorsModalProps> = {}) {
  props = { ...props, ...update }; await act(async () => root.render(tree()));
}
const search = () => host.querySelector<HTMLInputElement>(".im-search-input")!;
const editor = () => host.querySelector<HTMLInputElement>(".li-rename")!;
const rename = () => host.querySelector<HTMLButtonElement>('.li-acts button[title="Rename"]')!;
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function begin() {
  await fill(search(), "Alpha");
  await act(async () => rename().click());
  expect(document.activeElement).toBe(editor());
  await fill(editor(), "  New name  ");
}
async function key(name: string, signal: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...signal });
  await act(async () => editor().dispatchEvent(event));
  return event;
}

describe("Study Library script rename continuity", () => {
  it("saves Enter once and returns focus to the matching Rename action", async () => {
    await render(); await begin(); const old = editor();
    await key("Enter");
    expect(editor()).toBeNull(); expect(document.activeElement).toBe(rename());
    expect(props.onRenameScript).toHaveBeenCalledTimes(1); expect(props.onRenameScript).toHaveBeenCalledWith("custom-study-1", "New name");
    await act(async () => old.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(props.onRenameScript).toHaveBeenCalledTimes(1); expect(props.onClose).not.toHaveBeenCalled();
  });
  it("cancels Escape locally without a blur save or closing the dialog", async () => {
    await render(); await begin(); await key("Escape");
    expect(editor()).toBeNull(); expect(document.activeElement).toBe(rename());
    expect(props.onRenameScript).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
    expect(search().value).toBe("Alpha");
  });
  it.each([
    ["Enter", { isComposing: true }], ["Escape", { isComposing: true }],
    ["Enter", { keyCode: 229 }], ["Escape", { keyCode: 229 }],
  ] as const)("leaves IME %s (%j) to the input method", async (name, signal) => {
    await render(); await begin(); await fill(editor(), "新名称");
    const outer = vi.fn(); document.addEventListener("keydown", outer);
    let event: KeyboardEvent;
    try { event = await key(name, signal); } finally { document.removeEventListener("keydown", outer); }
    expect(event!.defaultPrevented).toBe(false); expect(editor().value).toBe("新名称");
    expect(document.activeElement).toBe(editor()); expect(props.onRenameScript).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled(); expect(outer).not.toHaveBeenCalled();
  });
  it("preserves blur-to-save and the actual next focus destination", async () => {
    await render(); await begin();
    await act(async () => search().focus());
    expect(props.onRenameScript).toHaveBeenCalledTimes(1); expect(props.onRenameScript).toHaveBeenCalledWith("custom-study-1", "New name");
    expect(editor()).toBeNull(); expect(document.activeElement).toBe(search());
  });
  it("returns to search when an immediate rename removes the filtered result", async () => {
    await render({ onRenameScript: vi.fn((id, name) => {
      props = { ...props, scripts: [{ ...script, id, name }] }; root.render(tree());
    }) });
    await begin(); await key("Enter");
    expect(rename()).toBeNull(); expect(document.activeElement).toBe(search());
  });
  it("recovers focus when a delayed save removes the returned action", async () => {
    await render(); await begin(); await key("Enter");
    expect(document.activeElement).toBe(rename());
    await render({ scripts: [{ ...script, name: "New name" }] });
    expect(rename()).toBeNull(); expect(document.activeElement).toBe(search());
  });
  it("does not steal focus from a new task when the delayed save arrives", async () => {
    await render(); await begin(); await key("Enter");
    const close = host.querySelector<HTMLButtonElement>(".im-close")!;
    await act(async () => close.focus());
    await render({ scripts: [{ ...script, name: "New name" }] });
    expect(document.activeElement).toBe(close);
  });
  it("keeps a new edit intact when the former editor emits a late blur", async () => {
    await render(); await begin(); const old = editor(); await key("Escape");
    await act(async () => rename().click()); await fill(editor(), "Second draft");
    await act(async () => old.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(editor().value).toBe("Second draft"); expect(props.onRenameScript).not.toHaveBeenCalled();
  });
  it("does not restore focus into a suspended library after a delayed save", async () => {
    await render(); await begin(); await key("Enter");
    await render({ suspended: true, scripts: [{ ...script, name: "New name" }] });
    expect(document.activeElement).not.toBe(search());
  });
});

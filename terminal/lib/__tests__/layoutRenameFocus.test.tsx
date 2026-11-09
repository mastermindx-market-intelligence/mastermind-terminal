// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LayoutMenu, { type LayoutMenuProps, type SavedWorkspace } from "@/components/LayoutMenu";
import { LangProvider } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const alpha: SavedWorkspace = { id: "alpha-id", name: "Alpha", config: {}, updated_at: null, rowState: "ok" };
const beta: SavedWorkspace = { ...alpha, id: "beta-id", name: "Beta" };
let host: HTMLDivElement, root: Root, props: LayoutMenuProps, outside: HTMLButtonElement;
const noop = () => {};

beforeEach(() => {
  localStorage.clear(); document.documentElement.setAttribute("data-lang", "en");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.isConnected && !this.closest("[hidden], [inert]") ? [new DOMRect(0, 0, 100, 40)] : []) as unknown as DOMRectList;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  outside = document.createElement("button"); outside.textContent = "Another task"; document.body.append(outside);
  props = { status: "ready", layouts: [alpha, beta], name: "", onNameChange: noop, onSave: noop, saving: false,
    feedback: { kind: "idle" }, deleteError: null, onLoad: noop, onDelete: noop, onRetry: noop, onSignUp: noop,
    brainInWorkspace: false, onToggleBrainDock: noop, onRename: vi.fn(), onDuplicate: noop, onExport: noop,
    onImport: noop, staleName: null, onUseSuggested: noop, onReloadLatest: noop, onSaveAsCopy: noop,
    isOpen: true, unclaimedFields: [], unsupportedWidgets: [] };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); outside.remove(); vi.restoreAllMocks(); });

async function render(update: Partial<LayoutMenuProps> = {}) {
  props = { ...props, ...update };
  await act(async () => root.render(<LangProvider><LayoutMenu {...props} /></LangProvider>));
}
const input = () => host.querySelector<HTMLInputElement>("[data-ws-rename-input]")!;
const save = () => host.querySelector<HTMLButtonElement>("[data-ws-rename-commit]")!;
const cancel = () => host.querySelector<HTMLButtonElement>("[data-ws-rename-cancel]")!;
async function begin(name = "Alpha") {
  const row = host.querySelector<HTMLElement>(`[data-layout-row="${name}"]`)!;
  if (!row.querySelector('[data-ws-act="rename"]')) await act(async () => row.querySelector<HTMLElement>("[data-ws-more]")!.click());
  await act(async () => row.querySelector<HTMLButtonElement>('[data-ws-act="rename"]')!.click());
  expect(document.activeElement).toBe(input());
}
async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })));
}

describe("workspace rename keyboard continuity", () => {
  it("retains the draft when focus traverses input, Save and Cancel", async () => {
    await render(); await begin(); await edit("Alpha draft");
    for (const target of [save(), cancel(), input()]) {
      await act(async () => target.focus()); expect(input()?.value).toBe("Alpha draft"); expect(document.activeElement).toBe(target);
    }
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("submits once through Save and retains the editor through a conflict", async () => {
    await render(); await begin(); await edit("  New Alpha  ");
    await act(async () => save().focus()); await act(async () => save().click());
    expect(props.onRename).toHaveBeenCalledTimes(1); expect(props.onRename).toHaveBeenCalledWith(alpha, "New Alpha");
    await render({ feedback: { kind: "conflict", name: "New Alpha", suggested: "New Alpha 2", op: "rename" } });
    expect(input().value).toBe("  New Alpha  "); expect(document.activeElement).toBe(save());
  });

  it.each(["input", "save", "cancel"])("Escape from %s cancels locally and restores the row action", async control => {
    await render(); await begin(); await edit("Abandoned");
    const target = control === "input" ? input() : control === "save" ? save() : cancel();
    await act(async () => target.focus());
    const outer = vi.fn(); document.addEventListener("keydown", outer);
    await key(target, "Escape");
    document.removeEventListener("keydown", outer);
    expect(input()).toBeNull(); expect(document.activeElement).toBe(host.querySelector('[data-ws-more="Alpha"]'));
    expect(host.querySelector('[data-layout-row="Alpha"] [data-ws-act="rename"]')).not.toBeNull();
    expect(outer).not.toHaveBeenCalled(); expect(props.onRename).not.toHaveBeenCalled();
  });

  it("Cancel returns to the row but leaving the group keeps the new focus destination", async () => {
    await render(); await begin(); await act(async () => cancel().focus()); await act(async () => cancel().click());
    expect(document.activeElement).toBe(host.querySelector('[data-ws-more="Alpha"]'));
    await begin(); await edit("Discard on leaving"); await act(async () => outside.focus());
    expect(input()).toBeNull(); expect(document.activeElement).toBe(outside); expect(props.onRename).not.toHaveBeenCalled();
  });

  it.each(["", "Alpha"])("blank or unchanged submission cancels without writing (%s)", async name => {
    await render(); await begin(); await edit(name); await key(input(), "Enter");
    expect(input()).toBeNull(); expect(document.activeElement).toBe(host.querySelector('[data-ws-more="Alpha"]'));
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it.each(["Enter", "Escape"])("lets native IME own %s", async name => {
    await render(); await begin(); await edit("新名称");
    await key(input(), name, { isComposing: true }); expect(input()?.value).toBe("新名称");
    await key(input(), name, { keyCode: 229 }); expect(input()?.value).toBe("新名称");
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("restores the row after the confirmed rename and retains focus through the list refresh", async () => {
    await render(); await begin(); await edit("New Alpha");
    await act(async () => save().focus()); await act(async () => save().click());
    await render({ feedback: { kind: "renamed", id: alpha.id, name: "New Alpha" } });
    expect(input()).toBeNull(); expect(document.activeElement).toBe(host.querySelector('[data-ws-more="Alpha"]'));
    await render({ layouts: [{ ...alpha, name: "New Alpha" }, beta] });
    expect(document.activeElement).toBe(host.querySelector('[data-ws-more="New Alpha"]'));
  });

  it("ignores a late success for another row after the user starts a new editor", async () => {
    await render(); await begin(); await edit("New Alpha"); await act(async () => save().click());
    await act(async () => outside.focus()); await begin("Beta"); await edit("Beta draft");
    await render({ feedback: { kind: "renamed", id: alpha.id, name: "New Alpha" } });
    expect(input()?.value).toBe("Beta draft"); expect(document.activeElement).toBe(input());
  });

  it("preserves a newer draft in the same row when an earlier rename succeeds", async () => {
    await render(); await begin(); await edit("First request"); await act(async () => save().click());
    await edit("Newer draft");
    await render({ feedback: { kind: "renamed", id: alpha.id, name: "First request" } });
    expect(input()?.value).toBe("Newer draft"); expect(document.activeElement).toBe(input());
  });

  it("does not move focus after the editor was left or the menu closed", async () => {
    await render(); await begin(); await edit("New Alpha"); await act(async () => save().click());
    await act(async () => outside.focus());
    await render({ isOpen: false, feedback: { kind: "renamed", id: alpha.id, name: "New Alpha" } });
    expect(document.activeElement).toBe(outside);
  });

  it("keeps the draft through an error or a success for another row identity", async () => {
    await render(); await begin(); await edit("New Alpha"); await act(async () => save().click());
    await render({ feedback: { kind: "error", message: "Try again" } }); expect(input()?.value).toBe("New Alpha");
    await render({ feedback: { kind: "renamed", id: beta.id, name: "New Alpha" } }); expect(input()?.value).toBe("New Alpha");
  });
});

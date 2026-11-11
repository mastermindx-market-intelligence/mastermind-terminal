// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "@/components/studyTemplates/useDialogFocus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function FocusScope({ onEscape }: { onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onEscape);
  return <div ref={ref} role="dialog" aria-modal="true" aria-label="Search task" tabIndex={-1}>
    <input data-autofocus aria-label="Search" />
    <button type="button">Close search</button>
  </div>;
}

let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
let extras: HTMLElement[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  extras = [];
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  extras.forEach(element => element.remove());
});

function externalDialog(hidden = false) {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Resolve watchlist conflict");
  dialog.hidden = hidden;
  dialog.innerHTML = '<button type="button">Keep this device</button><button type="button">Use other device</button>';
  document.body.append(dialog);
  extras.push(dialog);
  return { dialog, first: dialog.children[0] as HTMLButtonElement, last: dialog.children[1] as HTMLButtonElement };
}

function backgroundButton() {
  const button = document.createElement("button");
  button.textContent = "Chart action";
  document.body.append(button);
  extras.push(button);
  return button;
}

function openSearch() {
  const onEscape = vi.fn();
  act(() => root.render(<FocusScope onEscape={onEscape} />));
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  const input = dialog.querySelector("input")!;
  // jsdom has no layout. Expose the same visible focus targets as the browser.
  for (const element of dialog.querySelectorAll<HTMLElement>("button,input")) {
    Object.defineProperty(element, "offsetParent", { configurable: true, get: () => dialog });
  }
  expect(document.activeElement).toBe(input);
  return { dialog, input, onEscape };
}

describe("dialog focus ownership with a later portalled task", () => {
  it("allows a newly opened modal to receive and keep focus without closing Search", () => {
    const search = openSearch();
    const newer = externalDialog();
    act(() => newer.first.focus());
    expect(document.activeElement).toBe(newer.first);
    act(() => newer.last.focus());
    expect(document.activeElement).toBe(newer.last);
    expect(search.onEscape).not.toHaveBeenCalled();
    expect(search.dialog.isConnected).toBe(true);
  });

  it("allows a previously hidden dialog to become the newer active task", () => {
    const newer = externalDialog(true);
    openSearch();
    newer.dialog.hidden = false;
    act(() => newer.first.focus());
    expect(document.activeElement).toBe(newer.first);
  });

  it("does not yield to a dialog that was already open behind Search", () => {
    const older = externalDialog();
    const search = openSearch();
    act(() => older.first.focus());
    expect(document.activeElement).toBe(search.input);
  });

  it("continues blocking ordinary background focus after the newer dialog closes", () => {
    const background = backgroundButton();
    const search = openSearch();
    const newer = externalDialog();
    act(() => newer.first.focus());
    expect(document.activeElement).toBe(newer.first);
    newer.dialog.remove();
    act(() => background.focus());
    expect(document.activeElement).toBe(search.input);
  });

  it("does not restore the chart opener over a still-active newer dialog on unmount", () => {
    const opener = backgroundButton();
    opener.focus();
    openSearch();
    const newer = externalDialog();
    act(() => newer.first.focus());
    act(() => root.unmount());
    mounted = false;
    expect(document.activeElement).toBe(newer.first);
  });

  it("still returns focus to the opener when no newer modal owns it", () => {
    const opener = backgroundButton();
    opener.focus();
    openSearch();
    act(() => root.unmount());
    mounted = false;
    expect(document.activeElement).toBe(opener);
  });
});

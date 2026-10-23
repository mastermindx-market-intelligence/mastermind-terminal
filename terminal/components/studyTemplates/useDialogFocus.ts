"use client";
// E07 — keyboard contract shared by the two template dialogs: focus moves into the dialog when it
// opens, Tab / Shift+Tab stay inside it, Escape asks to close, and focus returns to whatever opened
// it (the chart menu, the library button) when it closes.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function isVisibleModal(element: HTMLElement): boolean {
  if (element.closest("[aria-hidden='true'], [inert], [hidden]")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const escape = useRef(onEscape);
  useLayoutEffect(() => { escape.current = onEscape; });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // A later portalled task (for example a watchlist conflict chooser) owns focus until it
    // closes. Remember only already-visible dialogs: a parked/hidden dialog may open later.
    // This is local focus provenance, not another modal stack or global event owner.
    const predecessors = new Set(Array.from(document.querySelectorAll<HTMLElement>("[aria-modal='true']")).filter(isVisibleModal));
    const newerModalOwns = (target: Element | null): boolean => {
      const modal = target?.closest<HTMLElement>("[aria-modal='true']");
      return !!modal && !root.contains(modal) && !modal.contains(root)
        && !predecessors.has(modal) && isVisibleModal(modal);
    };
    let opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root;
    first.focus({ preventScroll: true });
    // A disabled autofocus target refuses focus: fall back to the first usable control, then the dialog.
    if (!root.contains(document.activeElement)) (focusables(root)[0] ?? root).focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // A control that owns Escape itself (an inline rename field) cancels its own edit instead.
        if (event.target instanceof Element && event.target.closest("[data-escape-local]")) return;
        event.preventDefault();
        event.stopPropagation();
        escape.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(root);
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const active = document.activeElement;
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && (active === head || !root.contains(active))) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && (active === tail || !root.contains(active))) {
        event.preventDefault();
        head.focus();
      }
    };
    // aria-modal: focus that lands behind the dialog (a closing menu restoring its own opener a
    // frame late) is pulled back in, and that element becomes the return target if there was none.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || root.contains(target) || newerModalOwns(target)) return;
      if (!opener || !opener.isConnected) opener = target;
      (focusables(root)[0] ?? root).focus({ preventScroll: true });
    };
    root.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      root.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      if (opener && opener.isConnected && !newerModalOwns(document.activeElement)) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}

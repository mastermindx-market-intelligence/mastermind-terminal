import type { RefObject } from "react";

/** Provenance for one open UI task; it is never a global modal registry. */
export type DialogFocusSession = { opener: HTMLElement | null; predecessors: Set<HTMLElement> | null };
type FocusSessionRef = RefObject<DialogFocusSession>;

function isVisibleModal(element: HTMLElement): boolean {
  if (element.closest("[aria-hidden='true'], [inert], [hidden]")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

/** Local provenance for an existing focus owner, without a modal registry. */
export function createNewerModalFocusGuard(root: HTMLElement, focusSessionRef?: FocusSessionRef) {
  const predecessors = focusSessionRef?.current.predecessors
    ?? new Set(Array.from(root.ownerDocument.querySelectorAll<HTMLElement>("[aria-modal='true']")).filter(isVisibleModal));
  if (focusSessionRef && !focusSessionRef.current.predecessors) focusSessionRef.current.predecessors = predecessors;
  return (target: Element | null): boolean => {
    const modal = target?.closest<HTMLElement>("[aria-modal='true']");
    return !!modal && !root.contains(modal) && !modal.contains(root)
      && !predecessors.has(modal) && isVisibleModal(modal);
  };
}

function availableReturnTarget(target: HTMLElement | null): target is HTMLElement {
  if (!target?.isConnected || target === target.ownerDocument.body
    || target.matches(":disabled, [aria-disabled='true']")
    || target.closest("[aria-hidden='true'], [inert], [hidden]")) return false;
  const style = target.ownerDocument.defaultView?.getComputedStyle(target);
  return style?.display !== "none" && style?.visibility !== "hidden" && target.getClientRects().length > 0;
}

/** A logical task keeps its first opener across responsive presentations. */
export function rememberDialogReturnTarget(focusSessionRef: FocusSessionRef | undefined, scope: HTMLElement, candidate: Element | null): void {
  if (!focusSessionRef || focusSessionRef.current.opener || !(candidate instanceof HTMLElement)
    || scope.contains(candidate) || !availableReturnTarget(candidate)) return;
  focusSessionRef.current.opener = candidate;
}

/** Called only by the incumbent dialog/sheet owner when it actually closes. */
export function restoreDialogFocus(previous: HTMLElement | null, focusSessionRef?: FocusSessionRef, newerModalOwns?: (target: Element | null) => boolean): void {
  // A remounted presentation may start at body focus while the logical task
  // still has a valid opener. The owner decides whether this is a real close.
  const target = focusSessionRef ? focusSessionRef.current.opener : previous;
  if (!target || (focusSessionRef ? !availableReturnTarget(target) : !target.isConnected)) return;
  if (newerModalOwns?.(target.ownerDocument.activeElement)) return;
  target.focus({ preventScroll: true });
}

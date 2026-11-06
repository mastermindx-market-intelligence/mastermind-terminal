import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Section = "range" | "layers" | "help";
type Expanded = Record<Section, boolean>;
const COLLAPSED: Expanded = { range: false, layers: false, help: false };

/** Only the reader's own panel/host may supply a retained offset, never the page. */
function scrollOwner(panel: HTMLElement, host: HTMLElement): HTMLElement | null {
  if (!panel.isConnected || !host.contains(panel)) return null;
  for (let element: HTMLElement | null = panel; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY || style.overflow) &&
        element.clientHeight > 0 && element.scrollHeight > element.clientHeight) return element;
    if (element === host) break;
  }
  return null;
}

/**
 * Presentation memory for one open chart reader. The chart's data/selection and
 * TerminalShell's explicit close/launcher focus remain with their existing owners.
 */
export function useChartContextPresentation(root: RefObject<HTMLElement | null>, scope: string, open: boolean, target: HTMLElement | null) {
  const live = useRef({ open, target });
  const identity = useRef(scope);
  const previousRoot = useRef<HTMLElement | null>(null);
  const previousScroller = useRef<HTMLElement | null>(null);
  const offset = useRef<number | null>(null);
  const focusKey = useRef<string | null>(null);
  const [sections, setSections] = useState<{ scope: string; expanded: Expanded }>({ scope, expanded: COLLAPSED });
  const expanded = open && sections.scope === scope ? sections.expanded : COLLAPSED;

  // Capture continuously: the old portal host can be disconnected before a
  // layout-effect cleanup has a chance to inspect its focus or scroll position.
  useEffect(() => {
    if (!open) return;
    const rememberFocus = (event: FocusEvent) => {
      const panel = root.current;
      const element = event.target;
      if (panel?.isConnected && element instanceof Element && panel.contains(element)) {
        const control = element.closest<HTMLElement>("[data-context-focus]");
        focusKey.current = control && panel.contains(control) ? control.dataset.contextFocus ?? null : null;
      } else if (!((element === document.body || element === document.documentElement) && !panel?.isConnected)) {
        focusKey.current = null;
      }
    };
    const outsideIntent = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) focusKey.current = null;
    };
    const rememberScroll = (event: Event) => {
      const panel = root.current;
      const host = live.current.target;
      if (!live.current.open || !panel || !host) return;
      const scroller = scrollOwner(panel, host);
      // A disappearing/non-scrollable old host can emit a zero scroll. It must
      // not erase the last actual internal offset during a responsive move.
      if (scroller && event.target === scroller) {
        offset.current = scroller.scrollTop;
        previousScroller.current = scroller;
      }
    };
    document.addEventListener("focusin", rememberFocus, true);
    document.addEventListener("pointerdown", outsideIntent, true);
    document.addEventListener("keydown", outsideIntent, true);
    document.addEventListener("scroll", rememberScroll, true);
    return () => {
      document.removeEventListener("focusin", rememberFocus, true);
      document.removeEventListener("pointerdown", outsideIntent, true);
      document.removeEventListener("keydown", outsideIntent, true);
      document.removeEventListener("scroll", rememberScroll, true);
    };
  }, [open, root]);

  useLayoutEffect(() => {
    live.current = { open, target };
    if (!open || identity.current !== scope) {
      const active = document.activeElement;
      // Keep a focus claim only when the same live control still owns it. An
      // outside click can cancel ownership without changing activeElement.
      const stillOwned = open && focusKey.current && active instanceof HTMLElement &&
        root.current?.contains(active) && active.dataset.contextFocus === focusKey.current &&
        !active.matches(":disabled") && active.getClientRects().length &&
        getComputedStyle(active).visibility !== "hidden" ? focusKey.current : null;
      identity.current = scope;
      // A new source starts at the top. Zero remains pending through a plain
      // inline page or temporarily missing host; neither scrolls the document.
      offset.current = open ? 0 : null;
      focusKey.current = stillOwned;
      previousRoot.current = null;
      previousScroller.current = null;
      setSections((current) => current.scope === scope && !Object.values(current.expanded).some(Boolean)
        ? current : { scope, expanded: COLLAPSED });
    }
    const panel = root.current;
    // Logical open intent survives a callback-ref's temporary null host.
    if (!open || !panel || !target) return;
    const replaced = previousRoot.current !== null && previousRoot.current !== panel;
    const restoreScroll = () => {
      if (root.current !== panel || !panel.isConnected) return;
      const scroller = scrollOwner(panel, target);
      if (scroller !== previousScroller.current || panel !== previousRoot.current) {
        if (scroller && offset.current !== null) {
          offset.current = Math.max(0, Math.min(offset.current, scroller.scrollHeight - scroller.clientHeight));
          scroller.scrollTop = offset.current;
        }
        previousScroller.current = scroller;
      }
      previousRoot.current = panel;
    };
    restoreScroll();
    if (replaced && focusKey.current && document.hasFocus()) {
      const active = document.activeElement;
      // Another layout effect or user action may already have focused a valid
      // control, including a different control inside this reader.
      if (active === document.body || active === document.documentElement) {
        const control = Array.from(panel.querySelectorAll<HTMLElement>("[data-context-focus]"))
          .find((element) => element.dataset.contextFocus === focusKey.current);
        if (control && !control.matches(":disabled") && control.getClientRects().length &&
            getComputedStyle(control).visibility !== "hidden") {
          control.focus({ preventScroll: true });
        } else {
          focusKey.current = null;
        }
      }
    }
    // Fullscreen can change the internal scroll owner without changing the host.
    // ResizeObserver handles that layout change without reapplying an offset on
    // every market-frame/crosshair render or scheduling delayed focus.
    const observer = new ResizeObserver(restoreScroll);
    observer.observe(panel);
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, scope, target, root]);

  const toggle = (section: Section) => {
    if (!open) return;
    setSections((current) => {
      const prior = current.scope === scope ? current.expanded : COLLAPSED;
      return { scope, expanded: { ...prior, [section]: !prior[section] } };
    });
  };
  return { expanded, toggle };
}


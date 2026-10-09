"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { resolveDetentRelease } from "@/lib/sheetDetent";

export interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  ariaLabel?: string;
  children: React.ReactNode;
  maxHeight?: string;
  /** Extra class on the sheet root, for surfaces with their own anatomy (e.g. the Drawings sheet). */
  className?: string;
  /**
   * Opt-in two-detent presentation, `[initial, full]` as percentages of the viewport height.
   * The sheet presents at `initial` with the page alive above it, the grabber/header drags it to
   * `full` and back, and a drag down from `initial` dismisses. Omit it and the sheet keeps its
   * content height and the dismiss-only transform drag every other surface uses.
   */
  detents?: readonly [number, number];
  /**
   * Where focus lands on present. `first` (the default) takes the sheet's first control, which is
   * what a menu wants. `sheet` parks focus on the dialog itself — for surfaces whose first control
   * is a text field they do NOT want to summon a keyboard for, like the phone ticker picker, where
   * opening the drawer is navigation rather than a request to type.
   */
  initialFocus?: "first" | "sheet";
  /** Opt-in: a child inspector may consume Escape to clear its selection before the sheet closes. */
  escapeKey?: "close" | "bubble";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const SWIPE_TRANSITION = "transform 260ms cubic-bezier(.32,.72,.24,1)";
const SWIPE_CLOSE_MS = 270;

// Interactive content a drag must never steal the pointer from; both drag mechanics honour it.
const DRAG_EXEMPT_SELECTOR = "button, a[href], input, select, textarea, label, summary, [role='button'], [role='option'], [role='menuitem'], .msheet-row, [data-no-sheet-drag]";
/** Floor for the live drag height, so a fast flick can't invert the sheet before release. */
const DETENT_MIN_HEIGHT = 80;
/**
 * Travel before a detent drag takes the pointer. Capturing on pointerdown would retarget the
 * click to the sheet root, so a TAP on a plain (non-button) row — a search result, say — would
 * never reach its handler. Below this the gesture is still a tap and the sheet stays put.
 */
const DETENT_DRAG_SLOP = 4;

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (
      element.hidden
      || element.getAttribute("aria-disabled") === "true"
      || element.closest("[aria-hidden='true'], [inert]")
      || element.tabIndex < 0
    ) {
      return false;
    }
    return element.getClientRects().length > 0;
  });
}

function reducedMotionPreferred(): boolean {
  return typeof window !== "undefined"
    && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedMotionServerSnapshot(): boolean {
  return false;
}

export default function MobileSheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  maxHeight,
  className,
  detents,
  initialFocus = "first",
  escapeKey = "close",
}: MobileSheetProps) {
  // Track mount so createPortal only fires client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const mountFrame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(mountFrame);
  }, []);

  // Swipe-to-dismiss state
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startY: number;
    startT: number;
    captured: boolean;
    pointerId: number | null;
  }>({ startY: 0, startT: 0, captured: false, pointerId: null });
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const hasTitle = Boolean(title);
  const reduceMotion = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionPreferred,
    reducedMotionServerSnapshot,
  );

  // ── Two-detent drag (opt-in via `detents`) ─────────────────────────────────────────────────
  // Twin: components/mobile/AnalysisHubSheet.tsx, whose 60↔96 hub drag this mirrors. The hub
  // keeps its own copy because its scrim, markup and focus model are not this component's — but
  // the release decision they must agree on is shared, in lib/sheetDetent.ts.
  const [atFullDetent, setAtFullDetent] = useState(false);
  const [liveDetentHeight, setLiveDetentHeight] = useState<number | null>(null);
  // liveHeight mirrors liveDetentHeight: release must read the height the last MOVE produced, and
  // a burst of pointer events inside one task would leave the state value a render behind.
  const detentRef = useRef<{
    startY: number; startH: number; pointerId: number | null; liveHeight: number | null;
    lastY: number; lastT: number; velocity: number; captured: boolean;
  }>({ startY: 0, startH: 0, pointerId: null, liveHeight: null, lastY: 0, lastT: 0, velocity: 0, captured: false });
  // Each presentation starts at the first detent (React's adjust-state-on-prop-change pattern).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) { setAtFullDetent(false); setLiveDetentHeight(null); }
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (open || closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Move focus into the modal, contain keyboard navigation, and return focus to
  // the element that opened it. Keep the latest onClose in a ref so inline
  // callbacks do not tear down and recreate the focus boundary every render.
  useEffect(() => {
    if (!open || !mounted) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusFrame = window.requestAnimationFrame(() => {
      const target = sheet.querySelector<HTMLElement>("[data-autofocus], [autofocus]")
        ?? (initialFocus === "sheet" ? sheet : focusableElements(sheet)[0])
        ?? sheet;
      target.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (escapeKey === "bubble") return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(sheet);
      if (focusable.length === 0) {
        event.preventDefault();
        sheet.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusEscaped = !(active instanceof Node) || !sheet.contains(active);

      if (active === sheet || focusEscaped) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const onBubbledEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault(); onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    if (escapeKey === "bubble") document.addEventListener("keydown", onBubbledEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", onBubbledEscape);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [mounted, open, initialFocus, escapeKey]);

  function clearCloseTimer() {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function closeNow() {
    clearCloseTimer();
    onCloseRef.current();
  }

  function releasePointer(pointerId: number) {
    const sheet = sheetRef.current;
    if (!sheet) return;
    try {
      if (sheet.hasPointerCapture(pointerId)) sheet.releasePointerCapture(pointerId);
    } catch {
      // A native gesture may already have taken ownership of this pointer.
    }
  }

  function resetDrag(pointerId?: number) {
    const drag = dragRef.current;
    if (pointerId !== undefined && drag.pointerId !== pointerId) return;
    const capturedPointer = drag.pointerId;
    drag.captured = false;
    drag.pointerId = null;
    if (capturedPointer !== null) releasePointer(capturedPointer);

    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transition = reduceMotion ? "none" : SWIPE_TRANSITION;
    sheet.style.transform = "";
    if (reduceMotion) {
      window.requestAnimationFrame(() => {
        if (sheetRef.current === sheet && !dragRef.current.captured) {
          sheet.style.transition = "";
        }
      });
    }
  }

  // Pointer-based swipe dismiss on handle/header and content (when scrollTop===0).
  // Handlers live on the sheet root only — the handle is detected via closest() so a drag
  // never runs two handler chains (the handle-wrap has no handlers of its own).
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const sheet = sheetRef.current;
    if (!sheet || !e.isPrimary || closeTimerRef.current !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Only drag from handle/header or when content is scrolled to top
    const target = e.target as HTMLElement;
    const isHandle = !!target.closest?.('[data-handle="1"]');
    const scrollEl = sheet.querySelector<HTMLElement>(".msheet-body");
    const atTop = !scrollEl || scrollEl.scrollTop === 0;
    if (!isHandle && !atTop) return;
    // Capturing on pointerdown retargets pointerup/click to the sheet in WebKit.
    // Leave interactive content alone so chart-type rows and other sheet
    // controls receive a complete click; swipe remains available from the
    // handle, header/background, and non-interactive content.
    if (!isHandle && target.closest?.(DRAG_EXEMPT_SELECTOR)) return;
    dragRef.current = {
      startY: e.clientY,
      startT: Date.now(),
      captured: true,
      pointerId: e.pointerId,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events and browser gesture arbitration may deny capture.
    }
    sheet.style.transition = "none";
  }

  // Gesture arbitration (pinch, native scroll takeover) fires pointercancel — spring back cleanly.
  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.captured) return;
    resetDrag(e.pointerId);
  }

  function onLostPointerCapture(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.captured || dragRef.current.pointerId !== e.pointerId) return;
    resetDrag(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.captured || dragRef.current.pointerId !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.captured || dragRef.current.pointerId !== e.pointerId) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    const dt = Date.now() - dragRef.current.startT;
    const fastFlick = dt < 250 && dy > 30;
    dragRef.current.captured = false;
    dragRef.current.pointerId = null;
    releasePointer(e.pointerId);

    if (dy > 90 || fastFlick) {
      if (reduceMotion) {
        sheet.style.transition = "none";
        closeNow();
        return;
      }
      // Animate out, then remove the modal at the matching bounded duration.
      sheet.style.transition = SWIPE_TRANSITION;
      sheet.style.transform = "translateY(100%)";
      closeTimerRef.current = window.setTimeout(closeNow, SWIPE_CLOSE_MS);
    } else {
      // spring back
      resetDrag();
    }
  }

  // Detent drag — the same three handlers as above, but moving HEIGHT rather than transform so the
  // sheet grows and shrinks against a live page instead of sliding off it.
  function onDetentDown(e: React.PointerEvent<HTMLDivElement>) {
    const sheet = sheetRef.current;
    if (!sheet || !detents || !e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const isHandle = !!target.closest?.('[data-handle="1"]');
    const scrollEl = sheet.querySelector<HTMLElement>(".msheet-body");
    // Anywhere on the grabber/header, or on the body while it is scrolled to the top.
    if (!isHandle && (!scrollEl || scrollEl.scrollTop > 0 || target.closest?.(DRAG_EXEMPT_SELECTOR))) return;
    // Deliberately NOT capturing yet — see DETENT_DRAG_SLOP.
    detentRef.current = {
      startY: e.clientY,
      startH: sheet.getBoundingClientRect().height,
      pointerId: e.pointerId,
      liveHeight: null,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      captured: false,
    };
  }

  function onDetentMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = detentRef.current;
    if (!detents || drag.pointerId !== e.pointerId) return;
    if (!drag.captured) {
      if (Math.abs(e.clientY - drag.startY) < DETENT_DRAG_SLOP) return;
      drag.captured = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events and browser gesture arbitration may deny capture.
      }
    }
    const max = window.innerHeight * (detents[1] / 100);
    const height = Math.min(max, Math.max(
      DETENT_MIN_HEIGHT,
      drag.startH - (e.clientY - drag.startY),
    ));
    // Positive velocity is downward — the direction that shrinks the sheet.
    drag.velocity = (e.clientY - drag.lastY) / Math.max(1, e.timeStamp - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    drag.liveHeight = height;
    setLiveDetentHeight(height);
  }

  function onDetentUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = detentRef.current;
    if (!detents || drag.pointerId !== e.pointerId) return;
    drag.pointerId = null;
    if (drag.captured) releasePointer(e.pointerId);
    drag.captured = false;
    const height = drag.liveHeight;
    const { startH, velocity } = drag;
    drag.liveHeight = null;
    drag.velocity = 0;
    setLiveDetentHeight(null);
    if (height == null) return;
    const landing = resolveDetentRelease({
      height,
      startHeight: startH,
      velocity,
      initial: window.innerHeight * (detents[0] / 100),
      full: window.innerHeight * (detents[1] / 100),
    });
    if (landing === "dismiss") closeNow();
    else setAtFullDetent(landing === "full");
  }

  /** A cancelled pointer is the system taking the gesture away, not a decision: abandon the
   *  drag and let the sheet settle back on the detent it already had. */
  function onDetentCancel(e: React.PointerEvent<HTMLDivElement>) {
    const drag = detentRef.current;
    if (!detents || drag.pointerId !== e.pointerId) return;
    drag.pointerId = null;
    drag.liveHeight = null;
    drag.velocity = 0;
    if (drag.captured) releasePointer(e.pointerId);
    drag.captured = false;
    setLiveDetentHeight(null);
  }

  if (!mounted) return null;

  // In detent mode the height is inline (this component owns both the resting detent and the live
  // drag); globals.css only carries the snap animation and the gesture routing.
  const detentStyle = detents
    ? {
      height: liveDetentHeight != null
        ? `${liveDetentHeight}px`
        : `${atFullDetent ? detents[1] : detents[0]}dvh`,
      maxHeight: `${detents[1]}dvh`,
    }
    : null;
  const rootClass = [
    "msheet",
    className,
    detents ? "is-detent" : null,
    liveDetentHeight != null ? "is-dragging" : null,
  ].filter(Boolean).join(" ");

  const node = (
    <>
      {open && (
        <div
          // A detented sheet keeps the page live above it (TV parity), so its scrim stays
          // transparent until the full detent — the element itself remains the tap-outside target.
          className={detents
            ? `msheet-scrim is-detent${atFullDetent ? " at-full" : ""}`
            : "msheet-scrim"}
          style={reduceMotion ? { animation: "none" } : undefined}
          onClick={closeNow}
          aria-hidden="true"
        />
      )}
      {open && (
        <div
          ref={sheetRef}
          className={rootClass}
          style={{
            ...(maxHeight ? { maxHeight } : {}),
            ...(detentStyle ?? {}),
            ...(reduceMotion ? { animation: "none" } : {}),
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={hasTitle ? titleId : undefined}
          aria-label={hasTitle ? undefined : (ariaLabel ?? "Sheet")}
          tabIndex={-1}
          data-detent={detents ? (atFullDetent ? "full" : "initial") : undefined}
          onPointerDown={detents ? onDetentDown : onPointerDown}
          onPointerMove={detents ? onDetentMove : onPointerMove}
          onPointerUp={detents ? onDetentUp : onPointerUp}
          onPointerCancel={detents ? onDetentCancel : onPointerCancel}
          onLostPointerCapture={detents ? undefined : onLostPointerCapture}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Grab handle — drag target (detected via data-handle in the sheet's own handlers) */}
          <div className="msheet-handle-wrap" data-handle="1">
            <div className="msheet-handle" />
          </div>
          {/* A detented sheet drags from the header too, so the grabber is not the only grip once
              the body is scrolled; the dismiss-only sheets keep the handle as their sole one. */}
          {hasTitle && (
            <div id={titleId} className="msheet-title" data-handle={detents ? "1" : undefined}>{title}</div>
          )}
          <div className="msheet-body">{children}</div>
        </div>
      )}
    </>
  );

  return createPortal(node, document.body);
}

"use client";

/**
 * Tip — the ONE tooltip primitive (v6). Retires six ad-hoc systems: native
 * title=, the two globals.css [data-tip]::after variants, and the hand-rolled
 * React tips (Treemap / StrikeExpiryMatrix / StrikeLadder / FlowCard / ConfidencePanel).
 *
 * Behaviour (TradingView feel):
 *  - fixed-position PORTAL to <body> → escapes every overflow:hidden pane.
 *  - measured flip + clamp against the viewport on all four edges (8px margin).
 *  - 120ms open delay with WARM-OPEN: a module-level timestamp records the last
 *    close; if any Tip closed <300ms ago the next opens at 0ms (adjacent icon
 *    rows feel instant, first hover has the calm delay). Close is instant.
 *  - keyboard focus/blur trigger the tip too (a11y), with no delay.
 *  - glass from the v5 --pop-* tokens; sizes mini | card; optional .ds-kbd chip.
 *
 * Never use Tip for content that belongs inline, or for long definitional prose
 * on touch/keyboard-critical affordances (use a click popover there).
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type TipSide = "top" | "bottom" | "left" | "right";
export type TipSize = "mini" | "card";

export interface TipProps {
  label: ReactNode;
  side?: TipSide;
  size?: TipSize;
  /** Keep the trigger subtree stable while suppressing the tooltip (for touch layouts). */
  disabled?: boolean;
  /** Optional first-open delay. Adjacent warm-open behavior still applies. */
  delay?: number;
  /** Optional keyboard shortcut, rendered as a .ds-kbd chip (mini only). */
  shortcut?: string;
  /** The trigger element. Must accept a ref + mouse/focus handlers. */
  children: ReactElement;
}

const OPEN_DELAY = 120;   // ms — the calm first-open delay
const WARM_WINDOW = 300;  // ms — if a tip closed within this window, next opens at 0ms
const EDGE = 8;           // px — viewport margin for clamp
const GAP = 8;            // px — distance between trigger and tip

// Module-level warm timestamp — shared across ALL Tip instances (per the spec:
// a per-component timer would re-create the sluggish per-element delay).
let lastClose = 0;

/** True if a tip closed recently enough that the next should open with no delay. */
export function isWarm(now: number, last: number = lastClose): boolean {
  return now - last < WARM_WINDOW;
}

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number; }
export interface Size { width: number; height: number; }
export interface Viewport { width: number; height: number; }

export interface TipPosition { left: number; top: number; side: TipSide; }

/**
 * Pure placement math: given the trigger rect, tip size, preferred side and the
 * viewport, return the fixed left/top and the (possibly flipped) side. Flips to
 * the opposite side when the preferred side would overflow, then clamps the
 * cross-axis so the tip never leaves the viewport.
 */
export function placeTip(
  anchor: Rect,
  tip: Size,
  preferred: TipSide,
  vp: Viewport,
): TipPosition {
  const fits = (s: TipSide): boolean => {
    if (s === "top") return anchor.top - GAP - tip.height >= EDGE;
    if (s === "bottom") return anchor.bottom + GAP + tip.height <= vp.height - EDGE;
    if (s === "left") return anchor.left - GAP - tip.width >= EDGE;
    return anchor.right + GAP + tip.width <= vp.width - EDGE; // right
  };
  const opposite: Record<TipSide, TipSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  let side = preferred;
  if (!fits(side) && fits(opposite[side])) side = opposite[side];

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  let left: number, top: number;
  if (side === "top" || side === "bottom") {
    left = anchor.left + anchor.width / 2 - tip.width / 2;
    left = clamp(left, EDGE, vp.width - tip.width - EDGE);
    top = side === "top" ? anchor.top - GAP - tip.height : anchor.bottom + GAP;
    top = clamp(top, EDGE, vp.height - tip.height - EDGE);
  } else {
    top = anchor.top + anchor.height / 2 - tip.height / 2;
    top = clamp(top, EDGE, vp.height - tip.height - EDGE);
    left = side === "left" ? anchor.left - GAP - tip.width : anchor.right + GAP;
    left = clamp(left, EDGE, vp.width - tip.width - EDGE);
  }
  return { left: Math.round(left), top: Math.round(top), side };
}

export function Tip({ label, side = "top", size = "mini", disabled = false, delay = OPEN_DELAY, shortcut, children }: TipProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // drives the [data-open] enter transition
  const [pos, setPos] = useState<TipPosition>({ left: 0, top: 0, side });
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();

  const clearTimer = () => { if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; } };

  const scheduleOpen = useCallback((instant: boolean) => {
    if (disabled) return;
    clearTimer();
    const wait = instant || isWarm(Date.now()) ? 0 : Math.max(0, delay);
    if (wait === 0) { setOpen(true); return; }
    openTimer.current = setTimeout(() => setOpen(true), wait);
  }, [delay, disabled]);

  const close = useCallback(() => {
    clearTimer();
    if (open) lastClose = Date.now();
    setOpen(false);
    setShown(false);
  }, [open]);

  // Position once the tip is in the DOM and measurable; then flip [data-open] on.
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const el = anchorRef.current;
    const tip = tipRef.current;
    if (!el || !tip) return;
    const a = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const next = placeTip(
      { left: a.left, top: a.top, right: a.right, bottom: a.bottom, width: a.width, height: a.height },
      { width: t.width, height: t.height },
      side,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos(next);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [disabled, open, side, label]);

  // A responsive suppression ends this interaction, even though the trigger stays mounted.
  // Retire pending hover work on disable as well as unmount; re-enabling waits for a new trigger.
  useEffect(() => () => clearTimer(), [disabled]);

  // Close synchronously at the suppression boundary so an old portal/enter transition cannot
  // reappear when the same trigger returns to desktop. This same-component adjustment converges.
  if (disabled && (open || shown)) {
    setOpen(false);
    setShown(false);
  }

  if (!isValidElement(children)) return children;

  const visible = open && !disabled;

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const r = (children as { ref?: unknown }).ref;
      if (typeof r === "function") (r as (n: HTMLElement | null) => void)(node);
      else if (r && typeof r === "object") (r as { current: HTMLElement | null }).current = node;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      scheduleOpen(false);
      (children.props as { onMouseEnter?: (e: React.MouseEvent) => void }).onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      close();
      (children.props as { onMouseLeave?: (e: React.MouseEvent) => void }).onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      scheduleOpen(true); // keyboard focus opens immediately
      (children.props as { onFocus?: (e: React.FocusEvent) => void }).onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      close();
      (children.props as { onBlur?: (e: React.FocusEvent) => void }).onBlur?.(e);
    },
    "aria-describedby": visible ? tipId : undefined,
  });

  return (
    <>
      {trigger}
      {visible && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={`tip ${size === "mini" ? "tip-mini" : "tip-card"}`}
            data-side={pos.side}
            data-open={shown ? "1" : "0"}
            style={{ left: pos.left, top: pos.top }}
          >
            {label}
            {shortcut && size === "mini" && <kbd className="ds-kbd">{shortcut}</kbd>}
          </div>,
          document.body,
        )}
    </>
  );
}

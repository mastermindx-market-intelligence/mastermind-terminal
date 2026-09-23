"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { resolveDetentRelease } from "@/lib/sheetDetent";
import styles from "./AnalysisHubSheet.module.css";

export type HubAction = "indicators" | "compare" | "alerts" | "chartType" | "workspaces" | "symbolDetails" | "options";

export type AnalysisHubSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Every action is backed by an existing Terminal capability. */
  onAction: (action: HubAction) => void;
};

type ActionTile = {
  id: string;
  labelKey: string;
  path: string;
  action: HubAction;
};

type UnavailableCapability = {
  id: string;
  labelKey: string;
};

// A capability map keeps the phone hub honest. Action tiles are existing Terminal paths; surfaces
// the audit did not establish stay noninteractive and outside the primary tool grid.
const CAPABILITIES: {
  tools: readonly ActionTile[];
  unavailable: readonly UnavailableCapability[];
  info: readonly ActionTile[];
} = {
  tools: [
    { id: "indicators", labelKey: "indicators", path: "M5 12h14M12 5v14", action: "indicators" },
    { id: "compare", labelKey: "compare", path: "M4 18l5-9 4 5 3-4 4 8", action: "compare" },
    { id: "alerts", labelKey: "alerts", path: "M18 15V10a6 6 0 1 0-12 0v5l-2 3h16zM10 21h4", action: "alerts" },
    { id: "chartType", labelKey: "hubChartType", path: "M6 6v12M6 8h4M6 14h4M15 4v16M15 7h4M15 16h4", action: "chartType" },
    { id: "workspaces", labelKey: "layouts", path: "M4 5h16v14H4zM4 9h16M9 9v10", action: "workspaces" },
    { id: "options", labelKey: "hubOptionsHeatmap", path: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18", action: "options" },
  ],
  unavailable: [
    { id: "objectTree", labelKey: "hubObjectTree" },
  ],
  info: [
    { id: "symbolDetails", labelKey: "hubSymbolDetails", path: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v6M12 7.5h.01", action: "symbolDetails" },
  ],
};

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

const HALF = 0.6;
const FULL = 0.96;

/**
 * The phone Analysis hub — the ••• of the roller strip. Presents at 60% of the viewport and DRAGS
 * to full (and back), matching the native hub's detents; the body scrolls once it is at full.
 * The drag below is the twin of MobileSheet's `detents` prop, kept here rather than shared because
 * this surface has its own scrim, markup and focus model — change one and check the other.
 */
export default function AnalysisHubSheet({ open, onClose, onAction }: AnalysisHubSheetProps) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [full, setFull] = useState(false);
  const [dragH, setDragH] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  // liveH mirrors dragH: the release handler must read the height the last MOVE produced, and a
  // burst of pointer events inside one task would leave the state value a render behind.
  const drag = useRef<{
    startY: number; startH: number; id: number | null; liveH: number | null;
    lastY: number; lastT: number; velocity: number; captured: boolean;
  }>({ startY: 0, startH: 0, id: null, liveH: null, lastY: 0, lastT: 0, velocity: 0, captured: false });
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Each presentation starts at the 60% detent (React's adjust-state-on-prop-change pattern).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) { setFull(false); setDragH(null); }
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // The hub is aria-modal, so keyboard focus must obey that same boundary. Capture the opener on
  // every presentation, land on Close, contain both Tab directions, and return to the opener for
  // every dismissal path. Action handoffs opt out below after placing focus on the opener first,
  // allowing the receiving overlay to capture that stable return target without a cleanup race.
  useEffect(() => {
    if (!open || !mounted) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    restoreFocusRef.current = true;

    const focusFrame = window.requestAnimationFrame(() => {
      (focusableElements(sheet)[0] ?? sheet).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
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

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (restoreFocusRef.current && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [mounted, open]);

  function handOff(action: HubAction, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const returnTarget = previousFocusRef.current;
    restoreFocusRef.current = false;
    previousFocusRef.current = null;
    if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    onAction(action);
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const sheet = sheetRef.current;
    if (!sheet || !event.isPrimary) return;
    const target = event.target as HTMLElement;
    const fromGrip = !!target.closest?.('[data-handle="1"]');
    const body = sheet.querySelector<HTMLElement>(".mhub-body");
    // Anywhere on the grabber/header, or on the body while it is scrolled to the top.
    if (!fromGrip && (!body || body.scrollTop > 0 || target.closest?.("button, a[href], input"))) return;
    drag.current = {
      startY: event.clientY,
      startH: sheet.getBoundingClientRect().height,
      id: event.pointerId,
      liveH: null,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      captured: false,
    };
    // Capture waits for real travel: taking the pointer on pointerdown retargets the click to the
    // sheet, which would cost a plain (non-button) child its tap. MobileSheet's twin does the same.
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (state.id !== event.pointerId) return;
    if (!state.captured) {
      if (Math.abs(event.clientY - state.startY) < 4) return;
      state.captured = true;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* gesture arbitration */ }
    }
    const max = window.innerHeight * FULL;
    const height = Math.min(max, Math.max(80, state.startH - (event.clientY - state.startY)));
    // Positive velocity is downward — the direction that shrinks the sheet.
    state.velocity = (event.clientY - state.lastY) / Math.max(1, event.timeStamp - state.lastT);
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    state.liveH = height;
    setDragH(height);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (state.id !== event.pointerId) return;
    state.id = null;
    state.captured = false;
    const height = state.liveH;
    const { startH, velocity } = state;
    state.liveH = null;
    state.velocity = 0;
    setDragH(null);
    if (height == null) return;
    const landing = resolveDetentRelease({
      height,
      startHeight: startH,
      velocity,
      initial: window.innerHeight * HALF,
      full: window.innerHeight * FULL,
    });
    if (landing === "dismiss") onCloseRef.current();
    else setFull(landing === "full");
  }

  /** A cancelled pointer is the system taking the gesture away, not a decision. */
  function cancelDrag(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (state.id !== event.pointerId) return;
    state.id = null;
    state.captured = false;
    state.liveH = null;
    state.velocity = 0;
    setDragH(null);
  }

  if (!mounted || !open) return null;

  const tile = (entry: ActionTile) => (
    <button
      key={entry.id}
      type="button"
      className="mhub-tile"
      data-testid={`hub-tile-${entry.id}`}
      onClick={(event) => handOff(entry.action, event)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={entry.path} /></svg>
      <span>{t(entry.labelKey)}</span>
    </button>
  );

  return createPortal(
    <>
      <div className={`mhub-scrim${full ? " at-full" : ""}`} onClick={() => onCloseRef.current()} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={`mhub${full ? " is-full" : ""}${dragH != null ? " is-dragging" : ""}`}
        style={{ height: dragH != null ? `${dragH}px` : `${(full ? FULL : HALF) * 100}dvh` }}
        role="dialog"
        aria-modal="true"
        aria-label={t("hubTitle")}
        tabIndex={-1}
        data-testid="analysis-hub"
        data-detent={full ? "full" : "half"}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mhub-grip" data-handle="1"><span /></div>
        <div className="mhub-hd" data-handle="1">
          <b>{t("hubTitle")}</b>
          <button type="button" className="mhub-close" onClick={() => onCloseRef.current()} aria-label={t("sheetClose")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
          </button>
        </div>
        <div className="mhub-body">
          <div className="mhub-ghd">{t("hubTools")}</div>
          <div className="mhub-grid">{CAPABILITIES.tools.map(tile)}</div>
          <div className={styles.unavailable} data-testid="hub-unavailable-tools" role="note">
            <strong>{t("wsPanelUnavailable")}</strong>
            <span>{CAPABILITIES.unavailable.map((capability) => t(capability.labelKey)).join(" · ")}</span>
          </div>
          <div className="mhub-ghd">{t("hubInfo")}</div>
          <div className="mhub-grid">{CAPABILITIES.info.map(tile)}</div>
        </div>
      </div>
    </>,
    document.body,
  );
}

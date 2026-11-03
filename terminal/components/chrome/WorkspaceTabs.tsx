"use client";
import { useEffect, useRef } from "react";
import { useT, useLang } from "@/lib/i18n";

/**
 * WorkspaceTabs — the ONE sub-nav primitive for the Discover / Research / Automate
 * workspaces (Wave-2 IA). Renders the v6 `.obs-pillnav` idiom, upgraded with the
 * `--t-fast var(--ease-out)` motion law and full keyboard support.
 *
 * Pure and CONTROLLED: URL state (`?tab=`) is the PAGE's job. The page owns the tab
 * registry, reads `?tab=` into `active`, and pushes it back on `onSelect`
 * (router.replace, shallow). This component only paints + emits selection.
 *
 * Contract (for the FLOW-SPLIT lane):
 *   tabs     : { key: string; labelKey: string; zhLabel?: string }[]
 *              key      — the ?tab= value (also the selection identity)
 *              labelKey — i18n dict key; resolved via t() for EN+ZH
 *              zhLabel  — optional zh override for labels not carried in the dict
 *                         (falls back to labelKey when the active lang is en)
 *   active   : string          — the currently-selected tab key
 *   onSelect : (key) => void   — fired on click / Enter / Space / arrow move
 *
 * a11y: role="tablist" with roving-tabindex tabs; ←/→ move (wrapping), Home/End
 * jump to first/last, and the moved-to tab is focused + selected. Panels are the
 * page's responsibility; pass `aria-label` for the group.
 */
export interface WorkspaceTab {
  key: string;
  labelKey: string;
  zhLabel?: string;
}
export interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  active: string;
  onSelect: (key: string) => void;
  /** Accessible name for the tablist (e.g. "Discover tabs"). */
  "aria-label"?: string;
  className?: string;
}

export default function WorkspaceTabs({
  tabs,
  active,
  onSelect,
  "aria-label": ariaLabel,
  className,
}: WorkspaceTabsProps) {
  const t = useT();
  const { lang } = useLang();
  const navRef = useRef<HTMLElement | null>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // A deep-linked tab near the end of a phone-width rail must not be selected
  // off-screen. Keep this horizontal-only so activating a tab never moves the
  // surrounding document vertically. Locale is a layout dependency: EN↔ZH
  // changes every tab width even when the active key stays unchanged.
  const activeIndex = tabs.findIndex((tab) => tab.key === active);
  useEffect(() => {
    const nav = navRef.current;
    const button = btnRefs.current[activeIndex];
    if (!nav || !button) return;
    const reveal = () => {
      if (!nav.clientWidth) return;
      const bounds = button.getBoundingClientRect();
      const left = nav.getBoundingClientRect().left + nav.clientLeft;
      const right = left + nav.clientWidth;
      if (bounds.left < left) nav.scrollTo({ left: nav.scrollLeft + bounds.left - left });
      else if (bounds.right > right) nav.scrollTo({ left: nav.scrollLeft + bounds.right - right });
    };
    const frame = window.requestAnimationFrame(reveal);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(reveal) : null;
    observer?.observe(nav);
    observer?.observe(button);
    return () => { window.cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [active, activeIndex, lang, tabs.length]);

  // t(key) resolves the dict for the active lang and echoes `key` back when there's no
  // entry. So a zhLabel override applies ONLY when in zh AND the dict has no entry
  // (resolved === key) — real dict entries always win.
  const label = (tb: WorkspaceTab) => {
    const resolved = t(tb.labelKey);
    if (lang === "zh" && tb.zhLabel && resolved === tb.labelKey) return tb.zhLabel;
    return resolved;
  };

  const move = (to: number) => {
    const n = tabs.length;
    if (n === 0) return;
    const i = ((to % n) + n) % n;
    btnRefs.current[i]?.focus({ preventScroll: true });
    onSelect(tabs[i].key);
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(idx + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(idx - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(tabs.length - 1);
        break;
    }
  };

  return (
    <nav
      ref={navRef}
      className={`obs-pillnav wtabs${className ? " " + className : ""}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tb, idx) => {
        const on = tb.key === active;
        return (
          <button
            key={tb.key}
            ref={(el) => { btnRefs.current[idx] = el; }}
            type="button"
            role="tab"
            id={`wtab-${tb.key}`}
            aria-selected={on}
            aria-controls={`wpanel-${tb.key}`}
            tabIndex={on ? 0 : -1}
            className={`obs-pillnav-tab${on ? " on" : ""}`}
            onClick={() => onSelect(tb.key)}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            {label(tb)}
          </button>
        );
      })}
    </nav>
  );
}

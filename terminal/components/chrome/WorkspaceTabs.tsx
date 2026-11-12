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
 *   tabs     : { key: string; labelKey: string; enLabel?: string; zhLabel?: string }[]
 *              key      — the ?tab= value (also the selection identity)
 *              labelKey — i18n dict key; canonical entries win when present
 *              enLabel / zhLabel — optional local fallbacks for product-local tabs that do
 *                         not belong in the global translation registry
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
  enLabel?: string;
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
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nav = navRef.current;
      const index = tabs.findIndex((tab) => tab.key === active);
      const button = index >= 0 ? btnRefs.current[index] : null;
      if (!nav || !button) return;
      const left = button.offsetLeft;
      const right = left + button.offsetWidth;
      if (left < nav.scrollLeft) {
        nav.scrollTo({ left, behavior: "auto" });
      } else if (right > nav.scrollLeft + nav.clientWidth) {
        nav.scrollTo({ left: right - nav.clientWidth, behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, tabs, lang]);

  // Canonical dictionary entries always win. Product-local labels are used only when
  // t() echoes an unknown key, keeping a small local surface from invalidating the
  // global translation registry and its unrelated visual-evidence locks.
  const label = (tb: WorkspaceTab) => {
    const resolved = t(tb.labelKey);
    if (resolved !== tb.labelKey) return resolved;
    if (lang === "zh" && tb.zhLabel) return tb.zhLabel;
    return tb.enLabel ?? tb.labelKey;
  };

  const move = (to: number) => {
    const n = tabs.length;
    if (n === 0) return;
    const i = ((to % n) + n) % n;
    btnRefs.current[i]?.focus();
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

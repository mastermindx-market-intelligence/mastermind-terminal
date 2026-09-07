"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/BrandMark";
import DashboardBackButton from "@/components/DashboardBackButton";
import { TOP, Glyph as NavGlyph } from "@/components/AppNav";
import SettingsButton from "@/components/settings/SettingsButton";
import { useT } from "@/lib/i18n";
import { useActiveSymbol } from "@/lib/activeSymbol";
import { navHref } from "@/lib/navSymbol";

/**
 * Shared mobile top-bar + slide-in drawer used by both the /terminal shell and
 * the (shell) app2 routes (discover / research / automate / portfolio).
 *
 * Mirrors the exact .mobilebar / .m-drawer CSS classes already defined in
 * globals.css so no new visual idiom is introduced. The drawer items derive
 * from AppNav's TOP export (single source of truth) — the five workspaces.
 *
 * Props
 * -----
 * email          — passed to SettingsButton (cosmetic; guest = "")
 * fromMacro      — when true, shows a prominent "back" pill in the left slot
 *                  and moves the hamburger to the right cluster
 * onBack         — called when the Back pill is tapped (fromMacro only)
 * onOpenCopilot  — optional: when provided the AI star button calls this
 *                  instead of navigating to /terminal?ai=1
 * activeKey      — override the auto-derived active nav key (rarely needed;
 *                  the derived path-prefix key is correct for every workspace)
 */
export interface MobileNavProps {
  email: string;
  fromMacro?: boolean;
  onBack?: () => void;
  onOpenCopilot?: () => void;
  activeKey?: string;
  /** Retained for call-site compatibility; the drawer no longer special-cases the
   *  fundamentals pane (Analyst is gone from the nav). */
  isTerminal?: boolean;
}

export default function MobileNav({
  email,
  fromMacro = false,
  onBack,
  onOpenCopilot,
  activeKey: activeKeyProp,
  isTerminal: _isTerminal = false,
}: MobileNavProps) {
  const [drawer, setDrawer] = useState(false);
  const navPath = usePathname();
  const t = useT();
  // Carries the company you are looking at through the drawer — see lib/navSymbol. This drawer
  // is the surface the gap was reported on: tapping Analysis while charting SMR opened NVDA.
  const activeSymbol = useActiveSymbol();

  // Active key = path prefix per workspace, mirroring AppNav. Chart is the default/center.
  const derivedKey = activeKeyProp ?? (
    navPath.startsWith("/analysis") ? "analysis"
    : navPath.startsWith("/discover") ? "discover"
    : navPath.startsWith("/options") ? "options"
    : navPath.startsWith("/scripts") ? "scripts"
    : navPath.startsWith("/alerts") ? "alerts"
    : navPath.startsWith("/portfolio") ? "portfolio"
    : "chart"
  );

  const handleAI = () => {
    setDrawer(false);
    if (onOpenCopilot) {
      onOpenCopilot();
    } else {
      window.location.href = "/terminal?ai=1";
    }
  };

  return (
    <>
      {/* ── mobile top bar ── */}
      <div className={`mobilebar${fromMacro ? " from-macro" : ""}`}>
        {fromMacro
          ? <DashboardBackButton onClick={onBack} variant="mobile" />
          : (
            <button className="m-ic" onClick={() => setDrawer(true)} aria-label="Menu">
              <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}
        <span className="m-brand"><BrandMark size={22} /><b>MASTERMIND</b></span>
        <div className="m-right">
          {fromMacro && (
            <button className="m-ic" onClick={() => setDrawer(true)} aria-label="Menu">
              <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}
          <button className="m-ic" onClick={handleAI} aria-label="Mastermind AI">
            <svg viewBox="0 0 24 24" style={{ fill: "var(--brand-2)", stroke: "none" }}>
              <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
            </svg>
          </button>
          <SettingsButton email={email} />
        </div>
      </div>

      {/* ── drawer scrim ── */}
      <div
        className={`m-drawer-scrim${drawer ? " open" : ""}`}
        onClick={() => setDrawer(false)}
      />

      {/* ── slide-in drawer ── */}
      <div className={`m-drawer${drawer ? " open" : ""}`}>
        <div className="m-drawer-h"><BrandLockup /></div>
        <nav className="m-nav">
          {TOP.map((it) => {
            const on = it.k === derivedKey;
            return (
              <Link
                key={it.k}
                href={navHref(it, activeSymbol, navPath)}
                className={on ? "on" : ""}
                onClick={() => setDrawer(false)}
              >
                <NavGlyph k={it.k} />
                {t(it.k, it.label)}
              </Link>
            );
          })}
          <button onClick={handleAI}>
            <svg viewBox="0 0 24 24" style={{ fill: "var(--brand-2)", stroke: "none" }}>
              <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
            </svg>
            {t("ai")}
          </button>
        </nav>
        <div className="m-drawer-ft"><SettingsButton email={email} /></div>
      </div>
    </>
  );
}

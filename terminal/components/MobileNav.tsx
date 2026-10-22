"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/BrandMark";
import DashboardBackButton from "@/components/DashboardBackButton";
import { TOP, Glyph as NavGlyph } from "@/components/AppNav";
import SettingsButton from "@/components/settings/SettingsButton";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { useActiveSymbol } from "@/lib/activeSymbol";
import { navHref } from "@/lib/navSymbol";
import { SHARED_SHELL_NAV, SHARED_SHELL_MARKETS, sharedShellActiveKey, sharedShellTerminalHref } from "@/lib/sharedShellNavigation";
import MobileNavModal from "./MobileNavModal";
import styles from "./MobileNav.module.css";
import SharedShellPresentationControls from "./chrome/shared-shell/SharedShellPresentationControls";

// Shared Shell beta viewport ceiling (px). MobileNavModal keeps PR697's default 860
// breakpoint for any other consumer; the beta follows the same incumbent 860px boundary.
const SHARED_SHELL_BREAKPOINT_PX = 860;

/**
 * Shared mobile top-bar + slide-in drawer used by both the /terminal shell and
 * the (shell) app2 routes (discover / research / automate / portfolio).
 *
 * Mirrors the exact .mobilebar / .m-drawer CSS classes already defined in
 * globals.css so no new visual idiom is introduced. The drawer items derive from
 * AppNav's TOP export (single source of truth) — the five workspaces.
 *
 * Beta path (sharedShell=true, boolean supplied by AppShell from the exact
 * MMX_SHARED_SHELL=1): while drawer=true the scrim+drawer pair is replaced by
 * PR697's MobileNavModal (commit 0023bffa7c6c0370f15ec1e3a16398d82fe2cf33) — a real
 * <dialog> mounted ONLY while open, so a closed drawer contains no hidden
 * keyboard-focusable links. Beta nav derives from SHARED_SHELL_NAV plus
 * SHARED_SHELL_MARKETS; exactly one mobile primary-nav owner is ever mounted — no
 * second drawer, no second directory, no hand-written modal. The non-beta branch
 * keeps the original markup, classes and behavior (fromMacro included) intact.
 *
 * Props
 * -----
 * email           — passed to SettingsButton (cosmetic; guest = "")
 * sharedShell     — Shared Shell beta flag; selects the modal-drawer path
 * onOpenDirectory — beta "All tools" callback only; no directory is mounted here
 * onOpenSearch    — search callback kept in the current topbar
 * fromMacro       — when true, shows a prominent "back" pill in the left slot
 *                   and moves the hamburger to the right cluster
 * onBack          — called when the Back pill is tapped (fromMacro only)
 * onOpenCopilot   — optional: when provided the AI star button calls this
 *                   instead of navigating to /terminal?ai=1
 * activeKey       — override the auto-derived active nav key (rarely needed;
 *                   the derived path-prefix key is correct for every workspace)
 */
export interface MobileNavProps {
  email: string;
  sharedShell?: boolean;
  onOpenDirectory?: () => void;
  onOpenSearch?: () => void;
  fromMacro?: boolean;
  returnHref?: string;
  onBack?: () => void;
  onOpenCopilot?: () => void;
  activeKey?: string;
  /** Optional: when provided, a chart-actions button (command palette) shows before the AI star. */
  onOpenCommandPalette?: () => void;
  /** Accessible name for that button, in the current language (the caller owns the copy). */
  commandPaletteLabel?: string;
  /** Retained for call-site compatibility; the drawer no longer special-cases the
   *  fundamentals pane (Analyst is gone from the nav). */
  isTerminal?: boolean;
}

export default function MobileNav({
  email,
  sharedShell = false,
  onOpenDirectory,
  onOpenSearch,
  fromMacro = false, returnHref,
  onBack,
  onOpenCopilot,
  activeKey: activeKeyProp,
  onOpenCommandPalette,
  commandPaletteLabel,
  isTerminal: _isTerminal = false,
}: MobileNavProps) {
  const [drawer, setDrawer] = useState(false);
  const navPath = usePathname();
  const t = useSharedShellT();
  // Carries the company you are looking at through the drawer — see lib/navSymbol. This drawer
  // is the surface the gap was reported on: tapping Analysis while charting SMR opened NVDA.
  const activeSymbol = useActiveSymbol();

  // Stable identity for the beta modal (PR697 integration): one dialog id, one opener
  // hit target for focus restore, one stable onClose.
  const dialogId = useId();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  // The ordinary drawer keeps its incumbent layout and gets the same Escape exit
  // as the beta dialog. This listener exists only while that drawer is open.
  useEffect(() => {
    if (sharedShell || !drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeDrawer();
      openerRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sharedShell, drawer, closeDrawer]);

  // Active key = path prefix per workspace, mirroring AppNav. Chart is the default/center.
  const derivedKey = activeKeyProp ?? (sharedShell ? sharedShellActiveKey(navPath) : (
    navPath.startsWith("/analysis") ? "analysis"
    : navPath.startsWith("/discover") ? "discover"
    : navPath.startsWith("/options") ? "options"
    : navPath.startsWith("/scripts") ? "scripts"
    : navPath.startsWith("/alerts") ? "alerts"
    : navPath.startsWith("/portfolio") ? "portfolio"
    : "chart"
  ));

  const handleAI = () => {
    setDrawer(false);
    if (onOpenCopilot) {
      onOpenCopilot();
    } else if (navPath.startsWith("/analysis")) {
      window.dispatchEvent(new CustomEvent("mm:copilot"));
    } else {
      window.location.href = sharedShell ? sharedShellTerminalHref(window.location.href, activeSymbol, true) : "/terminal?ai=1";
    }
  };

  return (
    <>
      {/* ── mobile top bar ── */}
      {/* Beta adds ONLY the module .header hit-area styling; the default path is untouched. */}
      <div className={`mobilebar${fromMacro ? " from-macro" : ""}${sharedShell ? ` ${styles.header}` : ""}`}>
        {fromMacro
          ? <DashboardBackButton onClick={onBack} variant="mobile" returnHref={returnHref} />
          : (
            <button
              className="m-ic"
              onClick={() => setDrawer(true)}
              ref={openerRef}
              aria-label={sharedShell ? t("shellMenu") : "Menu"}
              aria-haspopup={sharedShell ? "dialog" : undefined}
              aria-expanded={sharedShell ? drawer : undefined}
              aria-controls={sharedShell ? dialogId : undefined}
            >
              <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}
        <span className="m-brand"><BrandMark size={22} /><b>MASTERMIND</b></span>
        <div className="m-right">
          {fromMacro && (
            <button
              className="m-ic"
              onClick={() => setDrawer(true)}
              ref={openerRef}
              aria-label={sharedShell ? t("shellMenu") : "Menu"}
              aria-haspopup={sharedShell ? "dialog" : undefined}
              aria-expanded={sharedShell ? drawer : undefined}
              aria-controls={sharedShell ? dialogId : undefined}
            >
              <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}
          {sharedShell && <button className="m-ic" onClick={onOpenSearch} aria-label={t("shellSearchCompanies")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          </button>}
          {sharedShell && <SharedShellPresentationControls />}
          {onOpenCommandPalette && (
            <button className="m-ic" type="button" onClick={onOpenCommandPalette} aria-label={commandPaletteLabel} aria-haspopup="dialog" data-command-palette-trigger="mobile">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l5 5-5 5M12 17h7" /></svg>
            </button>
          )}
          <button className="m-ic" onClick={handleAI} aria-label="Mastermind AI">
            <svg viewBox="0 0 24 24" style={{ fill: "var(--brand-2)", stroke: "none" }}>
              <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
            </svg>
          </button>
          {/* SettingsButton stays the ONLY account/settings owner; the beta wrapper only
              adds the module .account hit-area styling, never a second control. */}
          {sharedShell ? (
            <span className={styles.account}><SettingsButton email={email} /></span>
          ) : (
            <SettingsButton email={email} />
          )}
        </div>
      </div>

      {sharedShell ? (
        // Beta: the PR697 modal mounts ONLY while drawer=true. A closed drawer is
        // fully unmounted, so no hidden keyboard-focusable links linger.
        drawer ? (
          <MobileNavModal
            id={dialogId}
            label={t("shellNavigation")}
            closeLabel={t("shellCloseMenu")}
            openerRef={openerRef}
            onClose={closeDrawer}
            breakpointPx={SHARED_SHELL_BREAKPOINT_PX}
          >
            <div className="m-drawer-h"><BrandLockup /></div>
            <nav className="m-nav">
              {SHARED_SHELL_NAV.map((it) => {
                const on = it.k === derivedKey;
                return (
                  <Link
                    key={it.k}
                    href={navHref(it, activeSymbol, navPath)}
                    className={on ? "on" : ""}
                    aria-current={on ? "page" : undefined}
                    onClick={closeDrawer}
                  >
                    <NavGlyph k={it.k} />
                    {t(it.k, it.label)}
                  </Link>
                );
              })}
              <span className="m-nav-sect">{t("shellMarkets")}</span>
              {SHARED_SHELL_MARKETS.map((mk) => (
                <Link
                  key={mk.k}
                  href={mk.href}
                  aria-current={navPath === mk.href ? "page" : undefined}
                  onClick={closeDrawer}
                >
                  {t(mk.k, mk.label)}
                </Link>
              ))}
              {/* Callback only — the existing directory stays wherever it is mounted; no second one. */}
              <button type="button" onClick={() => { closeDrawer(); onOpenDirectory?.(); }}>{t("shellAllTools")}</button>
              {/* Client-only surface: this JSX renders ONLY while the modal is mounted (drawer
                  is false on SSR), so window.location.href is never read on the server. No new
                  auth or storage. The route transition closes the drawer via the modal's
                  pathname effect → onClose; the capture-phase release runs first. */}
              <Link
                href={sharedShellTerminalHref(window.location.href, activeSymbol)}
                onClick={closeDrawer}
              >
                {t("shellOpenTerminal")}
              </Link>
              <button onClick={handleAI}>
                <svg viewBox="0 0 24 24" style={{ fill: "var(--brand-2)", stroke: "none" }}>
                  <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
                </svg>
                {t("ai")}
              </button>
            </nav>
            <div className="m-drawer-ft"><SettingsButton email={email} /></div>
          </MobileNavModal>
        ) : null
      ) : (
        <>
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
      )}
    </>
  );
}

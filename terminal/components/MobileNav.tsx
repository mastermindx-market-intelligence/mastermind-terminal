"use client";
import { useCallback, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SharedShellPrimaryNav from "@/components/intelligence/SharedShellPrimaryNav";
import { BrandLockup, BrandMark } from "@/components/BrandMark";
import DashboardBackButton from "@/components/DashboardBackButton";
import { TOP, Glyph as NavGlyph } from "@/components/AppNav";
import SettingsButton from "@/components/settings/SettingsButton";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { useActiveSymbol } from "@/lib/activeSymbol";
import { navHref } from "@/lib/navSymbol";
import SharedShellLaunchLinks from "./chrome/shared-shell/SharedShellLaunchLinks";
import { sharedShellActiveKey } from "@/lib/sharedShellNavigation";
import { TerminalViews } from "./chrome/shared-shell/TerminalWorkspaceNav";
import MobileNavModal from "./MobileNavModal";
import styles from "./MobileNav.module.css";
import { shellCompanySubject, useShellLocation } from "./chrome/shared-shell/useShellLocation";
import SharedShellMarketSelect from "./chrome/shared-shell/SharedShellMarketSelect";

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
 * Both public and Shared Shell beta drawers use the existing PR697 MobileNavModal
 * (commit 0023bffa7c6c0370f15ec1e3a16398d82fe2cf33), mounted ONLY while open so a
 * closed drawer contains no hidden keyboard-focusable links. The beta flag is
 * supplied by AppShell from MMX_SHARED_SHELL=1 and retains SHARED_SHELL_NAV plus
 * the top-bar market context; the public path retains TOP and its symbol-preserving
 * routes. Exactly one mobile primary-nav owner is mounted, with the existing
 * modal owning focus, scroll lock, dismissal and action handoff for both paths.
 *
 * Props
 * -----
 * email           — passed to SettingsButton (cosmetic; guest = "")
 * sharedShell     — Shared Shell beta flag; selects the beta navigation content
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
  /** Chart chrome keeps its AI action in the navigation drawer. */
  isTerminal?: boolean;
  /** Disable viewport prefetch; warm sibling workspaces only on explicit intent. */
  intentPrefetch?: boolean;
}

function MobileShellSearch({ onOpen }: { onOpen?: () => void }) {
  const path = usePathname();
  const params = useSearchParams();
  const location = useShellLocation();
  const t = useSharedShellT();
  const subject = shellCompanySubject(path, params.get("symbol"), location);
  return <button type="button" className={`m-ic ${styles.search}`} onClick={onOpen}
    aria-haspopup="dialog" aria-label={t("shellSearchCompanies")}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
    <span>{subject ?? t("shellSearch")}</span>
  </button>;
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
  isTerminal = false,
  intentPrefetch = false,
}: MobileNavProps) {
  const [drawer, setDrawer] = useState(false);
  const navPath = usePathname();
  const router = useRouter();
  const t = useSharedShellT();
  // Carries the company you are looking at through the drawer — see lib/navSymbol. This drawer
  // is the surface the gap was reported on: tapping Analysis while charting SMR opened NVDA.
  const activeSymbol = useActiveSymbol();

  // Stable identity for the existing modal: one dialog id, one opener
  // hit target for focus restore, one stable onClose.
  const dialogId = useId();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  // Active key = path prefix per workspace, mirroring AppNav. Chart is the default/center.
  const derivedKey = activeKeyProp ?? (sharedShell ? sharedShellActiveKey(navPath) : (
    navPath.startsWith("/analysis") ? "analysis"
    : navPath.startsWith("/discover") ? "discover"
    : navPath.startsWith("/dislocations") ? "dislocations"
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
      window.location.href = "/terminal?ai=1";
    }
  };

  return (
    <>
      {/* ── mobile top bar ── */}
      <div className={`mobilebar${fromMacro ? " from-macro" : ""} ${styles.header}`}>
        {fromMacro
          ? <DashboardBackButton onClick={onBack} variant="mobile" returnHref={returnHref} />
          : (
            <button
              type="button"
              className="m-ic"
              onClick={() => setDrawer(true)}
              ref={openerRef}
              data-shell-menu-opener={sharedShell ? "" : undefined}
              aria-label={sharedShell ? t("shellMenu") : "Menu"}
              aria-haspopup="dialog"
              aria-expanded={drawer}
              aria-controls={dialogId}
            >
              <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}
        <span className="m-brand"><BrandMark size={22} /><b>MASTERMIND</b></span>
        <div className="m-right">
          {sharedShell && <SharedShellMarketSelect />}
          {fromMacro && (
            <button
              type="button"
              className="m-ic"
              onClick={() => setDrawer(true)}
              ref={openerRef}
              data-shell-menu-opener={sharedShell ? "" : undefined}
              aria-label={sharedShell ? t("shellMenu") : "Menu"}
              aria-haspopup="dialog"
              aria-expanded={drawer}
              aria-controls={dialogId}
            >
              <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}
          {sharedShell && <MobileShellSearch onOpen={onOpenSearch} />}
          {onOpenCommandPalette && (
            <button className="m-ic" type="button" onClick={onOpenCommandPalette} aria-label={commandPaletteLabel} aria-haspopup="dialog" data-command-palette-trigger="mobile">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l5 5-5 5M12 17h7" /></svg>
            </button>
          )}
          {!sharedShell && !isTerminal && <button className="m-ic" onClick={handleAI} aria-label="Mastermind AI">
            <svg viewBox="0 0 24 24" style={{ fill: "var(--brand-2)", stroke: "none" }}>
              <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
            </svg>
          </button>}
          {/* SettingsButton stays the only account/settings owner; this wrapper
              provides its existing centered 44px hit area on both header paths. */}
          <span className={styles.account}><SettingsButton email={email} /></span>
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
              {/* The beta primary navigation owns this list. Preserve upstream's
                  exact-route versus workspace-location accessibility in that owner. */}
              <SharedShellPrimaryNav mode="drawer" labelled activeSymbol={activeSymbol}
                activeKeyOverride={activeKeyProp} onNavigate={closeDrawer}
                renderGlyph={key => <NavGlyph k={key} />} />
              {(navPath === "/analysis" || navPath === "/discover") && <TerminalViews symbol={activeSymbol} onNavigate={closeDrawer} />}
              <SharedShellLaunchLinks drawer labelled glyph={key => <NavGlyph k={key} />} onNavigate={closeDrawer} />
              <button type="button" aria-controls="shared-shell-tools"
                onClick={() => { closeDrawer(); onOpenDirectory?.(); }}>{t("shellBrowseTools")}</button>
            </nav>
            <div className="m-drawer-ft"><SettingsButton email={email} /></div>
          </MobileNavModal>
        ) : null
      ) : drawer ? (
          <MobileNavModal
            id={dialogId}
            label={t("layouts")}
            closeLabel={t("sheetClose")}
            openerRef={openerRef}
            onClose={closeDrawer}
          >
            <div className="m-drawer-h"><BrandLockup /></div>
            <nav className="m-nav">
              {TOP.map((it) => {
                const on = it.k === derivedKey;
                const href = navHref(it, activeSymbol, navPath);
                const prefetchOnIntent = intentPrefetch ? () => router.prefetch(href) : undefined;
                return (
                  <Link
                    key={it.k}
                    href={href}
                    prefetch={intentPrefetch ? false : undefined}
                    onMouseEnter={prefetchOnIntent}
                    onFocus={prefetchOnIntent}
                    onTouchStart={prefetchOnIntent}
                    className={on ? "on" : ""}
                    aria-current={on ? "page" : undefined}
                    onClick={closeDrawer}
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
          </MobileNavModal>
      ) : null}
    </>
  );
}

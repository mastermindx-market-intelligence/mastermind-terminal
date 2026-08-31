"use client";
import { createContext, useCallback, useContext, useMemo } from "react";
import { usePathname } from "next/navigation";
import { BrandLockup } from "@/components/BrandMark";
import DashboardBackButton from "@/components/DashboardBackButton";
import { AppNav } from "@/components/AppNav";
import MobileNav from "@/components/MobileNav";
import SettingsButton from "@/components/settings/SettingsButton";
import BrainWidget from "@/components/BrainWidget";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { useT } from "@/lib/i18n";
import { backToMacro, useFromMacro } from "@/lib/originNav";
import { accountIdentity, GUEST_IDENTITY, identityEmail, type AccountIdentity } from "@/lib/accountIdentity";

/**
 * AppShell — the ONE shared chrome for every non-chart workspace (Wave-2 IA).
 *
 * Generalizes Wave-1's FlowChrome (app/flow/FlowChrome.tsx) from an Options-only
 * shell into a `{ email, children }` chrome owned by the route-group layout
 * app/(shell)/layout.tsx. It renders the .app2 grid + MobileNav + topbar
 * (BrandLockup + page title + spacer + Settings) + AppNav, and drops the
 * page's stripped, content-only .main2 subtree into the grid.
 *
 * Because the chrome lives OUTSIDE the page tree, a crash in any workspace view
 * surfaces the route error boundary INSIDE .main2 while logo + nav stay put.
 *
 * The Wave-1 layout fix is preserved verbatim: the root carries `obs obs-ambient`
 * and observatory.css pins .topbar/.appnav/.main2 to explicit grid cells + restores
 * position:fixed on the MobileNav drawer/scrim. Views must NOT reintroduce chrome.
 *
 * Title: resolved from a pathname→i18n-key map for the five workspaces. Falls back
 * to the workspace label so it renders even before the NAV lane lands the new keys.
 */

// Identity flows from the server (shell) layout (resolved once) down to any client
// child that needs it — a view's sign-out affordance, an owner-scoped store —
// without prop-drilling and without a second auth.getUser() per component.
//
// ONE context carries the whole AccountIdentity rather than a bare email string:
// `userId` is the ownership key every owner-scoped store must use, and `email` is
// display/routing information. Handing children only the email is what forced the
// preference store to key ownership on a mutable address — see lib/accountIdentity.ts.
const AppShellIdentityCtx = createContext<AccountIdentity>(GUEST_IDENTITY);

/** The shell's resolved identity. Guest until the layout says otherwise. */
export function useShellIdentity(): AccountIdentity {
  return useContext(AppShellIdentityCtx);
}

/** The signed-in address, or "" for a guest. Display/routing only — NEVER an owner key. */
export function useShellEmail(): string {
  return identityEmail(useContext(AppShellIdentityCtx));
}

// pathname prefix → [i18n key, english fallback]. Order matters: first match wins.
// Chart (/terminal) has its own shell and is intentionally absent.
const TITLE_MAP: Array<[string, string, string]> = [
  ["/analysis", "analysis", "Analysis"],
  ["/discover", "discover", "Discover"],
  ["/options", "options", "Options"],
  ["/scripts", "scripts", "Scripts"],
  ["/alerts", "alerts", "Alerts"],
  ["/portfolio", "pagePortfolio", "Portfolio"],
  ["/admin", "pageAdmin", "Admin"],
];

// The non-chart shell must never originate chart effects. These stable no-ops let
// /analysis mount the existing document-level Brain singleton without inventing
// a second command/annotation owner or rebinding its callbacks on every render.
const ignoreBrainShellEvent = () => undefined;
const requireBrainShellAuth = () => window.location.assign("/login");

export default function AppShell({
  email = "",
  userId = "",
  children,
}: {
  email?: string;
  /** The immutable auth uuid (`claims.sub`). "" renders a guest shell. */
  userId?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const path = usePathname();
  const hit = TITLE_MAP.find(([p]) => path.startsWith(p));
  const title = hit ? t(hit[1], hit[2]) : t("flow", "Options");
  const { fromMacro, macroHref } = useFromMacro();
  const onBack = useCallback(() => backToMacro(macroHref), [macroHref]);
  // Memoized on the two primitives, so a shell re-render hands children the SAME identity
  // object — an owner-scoped store keys on the owner string either way, but a stable identity
  // keeps it out of every consumer's dependency arrays.
  const identity = useMemo(() => accountIdentity(userId, email), [userId, email]);

  return (
    <AppShellIdentityCtx.Provider value={identity}>
      <OnboardingProvider email={email}>
      {/* Inside OnboardingProvider so the settings panel (and the avatar button)
          can call useOnboarding() directly — Billing's "choose a plan" and the
          guest path both hand off to the signup sheet. */}
      <SettingsProvider identity={identity}>
      <div className="app2 obs obs-ambient">
        <MobileNav email={email} fromMacro={fromMacro} onBack={onBack} />
        <header className="topbar">
          {fromMacro ? <DashboardBackButton onClick={onBack} /> : <BrandLockup />}
          <div className="tdiv" />
          <span className="page-title">{title}</span>
          <div className="spacer" />
          {/* Desktop settings/sign-out — the old per-view topbars each carried an avatar
              sign-out form; MobileNav's settings button is display:none on desktop, so the
              shell must render its own (review P1: dropped desktop sign-out). */}
          <SettingsButton email={email} />
        </header>
        <AppNav />
        {children}
        {/* /analysis owns exact-source attachment UI but previously had no Brain host.
            Reuse the existing document singleton here; chart routes do not compose
            AppShell and keep their sole TerminalShell -> BrainWidget mount. */}
        {path.startsWith("/analysis") && (
          <BrainWidget
            active=""
            onCommand={ignoreBrainShellEvent}
            onAnnotate={ignoreBrainShellEvent}
            onAuthRequired={requireBrainShellAuth}
          />
        )}
      </div>
      </SettingsProvider>
      </OnboardingProvider>
    </AppShellIdentityCtx.Provider>
  );
}

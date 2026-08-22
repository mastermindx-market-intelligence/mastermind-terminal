"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang, useT } from "@/lib/i18n";
import { identityEmail, identityOwnerKey, isAccountOwner, type AccountIdentity } from "@/lib/accountIdentity";
import { entitlementAgeMs, useDisplayEntitlement } from "@/lib/entitlementStore";
import { useUsage } from "@/lib/usageStore";
import type { AcsUser, SettingsSection } from "./SettingsProvider";
import { SETTINGS_SECTIONS } from "./SettingsProvider";
import type { AcsPlan, AcsUsage, SectionProps } from "./types";
import {
  IconAccount, IconBilling, IconPrefs, IconSignOut, IconSync, IconTerminal, IconUsage, IconX,
} from "./icons";
import SectionAccount from "./SectionAccount";
import SectionBilling from "./SectionBilling";
import SectionUsage from "./SectionUsage";
import SectionPreferences from "./SectionPreferences";
import SectionTerminal from "./SectionTerminal";
import SectionSync from "./SectionSync";

// ── The settings dashboard shell ─────────────────────────────────────────────
// Ported from the Macro Dashboard's `_buildSDash` / `_wireSDash` / `_sdShow` /
// `_openSDash`. Same card (min(1140px,94vw) × min(772px,100dvh-40px), r22), same
// 238px rail, same one-shot laser sweep, same ≤640px full-sheet collapse.
//
// Two upstream bugs are deliberately NOT reproduced:
//   1. macro's desktop header close button (`.sd-x`) has no click handler — ours
//      is wired (see icons.tsx SectionHead).
//   2. macro's SD_PLAN_FEATURES has no `unlimited` key, so unlimited users saw
//      the FREE feature list — see ACS_PLAN_FEATURES in types.ts.

const NAV: { id: SettingsSection; icon: React.ReactNode; key: string }[] = [
  { id: "account", icon: <IconAccount />, key: "acsAccount" },
  { id: "billing", icon: <IconBilling />, key: "acsBilling" },
  { id: "usage", icon: <IconUsage />, key: "acsUsage" },
  { id: "prefs", icon: <IconPrefs />, key: "acsPrefs" },
  { id: "terminal", icon: <IconTerminal />, key: "acsTerminal" },
  { id: "sync", icon: <IconSync />, key: "acsSyncT" },
];

const HEAD_KEY: Record<SettingsSection, string> = {
  account: "acsAccount",
  billing: "acsBilling",
  usage: "acsUsage",
  prefs: "acsPrefs",
  terminal: "acsTerminal",
  sync: "acsSyncT",
};

export interface SettingsPanelProps {
  visible: boolean;
  /** Increments on every open() — re-keys the laser so its sweep replays. */
  openSeq: number;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  /** The shell's resolved identity. Every owner-scoped read below keys on it, not on the email. */
  identity: AccountIdentity;
  user: AcsUser | null;
  onPatchMeta: (patch: Record<string, unknown>) => void;
  onRefreshUser: () => Promise<void>;
  /** Dev-harness seams (app/dev/settings): supply the payloads directly instead
   *  of fetching them. Local dev has no Supabase session, so this is the only
   *  way to exercise the paid/unlimited plan states and the usage meters. */
  devPlan?: AcsPlan;
  devUsage?: AcsUsage;
}

export default function SettingsPanel(props: SettingsPanelProps) {
  const t = useT();
  const { lang } = useLang();
  const { visible, openSeq, section, onSection, onClose, identity, user } = props;
  // Derived, never independently sourced: one identity in, an address out. Sections that only
  // display or route on the address take `email`; anything that OWNS state takes `identity`.
  const email = identityEmail(identity);
  const owner = identityOwnerKey(identity);

  // No SSR mount gate is needed: SettingsProvider loads this module with
  // `dynamic(..., { ssr: false })`, so it only ever renders on the client.

  // ── page scroll-lock + focus restore ──────────────────────────────────────
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!visible) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    root.classList.add("acs-lock");
    return () => {
      root.classList.remove("acs-lock");
      const el = lastFocus.current;
      if (el && typeof el.focus === "function" && document.contains(el)) {
        try { el.focus({ preventScroll: true }); } catch { /* detached */ }
      }
    };
  }, [visible]);

  // ── Escape closes (only while visible — a hidden mounted panel must not eat keys)
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  // ── focus the active rail tab on open (keyboard entry point) ──────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => {
      const el = cardRef.current?.querySelector<HTMLElement>(".acs-nav-b.active")
        || cardRef.current?.querySelector<HTMLElement>(".acs-nav-b");
      if (el) { try { el.focus({ preventScroll: true }); } catch { el.focus(); } }
    }, 90);
    return () => clearTimeout(id);
  }, [visible]);

  // The mobile rail collapses into a horizontally scrollable tab strip. Keep the selected tab
  // fully in view on open and after a section switch without moving the vertical settings pane.
  useEffect(() => {
    if (!visible || !window.matchMedia("(max-width: 640px)").matches) return;
    const id = requestAnimationFrame(() => {
      const nav = navRef.current;
      const activeTab = nav?.querySelector<HTMLElement>(".acs-nav-b.active");
      if (!nav || !activeTab) return;
      const left = activeTab.offsetLeft - (nav.clientWidth - activeTab.offsetWidth) / 2;
      nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [visible, section]);

  // ── focus trap (Tab cycle within the card) ────────────────────────────────
  const onCardKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const card = cardRef.current;
    if (!card) return;
    const all = card.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),a[href],select:not([disabled]),[tabindex="0"]',
    );
    const f = Array.prototype.filter.call(all, (el: HTMLElement) => el.offsetParent !== null) as HTMLElement[];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, []);

  // ── entitlement: the ONE canonical reader ─────────────────────────────────
  // This pane used to run its OWN `/api/me` fetch and cache, in parallel with
  // lib/useEntitlement's, with different lifetimes and opposite failure
  // semantics. Both are now lib/entitlementStore.ts, which is owner-scoped,
  // keeps "could not verify" distinct from "free", and can serve a SAME-OWNER
  // last-good plan flagged stale rather than blanking a paying customer's tier
  // because billing had a bad minute.
  const entitlement = useDisplayEntitlement(identity);
  const plan: AcsPlan | null = props.devPlan ?? entitlement.plan;
  const planErr = !props.devPlan && entitlement.unavailable;
  const planStale = !props.devPlan && entitlement.stale;

  // ── usage: a SEPARATE authority on a much shorter clock ───────────────────
  // `/api/brain/me` reports what is LEFT, which the user spends from inside this
  // very page — so it is verified on Usage entry and re-entry, not cached for the
  // life of the shell the way the old email-keyed fetch was. See lib/usageStore.ts.
  const usageLive = useUsage(identity, !props.devUsage && visible && section === "usage");
  const usage: AcsUsage | null = props.devUsage
    ?? (usageLive.quotas ? { tier: usageLive.tier, quotas: usageLive.quotas } : null);
  const usageErr = !props.devUsage && usageLive.unavailable;
  const usageStale = !props.devUsage && usageLive.stale;

  // ── freshness on RE-OPEN and on focus ─────────────────────────────────────
  // The panel is mounted once and hidden between uses, so "open it again" is not a
  // remount and used to revalidate nothing: a user could upgrade through onboarding
  // and reopen Settings to be told they were still on Free. Bounded by a TTL so
  // reopening twice in a row is one request, not two.
  const PLAN_TTL_MS = 60_000;
  useEffect(() => {
    if (props.devPlan || !visible || !isAccountOwner(owner)) return;
    if (entitlementAgeMs() > PLAN_TTL_MS) entitlement.refresh();
    // A billing change usually happens in ANOTHER tab (the Stripe portal, the
    // landing's upgrade flow), so coming back to this one is the moment to re-ask.
    const onFocus = () => { if (entitlementAgeMs() > PLAN_TTL_MS) entitlement.refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // `openSeq` is the re-open signal: it advances on every open() even when
    // `visible` was already true (a second avatar click on an open panel).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openSeq, owner, props.devPlan]);

  const shared: SectionProps = {
    t,
    lang,
    identity,
    email,
    user,
    onClose,
    onPatchMeta: props.onPatchMeta,
    onRefreshUser: props.onRefreshUser,
  };

  const displayName =
    (typeof user?.meta?.display_name === "string" && (user.meta.display_name as string)) ||
    [user?.meta?.first_name, user?.meta?.last_name].filter((v) => typeof v === "string" && v).join(" ") ||
    email;
  const avatarChar = (displayName || email || "U").trim().charAt(0).toUpperCase() || "U";

  const node = (
    <div
      className={`acs-overlay${visible ? " open" : ""}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden={visible ? undefined : true}
    >
      <div
        className="acs-card"
        role="dialog"
        aria-modal="true"
        aria-label={t(HEAD_KEY[section])}
        ref={cardRef}
        onKeyDown={onCardKeyDown}
      >
        <span className="acs-laser" aria-hidden="true" key={openSeq} />

        <aside className="acs-rail">
          <div className="acs-me">
            <span className="acs-me-av">{avatarChar}</span>
            <span className="acs-me-main">
              <span className="acs-me-name">{displayName || "—"}</span>
              <span className="acs-me-sub">{t("acsRailSub")}</span>
            </span>
          </div>

          <nav className="acs-nav" role="tablist" aria-label={t("acsSections")} ref={navRef}>
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                role="tab"
                className={`acs-nav-b${section === n.id ? " active" : ""}`}
                aria-selected={section === n.id}
                onClick={() => onSection(n.id)}
              >
                {n.icon}
                {t(n.key)}
              </button>
            ))}
          </nav>

          <span className="acs-rail-spacer" />

          {/* The Terminal's established sign-out idiom: a POST form, not a fetch. */}
          <form action="/auth/signout" method="post">
            <button type="submit" className="acs-signout">
              <IconSignOut />
              {t("signOut")}
            </button>
          </form>

          <button type="button" className="acs-x-m" aria-label={t("acsClose")} onClick={onClose}>
            <IconX />
          </button>
        </aside>

        <section className="acs-pane">
          {/* Only the active section is mounted: that gives the acsRise entry
              animation for free on every switch, and keeps the six sections
              from all fetching at once. The payloads they share (plan, usage)
              are cached above, so switching back is free. */}
          <div className="acs-sect on" key={section}>
            {section === "account" && <SectionAccount {...shared} />}
            {section === "billing" && (
              <SectionBilling {...shared} plan={plan} planErr={planErr} planStale={planStale} onRefreshPlan={entitlement.refresh} />
            )}
            {section === "usage" && (
              <SectionUsage {...shared} plan={plan} usage={usage} usageErr={usageErr} usageStale={usageStale} />
            )}
            {section === "prefs" && <SectionPreferences {...shared} />}
            {section === "terminal" && <SectionTerminal {...shared} />}
            {section === "sync" && <SectionSync {...shared} />}
          </div>
        </section>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

export { SETTINGS_SECTIONS };

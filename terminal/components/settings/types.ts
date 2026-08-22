// Shared contracts for the account settings dashboard sections.
// Lives apart from SettingsPanel so the sections can import types without a
// cycle (the panel imports the sections).

import type { AccountIdentity } from "@/lib/accountIdentity";
import type { AccountLane, AccountPlan, AccountQuotas, AccountUsage } from "@/lib/accountPlan";
import type { AcsUser } from "./SettingsProvider";

// The payload shapes live in lib/accountPlan.ts — ONE description of what the billing and brain
// authorities send, shared with lib/entitlementStore.ts. These aliases keep the panel's existing
// `Acs*` vocabulary without a second, drifting copy of the contract.
export type AcsLane = AccountLane;
export type AcsQuotas = AccountQuotas;
export type AcsPlan = AccountPlan;
export type AcsUsage = AccountUsage;

/** What every section receives from the panel. */
export interface SectionProps {
  t: (key: string, fallback?: string) => string;
  lang: "en" | "zh";
  /** The shell's resolved identity. This — not `email` — is what an owner-scoped store keys on. */
  identity: AccountIdentity;
  /** Display / routing address, derived from `identity`. "" for a guest. Never an owner key. */
  email: string;
  user: AcsUser | null;
  onClose: () => void;
  /** Merge a user_metadata patch into the cached user after a successful save. */
  onPatchMeta: (patch: Record<string, unknown>) => void;
  onRefreshUser: () => Promise<void>;
}

/** Locale-aware date, matching the macro dashboard's `_sdDate`. */
export function acsDate(iso: string | null | undefined, lang: "en" | "zh"): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Settings keys off the RAW /api/me tier (the panel pipes the gateway payload
 * through verbatim and narrows nothing), so the raw→effective aliasing that
 * lib/subscriptionTier.ts does for the chart has to happen here too.
 *
 * `essential` is now the canonical name on both sides. `insider` was the old name
 * for the SAME entitlement and stays ACCEPTED INBOUND FOREVER — a cached page or a
 * pre-rename payload can still carry it, and without the alias that subscriber's
 * Billing tab reads "Free" — wrong label, wrong feature list, no price line, wrong
 * upgrade CTA — while still being charged. Inbound-only: nothing writes it back.
 *
 * `unlimited` is deliberately NOT folded into `pro` here: the label/feature/CTA
 * helpers each treat it distinctly (a lifetime grant has nothing left to buy).
 */
export function acsNormalizeTier(tier: string | undefined): string {
  return tier === "insider" ? "essential" : tier || "free";
}

/** Tier → display label key. Unlimited reads as Pro (it is an uncapped Pro). */
export function acsTierLabelKey(tier: string | undefined): string {
  const tr = acsNormalizeTier(tier);
  if (tr === "pro" || tr === "unlimited") return "acsTierPro";
  if (tr === "essential") return "acsTierInsider";
  return "acsTierFree";
}

/**
 * Per-month display price by tier+interval, mirroring the macro dashboard's
 * SD_PRICE (and config/plans.yml). Billing-hero DECORATION ONLY — never a gate.
 * The upgrade sheet owns the real pricing; this exists so the hero can say what
 * the user is paying without a second network call.
 */
export const ACS_PRICE: Record<string, { monthly: number; annual: number; annualYr: number }> = {
  essential: { monthly: 69, annual: 49, annualYr: 588 },
  pro: { monthly: 99, annual: 69, annualYr: 828 },
};

/**
 * Plain-word plan highlights for Billing's "Your plan includes".
 * Decorative only (never a gate).
 *
 * NOTE — upstream bug fixed here: the macro table has no `unlimited` key, so
 * `SD_PLAN_FEATURES[tier] || SD_PLAN_FEATURES.free` silently showed unlimited
 * users the FREE feature list. Unlimited maps to the Pro list, which is what it
 * actually grants.
 */
export const ACS_PLAN_FEATURES: Record<string, string[]> = {
  free: ["acsFeatFree1", "acsFeatFree2", "acsFeatFree3", "acsFeatFree4"],
  essential: ["acsFeatInsider1", "acsFeatInsider2", "acsFeatInsider3", "acsFeatInsider4"],
  pro: ["acsFeatPro1", "acsFeatPro2", "acsFeatPro3", "acsFeatPro4"],
  unlimited: ["acsFeatPro1", "acsFeatPro2", "acsFeatPro3", "acsFeatPro4"],
};

/**
 * Where an upgrade goes.
 *
 * A free user is choosing a plan for the first time — the Terminal's own
 * onboarding sheet does that natively, so it stays in-app (operator default:
 * Pro / annual preselected).
 *
 * Every other move (Essential → Pro, monthly → annual) is a CHANGE to a live
 * subscription with proration, which the Terminal's sheet cannot perform: only
 * the landing's upgrade flow talks to that gateway lane. Those open the landing
 * in a new tab rather than pretending in-app.
 */
export const ACS_UPGRADE_URL = "https://www.mastermind-x.com/index.html?upgrade=1";

export function acsUpgradeIsInApp(tier: string | undefined): boolean {
  return acsNormalizeTier(tier) === "free";
}

/** The CTA label for a tier+interval, or null when nothing is left to buy. */
export function acsUpgradeLabelKey(
  tier: string | undefined,
  interval: string | null | undefined,
): string | null {
  const tr = acsNormalizeTier(tier);
  if (tr === "unlimited") return null;
  if (tr === "pro" && interval === "annual") return null;
  if (tr === "free") return "acsChoosePlan";
  if (tr === "essential") return "acsUpgradePro";
  return "acsSwitchAnnual";
}

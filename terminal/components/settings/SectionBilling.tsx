"use client";
import { useState } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { Group, IconCheck, IconExtLink, Msg, Row, SectionHead } from "./icons";
import {
  ACS_PLAN_FEATURES, ACS_PRICE, ACS_UPGRADE_URL, acsDate, acsNormalizeTier,
  acsTierLabelKey, acsUpgradeIsInApp, acsUpgradeLabelKey, type AcsPlan, type SectionProps,
} from "./types";

// ── Billing ──────────────────────────────────────────────────────────────────
// Ported from the macro dashboard's `_renderSDBilling` / `_sdPlanHeroHTML` /
// `_sdPlanChip` / `_sdOpenPortal`.

export interface BillingProps extends SectionProps {
  plan: AcsPlan | null;
  /** The authority could not be reached AND this owner has nothing verified to fall back on. */
  planErr: boolean;
  /** `plan` is a SAME-OWNER last-good, not a fresh verification. Say so; never pass it off as
   *  current, and never quietly downgrade the customer to Free instead of showing it. */
  planStale: boolean;
  onRefreshPlan: () => void;
}

/** Status chip — ported verbatim from `_sdPlanChip`. */
function PlanChip({ plan, t, lang, now }: { plan: AcsPlan; t: SectionProps["t"]; lang: "en" | "zh"; now: number }) {
  const status = plan.status || "none";
  const cpe = plan.current_period_end || null;
  const when = cpe ? acsDate(cpe, lang) : "";

  // A comp / uncapped grant with no period end is a lifetime plan.
  if ((plan.tier === "unlimited" || plan.source === "comp") && !cpe && status !== "canceled") {
    return <span className="acs-plan-chip live">{t("acsPlanLifetime")}</span>;
  }
  if (status === "trialing") {
    return <span className="acs-plan-chip trial">{`${t("acsPlanTrialUntil")}${when ? ` ${when}` : ""}`}</span>;
  }
  if (status === "active") {
    return <span className="acs-plan-chip live">{`${t("acsPlanRenews")}${when ? ` ${when}` : ""}`}</span>;
  }
  if (status === "canceled") {
    // Still inside the paid period → show the end date; past it → just "Expired".
    const future = !!cpe && new Date(cpe).getTime() > now;
    return (
      <span className="acs-plan-chip warn">
        {future ? `${t("acsPlanExpires")}${when ? ` ${when}` : ""}` : t("acsPlanExpired")}
      </span>
    );
  }
  return null;
}

export default function SectionBilling({ t, lang, onClose, plan, planErr, planStale, onRefreshPlan }: BillingProps) {
  const onboarding = useOnboarding();
  // Captured once when the section mounts rather than read during render:
  // Date.now() is impure, and the chip does not need to tick.
  const [now] = useState(() => Date.now());
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState("");

  // The raw /api/me tier, aliased to the effective one before ANY lookup: the
  // ACS_PRICE / ACS_PLAN_FEATURES tables are keyed by effective tier, so an
  // un-aliased legacy `insider` would miss both (no price line, Free feature list).
  const tier = acsNormalizeTier(plan?.tier);
  const interval = plan?.interval || null;
  const paid = tier !== "free";
  const upgradeKey = acsUpgradeLabelKey(tier, interval);

  function upgrade() {
    if (acsUpgradeIsInApp(tier)) {
      // Free → first purchase: the Terminal's own sheet handles it natively.
      onClose();
      onboarding.open("signup", { plan: "pro", period: "annual" });
      return;
    }
    // Essential → Pro, or monthly → annual: a change to a LIVE subscription with
    // proration. The Terminal's sheet has no lane for that; the landing does.
    window.open(ACS_UPGRADE_URL, "_blank", "noopener");
  }

  async function openPortal() {
    setPortalBusy(true);
    setPortalMsg("");
    try {
      const r = await fetch("/api/billing/portal", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.url) { window.open(j.url as string, "_blank", "noopener"); return; }
        setPortalMsg(t("acsPortalErr"));
        return;
      }
      // 404 = no Stripe customer at all. Retrying can never fix that, so don't
      // say "please try again".
      setPortalMsg(t(r.status === 404 ? "acsPortalNone" : "acsPortalErr"));
    } catch {
      setPortalMsg(t("acsPortalErr"));
    } finally {
      setPortalBusy(false);
    }
  }

  const price = ACS_PRICE[tier];
  const feats = ACS_PLAN_FEATURES[tier] || ACS_PLAN_FEATURES.free;

  return (
    <>
      <SectionHead title={t("acsBilling")} sub={t("acsBillingSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {/* ── plan hero ── */}
        {!plan ? (
          planErr
            ? <div className="acs-note" style={{ textAlign: "center", padding: "30px 10px" }}>{t("acsErrGen")}</div>
            : <div className="acs-skel" style={{ height: 118, margin: "4px 0 14px" }} />
        ) : (
          <>
            <div className={`acs-plan-hero${paid ? "" : " free"}`}>
              <div className="acs-ph-top">
                <div>
                  <span className="acs-ph-eyebrow">{t("acsCurrentPlan")}</span>
                  <div className="acs-ph-name">{t(acsTierLabelKey(tier))}</div>
                </div>
                <PlanChip plan={plan} t={t} lang={lang} now={now} />
              </div>
              {paid && price && interval ? (
                <div className="acs-ph-price">
                  <b>{`$${interval === "annual" ? price.annual : price.monthly}`}</b>
                  {t("acsPerMo")}
                  {" · "}
                  {interval === "annual" ? (
                    <>
                      {t("acsBilledAnnual")}{" "}
                      <span className="acs-muted">{`($${price.annualYr}/yr)`}</span>
                    </>
                  ) : t("acsBilledMonthly")}
                </div>
              ) : paid ? null : (
                // A paid plan with no interval (a comp / lifetime grant) has no
                // price line at all — render nothing rather than an empty row.
                <div className="acs-ph-price">{t("acsFreePitch")}</div>
              )}
            </div>

            {/* A last-good plan is shown rather than withheld — a paying customer must not read
                "Free" because the billing gateway had a bad minute — but it is LABELLED, so the
                pane never passes an unverified answer off as current. */}
            {planStale && (
              <div className="acs-msg show wait" role="status">
                {t("acsPlanStale")}
                <button type="button" className="acs-msg-retry" onClick={onRefreshPlan}>{t("acsPrefRetry")}</button>
              </div>
            )}

            {upgradeKey && (
              <div className="acs-plan-cta">
                <button type="button" className="acs-btn primary" onClick={upgrade}>{t(upgradeKey)}</button>
              </div>
            )}
          </>
        )}

        {/* ── what the current plan includes ── */}
        <Group title={t("acsPlanIncludes")}>
          {feats.map((k) => (
            <div className="acs-incl-row" key={k}>
              <IconCheck />
              <span>{t(k)}</span>
            </div>
          ))}
        </Group>

        {/* ── payment & invoices, or the granted-access note ── */}
        {paid && (plan?.source || "stripe") === "stripe" ? (
          <Group>
            <Row
              label={t("acsManageBilling")}
              desc={t("acsManageBillingNote")}
              control={
                <button type="button" className="acs-link" onClick={openPortal} disabled={portalBusy}>
                  {portalBusy ? t("acsOpening") : t("acsOpenPortal")}
                  {portalBusy ? null : <IconExtLink />}
                </button>
              }
            />
            <Msg text={portalMsg} kind="err" />
          </Group>
        ) : paid ? (
          <Group>
            <Row label={t("acsGrantedPlan")} desc={t("acsGrantedNote")} />
          </Group>
        ) : null}
      </div>
    </>
  );
}

"use client";
import { useEffect, useRef } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { SectionHead } from "./icons";
import {
  ACS_UPGRADE_URL, acsUpgradeIsInApp, type AcsLane, type AcsPlan, type AcsQuotas,
  type AcsUsage, type SectionProps,
} from "./types";

// ── Usage ────────────────────────────────────────────────────────────────────
// Ported from the macro dashboard's `_renderSDUsage` / `_sdMeterHTML` /
// `_sdUsageNudge` / `_sdAnimateMeters`.
//
// Canonical source is GET /api/brain/me; it falls back to /api/me's chat_budget
// (already fetched with the plan) so the meters paint even if the brain endpoint
// misses.

export interface UsageProps extends SectionProps {
  plan: AcsPlan | null;
  usage: AcsUsage | null;
  /** Nothing same-owner is known for this account AND the brain gateway is unreachable. */
  usageErr: boolean;
  /** The meters are a SAME-OWNER last-good rather than a fresh read. Say so — a stale quota is
   *  the most misleading number on this pane, because the user spends it from inside this page. */
  usageStale: boolean;
}

function Meter({
  lane, labelKey, noteKey, t,
}: {
  lane: AcsLane | undefined;
  labelKey: string;
  noteKey: string;
  t: SectionProps["t"];
}) {
  const l = lane || {};
  const limit = typeof l.limit === "number" ? l.limit : 0;
  const remaining = typeof l.remaining === "number" ? l.remaining : 0;
  const period = l.period || "month";

  // uncapped tier
  if (limit < 0) {
    return (
      <div className="acs-meter unl">
        <div className="acs-meter-h"><span className="acs-meter-lbl">{t(labelKey)}</span></div>
        <div className="acs-meter-big"><span className="acs-meter-num">{t("acsUnlimited")}</span></div>
        <div className="acs-meter-foot">{`${t(noteKey)} ${t("acsUnlimitedNote")}`}</div>
      </div>
    );
  }
  // lane not included on this tier (e.g. deep research on Free) — upsell, no bar
  if (limit === 0) {
    return (
      <div className="acs-meter">
        <div className="acs-meter-h"><span className="acs-meter-lbl">{t(labelKey)}</span></div>
        <div className="acs-meter-foot" style={{ marginTop: 12 }}>
          {`${t(noteKey)} ${t("acsDeepLockedFree")}`}
        </div>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
  const ratio = remaining / limit;
  const cls = remaining <= 0 ? " out" : ratio <= 0.15 ? " low" : "";
  const capKey = period === "week" ? "acsCapWeek" : period === "trial" ? "acsCapTrial" : "acsCapMonth";
  const reset = period === "week" ? ` · ${t("acsResetsWeekly")}`
    : period === "trial" ? ""
    : ` · ${t("acsResetsMonthly")}`;

  return (
    <div className={`acs-meter${cls}`}>
      <div className="acs-meter-h">
        <span className="acs-meter-lbl">{t(labelKey)}</span>
        <span className="acs-meter-cap">{t(capKey)}</span>
      </div>
      <div className="acs-meter-big">
        <span className="acs-meter-num">{remaining}</span>
        <span className="acs-meter-of">{t("acsUsageLeft")}</span>
      </div>
      <div className="acs-meter-bar">
        <span className="acs-meter-fill" data-pct={pct} />
      </div>
      <div className="acs-meter-foot">{`${t("acsOfN").replace("{n}", String(limit))}${reset}`}</div>
    </div>
  );
}

export default function SectionUsage({ t, onClose, plan, usage, usageErr, usageStale }: UsageProps) {
  const onboarding = useOnboarding();
  const bodyRef = useRef<HTMLDivElement>(null);

  // The fallback into the plan's `chat_budget` is owner-scoped by construction now: `plan` comes
  // from the canonical entitlement store, which drops a payload outright on an owner change. It
  // used to come from an email-keyed cache in the panel, so the fallback could serve one
  // account's budget under another that arrived at the same address.
  const quotas: AcsQuotas | null = usage?.quotas || plan?.chat_budget || null;
  const tier = usage?.tier || plan?.tier || "free";
  // Only the LIVE lane can be stale; falling back to the plan's budget is a different (and
  // freshly-verified) source, so it is not labelled as an unrefreshed usage read.
  const stale = usageStale && !!usage?.quotas;

  // draw-on-reveal: start every fill at 0, then paint the targets on the second
  // frame so the width transition runs each time the tab is shown.
  useEffect(() => {
    if (!quotas) return;
    const els = bodyRef.current?.querySelectorAll<HTMLSpanElement>(".acs-meter-fill");
    if (!els || !els.length) return;
    els.forEach((el) => { el.style.width = "0"; });
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        els.forEach((el) => { el.style.width = `${el.getAttribute("data-pct") || "0"}%`; });
      });
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [quotas]);

  function upgrade() {
    if (acsUpgradeIsInApp(tier)) {
      onClose();
      onboarding.open("signup", { plan: "pro", period: "annual" });
      return;
    }
    window.open(ACS_UPGRADE_URL, "_blank", "noopener");
  }

  // nudge: never for pro/unlimited (they already carry the most questions)
  let nudge: { tKey: string; sKey: string } | null = null;
  if (quotas && tier !== "pro" && tier !== "unlimited") {
    const low = (["fast", "pro"] as const).some((k) => {
      const l = quotas[k] || {};
      return typeof l.limit === "number" && l.limit > 0
        && typeof l.remaining === "number" && l.remaining / l.limit <= 0.15;
    });
    if (low) nudge = { tKey: "acsNudgeLowT", sKey: "acsNudgeLowS" };
    else if (tier === "free") nudge = { tKey: "acsNudgeGetT", sKey: "acsNudgeGetS" };
  }

  return (
    <>
      <SectionHead title={t("acsUsage")} sub={t("acsUsageSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body" ref={bodyRef}>
        {!quotas ? (
          usageErr ? (
            <div className="acs-note" style={{ textAlign: "center", padding: "30px 10px" }}>{t("acsUsageErr")}</div>
          ) : (
            <div className="acs-grid"><div className="acs-skel" /><div className="acs-skel" /></div>
          )
        ) : (
          <>
            <div className="acs-grid">
              <Meter lane={quotas.fast} labelKey="acsChatLane" noteKey="acsChatLaneNote" t={t} />
              <Meter lane={quotas.pro} labelKey="acsDeepLane" noteKey="acsDeepLaneNote" t={t} />
            </div>
            {stale && (
              <div className="acs-msg show wait" role="status">{t("acsUsageStale")}</div>
            )}
            {nudge && (
              <div className="acs-nudge">
                <div className="acs-nudge-main">
                  <div className="acs-nudge-t">{t(nudge.tKey)}</div>
                  <div className="acs-nudge-s">{t(nudge.sKey)}</div>
                </div>
                <button type="button" className="acs-btn primary" onClick={upgrade}>{t("acsUpgrade")}</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

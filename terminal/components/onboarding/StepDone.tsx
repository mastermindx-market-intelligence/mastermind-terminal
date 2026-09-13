"use client";
import { useLang, useT } from "@/lib/i18n";
import { selectDoneBillingLine } from "@/lib/billingReceipt";
import type { PlanKey } from "./types";

export interface StepDoneProps {
  firstName: string;
  email: string;
  confirmPending: boolean;
  /** W2: an in-sheet Stripe trial started. Drives the "trial is live" body line. */
  trialActive: boolean;
  /** W2: epoch seconds of the first charge (from subscribe/complete), or null. */
  trialEnd: number | null;
  /** The paid tier the trial is on (only meaningful when trialActive). */
  plan: PlanKey;
  /** Fix round 1 (BLOCKER-1): a genuine no-trial purchase completed this session (essential,
   *  plans.yml trial_days: 0). Charged, plan live, never combined with trialActive. */
  planActivated?: boolean;
  /** D5: the preference write has not been acknowledged yet. Onboarding still completes — the
   *  outbox retries in the background — but the screen may not imply the choice is stored. */
  prefsPending?: boolean;
}

// Localized "Month Day" from an epoch-seconds trial_end.
//
// D7: this used to fall back to `now + 7 days` when trial_end was null — a locally INVENTED billing
// date, printed with the same confidence as a real one, on a screen whose entire job is to tell the
// user when they will first be charged. The date now comes only from the authority.
function fmtTrialDate(trialEnd: number, lang: string): string {
  return new Date(trialEnd * 1000)
    .toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { month: "long", day: "numeric" });
}

// Fix round 1 (MINOR-1): a trial_end that has already elapsed must never print as an UPCOMING
// charge date — a skewed value (or simply the passage of time since it was recorded) would
// otherwise render a past date as fact. `now` is a parameter so tests can pin both sides of the
// boundary without a frozen system clock.
function isUpcoming(trialEnd: number, now: number): boolean {
  return trialEnd * 1000 > now;
}

export default function StepDone({ firstName, email, confirmPending, trialActive, trialEnd, plan, planActivated, prefsPending }: StepDoneProps) {
  const t = useT();
  const { lang } = useLang();
  const name = firstName.trim();
  const title = name
    ? t("obDoneTitleNamed").replace("{firstName}", name)
    : t("obDoneTitle");

  const tierName = plan === "essential" ? t("obPlanInsider") : plan === "pro" ? t("obPlanPro") : "";
  // Round 2 review (MINOR-2): planActivated can only be set true by a completed purchase POST
  // (OnboardingSheet's billingPurchaseActive), so — unlike the generic "ready" line below — it is
  // trustworthy even while confirmPending (unconfirmed email) is still true. See
  // lib/billingReceipt.ts's selectDoneBillingLine for the full rationale.
  const doneLine = selectDoneBillingLine({ trialActive, planActivated, confirmPending });

  return (
    <div className="ob-fade">
      <div className="ob-done">
        <div className="ob-done-mark">
          <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="ob-h1" data-ob-heading tabIndex={-1} style={{ margin: 0 }}>{title}</h1>
        <div className="ob-done-body">
          {confirmPending && (
            <p className="ob-done-line">
              {t("obDoneConfirm").replace("{email}", email || "your inbox")}
            </p>
          )}
          {doneLine === "trial" && (
            <p className="ob-done-line">
              {trialEnd != null && isUpcoming(trialEnd, Date.now())
                ? t("obDoneTrial")
                    .replace("{tier}", tierName)
                    .replace("{date}", fmtTrialDate(trialEnd, lang))
                // No authority-supplied date, or the supplied date has already passed: say the
                // trial is live and point at Settings → Billing, rather than manufacturing or
                // printing a stale billing date as fact.
                : t("obDoneTrialNoDate").replace("{tier}", tierName)}
            </p>
          )}
          {/* Fix round 1 (BLOCKER-1): a genuine no-trial purchase (e.g. essential) — charged,
              plan live, no trial to claim. Distinct from the generic "desk is set" line so the
              screen actually confirms the purchase. Round 2 (MINOR-2): shown regardless of
              confirmPending — see selectDoneBillingLine. */}
          {doneLine === "planActive" && (
            <p className="ob-done-line">{t("obDonePlanActive").replace("{tier}", tierName)}</p>
          )}
          {doneLine === "ready" && (
            <p className="ob-done-line">{t("obDoneReady")}</p>
          )}
          {/* D5 — quiet, honest, and not a blocker: the account is ready either way, but the flow
              does not get to imply the preferences landed when the authority hasn't confirmed it.
              The outbox keeps retrying, so this is a status, not an error the user must act on. */}
          {prefsPending && (
            <p className="ob-done-line ob-done-pending" data-testid="prefs-pending">{t("obDonePrefsSyncing")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Footer for Step 4.
export function StepDoneFooter({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <>
      <div className="ob-foot-spacer" />
      <button type="button" className="ob-btn" onClick={onClose}>{t("obOpenTerminal")}</button>
    </>
  );
}

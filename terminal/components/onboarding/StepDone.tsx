"use client";
import { useLang, useT } from "@/lib/i18n";
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
  /** D5: the preference write has not been acknowledged yet. Onboarding still completes — the
   *  outbox retries in the background — but the screen may not imply the choice is stored. */
  prefsPending?: boolean;
}

// Localized "Month Day" from an epoch-seconds trial_end.
function fmtTrialDate(trialEnd: number | null, lang: string): string {
  const d = trialEnd != null ? new Date(trialEnd * 1000) : (() => { const x = new Date(); x.setDate(x.getDate() + 7); return x; })();
  return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { month: "long", day: "numeric" });
}

export default function StepDone({ firstName, email, confirmPending, trialActive, trialEnd, plan, prefsPending }: StepDoneProps) {
  const t = useT();
  const { lang } = useLang();
  const name = firstName.trim();
  const title = name
    ? t("obDoneTitleNamed").replace("{firstName}", name)
    : t("obDoneTitle");

  const tierName = plan === "essential" ? t("obPlanInsider") : plan === "pro" ? t("obPlanPro") : "";

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
          {trialActive && (
            <p className="ob-done-line">
              {t("obDoneTrial")
                .replace("{tier}", tierName)
                .replace("{date}", fmtTrialDate(trialEnd, lang))}
            </p>
          )}
          {!confirmPending && !trialActive && (
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

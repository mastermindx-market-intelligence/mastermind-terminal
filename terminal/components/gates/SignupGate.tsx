"use client";

// Shown on the nine member workspaces (/today, /research, /monitor, /dislocations,
// /analysis, /discover, /scripts, /portfolio, /alerts) when the visitor is signed
// out — each page gates server-side and returns this instead of its workspace.
// The chart (/terminal) is deliberately NOT gated: guests get the full charting
// surface, and these are the surfaces that need an account to mean anything
// (saved lists, saved scripts, server-side alerts).
//
// Development exception: under the beta-runtime flag pair documented in
// lib/shared-shell/devOpen.ts (MMX_SHARED_SHELL=1 + MMX_SHARED_SHELL_DEV_OPEN=1),
// those pages render their workspaces for signed-out visitors and this gate never
// mounts. Production declares no MMX_* environment variables.
//
// Guest and account-recovery states share one responsive, theme-aware surface.
// The existing session and onboarding owners retain all authentication behavior.
// Bilingual via LEX t().
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recoverMemberSession, type RecoveryResult } from "@/lib/supabase/sessionRecovery";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useLang } from "@/lib/i18n";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { pick } from "@/lib/finFormat";
import styles from "./MemberGate.module.css";

export type GateSurface = "today" | "research" | "monitor" | "analysis" | "discover" | "scripts" | "portfolio" | "alerts" | "dislocations";

// surface → [title key, body key]. Kept as data so a new gated workspace is one row.
const COPY: Record<GateSurface, [string, string]> = {
  today: ["sgTitleToday", "sgBodyToday"],
  research: ["sgTitleResearch", "sgBodyResearch"],
  monitor: ["sgTitleMonitor", "sgBodyMonitor"],
  analysis: ["sgTitleAnalysis", "sgBodyAnalysis"],
  discover: ["sgTitleDiscover", "sgBodyDiscover"],
  scripts: ["sgTitleScripts", "sgBodyScripts"],
  portfolio: ["sgTitlePortfolio", "sgBodyPortfolio"],
  alerts: ["sgTitleAlerts", "sgBodyAlerts"],
  dislocations: ["sgTitleDislocations", "sgBodyDislocations"],
};

export default function SignupGate({ surface }: { surface: GateSurface }) {
  const t = useSharedShellT();
  const { lang } = useLang();
  const onboarding = useOnboarding();
  const [titleKey, bodyKey] = COPY[surface];
  const features = [t("sgF1"), t("sgF2"), t("sgF3"), t("sgF4")];
  const [recovery, setRecovery] = useState<RecoveryResult | "checking">("checking");
  const checkSession = useCallback(async (manualRetry = false) => {
    if (manualRetry) setRecovery("checking");
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* privacy-restricted browser */ }
    const status = await recoverMemberSession({
      cookieHeader: document.cookie,
      verify: async () => {
        const { data, error } = await createClient().auth.getUser();
        return { user: !!data.user, error };
      },
      navigate: () => window.location.reload(),
      storage,
      manualRetry,
    });
    setRecovery(status);
  }, []);
  useEffect(() => { void Promise.resolve().then(() => checkSession()); }, [checkSession]);
  if (recovery !== "guest") {
    return (
      <main id="shared-shell-content" tabIndex={-1} className={styles.viewport}>
        <div role="status" aria-live="polite" className={`${styles.card} ${styles.stateCard}`}>
          <h1 className={styles.title}>{recovery === "unavailable" ? pick(lang === "zh", "We couldn’t verify your session", "暂时无法验证您的登录状态") : pick(lang === "zh", "Restoring your account…", "正在恢复账户登录状态…")}</h1>
          <p className={styles.body}>{pick(lang === "zh", "We can’t tell whether your session is still valid. Your research stays protected until verification succeeds.", "暂时无法确认登录状态是否有效。验证成功前，您的研究内容仍受到保护。")}</p>
          {recovery === "unavailable" && (
            <div className={styles.actions}>
              <button type="button" className={`btn btn-primary ${styles.action}`} onClick={() => { void checkSession(true); }}>{pick(lang === "zh", "Try again", "重试")}</button>
              <button type="button" className={`${styles.action} ${styles.secondary}`} onClick={() => onboarding.open("signin")}>{t("sgSignin")}</button>
            </div>
          )}
        </div>
      </main>
    );
  }
  return (
    <main id="shared-shell-content" tabIndex={-1} className={styles.viewport}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>{t("sgEyebrow")}</div>
        <h1 className={styles.title}>{t(titleKey)}</h1>
        <p className={styles.body}>{t(bodyKey)}</p>
        <ul className={styles.features}>
          {features.map((f, i) => (
            <li key={i}>
              <svg className={styles.featureIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m5 12 4 4L19 6" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" onClick={() => onboarding.open("signup")} className={`btn btn-primary ${styles.action}`}>
            {t("sgCta")}
          </button>
          <button type="button" onClick={() => onboarding.open("signin")} className={`${styles.action} ${styles.secondary}`}>
            {t("sgSignin")}
          </button>
        </div>
      </div>
    </main>
  );
}

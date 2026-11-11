"use client";

// Shown at /options when the caller lacks the `terminal_live_options` entitlement
// (options/page.tsx gates server-side via hasLiveOptions). The data API already
// 403s, so this replaces the would-be-empty workspace with a clear upgrade prompt.
// Access states use the incumbent theme tokens and a bounded scrolling surface.
// The existing entitlement and session owners retain all access decisions.
import { useCallback, useEffect, useState } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useLang, useT } from "@/lib/i18n";
import { pick } from "@/lib/finFormat";
import { createClient } from "@/lib/supabase/client";
import { recoverMemberSession, type RecoveryResult } from "@/lib/supabase/sessionRecovery";
import styles from "./OptionsAccess.module.css";

export default function OptionsPaywall({ verifySession = false }: { verifySession?: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const onboarding = useOnboarding();
  const [recovery, setRecovery] = useState<RecoveryResult | "checking">(verifySession ? "checking" : "guest");
  const checkSession = useCallback(async (manualRetry = false) => {
    if (!verifySession) return;
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
  }, [verifySession]);
  useEffect(() => {
    if (verifySession) void Promise.resolve().then(() => checkSession());
  }, [checkSession, verifySession]);

  // Only an actual guest or server-confirmed non-entitlement sees plans. A
  // cookie-bearing account being restored never gets a temporary upgrade pitch.
  if (verifySession && recovery !== "guest") {
    const unavailable = recovery === "unavailable";
    return (
      <main id="shared-shell-content" tabIndex={-1} className={styles.viewport}>
        <div role="status" aria-live="polite" className={styles.card}>
          <h1 className={styles.title}>
            {unavailable
              ? pick(lang === "zh", "Unable to verify account access", "暂时无法验证账户权限")
              : pick(lang === "zh", "Restoring account access…", "正在恢复账户权限…")}
          </h1>
          <p className={styles.body}>
            {pick(lang === "zh", "Protected features remain unavailable until your session is verified.", "账户验证完成前，受保护的功能保持关闭。")}
          </p>
          {unavailable && (
            <button type="button" onClick={() => { void checkSession(true); }} className={`btn btn-primary ${styles.action}`}>
              {t("errTryAgain")}
            </button>
          )}
        </div>
      </main>
    );
  }
  const features = [t("opwF1"), t("opwF2"), t("opwF3"), t("opwF4")];
  return (
    <main id="shared-shell-content" tabIndex={-1} className={styles.viewport}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>{t("opwPlans")}</div>
        <h1 className={styles.title}>{t("opwTitle")}</h1>
        <p className={styles.body}>{t("opwBody")}</p>
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
        <button type="button" onClick={() => onboarding.open("signup", { plan: "essential" })} className={`btn btn-primary ${styles.action}`}>
          {t("opwCta")}
        </button>
        <p className={styles.footnote}>{t("opwSub")}</p>
      </div>
    </main>
  );
}

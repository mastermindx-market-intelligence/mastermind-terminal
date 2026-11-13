"use client";

// Shown at /options when the caller lacks the `terminal_live_options` entitlement
// (options/page.tsx gates server-side via hasLiveOptions). The data API already
// 403s, so this replaces the would-be-empty workspace with a clear upgrade prompt.
// Access states use the incumbent theme tokens and a bounded scrolling surface.
// The existing entitlement and session owners retain all access decisions.
//
// `variant` selects ONLY the product copy (ruling D10): /prophet and
// /prophet/evaluation are gated by the same entitlement but must pitch Prophet,
// not name a different product. The entitlement check, tiers, server gate and
// 401/403 behavior are identical for both variants; "options" is the default so
// every existing call site keeps its wording untouched. The Prophet copy lives
// in prophetGateStrings.ts (desk-local, like prophetSectorStrings.ts) so the
// global LEX bytes — pinned by 17 evidence packets — stay untouched.
import { useCallback, useEffect, useState } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { getProphetGateStr } from "@/components/prophet/prophetGateStrings";
import { useLang, useT } from "@/lib/i18n";
import { pick } from "@/lib/finFormat";
import { createClient } from "@/lib/supabase/client";
import { recoverMemberSession, type RecoveryResult } from "@/lib/supabase/sessionRecovery";
import styles from "./OptionsAccess.module.css";

type PaywallVariant = "options" | "prophet";

export default function OptionsPaywall({
  verifySession = false,
  variant = "options",
}: {
  verifySession?: boolean;
  variant?: PaywallVariant;
}) {
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
  // Product copy only (ruling D10) — the plan eyebrow, CTA and sub line below
  // stay the shared keys; the entitlement decision lives entirely upstream.
  const copy = variant === "prophet"
    ? {
      title: getProphetGateStr(lang, "title"), body: getProphetGateStr(lang, "body"),
      features: (["f1", "f2", "f3", "f4"] as const).map(k => getProphetGateStr(lang, k)),
    }
    : { title: t("opwTitle"), body: t("opwBody"), features: [t("opwF1"), t("opwF2"), t("opwF3"), t("opwF4")] };
  return (
    <main id="shared-shell-content" tabIndex={-1} className={styles.viewport}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>{t("opwPlans")}</div>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.body}>{copy.body}</p>
        <ul className={styles.features}>
          {copy.features.map((f, i) => (
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

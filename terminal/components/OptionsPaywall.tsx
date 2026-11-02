"use client";

// Shown at /options when the caller lacks the `terminal_live_options` entitlement
// (options/page.tsx gates server-side via hasLiveOptions). The data API already
// 403s, so this replaces the would-be-empty workspace with a clear upgrade prompt.
// Matches the locked v5 idiom — panel/line tokens + the brand-blue accent
// (--brand / --brand-2, the app's primary action colour). Bilingual via LEX t().
import { useCallback, useEffect, useState } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useLang, useT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { recoverMemberSession, type RecoveryResult } from "@/lib/supabase/sessionRecovery";

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
      <main id="shared-shell-content" tabIndex={-1} style={{ display: "flex", minHeight: "100%", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div role="status" aria-live="polite" style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 19, marginBottom: 10 }}>
            {lang === "zh"
              ? (unavailable ? "暂时无法验证账户权限" : "正在恢复账户权限…")
              : (unavailable ? "Unable to verify account access" : "Restoring account access…")}
          </h1>
          <p style={{ fontSize: 13, opacity: .75, lineHeight: 1.6 }}>
            {lang === "zh" ? "账户验证完成前，受保护的功能保持关闭。" : "Protected features remain unavailable until your session is verified."}
          </p>
          {unavailable && (
            <button type="button" onClick={() => { void checkSession(true); }}
              style={{ padding: "10px 16px", background: "var(--brand)", border: 0, borderRadius: 6, color: "white", cursor: "pointer" }}>
              {lang === "zh" ? "重试" : "Try again"}
            </button>
          )}
        </div>
      </main>
    );
  }
  const features = [t("opwF1"), t("opwF2"), t("opwF3"), t("opwF4")];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100%", padding: "48px 20px" }}>
      <div style={{ maxWidth: 440, width: "100%", background: "var(--panel-3)", border: "1px solid var(--line-3)", borderRadius: "var(--r-md)", padding: "26px 24px", textAlign: "center", boxShadow: "0 16px 48px -18px rgba(0,0,0,.7)" }}>
        <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--brand-2)", fontWeight: 700, marginBottom: 12 }}>{t("opwPlans")}</div>
        <h1 style={{ fontSize: 20, fontWeight: 750, color: "var(--text)", margin: "0 0 8px", lineHeight: 1.25 }}>{t("opwTitle")}</h1>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)", opacity: 0.68, margin: "0 0 20px" }}>{t("opwBody")}</p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 22px", display: "grid", gap: 9, textAlign: "left" }}>
          {features.map((f, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--text)" }}>
              <span aria-hidden="true" style={{ color: "var(--brand-2)", flex: "none", fontSize: 11 }}>✦</span>
              {f}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => onboarding.open("signup", { plan: "essential" })}
          style={{ width: "100%", padding: "11px 16px", background: "var(--brand)", color: "#fff", border: "none", borderRadius: "var(--r-md)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
        >{t("opwCta")}</button>
        <p style={{ fontSize: 11.5, color: "var(--text)", opacity: 0.5, margin: "12px 0 0" }}>{t("opwSub")}</p>
      </div>
    </div>
  );
}

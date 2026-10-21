"use client";

// Shown on the six member workspaces (/dislocations, /analysis, /discover, /scripts, /portfolio,
// /alerts) when the visitor is signed out — each page gates server-side and returns
// this instead of its workspace. The chart (/terminal) is deliberately NOT gated:
// guests get the full charting surface, and these are the surfaces that need an
// account to mean anything (saved lists, saved scripts, server-side alerts).
//
// Deliberately the same card as components/OptionsPaywall.tsx — one gate shape for
// the whole app, only the copy and the CTA target differ (free account here, the
// Essential/Pro paywall there). Matches the locked v5 idiom — panel/line tokens + the
// brand-blue accent. Bilingual via LEX t().
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recoverMemberSession, type RecoveryResult } from "@/lib/supabase/sessionRecovery";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useLang, useT } from "@/lib/i18n";
import { pick } from "@/lib/finFormat";

export type GateSurface = "analysis" | "discover" | "scripts" | "portfolio" | "alerts" | "dislocations";

// surface → [title key, body key]. Kept as data so a new gated workspace is one row.
const COPY: Record<GateSurface, [string, string]> = {
  analysis: ["sgTitleAnalysis", "sgBodyAnalysis"],
  discover: ["sgTitleDiscover", "sgBodyDiscover"],
  scripts: ["sgTitleScripts", "sgBodyScripts"],
  portfolio: ["sgTitlePortfolio", "sgBodyPortfolio"],
  alerts: ["sgTitleAlerts", "sgBodyAlerts"],
  dislocations: ["sgTitleDislocations", "sgBodyDislocations"],
};

export default function SignupGate({ surface }: { surface: GateSurface }) {
  const t = useT();
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
      navigate: () => window.location.replace(window.location.href),
      storage,
      manualRetry,
    });
    setRecovery(status);
  }, []);
  useEffect(() => { void Promise.resolve().then(() => checkSession()); }, [checkSession]);
  if (recovery !== "guest") {
    return (
      <div role="status" aria-live="polite" style={{ display: "flex", minHeight: "100%", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 19, marginBottom: 10 }}>{recovery === "unavailable" ? pick(lang === "zh", "We couldn’t verify your session", "暂时无法验证您的登录状态") : pick(lang === "zh", "Restoring your account…", "正在恢复账户登录状态…")}</h1>
          <p style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.6 }}>{pick(lang === "zh", "We can’t tell whether your session is still valid. Your research stays protected until verification succeeds.", "暂时无法确认登录状态是否有效。验证成功前，您的研究内容仍受到保护。")}</p>
          {recovery === "unavailable" && (
            <button type="button" onClick={() => { void checkSession(true); }} style={{ padding: "10px 16px", background: "var(--brand)", border: 0, borderRadius: 6, color: "white", cursor: "pointer" }}>{pick(lang === "zh", "Try again", "重试")}</button>
          )}
          {recovery === "unavailable" && (
            <button type="button" onClick={() => onboarding.open("signin")} style={{ display: "block", margin: "12px auto", background: "none", color: "var(--brand-2)", border: 0, cursor: "pointer" }}>{t("sgSignin")}</button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100%", padding: "48px 20px" }}>
      <div style={{ maxWidth: 440, width: "100%", background: "var(--panel-3)", border: "1px solid var(--line-3)", borderRadius: "var(--r-md)", padding: "26px 24px", textAlign: "center", boxShadow: "0 16px 48px -18px rgba(0,0,0,.7)" }}>
        <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--brand-2)", fontWeight: 700, marginBottom: 12 }}>{t("sgEyebrow")}</div>
        <h1 style={{ fontSize: 20, fontWeight: 750, color: "var(--text)", margin: "0 0 8px", lineHeight: 1.25 }}>{t(titleKey)}</h1>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)", opacity: 0.68, margin: "0 0 20px" }}>{t(bodyKey)}</p>
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
          onClick={() => onboarding.open("signup")}
          style={{ width: "100%", padding: "11px 16px", background: "var(--brand)", color: "#fff", border: "none", borderRadius: "var(--r-md)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
        >{t("sgCta")}</button>
        <button
          type="button"
          onClick={() => onboarding.open("signin")}
          style={{ background: "none", border: "none", padding: 0, margin: "12px 0 0", fontSize: 11.5, color: "var(--brand-2)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
        >{t("sgSignin")}</button>
      </div>
    </div>
  );
}

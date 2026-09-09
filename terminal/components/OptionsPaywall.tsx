"use client";

// Shown at /options when the caller lacks the `terminal_live_options` entitlement
// (options/page.tsx gates server-side via hasLiveOptions). The data API already
// 403s, so this replaces the would-be-empty workspace with a clear upgrade prompt.
// Matches the locked v5 idiom — panel/line tokens + the brand-blue accent
// (--brand / --brand-2, the app's primary action colour). Bilingual via LEX t().
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useT } from "@/lib/i18n";

export default function OptionsPaywall() {
  const t = useT();
  const onboarding = useOnboarding();
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

"use client";
// Settings-dashboard dev harness — /dev/settings. Env-free (no Supabase), NOT under
// the authed /terminal layout, and production-gated like /dev/theater.
//
// The real panel needs a signed-in Supabase session, which local dev does not have,
// so this stage mounts the REAL SettingsPanel with a mock user and mock plan/usage
// payloads. Every section, every plan state and both languages are reachable here,
// which is how the panel's screenshots are taken.
//
// It deliberately drives the real component (not a copy): if a section's markup or
// token mapping regresses, this page shows it.

import { Suspense, useEffect, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import SettingsPanel from "@/components/settings/SettingsPanel";
import type { SettingsSection } from "@/components/settings/SettingsProvider";
import type { AcsUser } from "@/components/settings/SettingsProvider";
import type { AcsPlan, AcsUsage } from "@/components/settings/types";
import { applyLang } from "@/lib/i18n";
import { accountIdentity, GUEST_IDENTITY } from "@/lib/accountIdentity";

const MOCK_USER: AcsUser = {
  id: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22",
  email: "operator@mastermind-x.com",
  createdAt: "2026-02-14T09:12:00.000Z",
  lastSignInAt: "2026-07-29T06:41:00.000Z",
  provider: "google",
  meta: { display_name: "Chris Wong", trade_types: ["stocks", "options"] },
};

const PLANS: Record<string, AcsPlan> = {
  free: { tier: "free", status: "none" },
  "essential · trial": {
    tier: "essential", status: "trialing", interval: "monthly",
    current_period_end: "2026-08-12T00:00:00.000Z", source: "stripe",
  },
  // The pre-rename name for the SAME entitlement. Kept as its own fixture so the
  // inbound alias is VISUALLY provable: this row and "essential · trial" must render
  // an identical Billing tab (label, price line, feature list, upgrade CTA). A cached
  // page or an un-migrated payload can still send `insider` at any time.
  "insider · trial (legacy alias)": {
    tier: "insider", status: "trialing", interval: "monthly",
    current_period_end: "2026-08-12T00:00:00.000Z", source: "stripe",
  },
  "pro · monthly": {
    tier: "pro", status: "active", interval: "monthly",
    current_period_end: "2026-08-29T00:00:00.000Z", source: "stripe",
  },
  "pro · annual": {
    tier: "pro", status: "active", interval: "annual",
    current_period_end: "2027-07-29T00:00:00.000Z", source: "stripe",
  },
  "pro · canceled": {
    tier: "pro", status: "canceled", interval: "monthly",
    current_period_end: "2026-08-29T00:00:00.000Z", source: "stripe",
  },
  "unlimited (comp)": { tier: "unlimited", status: "active", source: "comp" },
};

const USAGE: Record<string, AcsUsage> = {
  free: { tier: "free", quotas: { fast: { remaining: 3, limit: 5, period: "week" }, pro: { remaining: 0, limit: 0 } } },
  low: { tier: "essential", quotas: { fast: { remaining: 24, limit: 300, period: "month" }, pro: { remaining: 1, limit: 10, period: "month" } } },
  healthy: { tier: "essential", quotas: { fast: { remaining: 212, limit: 300, period: "month" }, pro: { remaining: 8, limit: 10, period: "month" } } },
  unlimited: { tier: "pro", quotas: { fast: { remaining: 0, limit: -1 }, pro: { remaining: 96, limit: 150, period: "month" } } },
};

const SECTIONS: SettingsSection[] = ["account", "billing", "usage", "prefs", "terminal", "sync"];

const btn = (on: boolean): React.CSSProperties => ({
  font: "600 12px var(--font-ui)",
  color: on ? "#fff" : "var(--text-2)",
  background: on ? "var(--brand)" : "var(--panel-2)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
});

export default function SettingsHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Suspense><Harness /></Suspense>;
}

// Every control is also a URL parameter, so each screenshot in
// docs/pr-crops/settings-panel/ has one reproducible address:
//   /dev/settings?s=billing&plan=pro%20%C2%B7%20annual&usage=low&lang=zh
function Harness() {
  const q = useSearchParams();
  const [section, setSection] = useState<SettingsSection>(
    (SECTIONS.includes(q.get("s") as SettingsSection) ? q.get("s") : "account") as SettingsSection,
  );
  const [planKey, setPlanKey] = useState<string>(
    PLANS[q.get("plan") || ""] ? (q.get("plan") as string) : "free",
  );
  const [usageKey, setUsageKey] = useState<string>(
    USAGE[q.get("usage") || ""] ? (q.get("usage") as string) : "free",
  );
  const [signedIn, setSignedIn] = useState(q.get("out") !== "1");
  const [seq, setSeq] = useState(1);
  // Real open/close, so Escape / backdrop / the header X can be exercised here.
  const [open, setOpen] = useState(true);

  const wantLang = q.get("lang") === "zh" ? "zh" : "en";
  useEffect(() => { applyLang(wantLang); }, [wantLang]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: 20, fontFamily: "var(--font-ui)" }}>
      <div style={{ maxWidth: 940, margin: "0 auto" }}>
        <h1 style={{ font: "700 18px var(--font-ui)", margin: "0 0 4px" }}>Account settings — dev harness</h1>
        <p style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-2)", margin: "0 0 16px" }}>
          The real SettingsPanel with mock payloads. Production-gated.
        </p>

        {[
          { label: "Section", items: SECTIONS as string[], cur: section, set: (v: string) => setSection(v as SettingsSection) },
          { label: "Plan", items: Object.keys(PLANS), cur: planKey, set: setPlanKey },
          { label: "Usage", items: Object.keys(USAGE), cur: usageKey, set: setUsageKey },
        ].map((row) => (
          <div key={row.label} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <span style={{ font: "700 11px var(--font-ui)", color: "var(--muted)", width: 62 }}>{row.label}</span>
            {row.items.map((k) => (
              <button key={k} onClick={() => row.set(k)} style={btn(row.cur === k)}>{k}</button>
            ))}
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <span style={{ font: "700 11px var(--font-ui)", color: "var(--muted)", width: 62 }}>Other</span>
          <button onClick={() => applyLang("en")} style={btn(false)}>EN</button>
          <button onClick={() => applyLang("zh")} style={btn(false)}>中文</button>
          <button onClick={() => setSignedIn((s) => !s)} style={btn(signedIn)}>
            {signedIn ? "signed in" : "signed out"}
          </button>
          <button onClick={() => { setOpen(true); setSeq((n) => n + 1); }} style={btn(open)}>
            {open ? "open" : "reopen"}
          </button>
        </div>
      </div>

      <SettingsPanel
        visible={open}
        openSeq={seq}
        section={section}
        onSection={setSection}
        onClose={() => setOpen(false)}
        identity={signedIn ? accountIdentity(MOCK_USER.id, MOCK_USER.email) : GUEST_IDENTITY}
        user={signedIn ? MOCK_USER : null}
        onPatchMeta={() => {}}
        onRefreshUser={async () => {}}
        devPlan={PLANS[planKey]}
        devUsage={USAGE[usageKey]}
      />
    </div>
  );
}

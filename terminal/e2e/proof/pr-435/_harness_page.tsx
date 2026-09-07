// PR #435 (D7 billing-fail-closed) — MAJOR evidence-matrix harness.
//
// NOT part of the product. capture.mjs in this directory writes this file to
// `app/pr435proof/page.tsx` before starting a dev server, and deletes it (and the
// directory) again once the four PNGs are captured — it never stays committed under `app/`.
// This is the same "temporary local-only Next route" technique the prior round's PR body
// already described using to eyeball the render; the only change here is that the render is
// now saved to a committed PNG instead of only being looked at.
//
// It mounts the REAL production components (StepBilling, StepDone) under the REAL root layout
// (real onboarding.css/settings.css/globals.css, real LangProvider, real `data-theme="dark"` —
// nothing here re-themes or forks the CSS). Two of the three obBillErr* variants
// (obBillErr, obBillAlready) come from StepBilling's own `phase` state machine, driven by
// intercepting `/api/billing/config` and `/api/billing/subscribe/init` in capture.mjs (branched
// on the request body's `tier`, since both StepBilling instances share the page's fetch). The
// third (obBillErrUnknown) only renders from inside PaymentForm, a component private to
// StepBilling.tsx that is reached only after a live Stripe Elements mount — driving that for a
// screenshot would mean mocking Stripe's own SDK rather than this PR's code, so `ErrBanner` below
// reproduces PaymentForm's own error markup verbatim (`{err && <div className="ob-err">{err}</div>}`,
// the exact JSX in StepBilling.tsx) with the real translated string, and is labeled as such — not
// passed off as a live Stripe submission.
"use client";
import { useEffect, useState } from "react";
import { applyLang, useT } from "@/lib/i18n";
import StepBilling from "@/components/onboarding/StepBilling";
import StepDone from "@/components/onboarding/StepDone";

function ErrBanner() {
  // Verbatim reproduction of StepBilling.tsx's PaymentForm submit-error render
  // (`{err && <div className="ob-err">{err}</div>}`) with err = t("obBillErrUnknown").
  const t = useT();
  return (
    <form className="ob-bill-form">
      <div className="ob-err">{t("obBillErrUnknown")}</div>
    </form>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto 32px", border: "1px solid var(--line, #23262d)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", fontSize: 12, fontFamily: "var(--font-code, monospace)", color: "var(--text-dim, #8b93a3)", borderBottom: "1px solid var(--line, #23262d)" }}>
        {label}
      </div>
      <div className="ob-body" style={{ display: "block", padding: 20 }}>
        <div className="ob-pane" style={{ width: "100%" }}>
          <div className="ob-pane-scroll">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function PR435ProofPage() {
  const [lang, setLang] = useState<"en" | "zh">("en");
  useEffect(() => {
    const l = new URLSearchParams(window.location.search).get("lang") === "zh" ? "zh" : "en";
    setLang(l);
    applyLang(l);
  }, []);

  return (
    <div data-pr435-ready={lang} style={{ background: "var(--bg, #0a0b0d)", minHeight: "100vh", padding: "32px 16px" }}>
      {/* dev-only Next.js build-activity indicator (<nextjs-portal>) is fixed-position and gets
          baked into a fullPage screenshot at a scroll-relative offset — not product content,
          hidden for capture only. */}
      <style>{"nextjs-portal { display: none !important; }"}</style>
      <Panel label="StepBilling phase:&quot;error&quot; -> obBillErr">
        <StepBilling
          tier="essential" period="monthly" needsConfirmFirst={false}
          onTrialStarted={() => {}} onPurchaseActive={() => {}} onAlreadyActive={() => {}}
          onFree={() => {}} onContinueToDone={() => {}}
        />
      </Panel>
      <Panel label="StepBilling phase:&quot;already&quot; -> obBillAlready">
        <StepBilling
          tier="pro" period="monthly" needsConfirmFirst={false}
          onTrialStarted={() => {}} onPurchaseActive={() => {}} onAlreadyActive={() => {}}
          onFree={() => {}} onContinueToDone={() => {}}
        />
      </Panel>
      <Panel label="PaymentForm submit outcome:&quot;unknown&quot; -> obBillErrUnknown (reproduced, see file header)">
        <ErrBanner />
      </Panel>
      <Panel label="StepDone confirmPending + planActivated (MAJOR-1 this round fix)">
        <StepDone
          firstName="Alex" email="alex@example.com" confirmPending={true}
          trialActive={false} trialEnd={null} plan="essential" planActivated={true}
        />
      </Panel>
    </div>
  );
}

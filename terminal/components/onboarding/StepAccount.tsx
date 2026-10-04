"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n";
import { startGoogleOAuth } from "./oauth";
import type { OnboardMode, OnboardResumeStash, OnboardPrefs, PlanKey, Period } from "./types";

// Inline Google "G" mark (official 4-color).
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export interface StepAccountProps {
  mode: OnboardMode;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  plan: PlanKey;
  period: Period;
  prefs: OnboardPrefs;
  set: (patch: Partial<{ firstName: string; lastName: string; email: string; password: string }>) => void;
  onModeSwitch: (m: OnboardMode) => void;
  onConfirmPending: () => void; // signup with confirmation ON → advance but flag pending
  onAdvance: () => void;        // session issued → advance to step 2
}

function pwHintKey(pw: string): "obPwHintShort" | "obPwHintOk" | null {
  if (!pw) return null;
  if (pw.length < 8) return "obPwHintShort";
  return "obPwHintOk";
}

export default function StepAccount(p: StepAccountProps) {
  const t = useT();
  const router = useRouter();
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const signin = p.mode === "signin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setNotice("");
    const supabase = createClient();

    if (signin) {
      const { error } = await supabase.auth.signInWithPassword({ email: p.email, password: p.password });
      if (error) {
        setErr(error.code === "invalid_credentials" ? t("obSigninInvalid") : error.message);
        setBusy(false);
        return;
      }
      // Success → re-run the server component; the provider closes the sheet when
      // the fresh email prop lands. Keep busy until unmount (mirror AuthSheet).
      router.refresh();
      return;
    }

    // signup — stash first/last in user_metadata (trap-for-trap mirror of AuthSheet)
    const { data, error } = await supabase.auth.signUp({
      email: p.email,
      password: p.password,
      options: { data: { first_name: p.firstName, last_name: p.lastName } },
    });
    if (error) { setErr(error.message); setBusy(false); return; }
    if (data.session == null) {
      // TRAP: email-confirmation ON — no session. Advance to prefs but flag pending;
      // the provider applies stashed prefs after first sign-in.
      setBusy(false);
      p.onConfirmPending();
      return;
    }
    // session issued (confirmation OFF) → learn the email server-side, then advance.
    router.refresh();
    p.onAdvance();
  }

  async function requestPasswordReset() {
    const email = p.email.trim();
    setErr(""); setNotice("");
    if (!email) {
      setErr(t("obResetNeedEmail"));
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setBusy(false);
    if (error) {
      setErr(t("obResetError"));
      return;
    }
    // Deliberately generic: never disclose whether an address is registered.
    setNotice(t("obResetSent"));
  }

  async function google() {
    setBusy(true); setErr(""); setNotice("");
    const stash: OnboardResumeStash = {
      step: 2,
      firstName: p.firstName,
      lastName: p.lastName,
      plan: p.plan,
      period: p.period,
      prefs: p.prefs,
    };
    const { error } = await startGoogleOAuth(stash);
    if (error) { setErr(error); setBusy(false); }
    // On success the browser navigates away — no state change needed here.
  }

  const hintKey = pwHintKey(p.password);

  return (
    <div className="ob-fade">
      <h1 className="ob-h1" data-ob-heading tabIndex={-1}>
        {signin ? t("obSigninTitle") : t("obAccountTitle")}
      </h1>
      <p className="ob-sub">{signin ? t("obSigninSub") : t("obAccountSub")}</p>

      <form className="ob-form" onSubmit={submit}>
        {!signin && (
          <div className="ob-row2">
            <div className="ob-field-wrap">
              <label htmlFor="ob-fn">{t("obFirstName")}</label>
              <input id="ob-fn" className="ob-field" type="text" autoComplete="given-name"
                value={p.firstName} onChange={(e) => p.set({ firstName: e.target.value })} placeholder="Jordan" />
            </div>
            <div className="ob-field-wrap">
              <label htmlFor="ob-ln">{t("obLastName")}</label>
              <input id="ob-ln" className="ob-field" type="text" autoComplete="family-name"
                value={p.lastName} onChange={(e) => p.set({ lastName: e.target.value })} placeholder="Wei" />
            </div>
          </div>
        )}

        <label htmlFor="ob-email">{t("obEmail")}</label>
        <input id="ob-email" className="ob-field" type="email" required autoComplete="email"
          value={p.email} onChange={(e) => p.set({ email: e.target.value })} placeholder="you@example.com" />

        <label htmlFor="ob-pw">{t("obPassword")}</label>
        <input id="ob-pw" className="ob-field" type="password" required minLength={8}
          autoComplete={signin ? "current-password" : "new-password"}
          value={p.password} onChange={(e) => p.set({ password: e.target.value })} placeholder="••••••••" />
        {signin && (
          <button type="button" className="ob-link brand" data-testid="password-reset-request"
            style={{ marginTop: 8, alignSelf: "flex-start" }}
            onClick={requestPasswordReset} disabled={busy}>
            {t("obForgotPassword")}
          </button>
        )}
        {!signin && hintKey && (
          <p className={`ob-hint${hintKey === "obPwHintOk" ? " ok" : ""}`}>{t(hintKey)}</p>
        )}

        {err && <div className="ob-err" role="alert">{err}</div>}
        {notice && <div className="ob-hint ok" role="status">{notice}</div>}

        <button className="ob-btn wide" type="submit" disabled={busy} style={{ marginTop: 16 }}>
          {busy ? t("obBusy") : signin ? t("obSignin") : t("obCreateAccount")}
        </button>
      </form>

      <div className="ob-or">{t("obOr")}</div>

      <button type="button" className="ob-btn-out" onClick={google} disabled={busy}>
        <GoogleMark />
        {t("obContinueGoogle")}
      </button>

      {!signin && (
        <button type="button" className="ob-btn-out" disabled aria-disabled="true"
          style={{ marginTop: 10, cursor: "default" }}>
          {t("obAppleSoon")}
        </button>
      )}

      <button type="button" className="ob-link brand" style={{ marginTop: 16 }}
        onClick={() => p.onModeSwitch(signin ? "signup" : "signin")}>
        {signin ? t("obToSignup") : t("obToSignin")}
      </button>

      {!signin && <p className="ob-terms">{t("obTerms")}</p>}
    </div>
  );
}

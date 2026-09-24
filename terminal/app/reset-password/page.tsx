"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { useT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { updateAuthPassword } from "@/lib/passwordAuth";

type Phase = "checking" | "ready" | "saving" | "done" | "invalid";

export default function ResetPasswordPage() {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    void createClient().auth.getUser().then(({ data, error }) => {
      if (!live) return;
      setPhase(!error && data.user ? "ready" : "invalid");
    });
    return () => { live = false; };
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    if (password.length < 8) {
      setErr(t("pwResetShort"));
      return;
    }
    if (password !== confirm) {
      setErr(t("pwResetMismatch"));
      return;
    }

    setPhase("saving");
    const { error } = await updateAuthPassword(password);
    if (error) {
      setErr(t("pwResetFailed"));
      setPhase("ready");
      return;
    }
    setPassword("");
    setConfirm("");
    setPhase("done");
    router.refresh();
  }

  const brand = (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
      <Link href="/terminal"><BrandMark size={40} /></Link>
    </div>
  );

  if (phase === "checking") {
    return (
      <main className="center">
        <div className="authcard">
          {brand}
          <h2>{t("pwResetTitle")}</h2>
          <p className="sub" role="status">{t("pwResetChecking")}</p>
        </div>
      </main>
    );
  }

  if (phase === "invalid") {
    return (
      <main className="center">
        <div className="authcard">
          {brand}
          <h2>{t("pwResetTitle")}</h2>
          <p className="sub">{t("pwResetInvalid")}</p>
          <Link className="btn btn-primary" style={{ width: "100%", marginTop: 18 }} href="/terminal?signin=1">
            {t("obSignin")}
          </Link>
        </div>
      </main>
    );
  }

  if (phase === "done") {
    return (
      <main className="center">
        <div className="authcard">
          {brand}
          <h2>{t("pwResetSuccess")}</h2>
          <p className="sub" role="status">{t("pwResetSuccessSub")}</p>
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 18 }}
            onClick={() => router.replace("/terminal")}>
            {t("pwResetBack")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <form className="authcard" onSubmit={submit}>
        {brand}
        <h2>{t("pwResetTitle")}</h2>
        <p className="sub">{t("pwResetSub")}</p>

        <label htmlFor="reset-password">{t("pwResetNew")}</label>
        <input id="reset-password" className="field" type="password" required minLength={8}
          autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />

        <label htmlFor="reset-confirm">{t("pwResetConfirm")}</label>
        <input id="reset-confirm" className="field" type="password" required minLength={8}
          autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />

        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 18 }} disabled={phase === "saving"}>
          {phase === "saving" ? t("obBusy") : t("pwResetSubmit")}
        </button>
      </form>
    </main>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { BrandLockup } from "@/components/BrandMark";
import { useLang, useT } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { INVITE_MESSAGES, INVITE_TTL_DAYS } from "@/lib/teams";
import s from "./invite.module.css";

// The client half of /invite. Every sentence it can show is a catalogued [en, zh] pair — either a
// LEX key through t() or a route message from INVITE_MESSAGES — and the answer the accept call
// returns is preferred over any local guess, so a used, expired or wrong-address link reads as
// the reason the server gave rather than as a generic failure.

type Phase = "checking" | "signed-out" | "ready" | "busy" | "joined" | "failed" | "unavailable";

function pairFrom(body: unknown): [string, string] | null {
  const record = (body ?? {}) as { message?: unknown; messageZh?: unknown };
  const en = typeof record.message === "string" ? record.message : "";
  const zh = typeof record.messageZh === "string" ? record.messageZh : "";
  return en || zh ? [en, zh] : null;
}

export default function InviteAccept({ token }: { token: string | null }) {
  const t = useT();
  const { lang } = useLang();
  const idx = lang === "zh" ? 1 : 0;
  const [phase, setPhase] = useState<Phase>(token ? "checking" : "failed");
  const [note, setNote] = useState<[string, string] | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      let signedIn = false;
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        signedIn = Boolean(data?.user);
      } catch {
        // No reachable auth authority on this server: say that, never "the link is broken".
        if (!cancelled) setPhase("unavailable");
        return;
      }
      if (!cancelled) setPhase(signedIn ? "ready" : "signed-out");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = useCallback(async () => {
    if (!token) return;
    setPhase("busy");
    setNote(null);
    try {
      const res = await fetch("/api/teams/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", token }),
      });
      const body = await res.json().catch(() => ({}));
      const said = pairFrom(body);
      if (res.ok) {
        setNote(said);
        setPhase("joined");
        return;
      }
      setNote(said);
      setPhase(res.status === 401 ? "signed-out" : "failed");
    } catch {
      setNote(null);
      setPhase("failed");
    }
  }, [token]);

  const fallback: [string, string] = !token
    ? INVITE_MESSAGES.invalid_token
    : phase === "unavailable"
      ? INVITE_MESSAGES.unavailable
      : INVITE_MESSAGES.failed;
  const shown = note && (note[idx] || note[0]) ? note : fallback;
  const lifeLine = t("invLinkLife").replace("{days}", String(INVITE_TTL_DAYS));

  return (
    <main className={s.page}>
      <div className={s.card} data-testid="invite-card" data-phase={phase}>
        <div className={s.brand}>
          <BrandLockup />
        </div>
        <h1 className={s.title}>{t("invTitle")}</h1>
        <p className={s.intro}>{t("invIntro")}</p>

        {phase === "checking" ? (
          <p className={s.note} data-testid="invite-checking">{t("invChecking")}</p>
        ) : null}

        {phase === "signed-out" ? (
          <p className={s.note} data-testid="invite-signin">{INVITE_MESSAGES.not_signed_in[idx]}</p>
        ) : null}

        {phase === "joined" || phase === "failed" || phase === "unavailable" || !token ? (
          <p
            className={`${s.note}${phase === "joined" ? ` ${s.noteOk}` : ""}${phase === "failed" ? ` ${s.noteErr}` : ""}`}
            data-testid="invite-note"
          >
            {shown[idx] || shown[0]}
          </p>
        ) : null}

        <div className={s.actions}>
          {phase === "ready" || phase === "busy" ? (
            <button
              type="button"
              className={s.button}
              data-testid="invite-accept"
              disabled={phase === "busy"}
              onClick={() => void accept()}
            >
              {phase === "busy" ? t("invAccepting") : t("invAccept")}
            </button>
          ) : null}
          {phase === "signed-out" ? (
            <a className={s.button} href="/terminal?signin=1" data-testid="invite-signin-link">
              {t("invSignIn")}
            </a>
          ) : null}
          {phase === "joined" ? (
            <a className={s.buttonGhost} href="/terminal" data-testid="invite-open">
              {t("invOpenTerminal")}
            </a>
          ) : null}
        </div>

        {phase === "signed-out" ? (
          <p className={s.note} data-testid="invite-return">{t("invSignInReturn")}</p>
        ) : null}

        <p className={s.foot} data-testid="invite-link-life">{lifeLine}</p>
      </div>
    </main>
  );
}

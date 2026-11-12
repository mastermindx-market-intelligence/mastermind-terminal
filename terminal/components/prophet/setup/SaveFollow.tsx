"use client";
/**
 * SaveFollow — Save reuses the existing watchlist API (`POST /api/watchlist`,
 * action "add"): no new producer is built (reuse-first, census G11). Follow
 * has no change-feed producer today, so it opens the designed "alerts aren't
 * available here" state (T2-20 #8) instead of a preference sheet. The panels
 * below cover the T2-20 states: confirming → saved / not saved / signed out.
 * T2-20 exits (fix order item 11): a failed save offers Retry as the primary
 * action plus "Choose another list" (the shared Monitor surface owns lists);
 * a confirmed save offers "View saved list" and "Done", which dismisses the
 * panel while the save button stays satisfied.
 */
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { SHARED_SHELL_NAV } from "@/lib/sharedShellNavigation";
import { makeSetupT, setupFill } from "./setupStrings";
import styles from "./setup.module.css";

type SavePhase = "idle" | "working" | "saved" | "failed" | "signedOut";

/** The shared shell's monitor surface owns watchlists — never a new route. */
const MONITOR_HREF = SHARED_SHELL_NAV.find(item => item.k === "shellMonitor")?.href ?? "/monitor";

export function SaveFollow({ symbol }: { symbol: string }) {
  const { lang } = useLang();
  const t = makeSetupT(lang);
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [savedDismissed, setSavedDismissed] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);

  async function save() {
    if (phase === "working") return;
    setSavedDismissed(false);
    setPhase("working");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", symbol, section: "prophet" }),
      });
      if (res.status === 401) { setPhase("signedOut"); return; }
      setPhase(res.ok ? "saved" : "failed");
    } catch {
      setPhase("failed");
    }
  }

  return (
    <section className={styles.card} data-testid="save-follow">
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          data-testid="save-security"
          onClick={() => void save()}
          disabled={phase === "working" || phase === "saved"}
        >
          {phase === "working" ? t("saveWorking")
            : phase === "saved" ? t("saveDone")
            : t("saveAction")}
        </button>
        <button
          type="button"
          className={styles.ghostButton}
          data-testid="follow-changes"
          onClick={() => setFollowOpen((open) => !open)}
          aria-expanded={followOpen}
        >
          {t("followAction")}
        </button>
      </div>

      {phase === "working" ? (
        <p className={styles.unavailableNote}>{t("saveWorking")}</p>
      ) : null}
      {phase === "saved" && !savedDismissed ? (
        <div className={styles.resultPanel} data-testid="save-result" role="status">
          <p className={styles.resultTitle}>{t("saveSavedTitle")}</p>
          <p className={styles.resultBody}>{setupFill(t("saveSavedBody"), { symbol })}</p>
          <p className={styles.unavailableNote}>{t("saveSavedNote")}</p>
          <div className={styles.actions}>
            <a className={styles.ghostButton} href={MONITOR_HREF}>{t("saveViewList")}</a>
            <button type="button" className={styles.ghostButton} data-testid="save-done" onClick={() => setSavedDismissed(true)}>
              {t("saveDone")}
            </button>
          </div>
        </div>
      ) : null}
      {phase === "failed" ? (
        <div className={styles.resultPanel} data-testid="save-result" role="status">
          <p className={styles.resultTitle}>{t("saveFailedTitle")}</p>
          <p className={styles.resultBody}>{setupFill(t("saveFailedBody"), { symbol })}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => void save()}>
              {t("saveRetry")}
            </button>
            <a className={styles.ghostButton} href={MONITOR_HREF}>{t("saveChooseList")}</a>
          </div>
        </div>
      ) : null}
      {phase === "signedOut" ? (
        <div className={styles.resultPanel} data-testid="save-result" role="status">
          <p className={styles.resultBody}>{t("saveSignedOut")}</p>
        </div>
      ) : null}

      {followOpen ? (
        <div className={styles.resultPanel} data-testid="follow-panel">
          <p className={styles.resultTitle}>{t("followTitle")}</p>
          <p className={styles.resultBody}>{t("followBody")}</p>
          <p className={styles.unavailableNote}>{t("followNote")}</p>
          <div className={styles.actions}>
            {phase !== "saved" ? (
              <button type="button" className={styles.primaryButton} onClick={() => void save()} disabled={phase === "working"}>
                {t("saveAction")}
              </button>
            ) : null}
            <button type="button" className={styles.ghostButton} onClick={() => setFollowOpen(false)}>
              {t("followBack")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

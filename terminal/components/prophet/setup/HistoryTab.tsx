"use client";
/**
 * HistoryTab (G14) — assessment history and corrections are not published by
 * any wire, and the census records no mockup for this destination at any
 * width (§5). The tab ships so the case's destinations stay complete; its
 * content is the designed unavailable state, which is the contract — not a
 * placeholder timeline.
 */
import { useLang } from "@/lib/i18n";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

export function HistoryTab() {
  const { lang } = useLang();
  const t = makeSetupT(lang);
  return (
    <div className={styles.caseMain} data-testid="history-tab" role="tabpanel" id="case-panel-history" aria-labelledby="case-tab-history">
      <p className={styles.cardIntro} style={{ padding: "0 2px" }}>{t("historyIntro")}</p>
      <section className={styles.card} data-testid="history-panel">
        <span className={styles.badge}>{t("historyUnavailable")}</span>
        <p className={styles.unavailableBody}>{t("historyBody")}</p>
        <p className={styles.unavailableNote}>{t("historyDesignNote")}</p>
      </section>
    </div>
  );
}

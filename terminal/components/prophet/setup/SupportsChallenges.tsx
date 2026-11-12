"use client";
/**
 * SupportsChallenges — the case's balance sheet (G8). `supports[]`,
 * `challenges[]` and `nextCheck` are not served by any wire today, so both
 * columns and the next check render as designed unavailable states that name
 * what would be there. No invented evidence, no placeholder rows.
 */
import type { Lang } from "@/lib/i18n";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

export function SupportsChallenges({ lang }: { lang: Lang }) {
  const t = makeSetupT(lang);
  return (
    <div>
      <div className={styles.pairGrid} data-testid="supports-challenges">
        <section className={styles.pairCard} aria-label={t("supportsTitle")}>
          <h5 className={styles.pairTitle}>{t("supportsTitle")}</h5>
          <p className={styles.unavailableBody}>{t("scUnavailable")}</p>
          <p className={styles.unavailableNote}>{t("scListNote")}</p>
        </section>
        <section className={styles.pairCard} aria-label={t("challengesTitle")}>
          <h5 className={styles.pairTitle}>{t("challengesTitle")}</h5>
          <p className={styles.unavailableBody}>{t("scUnavailable")}</p>
          <p className={styles.unavailableNote}>{t("scListNote")}</p>
        </section>
      </div>
      <section className={styles.card} data-testid="next-check" style={{ marginTop: 10 }}>
        <h5 className={styles.pairTitle}>{t("nextCheckTitle")}</h5>
        <p className={styles.unavailableBody}>{t("nextCheckUnavailable")}</p>
      </section>
    </div>
  );
}

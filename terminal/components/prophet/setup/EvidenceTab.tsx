"use client";
/**
 * EvidenceTab (T2-04 / T2-16) — what is published and what this source does
 * not carry. The early-observation evidence block is the existing B03 renderer
 * (components/fin/ProphetObservationEvidence), reused read-only inside a
 * disclosure. Quarterly fundamentals and the information sequence are not
 * served: designed unavailable states, each naming what would be there (G12,
 * G13). The conclusion lives in the destination's rail (fix order item 7),
 * not as a third card here.
 */
import { useShellIdentity } from "@/components/chrome/AppShell";
import ProphetObservationEvidence from "@/components/fin/ProphetObservationEvidence";
import { identityUserId } from "@/lib/accountIdentity";
import { useLang } from "@/lib/i18n";
import { useProphetObservation } from "@/lib/useProphetObservation";
import { makeSetupT } from "./setupStrings";
import styles from "./setup.module.css";

/** Reads the observation source only for members whose join carries one. */
function ObservationEvidenceBlock({ symbol }: { symbol: string }) {
  const { lang } = useLang();
  const t = makeSetupT(lang);
  const identity = useShellIdentity();
  const account = identityUserId(identity) || null;
  const read = useProphetObservation(symbol, account);
  return (
    <details className={styles.card} data-testid="observation-evidence">
      <summary className={styles.pairTitle}>{t("observationEvidence")}</summary>
      <div className={styles.obsEvidence}>
        <ProphetObservationEvidence read={read} zh={lang === "zh"} />
      </div>
    </details>
  );
}

export function EvidenceTab({ symbol, showObservation }: { symbol: string; showObservation: boolean }) {
  const { lang } = useLang();
  const t = makeSetupT(lang);

  return (
    <div className={styles.caseMain} data-testid="evidence-tab" role="tabpanel" id="case-panel-evidence" aria-labelledby="case-tab-evidence">
      {showObservation ? <ObservationEvidenceBlock symbol={symbol} /> : null}

      <section className={styles.card} data-testid="evidence-fundamentals">
        <h4 className={styles.cardTitle}>{t("fundamentalsTitle")}</h4>
        <span className={styles.badge}>{t("fundamentalsBadge")}</span>
        <p className={styles.unavailableBody}>{t("fundamentalsBody")}</p>
      </section>

      <section className={styles.card} data-testid="evidence-sequence">
        <h4 className={styles.cardTitle}>{t("sequenceTitle")}</h4>
        <p className={styles.unavailableBody}>{t("sequenceBody")}</p>
      </section>
    </div>
  );
}

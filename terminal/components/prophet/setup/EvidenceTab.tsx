"use client";
/**
 * EvidenceTab (T2-04) — what is actually published. At this head the source
 * publishes no fundamentals, release times or revisions for the company, so
 * the destination is ONE plain unavailable line (P1-2/P1-3): the per-field
 * "not published" rows, the conclusion rail and the placeholder copy that
 * described the slot are all gone.
 *
 * A member whose join carries an early observation keeps the served evidence
 * disclosure — that is real content (the existing B03 renderer, reused
 * read-only) and it is what "You can still study → Company evidence" means.
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
      <summary className={styles.disclosureSummary}>{t("observationEvidence")}</summary>
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
      <p className={styles.emptyCopy} data-testid="evidence-unavailable">{t("evidenceUnavailable")}</p>
    </div>
  );
}

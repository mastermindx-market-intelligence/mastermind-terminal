"use client";

import { useSectorT } from "@/lib/sectorIntelligenceLex";
import type { NativeSectorReceipt } from "@/lib/sectorNativeGeneration";
import styles from "./SectorLeadershipDossier.module.css";

/** Keep the owner's non-accepted verdict beside the measurements it qualifies. */
export default function SectorGenerationQualification({ qualification }: {
  qualification?: NativeSectorReceipt["qualification"];
}) {
  const t = useSectorT();
  if (!qualification || qualification === "accepted") return null;
  return <div className={styles.notice} role="status" data-testid="sector-generation-qualification"
    data-qualification={qualification}>
    <p>{t(qualification === "stale" ? "siGenerationStale" : "siGenerationDegraded")}</p>
  </div>;
}

/** Public owner receipt only. Its hash describes the authorized representation,
 * not just the displayed dossier or the gateway's received bytes. */
export function SectorGenerationSource({ receipt }: { receipt?: NativeSectorReceipt }) {
  const t = useSectorT();
  if (!receipt) return null;
  return <details className={styles.disclosure} data-testid="sector-generation-source">
    <summary>{t("siGenerationSource")}</summary>
    <dl className={styles.detail}>
      <div className={styles.pair}><dt>{t("siDossierGeneration")}</dt><dd data-mono="true">{receipt.generation_id}</dd></div>
      <div className={styles.pair}><dt>{t("siDossierThroughDate")}</dt><dd data-mono="true">{receipt.source_session}</dd></div>
      <div className={styles.pair}><dt>{t("siGenerationPublished")}</dt><dd data-mono="true">{receipt.published_at}</dd></div>
      <div className={styles.pair}><dt>{t("siGenerationHash")}</dt><dd data-mono="true">{receipt.content_sha256}</dd></div>
    </dl>
  </details>;
}

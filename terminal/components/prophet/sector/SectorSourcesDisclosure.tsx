"use client";
/**
 * SectorSourcesDisclosure — both generations' evidence, one destination.
 *
 * Laws (doctrine §8): a NAMED, keyboard- and touch-reachable destination for
 * sources and evidence; native <details> keeps it accessible with no extra
 * machinery; closing restores nothing lost (nothing else moves). Full hashes
 * copy on demand; the visible form is abbreviated. The disclosure block is
 * rendered from the wire verbatim — membership basis, taxonomy basis, join key,
 * descriptive-only — never invented.
 */
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { abbrevHash, type SectorMembersEnvelope } from "@/lib/prophetSectorMembers";
import { makeProphetSectorT, prophetSectorFill } from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

function CopyValue({ label, value }: { label: string; value: string }) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard denied — the visible abbreviated value remains */ }
  };
  return (
    <span className={styles.sourceValue}>
      <span className={styles.sourceLabel}>{label}</span>
      <code className={styles.sourceHash}>{abbreviated(value)}</code>
      <button type="button" className={styles.copyButton} onClick={() => void copy()}>
        {copied ? t("sourcesCopied") : t("sourcesCopy")}
      </button>
    </span>
  );
}
function abbreviated(hash: string): string {
  return abbrevHash(hash, 10);
}

export function SectorSourcesDisclosure({ envelope }: { envelope: SectorMembersEnvelope }) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const { sectorRef, prophetRef, disclosure } = envelope;

  // The disclosure block renders the wire's own values. Each sentence
  // translates one exact known code; any other owner value renders verbatim
  // under its label — never invented, never silently re-worded.
  const membership = disclosure.membershipBasis === "current_roster_not_point_in_time"
    ? t("sourcesMembership")
    : `${t("sourcesMembershipLabel")}: ${disclosure.membershipBasis}`;
  const taxonomy = disclosure.taxonomyBasis === "gics_current_labels"
    ? t("sourcesTaxonomy")
    : `${t("sourcesTaxonomyLabel")}: ${disclosure.taxonomyBasis}`;
  const join = disclosure.joinKey === "us_listing_ticker"
    ? t("sourcesJoin")
    : `${t("sourcesJoinLabel")}: ${disclosure.joinKey}`;

  return (
    <details className={styles.sources} data-testid="prophet-sector-sources">
      <summary className={styles.sourcesSummary}>{t("sourcesSummary")}</summary>
      <div className={styles.sourcesBody}>
        <section className={styles.sourceBlock}>
          <h4>{t("sourcesSectorTitle")}</h4>
          {sectorRef !== null ? (
            <>
              <p className={styles.sourceLine}>
                {prophetSectorFill(t("sourcesGeneration"), { id: sectorRef.generationId })}
                {" · "}{prophetSectorFill(t("sourcesSession"), { session: sectorRef.sourceSession })}
                {" · "}{prophetSectorFill(t("sourcesPublished"), { at: sectorRef.publishedAt.slice(0, 10) })}
              </p>
              <p className={styles.sourceLine}>
                {prophetSectorFill(t("sourcesQualification"), { value: sectorRef.qualification })}
              </p>
              <CopyValue label={t("sourcesContentHash")} value={sectorRef.contentId} />
            </>
          ) : (
            <p className={styles.sourceLine}>{t("verdictSectorDown")}</p>
          )}
        </section>
        <section className={styles.sourceBlock}>
          <h4>{t("sourcesProphetTitle")}</h4>
          {prophetRef !== null ? (
            <>
              <p className={styles.sourceLine}>
                {prophetRef.schema}
                {" · "}{prophetSectorFill(t("sourcesSession"), { session: prophetRef.asof })}
                {prophetRef.generatedAt !== null ? ` · ${prophetSectorFill(t("sourcesPublished"), { at: prophetRef.generatedAt.slice(0, 10) })}` : ""}
              </p>
              <p className={styles.sourceLine}>
                {prophetSectorFill(t("sourcesPlanCounts"), { total: prophetRef.planCount, open: prophetRef.openPlanCount })}
              </p>
              <CopyValue label={t("sourcesIndexHash")} value={prophetRef.indexSha256} />
            </>
          ) : (
            <p className={styles.sourceLine}>{t("verdictProphetDown")}</p>
          )}
        </section>
        <ul className={styles.disclosureList} role="list">
          <li>{membership}</li>
          <li>{taxonomy}</li>
          <li>{join}</li>
          <li>{t("sourcesDescriptive")}</li>
        </ul>
      </div>
    </details>
  );
}

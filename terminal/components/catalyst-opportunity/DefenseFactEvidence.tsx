"use client";
import { useId, useState } from "react";
import type { DefenseProfile } from "@/lib/catalystDefense";
import { defenseEvidenceFor, presentDefenseFact, type DefenseFactReference } from "@/lib/catalystDefenseEvidence";
import { defenseText } from "@/lib/catalystDefenseLex";
import styles from "./CatalystOpportunity.module.css";

type Props = { profile: DefenseProfile; lang: "en" | "zh"; references?: readonly DefenseFactReference[] };

/** Evidence is mounted only on request; the original source payload remains unchanged. */
export function DefenseFactEvidence({ profile, lang, references }: Props) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const selection = defenseEvidenceFor(profile, references);
  const title = defenseText(lang, references ? "supporting" : "allFacts");
  return <div className={styles.defenseFactEvidence}>
    <button type="button" className={styles.button} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(value => !value)}>
      {open ? defenseText(lang, "closeEvidence") : title} ({selection.facts.length})
    </button>
    {open && <section id={regionId} aria-label={title} className={styles.defenseFactList}>
      <p className={styles.defenseBoundary}>{defenseText(lang, "evidenceBoundary")}</p>
      {selection.unresolved > 0 && <p role="status">{defenseText(lang, "unresolvedEvidence")}</p>}
      {selection.facts.length === 0 && <p>{defenseText(lang, "noReferencedFacts")}</p>}
      {selection.facts.map(fact => {
        const display = presentDefenseFact(fact, lang);
        return <div className={styles.defenseFactRow} key={JSON.stringify([fact.owner_ref, fact.fact_id])} data-testid="defense-source-fact">
          {display ? <>
            <div className={styles.defenseFactHeading}><div><h4>{display.title}</h4><p>{display.nature}</p></div>
              {!display.originalTerms && <div className={styles.defenseFactValue}><strong>{display.value}</strong><span>{display.unit}</span></div>}
            </div>
            <p>{display.period} · {display.basis}</p>
            {display.originalTerms && <details className={styles.defenseDisclosure}>
              <summary>{defenseText(lang, "originalWording")}</summary><blockquote lang="en">{display.value}</blockquote>
            </details>}
          </> : <p role="status">{defenseText(lang, "unsupportedFact")}</p>}
          {fact.source_span.source_url ? <a className={styles.defenseFactLink} href={fact.source_span.source_url} target="_blank" rel="noopener noreferrer">{defenseText(lang, "source")} ↗</a>
            : <p>{defenseText(lang, "noSourceLink")}</p>}
          <details className={styles.defenseReceipt}><summary>{defenseText(lang, "sourceIdentifiers")}</summary>
            <code>{fact.fact_id}</code><code>{fact.accounting_basis}</code><code>{fact.source_span.document_id}</code>
            {fact.source_span.span_id && <code>{fact.source_span.span_id}</code>}<code>{fact.source_span.text_sha256}</code>
          </details>
        </div>;
      })}
    </section>}
  </div>;
}

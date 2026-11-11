"use client";
/**
 * SectorGroupPicker (SX02) — every group in the current sector read, each with
 * its member count and Prophet coverage counts. Plain display names (ZH twin
 * when the reader is zh); the raw group id never faces the reader. Keyboard
 * reachable buttons; touch targets stay within the population's 44px law.
 */
import { useLang } from "@/lib/i18n";
import type { CoverageCounts, SectorGroupSummary } from "@/lib/prophetSectorMembers";
import { makeProphetSectorT, prophetSectorFill } from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

export function SectorGroupPicker({ groups, totals, selected, onPick }: {
  groups: SectorGroupSummary[];
  totals: CoverageCounts;
  selected: string | null;
  onPick: (groupId: string) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);

  if (groups.length === 0) {
    return <p className={styles.emptyCopy} data-testid="prophet-sector-picker-empty">{t("pickerEmpty")}</p>;
  }

  return (
    <section className={styles.picker} data-testid="prophet-sector-picker" aria-label={t("pickerTitle")}>
      <header className={styles.pickerHead}>
        <h3 className={styles.pickerTitle}>{t("pickerTitle")}</h3>
        <p className={styles.pickerIntro}>{t("pickerIntro")}</p>
        {/* Coverage honesty (COO term): the wire's own totals, plus the plain
            statement that Prophet covers companies beyond these groups — the
            outside count is not on the wire, so no number is invented. */}
        <p className={styles.pickerCoverageHonest} data-testid="prophet-sector-picker-coverage">
          {prophetSectorFill(t("pickerCoverageHonest"), { served: totals.served, groups: groups.length })}
        </p>
      </header>
      <ul className={styles.pickerList} role="list">
        {groups.map(group => {
          const localName = lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id);
          const isSelected = group.id === selected;
          return (
            <li key={group.id} className={styles.pickerItem}>
              <button
                type="button"
                className={isSelected ? `${styles.pickerCard} ${styles.pickerCardOn}` : styles.pickerCard}
                aria-pressed={isSelected}
                data-testid={`prophet-sector-pick-${group.id}`}
                onClick={() => { if (!isSelected) onPick(group.id); }}
              >
                <span className={styles.pickerName}>{localName}</span>
                <span className={styles.pickerCounts}>
                  {prophetSectorFill(t("pickerMembers"), { n: group.counts.served })}
                </span>
                <span className={styles.pickerCoverage}>
                  {prophetSectorFill(t("pickerCoverage"), {
                    open: group.counts.openPlan,
                    early: group.counts.earlyObservation,
                    resolved: group.counts.resolvedPlan,
                  })}
                </span>
                <span className={styles.pickerAction} aria-hidden="true">{t("pickerView")}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

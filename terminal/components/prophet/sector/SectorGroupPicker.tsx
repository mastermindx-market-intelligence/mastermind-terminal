"use client";
/**
 * SectorGroupPicker (SX01 · G5) — the leadership table: every group in the
 * current read ranked by return versus market over the same window.
 *
 * Laws:
 *   - Rank by relativePp (desc), nulls last, group return as tie-break — the
 *     order is computed, never the wire's incidental order.
 *   - One action per row (the Open column's Research control); the sector
 *     cell stays text so keyboard and touch have a single target.
 *   - Every measure renders its owner's null vocabulary in place ("not
 *     produced"/"not stated") — but a column that is null for EVERY group
 *     drops out and says so once under the table (doctrine Law 4: no per-row
 *     repetition of a constant), which today is breadth.
 *   - Development is the owner's own stateLabel, verbatim (its vocabulary is
 *     the owner's, not translated here); null renders "not stated". Its ink is
 *     semantic — expansion/recovery up, downturn/trough down, peak amber — and
 *     the label itself is always the word, never a colour alone.
 *   - Sign ink only on the numbers themselves; no colored container edges.
 *   - SX01's hero summary names the top-ranked group with its served return and
 *     versus-market figure; it renders only when both are served.
 *   - At ≤640px the table reflows into stacked cards (SX06/SX08): name and
 *     members first, then the labelled measures, then a full-width Research
 *     control. Above 640 it stays a table.
 */
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import type { CoverageCounts, SectorGroupSummary } from "@/lib/prophetSectorMembers";
import { contextNullKey, makeProphetSectorT, prophetSectorFill } from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

/** Computed leadership order: relativePp desc, nulls last; group return desc
 * as tie-break; display name as the final stable tie-break. Pure, tested. */
export function rankLeadershipGroups(groups: SectorGroupSummary[]): SectorGroupSummary[] {
  return [...groups].sort((a, b) => {
    const relA = a.context.relativePp;
    const relB = b.context.relativePp;
    if (relA === null && relB !== null) return 1;
    if (relB === null && relA !== null) return -1;
    if (relA !== null && relB !== null && relA !== relB) return relB - relA;
    const retA = a.context.groupReturnPct;
    const retB = b.context.groupReturnPct;
    if (retA !== null && retB !== null && retA !== retB) return retB - retA;
    if (retA === null && retB !== null) return 1;
    if (retB === null && retA !== null) return -1;
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });
}

function pctSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
function ppSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}
function toneColor(value: number | null): string | undefined {
  return value === null ? undefined : value > 0 ? "var(--up)" : value < 0 ? "var(--down)" : undefined;
}

/** Cycle-phase ink, keyed on the owner's own five words. Unknown labels stay
 * plain text — never a guessed colour. */
function developmentTone(label: string | null): string | undefined {
  switch (label) {
    case "Expansion":
    case "Recovery":
      return styles.devUp;
    case "Downturn":
    case "Trough":
      return styles.devDown;
    case "Peak":
      return styles.devWarn;
    default:
      return undefined;
  }
}

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

  const ranked = rankLeadershipGroups(groups);
  // Breadth joins the table only when the read actually carries it for at
  // least one group; an all-null column would repeat one constant per row.
  const anyBreadth = groups.some(group => group.context.breadth !== null);

  // SX01 hero: the top-ranked group, only from SERVED figures. A missing
  // return or versus-market read would need its null vocabulary in a headline,
  // which is not a summary — so the hero simply does not render.
  const top = ranked[0];
  const hero = top !== undefined && top.context.relativePp !== null && top.context.groupReturnPct !== null
    ? (() => {
        const heroName = (lang === "zh" ? top.nameZh || top.name : top.name) || top.id;
        const ret = pctSigned(top.context.groupReturnPct as number);
        const pp = ppSigned(top.context.relativePp as number);
        return {
          name: heroName,
          body: top.context.windowSessions !== null
            ? prophetSectorFill(t("heroBody"), { ret, n: top.context.windowSessions, pp })
            : prophetSectorFill(t("heroBodyNoWindow"), { ret, pp }),
        };
      })()
    : null;

  return (
    <section className={styles.picker} data-testid="prophet-sector-picker" aria-label={t("leadershipTitle")}>
      {hero !== null ? (
        <div className={styles.leaderHero} data-testid="prophet-sector-leadership-hero">
          <p className={styles.heroKicker}>{t("heroKicker")}</p>
          <h4 className={styles.heroTitle}>{prophetSectorFill(t("heroTitle"), { group: hero.name })}</h4>
          <p className={styles.heroBody} data-testid="prophet-sector-leadership-hero-figures">{hero.body}</p>
          <p className={styles.heroNote}>{t("heroNote")}</p>
        </div>
      ) : null}

      <header className={styles.pickerHead}>
        <h3 className={styles.pickerTitle} data-view-heading tabIndex={-1}>{t("leadershipTitle")}</h3>
        <p className={styles.pickerIntro}>{t("leadershipIntro")}</p>
        {/* Coverage honesty (COO term): the wire's own totals, plus the plain
            statement that Prophet covers companies beyond these groups — the
            outside count is not on the wire, so no number is invented. */}
        <p className={styles.pickerCoverageHonest} data-testid="prophet-sector-picker-coverage">
          {prophetSectorFill(t("pickerCoverageHonest"), { companies: totals.served, groups: groups.length })}
        </p>
      </header>
      <div className={styles.leadershipWrap}>
        <table className={styles.leadershipTable} data-testid="prophet-sector-leadership-table">
          <thead><tr>
            <th scope="col">{t("pickerTitle")}</th>
            <th scope="col">{t("columnReturn")}</th>
            <th scope="col">{t("columnVsMarket")}</th>
            {anyBreadth ? <th scope="col">{t("columnBreadth")}</th> : null}
            <th scope="col">{t("columnDevelopment")}</th>
            <th scope="col">{t("columnOpen")}</th>
          </tr></thead>
          <tbody>
            {ranked.map(group => {
              const localName = lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id);
              const ctx = group.context;
              const isSelected = group.id === selected;
              return (
                <tr key={group.id} className={styles.memberRow}>
                  <td className={styles.leadershipSectorCell}>
                    <span className={styles.leadershipName}>{localName}</span>
                    <span className={styles.leadershipMembers}>
                      {prophetSectorFill(t("pickerMembers"), { n: group.counts.served })}
                    </span>
                  </td>
                  <td className={styles.leadershipCell}>
                    <span className={styles.cellLabel}>{t("columnReturn")}</span>
                    {ctx.groupReturnPct !== null ? (
                      <span className={styles.leadershipNum} style={{ color: toneColor(ctx.groupReturnPct) ?? "var(--text)" }}>
                        {pctSigned(ctx.groupReturnPct)}
                      </span>
                    ) : (
                      <span className={styles.leadershipNumMuted}>{t(contextNullKey(ctx.reasons.group_return_pct))}</span>
                    )}
                  </td>
                  <td className={styles.leadershipCell}>
                    <span className={styles.cellLabel}>{t("columnVsMarket")}</span>
                    {ctx.relativePp !== null ? (
                      <span className={styles.leadershipNum} style={{ color: toneColor(ctx.relativePp) ?? "var(--text)" }}>
                        {ppSigned(ctx.relativePp)}
                      </span>
                    ) : (
                      <span className={styles.leadershipNumMuted}>{t(contextNullKey(ctx.reasons.relative_pp))}</span>
                    )}
                  </td>
                  {anyBreadth ? (
                    <td className={`${styles.leadershipCell} ${styles.leadershipBreadthCell}`}>
                      <span className={styles.cellLabel}>{t("columnBreadth")}</span>
                      {ctx.breadth !== null ? (
                        <span className={styles.leadershipNum}>
                          {`${ctx.breadth.aboveTrend}/${ctx.breadth.measured}`}
                        </span>
                      ) : (
                        <span className={styles.leadershipNumMuted}>{t(contextNullKey(ctx.reasons.breadth))}</span>
                      )}
                    </td>
                  ) : null}
                  <td className={`${styles.leadershipDev} ${styles.leadershipDevCell}`}>
                    <span className={styles.cellLabel}>{t("columnDevelopment")}</span>
                    <span className={developmentTone(ctx.stateLabel)}>{ctx.stateLabel ?? t("contextNotStated")}</span>
                  </td>
                  <td className={styles.leadershipOpenCell}>
                    <button
                      type="button"
                      className={styles.leadershipAction}
                      aria-pressed={isSelected}
                      data-testid={`prophet-sector-pick-${group.id}`}
                      onClick={() => { if (!isSelected) onPick(group.id); }}
                    >
                      {t("pickerResearch")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!anyBreadth ? (
        <p className={styles.leadershipNote} data-testid="prophet-sector-breadth-none">{t("breadthNoneLine")}</p>
      ) : null}
      <Link className={styles.siLink} href="/sectors" data-testid="prophet-sector-si-explore">{t("siExplore")}</Link>
    </section>
  );
}

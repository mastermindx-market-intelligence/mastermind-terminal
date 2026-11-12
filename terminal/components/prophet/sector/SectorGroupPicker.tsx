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
 *     the owner's, not translated here); null renders "not stated".
 *   - Sign ink only on the numbers themselves; no colored container edges.
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

  return (
    <section className={styles.picker} data-testid="prophet-sector-picker" aria-label={t("leadershipTitle")}>
      <header className={styles.pickerHead}>
        <h3 className={styles.pickerTitle}>{t("leadershipTitle")}</h3>
        <p className={styles.pickerIntro}>{t("leadershipIntro")}</p>
        {/* Coverage honesty (COO term): the wire's own totals, plus the plain
            statement that Prophet covers companies beyond these groups — the
            outside count is not on the wire, so no number is invented. */}
        <p className={styles.pickerCoverageHonest} data-testid="prophet-sector-picker-coverage">
          {prophetSectorFill(t("pickerCoverageHonest"), { served: totals.served, groups: groups.length })}
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
                  <td>
                    {ctx.groupReturnPct !== null ? (
                      <span className={styles.leadershipNum} style={{ color: toneColor(ctx.groupReturnPct) ?? "var(--text)" }}>
                        {pctSigned(ctx.groupReturnPct)}
                      </span>
                    ) : (
                      <span className={styles.leadershipNumMuted}>{t(contextNullKey(ctx.reasons.group_return_pct))}</span>
                    )}
                  </td>
                  <td>
                    {ctx.relativePp !== null ? (
                      <span className={styles.leadershipNum} style={{ color: toneColor(ctx.relativePp) ?? "var(--text)" }}>
                        {ppSigned(ctx.relativePp)}
                      </span>
                    ) : (
                      <span className={styles.leadershipNumMuted}>{t(contextNullKey(ctx.reasons.relative_pp))}</span>
                    )}
                  </td>
                  {anyBreadth ? (
                    <td>
                      {ctx.breadth !== null ? (
                        <span className={styles.leadershipNum}>
                          {`${ctx.breadth.aboveTrend}/${ctx.breadth.measured}`}
                        </span>
                      ) : (
                        <span className={styles.leadershipNumMuted}>{t(contextNullKey(ctx.reasons.breadth))}</span>
                      )}
                    </td>
                  ) : null}
                  <td className={styles.leadershipDev}>
                    {ctx.stateLabel ?? t("contextNotStated")}
                  </td>
                  <td>
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

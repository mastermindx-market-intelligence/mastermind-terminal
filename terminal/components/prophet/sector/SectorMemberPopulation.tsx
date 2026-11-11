"use client";
/**
 * SectorMemberPopulation (SX04) — the complete dated member population of the
 * selected group, joined to Prophet.
 *
 * Laws:
 *   - EVERY member renders (search filters BEFORE paging; state filter chips
 *     carry counts; paging is offset/limit, never top-N truncation).
 *   - Expected/served/unmeasured counts are stated as counts — never as a
 *     completeness or health claim.
 *   - Unmeasured (unserved) members render in their own visible section with
 *     the owner's reason, translated — never dropped.
 *   - Each member's Prophet state is REPORTED (label + reason for none/
 *     unavailable), never recommended; the row's action opens the Setup.
 *   - Keyboard navigable: the symbol control is a real button; touch targets
 *     meet 44px; filter chips and paging are buttons.
 */
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  PROPHET_MEMBER_STATES, SECTOR_MEMBERS_QUERY,
  type ProphetMemberState, type SectorMembersPayload,
} from "@/lib/prophetSectorMembers";
import {
  makeProphetSectorT, PROPHET_STATE_LABEL_KEY, prophetReasonKey, prophetSectorFill,
  prophetUnservedReasonKey,
} from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

export function SectorMemberPopulation({ payload, q, stateFilter, offset, onFilter, onOpenMember }: {
  payload: Extract<SectorMembersPayload, { mode: "group" }>;
  q: string;
  stateFilter: ProphetMemberState | null;
  offset: number;
  onFilter: (change: { q?: string; state?: ProphetMemberState | null; offset?: number }) => void;
  onOpenMember: (symbol: string, planId: string | null) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const [draft, setDraft] = useState(q);

  const { group, counts, members, unserved, page } = payload;
  const localName = lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id);

  const searchInvalid = draft.trim() !== "" && !SECTOR_MEMBERS_QUERY.test(draft.trim());
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (searchInvalid) return;
    const next = draft.trim();
    if (next === q) return;
    onFilter({ q: next, offset: 0 });
  };

  const hasPrev = offset > 0;
  const hasNext = page.nextOffset !== null;
  const pageBase = offset + 1;
  const pageEnd = offset + members.length;

  const chip = (key: string, label: string, count: number, active: boolean, onSelect: () => void) => (
    <button
      key={key}
      type="button"
      className={active ? `${styles.stateChip} ${styles.stateChipOn}` : styles.stateChip}
      aria-pressed={active}
      data-testid={`prophet-sector-filter-${key}`}
      onClick={onSelect}
    >
      {label} <span className={styles.stateChipCount}>{count}</span>
    </button>
  );

  return (
    <section className={styles.population} data-testid="prophet-sector-population">
      <header className={styles.populationHead}>
        <h3 className={styles.populationTitle}>{prophetSectorFill(t("populationTitle"), { group: localName })}</h3>
        <p className={styles.populationCounts} data-testid="prophet-sector-population-counts">
          {prophetSectorFill(t("populationCounts"), {
            served: counts.served, configured: counts.configured, unserved: counts.accountedUnserved,
          })}
        </p>
      </header>

      <div className={styles.populationControls}>
        <form className={styles.populationSearch} role="search" onSubmit={submitSearch}>
          <label className={styles.a11yLabel} htmlFor="prophet-sector-q">{t("searchLabel")}</label>
          <input
            id="prophet-sector-q"
            className={styles.searchInput}
            value={draft}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
            aria-invalid={searchInvalid}
            data-testid="prophet-sector-search"
            onChange={event => setDraft(event.target.value)}
          />
          <button type="submit" className={styles.smallButton} disabled={searchInvalid}>{t("searchSubmit")}</button>
          {q !== "" ? (
            <button type="button" className={styles.smallButton}
              data-testid="prophet-sector-search-clear"
              onClick={() => { setDraft(""); onFilter({ q: "", offset: 0 }); }}>
              {t("searchClear")}
            </button>
          ) : null}
        </form>
        <div className={styles.stateChips} role="group" aria-label={t("columnState")}>
          {chip("all", t("filterAll"), counts.served, stateFilter === null, () => onFilter({ state: null, offset: 0 }))}
          {PROPHET_MEMBER_STATES.map(state => chip(
            state, t(PROPHET_STATE_LABEL_KEY[state]),
            state === "open_plan" ? counts.openPlan
              : state === "resolved_plan" ? counts.resolvedPlan
              : state === "early_observation" ? counts.earlyObservation
              : state === "none" ? counts.none
              : counts.unavailable,
            stateFilter === state,
            () => onFilter({ state: stateFilter === state ? null : state, offset: 0 }),
          ))}
        </div>
      </div>

      {members.length === 0 ? (
        <p className={styles.emptyCopy} data-testid="prophet-sector-population-empty">{t("emptyFiltered")}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.memberTable} data-testid="prophet-sector-member-table">
            <thead><tr>
              <th scope="col">{t("columnSymbol")}</th>
              <th scope="col">{t("columnName")}</th>
              <th scope="col">{t("columnIndustry")}</th>
              <th scope="col">{t("columnSince")}</th>
              <th scope="col">{t("columnState")}</th>
            </tr></thead>
            <tbody>
              {members.map(member => {
                const planId = member.prophet.plan?.id ?? null;
                return (
                  <tr key={member.symbol} className={styles.memberRow}>
                    <td className={styles.symbolCell}>
                      <button
                        type="button"
                        className={styles.symbolButton}
                        aria-label={prophetSectorFill(t("setupAria"), { symbol: member.symbol })}
                        data-testid={`prophet-sector-open-${member.symbol}`}
                        onClick={() => onOpenMember(member.symbol, planId)}
                      >
                        {member.symbol}
                      </button>
                      <span className={styles.setupHint}>{t("openSetup")}</span>
                    </td>
                    <td className={styles.nameCell}>
                      {member.name ?? "—"}
                      {member.alsoInGroups.length > 0 ? (
                        <span className={styles.alsoIn}> · {prophetSectorFill(t("alsoIn"), { groups: member.alsoInGroups.length })}</span>
                      ) : null}
                    </td>
                    <td>{member.industry ?? "—"}</td>
                    <td className={styles.sinceCell}>{member.memberSince ?? "—"}</td>
                    <td className={styles.stateCell}>
                      <span className={stateToneClass(member.prophet.state)} data-testid={`prophet-sector-state-${member.symbol}`}>
                        {t(PROPHET_STATE_LABEL_KEY[member.prophet.state])}
                      </span>
                      {member.prophet.state === "none" || member.prophet.state === "unavailable" ? (
                        <span className={styles.stateReason}>{t(prophetReasonKey(member.prophet.reason))}</span>
                      ) : member.prophet.observation !== null ? (
                        <span className={styles.stateReason}>{prophetSectorFill(t("setupObservation"), { asof: member.prophet.observation.asof })}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.pagerRow} data-testid="prophet-sector-pager">
        <span className={styles.shownLabel}>
          {prophetSectorFill(t("shownOf"), { shown: members.length === 0 ? 0 : pageBase, total: page.totalMatching })}
          {members.length > 1 ? `–${pageEnd}` : ""}
        </span>
        <span className={styles.pagerButtons}>
          <button type="button" className={styles.smallButton} disabled={!hasPrev}
            data-testid="prophet-sector-page-prev"
            onClick={() => onFilter({ offset: Math.max(0, offset - page.limit) })}>
            {t("pagePrev")}
          </button>
          <button type="button" className={styles.smallButton} disabled={!hasNext}
            data-testid="prophet-sector-page-next"
            onClick={() => onFilter({ offset: page.nextOffset ?? offset })}>
            {t("pageNext")}
          </button>
        </span>
      </div>

      {unserved.length > 0 ? (
        <section className={styles.unserved} data-testid="prophet-sector-unserved">
          <h4 className={styles.unservedTitle}>{prophetSectorFill(t("unservedTitle"), { n: unserved.length })}</h4>
          <p className={styles.unservedNote}>{t("unservedNote")}</p>
          <ul className={styles.unservedList} role="list">
            {unserved.map(entry => (
              <li key={entry.symbol} className={styles.unservedItem}>
                <span className={styles.unservedSymbol}>{entry.symbol}</span>
                <span>{t(prophetUnservedReasonKey(entry.reason))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

/** Reported-state ink: quiet labels; unavailable dims. No colored edges. */
function stateToneClass(state: ProphetMemberState): string {
  if (state === "open_plan") return styles.stateOpen;
  if (state === "resolved_plan") return styles.stateResolved;
  if (state === "unavailable") return styles.stateUnavailable;
  return styles.statePlain;
}

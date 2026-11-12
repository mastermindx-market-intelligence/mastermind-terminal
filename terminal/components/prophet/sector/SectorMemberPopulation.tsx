"use client";
/**
 * SectorMemberPopulation (SX04 / T2-06 · G6) — the complete dated member
 * population of the selected group, joined to Prophet, with the compare
 * selection.
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
 *   - Selection (T2-06): real checkboxes, a tray that names the count with a
 *     removable chip per name, "Selections stay fixed as you change filters"
 *     — and selection SURVIVES search/filter/paging because it lives above
 *     this component, in the lane's state. Compare needs two names, caps at
 *     three (the cap is stated, never a silent no-op).
 *   - The per-member performance/research measures the wire does not carry
 *     are named ONCE under the table (doctrine Law 4), never as per-row null
 *     spam or an invented number.
 *   - Keyboard navigable: the symbol control is a real button; touch targets
 *     meet 44px; filter chips, checkboxes and paging are real controls.
 *   - T2-14 card layout at ≤640px: one stacked card per member (symbol + name,
 *     Prophet state, a ≥44px Compare control, a labelled Open action). Above
 *     640px the same rows stay a table.
 *   - Returning from a company case (`prophetSymbol` still in the address)
 *     highlights that member's row/card and scrolls it into view once.
 */
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  PROPHET_MEMBER_STATES, SECTOR_MEMBERS_QUERY, SECTOR_MEMBERS_SYMBOL,
  type ProphetMemberState, type SectorMembersPayload,
} from "@/lib/prophetSectorMembers";
import type { ProphetUrlState } from "@/lib/prophetUrlState";
import {
  makeProphetSectorT, PROPHET_STATE_LABEL_KEY, prophetReasonKey, prophetSectorFill,
  prophetUnservedReasonKey,
} from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

/** The compare surface reads at most three cases side by side (T2-07's two
 * columns plus the "Add a third" affordance); the cap is honest vocabulary,
 * not a silent drop. */
export const PROPHET_COMPARE_CAP = 3;

/** Tolerant read of Lane A's future `sel` key: until the URL codec publishes
 * it, the selection rides the lane's React state (a refresh drops it — never
 * an error); once the codec carries `sel`, the same calls persist it with no
 * change on this side. Invalid or over-cap entries are dropped, never
 * rendered. */
export function readProphetSelection(state: ProphetUrlState): string[] {
  const raw = (state as ProphetUrlState & { sel?: unknown }).sel;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !SECTOR_MEMBERS_SYMBOL.test(entry)) continue;
    if (seen.has(entry) || out.length >= PROPHET_COMPARE_CAP) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/** Toggle one symbol, appending at the end (the tray's chip order follows the
 * reader's picking order); at the cap a new pick replaces nothing — the cap
 * note explains. */
export function toggleProphetSelection(current: string[], symbol: string): string[] {
  if (!SECTOR_MEMBERS_SYMBOL.test(symbol)) return current;
  if (current.includes(symbol)) return current.filter(entry => entry !== symbol);
  if (current.length >= PROPHET_COMPARE_CAP) return current;
  return [...current, symbol];
}

export function SectorMemberPopulation({ payload, q, stateFilter, offset, onFilter, onOpenMember,
  selection, onToggleSelect, onCompare, highlightSymbol }: {
  payload: Extract<SectorMembersPayload, { mode: "group" }>;
  q: string;
  stateFilter: ProphetMemberState | null;
  offset: number;
  onFilter: (change: { q?: string; state?: ProphetMemberState | null; offset?: number }) => void;
  onOpenMember: (symbol: string, planId: string | null) => void;
  selection: string[];
  onToggleSelect: (symbol: string) => void;
  onCompare: () => void;
  /** The member the reader just returned from, when the address still names
   * one: its row/card is highlighted and scrolled into view once. */
  highlightSymbol: string | null;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const [draft, setDraft] = useState(q);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (highlightSymbol === null) {
      scrolledFor.current = null;
      return;
    }
    if (scrolledFor.current === highlightSymbol) return;
    const node = rowRefs.current.get(highlightSymbol);
    if (node === undefined) return; // not on this page — nothing invented to point at
    scrolledFor.current = highlightSymbol;
    node.scrollIntoView({ block: "center" });
  }, [highlightSymbol, payload.members]);

  const { group, counts, members, unserved, page } = payload;
  // The fail-closed read (A1-9) carries group null; the population then renders
  // its neutral title with counts stated as not stated — never invented.
  const localName = group === null
    ? t("populationTitleNoGroup")
    : lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id);

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
        <h3 className={styles.populationTitle} data-view-heading tabIndex={-1}>{prophetSectorFill(t("populationTitle"), { group: localName })}</h3>
        <p className={styles.populationCounts} data-testid="prophet-sector-population-counts">
          {prophetSectorFill(t("populationCounts"), {
            served: counts.served,
            configured: counts.configured === null ? t("contextNotStated") : counts.configured,
            unserved: counts.accountedUnserved,
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

      {selection.length > 0 ? (
        <div className={styles.selectionTray} data-testid="prophet-sector-selection">
          <span className={styles.selectionCount}>
            {prophetSectorFill(t("selectedCount"), { n: selection.length })}
          </span>
          <span className={styles.selectionChips}>
            {selection.map(symbol => (
              <span key={symbol} className={styles.selectionChip}>
                {symbol}
                <button
                  type="button"
                  className={styles.selectionChipRemove}
                  aria-label={prophetSectorFill(t("removeSelectionAria"), { symbol })}
                  data-testid={`prophet-sector-selection-remove-${symbol}`}
                  onClick={() => onToggleSelect(symbol)}
                >
                  ×
                </button>
              </span>
            ))}
          </span>
          <span className={styles.selectionNote}>{t("selectionNote")}</span>
          {selection.length >= PROPHET_COMPARE_CAP ? (
            <span className={styles.selectionCap}>
              {prophetSectorFill(t("selectionCapNote"), { n: PROPHET_COMPARE_CAP })}
            </span>
          ) : null}
          <button
            type="button"
            className={styles.compareButton}
            disabled={selection.length < 2}
            data-testid="prophet-sector-compare-selected"
            onClick={onCompare}
          >
            {t("compareSelected")}
          </button>
        </div>
      ) : null}

      {members.length === 0 ? (
        <p className={styles.emptyCopy} data-testid="prophet-sector-population-empty">{t("emptyFiltered")}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.memberTable} data-testid="prophet-sector-member-table">
            <thead><tr>
              <th scope="col"><span className={styles.a11yLabel}>{t("compareCol")}</span></th>
              <th scope="col">{t("columnSymbol")}</th>
              <th scope="col">{t("columnName")}</th>
              <th scope="col">{t("columnIndustry")}</th>
              <th scope="col">{t("columnSince")}</th>
              <th scope="col">{t("columnState")}</th>
            </tr></thead>
            <tbody>
              {members.map(member => {
                const planId = member.prophet.plan?.id ?? null;
                const isSelected = selection.includes(member.symbol);
                const isHighlighted = highlightSymbol === member.symbol;
                return (
                  <tr
                    key={member.symbol}
                    className={isHighlighted ? `${styles.memberRow} ${styles.memberRowHighlight}` : styles.memberRow}
                    data-highlight={isHighlighted ? "true" : undefined}
                    // P1: the row the reader returned to is the current one in
                    // this population — announced, not only tinted.
                    aria-current={isHighlighted ? "true" : undefined}
                    ref={node => {
                      if (node !== null) rowRefs.current.set(member.symbol, node);
                      else rowRefs.current.delete(member.symbol);
                    }}
                  >
                    <td className={styles.selectCell}>
                      <label className={styles.selectWrap} data-testid={`prophet-sector-select-wrap-${member.symbol}`}>
                        <input
                          type="checkbox"
                          className={styles.selectBox}
                          checked={isSelected}
                          aria-label={prophetSectorFill(t("selectAria"), { symbol: member.symbol })}
                          data-testid={`prophet-sector-select-${member.symbol}`}
                          onChange={() => onToggleSelect(member.symbol)}
                        />
                        {/* Card-only visible label: in the phone card the bare
                            checkbox is ambiguous; the table header already names it. */}
                        <span className={styles.selectLabel}>{t("compareCol")}</span>
                      </label>
                    </td>
                    <td className={styles.symbolCell}>
                      {/* The stack lives INSIDE the td: a td with display:flex
                          opts out of table-cell layout, so its row rule drew at
                          its own content height — the stepped dividers the
                          review caught. Every td stays a table-cell; the rule
                          is one line per row at the common row bottom. */}
                      <div className={styles.cellStack}>
                        <button
                          type="button"
                          className={styles.symbolButton}
                          aria-label={prophetSectorFill(t("setupAria"), { symbol: member.symbol })}
                          data-testid={`prophet-sector-open-${member.symbol}`}
                          onClick={() => onOpenMember(member.symbol, planId)}
                        >
                          {member.symbol}
                          {/* Card-only action label, inside the same control —
                              one open action, never a duplicate. */}
                          <span className={styles.cardOpenHint}>{t("cardOpen")} →</span>
                        </button>
                        <span className={styles.setupHint}>{t("openSetup")}</span>
                      </div>
                    </td>
                    <td className={styles.nameCell}>
                      {member.name ?? "—"}
                      {member.alsoInGroups.length > 0 ? (
                        <span className={styles.alsoIn}> · {prophetSectorFill(t("alsoIn"), { groups: member.alsoInGroups.length })}</span>
                      ) : null}
                    </td>
                    <td className={styles.industryCell}>{member.industry ?? "—"}</td>
                    {/* A2-1: first_known is a LOWER BOUND (stored-snapshot
                        coverage), never a join date — the "at least" wording is
                        the honesty law, not decoration. Space buys one date
                        column here; the Setup shows both labeled clocks. */}
                    <td className={styles.sinceCell}>
                      {member.firstKnown !== null ? prophetSectorFill(t("sinceAtLeast"), { date: member.firstKnown }) : "—"}
                    </td>
                    <td className={styles.stateCell}>
                      <div className={styles.cellStack}>
                        <span className={stateToneClass(member.prophet.state)} data-testid={`prophet-sector-state-${member.symbol}`}>
                          {t(PROPHET_STATE_LABEL_KEY[member.prophet.state])}
                        </span>
                        {member.prophet.state === "none" || member.prophet.state === "unavailable" ? (
                          <span className={styles.stateReason}>{t(prophetReasonKey(member.prophet.reason))}</span>
                        ) : member.prophet.observation !== null ? (
                          <span className={styles.stateReason}>{prophetSectorFill(t("setupObservation"), { asof: member.prophet.observation.asof })}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The wire carries no per-member return/versus/breadth/research fields
          yet (G6): one honest line under the whole table — never per-row null
          spam, never an invented number. */}
      <p className={styles.leadershipNote} data-testid="prophet-sector-measures-note">
        {t("populationMeasuresNote")}
      </p>

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

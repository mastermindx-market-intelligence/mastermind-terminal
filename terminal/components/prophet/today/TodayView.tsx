"use client";
/**
 * TodayView — the board /prophet opens on (Lane A, gaps G1/G2/G21).
 *
 * Reading order (SX01 desktop): the market-to-sector assessment of the LEADING
 * sector first — the top-return group whose population is published — then the
 * ranked sector leadership table directly under it, then that group's research
 * cases. At ≤640 the compact composition (SX06/SX08) keeps the assessment and
 * the first case in the first screen and lets the leadership list follow the
 * cases (one CSS order swap; DOM order stays assessment → table → cases).
 * The signal desk (Plans) stays one tab away; it no longer owns the first
 * screen.
 *
 * Laws:
 *   - The whole board rides ONE index read (mode=index); the cases ride ONE
 *     group read (mode=group) for the focus group. Every panel states its own
 *     single as-of; no number is ever synthesized between reads.
 *   - Focus sector (B1): the `sector` URL key when today's read carries it;
 *     otherwise the TOP-RETURN group whose population is published. Plan count
 *     is a reported secondary fact, never the hero's selection rule. The
 *     population read is the published artifact, so a group whose population is
 *     not published is skipped (bounded walk) rather than shown as an empty
 *     list. Production publishes every group; the walk only matters where some
 *     populations are withheld.
 *   - Nulls render their owner's reason vocabulary; unavailable fields render
 *     their designed quiet absence — never a zero, never an invented number.
 *   - Negative/positive measures carry semantic ink by meaning (P1).
 *   - Descriptive only. Nothing here sizes, rates or permits a trade.
 *   - The compare selection is the URL's `sel` (Lane A contract) — Today
 *     shows and edits it; it promises no destination beyond the contract.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import {
  fetchProphetSectorMembers, type ProphetMemberState, type SectorMembersPayload,
  type SectorMembersRead,
} from "@/lib/prophetSectorMembers";
import { toggleProphetSel, PROPHET_SEL_MAX, type ProphetUrlState } from "@/lib/prophetUrlState";
import { makeProphetT } from "../prophetStrings";
import {
  contextNullKey, makeProphetSectorT, prophetSectorFill,
} from "../sector/prophetSectorStrings";
import { ResearchCaseCard } from "./ResearchCaseCard";
import { SectorLeadershipHero } from "./SectorLeadershipHero";
import styles from "./today.module.css";

type Read<T> = ({ status: "loading" } | { status: "ready"; payload: T }
  | ({ status: SectorMembersRead["status"] } & { retryAfterSec?: number | null }))
  /** The read key this outcome belongs to: the population walk advances only on
   * a 404 CONFIRMED for the candidate it is looking at, never on a stale status
   * left over from the previous candidate. */
  & { key?: string };

/** One bounded fetch cycle: sequence-guarded, aborted on change, retryable —
 * the same shape the sector lane uses, kept local so the lanes stay
 * independently deployable. */
function useTodayFetch<T extends SectorMembersPayload>(
  enabled: boolean,
  query: () => { group?: string; symbol?: string; offset?: number; limit?: number; q?: string | null; state?: ProphetMemberState | null },
  keyOf: () => string,
): { read: Read<T>; retry: () => void } {
  const [read, setRead] = useState<Read<T>>({ status: "loading", key: keyOf() });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const key = keyOf();

  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const forKey = key;
    void (async () => {
      setRead({ status: "loading", key: forKey });
      let result: Awaited<ReturnType<typeof fetchProphetSectorMembers>>;
      try {
        result = await fetchProphetSectorMembers({ ...query(), signal: controller.signal });
      } catch (error) {
        // A superseded fetch's abort is expected; the newer cycle owns the state.
        if (error instanceof DOMException && error.name === "AbortError") return;
        throw error;
      }
      if (mine !== seq.current) return;
      if (result.status === "ok") setRead({ status: "ready", payload: result.payload as T, key: forKey });
      else if (result.status === "retry") setRead({ status: "retry", retryAfterSec: result.retryAfterSec, key: forKey });
      else setRead({ status: result.status, key: forKey } as Read<T>);
    })();
    return () => { controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt, key]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { read, retry };
}

/** Nulls-last descending comparator for a group measure. */
const byReturnDesc = (a: { context: { groupReturnPct: number | null } },
  b: { context: { groupReturnPct: number | null } }) => {
  if (a.context.groupReturnPct === null && b.context.groupReturnPct === null) return 0;
  if (a.context.groupReturnPct === null) return 1;
  if (b.context.groupReturnPct === null) return -1;
  return b.context.groupReturnPct - a.context.groupReturnPct;
};

const CASES_SHOWN = 6;
const LEADERSHIP_ROWS = 8;
/** The derived-focus walk bound: production publishes every group's population
 * (first candidate always reads), so this ceiling only matters where some
 * populations are withheld — the committed fixtures publish 3 of 49. */
const FOCUS_CANDIDATES = 12;

function pctSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
function ppSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

export function TodayView({ state, update }: {
  state: ProphetUrlState;
  update: (patch: Partial<ProphetUrlState>) => void;
}) {
  const { lang } = useLang();
  const t = makeProphetT(lang);
  const sectorT = makeProphetSectorT(lang);

  // Index — every group with its context and coverage counts. The whole board
  // hangs off this one read.
  const indexFetch = useTodayFetch<Extract<SectorMembersPayload, { mode: "index" }>>(true, () => ({}), () => "index");
  const indexReady = indexFetch.read.status === "ready" ? indexFetch.read.payload : null;

  // Focus candidates (B1): groups ranked by group return, nulls last. The hero
  // is the leading sector — the first candidate whose population is published.
  // Plan count is reported elsewhere (coverage chips, table column); it never
  // chooses the hero.
  const candidates = useMemo<Extract<SectorMembersPayload, { mode: "index" }>["groups"]>(() => {
    if (indexReady === null) return [];
    if (state.group !== null) {
      const named = indexReady.groups.filter(g => g.id === state.group);
      if (named.length > 0) return named;
    }
    return [...indexReady.groups].sort(byReturnDesc).slice(0, FOCUS_CANDIDATES);
  }, [indexReady, state.group]);

  // A deep-linked group always wins even when its population is not published
  // (its cases block says so honestly); the walk only applies to the derived
  // focus. Reset the walk when the URL names a different group.
  const [walkIndex, setWalkIndex] = useState(0);
  useEffect(() => { setWalkIndex(0); }, [state.group]); // eslint-disable-line react-hooks/set-state-in-effect

  const focusId = candidates[Math.min(walkIndex, Math.max(candidates.length - 1, 0))]?.id ?? null;
  const casesKey = `cases|${focusId ?? ""}`;
  const casesFetch = useTodayFetch<Extract<SectorMembersPayload, { mode: "group" }>>(
    focusId !== null,
    () => ({ group: focusId ?? undefined, limit: 100 }),
    () => casesKey,
  );
  const casesRead: Read<Extract<SectorMembersPayload, { mode: "group" }>> = casesFetch.read.key === casesKey ? casesFetch.read : { status: "loading", key: casesKey };
  const casesReady = casesRead.status === "ready" ? casesRead.payload : null;

  // Bounded population walk: a candidate whose population is not published
  // (404 unknown_group at the BFF) yields to the next candidate — at most
  // FOCUS_CANDIDATES reads, and only in environments where some populations
  // are withheld; production publishes every group and stops at the first.
  // The increment requires the 404 to belong to THIS candidate's read key, so a
  // stale status from the previous step can never skip a published population.
  // The observed absence is recorded so the hero's rank line can say plainly
  // that the overall leader's members are not in this reading (P1-2).
  const [unpublished, setUnpublished] = useState<string[]>([]);
  useEffect(() => {
    if (state.group === null && casesFetch.read.status === "not_found"
      && casesFetch.read.key === casesKey && focusId !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the fetch outcome is the external input: remember which candidate was observed absent.
      setUnpublished(prev => prev.includes(focusId) ? prev : [...prev, focusId]);
      if (walkIndex < candidates.length - 1) {
        setWalkIndex(walkIndex + 1);
      }
    }
  }, [casesFetch.read.status, casesFetch.read.key, casesKey, walkIndex, candidates.length, state.group, focusId]);

  const focusGroup = focusId !== null && indexReady !== null
    ? indexReady.groups.find(g => g.id === focusId) ?? null
    : null;

  const caseMembers = casesReady !== null && casesReady.group !== null
    ? casesReady.members.filter(m => m.prophet.state === "open_plan" || m.prophet.state === "early_observation")
    : [];
  const shownCases = caseMembers.slice(0, CASES_SHOWN);
  const furtherCases = caseMembers.slice(CASES_SHOWN);

  const leadership = useMemo(() => indexReady !== null
    ? [...indexReady.groups].sort(byReturnDesc).slice(0, LEADERSHIP_ROWS)
    : [], [indexReady]);

  /** The display name for a group in the active language. */
  const nameOf = (group: { id: string; name: string | null; nameZh: string | null }) =>
    ((lang === "zh" ? group.nameZh || group.name : group.name) || group.id);

  // P1-5: breadth is unavailable for every group in this reading — the table
  // column is then dropped and the fact is stated once under the table.
  const anyBreadth = indexReady !== null
    && indexReady.groups.some(g => g.context.breadth !== null);

  // P1-2: the overall leader (by group return), when it is not the hero group.
  // Only meaningful for the derived focus: a deep-linked group is its own
  // answer, not a ranking. `unpublished` records the groups the walk observed
  // absent from this reading, so the line never guesses it.
  const overallLead = state.group === null && focusGroup !== null && leadership.length > 0
    && leadership[0].id !== focusGroup.id
    ? leadership[0]
    : null;

  const openGroup = (groupId: string) =>
    update({ lane: "sector", view: "population", group: groupId, symbol: null, q: "", state: null, offset: 0 });
  const openSetup = (symbol: string) =>
    // Carry the focused group (derived or deep-linked): the setup's Back asks for
    // that group's population, which can only load when a group is in state.
    update({ lane: "sector", view: "setup", group: focusId, symbol, plan: null });
  const openScreener = () => update({ lane: "screener", view: "overview" });
  const openPlans = () => update({ lane: "plans" });
  const toggleCompare = (symbol: string) => update({ sel: toggleProphetSel(state.sel, symbol) });

  const selectionFull = state.sel.length >= PROPHET_SEL_MAX;

  const fetchStateBlock = (read: Read<never>, retry: () => void, testId: string) => {
    if (read.status === "loading") return <p className={styles.stateCopy} data-testid={testId}>{sectorT("loading")}</p>;
    if (read.status === "signed_out") return <p className={styles.stateCopy}>{sectorT("signedOut")}</p>;
    if (read.status === "denied") return <p className={styles.stateCopy}>{sectorT("denied")}</p>;
    if (read.status === "not_found") return <p className={styles.stateCopy} data-testid={`${testId}-notfound`}>{sectorT("notFound")}</p>;
    if (read.status === "invalid") return <p className={styles.stateCopy}>{sectorT("invalid")}</p>;
    if (read.status === "unavailable") {
      return (
        <div className={styles.stateCopy} data-testid={`${testId}-unavailable`} role="status">
          <p>{sectorT("unavailableYet")}</p>
          <p>{sectorT("unavailableNote")}</p>
          <button type="button" className={styles.smallButton} onClick={retry}>{sectorT("retryAction")}</button>
        </div>
      );
    }
    const retryAfterSec = read.status === "retry" ? read.retryAfterSec ?? null : null;
    return (
      <div className={styles.stateCopy} data-testid={`${testId}-retry`}>
        <p>{retryAfterSec !== null
          ? prophetSectorFill(sectorT("retryRateLimited"), { n: retryAfterSec })
          : sectorT("retry")}</p>
        <button type="button" className={styles.smallButton} onClick={retry}>{sectorT("retryAction")}</button>
      </div>
    );
  };

  if (indexReady === null) {
    return (
      <div className={styles.board} data-testid="prophet-today-board">
        <header className={styles.masthead}>
          <div>
            <h2>{t("todayTitle")}</h2>
            <p className={styles.mastheadSub}>{t("todaySubtitle")}</p>
          </div>
          <p className={styles.mastheadMeta}>{t("todayDescriptive")}</p>
        </header>
        {fetchStateBlock(indexFetch.read as Read<never>, indexFetch.retry, "prophet-today-index")}
      </div>
    );
  }

  const sectorClock = indexReady.compatibility.sectorSession ?? sectorT("contextUnknown");
  const prophetClock = indexReady.compatibility.prophetAsof ?? sectorT("contextUnknown");

  return (
    <div className={styles.board} data-testid="prophet-today-board">
      <header className={styles.masthead}>
        <div>
          <h2>{t("todayTitle")}</h2>
          <p className={styles.mastheadSub}>{t("todaySubtitle")}</p>
        </div>
        <p className={styles.mastheadMeta}>
          {prophetSectorFill(t("todayCaptured"), { date: indexReady.capturedAt.slice(0, 10) })} · {t("todayDescriptive")}
        </p>
      </header>

      {focusGroup !== null ? (
        <SectorLeadershipHero
          group={focusGroup}
          compatibility={indexReady.compatibility}
          onOpenGroup={openGroup}
          derivedFocus={state.group === null}
          leadGroup={overallLead !== null ? nameOf(overallLead) : null}
          leadUnpublished={overallLead !== null && unpublished.includes(overallLead.id)}
        />
      ) : null}

      {state.sel.length > 0 ? (
        <div className={styles.selStrip} data-testid="prophet-today-sel" aria-label={t("todaySelected")}>
          <span className={styles.selLabel}>{t("todaySelected")}</span>
          {state.sel.map(symbol => (
            <span key={symbol} className={styles.selChip}>
              {symbol}
              <button
                type="button"
                aria-label={prophetSectorFill(t("todayCaseCompareRemove"), { symbol })}
                onClick={() => toggleCompare(symbol)}
              >
                ×
              </button>
            </span>
          ))}
          <span className={styles.selCount}>{prophetSectorFill(t("todaySelectedCount"), { n: state.sel.length })}</span>
          <button type="button" className={styles.researchAction} data-testid="prophet-today-compare-selected"
            disabled={state.sel.length < 2}
            onClick={() => update({ lane: "sector", view: "compare", group: focusId, symbol: null, plan: null })}>
            {t("todayCompareSelected")} →
          </button>
        </div>
      ) : null}
      {selectionFull && state.sel.length > 0 ? <p className={styles.selFull}>{t("todaySelectionFull")}</p> : null}

      {/* B1: the leadership table sits directly under the assessment, BEFORE
          the cases. At ≤640 the compact composition (SX06/SX08) moves it after
          the cases with one CSS order swap — the columns become a 44px list. */}
      <section className={styles.tablePanel} aria-labelledby="prophet-today-table-title" data-testid="prophet-today-leadership">
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle} id="prophet-today-table-title">{t("todayLeadershipTitle")}</h3>
          {/* P1-4: the hero already states the sector session; the table's
              as-of is dropped when it is the same clock. */}
          {focusGroup === null ? (
            <span className={styles.sectionBasis}>
              {prophetSectorFill(t("todayLeadershipBasis"), { date: sectorClock })}
            </span>
          ) : null}
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table} data-testid="prophet-today-table">
            <thead>
              <tr>
                <th scope="col">{t("colGroup")}</th>
                <th scope="col">{sectorT("contextGroupReturn")}</th>
                <th scope="col">{sectorT("contextRelative")}</th>
                {anyBreadth ? <th scope="col">{sectorT("contextBreadth")}</th> : null}
                <th scope="col">{t("todayRowResearch")}</th>
              </tr>
            </thead>
            <tbody>
              {leadership.map(group => {
                const ctx = group.context;
                const name = nameOf(group);
                const isHero = focusGroup !== null && group.id === focusGroup.id;
                return (
                  <tr
                    key={group.id}
                    tabIndex={0}
                    data-testid="prophet-today-leader-row"
                    className={isHero ? styles.heroRow : undefined}
                    aria-label={prophetSectorFill(t("todayGroupRowAria"), { group: name })}
                    onClick={() => openGroup(group.id)}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openGroup(group.id); } }}
                  >
                    <td className={styles.groupCell}>{name}</td>
                    <td className={ctx.groupReturnPct === null ? styles.dimCell : ctx.groupReturnPct > 0 ? styles.numUp : ctx.groupReturnPct < 0 ? styles.numDown : undefined}>
                      {ctx.groupReturnPct !== null ? pctSigned(ctx.groupReturnPct) : sectorT(contextNullKey(ctx.reasons.group_return_pct))}
                    </td>
                    <td className={ctx.relativePp === null ? styles.dimCell : ctx.relativePp > 0 ? styles.numUp : ctx.relativePp < 0 ? styles.numDown : undefined}>
                      {ctx.relativePp !== null ? ppSigned(ctx.relativePp) : sectorT(contextNullKey(ctx.reasons.relative_pp))}
                    </td>
                    {anyBreadth ? (
                      <td className={`${styles.breadthCell}${ctx.breadth === null ? ` ${styles.dimCell}` : ""}`}>
                        {ctx.breadth !== null ? `${ctx.breadth.aboveTrend}/${ctx.breadth.measured}` : sectorT(contextNullKey(ctx.reasons.breadth))}
                      </td>
                    ) : null}
                    {/* P1-3: a visible row action — the rows were clickable with
                        no affordance. The row itself stays the ONE tab stop; this
                        is its label, and a click bubbles to the row. */}
                    <td className={styles.researchCell}>
                      <span className={styles.researchAction} aria-hidden="true">
                        {t("todayRowResearch")} →
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.tableFoot}>
          <p>{prophetSectorFill(t("todayLeadershipShown"), { shown: leadership.length, total: indexReady.groups.length })}</p>
          <button type="button" className={styles.linkButton} data-testid="prophet-today-all-groups" onClick={openScreener}>
            {prophetSectorFill(t("todayLeadershipAll"), { n: indexReady.groups.length })} →
          </button>
        </div>
        {/* P1-5: breadth unavailable for every group — stated ONCE, in plain
            words, instead of a column of repeated pipeline vocabulary. */}
        {!anyBreadth ? (
          <p className={styles.tableNote} data-testid="prophet-today-breadth-note">
            {t("todayBreadthUnavailable")}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="prophet-today-cases-title">
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle} id="prophet-today-cases-title">
            {prophetSectorFill(t("todayCasesTitle"), { group: focusGroup !== null ? nameOf(focusGroup) : "" })}
          </h3>
          <span className={styles.sectionBasis}>
            {prophetSectorFill(t("todayCasesBasis"), { asof: prophetClock })}
          </span>
        </div>
        {casesRead.status === "ready" ? (
          casesReady !== null && casesReady.group !== null ? (
            shownCases.length > 0 ? (
              <>
                <div className={styles.caseGrid}>
                  {shownCases.map(member => (
                    <ResearchCaseCard
                      key={member.symbol}
                      member={member}
                      selected={state.sel.includes(member.symbol)}
                      selectionFull={selectionFull}
                      onToggleCompare={toggleCompare}
                      onOpenSetup={openSetup}
                      onOpenPlans={openPlans}
                    />
                  ))}
                </div>
                {furtherCases.length > 0 ? (
                  <details className={styles.moreCases} data-testid="prophet-today-more-cases">
                    <summary>
                      {t("todayStillDeveloping")} · {prophetSectorFill(t("todayCasesMore"), { n: furtherCases.length })}
                    </summary>
                    <div className={styles.caseGrid}>
                      {furtherCases.map(member => (
                        <ResearchCaseCard
                          key={member.symbol}
                          member={member}
                          selected={state.sel.includes(member.symbol)}
                          selectionFull={selectionFull}
                          onToggleCompare={toggleCompare}
                          onOpenSetup={openSetup}
                          onOpenPlans={openPlans}
                        />
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            ) : (
              <div className={styles.stateCopy} role="status">
                <p>{t("todayCasesNone")}</p>
              </div>
            )
          ) : (
            // group null on a 200: the fail-closed read — group context is
            // unavailable and the wire says so; never an empty-looking list.
            <div className={styles.stateCopy} data-testid="prophet-today-cases-unavailable" role="status">
              <p>{sectorT("verdictSectorDown")}</p>
            </div>
          )
        ) : focusId !== null ? (
          fetchStateBlock(casesRead as Read<never>, casesFetch.retry, "prophet-today-cases")
        ) : null}
      </section>
    </div>
  );
}

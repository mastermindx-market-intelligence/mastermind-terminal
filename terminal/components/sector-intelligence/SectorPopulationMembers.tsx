"use client";
/**
 * Basket member list (COO order 2, 2026-11-10) — the sole consumer of the
 * population route through `fetchSectorPopulation`. One fetcher + decoder
 * module feeds this surface; nothing here parses the wire itself.
 *
 * Honesty laws this table owns:
 *   - `industry` (GICS) and `sub_industry` are TWO separate current-basis
 *     columns, each with its own unavailable reason — never merged, never
 *     dated as if point-in-time.
 *   - Unserved members are accounted-but-unmeasured: rendered in their own
 *     visible section with a closed reason, never hidden from the counts.
 *   - Removed members appear as a count note, never as gaps in the table.
 *   - Counts are counts: "measured {served} of {configured} configured" and
 *     nothing stronger — `complete: true` is never rendered as "all members"
 *     (R3-S1 can drop a whole basket with no refusal row).
 *   - A refused basket says so: owner refused observation, members unmeasured.
 *   - 401 is the only sign-in state; 503/5xx/network offer Retry, never sign-in.
 *   - 409 CURSOR_RESET (and a 400 on a server-given cursor until lane 1's fix)
 *     restarts page one instead of silently losing the list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { fetchSectorPopulation, POPULATION_QUERY,
  type PopulationPage, type PopulationRead, type PopulationUnservedReason } from "@/lib/sectorPopulation";
import { nativeFill } from "./SectorNativeJobShell";
import styles from "./SectorNative.module.css";
import shell from "./SectorIntelligenceWorkspace.module.css";

const UNSERVED_SHOWN = 100;

const REASON_KEYS: Record<PopulationUnservedReason, string> = {
  absent_from_price_panel: "siPopulationReasonAbsentPanel",
  not_observed_at_effective_as_of: "siPopulationReasonNotObserved",
  group_refused_by_owner_observation: "siPopulationReasonOwnerRefused",
  unaccounted_by_owner: "siPopulationReasonUnaccounted",
};
const taxonomyLabel = (t: ReturnType<typeof useSectorT>, status: string, reason: string | undefined, label: string | undefined): string => {
  if (status === "available") return label ?? "—";
  if (reason === "not_in_current_classification") return t("siPopulationTaxonomyNotClassified");
  return nativeFill(t("siPopulationTaxonomyUnavailable"), { reason: reason ?? "unknown" });
};

export default function SectorPopulationMembers() {
  const t = useSectorT();
  const { lang } = useLang();
  const [pages, setPages] = useState<PopulationPage[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | PopulationRead["status"]>("loading");
  const [group, setGroup] = useState<string>("");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [cursorNote, setCursorNote] = useState<string | null>(null);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  // Language must not re-trigger the fetch cycle; copy is read at paint time.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  /** One bounded request cycle: aborts the previous flight, keeps a sequence so
   * a late reply for an older filter can never overwrite a newer one. */
  const run = useCallback(async (opts: { cursor?: string; restartNote?: string | null }) => {
    const mine = ++seq.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    // Phase transitions are the CALLERS' (handlers own the synchronous "loading"
    // set; cursor continuations keep "ready" so the list stays visible).
    const read = await fetchSectorPopulation({
      group: group || undefined, q: applied ?? undefined,
      cursor: opts.cursor, signal: controller.signal,
    }).catch(() => null as PopulationRead | null);
    if (mine !== seq.current) return;
    if (read === null) { setPhase("retry"); return; }
    if (read.status === "ok") {
      setPages(previous => opts.cursor ? [...previous, read.page] : [read.page]);
      setPhase("ready");
      setCursorNote(opts.restartNote ?? null);
      return;
    }
    if (read.status === "cursor_reset") {
      // The capture or binding moved under us (or the cursor is no longer
      // recognised): restart page one with the SAME filter; never drop the
      // reader into a half-old, half-new list.
      setPages([]);
      setPhase("loading");
      const fresh = await fetchSectorPopulation({
        group: group || undefined, q: applied ?? undefined, signal: controller.signal,
      }).catch(() => null as PopulationRead | null);
      if (mine !== seq.current) return;
      if (fresh === null) setPhase("retry");
      else if (fresh.status === "ok") { setPages([fresh.page]); setPhase("ready"); }
      else setPhase(fresh.status);
      setCursorNote(tRef.current("siPopulationCursorReset"));
      return;
    }
    setPages([]);
    setPhase(read.status);
  }, [group, applied]);

  useEffect(() => {
    void run({});
    return () => { seq.current++; abort.current?.abort(); };
  }, [run]);

  const head = pages[0] ?? null;
  const counts = head?.counts ?? null;
  const rows = pages.flatMap(page => page.rows);
  const nextCursor = pages.length ? pages[pages.length - 1].nextCursor : null;
  const groupIndex = head?.groupIndex ?? null;
  const visibleGroup = group ? (head?.groups.find(entry => entry.groupId === group) ?? null) : null;
  const refusedSelected = group ? (visibleGroup?.refusedByOwner
    || groupIndex?.find(entry => entry.groupId === group)?.refusedByOwner || false) : false;
  const unserved = applied !== null && head?.unservedMatching ? head.unservedMatching
    : counts ? (group ? counts.unservedMembers.filter(entry => entry.groupId === group) : counts.unservedMembers)
    : [];
  const removed = counts?.removedMembers ?? null;

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    if (next !== "" && !POPULATION_QUERY.test(next)) return; // inline guard below renders the reason
    setApplied(next === "" ? null : next);
    setPhase("loading");
  };

  const searchInvalid = query.trim() !== "" && !POPULATION_QUERY.test(query.trim());
  const localize = (value: string | null | undefined, zh: string | null | undefined): string =>
    lang === "zh" ? zh || value || "—" : value || "—";

  return <section className={styles.card} data-testid="sector-population-members">
    <h2 className={styles.cardTitle}>{t("siPopulationTitle")}</h2>
    <p className={styles.stateCopy}>{t("siPopulationIntro")}</p>
    {counts ? <p className={styles.chartNote} data-testid="sector-population-counts">
      {nativeFill(t("siPopulationCounts"), { served: String(counts.served), configured: String(counts.configuredCurrent) })}
      {" · "}{nativeFill(t("siPopulationCountsUnserved"), { n: String(counts.accountedUnserved) })}
      {counts.unaccounted > 0 ? ` · ${nativeFill(t("siPopulationCountsUnaccounted"), { n: String(counts.unaccounted) })}` : ""}
      {" · "}{nativeFill(t("siPopulationGroups"), { n: String(counts.groups) })}
      {head ? ` · ${nativeFill(t("siPopulationAsOf"), { session: head.sourceSession })}` : ""}
    </p> : null}

    <div className={styles.populationControls}>
      <label className={styles.populationLabel} htmlFor="sector-population-group">{t("siPopulationGroupLabel")}</label>
      <select id="sector-population-group" className={shell.button} value={group}
        onChange={event => { setGroup(event.target.value); setPhase("loading"); }} disabled={!groupIndex}>
        <option value="">{t("siPopulationGroupAll")}</option>
        {groupIndex?.map(entry => <option key={entry.groupId} value={entry.groupId}>
          {entry.refusedByOwner
            ? nativeFill(t("siPopulationRefusedGroupOption"), { name: entry.name ?? entry.groupId })
            : nativeFill(t("siPopulationGroupOption"), { name: entry.name ?? entry.groupId, n: String(entry.membersListed) })}
        </option>)}
      </select>
      <form className={styles.populationSearch} onSubmit={submitSearch} role="search">
        <label className={styles.populationLabel} htmlFor="sector-population-q">{t("siPopulationSearchLabel")}</label>
        <input id="sector-population-q" className={styles.populationInput} value={query}
          onChange={event => setQuery(event.target.value)} autoComplete="off"
          aria-invalid={searchInvalid} placeholder={t("siPopulationSearchLabel")} />
        <button type="submit" className={shell.button} disabled={searchInvalid}>{t("siPopulationSearchSubmit")}</button>
        {applied !== null && <button type="button" className={shell.button}
          onClick={() => { setQuery(""); setApplied(null); setPhase("loading"); }}>{t("siPopulationSearchClear")}</button>}
      </form>
    </div>
    {searchInvalid ? <p className={styles.stateCopy} role="alert">{t("siPopulationSearchInvalid")}</p> : null}
    {refusedSelected ? <p className={styles.stateCopy} data-testid="sector-population-refused">{t("siPopulationRefusedBanner")}</p> : null}
    {cursorNote ? <p className={styles.chartNote} data-testid="sector-population-cursor-reset">{cursorNote}</p> : null}

    {phase === "loading" ? <p className={styles.stateCopy} data-testid="sector-population-loading">{t("siPopulationLoading")}</p>
      : phase === "signed_out" ? <p className={styles.stateCopy} data-testid="sector-population-signed-out">{t("siPopulationSignedOut")}</p>
      : phase === "denied" ? <p className={styles.stateCopy}>{t("siPopulationDenied")}</p>
      : phase === "retry" || phase === "invalid" || phase === "invalid_request" ? <div className={styles.stateCopy}>
        <p>{t("siPopulationRetry")}</p>
        <div className={styles.heroActions}>
          <button type="button" className={styles.secondaryButton}
            onClick={() => { setPhase("loading"); void run({}); }}>{t("siPopulationRetryAction")}</button>
        </div>
      </div>
      : phase === "ready" && head ? <div className={styles.populationTableWrap}>
        <table className={styles.populationTable} data-testid="sector-population-table">
          <thead><tr>
            <th scope="col">{t("siPopulationColumnSymbol")}</th>
            <th scope="col">{t("siPopulationColumnName")}</th>
            <th scope="col">{t("siPopulationColumnIndustry")}</th>
            <th scope="col">{t("siPopulationColumnSubIndustry")}</th>
            <th scope="col">{t("siPopulationColumnMemberSince")}</th>
            <th scope="col">{t("siPopulationColumnAlsoIn")}</th>
          </tr></thead>
          <tbody>
            {rows.map(row => <tr key={`${row.groupId}:${row.symbol}`}>
              <td>{row.symbol}</td>
              <td>{row.name}</td>
              <td>{taxonomyLabel(t, row.industry.status, row.industry.status === "unavailable" ? row.industry.reason : undefined,
                row.industry.status === "available" ? row.industry.label : undefined)}</td>
              <td>{taxonomyLabel(t, row.subIndustry.status, row.subIndustry.status === "unavailable" ? row.subIndustry.reason : undefined,
                row.subIndustry.status === "available" ? localize(row.subIndustry.label, row.subIndustry.labelZh) : undefined)}</td>
              <td>{row.membership.effectiveOn ?? t("siPopulationMemberSinceCurrent")}</td>
              <td>{row.alsoInGroups > 0 ? String(row.alsoInGroups) : "—"}</td>
            </tr>)}
          </tbody>
        </table>
        <p className={styles.chartNote}>
          {nativeFill(t("siPopulationShown"), { shown: String(rows.length), total: String(head.totalMatching) })}
          {nextCursor !== null ? <button type="button" className={shell.button}
            data-testid="sector-population-load-more"
            onClick={() => void run({ cursor: nextCursor })}>{t("siPopulationLoadMore")}</button> : null}
        </p>
      </div>
      : null}

    {phase === "ready" && head ? <div className={styles.populationUnserved} data-testid="sector-population-unserved">
      <h3 className={styles.cardTitle}>{nativeFill(t("siPopulationUnservedTitle"), { n: String(unserved.length) })}</h3>
      <p className={styles.stateCopy}>{applied !== null ? t("siPopulationUnservedMatchingNote") : t("siPopulationUnservedNote")}</p>
      {unserved.length ? <table className={styles.populationTable}>
        <thead><tr>
          <th scope="col">{t("siPopulationColumnSymbol")}</th>
          <th scope="col">{t("siPopulationColumnGroupName")}</th>
          <th scope="col">{t("siPopulationColumnReason")}</th>
        </tr></thead>
        <tbody>
          {unserved.slice(0, UNSERVED_SHOWN).map(entry => <tr key={`${entry.groupId}:${entry.symbol}:${entry.reason}`}>
            <td>{entry.symbol}</td>
            <td>{entry.groupId}</td>
            <td>{t(REASON_KEYS[entry.reason])}</td>
          </tr>)}
        </tbody>
      </table> : null}
      {unserved.length > UNSERVED_SHOWN ? <p className={styles.chartNote}>
        {nativeFill(t("siPopulationMoreHidden"), { n: String(unserved.length - UNSERVED_SHOWN) })}</p> : null}
    </div> : null}

    {phase === "ready" && removed ? <p className={styles.chartNote} data-testid="sector-population-removed">
      {removed.status === "available"
        ? nativeFill(t("siPopulationRemovedNote"), { n: String(removed.n), version: removed.version })
        : t("siPopulationRemovedUnavailable")}
    </p> : null}
  </section>;
}

"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useLang, type Lang } from "@/lib/i18n";
import { filterProphetCandidates, type ProphetCandidate, type ProphetCandidatePool } from "@/lib/prophetCandidates";
import { writeProphetState, type ProphetUrlState } from "@/lib/prophetUrlState";
import { candidateReason, candidateT, type CandidateKey } from "./candidateStrings";
import { useProphetCandidates } from "./useProphetCandidates";
import { CandidateObservations } from "./CandidateObservations";
import { SaveFollow } from "../setup/SaveFollow";
import s from "./candidates.module.css";

const PAGE_SIZE = 50;
const number = (n: number, lang: Lang) => n.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
function publishedDate(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}
function Arrow({ back = false }: { back?: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={back ? { transform: "rotate(180deg)" } : undefined}><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}
function Score({ row, lang }: { row: ProphetCandidate; lang: Lang }) {
  return <div className={s.score}>
    <strong className={row.prophet === null ? s.unscored : undefined}>{row.prophet === null ? candidateT(lang, "noScore") : row.prophet.score.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
    <span>{candidateT(lang, row.prophet === null ? row.in_buy_lane ? "noScoreMain" : "noScoreOutside" : "score")}</span>
  </div>;
}
function Search({ query, lang, onSearch }: { query: string; lang: Lang; onSearch: (query: string) => void }) {
  const [editing, setEditing] = useState({ query, draft: query }), id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  // Adopt Back/Forward without replacing the input node or losing focus.
  if (editing.query !== query) setEditing({ query, draft: query });
  const draft = editing.query === query ? editing.draft : query;
  return <form className={s.search} role="search" onSubmit={event => { event.preventDefault(); onSearch(draft.trim()); }}>
    <label htmlFor={id}>{candidateT(lang, "searchLabel")}</label>
    <div className={s.searchControls}>
      <div className={s.searchInput}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input ref={input} id={id} type="search" value={draft} onChange={event => setEditing({ query, draft: event.target.value })} maxLength={64} autoComplete="off" placeholder={candidateT(lang, "searchPlaceholder")} />
      </div>
      <button type="submit" className={s.button}>{candidateT(lang, "search")}</button>
    </div>
    {query && <button className={s.textButton} type="button" onClick={() => { input.current?.focus(); onSearch(""); }}>{candidateT(lang, "clear")}</button>}
  </form>;
}

function SourceDetails({ pool, row, lang, detailRef }: { pool: ProphetCandidatePool; row: ProphetCandidate | null; lang: Lang; detailRef: React.RefObject<HTMLDetailsElement | null> }) {
  const reasons = [...new Set([row?.headline_reason, ...row?.lane_reasons ?? []].filter((value): value is string => !!value))];
  return <details className={s.sources} ref={detailRef}>
    <summary>{candidateT(lang, "sources")}</summary>
    <div className={s.sourceBody}>
      <p>{candidateT(lang, "method")}</p><p>{candidateT(lang, "scoring")}</p><p>{candidateT(lang, "clock")}</p>
      <dl className={s.receipt} aria-label={candidateT(lang, "receipt")}>
        <div><dt>{candidateT(lang, "sourceHash")}</dt><dd><code>{pool.source.sha256}</code></dd></div>
        <div><dt>{candidateT(lang, "projectionHash")}</dt><dd><code>{pool.projection.source_digest}</code></dd></div>
        {reasons.length > 0 && <div><dt>{candidateT(lang, "rawReasons")}</dt><dd>{reasons.map(reason => <code key={reason}>{reason}</code>)}</dd></div>}
      </dl>
    </div>
  </details>;
}

export function ProphetCandidatesView({ state, update }: { state: ProphetUrlState; update: (patch: Partial<ProphetUrlState>) => void }) {
  const { lang } = useLang();
  const t = (key: CandidateKey, values?: Record<string, string | number>) => candidateT(lang, key, values);
  const read = useProphetCandidates();
  const pool = read.status === "ready" ? read.pool : null;
  const row = pool?.projection.rows.find(candidate => candidate.ticker === state.symbol) ?? null;
  const heading = useRef<HTMLHeadingElement | null>(null), sourceRef = useRef<HTMLDetailsElement | null>(null);
  const resultsHeading = useRef<HTMLParagraphElement | null>(null), pendingRange = useRef(false);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const previousSymbol = useRef(state.symbol), pendingFocus = useRef<string | "heading" | null>(null);
  useEffect(() => {
    if (previousSymbol.current !== state.symbol) {
      pendingFocus.current = state.symbol ? "heading" : previousSymbol.current;
      previousSymbol.current = state.symbol;
    }
    if (!pool || !pendingFocus.current) return;
    const target = pendingFocus.current === "heading" ? heading.current : rowButtons.current.get(pendingFocus.current) ?? heading.current;
    target?.focus(); pendingFocus.current = null;
  }, [state.symbol, pool]);
  useEffect(() => {
    if (!pendingRange.current || !resultsHeading.current) return;
    resultsHeading.current.focus(); resultsHeading.current.scrollIntoView?.({ block: "start" }); pendingRange.current = false;
  }, [state.offset, state.q]);
  const back = () => update({ symbol: null, view: "overview" });
  const sourceAction = () => {
    if (!sourceRef.current) return;
    sourceRef.current.open = true;
    sourceRef.current.querySelector("summary")?.focus();
    sourceRef.current.scrollIntoView?.({ behavior: "instant", block: "nearest" });
  };
  const list = pool ? filterProphetCandidates(pool.projection.rows, state.q) : [];
  const offset = Math.min(Math.floor(state.offset / PAGE_SIZE) * PAGE_SIZE, Math.max(0, Math.floor((list.length - 1) / PAGE_SIZE) * PAGE_SIZE));
  const page = list.slice(offset, offset + PAGE_SIZE);
  const select = (symbol: string) => update({ symbol, view: "setup" });
  const changePage = (next: number) => { pendingRange.current = true; update({ offset: next }); };
  const loginReturn = writeProphetState(new URL("https://prophet.invalid/prophet"), state, "canonical");
  const reasons = row ? [...new Set([row.headline_reason, ...row.lane_reasons ?? []].filter((value): value is string => !!value))] : [];

  return <section className={s.workspace} data-testid="prophet-candidates" aria-busy={read.status === "loading"}>
    <header className={s.header}>
      <div className={s.titleBlock}>
        {state.symbol && <button className={s.back} type="button" onClick={back}><Arrow back />{t("back")}</button>}
        <p className={s.eyebrow}>{t("market")}</p>
        <h2 ref={heading} tabIndex={-1}>{state.symbol ? row?.name || state.symbol : t("title")}</h2>
        <p className={s.subtitle}>{state.symbol ? [state.symbol, row?.sector].filter(Boolean).join(" · ") : t("subtitle")}</p>
      </div>
      <div className={s.tools}>
        {pool && <span className={s.date}><time dateTime={pool.projection.as_of}>{t("sourceDate", { date: publishedDate(pool.projection.as_of, lang) })}</time></span>}
        {pool && <button className={s.textButton} type="button" onClick={sourceAction}>{t("sources")}</button>}
        <button className={s.button} type="button" disabled={read.status === "loading"} onClick={read.refresh}>{t(read.status === "loading" ? "refreshing" : "refresh")}</button>
      </div>
    </header>

    {!pool ? <div className={s.notice} role="status" data-testid={`candidate-state-${read.status}`}>
      <h3>{t(`${read.status}Title` as CandidateKey)}</h3><p>{t(`${read.status}Body` as CandidateKey)}</p>
      {read.status === "loading" ? <div className={s.skeleton} aria-hidden="true"><span /><span /><span /></div>
        : read.status === "unauthenticated" ? <Link className={s.button} prefetch={false} href={`/login?next=${encodeURIComponent(loginReturn)}`}>{t("signIn")}</Link>
          : read.status === "forbidden" ? <Link className={s.button} prefetch={false} href="/settings">{t("access")}</Link>
            : <button type="button" className={s.button} onClick={read.refresh}>{t("retry")}</button>}
    </div> : state.symbol ? row ? <>
      <div className={s.detail} data-testid="candidate-detail">
        <section className={s.reasonSection}>
          <h3>{t("recordedReason")}</h3><p className={s.leadReason}>{candidateReason(row.headline_reason, lang)}</p>
          <p className={s.note}>{t("note")}</p>
        </section>
        <dl className={s.facts}>
          <div><dt>{t("membership")}</dt><dd>{t(row.in_buy_lane ? "mainMember" : "outsideMember")}</dd></div>
          <div><dt>{t("screenPosition")}</dt><dd>{row.pool_rank === null ? t("notPublished") : number(row.pool_rank, lang)}</dd></div>
          <div><dt>{t("score")}</dt><dd><Score row={row} lang={lang} /></dd></div>
        </dl>
        {reasons.length > 0 && <section className={s.reasons}><h3>{t("recordedReasons")}</h3><ul>{[...new Set(reasons.map(code => candidateReason(code, lang)))].map(reason => <li key={reason}>{reason}</li>)}</ul></section>}
      </div>
      <CandidateObservations key={row.ticker} symbol={row.ticker} />
      <SaveFollow key={`save:${row.ticker}`} symbol={row.ticker} />
      <section className={s.nextSection}>
        <h3>{t("next")}</h3><div className={s.destinations}>
          <Link className={s.destination} prefetch={false} href={`/analysis?symbol=${encodeURIComponent(row.ticker)}&page=intelligence`}><strong>{t("intelligence")} <Arrow /></strong><span>{t("intelligenceBody")}</span></Link>
          <button type="button" className={s.destination} onClick={() => update({ lane: "plans", plan: null })}><strong>{t("plans")} <Arrow /></strong><span>{t("plansBody")}</span></button>
        </div>
      </section>
    </> : <div className={s.notice} role="status"><h3>{t("absentTitle")}</h3><p>{t("absentBody", { symbol: state.symbol })}</p><button className={s.button} type="button" onClick={back}>{t("back")}</button></div> : <>
      <dl className={s.counts} aria-label={t("title")}>
        <div><dt>{t("total")}</dt><dd>{number(pool.projection.counts.eligible, lang)}</dd></div>
        <div><dt>{t("main")}</dt><dd>{number(pool.projection.counts.in_buy_lane, lang)}</dd></div>
        <div><dt>{t("outside")}</dt><dd>{number(pool.projection.counts.off_buy_lane, lang)}</dd></div>
        <div className={s.unscoredCount}><dt>{t("unscored")}</dt><dd>{number(pool.projection.counts.unscored, lang)}</dd></div>
      </dl>
      {pool.projection.status === "empty" ? <div className={s.notice} role="status"><h3>{t("emptyTitle")}</h3><p>{t("emptyBody")}</p></div> : <>
        <div className={s.listTools}><Search query={state.q} lang={lang} onSearch={q => update({ q, offset: 0 })} /><p ref={resultsHeading} tabIndex={-1} className={s.resultCount} role="status">{t("results", { shown: number(list.length, lang), total: number(pool.projection.counts.eligible, lang) })}{list.length > PAGE_SIZE && <span className={s.range}>{t("page", { first: number(offset + 1, lang), last: number(Math.min(offset + PAGE_SIZE, list.length), lang), total: number(list.length, lang) })}</span>}</p></div>
        {list.length === 0 ? <div className={s.notice} role="status"><h3>{t("noMatchesTitle")}</h3><p>{t("noMatchesBody")}</p><button className={s.button} type="button" onClick={() => { pendingRange.current = true; update({ q: "", offset: 0 }); }}>{t("clear")}</button></div> : <>
          <ul className={s.list} aria-label={t("title")}>
            {page.map(candidate => <li key={candidate.ticker} className={s.row} data-testid="candidate-row">
              <div className={s.company}><h3>{candidate.ticker}<span>{candidate.sector}</span></h3><p>{candidate.name || t("notPublished")}</p></div>
              <div className={s.rowReason}><p>{candidateReason(candidate.headline_reason, lang)}</p><span>{t(candidate.in_buy_lane ? "mainMember" : "outsideMember")} · {candidate.pool_rank === null ? t("noPosition") : t("position", { rank: number(candidate.pool_rank, lang) })}</span></div>
              <Score row={candidate} lang={lang} />
              <button type="button" className={s.inspect} ref={node => { if (node) rowButtons.current.set(candidate.ticker, node); else rowButtons.current.delete(candidate.ticker); }} aria-label={t("inspectLabel", { symbol: candidate.ticker })} onClick={() => select(candidate.ticker)}>{t("inspect")} <Arrow /></button>
            </li>)}
          </ul>
          {list.length > PAGE_SIZE && <nav className={s.pagination} aria-label={t("pagination")}><span>{t("page", { first: number(offset + 1, lang), last: number(Math.min(offset + PAGE_SIZE, list.length), lang), total: number(list.length, lang) })}</span><div><button type="button" className={s.button} disabled={offset === 0} onClick={() => changePage(offset - PAGE_SIZE)}>{t("previous")}</button><button type="button" className={s.button} disabled={offset + PAGE_SIZE >= list.length} onClick={() => changePage(offset + PAGE_SIZE)}>{t("nextPage")}</button></div></nav>}
        </>}
      </>}
      <p className={s.note}>{t("note")}</p>
    </>}
    {pool && <SourceDetails pool={pool} row={row} lang={lang} detailRef={sourceRef} />}
  </section>;
}

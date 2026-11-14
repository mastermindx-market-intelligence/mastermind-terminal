"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { companyHref } from "@/lib/sectorIntelligence";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
import { decodeProphetCandidatePool, candidateScore, PROPHET_CANDIDATE_URL, type ProphetCandidateRead } from "@/lib/prophetCandidatePool";
import { PROPHET_CANDIDATE_QUERY, writeProphetState, type ProphetUrlState } from "@/lib/prophetUrlState";
import { candidateDecision, candidateDecisionKnown } from "./candidateDecision";
import s from "./candidates.module.css";

export type ProphetCandidateBoundary = {
  scope: { current: AbortController | null };
  invalidateIdentity: () => void;
};
type Props = {
  reading: ProphetCandidateBoundary;
  state: ProphetUrlState;
  update: (patch: Partial<ProphetUrlState>) => void;
};
type Read = {
  phase: "loading" | "ready" | "unavailable" | "access";
  data: ProphetCandidateRead | null;
  generation: AbortController | null;
};
function prepareRead(scope: ProphetCandidateBoundary["scope"], request: { current: AbortController | null }) {
  const generation = scope.current;
  if (!generation || generation.signal.aborted) return null;
  request.current?.abort();
  const controller = new AbortController(); request.current = controller;
  return { generation, controller };
}
const COPY = {
  en: {
    title: "All eligible candidates", intro: "Follow the screening evidence, including names outside the main list.",
    sourceDate: "Source", dateUnavailable: "Date unavailable", sources: "Sources & method", refresh: "Refresh", loading: "Reading the candidate publication…",
    candidates: "Candidates", mainList: "In the main list", outside: "Outside the main list", unscored: "Without a final score",
    find: "Find ticker, company or sector", placeholder: "Search the full candidate pool", search: "Search", clear: "Clear search",
    searchInvalid: "Use up to 64 characters without control characters.", publishedOrder: "Published order",
    membership: "Main list", offMembership: "Outside main list", position: "Screen position", score: "Final score",
    notScored: "Not scored", scoreLabel: "Published final score", notSupplied: "Not supplied", outsideCohort: "Outside scoring cohort",
    inspect: "Inspect", back: "All candidates", retained: "search retained", noMatches: "No candidates match this search",
    noMatchesBody: "The full publication remains available. Clear your search to see every candidate.",
    empty: "No eligible candidates in this publication", emptyBody: "The complete source was read and contains no eligible candidates.",
    unavailable: "The candidate publication could not be verified", unavailableBody: "Try the source again or continue in the full Prophet workspace.",
    countUnknown: "Candidate count unavailable", access: "Your access does not include this candidate reading",
    accessBody: "Private candidate names are hidden. Your other available Prophet views remain accessible.", today: "Back to Prophet Today",
    retry: "Try again", absent: "is not in this publication", absentBody: "Return to the candidate list with your search retained. No substitute candidate has been selected.",
    reading: "Candidate reading", evidence: "Published candidate evidence", eligible: "This candidate appears in the publication’s eligible pool.",
    scope: "Eligibility is a screening result. The source keeps scoring and entry assessment separate.",
    scoreScope: "Final scores apply to the main-list scoring cohort. Screen position is not final rank.",
    decision: "Recorded decision", lane: "Published lane", tier: "Recorded screening tier", admission: "Recorded admission class",
    noCase: "A research case, entry assessment and exact model-plan relationship are not supplied in this reading.",
    continue: "Continue the investigation", company: "Open company intelligence", plans: "Browse model plans", full: "Full Prophet workspace",
    method: "This view preserves the complete eligible population and its published order. Search changes visibility, not the source counts.",
    sourcePath: "Source artifact", sourceHash: "Accepted source hash", projectionHash: "Display projection digest", sourceBytes: "Source bytes",
    provenance: "The source hash binds the accepted bytes. The display digest identifies the normalized projection. Neither verifies a Today selection, archive generation or plan relationship.",
  },
  zh: {
    title: "全部候选股票", intro: "查看筛选依据，主榜之外的候选也保留在这里。",
    sourceDate: "来源截至", dateUnavailable: "日期不可用", sources: "来源与方法", refresh: "刷新", loading: "正在读取候选发布数据…",
    candidates: "候选股票", mainList: "在主榜", outside: "在主榜之外", unscored: "尚无最终评分",
    find: "查找代码、公司或板块", placeholder: "搜索全部候选", search: "搜索", clear: "清除搜索",
    searchInvalid: "请输入最多 64 个字符，不包含控制字符。", publishedOrder: "来源顺序",
    membership: "主榜标的", offMembership: "主榜之外", position: "筛选位置", score: "最终评分",
    notScored: "未评分", scoreLabel: "主榜评分", notSupplied: "未提供", outsideCohort: "不在评分范围",
    inspect: "查看候选", back: "全部候选", retained: "保留搜索", noMatches: "没有符合搜索的候选",
    noMatchesBody: "完整发布数据仍然可用。清除搜索即可查看全部候选。",
    empty: "本次发布没有符合条件的候选", emptyBody: "已完整读取来源，其中没有符合条件的候选股票。",
    unavailable: "无法核验候选发布数据", unavailableBody: "可重试来源，或在完整 Prophet 工作台继续研究。",
    countUnknown: "候选数量不可用", access: "当前权限不包含此候选读数",
    accessBody: "私人候选名称已隐藏。其他已获授权的 Prophet 视图仍可使用。", today: "返回 Prophet 今日",
    retry: "重试", absent: "不在本次发布中", absentBody: "可返回候选列表并保留搜索。系统未选择替代候选。",
    reading: "候选读数", evidence: "已发布候选依据", eligible: "此候选出现在本次发布的合格候选池中。",
    scope: "候选资格属于筛选结果。来源将评分与入场评估分别记录。",
    scoreScope: "最终评分适用于主榜评分范围。筛选位置并非最终排名。",
    decision: "已记录的决策", lane: "已发布分区", tier: "已记录的筛选等级", admission: "已记录的准入类别",
    noCase: "此读数未提供研究案例、入场评估或与具体模型计划的对应关系。",
    continue: "继续研究", company: "打开公司情报", plans: "浏览模型计划", full: "完整 Prophet 工作台",
    method: "本视图保留全部符合条件的候选及其发布顺序。搜索只改变显示结果，不改变来源数量。",
    sourcePath: "来源文件", sourceHash: "已接受来源哈希", projectionHash: "显示投影摘要", sourceBytes: "来源字节数",
    provenance: "来源哈希对应已接受的原始字节，显示摘要对应规范化投影。两者都不核验今日精选、归档版本或计划对应关系。",
  },
} as const;

export function ProphetCandidateView({ reading: { scope, invalidateIdentity }, state, update }: Props) {
  const { lang } = useLang(), c = COPY[lang];
  const [read, setRead] = useState<Read>({ phase: "loading", data: null, generation: null });
  const request = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState(state.q), [queryError, setQueryError] = useState(false);
  const [previousQuery, setPreviousQuery] = useState(state.q);
  // A committed URL change replaces the draft before paint, including Back
  // to an earlier query. It must not resurrect an unsubmitted former draft.
  if (previousQuery !== state.q) {
    setPreviousQuery(state.q); setDraft(state.q); setQueryError(false);
  }
  const scroll = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement | null>(null);
  const sources = useRef<HTMLDetailsElement | null>(null), sourceSummary = useRef<HTMLElement | null>(null);
  const openers = useRef(new Map<string, HTMLAnchorElement>());
  const listScroll = useRef(0), previousSymbol = useRef(state.symbol);
  const pendingFocus = useRef<{ symbol: string | null; from: string | null } | null>(null);

  const startRead = useCallback(({ generation, controller }: { generation: AbortController; controller: AbortController }) => {
    void readingJson(scope, PROPHET_CANDIDATE_URL, { signal: controller.signal }).then(({ response, value }) => {
      if (request.current !== controller || controller.signal.aborted || scope.current !== generation || generation.signal.aborted) return;
      if (response.status === 401) { invalidateIdentity(); return; }
      if (response.status === 403) { setRead({ phase: "access", data: null, generation }); return; }
      const data = decodeProphetCandidatePool(value);
      if (response.ok && data && data.projection.status !== "unavailable") setRead({ phase: "ready", data, generation });
      else setRead({ phase: "unavailable", data: response.status === 503 && data?.projection.status === "unavailable" ? data : null, generation });
    }).catch(() => {
      if (request.current === controller && !controller.signal.aborted && scope.current === generation && !generation.signal.aborted) {
        setRead({ phase: "unavailable", data: null, generation });
      }
    });
  }, [scope, invalidateIdentity]);
  const load = useCallback(() => {
    const lifetime = prepareRead(scope, request); if (!lifetime) return;
    setRead({ phase: "loading", data: null, generation: lifetime.generation });
    startRead(lifetime);
  }, [scope, startRead]);
  useEffect(() => {
    const lifetime = prepareRead(scope, request); if (!lifetime) return;
    // Initial/account-generation state already renders loading. The effect
    // only starts the external read; manual refresh clears accepted data first.
    startRead(lifetime);
    return () => { request.current?.abort(); request.current = null; };
  }, [scope, startRead]);

  const active = read.generation === scope.current && !scope.current?.signal.aborted;
  const phase = active ? read.phase : "loading", data = active ? read.data : null;
  const projection = data?.projection, rows = projection?.rows ?? [];
  const selected = state.symbol ? rows.find(row => row.ticker.toUpperCase() === state.symbol) : null;
  const query = state.q.trim().toLowerCase();
  const visible = rows.filter(row => !query || [row.ticker, row.name, row.sector].some(value => value?.toLowerCase().includes(query)));
  const ready = phase === "ready" && projection !== undefined;

  useLayoutEffect(() => {
    if (previousSymbol.current !== state.symbol) {
      pendingFocus.current = { symbol: state.symbol, from: previousSymbol.current };
      previousSymbol.current = state.symbol;
    }
    const pending = pendingFocus.current;
    if (!pending || phase === "loading") return;
    pendingFocus.current = null;
    if (pending.symbol) {
      if (scroll.current) scroll.current.scrollTop = 0;
      heading.current?.focus({ preventScroll: true });
    } else {
      const opener = pending.from ? openers.current.get(pending.from) : null;
      if (scroll.current) scroll.current.scrollTop = listScroll.current;
      (opener ?? heading.current)?.focus({ preventScroll: true });
    }
  }, [state.symbol, phase, data]);

  const href = (patch: Partial<ProphetUrlState>) => writeProphetState(
    new URL(typeof window === "undefined" ? "https://local.invalid/prophet" : window.location.href),
    { ...state, ...patch },
  );
  const follow = (event: MouseEvent<HTMLAnchorElement>, patch: Partial<ProphetUrlState>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (patch.symbol && !state.symbol) listScroll.current = scroll.current?.scrollTop ?? 0;
    update(patch);
  };
  const showSources = () => {
    if (!sources.current) return;
    sources.current.open = true;
    sourceSummary.current?.focus();
    sourceSummary.current?.scrollIntoView({ block: "start" });
  };
  const planPatch: Partial<ProphetUrlState> = { lane: "plans", plan: null, symbol: null, group: null, view: "overview", q: "", offset: 0, state: null };
  const backPatch: Partial<ProphetUrlState> = { symbol: null, group: null, view: "overview" };
  const company = selected ? companyHref(selected.ticker.toUpperCase()) : null;
  const clearSearch = () => { setDraft(""); setQueryError(false); update({ q: "", offset: 0 }); };

  return <section className={s.root} ref={scroll} aria-labelledby="prophet-candidate-heading" data-testid="prophet-candidates" data-read-state={phase} data-source-status={projection?.status}>
    <div className={s.content}>
      {state.symbol && <a className={s.back} href={href(backPatch)} onClick={event => follow(event, backPatch)}>← {c.back}{state.q ? ` · ${c.retained}` : ""}</a>}
      <header className={s.header}>
        <div className={s.heading}>
          {selected && <p className={s.eyebrow}>{selected.ticker}{selected.sector ? ` · ${selected.sector}` : ""}</p>}
          <h2 id="prophet-candidate-heading" tabIndex={-1} ref={heading}>{selected ? selected.name || selected.ticker : state.symbol ? c.reading : c.title}</h2>
          <p>{selected ? c.reading : c.intro}</p>
        </div>
        <div className={s.headerActions}>
          {projection && <span className={s.sourceDate}>{c.sourceDate} · {projection.as_of ? <time dateTime={projection.as_of}>{projection.as_of}</time> : c.dateUnavailable}</span>}
          <button type="button" className={s.quiet} disabled={!data} onClick={showSources}>{c.sources}</button>
          <button type="button" className={s.action} disabled={phase === "loading"} onClick={load}>{c.refresh}</button>
        </div>
      </header>

      {phase === "loading" && <div className={s.notice} role="status"><span className={s.loadingMark} aria-hidden="true" />{c.loading}</div>}
      {phase === "access" && <div className={s.notice} role="status"><h3>{c.access}</h3><p>{c.accessBody}</p><button type="button" className={s.action} onClick={() => update({ lane: "today", symbol: null })}>{c.today}</button></div>}
      {phase === "unavailable" && <div className={s.notice} role="status"><span className={s.eyebrow}>{c.countUnknown}</span><h3>{c.unavailable}</h3><p>{c.unavailableBody}</p><button type="button" className={s.action} onClick={load}>{c.retry}</button></div>}

      {ready && state.symbol && !selected && <div className={s.notice} role="status"><h3><span>{state.symbol}</span> {c.absent}</h3><p>{c.absentBody}</p><a className={s.action} href={href(backPatch)} onClick={event => follow(event, backPatch)}>← {c.back}</a></div>}

      {ready && !state.symbol && <>
        <dl className={s.stats}>
          {[["eligible", c.candidates], ["in_buy_lane", c.mainList], ["off_buy_lane", c.outside], ["unscored", c.unscored]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{projection.counts[key as keyof typeof projection.counts]?.toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</dd></div>)}
        </dl>
        <div className={s.searchRow}>
          <form className={s.search} onSubmit={event => {
            event.preventDefault(); const next = draft.trim();
            if (next && !PROPHET_CANDIDATE_QUERY.test(next)) { setQueryError(true); return; }
            setQueryError(false); update({ q: next, offset: 0 });
          }}>
            <label htmlFor="prophet-candidate-search">{c.find}</label>
            <div className={s.searchControls}><input id="prophet-candidate-search" type="search" maxLength={64} value={draft} placeholder={c.placeholder} aria-invalid={queryError || undefined} aria-describedby={queryError ? "prophet-candidate-search-error" : undefined} onChange={event => { setDraft(event.target.value); setQueryError(false); }} /><button type="submit" className={s.action}>{c.search}</button></div>
            {queryError && <p id="prophet-candidate-search-error" role="alert">{c.searchInvalid}</p>}
          </form>
          <div className={s.matchCount} role="status" aria-live="polite"><span>{visible.length} / {rows.length} · {c.publishedOrder}</span>{(state.q || draft) && <button className={s.quiet} type="button" onClick={clearSearch}>{c.clear}</button>}</div>
        </div>
        {rows.length === 0 ? <div className={s.notice}><h3>{c.empty}</h3><p>{c.emptyBody}</p></div>
          : visible.length === 0 ? <div className={s.notice}><h3>{c.noMatches}</h3><p>{c.noMatchesBody}</p><button type="button" className={s.action} onClick={clearSearch}>{c.clear}</button></div>
          : <ul className={s.list} aria-label={c.candidates}>{visible.map(row => {
            const symbol = row.ticker.toUpperCase(), patch = { symbol, group: null, view: "setup" as const };
            return <li key={symbol} className={s.row}>
              <div className={s.identity}><h3>{row.ticker}</h3><span>{row.name || row.ticker}</span>{row.sector && <small>{row.sector}</small>}</div>
              <div className={s.decision}><p>{candidateDecision(row.headline_reason, lang)}</p>{row.headline_reason && !candidateDecisionKnown(row.headline_reason) && <code>{row.headline_reason}</code>}<small>{row.in_buy_lane ? c.membership : c.offMembership} · {c.position} {row.pool_rank ?? c.notSupplied}</small></div>
              <div className={s.score}><strong className={row.prophet ? "" : s.noScore}>{row.prophet ? candidateScore(row.prophet.score) : c.notScored}</strong><small>{row.prophet ? c.scoreLabel : row.in_buy_lane ? c.notScored : c.outsideCohort}</small></div>
              <a ref={node => { if (node) openers.current.set(symbol, node); else openers.current.delete(symbol); }} data-candidate={symbol} className={s.inspect} href={href(patch)} aria-label={`${c.inspect} ${row.ticker}`} onClick={event => follow(event, patch)}>{c.inspect}<span aria-hidden="true">→</span></a>
            </li>;
          })}</ul>}
        <p className={s.note}>{c.scope}</p>
      </>}

      {ready && selected && <div className={s.detailGrid}>
        <div className={s.detailMain}>
          <section className={s.evidence} aria-label={c.evidence}>
            <span className={s.eyebrow}>{selected.in_buy_lane ? c.membership : c.offMembership}</span>
            <h3>{candidateDecision(selected.headline_reason, lang)}</h3><p>{c.eligible}</p>
            <dl className={s.measurements}><div><dt>{c.position}</dt><dd>{selected.pool_rank ?? c.notSupplied}</dd></div><div><dt>{c.score}</dt><dd>{selected.prophet ? candidateScore(selected.prophet.score) : c.notScored}</dd></div></dl>
            <p className={s.note}>{c.scoreScope}</p>
          </section>
          <section className={s.record} aria-labelledby="prophet-candidate-decision"><h3 id="prophet-candidate-decision">{c.decision}</h3>
            <ul>{(selected.lane_reasons?.length ? selected.lane_reasons : [selected.headline_reason]).map((reason, index) => <li key={`${reason}-${index}`}><span>{candidateDecision(reason, lang)}</span>{reason && <code>{reason}</code>}</li>)}</ul>
            <p className={s.note}>{c.noCase}</p>
          </section>
        </div>
        <aside className={s.continuation} aria-labelledby="prophet-candidate-continue"><h3 id="prophet-candidate-continue">{c.continue}</h3>
          {company && <Link className={s.primary} href={company} prefetch={false}>{c.company}<span aria-hidden="true">→</span></Link>}
          <a className={s.onward} href={href(planPatch)} onClick={event => follow(event, planPatch)}>{c.plans}<span aria-hidden="true">→</span></a>
          <Link className={s.onward} href="/us_stocks.html" prefetch={false}>{c.full}<span aria-hidden="true">↗</span></Link>
        </aside>
      </div>}

      {data && <details className={s.sources} ref={sources}><summary ref={sourceSummary}>{c.sources}</summary><div className={s.sourceBody}><p>{c.method}</p><dl>
        <div><dt>{c.sourcePath}</dt><dd><code>{data.source.path}</code></dd></div>
        <div><dt>{c.sourceDate}</dt><dd>{projection?.as_of ? <time dateTime={projection.as_of}>{projection.as_of}</time> : c.dateUnavailable}</dd></div>
        <div><dt>{c.sourceHash}</dt><dd><code>{data.source.sha256}</code></dd></div>
        <div><dt>{c.sourceBytes}</dt><dd>{data.source.bytes.toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</dd></div>
        {projection?.source_digest && <div><dt>{c.projectionHash}</dt><dd><code>{projection.source_digest}</code></dd></div>}
        {selected && [[c.lane, selected.lane], [c.tier, selected.tier_cascade], [c.admission, selected.admission_class]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? c.notSupplied}</dd></div>)}
      </dl><p>{c.provenance}</p></div></details>}
      {!selected && <footer className={s.footer}><Link href="/us_stocks.html" prefetch={false}>{c.full} ↗</Link></footer>}
    </div>
  </section>;
}

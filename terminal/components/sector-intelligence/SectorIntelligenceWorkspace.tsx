"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { SECTOR_FEEDS, SECTOR_VIEWS, DEFAULT_SECTOR_STATE, object, text, number, sectorRows,
  groupRows, themeRows, members, concentration, sortMembers, parseSectorState, writeSectorState,
  formatValue, type FeedMap, type FeedPayload, type FeedStatus,
  type SectorFeed, type SectorState, type SectorView, type Row } from "@/lib/sectorIntelligence";
import styles from "./SectorIntelligenceWorkspace.module.css";
import SectorCompanyComparison from "./SectorCompanyComparison";

const VIEW_KEYS: Record<SectorView, string> = {
  intelligence: "siOverview", dossier: "siDossier", companies: "siCompanies", themes: "siThemes", sources: "siSources",
};
const FEED_KEYS: Record<SectorFeed, string> = {
  sector: "siFeedSector", confluence: "siFeedConfluence", themes: "siFeedThemes", heatmap: "siFeedHeatmap",
};
const STATUS_KEYS: Record<FeedStatus, string> = {
  loading: "siStatusLoading", ready: "siStatusReady", access: "siStatusAccess", unavailable: "siStatusUnavailable",
  invalid: "siStatusInvalid", error: "siStatusError",
};
const STATE_KEYS: Record<string, string> = {
  leading: "siStateLeading", lagging: "siStateLagging", cautious: "siStateCautious", mixed: "siStateMixed",
  extended: "siStateExtended", "turn signaled": "siStateTurn", watch: "siStateWatch", "top watch": "siStateWatch",
  early: "siStateEarly", confirmed: "siStateConfirmed", mature: "siStateMature", deteriorating: "siStateDeteriorating",
  "long-bias": "siStateLong", neutral: "siStateNeutral", "rolling over": "siStateRolling", improving: "siStateImproving",
  constructive: "siStateConstructive", unavailable: "siUnavailable",
};
const emptyFeed = (source: SectorFeed, status: FeedStatus): FeedPayload => ({ data: null,
  receipt: { source, status, path: "", asOf: null, observedAt: null, contentHash: null, stale: false } });
const count = (v: unknown): number | null => {
  const n = number(v); return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
};
const rank = (v: unknown): string => { const n = count(v); return n ? `#${n}` : "—"; };
const pct = (v: unknown): number | null => { const n = number(v); return n !== null && n >= 0 && n <= 100 ? n : null; };
function Card({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return <section className={styles.card}><div className={styles.cardHead}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div><div className={styles.cardBody}>{children}</div></section>;
}
function Metric({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{foot}</small></div>;
}

export default function SectorIntelligenceWorkspace() {
  const t = useSectorT(), { lang } = useLang(), identity = useShellIdentity();
  const [state, setState] = useState<SectorState>(DEFAULT_SECTOR_STATE);
  const [received, setReceived] = useState<{ identity: typeof identity; revision: number; feeds: FeedMap }>({ identity, revision: 0, feeds: {} });
  const [revision, setRevision] = useState(0);
  const nav = useRef<HTMLElement>(null);
  // A changed account hides the previous account's data in the render itself,
  // before effects run. Nothing is persisted in browser storage or shared caches.
  const feeds = received.identity === identity && received.revision === revision ? received.feeds : {};
  useEffect(() => {
    const sync = () => setState(parseSectorState(new URLSearchParams(window.location.search)));
    sync(); window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    for (const source of SECTOR_FEEDS) {
      void (async () => {
        let payload: FeedPayload;
        try {
          const res = await fetch(`/api/sector-intelligence?source=${source}`, {
            credentials: "same-origin", cache: "no-store", signal: controller.signal,
          });
          const body = object(await res.json()), receipt = object(body.receipt);
          const status = text(receipt.status) as FeedStatus;
          if (receipt.source !== source || !Object.hasOwn(STATUS_KEYS, status) || (status === "ready" && !res.ok)) {
            payload = emptyFeed(source, "invalid");
          } else {
            payload = { data: res.ok ? body.data : null, receipt: {
              source, status, path: text(receipt.path), asOf: text(receipt.asOf) || null,
              observedAt: text(receipt.observedAt) || null, contentHash: text(receipt.contentHash) || null,
              stale: receipt.stale === true,
            } };
          }
        } catch {
          if (controller.signal.aborted) return;
          payload = emptyFeed(source, "error");
        }
        if (alive) setReceived(previous => ({ identity, revision,
          feeds: { ...(previous.identity === identity && previous.revision === revision ? previous.feeds : {}), [source]: payload } }));
      })();
    }
    return () => { alive = false; controller.abort(); };
  }, [identity, revision]);

  const sectors = useMemo(() => sectorRows(feeds.sector?.data), [feeds.sector]);
  const groups = useMemo(() => groupRows(feeds.confluence?.data), [feeds.confluence]);
  const themes = useMemo(() => themeRows(feeds.themes?.data), [feeds.themes]);
  const sector = useMemo(() => sectors.find(r => r.id === state.sector) || {}, [sectors, state.sector]);
  const group = useMemo(() => groups.find(r => r.key === state.group) || {}, [groups, state.group]);
  const roster = useMemo(() => members(group), [group]);
  const visibleMembers = useMemo(() => sortMembers(roster, state.sort, state.query), [roster, state.sort, state.query]);
  const cap = useMemo(() => concentration(feeds.heatmap?.data, text(sector.name)), [feeds.heatmap, sector.name]);
  const momentum = object(sector.momentum), heat = object(sector.heat), cycle = object(sector.cycle);
  const rotation = object(sector.rotation), conviction = object(sector.conviction), entry = object(group.entry), regime = object(group.regime);
  const status = feeds.sector?.receipt.status || "loading";
  const hasSector = !!sector.id;
  const completed = SECTOR_FEEDS.filter(k => feeds[k]).length;
  const ready = SECTOR_FEEDS.filter(k => feeds[k]?.receipt.status === "ready").length;
  const sectorName = text(lang === "zh" ? sector.name_zh : sector.name) || text(sector.name) || text(sector.ticker);
  const groupName = text(lang === "zh" ? group.label_zh : group.label) || text(group.label);
  const localName = (r: Row, en = "name", zh = "name_zh") => text(lang === "zh" ? r[zh] : r[en]) || text(r[en]);
  const stateLabel = (v: unknown) => t(STATE_KEYS[text(v).toLowerCase()] || "siUnavailable");
  const change = useCallback((patch: Partial<SectorState>, push = false) => {
    const next = { ...state, ...patch }; setState(next);
    const href = writeSectorState(new URL(window.location.href), next);
    if (push) window.history.pushState(window.history.state, "", href);
    else window.history.replaceState(window.history.state, "", href);
  }, [state]);
  const go = (view: SectorView) => change({ view }, true);
  const sourcesLink = <button type="button" className={styles.textButton} onClick={() => go("sources")}>{t("siOpenSources")} →</button>;
  const glanceKey = !hasSector ? "siGlanceUnavailable" : text(momentum.lead).toLowerCase() !== "leading" ? "siGlanceMixed"
    : text(conviction.label_en).toLowerCase() === "cautious" || text(cycle.phaseLabel).toLowerCase() === "rolling over" ? "siGlanceLeading" : "siGlanceLeadingPlain";
  const comparison = <SectorCompanyComparison rows={visibleMembers} selected={state.company} expanded={state.expanded}
    groupName={groupName} asOf={feeds.confluence?.receipt.asOf || null}
    onSelect={company => change({ company }, true)} onExpand={() => change({ expanded: !state.expanded })}
    onOpenTable={() => go("companies")} />;
  const counts = `${formatValue(count(heat.adv), 0)} ${t("siAdvancing")} / ${formatValue(count(heat.dec), 0)} ${t("siDeclining")}`;
  const axes = <div className={styles.axes}>
    <div><h3>{t("siStrength")}</h3><p>{t("siRS")} {rank(momentum.rs_21d_rank)} · {t("siRS63")} {rank(momentum.rs_rank)}</p><span>{momentum.above_200d === true ? t("siAbove200") : momentum.above_200d === false ? t("siBelow200") : t("siTrendUnknown")}</span></div>
    <div><h3>{t("siFormation")}</h3><p>{t("siSlow")}: {stateLabel(conviction.label_en)} · {stateLabel(cycle.phaseLabel)}</p><span>{t("siFast")}: {stateLabel(rotation.state)}</span></div>
    <div><h3>{t("siEntry")}</h3><p>{t("siNotConnected")}</p><span>{t("siEntryCopy")}</span></div>
    <div><h3>{t("siEvidence")}</h3><p>{ready} / {SECTOR_FEEDS.length} {t("siSourceCount")}</p><span>{t("siSourceRecordCopy")}</span></div>
  </div>;
  const pocket = <Card title={groupName || t("siPocket")} subtitle={t("siPocket")}>
    {!!group.key ? <><div className={styles.split}>
      <div><span>{t("siEntryOwner")}</span><strong>{["T1", "T2", "T3"].includes(text(entry.tier)) ? text(entry.tier) : "—"}</strong><small>{formatValue(count(group.n_priced), 0)} / {formatValue(count(group.n_members), 0)} {t("siPriced")}</small></div>
      <span className={styles.versus} aria-hidden="true">↔</span>
      <div><span>{t("siRegimeOwner")}</span><strong>{stateLabel(regime.state)}</strong><small>{feeds.confluence?.receipt.asOf || t("siUnknownDate")}</small></div>
    </div><details className={styles.explanation}><summary>{t("siWhyDiffer")}</summary><p>{t("siSplitCopy")}</p></details>
      <button className={styles.textButton} type="button" onClick={() => go("companies")}>{t("siSeeCompanies")} →</button></>
      : <p className={styles.muted}>{t("siNoMembers")}</p>}
  </Card>;
  const business = <Card title={t("siBusiness")} action={<span className={styles.badge}>{t("siNotConnected")}</span>}><p className={styles.muted}>{t("siBusinessCopy")}</p></Card>;
  const concentrationCard = <Card title={t("siConcentration")}>
    <span className={styles.muted}>{t("siTop5")}</span><strong className={styles.largeValue}>{formatValue(cap ? cap.share * 100 : null, 1, "%")}</strong>
    {cap && <><meter className={styles.meter} min={0} max={100} value={cap.share * 100} aria-label={t("siTop5")} /><p className={styles.muted}>{cap.names.join(" · ")} · {cap.count} {t("siTiles")}</p></>}
    <p className={styles.note}>{cap ? t("siCohortCopy") : t("siConcentrationMissing")}</p>
  </Card>;

  return <main className={`main2 ${styles.root}`} data-testid="sector-intelligence" data-sector-theme={state.theme}>
    <div className={styles.page}>
      <header className={styles.header}><div><p className={styles.eyebrow}>{t("siEyebrow")}</p><h1>{t("siTitle")}</h1><p className={styles.subtitle}>{t("siSubtitle")}</p></div>
        <div className={styles.controls}>
          <label>{t("siSector")}<select aria-label={t("siSector")} value={state.sector} onChange={e => change({ sector: e.target.value, group: "", query: "", company: "", expanded: false })}>
            {!sectors.some(r => r.id === state.sector) && <option value={state.sector}>{state.sector.toUpperCase()}</option>}
            {sectors.map(r => <option key={text(r.id)} value={text(r.id)}>{localName(r)} · {text(r.ticker)}</option>)}
          </select></label>
          <label>{t("siGroup")}<select aria-label={t("siGroup")} value={state.group} onChange={e => change({ group: e.target.value, query: "", sort: "source", company: "", expanded: false })}>
            <option value="">{t("siChooseGroup")}</option>
            {!groups.some(r => r.key === state.group) && !!state.group && <option value={state.group}>{t("siUnavailable")}</option>}
            {groups.map(r => <option key={text(r.key)} value={text(r.key)}>{localName(r, "label", "label_zh")}</option>)}
          </select></label>
          <button type="button" className={styles.button} onClick={() => change({ theme: state.theme === "dark" ? "light" : "dark" })}>{t(state.theme === "dark" ? "siUseLight" : "siUseDark")}</button>
          <button type="button" className={styles.button} onClick={() => setRevision(n => n + 1)}>{t("siRefresh")}</button>
        </div>
      </header>
      <nav ref={nav} className={styles.tabs} role="tablist" aria-label={t("siViews")} onKeyDown={event => {
        const index = SECTOR_VIEWS.indexOf(state.view);
        const next = event.key === "ArrowRight" ? (index + 1) % SECTOR_VIEWS.length : event.key === "ArrowLeft" ? (index + SECTOR_VIEWS.length - 1) % SECTOR_VIEWS.length : event.key === "Home" ? 0 : event.key === "End" ? SECTOR_VIEWS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); go(SECTOR_VIEWS[next]);
        nav.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
        {SECTOR_VIEWS.map(view => <button type="button" key={view} id={`si-tab-${view}`} role="tab"
          aria-selected={state.view === view} aria-controls={`si-panel-${view}`} tabIndex={state.view === view ? 0 : -1}
          onClick={() => go(view)}>{t(VIEW_KEYS[view])}</button>)}
      </nav>
      <div className={styles.contextLine}><span className={styles.badge}>{t("siResearchOnly")}</span><span>{t("siDated")} · {feeds.sector?.receipt.asOf || t("siUnknownDate")}</span></div>
      {completed === SECTOR_FEEDS.length && ready < SECTOR_FEEDS.length && <div className={styles.notice} role="status"><div><strong>{t("siCompactPartial")}</strong></div>{sourcesLink}</div>}
      <div role="tabpanel" id={`si-panel-${state.view}`} aria-labelledby={`si-tab-${state.view}`} tabIndex={0} className={styles.view}>
        {state.view === "intelligence" && <>
          {status === "loading" ? <div className={styles.empty} role="status">{t("siLoading")}</div> : !hasSector ? <div className={styles.empty} role="status">
            <h2>{status === "access" ? t("siAccess") : t("siMissingTitle")}</h2><p>{status === "access" ? t("siAccessCopy") : status === "invalid" || status === "ready" ? t("siInvalidCopy") : t("siMissingCopy")}</p>
            {status === "access" && <Link className={styles.button} href="/login">{t("siSignIn")}</Link>}{sourcesLink}
          </div> : <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.heroSubject}>{sectorName}</p><h2>{t(glanceKey)}</h2>
              <p>{t("siGlanceLimit")}</p>
              <button className={styles.textButton} type="button" onClick={() => go("companies")}>{t("siSeeCompanies")} →</button>
            </div>
            <div className={styles.metrics}>
              <Metric label={t("siRS")} value={rank(momentum.rs_21d_rank)} foot={`${t("siRS63")} ${rank(momentum.rs_rank)}`} />
              <Metric label={t("siParticipation")} value={formatValue(pct(heat.breadth_pct), 0, "%")} foot={counts} />
              <Metric label={t("siHeat")} value={formatValue(number(heat.heat_1M), 2, "%", true)} foot={t("siHeatMethod")} />
              <Metric label={t("siTop5")} value={formatValue(cap ? cap.share * 100 : null, 1, "%")} foot={cap ? `${cap.count} ${t("siTiles")}` : t("siNotConnected")} />
            </div>
          </section>}
          {comparison}
          <details className={styles.studyDisclosure}><summary>{t("siShowEvidence")}</summary>
            <div className={styles.columns}><div className={styles.stack}><Card title={t("siFocus")} subtitle={t("siSeparate")}>{axes}</Card>{pocket}</div>
              <aside className={styles.stack}>{business}<Card title={t("siTaxonomy")}><p className={styles.note}>{t("siTaxonomyCopy")}</p></Card></aside></div>
          </details>
        </>}
        {state.view === "dossier" && <div className={styles.columns}><div className={styles.stack}><Card title={`${sectorName || state.sector.toUpperCase()} · ${t("siDossier")}`} subtitle={t("siSeparate")}>{axes}</Card>
          <Card title={t("siWhyDiffer")}><div className={styles.callout}><h3>{t("siSlow")} / {t("siFast")}</h3><p>{stateLabel(conviction.label_en)} / {stateLabel(rotation.state)}</p><span>{t("siClockCopy")}</span></div><div className={styles.callout}><h3>{t("siEntryOwner")} / {t("siRegimeOwner")}</h3><p>{text(entry.tier) || "—"} / {stateLabel(regime.state)}</p><span>{t("siSplitCopy")}</span></div></Card>{business}
        </div><aside className={styles.stack}>{concentrationCard}<Card title={t("siCohort")}><p className={styles.note}>{t("siMembershipCopy")}</p></Card></aside></div>}
        {state.view === "companies" && <Card title={groupName || t("siCompanies")} subtitle={`${formatValue(count(group.n_members), 0)} ${t("siMembers")} · ${feeds.confluence?.receipt.asOf || t("siUnknownDate")}`}>
          <p className={styles.note}>{t("siCompanyCaution")}</p>
          <div className={styles.tableControls}><label>{t("siSearch")}<input type="search" aria-label={t("siSearch")} value={state.query} maxLength={40} onChange={e => change({ query: e.target.value })} /></label>
            <label>{t("siSort")}<select aria-label={t("siSort")} value={state.sort} onChange={e => change({ sort: e.target.value as SectorState["sort"] })}>
              <option value="source">{t("siSourceOrder")}</option><option value="return">{t("siByReturn")}</option><option value="relative">{t("siByRelative")}</option><option value="ticker">{t("siByTicker")}</option>
            </select></label><span aria-live="polite">{visibleMembers.length} / {roster.length} {t("siShowing")}</span></div>
          <div className={styles.tableWrap}><table className={styles.companyTable}><thead><tr>{["siTicker", "siPrice", "siReturn20", "siRelative", "siTier", "siTicks", "siSourceFlag", "siState"].map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
            <tbody>{visibleMembers.map(row => <tr key={row.ticker} data-testid="sector-company-row">
              <td data-label={t("siTicker")}><button type="button" className={styles.tableSelect} aria-pressed={state.company === row.ticker}
                aria-label={`${t("siSelectCompany")}: ${row.ticker}`} onClick={() => change({ company: row.ticker, view: "intelligence", expanded: true, query: "" }, true)}>{row.ticker} →</button></td>
              <td data-label={t("siPrice")}>{formatValue(row.price, 2)}</td><td data-label={t("siReturn20")} data-sign={row.return20d === null || row.return20d === 0 ? undefined : row.return20d < 0 ? "down" : "up"}>{formatValue(row.return20d, 1, "%", true)}</td>
              <td data-label={t("siRelative")}>{formatValue(row.relative, 1, "pp", true)}</td><td data-label={t("siTier")}>{row.tier || t("siSourceUnrated")}</td>
              <td data-label={t("siTicks")}>{formatValue(row.ticks, 0)}</td><td data-label={t("siSourceFlag")}>{row.buyable === null ? "—" : row.buyable ? t("siYes") : t("siNo")}</td><td data-label={t("siState")}>{stateLabel(row.state)}</td>
            </tr>)}</tbody></table></div>
          {!visibleMembers.length && <p className={styles.empty}>{roster.length ? t("siNoMatches") : t("siNoMembers")}</p>}
          <p className={styles.muted}>{t("siMembershipCopy")}</p>
        </Card>}
        {state.view === "themes" && <><div className={styles.sectionHeading}><h2>{t("siThemeContext")}</h2><p>{t("siThemeScope")}</p></div><div className={styles.themeGrid}>
          {themes.map(row => <Card key={text(row.theme_id)} title={localName(row, "name_en", "name_zh")}><dl className={styles.pairs}><div><dt>{t("siThemeStage")}</dt><dd>{stateLabel(row.stage)}</dd></div><div><dt>{t("siThemeReady")}</dt><dd>{row.entry_ready === true ? t("siYes") : t("siNo")}</dd></div><div><dt>{t("siSnapshotDate")}</dt><dd>{feeds.themes?.receipt.asOf || t("siUnknownDate")}</dd></div></dl></Card>)}
          {!themes.length && <p className={styles.empty}>{t("siNoThemes")}</p>}</div><div className={styles.columns}><Card title={t("siTaxonomy")}><p className={styles.note}>{t("siTaxonomyCopy")}</p></Card>{business}</div></>}
        {state.view === "sources" && <><div className={styles.sectionHeading}><h2>{t("siSourceRecord")}</h2><p>{t("siSourceRecordCopy")}</p></div><div className={styles.sourceGrid}>
          {SECTOR_FEEDS.map(source => { const receipt = feeds[source]?.receipt; return <Card key={source} title={t(FEED_KEYS[source])} action={<span className={styles.badge}>{t(STATUS_KEYS[receipt?.status || "loading"])}</span>}>
            <dl className={styles.pairs}><div><dt>{t("siSnapshotDate")}</dt><dd>{receipt?.asOf || t("siUnknownDate")}</dd></div><div><dt>{t("siFetched")}</dt><dd>{receipt?.observedAt || "—"}</dd></div></dl>
            {receipt?.stale && <p className={styles.note}>{t("siStale")}</p>}
            <details className={styles.explanation}><summary>{t("siReceipt")}</summary><p>{t("siSourcePath")}</p><code>{receipt?.path || "—"}</code><p>{t("siHash")}</p><code>{receipt?.contentHash || "—"}</code></details>
          </Card>; })}</div><div className={styles.columns}><Card title={t("siReplay")}><p className={styles.muted}>{t("siReplayCopy")}</p></Card><Card title={t("siEntry")}><p className={styles.muted}>{t("siEntryCopy")}</p><span className={styles.badge}>{t("siNotConnected")}</span></Card></div></>}
      </div>
      <footer className={styles.footer}>{t("siResearchCopy")}</footer>
    </div>
  </main>;
}

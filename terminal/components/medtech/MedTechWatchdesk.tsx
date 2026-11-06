"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import MobileSheet from "@/components/ui/MobileSheet";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { useLang } from "@/lib/i18n";
import { useMedTechT } from "@/lib/medtechLex";
import {
  asError, confirmDelete, confirmReview, EVENT_ID, familyId, fdaUrl, isAborted,
  MedTechClientError, medtechRequest, readDetail, readEvents, readHealth, readHistory,
  readUpdates, readWatch, readWatches,
  type Change, type Event, type Events, type History, type Revision, type Source,
  type Trigger, type Update, type Updates, type Watch,
} from "@/lib/medtechClient";
import s from "./medtech.module.css";

type T = ReturnType<typeof useMedTechT>;
type Issue = (error: MedTechClientError) => void;
const PATHWAYS = ["510k", "de_novo", "pma_original", "pma_supplement", "pma_panel_track_supplement", "other_device_submission"];
const DECISIONS = ["cleared", "granted", "approved", "not_substantially_equivalent", "denied", "withdrawn", "unmapped"];
const KINDS = new Set(["first_observed", "source_record_changed", "normalization_changed", "source_and_normalization_changed"]);
const EMPTY_WATCHES: Watch[] = [];
const ReadSeed = createContext<Map<string, unknown>>(new Map());

function Star({ filled = false }: { filled?: boolean }) {
  return <svg className={s.icon} aria-hidden="true" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3 9.6l6.2-.9Z" /></svg>;
}
function useDate() {
  const { lang } = useLang(), t = useMedTechT();
  return (value: string | null | undefined, time = false) => {
    if (!value) return t("notReported");
    const date = new Date(value.length === 10 ? value + "T00:00:00Z" : value);
    if (!Number.isFinite(date.getTime())) return t("notReported");
    return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
      year: "numeric", month: "short", day: "2-digit", timeZone: "UTC",
      ...(time ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const : {}),
    }).format(date);
  };
}
function useAlive() {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return live;
}
function query(path: string, params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
  return path + (q.size ? "?" + q.toString() : "");
}
function useRead<TValue>(path: string | null, decode: (raw: unknown) => TValue, onIssue: Issue, tick = 0, snapshot?: string, watchVersion?: number) {
  const seeds = useContext(ReadSeed);
  const cacheKey = path && (watchVersion === undefined ? path : path + ":watch-version:" + watchVersion);
  // A staged refresh hands each read to its first mounted consumer. Keep that
  // value through Strict Mode effect replay, but never reuse it on a later mount
  // after account mutations (for example, acknowledging a revision).
  const handoff = useRef({ key: cacheKey, seeds, snapshot,
    data: cacheKey && tick === 0 ? seeds.get(cacheKey) as TValue | undefined : undefined });
  if (handoff.current.key !== cacheKey || handoff.current.seeds !== seeds ||
      handoff.current.snapshot !== snapshot || tick !== 0) handoff.current.data = undefined;
  const cached = handoff.current.data;
  const [state, set] = useState<{ path: string | null; data: TValue | null; busy: boolean; error: MedTechClientError | null }>({
    path, data: cached ?? null, busy: !!path && cached === undefined, error: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!path) return () => controller.abort();
    if (cached !== undefined) {
      if (cacheKey) seeds.delete(cacheKey);
      set({ path, data: cached, busy: false, error: null });
      return () => controller.abort();
    }
    set(previous => ({ path, data: previous.path === path ? previous.data : null, busy: true, error: null }));
    void medtechRequest(path, decode, { signal: controller.signal, snapshot }).then(data => {
      if (active) set({ path, data, busy: false, error: null });
    }).catch(caught => {
      if (!active || isAborted(caught)) return;
      const error = asError(caught);
      set(previous => ({ path, data: error.access ? null : previous.data, busy: false, error }));
      onIssue(error);
    });
    return () => { active = false; controller.abort(); };
  }, [path, decode, onIssue, tick, snapshot, seeds, cacheKey, cached]);
  const update = useCallback((change: (data: TValue) => TValue) => set(previous =>
    previous.data ? { ...previous, data: change(previous.data) } : previous), []);
  return { ...(state.path === path ? state : { path, data: null, busy: !!path, error: null }), update };
}
type Location = { view: "records" | "watches"; q: string; pathway: string; decision: string; record: string; watch: string };
function locationState(): Location {
  const p = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const pathway = p.get("mtPathway") ?? "", decision = p.get("mtDecision") ?? "";
  const record = p.get("mtRecord") ?? "", watch = p.get("mtWatch") ?? "";
  return {
    view: p.get("mtView") === "watches" ? "watches" : "records", q: (p.get("mtQuery") ?? "").slice(0, 120),
    pathway: PATHWAYS.includes(pathway) ? pathway : "", decision: DECISIONS.includes(decision) ? decision : "",
    record: EVENT_ID.test(record) ? record : "", watch: /^[0-9a-f-]{36}$/i.test(watch) ? watch : "",
  };
}
function useLocation() {
  const [value, set] = useState<Location>(locationState);
  useEffect(() => {
    const pop = () => set(locationState());
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = useCallback((patch: Partial<Location>) => {
    const next = { ...locationState(), ...patch }, u = new URL(window.location.href);
    const values = { mtView: next.view === "records" ? "" : next.view, mtQuery: next.q, mtPathway: next.pathway,
      mtDecision: next.decision, mtRecord: next.record, mtWatch: next.watch };
    for (const [key, v] of Object.entries(values)) { if (v) u.searchParams.set(key, v); else u.searchParams.delete(key); }
    u.searchParams.set("tab", "medtech");
    if (u.href !== window.location.href) {
      window.history.pushState(null, "", u);
      window.dispatchEvent(new window.Event("medtech:navigate"));
    }
    set(next);
  }, []);
  return [value, navigate] as const;
}
function errorCopy(error: MedTechClientError, t: T, mutation = false) {
  if (error.stale) return t("snapshotChanged");
  if (error.code === "watch_limit_reached") return t("quota");
  if (["watch_changed", "watch_exists"].includes(error.code)) return t("watchConflict");
  if (error.code === "change_not_available") return t("unavailableRevision");
  if (error.status === 429) return t("rateLimited");
  if (error.status === 404) return t("missingRecord");
  return t(mutation ? "mutationUnknown" : "sourceUnavailable");
}
function ReadError({ error, retry, retained = false }: { error: MedTechClientError; retry: () => void; retained?: boolean }) {
  const t = useMedTechT();
  return <div className={s.notice} role="alert"><span>{retained && error.status === 503 ? t("retainedUnavailable") : errorCopy(error, t)}</span>
    <button className={s.button} onClick={retry}>{t(error.stale ? "refresh" : "retry")}</button></div>;
}
function AccessGate({ status = 401 }: { status?: number }) {
  const t = useMedTechT(), onboarding = useOnboarding(), settings = useSettings();
  const signIn = status === 401;
  return <div className={s.empty} data-testid="medtech-access"><Star /><h2>{t(signIn ? "accessTitle" : "subscriptionTitle")}</h2>
    <p>{t(signIn ? "accessCopy" : "subscriptionCopy")}</p>
    <button className={s.primary} onClick={() => signIn ? onboarding.open("signin") : settings.open("billing")}>{t(signIn ? "signIn" : "plans")}</button></div>;
}
function SourceLink({ url, children }: { url: string; children: React.ReactNode }) {
  const safe = fdaUrl(url);
  return safe ? <a className={s.button} href={safe} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true">↗</span></a> : null;
}
function Decision({ event }: { event: Event }) {
  const t = useMedTechT();
  return <>{t("status_" + (DECISIONS.includes(event.decision.status) ? event.decision.status : "unmapped"))}
    {event.decision.status === "unmapped" && <span className={s.rowMeta}>{t("decisionCode")}: {event.decision.code}</span>}</>;
}
function Pathway({ event }: { event: Event }) {
  const t = useMedTechT();
  return <>{t("pathway_" + (PATHWAYS.includes(event.pathway) ? event.pathway : "other_device_submission"))}</>;
}
function usePages<TItem, TPage extends { items: TItem[]; next_offset: number | null }>(
  initial: TPage, path: string, decode: (raw: unknown) => TPage, snapshot: string, onIssue: Issue,
) {
  const [items, setItems] = useState(initial.items), [next, setNext] = useState(initial.next_offset);
  const [busy, setBusy] = useState(false), [error, setError] = useState<MedTechClientError | null>(null);
  const lock = useRef(false), alive = useAlive();
  const load = async () => {
    if (next === null || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const join = path.includes("?") ? "&" : "?";
      const data = await medtechRequest(path + join + new URLSearchParams({
        limit: "25", offset: String(next), snapshot_id: snapshot,
      }), decode, { snapshot });
      if (alive.current) { setItems(old => [...old, ...data.items]); setNext(data.next_offset); }
    } catch (caught) { if (alive.current) { const e = asError(caught); setError(e); onIssue(e); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return { items, next, busy, error, load, setItems };
}
export default function MedTechWatchdesk() {
  const identity = useShellIdentity();
  if (identity.kind === "guest") return <main className={s.workspace}><AccessGate /></main>;
  return <AccountWatchdesk key={identityOwnerKey(identity)} />;
}
async function prepareView(location: Location, signal: AbortSignal) {
  const seeds = new Map<string, unknown>();
  const read = async <TValue,>(path: string, decode: (raw: unknown) => TValue, snapshot?: string, watchVersion?: number) => {
    const data = await medtechRequest(path, decode, { signal, snapshot });
    seeds.set(watchVersion === undefined ? path : path + ":watch-version:" + watchVersion, data);
    return data;
  };
  const filterPath = query("/events", { q: location.q, pathway: location.pathway, decision: location.decision });
  const [events, health, watches] = await Promise.all([
    read(filterPath, readEvents), read("/health", readHealth), read("/watches", readWatches),
  ]);
  const snapshot = events.snapshot_id;
  if (health.snapshot_id !== snapshot) throw new MedTechClientError(409, "snapshot_changed");
  if (location.record) {
    const [detail, history] = await Promise.all([
      read(query("/events/" + location.record, { snapshot_id: snapshot }), readDetail, snapshot),
      read(query("/events/" + location.record + "/changes", { snapshot_id: snapshot, limit: 25 }), readHistory, snapshot),
    ]);
    if (detail.event.event_id !== location.record || history.event_id !== location.record) {
      throw new MedTechClientError(503, "invalid_response");
    }
  } else if (location.watch) {
    const watch = watches.items.find(item => item.id === location.watch);
    if (watch) {
      const updates = await read(query("/watches/" + watch.id + "/updates", { snapshot_id: snapshot, limit: 25 }), readUpdates, snapshot, watch.version);
      if (updates.watch_id !== watch.id) throw new MedTechClientError(503, "invalid_response");
      if (updates.watch_version !== watch.version) throw new MedTechClientError(409, "watch_changed");
    }
  }
  return seeds;
}
function AccountWatchdesk() {
  const [session, setSession] = useState({ epoch: 0, seeds: new Map<string, unknown>() });
  const [recovery, setRecovery] = useState<{ busy: boolean; error: MedTechClientError | null }>({ busy: false, error: null });
  const request = useRef<AbortController | null>(null), attempt = useRef(0), alive = useAlive();
  useEffect(() => {
    const invalidate = () => {
      attempt.current++;
      request.current?.abort(); request.current = null;
      setRecovery(previous => ({ ...previous, busy: false }));
    };
    window.addEventListener("popstate", invalidate);
    window.addEventListener("medtech:navigate", invalidate);
    return () => {
      attempt.current++; request.current?.abort();
      window.removeEventListener("popstate", invalidate);
      window.removeEventListener("medtech:navigate", invalidate);
    };
  }, []);
  const reload = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(), location = locationState(), href = window.location.href;
    const sequence = ++attempt.current;
    request.current = controller;
    setRecovery({ busy: true, error: null });
    try {
      // Keep the displayed tree until the entire replacement for this view is
      // decoded and bound to one source generation and current account watch.
      const seeds = await prepareView(location, controller.signal);
      if (alive.current && attempt.current === sequence && window.location.href === href) {
        setSession(previous => ({ epoch: previous.epoch + 1, seeds }));
      }
      if (alive.current && attempt.current === sequence) setRecovery({ busy: false, error: null });
    } catch (caught) {
      if (alive.current && attempt.current === sequence && !isAborted(caught)) setRecovery({ busy: false, error: asError(caught) });
    } finally { controller.abort(); if (attempt.current === sequence) request.current = null; }
  }, [alive]);
  if (recovery.error?.access) return <main className={s.workspace}><AccessGate status={recovery.error.status} /></main>;
  return <ReadSeed.Provider value={session.seeds}><SnapshotWatchdesk key={session.epoch} reload={reload}
    refreshing={recovery.busy} refreshError={recovery.error} /></ReadSeed.Provider>;
}
function SnapshotWatchdesk({ reload, refreshing, refreshError }: {
  reload: () => void; refreshing: boolean; refreshError: MedTechClientError | null;
}) {
  const t = useMedTechT();
  const [location, navigate] = useLocation();
  const [stale, setStale] = useState(false), [access, setAccess] = useState<MedTechClientError | null>(null);
  const [watchTick, setWatchTick] = useState(0), [sourcesOpen, setSourcesOpen] = useState(false);
  const [notice, setNotice] = useState<"saved" | "removed" | null>(null);
  const [dialog, setDialog] = useState<{ event?: Event; watch?: Watch } | null>(null);
  const onIssue = useCallback((error: MedTechClientError) => {
    if (error.access) setAccess(error);
    if (error.stale) setStale(true);
  }, []);
  const filterPath = query("/events", { q: location.q, pathway: location.pathway, decision: location.decision });
  const events = useRead(filterPath, readEvents, onIssue);
  const health = useRead("/health", readHealth, onIssue);
  const watches = useRead("/watches", readWatches, onIssue, watchTick);
  const snapshot = events.data?.snapshot_id ?? "";
  const newer = !!(snapshot && health.data && health.data.snapshot_id !== snapshot);
  const blocked = stale || newer;
  const watchItems = watches.data?.items ?? EMPTY_WATCHES;
  const accountReady = !!watches.data && !watches.error && !watches.busy;
  const sourceBlocked = blocked || refreshing;
  const mutationsBlocked = sourceBlocked || !!refreshError || !accountReady;
  const currentWatch = watchItems.find(w => w.id === location.watch);
  const reloadWatches = () => { setDialog(null); setWatchTick(x => x + 1); };
  const saved = (watch: Watch) => {
    watches.update(data => ({ ...data, items: [watch, ...data.items.filter(w => w.id !== watch.id)] }));
    setDialog(null); setNotice("saved");
  };
  const removed = (id: string) => {
    watches.update(data => ({ ...data, items: data.items.filter(w => w.id !== id) }));
    setDialog(null); setNotice("removed");
    if (location.watch === id) navigate({ watch: "", record: "", view: "watches" });
  };
  const recordWatch = (event: Event) => setDialog({ event });
  const sideActions = {
    snapshot, blocked: sourceBlocked, watchDisabled: mutationsBlocked, onWatch: recordWatch,
    onSource: () => setSourcesOpen(true), watches: watchItems, onIssue, reload,
  };
  const scroll = useRef<HTMLElement>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [location.record, location.watch, location.view]);
  if (access) return <main className={s.workspace}><AccessGate status={access.status} /></main>;
  return <main className={s.workspace} ref={scroll} data-testid="medtech-watchdesk" aria-label={t("title")}>
    <div className={s.inner}>
      {!location.record && !location.watch && <header className={s.header}>
        <div><p className={s.eyebrow}>MedTech</p><h1 className={s.title}>{t("title")}</h1><p className={s.subtitle}>{t("subtitle")}</p></div>
        <div className={s.headerActions}><button className={s.button} onClick={() => setSourcesOpen(true)}>{t("sources")}</button></div>
      </header>}
      {blocked && <div className={s.notice} role="alert"><span>{t("snapshotChanged")}</span><button className={s.primary} disabled={refreshing} onClick={reload}>{t("refresh")}</button></div>}
      {refreshing && <p className={s.status} role="status">{t("refreshing")}</p>}
      {refreshError && <ReadError error={refreshError} retry={reload} retained={!!events.data} />}
      {health.data?.snapshot_id === snapshot && health.data.state === "refresh_failed" && <div className={s.notice} role="status">{t("retained")}</div>}
      {events.data?.sources.some(source => source.status === "stale") && <div className={s.notice} role="status">{t("overdue")}</div>}
      {notice && <p className={s.status} role="status">{t(notice)}</p>}
      {events.error && !events.error.stale && <ReadError error={events.error} retry={reload} retained={!!events.data} />}
      {watches.error && <div className={s.notice} role="alert"><span>{t("watchesUnavailableCopy")}</span><button className={s.button} onClick={reloadWatches}>{t("reloadWatches")}</button></div>}
      {health.error && !health.error.stale && <ReadError error={health.error} retry={reload} />}
      {!events.data && events.busy && <p className={s.status} role="status">{t("loading")}</p>}
      {events.data && location.record ? <RecordDetail key={snapshot + location.record} eventId={location.record}
        {...sideActions} back={() => navigate({ record: "" })} backKey={location.watch ? "backChanges" : location.view === "watches" ? "backWatches" : "backRecords"} /> :
        events.data && location.watch ? <>
          <button className={s.back} onClick={() => navigate({ watch: "", view: "watches" })}>← {t("backWatches")}</button>
          {watches.busy && !watches.data ? <p role="status">{t("loadingWatches")}</p> :
            currentWatch ? <WatchReview key={snapshot + currentWatch.id + currentWatch.version} watch={currentWatch} snapshot={snapshot} blocked={mutationsBlocked}
              onIssue={onIssue} reload={reload} onManage={() => setDialog({ watch: currentWatch })}
              onRecord={record => navigate({ record })} /> :
            !watches.error && <div className={s.empty}><h2>{t("missingWatch")}</h2></div>}
        </> : <>
          <div className={s.tabs} aria-label={t("title")}>
            <button className={s.tab} aria-pressed={location.view === "records"} onClick={() => navigate({ view: "records", record: "", watch: "" })}>{t("records")}</button>
            <button className={s.tab} aria-pressed={location.view === "watches"} onClick={() => navigate({ view: "watches", record: "", watch: "" })}>{t("watches")}
              {watches.data && !watches.error && <span className={s.count}>{watchItems.length}</span>}</button>
          </div>
          {location.view === "records" ? <>
            <RecordFilters key={[location.q, location.pathway, location.decision].join("|")} value={location} change={navigate} />
            {events.data && <RecordList key={snapshot + filterPath} initial={events.data} path={filterPath}
              snapshot={snapshot} blocked={sourceBlocked} watchDisabled={mutationsBlocked} watches={watchItems} onIssue={onIssue} reload={reload}
              onRecord={record => navigate({ record })} onWatch={recordWatch} clear={() => navigate({ q: "", pathway: "", decision: "" })} />}
          </> : <WatchList items={watchItems} loaded={!!watches.data} busy={watches.busy}
            browse={() => navigate({ view: "records" })} onReview={watch => navigate({ watch })}
            onManage={watch => setDialog({ watch })} blocked={mutationsBlocked} />}
        </>}
    </div>
    <SourceSheet open={sourcesOpen} close={() => setSourcesOpen(false)} sources={events.data?.sources ?? []}
      event={undefined} />
    {dialog && (snapshot || dialog.watch) && <WatchDialog event={dialog.event} initialWatch={dialog.watch} watches={watchItems}
      snapshot={snapshot} blocked={mutationsBlocked} close={() => setDialog(null)}
      onSaved={saved} onRemoved={removed} onIssue={onIssue} reload={reload} reloadWatches={reloadWatches} />}
  </main>;
}
function RecordFilters({ value, change }: { value: Location; change: (patch: Partial<Location>) => void }) {
  const t = useMedTechT(), [q, setQ] = useState(value.q);
  return <form className={s.toolbar} onSubmit={e => { e.preventDefault(); change({ q: q.trim(), record: "", watch: "" }); }}>
    <div className={s.search}><label className={s.label}>{t("search")}<input className={s.input} value={q} maxLength={120}
      onChange={e => setQ(e.target.value)} type="search" /></label><button className={s.button} type="submit">{t("searchAction")}</button></div>
    <label className={s.label}>{t("pathway")}<select className={s.select} value={value.pathway} onChange={e => change({ pathway: e.target.value })}>
      <option value="">{t("allPathways")}</option>{PATHWAYS.map(p => <option key={p} value={p}>{t("pathway_" + p)}</option>)}</select></label>
    <label className={s.label}>{t("decision")}<select className={s.select} value={value.decision} onChange={e => change({ decision: e.target.value })}>
      <option value="">{t("allDecisions")}</option>{DECISIONS.map(p => <option key={p} value={p}>{t("status_" + p)}</option>)}</select></label>
  </form>;
}
function RecordList({ initial, path, snapshot, blocked, watchDisabled, watches, onIssue, reload, onRecord, onWatch, clear }: {
  initial: Events; path: string; snapshot: string; blocked: boolean; watchDisabled: boolean; watches: Watch[]; onIssue: Issue; reload: () => void;
  onRecord: (id: string) => void; onWatch: (event: Event) => void; clear: () => void;
}) {
  const t = useMedTechT(), date = useDate();
  const page = usePages<Event, Events>(initial, path, readEvents, snapshot, onIssue);
  if (!page.items.length) return <div className={s.empty}><h2>{t("noResults")}</h2><p>{t("noResultsCopy")}</p><button className={s.button} onClick={clear}>{t("clear")}</button></div>;
  return <section aria-label={t("records")}>
    <p className={s.caption}>{t("monthly")}</p>
    <div className={s.columnLabels} aria-hidden="true"><span>{t("device")}</span><span>{t("pathway")}</span><span>{t("decision")}</span><span>{t("decisionDate")}</span><span /></div>
    <ul className={s.rows}>{page.items.map(event => {
      const watching = watches.some(w => w.subject_type === "event" && w.subject_id === event.event_id);
      return <li className={s.row} key={event.event_id}>
        <button className={s.rowMain} onClick={() => onRecord(event.event_id)} data-record={event.event_id}>
          <span className={s.rowTitle}>{event.device.name || event.source.record_id}<span className={s.rowMeta}>{event.applicant.name || t("notReported")} · {event.source.record_id}</span></span>
          <span className={s.rowCell}><Pathway event={event} /></span><span className={s.rowCell}><Decision event={event} /></span>
          <time className={s.date} dateTime={event.decision.date ?? undefined}>{date(event.decision.date)}</time>
        </button>
        <button className={s.iconButton} disabled={watchDisabled} aria-label={(watching ? t("watchSettings") : t("watch")) + " " + event.source.record_id}
          aria-pressed={watching} onClick={() => onWatch(event)}><Star filled={watching} /></button>
      </li>;
    })}</ul>
    {page.error && <ReadError error={page.error} retry={page.error.stale ? reload : page.load} retained />}
    <div className={s.pager}><p className={s.caption}>{t("showing")} {page.items.length.toLocaleString()} {t("of")} {initial.total.toLocaleString()} {t("recordCount")}</p>
      {page.next !== null && <button className={s.button} disabled={page.busy || blocked} onClick={page.load}>{t(page.busy ? "loadingMore" : "loadMore")}</button>}</div>
  </section>;
}
function WatchList({ items, loaded, busy, browse, onReview, onManage, blocked }: {
  items: Watch[]; loaded: boolean; busy: boolean; browse: () => void; onReview: (id: string) => void; onManage: (watch: Watch) => void; blocked: boolean;
}) {
  const t = useMedTechT(), date = useDate();
  if (busy && !loaded) return <p className={s.status} role="status">{t("loadingWatches")}</p>;
  if (!loaded) return null;
  if (!items.length) return <div className={s.empty}><Star /><h2>{t("noWatches")}</h2><p>{t("noWatchesCopy")}</p><button className={s.primary} onClick={browse}>{t("browse")}</button></div>;
  return <section aria-label={t("watches")}><p className={s.caption}>{t("watchLimit")}</p><ul className={s.rows}>{items.map(watch =>
    <li className={s.watchRow} key={watch.id}><div><div className={s.watchName}>{watch.subject_id.replace(/^fda-(?:pma|510k)-/, "")}</div>
      <div className={s.rowMeta}>{t(watch.subject_type === "event" ? "exactRecord" : "pmaFamily")}</div>
      <div className={s.rowMeta}>{watch.triggers.map(trigger => t(trigger === "record_changed" ? "recordChanged" : "newSupplement")).join(" · ")}</div></div>
      <div><div className={s.caption}>{t("baseline")}</div><time className={s.rowMeta}>{date(watch.baseline_at, true)}</time></div>
      <div className={s.watchButtons}><button className={s.button} onClick={() => onReview(watch.id)}>{t("reviewChanges")}</button>
        <button className={s.quiet} disabled={blocked} onClick={() => onManage(watch)}>{t("manage")}</button></div>
    </li>)}</ul></section>;
}
function SourceSheet({ open, close, sources, event }: { open: boolean; close: () => void; sources: Source[]; event?: Event }) {
  const t = useMedTechT(), date = useDate();
  return <MobileSheet open={open} onClose={close} ariaLabel={t(event ? "evidence" : "sources")} className={s.sheet} maxHeight="92dvh">
    <div className={s.sheetContent}><div className={s.sheetHead}><h2>{t(event ? "evidence" : "sources")}</h2><button className={s.quiet} onClick={close}>{t("close")}</button></div>
      <p className={s.caption}>{t("referenceCopy")}</p>
      {event && <section className={s.panel}><h2>{event.source.record_id}</h2><dl className={s.facts}>
        <div><dt>{t("decisionDate")}</dt><dd>{date(event.decision.date)}</dd></div>
        <div><dt>{t("publicationDate")}</dt><dd>{event.source.source_published_at ? date(event.source.source_published_at, true) : t("publicationUnknown")}</dd></div>
        <div><dt>{t("first_observed")}</dt><dd>{date(event.first_observed_at, true)}</dd></div>
        <div><dt>{t("checked")}</dt><dd>{date(event.last_observed_at, true)}</dd></div>
      </dl><SourceLink url={event.source.url}>{t("viewFDA")}</SourceLink></section>}
      {sources.map(source => <section className={s.panel} key={source.dataset}><h2>FDA {source.dataset === "510k" ? "510(k)" : "PMA"}</h2>
        <dl className={s.facts}><div><dt>{t("datasetUpdated")}</dt><dd>{date(source.dataset_updated_at)}</dd></div>
          <div><dt>{t("checked")}</dt><dd>{date(source.last_checked_at, true)}</dd></div>
          <div><dt>{t("coverage")}</dt><dd>{date(source.coverage.start)} – {date(source.coverage.end)}</dd></div>
          <div><dt>{t(source.coverage.complete_for_query ? "completeQuery" : "incompleteQuery")}</dt><dd>{source.coverage.records.toLocaleString()} {t("recordCount")}</dd></div></dl>
      </section>)}
      {!sources.length && !event && <p>{t("sourceUnavailable")}</p>}
      <h3 className={s.sectionTitle}>{t("limitations")}</h3><p className={s.caption}>{t("limitationsCopy")}</p><p className={s.caption}>{t("deNovoCoverage")}</p>
    </div>
  </MobileSheet>;
}
function RecordDetail({ eventId, snapshot, blocked, watchDisabled, watches, onIssue, reload, onWatch, back, backKey }: {
  eventId: string; snapshot: string; blocked: boolean; watchDisabled: boolean; watches: Watch[]; onIssue: Issue; reload: () => void;
  onWatch: (event: Event) => void; back: () => void; backKey: string; onSource: () => void;
}) {
  const t = useMedTechT(), date = useDate(), [sourceOpen, setSourceOpen] = useState(false);
  const decode = useCallback((raw: unknown) => { const d = readDetail(raw); if (d.event.event_id !== eventId) throw new MedTechClientError(503, "invalid_response"); return d; }, [eventId]);
  const detail = useRead(query("/events/" + eventId, { snapshot_id: snapshot }), decode, onIssue, 0, snapshot);
  const event = detail.data?.event;
  const watching = watches.some(w => w.subject_type === "event" && w.subject_id === eventId);
  return <section data-testid="medtech-record"><button className={s.back} onClick={back}>← {t(backKey)}</button>
    {detail.error && <ReadError error={detail.error} retry={reload} />}
    {detail.busy && <p className={s.status} role="status">{t("loadingDetail")}</p>}
    {event && <>
      <div className={s.header}><div><p className={s.eyebrow}>{event.source.record_id} · <Pathway event={event} /></p>
        <h1 className={s.title}>{event.device.name || event.source.record_id}</h1><p className={s.subtitle}>{event.applicant.name || t("notReported")}</p></div>
        <button className={s.button} disabled={watchDisabled} onClick={() => onWatch(event)}><Star filled={watching} />{t(watching ? "watchSettings" : "watchRecord")}</button></div>
      <div className={s.hero}><div><p className={s.caption}>{t("decision")}</p><strong><Decision event={event} /></strong></div>
        <div><p className={s.caption}>{t("decisionDate")}</p><strong className={s.smallValue}>{date(event.decision.date)}</strong></div>
        <div><p className={s.caption}>{t("sourceRecord")}</p><strong className={s.smallValue}>{event.source.record_id}</strong></div></div>
      {event.decision.status === "unmapped" && <p className={s.status}>{t("unmappedCopy")}</p>}
      <div className={s.detailGrid}><div>
        <section className={s.panel}><h2>{t("evidence")}</h2><dl className={s.facts}>
          {([["received", date(event.received_on)], ["genericName", event.device.generic_name], ["productCode", event.device.product_code],
            ["decisionCode", event.decision.code], ["supplementType", event.supplement.type], ["supplementReason", event.supplement.reason]] as const)
            .filter(([key, value]) => value || !key.startsWith("supplement")).map(([key, value]) =>
            <div key={key}><dt>{t(key)}</dt><dd>{value || t("notReported")}</dd></div>)}
        </dl></section>
        <section style={{ marginTop: 28 }}><h2 className={s.sectionTitle}>{t("history")}</h2><RecordHistory eventId={eventId} snapshot={snapshot} onIssue={onIssue} reload={reload} blocked={blocked} /></section>
      </div><aside className={s.side}><section className={s.panel}><h2>{t("watchRecord")}</h2><p className={s.caption}>{t("baselineNote")}</p>
        <button className={s.primary} disabled={watchDisabled} onClick={() => onWatch(event)}><Star filled={watching} />{t(watching ? "watchSettings" : "watch")}</button>
        <p className={s.caption} style={{ marginTop: 12 }}>{t("inAppOnly")}</p></section>
        <section className={s.panel}><h2>{t("evidence")}</h2><p className={s.caption}>{t("monthly")}</p>
          <button className={s.button} onClick={() => setSourceOpen(true)}>{t("evidence")}</button><SourceLink url={event.source.url}>{t("viewFDA")}</SourceLink></section></aside></div>
      <SourceSheet open={sourceOpen} close={() => setSourceOpen(false)} sources={[]} event={event} />
    </>}
  </section>;
}
function RecordHistory({ eventId, snapshot, onIssue, reload, blocked }: { eventId: string; snapshot: string; onIssue: Issue; reload: () => void; blocked: boolean }) {
  const t = useMedTechT();
  const decode = useCallback((raw: unknown) => { const d = readHistory(raw); if (d.event_id !== eventId) throw new MedTechClientError(503, "invalid_response"); return d; }, [eventId]);
  const history = useRead(query("/events/" + eventId + "/changes", { snapshot_id: snapshot, limit: 25 }), decode, onIssue, 0, snapshot);
  return <>{history.busy && <p className={s.caption} role="status">{t("loadingChanges")}</p>}{history.error && <ReadError error={history.error} retry={reload} />}
    {history.data && <HistoryRows initial={history.data} path={"/events/" + eventId + "/changes"} decode={decode} snapshot={snapshot} onIssue={onIssue} reload={reload} blocked={blocked} />}</>;
}
function HistoryRows({ initial, path, decode, snapshot, onIssue, reload, blocked }: {
  initial: History; path: string; decode: (raw: unknown) => History; snapshot: string; onIssue: Issue; reload: () => void; blocked: boolean;
}) {
  const t = useMedTechT(), page = usePages<Revision, History>(initial, path, decode, snapshot, onIssue);
  return <><ul className={s.revisions}>{page.items.map(item => <li key={item.revision_id} className={s.revision}><RevisionContent item={item} /></li>)}</ul>
    {page.error && <ReadError error={page.error} retry={page.error.stale ? reload : page.load} />}
    {page.next !== null && <button className={s.button} disabled={page.busy || blocked} onClick={page.load}>{t(page.busy ? "loadingMore" : "loadMore")}</button>}</>;
}
function valueText(value: unknown, state: string, t: T) {
  if (state === "missing") return t("absent");
  if (value === null || value === undefined) return t("notReported");
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
const FIELD_LABELS: Record<string, string> = {
  "/device/name": "device", "/device/generic_name": "genericName", "/device/product_code": "productCode",
  "/applicant/name": "applicant", "/decision/code": "decisionCode", "/decision/date": "decisionDate",
  "/decision/status": "decision", "/decision/label": "decision", "/decision/source_description": "decision",
  "/received_on": "received", "/pathway": "pathway", "/pathway_label": "pathway",
  "/supplement/number": "supplement", "/supplement/type": "supplementType", "/supplement/reason": "supplementReason",
};
function RevisionContent({ item }: { item: Revision }) {
  const t = useMedTechT(), date = useDate();
  return <><div className={s.revisionHead}><h3>{t(KINDS.has(item.kind) ? item.kind : "unknownChange")}</h3>
    <time className={s.caption}>{t("observed")} · {date(item.observed_at, true)}</time></div>
    {item.kind === "first_observed" && <p className={s.caption}>{t("firstObservedCopy")}</p>}
    {item.kind === "normalization_changed" && <p className={s.caption}>{t("normalizationCopy")}</p>}
    {item.kind === "source_and_normalization_changed" && <p className={s.caption}>{t("combinedCopy")}</p>}
    {!!item.changes.length && <div className={s.diff}>{item.changes.map((change: Change) => <div className={s.diffRow} key={change.json_path}>
      <div className={s.diffLabel}>{FIELD_LABELS[change.json_path] ? t(FIELD_LABELS[change.json_path]) : change.json_path}
        {!FIELD_LABELS[change.json_path] && change.change_family && <small className={s.rowMeta}>{t("fieldFamily")} · {change.change_family}</small>}
      </div>
      <div className={s.diffValues}><div><small>{t("previous")}</small><p>{valueText(change.before_value, change.before_state, t)}</p></div>
        <div><small>{t("now")}</small><p>{valueText(change.after_value, change.after_state, t)}</p></div></div>
    </div>)}</div>}
  </>;
}
function WatchReview({ watch, snapshot, blocked, onIssue, reload, onManage, onRecord }: {
  watch: Watch; snapshot: string; blocked: boolean; onIssue: Issue; reload: () => void; onManage: () => void; onRecord: (id: string) => void;
}) {
  const t = useMedTechT(), date = useDate();
  const decode = useCallback((raw: unknown) => {
    const d = readUpdates(raw);
    if (d.watch_id !== watch.id) throw new MedTechClientError(503, "invalid_response");
    if (d.watch_version !== watch.version) throw new MedTechClientError(409, "watch_changed");
    return d;
  }, [watch.id, watch.version]);
  const path = "/watches/" + watch.id + "/updates";
  const updates = useRead(query(path, { snapshot_id: snapshot, limit: 25 }), decode, onIssue, 0, snapshot, watch.version);
  return <section data-testid="medtech-changes"><div className={s.header}><div><p className={s.eyebrow}>{t("reviewChanges")}</p>
    <h1 className={s.title}>{watch.subject_id.replace(/^fda-(?:pma|510k)-/, "")}</h1>
    <p className={s.subtitle}>{t("baseline")} {date(watch.baseline_at, true)}</p></div><button className={s.button} disabled={blocked} onClick={onManage}>{t("watchSettings")}</button></div>
    <p className={s.caption}>{t("reviewCopy")}</p>
    {updates.busy && <p role="status" className={s.status}>{t("loadingChanges")}</p>}
    {updates.error && <ReadError error={updates.error} retry={reload} />}
    {updates.data && <UpdateRows initial={updates.data} watch={watch} path={path} decode={decode} snapshot={snapshot}
      blocked={blocked} onIssue={onIssue} reload={reload} onRecord={onRecord} />}</section>;
}
function UpdateRows({ initial, watch, path, decode, snapshot, blocked, onIssue, reload, onRecord }: {
  initial: Updates; watch: Watch; path: string; decode: (raw: unknown) => Updates; snapshot: string; blocked: boolean;
  onIssue: Issue; reload: () => void; onRecord: (id: string) => void;
}) {
  const t = useMedTechT(), date = useDate(), alive = useAlive();
  const page = usePages<Update, Updates>(initial, path, decode, snapshot, onIssue);
  const [pending, setPending] = useState(""), [error, setError] = useState<MedTechClientError | null>(null);
  const lock = useRef(false);
  const mark = async (item: Update) => {
    if (lock.current || blocked) return;
    lock.current = true; setPending(item.revision_id); setError(null);
    try {
      await medtechRequest("/watches/" + watch.id + "/reviews", raw => confirmReview(raw, watch.id, item), {
        method: "POST", body: { event_id: item.event_id, revision_id: item.revision_id, snapshot_id: snapshot },
      });
      if (alive.current) page.setItems(items => items.map(row => row.event_id === item.event_id && row.revision_id === item.revision_id ? { ...row, reviewed: true } : row));
    } catch (caught) { if (alive.current) { const e = asError(caught); setError(e); onIssue(e); } }
    finally { lock.current = false; if (alive.current) setPending(""); }
  };
  if (!page.items.length) return <div className={s.empty}><h2>{t("noChanges")}</h2><p>{t("noChangesCopy")}</p></div>;
  return <><ul className={s.revisions} style={{ marginTop: 24 }}>{page.items.map(item => <li className={s.revision} key={item.event_id + item.revision_id}>
    <div className={s.revisionHead}><h3>{item.device_name || item.event_id.replace(/^fda-(?:pma|510k)-/, "")}</h3>
      {item.reviewed && <span className={s.badge}>{t("reviewed")}</span>}</div>
    <p className={s.caption}>{item.event_id.replace(/^fda-(?:pma|510k)-/, "")} · {t(item.trigger === "new_supplement" ? "newSupplement" : "recordChanged")}</p>
    <p className={s.caption}>{t("decisionDate")} · {date(item.decision_date)}</p><div style={{ marginTop: 18 }}><RevisionContent item={item} /></div>
    <div className={s.watchButtons}><button className={s.quiet} onClick={() => onRecord(item.event_id)}>{t("openRecord")}</button>
      <SourceLink url={item.source_url}>{t("viewFDA")}</SourceLink>
      <button className={s.button} disabled={blocked || !!pending || item.reviewed || !!error} onClick={() => mark(item)}>{t(item.reviewed ? "reviewed" : pending === item.revision_id ? "reviewing" : "markReviewed")}</button></div>
  </li>)}</ul>
    {error && <div className={s.notice} role="alert"><span>{errorCopy(error, t, true)}</span><button className={s.button} onClick={reload}>{t("refresh")}</button></div>}
    {page.error && <ReadError error={page.error} retry={page.error.stale ? reload : page.load} />}
    {page.next !== null && <button className={s.button} disabled={page.busy || blocked} onClick={page.load}>{t(page.busy ? "loadingMore" : "loadMore")}</button>}</>;
}
function WatchDialog({ event, initialWatch, watches, snapshot, blocked, close, onSaved, onRemoved, onIssue, reload, reloadWatches }: {
  event?: Event; initialWatch?: Watch; watches: Watch[]; snapshot: string; blocked: boolean; close: () => void;
  onSaved: (watch: Watch) => void; onRemoved: (id: string) => void; onIssue: Issue; reload: () => void; reloadWatches: () => void;
}) {
  const t = useMedTechT(), date = useDate(), alive = useAlive();
  const [scope, setScope] = useState<"event" | "pma_application">(initialWatch?.subject_type ?? "event");
  const subjectId = initialWatch?.subject_id ?? (scope === "pma_application" && event ? familyId(event) : event?.event_id) ?? "";
  const existing = initialWatch ?? watches.find(w => w.subject_type === scope && w.subject_id === subjectId);
  const [triggers, setTriggers] = useState<Trigger[]>(existing?.triggers ?? ["record_changed"]);
  const [removing, setRemoving] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState<MedTechClientError | null>(null);
  const lock = useRef(false);
  const setType = (type: "event" | "pma_application") => {
    const id = type === "event" ? event?.event_id : event && familyId(event);
    const found = watches.find(w => w.subject_type === type && w.subject_id === id);
    setScope(type); setTriggers(found?.triggers ?? (type === "event" ? ["record_changed"] : ["record_changed", "new_supplement"]));
    setRemoving(false); setError(null);
  };
  const toggle = (trigger: Trigger) => setTriggers(old => old.includes(trigger) ? old.filter(x => x !== trigger) : [...old, trigger]);
  const submit = async (remove = false) => {
    if (lock.current || blocked || (!remove && !triggers.length)) return;
    lock.current = true; setPending(true); setError(null);
    try {
      if (remove && existing) {
        await medtechRequest("/watches/" + existing.id, raw => confirmDelete(raw, existing.id), { method: "DELETE", body: { version: existing.version } });
        if (alive.current) onRemoved(existing.id);
      } else {
        const saved = await medtechRequest(existing ? "/watches/" + existing.id : "/watches", readWatch, {
          method: existing ? "PATCH" : "POST", body: existing ? { version: existing.version, triggers } :
            { subject_type: scope, subject_id: subjectId, triggers, snapshot_id: snapshot },
        });
        if (saved.subject_id !== subjectId || saved.subject_type !== scope) throw new MedTechClientError(503, "invalid_response");
        if (alive.current) onSaved(saved);
      }
    } catch (caught) { if (alive.current) { const e = asError(caught); setError(e); onIssue(e); } }
    finally { lock.current = false; if (alive.current) setPending(false); }
  };
  return <MobileSheet open onClose={() => { if (!pending) close(); }} ariaLabel={t("watchSettings")} className={s.sheet} maxHeight="94dvh">
    <div className={s.sheetContent}><div className={s.sheetHead}><h2>{t("watchSettings")}</h2><button className={s.quiet} disabled={pending} onClick={close}>{t("close")}</button></div>
      <p className={s.break}>{event?.device.name || subjectId.replace(/^fda-(?:pma|510k)-/, "")}</p>
      {removing ? <><h3 className={s.sectionTitle}>{t("removeConfirm")}</h3><p className={s.caption}>{t("removeCopy")}</p></> : <>
        {!initialWatch ? <fieldset className={s.fieldset} disabled={pending}><legend>{t("scope")}</legend>
          <label className={s.option}><input type="radio" name="medtech-scope" checked={scope === "event"} onChange={() => setType("event")} /><span>{t("exactRecord")}<small>{event?.source.record_id}</small></span></label>
          {event && familyId(event) && <label className={s.option}><input type="radio" name="medtech-scope" checked={scope === "pma_application"} onChange={() => setType("pma_application")} /><span>{t("pmaFamily")}<small>{event.submission_id}</small></span></label>}
        </fieldset> : <p className={s.caption}>{t("originalScope")} · {t(scope === "event" ? "exactRecord" : "pmaFamily")}</p>}
        <fieldset className={s.fieldset} disabled={pending}><legend>{t("triggerLabel")}</legend>
          <label className={s.option}><input type="checkbox" checked={triggers.includes("record_changed")} onChange={() => toggle("record_changed")} /><span>{t("recordChanged")}</span></label>
          {scope === "pma_application" && <label className={s.option}><input type="checkbox" checked={triggers.includes("new_supplement")} onChange={() => toggle("new_supplement")} /><span>{t("newSupplement")}<small>{t("familyNote")}</small></span></label>}
        </fieldset>
        {!triggers.length && <p role="status">{t("atLeastOne")}</p>}
        {existing ? <p className={s.caption}>{t("baseline")} {date(existing.baseline_at, true)}</p> : <p className={s.caption}>{t("baselineNote")}</p>}
        <p className={s.caption}>{t("inAppOnly")}</p>
      </>}
      {blocked && <div className={s.notice} role="alert"><span>{t("snapshotChanged")}</span><button className={s.button} onClick={reload}>{t("refresh")}</button></div>}
      {error && <div className={s.notice} role="alert"><span>{errorCopy(error, t, true)}</span><button className={s.button} onClick={error.stale ? reload : reloadWatches}>{t(error.stale ? "refresh" : "reloadWatches")}</button></div>}
      <div className={s.sheetFooter}>
        {existing && !removing && <button className={s.quiet} disabled={pending || blocked || !!error} onClick={() => setRemoving(true)}>{t("removeWatch")}</button>}
        {removing && <button className={s.button} disabled={pending} onClick={() => setRemoving(false)}>{t("cancel")}</button>}
        <button className={s.primary} disabled={pending || blocked || !!error || (!removing && !triggers.length)} onClick={() => submit(removing)}>
          {t(pending ? "saving" : removing ? "removeWatch" : existing ? "saveSettings" : "saveWatch")}</button>
      </div>
    </div>
  </MobileSheet>;
}

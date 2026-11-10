"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { ownerKeyFor } from "@/lib/accountIdentity";
import { browserStorage, readOwnerSlot, writeOwnerSlot } from "@/lib/ownerStorage";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
import { freshnessLabel, readingFreshness } from "@/lib/shared-shell/readingFreshness";
import { useReadingClock } from "@/lib/shared-shell/useReadingClock";
import styles from "@/components/workspaces/ReadingWorkspace.module.css";
import today from "./TodayWorkspace.module.css";
import TodayRiskEvents from "./TodayRiskEvents";
import { todayBriefContext, type TodayBriefContext } from "@/lib/shared-shell/todayBriefContext";

// "Since your last visit" — the retention half of the portfolio brief, on the product home.
//
// The desk (macro-api, portfolio_changes.v1) diffs the state digest this browser stored at
// the previous visit against tonight's context for the names the customer holds, and
// returns its own change lines verbatim. This component originates nothing: it stores one
// digest per owner in localStorage, posts it back, and renders the desk's sentences.
//
// TWO-ORGANISMS law: the digest is the customer's ticker set. It lives ONLY in the owner's
// slot of one localStorage envelope (lib/ownerStorage.ts — the house format every
// owner-scoped key uses), is never logged, never sent anywhere but the same-origin proxy,
// and is only overwritten after the desk answered 200 (a failed read must not erase
// history). A 401 — the owner is gone from this browser — clears that owner's slot.

/** Composition handles for the desk's jobs: the paid slot, the unpaid teaser, and the phase
 *  that chose between them. The consumer nests the rest of Today around these nodes, so this
 *  holder — and its reads, its stored digest, and its focus state — never remounts. */
type SinceParts = { priority: ReactNode; teaser: ReactNode; context: ReactNode; phase: Phase };
type Props = { ownerKey: string; scope: { current: AbortController | null }; onUnauthenticated: () => void;
  render?: (parts: SinceParts) => ReactNode };
type Change = { kind: string; en: string; zh: string; ticker?: string; sector?: string };
type Cursor = { note_en: string; note_zh: string } | null;
type Population = { mode: string; en: string; zh: string };
type ComparisonBasis = {
  previousAvailable: boolean;
  previousAsOf: string | null;
  previousEmpty: boolean;
  population: string | null;
  saved: boolean;
};
type Reading = {
  basis: ComparisonBasis;
  asof: string | null;
  firstVisit: boolean;
  changes: Change[];
  cursor: Cursor;
  /** The desk's disclosure sentence for the set the change lines describe, or null. */
  population: { en: string; zh: string } | null;
};
type Phase = "loading" | "ready" | "teaser" | "unavailable" | "ended";

const BRIEF_URL = "/api/portfolio-brief";
const CHANGES_URL = "/api/portfolio-changes";
/** Lines shown before the reader asks for the rest; every desk line stays available here. */
const MAX_LINES = 6;
/** One envelope for every owner — `{ "<owner>": <digest> }` (lib/ownerStorage.ts). */
export const STORAGE_KEY = "mmx.today.since.v1";
/** Up to the desk's own name limit (engine/portfolio_changes.py `_NAME_LIMIT = 48`). */
const TICKER = /^[A-Z0-9.\-]{1,48}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structurally a desk digest: a `names` mapping (possibly empty — that is a real visit). */
export function isDigest(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isRecord(value.names);
}

/** The envelope slot this owner's digest lives under (`account:<uuid>`). */
export function ownerSlot(ownerKey: string): string {
  return ownerKeyFor(ownerKey);
}

function readStored(ownerKey: string): Record<string, unknown> | null {
  const storage = browserStorage();
  if (!storage) return null;
  const value = readOwnerSlot(storage, STORAGE_KEY, ownerSlot(ownerKey));
  return isDigest(value) ? value : null;
}

/** Replace (or, with undefined, delete) this owner's digest; every other owner's slot is
 *  left byte-identical. A refused write keeps the current reading useful, but must be
 *  disclosed: a later comparison may use an older baseline or no usable baseline. */
function writeStored(ownerKey: string, digest: Record<string, unknown> | undefined): boolean {
  const storage = browserStorage();
  return storage ? writeOwnerSlot(storage, STORAGE_KEY, ownerSlot(ownerKey), digest) : false;
}

function parseChange(value: unknown): Change | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== "string" || typeof value.en !== "string" || typeof value.zh !== "string") return null;
  const change: Change = { kind: value.kind, en: value.en, zh: value.zh };
  if (typeof value.ticker === "string" && TICKER.test(value.ticker)) change.ticker = value.ticker;
  if (typeof value.sector === "string") change.sector = value.sector;
  return change;
}

type Parsed = { reading: Omit<Reading, "population" | "basis">; population: string | null; digest: Record<string, unknown> };

function parseChanges(payload: unknown): Parsed | null {
  if (!isRecord(payload) || payload.schema !== "portfolio_changes.v1") return null;
  if (typeof payload.first_visit !== "boolean" || !Array.isArray(payload.changes)) return null;
  if (!isDigest(payload.state_digest)) return null;
  const changes: Change[] = [];
  for (const entry of payload.changes) {
    const change = parseChange(entry);
    if (!change) return null;
    changes.push(change);
  }
  const cursor = isRecord(payload.cursor) && typeof payload.cursor.note_en === "string" && typeof payload.cursor.note_zh === "string"
    ? { note_en: payload.cursor.note_en, note_zh: payload.cursor.note_zh }
    : null;
  return {
    reading: {
      asof: typeof payload.asof === "string" ? payload.asof : null,
      firstVisit: payload.first_visit,
      changes,
      cursor,
    },
    // The set the change lines were diffed over (positions | watchlist_union | unspecified).
    population: typeof payload.population === "string" ? payload.population : null,
    digest: payload.state_digest,
  };
}

/** The desk's own population sentence from a brief payload (v2), with the mode it names. */
function parsePopulation(payload: unknown): Population | null {
  if (!isRecord(payload) || !isRecord(payload.population)) return null;
  const { mode, disclosure_en, disclosure_zh } = payload.population;
  if (typeof mode !== "string" || typeof disclosure_en !== "string" || typeof disclosure_zh !== "string") return null;
  return { mode, en: disclosure_en, zh: disclosure_zh };
}

/** The brief's sentence describes the change lines only when both reads name the same set:
 *  the brief proxy caches for minutes, the diff is per request, and a cached "positions"
 *  sentence over "watchlist_union" lines would be a false disclosure. */
function populationFor(brief: Population | null, changes: string | null): { en: string; zh: string } | null {
  if (!brief || !changes || brief.mode !== changes) return null;
  return { en: brief.en, zh: brief.zh };
}

/** A desk date is not a visit time. Do not normalize malformed dates or infer chronology. */
function deskDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? value : null;
}

const COPY = {
  en: {
    title: "Since your last reading",
    portfolio: "Open Portfolio",
    loading: "Reading what changed in your names…",
    teaser: "Compare saved readings with the Pro portfolio brief.",
    teaserLink: "See the Pro brief",
    unavailable: "The comparison is unavailable. Existing saved readings are unchanged.",
    retry: "Check again",
    first: "No earlier comparison is available for this reading.",
    quiet: "No tracked changes in this reading.",
    asof: "Desk read as of",
    basis: "Comparison basis", local: "This account · this browser",
    previousDate: "Saved reading date", returnedDate: "Returned reading date",
    population: "Current selection", priorPopulation: "Previous selection type",
    noDate: "Date unavailable", noPrevious: "No usable saved reading", notRecorded: "Not recorded",
    positions: "Held names", watchlists: "Watchlist symbols", unspecified: "Not specified",
    basisNote: "Reading dates are not visit times. Only the returned fields are compared.",
    emptyBasis: "The saved reading has no covered names. This does not mean your lists or holdings are empty.",
    saveUnconfirmed: "This reading is available, but saving the next comparison was not confirmed.",
    more: (count: number) => `Show ${count} more change${count === 1 ? "" : "s"}`,
    open: (ticker: string) => `Open ${ticker} in Analysis`,
  },
  zh: {
    title: "与已保存读数比较",
    portfolio: "打开投资组合",
    loading: "正在读取你的持仓变化…",
    teaser: "通过 Pro 投资组合简报，比较已保存的读数。",
    teaserLink: "查看 Pro 简报",
    unavailable: "暂时无法读取比较。已有的保存读数保持不变。",
    retry: "重新检查",
    first: "此次读数没有可用的先前比较。",
    quiet: "此次读数未返回已跟踪项目的变化。",
    asof: "桌面读数截至",
    basis: "比较依据", local: "当前账户 · 当前浏览器",
    previousDate: "已保存读数日期", returnedDate: "此次返回读数日期",
    population: "当前标的范围", priorPopulation: "先前标的范围类型",
    noDate: "日期不可用", noPrevious: "无可用的已保存读数", notRecorded: "未记录",
    positions: "持仓标的", watchlists: "关注列表标的", unspecified: "未指定",
    basisNote: "读数日期不是访问时间；比较仅涵盖返回的字段。",
    emptyBasis: "已保存读数未覆盖任何标的，不代表你的关注列表或持仓为空。",
    saveUnconfirmed: "此次读数仍可查看，但尚未确认已保存供下次比较的记录。",
    more: (count: number) => `显示另外 ${count} 项变化`,
    open: (ticker: string) => `在分析页打开 ${ticker}`,
  },
};

export default function TodaySinceLastVisit(props: Props) {
  // The ownerKey key destroys the read and the rendered lines on every subject departure.
  return <TodaySinceLastVisitSession key={props.ownerKey} {...props} />;
}

function TodaySinceLastVisitSession({ ownerKey, scope, onUnauthenticated, render }: Props) {
  const { lang } = useLang();
  const c = COPY[lang];
  const pick = (pair: { en: string; zh: string }) => (lang === "zh" ? pair.zh : pair.en);
  const [phase, setPhase] = useState<Phase>("loading");
  const [reading, setReading] = useState<Reading | null>(null);
  const [contextRead, setContextRead] = useState<TodayBriefContext | null>(null);
  const [showAll, setShowAll] = useState(false);
  // The expand control unmounts once pressed; focus moves to the first revealed line so a
  // keyboard or screen-reader user does not land on <body>.
  const revealed = useRef<HTMLLIElement | null>(null);
  useEffect(() => { if (showAll) revealed.current?.focus(); }, [showAll]);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  useEffect(() => { onUnauthenticatedRef.current = onUnauthenticated; });

  useEffect(() => {
    const controller = scope.current;
    if (!controller || controller.signal.aborted) return;
    const read = ++generation.current;
    let alive = true;
    const stale = () => !alive || read !== generation.current || scope.current !== controller || controller.signal.aborted;
    const hide = () => { if (!alive) return; setPhase("ended"); setReading(null); setContextRead(null); };
    controller.signal.addEventListener("abort", hide, { once: true });
    queueMicrotask(() => {
      if (stale()) return;
      void (async () => {
        try {
          // The brief first: it is the same Pro gate, and it carries the desk's own
          // population sentence. Only a 200 there is followed by the diff.
          const brief = await readingJson(scope, BRIEF_URL);
          if (stale()) return;
          if (brief.response.status === 401) { writeStored(ownerKey, undefined); setPhase("ended"); onUnauthenticatedRef.current(); return; }
          if (brief.response.status === 403) { setPhase("teaser"); return; }
          if (!brief.response.ok) { setPhase("unavailable"); return; }
          const population = parsePopulation(brief.value);
          setContextRead(todayBriefContext(brief.value));

          const previous = readStored(ownerKey);
          const changes = await readingJson(scope, CHANGES_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ previous }),
          });
          if (stale()) return;
          if (changes.response.status === 401) { writeStored(ownerKey, undefined); setPhase("ended"); onUnauthenticatedRef.current(); return; }
          if (changes.response.status === 403) { setPhase("teaser"); return; }
          const parsed = changes.response.ok ? parseChanges(changes.value) : null;
          if (!parsed) { setPhase("unavailable"); return; }
          // Capture the request's actual prior baseline BEFORE advancing the slot. The
          // inspector must never reconstruct it by rereading the now-overwritten storage.
          const basis: ComparisonBasis = {
            previousAvailable: previous !== null,
            previousAsOf: deskDate(previous?.asof),
            previousEmpty: previous !== null && Object.keys(previous.names as Record<string, unknown>).length === 0,
            population: parsed.population,
            saved: writeStored(ownerKey, parsed.digest),
          };
          setReading({ ...parsed.reading, population: populationFor(population, parsed.population), basis });
          setPhase("ready");
        } catch {
          if (stale()) return;
          setPhase("unavailable");
        }
      })();
    });
    return () => { alive = false; controller.signal.removeEventListener("abort", hide); };
  }, [attempt, ownerKey, scope]);

  const clockBucket = useCallback((at: Date) => {
    const age = readingFreshness(reading?.asof, at);
    const contextAge = readingFreshness(contextRead?.asof, at);
    return `${age.kind}|${age.sessions}|${age.days}|${contextAge.kind}|${contextAge.sessions}`;
  }, [reading?.asof, contextRead?.asof]);
  const now = useReadingClock(clockBucket);
  const age = readingFreshness(reading?.asof, now);

  const retry = () => { setPhase("loading"); setReading(null); setContextRead(null); setShowAll(false); setAttempt(value => value + 1); };

  // Paid first: every state except the teaser holds the opening slot. The unpaid teaser —
  // and only the teaser — moves after the saved watch attention, reading continuation, and
  // research briefing through `render`; one session renders both slots, so nothing remounts.
  if (phase === "ended") return render ? <>{render({ priority: null, teaser: null, context: null, phase })}</> : null;

  const all = reading?.changes ?? [];
  const lines = showAll ? all : all.slice(0, MAX_LINES);
  const extra = all.length - lines.length;

  const header = <div className={today.jobHeader}>
    <h2>{c.title}</h2>
    <Link href="/portfolio">{c.portfolio}<span aria-hidden="true">→</span></Link>
  </div>;
  const priority = phase === "teaser" ? null : <section className={today.sinceJob} data-today-since-state={phase} aria-label={c.title}>
    {header}
    {phase === "loading" && <p className={styles.notice} role="status">{c.loading}</p>}
    {phase === "unavailable" && <div>
      <p className={styles.notice} role="status">{c.unavailable}</p>
      <div className={styles.actions}><button type="button" onClick={retry}>{c.retry}</button></div>
    </div>}
    {phase === "ready" && reading && <>
      {reading.firstVisit ? <p className={styles.notice}>{c.first}</p>
        : lines.length === 0 ? <p className={styles.notice}>{c.quiet}</p>
        : <ul className={today.sinceList}>
          {lines.map((change, index) => <li key={`${change.kind}|${change.ticker ?? change.sector ?? index}`} className={today.sinceRow}
            ref={showAll && index === MAX_LINES ? revealed : undefined} tabIndex={showAll && index === MAX_LINES ? -1 : undefined}>
            {change.ticker && <Link href={`/analysis?symbol=${encodeURIComponent(change.ticker)}`} aria-label={c.open(change.ticker)}>{change.ticker}</Link>}
            <p>{pick(change)}</p>
          </li>)}
        </ul>}
      {extra > 0 && <div className={styles.actions}><button type="button" onClick={() => setShowAll(true)}>{c.more(extra)}</button></div>}
      {(reading.asof || reading.population) && <p className={today.sinceMeta}>
        {reading.asof && <>{c.asof} <strong>{reading.asof}</strong>{reading.population ? " · " : ""}</>}
        {reading.population && pick(reading.population)}
        {reading.asof && age.kind !== "undated" && <span className={today.readingAge} data-kind={age.kind}> · {freshnessLabel(age, lang)}</span>}
      </p>}
      {!reading.basis.saved && <p className={today.saveWarning} role="status">{c.saveUnconfirmed}</p>}
      <details className={today.comparisonBasis} data-today-comparison-basis>
        <summary>{c.basis}<span>{c.local}</span></summary>
        <dl>
          <div><dt>{c.previousDate}</dt><dd>{reading.basis.previousAvailable ? reading.basis.previousAsOf || c.noDate : c.noPrevious}</dd></div>
          <div><dt>{c.returnedDate}</dt><dd>{deskDate(reading.asof) || c.noDate}</dd></div>
          <div><dt>{c.population}</dt><dd>{reading.basis.population === "positions" ? c.positions : reading.basis.population === "watchlist_union" ? c.watchlists : c.unspecified}</dd></div>
          <div><dt>{c.priorPopulation}</dt><dd>{c.notRecorded}</dd></div>
        </dl>
        <p>{c.basisNote}</p>
        {reading.basis.previousEmpty && <p>{c.emptyBasis}</p>}
        {reading.cursor && <p>{lang === "zh" ? reading.cursor.note_zh : reading.cursor.note_en}</p>}
      </details>
    </>}
  </section>;
  const teaser = phase === "teaser" ? <section className={today.sinceJob} data-today-since-state={phase} aria-label={c.title}>
    {header}
    <p className={today.sinceTeaser}>{c.teaser}
      <Link href="/portfolio">{c.teaserLink}<span aria-hidden="true">→</span></Link>
    </p>
  </section> : null;

  // A failed comparison does not erase a separately valid brief. A 401/403 does.
  // The source snapshot is never persisted or fetched again by the presentation.
  const context = phase !== "teaser" && contextRead && (contextRead.regime.length > 0 || (contextRead.earnings?.length ?? 0) > 0)
    ? <TodayRiskEvents value={contextRead} now={now} /> : null;
  if (render) return <>{render({ priority, teaser, context, phase })}</>;
  return teaser ?? priority;
}

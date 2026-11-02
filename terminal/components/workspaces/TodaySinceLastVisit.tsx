"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { ownerKeyFor } from "@/lib/accountIdentity";
import { browserStorage, readOwnerSlot, writeOwnerSlot } from "@/lib/ownerStorage";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
import styles from "@/components/workspaces/ReadingWorkspace.module.css";
import today from "./TodayWorkspace.module.css";

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

type Props = { ownerKey: string; scope: { current: AbortController | null }; onUnauthenticated: () => void };
type Change = { kind: string; en: string; zh: string; ticker?: string; sector?: string };
type Cursor = { note_en: string; note_zh: string } | null;
type Population = { mode: string; en: string; zh: string };
type Reading = {
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
 *  left byte-identical. A refused write (private mode, quota) is not an error: the section
 *  still renders, and the next visit simply reads as a first visit again. */
function writeStored(ownerKey: string, digest: Record<string, unknown> | undefined): void {
  const storage = browserStorage();
  if (storage) writeOwnerSlot(storage, STORAGE_KEY, ownerSlot(ownerKey), digest);
}

function parseChange(value: unknown): Change | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== "string" || typeof value.en !== "string" || typeof value.zh !== "string") return null;
  const change: Change = { kind: value.kind, en: value.en, zh: value.zh };
  if (typeof value.ticker === "string" && TICKER.test(value.ticker)) change.ticker = value.ticker;
  if (typeof value.sector === "string") change.sector = value.sector;
  return change;
}

type Parsed = { reading: Omit<Reading, "population">; population: string | null; digest: Record<string, unknown> };

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

const COPY = {
  en: {
    title: "Since your last visit",
    portfolio: "Open Portfolio",
    loading: "Reading what changed in your names…",
    teaser: "The desk's since-last-visit read is part of the Pro portfolio brief, composed over the names you hold.",
    teaserLink: "See the Pro brief",
    unavailable: "What changed in your names could not be read. Your stored marker is kept.",
    retry: "Check again",
    first: "First visit on this device. Changes to your names will appear from your next visit.",
    quiet: "Nothing the desk tracks moved for your names since your last visit.",
    asof: "Desk read as of",
    more: (count: number) => `Show ${count} more change${count === 1 ? "" : "s"}`,
    open: (ticker: string) => `Open ${ticker} in Analysis`,
  },
  zh: {
    title: "自你上次查看以来",
    portfolio: "打开投资组合",
    loading: "正在读取你的持仓变化…",
    teaser: "桌面的“自你上次查看以来”判读属于 Pro 投资组合简报，基于你持有的名称生成。",
    teaserLink: "查看 Pro 简报",
    unavailable: "无法读取你的持仓变化。已保存的记录将保留。",
    retry: "重新检查",
    first: "这是本设备的首次查看。你的持仓变化将从下次查看起显示。",
    quiet: "自你上次查看以来，桌面跟踪的内容在你的名称上没有变化。",
    asof: "桌面读数截至",
    more: (count: number) => `显示另外 ${count} 项变化`,
    open: (ticker: string) => `在分析页打开 ${ticker}`,
  },
};

export default function TodaySinceLastVisit(props: Props) {
  // The ownerKey key destroys the read and the rendered lines on every subject departure.
  return <TodaySinceLastVisitSession key={props.ownerKey} {...props} />;
}

function TodaySinceLastVisitSession({ ownerKey, scope, onUnauthenticated }: Props) {
  const { lang } = useLang();
  const c = COPY[lang];
  const pick = (pair: { en: string; zh: string }) => (lang === "zh" ? pair.zh : pair.en);
  const [phase, setPhase] = useState<Phase>("loading");
  const [reading, setReading] = useState<Reading | null>(null);
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
    const hide = () => { if (!alive) return; setPhase("ended"); setReading(null); };
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
          // Only a desk answer advances the marker.
          writeStored(ownerKey, parsed.digest);
          setReading({ ...parsed.reading, population: populationFor(population, parsed.population) });
          setPhase("ready");
        } catch {
          if (stale()) return;
          setPhase("unavailable");
        }
      })();
    });
    return () => { alive = false; controller.signal.removeEventListener("abort", hide); };
  }, [attempt, ownerKey, scope]);

  const retry = () => { setPhase("loading"); setReading(null); setShowAll(false); setAttempt(value => value + 1); };

  if (phase === "ended") return null;

  const all = reading?.changes ?? [];
  const lines = showAll ? all : all.slice(0, MAX_LINES);
  const extra = all.length - lines.length;

  return <section className={today.sinceJob} data-today-since-state={phase} aria-label={c.title}>
    <div className={today.jobHeader}>
      <h2>{c.title}</h2>
      <Link href="/portfolio">{c.portfolio}<span aria-hidden="true">→</span></Link>
    </div>
    {phase === "loading" && <p className={styles.notice} role="status">{c.loading}</p>}
    {phase === "teaser" && <div>
      <p className={styles.notice}>{c.teaser}</p>
      <div className={styles.actions}><Link href="/portfolio">{c.teaserLink}<span aria-hidden="true">→</span></Link></div>
    </div>}
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
      </p>}
      {reading.cursor && <p className={today.sinceFoot}>{lang === "zh" ? reading.cursor.note_zh : reading.cursor.note_en}</p>}
    </>}
  </section>;
}

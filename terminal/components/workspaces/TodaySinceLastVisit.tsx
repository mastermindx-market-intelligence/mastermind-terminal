"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
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
// TWO-ORGANISMS law: the digest is the customer's ticker set. It lives ONLY in this one
// localStorage key, is never logged, never sent anywhere but the same-origin proxy, and is
// only overwritten after the desk answered 200 (a failed read must not erase history).

type Props = { ownerKey: string; scope: { current: AbortController | null }; onUnauthenticated: () => void };
type Change = { kind: string; en: string; zh: string; ticker?: string; sector?: string };
type Cursor = { note_en: string; note_zh: string } | null;
type Reading = {
  asof: string | null;
  firstVisit: boolean;
  changes: Change[];
  cursor: Cursor;
  population: { en: string; zh: string } | null;
};
type Phase = "loading" | "ready" | "teaser" | "unavailable" | "ended";

const BRIEF_URL = "/api/portfolio-brief";
const CHANGES_URL = "/api/portfolio-changes";
/** At most this many desk lines are shown here; the rest stay on Portfolio. */
const MAX_LINES = 6;
const STORAGE_PREFIX = "mmx.today.since.v1:";
const TICKER = /^[A-Z0-9.\-]{1,12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structurally a desk digest: a `names` mapping (possibly empty — that is a real visit). */
export function isDigest(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isRecord(value.names);
}

export function storageKey(ownerKey: string): string {
  return STORAGE_PREFIX + ownerKey;
}

function readStored(ownerKey: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(ownerKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDigest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(ownerKey: string, digest: Record<string, unknown>): void {
  try {
    window.localStorage.setItem(storageKey(ownerKey), JSON.stringify(digest));
  } catch {
    // Storage refused (private mode, quota): the section still renders; the next visit
    // simply reads as a first visit again.
  }
}

function parseChange(value: unknown): Change | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== "string" || typeof value.en !== "string" || typeof value.zh !== "string") return null;
  const change: Change = { kind: value.kind, en: value.en, zh: value.zh };
  if (typeof value.ticker === "string" && TICKER.test(value.ticker)) change.ticker = value.ticker;
  if (typeof value.sector === "string") change.sector = value.sector;
  return change;
}

function parseChanges(payload: unknown): { reading: Omit<Reading, "population">; digest: Record<string, unknown> } | null {
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
    digest: payload.state_digest,
  };
}

/** The desk's own population sentence from a brief payload (v2), when it carries one. */
function parsePopulation(payload: unknown): { en: string; zh: string } | null {
  if (!isRecord(payload) || !isRecord(payload.population)) return null;
  const { disclosure_en, disclosure_zh } = payload.population;
  if (typeof disclosure_en !== "string" || typeof disclosure_zh !== "string") return null;
  return { en: disclosure_en, zh: disclosure_zh };
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
    more: (count: number) => `${count} further change${count === 1 ? "" : "s"} on Portfolio.`,
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
    more: (count: number) => `另有 ${count} 项变化见投资组合页。`,
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
          if (brief.response.status === 401) { setPhase("ended"); onUnauthenticatedRef.current(); return; }
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
          if (changes.response.status === 401) { setPhase("ended"); onUnauthenticatedRef.current(); return; }
          if (changes.response.status === 403) { setPhase("teaser"); return; }
          const parsed = changes.response.ok ? parseChanges(changes.value) : null;
          if (!parsed) { setPhase("unavailable"); return; }
          // Only a desk answer advances the marker.
          writeStored(ownerKey, parsed.digest);
          setReading({ ...parsed.reading, population });
          setPhase("ready");
        } catch {
          if (stale()) return;
          setPhase("unavailable");
        }
      })();
    });
    return () => { alive = false; controller.signal.removeEventListener("abort", hide); };
  }, [attempt, ownerKey, scope]);

  const retry = () => { setPhase("loading"); setReading(null); setAttempt(value => value + 1); };

  if (phase === "ended") return null;

  const lines = reading?.changes.slice(0, MAX_LINES) ?? [];
  const extra = reading ? reading.changes.length - lines.length : 0;

  return <section data-today-since-state={phase} aria-label={c.title}>
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
          {lines.map((change, index) => <li key={`${change.kind}|${change.ticker ?? change.sector ?? index}`} className={today.sinceRow}>
            {change.ticker && <Link href={`/analysis?symbol=${encodeURIComponent(change.ticker)}`} aria-label={c.open(change.ticker)}>{change.ticker}</Link>}
            <p>{pick(change)}</p>
          </li>)}
        </ul>}
      {extra > 0 && <p className={styles.coverage}><Link href="/portfolio">{c.more(extra)}</Link></p>}
      {(reading.asof || reading.population) && <p className={today.sinceMeta}>
        {reading.asof && <>{c.asof} <strong>{reading.asof}</strong>{reading.population ? " · " : ""}</>}
        {reading.population && pick(reading.population)}
      </p>}
      {reading.cursor && <p className={today.sinceFoot}>{lang === "zh" ? reading.cursor.note_zh : reading.cursor.note_en}</p>}
    </>}
  </section>;
}

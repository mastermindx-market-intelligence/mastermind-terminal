"use client";
/**
 * Watchlist event planner (E14) — an on-demand agenda of the known company report dates for ONE
 * watchlist, read from the existing per-company fundamentals files. See lib/watchlistEventPlanner.ts
 * for the truth rules. This component owns presentation, the bounded read lifecycle and the
 * list-switch fence; it creates no store, no timer and no reminder.
 *
 * LIST-SWITCH FENCE (AC-E14-05). Every read belongs to one `loadKey` (list name + its symbols).
 * Answers are stored in a bucket per key, a run stops dispatching once its generation is no longer
 * current, and the render opens ONLY the bucket of the current key, so a late answer for the
 * previous list can never paint a row — not even for the commit between the switch and the effect.
 *
 * READ AGAIN (failure-state truth). "Read again" re-reads every company of the batch from the
 * network WITHOUT clearing the rows on screen: each row keeps its answer until the new one lands,
 * and a re-read that cannot reach the source keeps the earlier answer, labelled as an earlier copy
 * (`settleRead`). A refresh never turns a known date into "could not be read".
 */
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getJSONResult } from "@/lib/dataCache";
import { useLang } from "@/lib/i18n";
import { useEventPlannerT } from "@/lib/watchlistEventPlannerLex";
import {
  EVENT_READ_CONCURRENCY,
  EVENT_READ_LIMIT,
  buildAgenda,
  daysUntilDay,
  dualTime,
  formatDayHeading,
  formatShortDay,
  isCurrentAnswer,
  profileSymbol,
  runEventReads,
  settleRead,
  summarizeCoverage,
  uniqueListSymbols,
  unknownCount,
  type EventReadJob,
  type PlannerEvent,
  type PlannerLang,
  type ReadCurrency,
  type SymbolProfile,
  type SymbolRead,
} from "@/lib/watchlistEventPlanner";
import styles from "./WatchlistEventPlanner.module.css";

export interface PlannerSymbolInfo {
  name?: string | null;
  mkt?: string;
  sec?: string;
}

export interface WatchlistEventPlannerProps {
  lists: Record<string, readonly { symbol: string }[]>;
  initialList: string;
  symbolInfo?: (symbol: string) => PlannerSymbolInfo | null | undefined;
  onClose: () => void;
  onOpenCompany: (symbol: string) => void;
  /** Where focus returns when the planner closes and the opener is gone. */
  returnFocusTo?: HTMLElement | null;
}

type ReadMap = Record<string, SymbolRead>;

interface Batch {
  key: string;
  limit: number;
  /** Bumped by "Read again": that run asks the network instead of a cached copy. */
  refresh: number;
}

/** Progress of the "Read again" run for one batch refresh. */
interface Rerun {
  key: string;
  refresh: number;
  /** Companies whose re-read has answered. */
  done: number;
  /** The run finished while it was still the current one. */
  finished: boolean;
}

const NO_RERUN: Rerun = { key: "", refresh: 0, done: 0, finished: true };

function baseReads(symbols: readonly string[], profiles: Readonly<Record<string, SymbolProfile>>, limit: number): ReadMap {
  const reads: ReadMap = {};
  let companies = 0;
  for (const symbol of symbols) {
    if (!profiles[symbol]?.company) {
      reads[symbol] = { state: "not-company" };
      continue;
    }
    reads[symbol] = companies < limit ? { state: "pending" } : { state: "not-read" };
    companies += 1;
  }
  return reads;
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

export default function WatchlistEventPlanner({ lists, initialList, symbolInfo, onClose, onOpenCompany, returnFocusTo }: WatchlistEventPlannerProps) {
  const t = useEventPlannerT();
  const { lang } = useLang();
  const L: PlannerLang = lang === "zh" ? "zh" : "en";
  const titleId = useId();
  const listId = useId();

  const listNames = Object.keys(lists);
  const [selected, setSelected] = useState(() => (Object.hasOwn(lists, initialList) ? initialList : listNames[0] ?? ""));
  const listName = Object.hasOwn(lists, selected) ? selected : listNames[0] ?? "";
  const symbols = useMemo(() => uniqueListSymbols(lists[listName]), [lists, listName]);
  const loadKey = `${listName}\u0000${symbols.join(",")}`;

  const info = useMemo(() => new Map(symbols.map((s) => [s, symbolInfo?.(s) ?? null] as const)), [symbols, symbolInfo]);
  const profiles = useMemo(() => Object.fromEntries(symbols.map((s) => [s, profileSymbol(s, info.get(s) ?? null)])), [symbols, info]);

  const [batchState, setBatch] = useState<Batch>({ key: loadKey, limit: EVENT_READ_LIMIT, refresh: 0 });
  const batch: Batch = batchState.key === loadKey ? batchState : { key: loadKey, limit: EVENT_READ_LIMIT, refresh: 0 };
  const base = useMemo(() => baseReads(symbols, profiles, batch.limit), [symbols, profiles, batch.limit]);

  // Settled answers live in a bucket per list key; the render only ever opens the current bucket.
  const [results, setResults] = useState<Readonly<Record<string, ReadMap>>>({});
  const settledForList = results[loadKey];
  const reads = useMemo<ReadMap>(() => {
    if (!settledForList) return base;
    const merged: ReadMap = { ...base };
    for (const symbol of Object.keys(merged)) {
      const answer = settledForList[symbol];
      if (answer && merged[symbol].state === "pending") merged[symbol] = answer;
    }
    return merged;
  }, [base, settledForList]);

  const genRef = useRef(0);
  const liveKeyRef = useRef<string | null>(null);

  // A refresh is owed until its run FINISHES while current, so a re-read the view abandoned (a list
  // switch mid-run, or the dev double-mount) is asked again rather than downgraded to cached reads.
  const [rerun, setRerun] = useState<Rerun>(NO_RERUN);
  const rerunNow = rerun.key === loadKey && rerun.refresh === batch.refresh ? rerun : null;
  const refreshing = batch.refresh > 0 && !rerunNow?.finished;

  const applyRead = useCallback((key: string, symbol: string, read: SymbolRead) => {
    setResults((prev) => ({ ...prev, [key]: { ...prev[key], [symbol]: read } }));
  }, []);
  // A new answer over the one already held: a read that could not reach the source keeps it.
  const settle = useCallback((key: string, symbol: string, read: SymbolRead) => {
    setResults((prev) => ({ ...prev, [key]: { ...prev[key], [symbol]: settleRead(prev[key]?.[symbol], read) } }));
  }, []);
  const markRefreshFailed = useCallback((key: string, symbol: string) => {
    setResults((prev) => {
      const read = prev[key]?.[symbol];
      if (!read || (read.state !== "event" && read.state !== "no-date")) return prev;
      return { ...prev, [key]: { ...prev[key], [symbol]: { ...read, refreshFailed: true } } };
    });
  }, []);

  // A normal run reads the companies of the current batch that have no answer yet. A "Read again"
  // run (a refresh not yet finished) re-reads EVERY company of the batch from the network, and each
  // row keeps its answer until the new one lands.
  const startReads = useEffectEvent((key: string, refresh: number, isCurrent: () => boolean) => {
    const forced = refresh > 0 && !(rerun.key === key && rerun.refresh === refresh && rerun.finished);
    const settled = results[key] ?? {};
    const jobs: EventReadJob[] = [];
    for (const symbol of symbols) {
      if (base[symbol]?.state !== "pending") continue;
      const kept = settled[symbol];
      if (!forced && kept && kept.state !== "pending") continue;
      jobs.push({ symbol, profile: profiles[symbol] });
    }
    if (!forced && !jobs.length) return;
    const run = runEventReads(jobs, {
      read: getJSONResult,
      force: forced,
      concurrency: EVENT_READ_CONCURRENCY,
      isCurrent,
      // A correction that lands after a batch change still belongs to this list.
      isListCurrent: () => liveKeyRef.current === key,
      onResult: (symbol, read) => {
        settle(key, symbol, read);
        if (forced) {
          setRerun((prev) => (prev.key === key && prev.refresh === refresh
            ? { ...prev, done: prev.done + 1 }
            : { key, refresh, done: 1, finished: false }));
        }
      },
      onRefreshFailed: (symbol) => markRefreshFailed(key, symbol),
    });
    if (forced) {
      void run.then(() => {
        if (!isCurrent()) return;
        setRerun((prev) => ({ key, refresh, done: prev.key === key && prev.refresh === refresh ? prev.done : 0, finished: true }));
      });
    }
  });

  useEffect(() => {
    const gen = ++genRef.current;
    liveKeyRef.current = loadKey;
    startReads(loadKey, batch.refresh, () => genRef.current === gen);
    return () => {
      // Stops the queue of the previous run: a list switch also stops asking for the old list.
      genRef.current += 1;
    };
  }, [loadKey, batch.limit, batch.refresh]);

  useEffect(() => () => { liveKeyRef.current = null; }, []);

  const retry = (symbol: string) => {
    const key = loadKey;
    const profile = profiles[symbol];
    if (!profile?.company) return;
    applyRead(key, symbol, { state: "pending" });
    void runEventReads([{ symbol, profile }], {
      read: getJSONResult,
      force: true,
      concurrency: 1,
      isCurrent: () => liveKeyRef.current === key,
      onResult: (s, read) => applyRead(key, s, read),
    });
  };

  // Never clears the rows: the forced run settles each company over the answer it already has.
  const readAgain = () => {
    setBatch({ key: loadKey, limit: batch.limit, refresh: batch.refresh + 1 });
  };

  const coverage = summarizeCoverage(symbols, reads);
  const agenda = useMemo(() => buildAgenda(reads), [reads]);
  const currencyById = new Map<string, ReadCurrency>();
  for (const read of Object.values(reads)) {
    if (read.state === "event") currencyById.set(read.event.id, { stale: read.stale, refreshFailed: read.refreshFailed });
  }

  // ── dialog lifecycle ──
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") {
        try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
      } else {
        dialog.setAttribute("open", "");
      }
    }
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      if (document.body.style.overflow === "hidden") document.body.style.overflow = previousOverflow;
      const target = opener?.isConnected ? opener : returnFocusTo;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);

  const pendingDone = coverage.companies - coverage.notRead - coverage.pending;
  const readTotal = coverage.companies - coverage.notRead;
  let headline: string;
  if (coverage.symbols === 0) headline = t("wepEmptyList");
  else if (coverage.companies === 0) headline = t("wepNoCompanies");
  else if (refreshing) headline = fill(t("wepReadingAgain"), { done: rerunNow?.done ?? 0, total: readTotal });
  else if (coverage.pending > 0) headline = fill(t("wepReading"), { done: pendingDone, total: readTotal });
  else headline = fill(t("wepReadOf"), { read: coverage.read, total: coverage.companies });

  const chips: { key: string; text: string; tone: "warn" | "muted" }[] = [];
  if (coverage.unavailable) chips.push({ key: "unavailable", text: fill(t("wepCatUnavailable"), { n: coverage.unavailable }), tone: "warn" });
  if (coverage.absent) chips.push({ key: "absent", text: fill(t("wepCatAbsent"), { n: coverage.absent }), tone: "warn" });
  if (coverage.unreadable) chips.push({ key: "unreadable", text: fill(t("wepCatUnreadable"), { n: coverage.unreadable }), tone: "warn" });
  if (coverage.notRead) chips.push({ key: "not-read", text: fill(t("wepCatNotRead"), { n: coverage.notRead }), tone: "warn" });
  if (coverage.refreshFailed) chips.push({ key: "refresh-failed", text: fill(t("wepCatRefreshFailed"), { n: coverage.refreshFailed }), tone: "warn" });
  if (coverage.stale) chips.push({ key: "stale", text: fill(t("wepCatStale"), { n: coverage.stale }), tone: "warn" });
  if (coverage.outdated) chips.push({ key: "outdated", text: fill(t("wepCatOutdated"), { n: coverage.outdated }), tone: "warn" });
  if (coverage.notCompany) chips.push({ key: "not-company", text: fill(t("wepCatNotCompany"), { n: coverage.notCompany }), tone: "muted" });

  const settled = coverage.pending === 0;
  const incomplete = coverage.companies > 0 && !coverage.complete && settled;
  const unknown = unknownCount(coverage);

  const nameFor = (symbol: string): string | null => {
    const name = info.get(symbol)?.name;
    return name && name !== symbol ? name : null;
  };

  const relative = (day: string): string | null => {
    const n = daysUntilDay(day);
    if (n == null) return null;
    if (n === 0) return t("wepToday");
    if (n === 1) return t("wepTomorrow");
    return fill(t("wepInDays"), { n });
  };

  const reasonText = (read: SymbolRead): string => {
    switch (read.state) {
      case "no-date": return read.reason === "past" ? t("wepWhyPast") : t("wepWhyNone");
      case "unreadable": return t("wepWhyUnreadable");
      case "absent": return t("wepWhyAbsent");
      case "unavailable": return t("wepWhyUnavailable");
      case "not-read": return t("wepWhyNotRead");
      case "not-company": return t("wepWhyNotCompany");
      default: return t("wepWhyPending");
    }
  };

  const others = symbols.filter((symbol) => reads[symbol]?.state !== "event");

  const eventRow = (event: PlannerEvent) => {
    const name = nameFor(event.symbol);
    const currency = currencyById.get(event.id);
    const dual = event.when.precision === "instant" ? dualTime(event.when, L) : null;
    return (
      <li key={event.id}>
        <button
          type="button"
          className={styles.eventRow}
          onClick={() => onOpenCompany(event.symbol)}
          data-testid="wep-event"
          data-event-id={event.id}
          data-precision={event.when.precision}
          title={fill(t("wepOpenCompany"), { sym: event.symbol })}
        >
          <span className={styles.eventMain}>
            <b className={styles.sym}>{event.symbol}</b>
            {name && <span className={styles.name}>{name}</span>}
            {event.period && <span className={styles.period}>{fill(t("wepPeriod"), { p: event.period })}</span>}
          </span>
          <span className={styles.eventMeta}>
            {dual ? (
              <>
                <span className={styles.timeLine} data-testid="wep-exchange-time">
                  {dual.exchange ? `${t("wepExchangeTime")} ${dual.exchange.time}` : t("wepExchangeTzUnknown")}
                </span>
                <span className={styles.timeLine} data-testid="wep-local-time">
                  {`${t("wepYourTime")} ${dual.local.time}`}
                  {dual.local.day !== event.when.day ? ` · ${formatShortDay(dual.local.day, L)}` : ""}
                </span>
              </>
            ) : (
              <span className={styles.timeLine} data-testid="wep-date-only">{t("wepDateOnly")}</span>
            )}
            <span className={styles.quality}>{t("wepConfUnstated")}</span>
            {event.previousDay && (
              <span className={styles.moved} data-testid="wep-moved">{fill(t("wepMovedFrom"), { day: formatShortDay(event.previousDay, L) })}</span>
            )}
            {currency?.refreshFailed ? (
              <span className={styles.stale} data-testid="wep-earlier-copy">{t("wepEarlierCopy")}</span>
            ) : currency?.stale ? (
              <span className={styles.stale} data-testid="wep-saved-copy">{t("wepSavedCopy")}</span>
            ) : null}
            {event.sourceAsOf && <span className={styles.source}>{fill(t("wepSourceAsOf"), { day: formatShortDay(event.sourceAsOf, L) })}</span>}
          </span>
          <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </li>
    );
  };

  const node = (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      data-testid="wep-dialog"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => { if (event.target === dialogRef.current) onClose(); }}
    >
      <div className={styles.panel}>
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 id={titleId} className={styles.title}>{t("wepTitle")}</h2>
            <p className={styles.subtitle}>{t("wepSubtitle")}</p>
          </div>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label={t("wepClose")} data-testid="wep-close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className={styles.controls}>
          <label className={styles.listPick} htmlFor={listId}>
            <span>{t("wepList")}</span>
            <select id={listId} value={listName} onChange={(event) => setSelected(event.target.value)} data-testid="wep-list">
              {listNames.map((name) => (
                <option key={name} value={name}>{`${name} · ${lists[name].length}`}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.ghost}
            disabled={!settled || refreshing || coverage.companies === 0}
            onClick={readAgain}
            data-testid="wep-read-again"
          >
            {t("wepReadAgain")}
          </button>
        </div>

        <section
          className={styles.coverage}
          role="status"
          aria-live="polite"
          data-testid="wep-coverage"
          data-complete={coverage.complete ? "true" : "false"}
          data-unknown={String(unknown)}
          data-refreshing={refreshing ? "true" : "false"}
          aria-busy={refreshing || !settled}
        >
          <p className={styles.headline}>{headline}</p>
          {chips.length > 0 && (
            <ul className={styles.chips}>
              {chips.map((chip) => (
                <li key={chip.key} className={chip.tone === "warn" ? styles.chipWarn : styles.chip}>{chip.text}</li>
              ))}
            </ul>
          )}
          {incomplete && <p className={styles.incomplete} data-testid="wep-incomplete">{t("wepIncomplete")}</p>}
          {coverage.notRead > 0 && settled && !refreshing && (
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setBatch({ key: loadKey, limit: batch.limit + EVENT_READ_LIMIT, refresh: batch.refresh })}
              data-testid="wep-read-more"
            >
              {fill(t("wepReadMore"), { n: Math.min(EVENT_READ_LIMIT, coverage.notRead) })}
            </button>
          )}
        </section>

        <div className={styles.body}>
          {agenda.length > 0 && (
            <ol className={styles.days} data-testid="wep-agenda">
              {agenda.map((day) => {
                const rel = relative(day.day);
                return (
                  <li key={day.day} className={styles.day} data-day={day.day}>
                    <h3 className={styles.dayHead}>
                      <span>{formatDayHeading(day.day, L)}</span>
                      {rel && <span className={styles.rel}>{rel}</span>}
                    </h3>
                    {day.groups.map((group) => (
                      <div
                        key={group.kind} // plain-language-ok: React key, not rendered text
                        className={styles.group}
                      >
                        <h4 className={styles.groupHead}>{`${t("wepEarnings")} · ${group.events.length}`}</h4>
                        <ul className={styles.events}>{group.events.map(eventRow)}</ul>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ol>
          )}

          {agenda.length === 0 && settled && coverage.companies > 0 && (
            <p className={styles.empty} data-testid="wep-empty">
              {coverage.complete
                ? fill(t("wepEmptyComplete"), { n: coverage.companies })
                : fill(t("wepEmptyPartial"), { read: coverage.current, unread: unknown })}
            </p>
          )}

          {others.length > 0 && (
            <section className={styles.others} aria-label={t("wepNotOnAgenda")}>
              <h3 className={styles.othersHead}>{t("wepNotOnAgenda")}</h3>
              <ul className={styles.otherList}>
                {others.map((symbol) => {
                  const read = reads[symbol] ?? { state: "pending" as const };
                  const company = read.state !== "not-company";
                  const name = nameFor(symbol);
                  // Anything a company shows that is not a current answer is a coverage gap.
                  const warn = company && read.state !== "pending" && !isCurrentAnswer(read);
                  const copyNote = read.state === "no-date"
                    ? (read.refreshFailed ? t("wepEarlierCopy") : read.stale ? t("wepSavedCopy") : null)
                    : null;
                  return (
                    <li key={symbol} className={styles.other} data-testid="wep-other" data-symbol={symbol}>
                      {company ? (
                        <button type="button" className={styles.otherOpen} onClick={() => onOpenCompany(symbol)} title={fill(t("wepOpenCompany"), { sym: symbol })}>
                          <b className={styles.sym}>{symbol}</b>
                          {name && <span className={styles.name}>{name}</span>}
                        </button>
                      ) : (
                        <span className={styles.otherOpen}>
                          <b className={styles.sym}>{symbol}</b>
                          {name && <span className={styles.name}>{name}</span>}
                        </span>
                      )}
                      <span className={warn ? styles.reasonWarn : styles.reason}>
                        {reasonText(read)}
                        {copyNote ? ` · ${copyNote}` : ""}
                      </span>
                      {read.state === "unavailable" && (
                        <button type="button" className={styles.retry} onClick={() => retry(symbol)} data-testid="wep-retry">{t("wepRetry")}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className={styles.footnote}>{t("wepFootnote")}</p>
        </div>
      </div>
    </dialog>
  );

  return createPortal(node, document.body);
}

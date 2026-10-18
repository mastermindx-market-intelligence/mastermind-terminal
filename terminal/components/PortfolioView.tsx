"use client";
// The user's REAL portfolio — `portfolio_positions`, nothing else (W5).
//
// What this page used to be: a "Conviction Book" that ranked the active WATCHLIST by signal state
// and showed a "suggested tilt". That was a different population wearing the portfolio's name, and
// the point of this wave is that the two are separate concepts (packet section 1d / amendment A7):
//   Watchlist = names you are watching.   Portfolio = what you actually hold.
// The watchlist switcher is gone from this page; watchlist selection lives in the charting rail.
//
// HONESTY RULES this file must keep:
//   * A value is only shown when it can be COMPUTED. No shares -> no market value. No live price
//     -> a dash, and the ticker named in the coverage line; never a cost-basis stand-in, never a
//     zero. Totals cover the priced subset and say how many names that is.
//   * An unsized position (ticker only) is a legal state and is LABELLED as one, not rendered as a
//     broken row.
//   * Nothing here is advice. The page reports the user's own record back to them: no buy/sell/
//     rebalance language, no ranking of their holdings, no "suggested" anything.
//
// TWO-ORGANISMS LAW (UWP-R2): these holdings never feed a signal, score, ranker or alert. The live
// price join is client-side display tier, exactly like the watchlist rail's.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { getJSON } from "@/lib/dataCache";
import PortfolioWorkspace from "@/components/PortfolioWorkspace";
import { decodePositionRead, portfolioCopy, type PortfolioSection } from "@/lib/portfolioWorkspace";
import { isPortfolioRisk, isPortfolioRiskHistory } from "@/lib/portfolioAnalysisRead";
import { mutationPostcondition, positionMutationFailure, type MutationReceipt, type PositionMutationResult } from "@/lib/portfolioMutation";
import { isPortfolioTargetsSummary } from "@/lib/portfolioTargets";
import { groupsFromSymbols, planQuoteBatch } from "@/lib/quoteDemand";
import PortfolioBriefPanel from "@/components/PortfolioBriefPanel";
import EventImpactPanel from "@/components/EventImpactPanel";
import PositionModal, { type PositionDraft } from "@/components/PositionModal";
import {
  bookTotals,
  quoteSymbols,
  type Position,
} from "@/lib/portfolio";
import { riskCopy, failedRereadDisposition, T_RISK_UNAVAILABLE, type PortfolioRisk, type Lang } from "@/lib/portfolioRisk";
import {
  historyCopy,
  T_HISTORY_UNAVAILABLE,
  type PortfolioRiskHistory,
} from "@/lib/portfolioRiskHistory";
import {
  targetsCopy,
  apiErrorCopy,
  copyBandFit,
  driftBandFit,
  T_UNAVAILABLE,
  T_CURRENT,
  T_TARGET,
  T_DRIFT,
  T_BAND,
  T_CLEAR,
  T_CLEARED,
  T_SAVED,
  T_SAVE_FAIL,
  T_ARIA_TARGET,
  T_ARIA_BAND,
  DEFAULT_BAND_PCT,
  type PortfolioTargetsSummary,
} from "@/lib/portfolioTargets";
import s from "@/components/PortfolioRisk.module.css";
import tg from "@/components/PortfolioTargets.module.css";
import rh from "@/components/PortfolioRiskHistory.module.css";

type Quote = { last?: number; chg?: number; currency?: unknown } | null | undefined;
type ManifestRow = { name?: string; zh?: string; col?: string; last?: number; chg?: number; currency?: unknown };

async function readTargetsForBook(bookKey: string | null, signal?: AbortSignal): Promise<PortfolioTargetsSummary | null> {
  try {
    const response = await fetch("/api/portfolio/targets", { cache: "no-store", signal });
    const payload = await response.json().catch(() => null);
    return response.ok && typeof payload?.bookKey === "string" && /^[a-f0-9]{64}$/.test(payload.bookKey)
      && (bookKey === null || payload.bookKey === bookKey) && isPortfolioTargetsSummary(payload.summary) ? payload.summary : null;
  } catch { return null; }
}

export default function PortfolioView(
  { positions: seed, unreadable = false }: { positions: Position[]; email: string; unreadable?: boolean },
) {
  const { lang } = useLang();
  const [positions, setPositions] = useState<Position[]>(seed);
  const [risk, setRisk] = useState<PortfolioRisk | null>(null);
  // MAJOR 2 (review repair): distinguishes "the risk GET hasn't resolved yet" (render nothing)
  // from "it resolved and came back degraded" (render the plain-word notice) — see
  // `riskAvailability` in lib/portfolioRisk.ts. Set true once, in `reload()`, regardless of
  // whether that read succeeded or failed; never reset, since a later successful reload simply
  // replaces `risk` with a real value and `riskAvailability` reads that first.
  const [riskAttempted, setRiskAttempted] = useState(false);
  const [targets, setTargets] = useState<PortfolioTargetsSummary | null>(null);
  const [targetsAttempted, setTargetsAttempted] = useState(false);
  const [targetsFresh, setTargetsFresh] = useState(false);
  const [history, setHistory] = useState<PortfolioRiskHistory | null>(null);
  const [historyAttempted, setHistoryAttempted] = useState(false);
  // The server could not read the book. `positions` is [] here because there is nothing to show
  // — NOT because the user holds nothing. Everything that would assert a count or a total is
  // suppressed while this is true, and it clears the moment a read lands.
  const [unread, setUnread] = useState(unreadable);
  const [retrying, setRetrying] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [man, setMan] = useState<Record<string, ManifestRow>>({});
  const [editing, setEditing] = useState<{ mode: "add" | "edit"; position: Position | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // The server render is the seed; every later truth comes from the SAME route the mutations use,
  // so the table can never disagree with what was just written.
  //
  // Adjusted DURING RENDER rather than in an effect (React's documented "adjusting state when a
  // prop changes" pattern). An effect here would re-render the whole book a second time every time
  // a new RSC payload arrived — the cascading-render shape that has destabilised timing-sensitive
  // specs in this app before. This way React re-runs this component immediately, before committing
  // anything to the DOM, and no child ever paints the stale list.
  const [seededFrom, setSeededFrom] = useState(seed);
  if (seed !== seededFrom) {
    setSeededFrom(seed);
    setPositions(seed);
    setUnread(unreadable);
    setRisk(null); setHistory(null); setTargets(null);
  }

  const open = useMemo(() => positions.filter((p) => p.status === "open"), [positions]);

  // reload() is a stable callback; it reads "is a book already on screen?" through this ref so a
  // failed re-read can keep those rows instead of raising the page-level unreadable flag.
  const displayedBookRef = useRef(seed.length > 0 && !unreadable);
  useLayoutEffect(() => { displayedBookRef.current = positions.length > 0 && !unread; }, [positions.length, unread]);

  // The re-read every mutation and the retry share. A NON-OK response (503 = the store did not
  // answer) leaves `positions` untouched: it must never overwrite a book the user can see, and it
  // must never be reported as a successful empty read. If a book is already painted, only the
  // risk section prints its cannot-read state — raising `unread` here unmounts the table
  // (`{!unread && <>…</>}`) and is what blanked the B4 "failed re-read" spec at tablet width.
  // Every read takes a sequence number and only the NEWEST read in flight may write state.
  // reload() is shared by the mount read, the Retry button and every chained mutation, so without
  // this an earlier read whose response lands LAST repaints pre-write state over a change the user
  // has already seen — the same exposure B-F08-13 closed in Settings (macro#6819 5979873599). A
  // superseded read still returns what it fetched: a chained mutation's postcondition is judged
  // against its own readback, not against whichever response happened to paint. The `*Attempted`
  // latches stay unconditional — a read WAS attempted, whichever one painted.
  const readSeqRef = useRef(0);
  const seedRef = useRef(seed);
  useLayoutEffect(() => { seedRef.current = seed; }, [seed]);
  const activeAnalysisRef = useRef<{ seq: number; bookKey: string; seed: Position[]; controller: AbortController } | null>(null);
  const historyRequestedRef = useRef(false);
  const [bookStale, setBookStale] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const loadHistory = useCallback(async (context: NonNullable<typeof activeAnalysisRef.current>) => {
    const current = () => readSeqRef.current === context.seq && seedRef.current === context.seed && !context.controller.signal.aborted;
    try {
      const response = await fetch("/api/portfolio/risk-history", { cache: "no-store", signal: context.controller.signal });
      const payload = await response.json().catch(() => null);
      if (current()) setHistory(response.ok && payload?.bookKey === context.bookKey && isPortfolioRiskHistory(payload.history) ? payload.history : null);
    } catch {
      if (current()) setHistory(null);
    } finally {
      if (current()) setHistoryAttempted(true);
    }
  }, []);

  const reload = useCallback(async (options?: {
    confirmTargets?: (summary: PortfolioTargetsSummary) => boolean;
  }): Promise<Position[] | null> => {
    const seq = ++readSeqRef.current;
    const sourceSeed = seedRef.current;
    const newest = () => readSeqRef.current === seq && seedRef.current === sourceSeed;
    activeAnalysisRef.current?.controller.abort();
    activeAnalysisRef.current = null;
    let authoritative: ReturnType<typeof decodePositionRead> = null;
    try {
      const response = await fetch("/api/portfolio?view=positions", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      authoritative = response.ok ? decodePositionRead(payload) : null;
    } catch { authoritative = null; }
    if (!authoritative) {
      if (newest()) {
        setBookStale(true); setRisk(null); setHistory(null); setTargetsFresh(false);
        setRiskAttempted(true); setHistoryAttempted(true); setTargetsAttempted(true);
        if (failedRereadDisposition(displayedBookRef.current) !== "keep-book-risk-unavailable") setUnread(true);
      }
      return null;
    }
    // A superseded read is still returned to its original mutation for exact
    // receipt comparison. It never paints over the newest canonical read.
    if (!newest()) {
      if (options?.confirmTargets) {
        const summary = await readTargetsForBook(null);
        if (!summary || !options.confirmTargets(summary)) throw Object.assign(new Error("targets unavailable"), { code: "targets unavailable" });
      }
      return authoritative.positions;
    }
    setRisk(null); setRiskAttempted(false);
    setHistory(null); setHistoryAttempted(false); setTargetsFresh(false);
    setPositions(authoritative.positions); setUnread(false); setBookStale(false);
    setLastChecked(new Date().toISOString());
    const context = { seq, bookKey: authoritative.bookKey, seed: sourceSeed, controller: new AbortController() };
    activeAnalysisRef.current = context;
    const current = () => newest() && !context.controller.signal.aborted;

    void (async () => {
      try {
        const response = await fetch("/api/portfolio", { cache: "no-store", signal: context.controller.signal });
        const payload = await response.json().catch(() => null);
        if (current()) setRisk(response.ok && payload?.bookKey === context.bookKey && isPortfolioRisk(payload.risk) ? payload.risk : null);
      } catch { if (current()) setRisk(null); }
      finally { if (current()) setRiskAttempted(true); }
    })();

    const targetsRead = (async (): Promise<PortfolioTargetsSummary | null> => {
      const summary = await readTargetsForBook(context.bookKey, context.controller.signal);
      if (current()) { if (summary) setTargets(summary); setTargetsFresh(summary !== null); setTargetsAttempted(true); }
      return summary;
    })();
    if (historyRequestedRef.current) void loadHistory(context);

    // Position receipt confirmation returns now. A target write separately waits
    // for its own canonical target readback; neither waits for risk/history.
    if (options?.confirmTargets) {
      let summary = await targetsRead;
      // A display refresh may cancel optional enrichment after this write already
      // started confirmation. One separate canonical target read proves the intent;
      // its computed weights never paint into another display generation.
      if (!summary && !current()) summary = await readTargetsForBook(null);
      if (!summary || !options.confirmTargets(summary)) throw Object.assign(new Error("targets unavailable"), { code: "targets unavailable" });
    }
    return authoritative.positions;
  }, [loadHistory]);

  const requestSection = useCallback((section: PortfolioSection) => {
    if (section !== "risk" || historyRequestedRef.current) return;
    historyRequestedRef.current = true;
    if (activeAnalysisRef.current) void loadHistory(activeAnalysisRef.current);
  }, [loadHistory]);

  const retryRead = useCallback(async () => {
    setRetrying(true);
    await reload();
    setRetrying(false);
  }, [reload]);

  // Initial risk read: the SSR seed carries `positions` but never `risk` (the readout is
  // sourced only from the client GET, per B-F08-4 section 5), so without this the shape
  // readout would silently stay absent until the user's first mutation of the session.
  useEffect(() => {
    void reload();
    return () => { readSeqRef.current += 1; activeAnalysisRef.current?.controller.abort(); };
  }, [reload, seed]);

  /** ONE serialized write + re-read for the whole page — position mutations AND target saves and
   *  clears. Serialization matters for the same reason the rail's watchlist chain is serialized:
   *  two mutations in flight can land out of order, and the second re-read then paints
   *  pre-first-write state over a change the user already saw. Target writes used to bypass this
   *  chain (macro#6819 5979873599). A link that throws — a refused target write — rejects only its
   *  own caller, so the readout's rollbackRef still fires, and still settles the chain so the next
   *  write runs. */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const run = chainRef.current.then(work, work);
    chainRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);
  const mutate = useCallback((body: Record<string, unknown>, id?: string): Promise<PositionMutationResult> => {
    setFailure(null);
    if (id) setBusyId(id);
    return enqueue(async () => {
      try {
        const response = await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const detail = await response.json().catch(() => null) as MutationReceipt | null;
        if (!response.ok) {
          const failure = positionMutationFailure(response.status, detail);
          setFailure(portfolioCopy(lang)(failure.reason ?? "changeUnconfirmed"));
          return failure;
        }
        const authoritative = await reload();
        if (!detail || !authoritative || !mutationPostcondition(body, detail, authoritative)) {
          setFailure(portfolioCopy(lang)("changeUnconfirmed"));
          return { ok: false, reason: null };
        }
        return { ok: true };
      } catch {
        setFailure(portfolioCopy(lang)("changeUnconfirmed"));
        return { ok: false, reason: null };
      } finally {
        if (id) setBusyId(null);
      }
    });
  }, [enqueue, reload, lang]);

  const saveTarget = useCallback((ticker: string, targetWeightPct: number, bandPct?: number) => enqueue(async () => {
    const response = await fetch("/api/portfolio/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set",
        ticker,
        targetWeightPct,
        ...(bandPct !== undefined ? { bandPct } : {}),
      }),
    });
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      const code = typeof detail?.error === "string" ? detail.error : "save failed";
      throw Object.assign(new Error(code), { code });
    }
    const readback = await reload({ confirmTargets: summary => [...summary.drifts, ...summary.orphaned]
      .some(row => row.ticker === ticker && row.targetWeightPct === targetWeightPct && (bandPct === undefined || row.bandPct === bandPct)) });
    if (!readback) throw Object.assign(new Error("targets unavailable"), { code: "targets unavailable" });
  }), [enqueue, reload]);

  const clearTarget = useCallback((ticker: string) => enqueue(async () => {
    const response = await fetch("/api/portfolio/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", ticker }),
    });
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      const code = typeof detail?.error === "string" ? detail.error : "save failed";
      throw Object.assign(new Error(code), { code });
    }
    const readback = await reload({ confirmTargets: summary => ![...summary.drifts, ...summary.orphaned].some(row => row.ticker === ticker) });
    if (!readback) throw Object.assign(new Error("targets unavailable"), { code: "targets unavailable" });
  }), [enqueue, reload]);

  // ── live values ────────────────────────────────────────────────────────────
  // The same hub the rail uses: the nightly manifest for names/colours/EOD, the batched
  // `/api/quote` poll for live prices. Both are optional; a name missing from both renders as a
  // dash and is NAMED in the coverage line, never guessed. Polling pauses on a hidden tab.
  useEffect(() => {
    let alive = true;
    getJSON("/data/manifest.json", { onRevalidate: (m) => { if (alive && m) setMan(m.symbols || {}); } })
      .then((m) => { if (alive && m) setMan(m.symbols || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // D2: a book can hold more names than one /api/quote request may carry, and the route used to
  // enforce that cap with a silent slice — so past the boundary a position priced from the manifest
  // forever, with nothing saying its POSITION in the book was the reason. Positions are all equally
  // consequential (there is no "active" holding), so the whole book rotates: each poll takes the
  // next window under the cap, one request per tick exactly as before, and every holding refreshes
  // within ceil(book / cap) polls. A book that fits is `complete` and refreshes wholly every poll.
  const quoteGroups = useMemo(() => groupsFromSymbols(quoteSymbols(positions).sort()), [positions]);
  const symbolKey = useMemo(() => quoteGroups.map((g) => g.key).join(","), [quoteGroups]);
  const quoteCursorRef = useRef(0);
  const quoteGroupsRef = useRef(quoteGroups);
  useLayoutEffect(() => { quoteGroupsRef.current = quoteGroups; }, [quoteGroups]);
  useEffect(() => {
    // Nothing to price. The quote map is deliberately NOT cleared here: `resolveLast` is only ever
    // called for a position that is currently in the book, so an entry for a removed ticker is
    // unreachable, and clearing it would be a synchronous setState in an effect body — a second
    // render pass for state nobody can read.
    if (!symbolKey) return;
    let alive = true;
    const poll = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const plan = planQuoteBatch({ rotating: quoteGroupsRef.current, cursor: quoteCursorRef.current });
      quoteCursorRef.current = plan.nextCursor;
      if (!plan.symbols.length) return;
      fetch(`/api/quote?view=regular&syms=${encodeURIComponent(plan.symbols.join(","))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((payload) => {
          if (!alive || !payload?.quotes) return;
          // Identity-stable: state is replaced only when a value actually moved. An unconditional
          // setState here re-renders the whole book every six seconds — the pattern that once
          // destabilised 37 specs, and which would steal focus out of an open position modal.
          setQuotes((prev) => {
            let changed = false;
            const next: Record<string, Quote> = { ...prev };
            for (const [symbol, quote] of Object.entries(payload.quotes as Record<string, Quote>)) {
              if (!quote) continue;
              if (prev[symbol]?.last !== quote.last || prev[symbol]?.chg !== quote.chg || prev[symbol]?.currency !== quote.currency) {
                next[symbol] = quote;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        })
        .catch(() => {});
    };
    const first = setTimeout(poll, 200);
    const interval = setInterval(poll, 6000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [symbolKey]);

  const totals = useMemo(() => bookTotals(positions, quotes, man), [positions, quotes, man]);

  const submit = useCallback(async (draft: PositionDraft) => {
    const result = await mutate(
      editing?.mode === "edit" && editing.position
        ? { action: "update", id: editing.position.id, ...draft }
        : { action: "create", ...draft },
    );
    if (result.ok) setEditing(null);
    return result;
  }, [editing, mutate]);

  const copy = portfolioCopy(lang);
  const riskContent = risk
    ? <PortfolioRiskReadout risk={risk} lang={lang as Lang} />
    : riskAttempted ? <RiskUnavailableNotice lang={lang as Lang} /> : <p role="status">{copy("riskLoading")}</p>;
  const historyContent = history
    ? <PortfolioRiskHistoryReadout history={history} lang={lang as Lang} />
    : historyAttempted ? <HistoryUnavailableNotice lang={lang as Lang} /> : <p role="status">{copy("loadingAnalysis")}</p>;
  const visibleTargets: PortfolioTargetsSummary | null = targets && !targetsFresh ? {
    ...targets,
    drifts: targets.drifts.map(row => ({ ...row, currentWeightPct: null, driftPct: null, status: "unweighable" as const })),
    untargeted: targets.untargeted.map(row => ({ ...row, currentWeightPct: null })),
  } : targets;
  const targetsContent = visibleTargets
    ? <>{!targetsFresh && <p role="status">{copy("targetsReadPending")}</p>}<PortfolioTargetsReadout summary={visibleTargets} lang={lang as Lang} shapeReadoutVisible={false} weightsPending={!targetsFresh} onSetTarget={saveTarget} onClearTarget={clearTarget} /></>
    : targetsAttempted ? <TargetsUnavailableNotice lang={lang as Lang} /> : <p role="status">{copy("loadingAnalysis")}</p>;

  return <>
    <PortfolioWorkspace positions={positions} quotes={quotes} manifest={man} totals={totals} risk={risk}
      unreadable={unread} stale={bookStale} retrying={retrying} lastChecked={lastChecked}
      failure={failure} busyId={busyId} confirmDelete={confirmDelete}
      onRetry={() => void retryRead()} onAdd={() => { setFailure(null); setEditing({ mode: "add", position: null }); }}
      onEdit={position => { setFailure(null); setEditing({ mode: "edit", position }); }}
      onToggleStatus={position => { void mutate({ action: position.status === "open" ? "close" : "reopen", id: position.id }, position.id); }}
      onDeleteRequest={position => setConfirmDelete(position.id)} onDeleteCancel={() => setConfirmDelete(null)}
      onDeleteConfirm={position => { void mutate({ action: "delete", id: position.id }, position.id).then(result => { if (result.ok) setConfirmDelete(null); }); }}
      onSectionChange={requestSection}
      riskContent={riskContent} historyContent={historyContent} targetsContent={targetsContent}
      briefContent={<PortfolioBriefPanel population={{ kind: "positions", count: open.length }} />}
      eventContent={<EventImpactPanel positions={open} holdingsUnreadable={unread} />}
    />
    {editing && <PositionModal key={editing.position?.id ?? "new-position"} mode={editing.mode} position={editing.position}
      onCancel={() => setEditing(null)} onSubmit={submit} />}
  </>;
}

// Existing exposure, history and target consumers retain their computation and write authority.

type LegendRow = { key: string; label: { en: string; zh: string }; weightPct: number; covered: boolean; muted?: boolean };

function Bar({ rows, lang }: { rows: LegendRow[]; lang: Lang }) {
  const ariaLabel = rows.map((r) => `${lang === "zh" ? r.label.zh : r.label.en} ${r.weightPct}%`).join(", ");
  return (
    <div className={s.bar} role="img" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <div
          key={r.key}
          aria-hidden="true"
          data-covered={r.covered ? "true" : "false"}
          data-slot={r.covered && !r.muted ? i % 5 : undefined}
          className={`${s.seg} ${r.covered ? "" : s.segUncovered} ${r.muted ? s.segMuted : ""}`}
          style={{ width: `${r.weightPct}%` }}
        />
      ))}
    </div>
  );
}

/* Color is a MATERIAL decision and lives in governed CSS (PortfolioRisk.module.css), keyed off
   the `data-slot` index cycled here — never a categorical color literal authored in JS, and
   never a direction/signal token (never --up/--down/--warn/--flow-buy/--flow-sell/--signal):
   this readout describes portfolio SHAPE, never a call. */
function Legend({ rows, lang }: { rows: LegendRow[]; lang: Lang }) {
  return (
    <div className={s.legend}>
      {rows.map((r, i) => (
        <div key={r.key} className={s.legendRow}>
          <span
            className={`${s.legendSwatch} ${r.muted ? s.legendSwatchMuted : ""}`}
            data-slot={r.covered && !r.muted ? i % 5 : undefined}
            aria-hidden="true"
          />
          <span className={s.legendLabel}>{lang === "zh" ? r.label.zh : r.label.en}</span>
          <span className={s.legendPct}>{r.weightPct}%</span>
        </div>
      ))}
    </div>
  );
}

/** MAJOR 2 (review repair): the plain-word state for a degraded `risk: null` — never a silent
 *  disappearance of the whole readout. Reuses the readout's own section/notice styling rather
 *  than a new CSS block for a one-line message. */
function RiskUnavailableNotice({ lang }: { lang: Lang }) {
  return (
    <section className={s.shape} data-testid="portfolio-shape-unavailable">
      <p className={s.unread}>{lang === "zh" ? T_RISK_UNAVAILABLE.zh : T_RISK_UNAVAILABLE.en}</p>
    </section>
  );
}

function HistoryUnavailableNotice({ lang }: { lang: Lang }) {
  return (
    <section className={rh.section} data-testid="portfolio-risk-history-unavailable">
      <p className={rh.notice}>{lang === "zh" ? T_HISTORY_UNAVAILABLE.zh : T_HISTORY_UNAVAILABLE.en}</p>
    </section>
  );
}

export function PortfolioRiskHistoryReadout({ history, lang }: { history: PortfolioRiskHistory; lang: Lang }) {
  const c = historyCopy(history);
  const pick = (b: { en: string; zh: string } | null | undefined) => (b ? (lang === "zh" ? b.zh : b.en) : null);
  const metric = (
    key: "sharpe" | "sortino" | "beta",
    card: { label: { en: string; zh: string }; value: { en: string; zh: string } | null; unread: { en: string; zh: string } | null },
  ) => (
    <article className={rh.card} data-card={key}>
      <span className={rh.lbl}>{pick(card.label)}</span>
      {card.value
        ? <b className={rh.hero}>{pick(card.value)}</b>
        : <p className={rh.unread}>{pick(card.unread) ?? "—"}</p>}
    </article>
  );
  return (
    <section
      className={rh.section}
      data-testid="portfolio-risk-history"
      data-coverage-status={history.coverageStatus}
      data-coverage-source={history.coverageSource}
      data-history-n={history.window.n}
      aria-labelledby="pf-risk-history-h"
    >
      <header className={rh.head}>
        <h3 id="pf-risk-history-h" className={rh.title}>{pick(c.title)}</h3>
        <p className={rh.standing}>{pick(c.standing)}</p>
        <p className={rh.basis}>{pick(c.basis)}</p>
        <p className={rh.metaLine}>{pick(c.window)}</p>
        <p className={rh.metaLine}>{pick(c.benchmark)}</p>
        <p className={rh.metaLine}>{pick(c.riskFree)}</p>
        <p className={rh.metaLine}>{pick(c.asOf)}</p>
      </header>
      {c.empty && <p className={rh.empty} data-testid="risk-history-empty">{pick(c.empty)}</p>}
      {c.unreadBook && <p className={rh.empty} data-testid="risk-history-unread-book">{pick(c.unreadBook)}</p>}
      <div className={rh.metrics}>
        {metric("sharpe", c.sharpe)}
        {metric("sortino", c.sortino)}
        {metric("beta", c.beta)}
      </div>
      {!!c.included.length && (
        <>
          <p className={rh.listHead}>{pick(c.includedHeader)}</p>
          <ul className={rh.list} data-testid="risk-history-included">
            {c.included.map((row) => (
              <li key={row.ticker} className={rh.row}>
                <span className={rh.tk}>{row.ticker}</span>
                <span className={rh.why}>{pick(row.text)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!!c.excluded.length && (
        <>
          <p className={rh.listHead}>{pick(c.excludedHeader)}</p>
          <ul className={rh.list} data-testid="risk-history-excluded">
            {c.excluded.map((row) => (
              <li key={`${row.ticker}-${row.text.en}`} className={rh.row}>
                <span className={rh.tk}>{row.ticker}</span>
                <span className={rh.why}>{pick(row.text)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!!c.gapLines.length && (
        <details className={rh.gaps} data-testid="risk-history-gaps" >
          <summary className={rh.gapsSummary}>{pick(c.gapsSummary)}</summary>
          <ul className={rh.list}>
            {c.gapLines.map((g, i) => (
              <li key={`${g.ticker ?? "book"}-${g.text.en}-${i}`} className={rh.row}>
                {g.ticker && <span className={rh.tk}>{g.ticker}</span>}
                <span className={rh.why}>{pick(g.text)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function PortfolioRiskReadout({ risk, lang }: { risk: PortfolioRisk; lang: Lang }) {
  const c = riskCopy(risk);
  const pick = (b: { en: string; zh: string } | null) => (b ? (lang === "zh" ? b.zh : b.en) : null);
  return (
    <section
      className={s.shape}
      data-testid="portfolio-shape"
      data-shape-read={risk.counts.read}
      data-shape-total={risk.counts.total}
      // MAJOR 2 (round-2 review): the only DOM signal that proves the credentialed fan-out
      // path actually ran, rather than the anonymous one — never rendered as "credentialed"
      // unless the caller's own session cookie was present for this GET.
      data-coverage-source={risk.coverageSource}
      aria-labelledby="pf-shape-h"
    >
      <header className={s.head}>
        <h3 id="pf-shape-h" className="sr-only">{pick(c.title)}</h3>
        <p className={s.meta}>
          <span className={s.basis}>{pick(c.basis)}</span>
          <span className={s.dot} aria-hidden="true" />
          <span className={s.coverage} data-testid="shape-coverage">{pick(c.coverage)}</span>
        </p>
      </header>

      <div className={s.grid}>
        <article className={`${s.card} ${s.wide}`} data-card="concentration">
          <span className={s.lbl}>{pick(c.cards[0].label)}</span>
          <p className={s.q}>{pick(c.cards[0].question)}</p>
          {c.cards[0].value
            ? <>
              <b className={s.hero}>{pick(c.cards[0].value)}</b>
              <p className={s.sub}>{pick(c.cards[0].sub)}</p>
              <Bar rows={c.legend[0]} lang={lang} />
              <Legend rows={c.legend[0]} lang={lang} />
            </>
            : <p className={s.unread}>{pick(c.cards[0].unread)}</p>}
        </article>

        <article className={s.card} data-card="industries">
          <span className={s.lbl}>{pick(c.cards[1].label)}</span>
          <p className={s.q}>{pick(c.cards[1].question)}</p>
          {c.legend[1].length
            ? <>
              <Bar rows={c.legend[1]} lang={lang} />
              <Legend rows={c.legend[1]} lang={lang} />
            </>
            : <p className={s.unread}>{pick(c.cards[1].unread)}</p>}
        </article>

        <article className={s.card} data-card="size">
          <span className={s.lbl}>{pick(c.cards[2].label)}</span>
          <p className={s.q}>{pick(c.cards[2].question)}</p>
          {c.legend[2].length
            ? <>
              <Bar rows={c.legend[2]} lang={lang} />
              <Legend rows={c.legend[2]} lang={lang} />
            </>
            : <p className={s.unread}>{pick(c.cards[2].unread)}</p>}
        </article>

        {risk.liquidity && <article className={`${s.card} ${s.wide} ${s.short}`} data-card="thickness">
          <span className={s.lbl}>{pick(c.cards[3].label)}</span>
          <p className={s.q}>{pick(c.cards[3].question)}</p>
          {c.cards[3].value
            ? <b className={s.hero}>{pick(c.cards[3].value)}</b>
            : <p className={s.unread}>{pick(c.cards[3].unread)}</p>}
        </article>}
      </div>

      <details className={s.gaps}><summary className={s.gapsSummary}>{portfolioCopy(lang)("aboutExposure")}</summary>
        <p className={s.standing}>{pick(c.standing)} {pick(c.basis)}</p>
        {!risk.liquidity && <p className={s.standing}>{pick(c.cards[3].unread)}</p>}
      </details>
      {!!c.gapLines.length && (
        <details className={s.gaps} data-testid="shape-gaps">
          <summary className={s.gapsSummary}>{pick(c.gapsSummary)}</summary>
          <ul className={s.gapList}>
            {c.gapLines.map((g) => (
              <li key={`${g.ticker}-${g.text.en}`} className={s.gapRow}>
                <span className={s.gapTk}>{g.ticker}</span>
                <span className={s.gapWhy}>{pick(g.text)}</span>
              </li>
            ))}
          </ul>
          {c.gapLinesOverflow > 0 && (
            <p className={s.gapWhy} data-testid="shape-gaps-overflow">
              {lang === "zh" ? `还有 ${c.gapLinesOverflow} 项未显示` : `+${c.gapLinesOverflow} more not shown`}
            </p>
          )}
        </details>
      )}
    </section>
  );
}

function TargetsUnavailableNotice({ lang }: { lang: Lang }) {
  return (
    <section className={tg.section} data-testid="portfolio-targets-unavailable">
      <p className={tg.notice}>{lang === "zh" ? T_UNAVAILABLE.zh : T_UNAVAILABLE.en}</p>
    </section>
  );
}

function fillLabel(template: { en: string; zh: string }, ticker: string, lang: Lang): string {
  const raw = lang === "zh" ? template.zh : template.en;
  return raw.split("{ticker}").join(ticker);
}

// Exported so `lib/__tests__/portfolioTargetsView.test.tsx` can mount the real readout without
// standing up the whole page (the `riskAvailability` precedent: keep the decision testable).
export function PortfolioTargetsReadout({ summary, lang, shapeReadoutVisible, weightsPending = false, onSetTarget, onClearTarget }: {
  summary: PortfolioTargetsSummary; lang: Lang;
  shapeReadoutVisible: boolean;
  weightsPending?: boolean;
  onSetTarget: (ticker: string, targetWeightPct: number, bandPct?: number) => Promise<void>;
  onClearTarget: (ticker: string) => Promise<void>;
}) {
  const copy = targetsCopy(summary, lang, { shapeReadoutVisible });
  const pick = (b: { en: string; zh: string } | null | undefined) => (b ? (lang === "zh" ? b.zh : b.en) : "");
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [justCleared, setJustCleared] = useState<string | null>(null);
  const persist = async (ticker: string, targetWeightPct: number, bandPct?: number) => {
    await onSetTarget(ticker, targetWeightPct, bandPct);
    setJustCleared(null);
    setJustSaved(ticker);
  };
  // R6 (d): a clear is not a save. The row that survives the reload used to show "Saved" beside a
  // blank field right after the user deleted the target.
  const drop = async (ticker: string) => {
    await onClearTarget(ticker);
    setJustSaved(null);
    setJustCleared(ticker);
  };
  return (
    <section className={tg.section} data-testid="portfolio-targets" aria-labelledby="pf-targets-h">
      <header className={tg.head}>
        <h3 id="pf-targets-h" className="sr-only">{pick(copy.title)}</h3>
        <p className={tg.basis}>{pick(copy.basis)}</p>
      </header>
      <details className={tg.group}><summary>{portfolioCopy(lang)("aboutTargets")}</summary><p className={tg.standing}>{pick(copy.standing)}</p></details>
      {copy.sumNote && <p className={tg.sumNote} data-testid="targets-sum-note">{pick(copy.sumNote)}</p>}
      {!weightsPending && copy.costNotice && <p className={tg.notice} data-testid="targets-cost-unavailable">{pick(copy.costNotice)}</p>}
      {!weightsPending && copy.emptyState && <p className={tg.empty} data-testid="targets-empty">{pick(copy.emptyState)}</p>}
      {!!copy.rows.length && (
        <div className={tg.list}>
          {copy.rows.map((row) => {
            const drift = summary.drifts.find((d) => d.ticker === row.ticker);
            if (!drift) return null;
            const bandFitLabel = weightsPending ? portfolioCopy(lang)("weightsPending") : copyBandFit(row, lang);
            const bandFit = driftBandFit(drift);
            return (
              <TargetCard
                key={row.ticker}
                ticker={row.ticker}
                current={pick(row.current) || "—"}
                driftText={pick(row.drift) || "—"}
                bandFitLabel={bandFitLabel}
                bandFit={bandFit}
                unweighableNote={weightsPending ? "" : pick(row.unweighableNote)}
                targetWeightPct={drift.targetWeightPct}
                bandPct={drift.bandPct}
                lang={lang}
                onSetTarget={persist}
                onClearTarget={drop}
                showSaved={justSaved === row.ticker}
              />
            );
          })}
        </div>
      )}
      {copy.untargeted && (
        <div className={tg.group} data-testid="targets-untargeted">
          <h4 className={tg.groupTitle}>{pick(copy.untargeted.header)}</h4>
          {copy.untargeted.rows.map((row) => (
            <UntargetedRow
              key={row.ticker}
              ticker={row.ticker}
              hint={weightsPending ? `${row.ticker} · ${portfolioCopy(lang)("weightsPending")}` : pick(row.hint)}
              lang={lang}
              onSetTarget={persist}
              showSaved={justSaved === row.ticker}
              showCleared={justCleared === row.ticker}
            />
          ))}
        </div>
      )}
      {copy.orphaned && (
        <div className={tg.group} data-testid="targets-orphaned">
          <h4 className={tg.groupTitle}>{pick(copy.orphaned.header)}</h4>
          <p className={tg.explain}>{pick(copy.orphaned.explanation)}</p>
          {copy.orphaned.rows.map((row) => (
            <div key={row.ticker} className={tg.orphanedRow} data-ticker={row.ticker} data-status="orphaned">
              <p className={tg.ticker}>{row.ticker}</p>
              <p className={tg.value}>{pick(T_TARGET)} {pick(row.target)}</p>
              {/* R6 (b): the unit-bearing string the copy module already computes — the raw
                  number read "Your band ±5", ambiguous between percent and percentage points. */}
              <p className={tg.value}>{pick(T_BAND)} {pick(row.band)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function useDebouncedSave(
  ticker: string,
  lang: Lang,
  onSetTarget: (ticker: string, targetWeightPct: number, bandPct?: number) => Promise<void>,
  preserveDraftOnError = false,
) {
  const [flash, setFlash] = useState<"saved" | "cleared" | "error" | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editSeqRef = useRef(0);
  const rollbackRef = useRef<{ target: string; band: string }>({ target: "", band: String(DEFAULT_BAND_PCT) });

  const cancel = useCallback(() => {
    editSeqRef.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // R3: a pending save must never outlive the row it belongs to. Without this, clearing a target
  // inside the 500ms window unmounted the card and the timer then fired against the captured
  // closure, re-creating the target the user had just deleted.
  useEffect(() => cancel, [cancel]);

  const schedule = (
    targetStr: string,
    bandStr: string,
    restore: (target: string, band: string) => void,
    includeBand: boolean,
  ) => {
    cancel();
    setErrorText(null);
    // R3: an emptied field is not a value. `Number("")` is 0, which `Number.isFinite` accepts and
    // `normalizeWeightPct` admits (0 is in range), so a user who select-all-deleted a target to
    // retype it and paused past the debounce had a 0% target written for them and the input reset
    // from props to a "0" they never typed. Blank never writes — and it cancels whatever was
    // already queued, because the user has withdrawn the value that was pending.
    if (!targetStr.trim()) return;
    if (includeBand && !bandStr.trim()) return;
    const editSeq = editSeqRef.current;
    timer.current = setTimeout(async () => {
      const weight = Number(targetStr);
      const band = Number(bandStr);
      const invalid = !Number.isFinite(weight) ? "invalid target"
        : includeBand && !Number.isFinite(band) ? "invalid band" : null;
      if (invalid) {
        const copy = apiErrorCopy(invalid);
        setFlash("error");
        setErrorText(lang === "zh" ? copy.zh : copy.en);
        return;
      }
      setPendingCount(count => count + 1);
      try {
        await onSetTarget(ticker, weight, includeBand ? band : undefined);
        rollbackRef.current = { target: targetStr, band: bandStr };
        if (editSeq !== editSeqRef.current) return;
        setFlash("saved");
        setErrorText(null);
      } catch (cause) {
        if (editSeq !== editSeqRef.current) return;
        if (!preserveDraftOnError) restore(rollbackRef.current.target, rollbackRef.current.band);
        setFlash("error");
        const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: string }).code) : "";
        const copy = apiErrorCopy(code);
        setErrorText(lang === "zh" ? copy.zh : copy.en);
      } finally {
        setPendingCount(count => Math.max(0, count - 1));
      }
    }, 500);
  };

  return { flash, errorText, schedule, cancel, rollbackRef, setFlash, pending: pendingCount > 0 };
}

function TargetCard({
  ticker, current, driftText, bandFitLabel, bandFit, unweighableNote,
  targetWeightPct, bandPct, lang, onSetTarget, onClearTarget, showSaved,
}: {
  ticker: string;
  current: string;
  driftText: string;
  bandFitLabel: string;
  bandFit: "within_band" | "outside_band" | "unweighable";
  unweighableNote: string;
  targetWeightPct: number;
  bandPct: number;
  lang: Lang;
  onSetTarget: (ticker: string, targetWeightPct: number, bandPct?: number) => Promise<void>;
  onClearTarget: (ticker: string) => Promise<void>;
  showSaved: boolean;
}) {
  const [targetStr, setTargetStr] = useState(String(targetWeightPct));
  const [bandStr, setBandStr] = useState(String(bandPct));
  const [clearing, setClearing] = useState(false);
  const { flash, errorText, schedule, cancel, rollbackRef, setFlash, pending } = useDebouncedSave(ticker, lang, onSetTarget);
  const pick = (b: { en: string; zh: string }) => (lang === "zh" ? b.zh : b.en);

  const [sourceTarget, setSourceTarget] = useState({ targetWeightPct, bandPct });
  if (sourceTarget.targetWeightPct !== targetWeightPct || sourceTarget.bandPct !== bandPct) {
    const previous = sourceTarget;
    setSourceTarget({ targetWeightPct, bandPct });
    // Preserve typing that moved ahead of a slower canonical save response.
    setTargetStr(current => current === String(previous.targetWeightPct) || current.trim() !== "" && Number(current) === targetWeightPct ? String(targetWeightPct) : current);
    setBandStr(current => current === String(previous.bandPct) || current.trim() !== "" && Number(current) === bandPct ? String(bandPct) : current);
  }
  useEffect(() => {
    rollbackRef.current = { target: String(targetWeightPct), band: String(bandPct) };
  }, [targetWeightPct, bandPct, rollbackRef]);

  const draftMatches = targetStr.trim() !== "" && bandStr.trim() !== ""
    && Number(targetStr) === targetWeightPct && Number(bandStr) === bandPct;
  return (
    <article className={tg.card} data-ticker={ticker} data-status={bandFit}>
      <p className={tg.ticker}>{ticker}</p>
      <div className={tg.grid}>
        <div className={tg.field}>
          <span className={tg.lbl}>{pick(T_CURRENT)}</span>
          <p className={tg.value}>{current}</p>
        </div>
        <label className={tg.field}>
          <span className={tg.lbl}>{pick(T_TARGET)}</span>
          <input
            className={tg.input}
            inputMode="decimal"
            value={targetStr}
            aria-label={fillLabel(T_ARIA_TARGET, ticker, lang)}
            onChange={(event) => {
              const next = event.target.value;
              setTargetStr(next);
              setFlash(null);
              schedule(next, bandStr, (t, b) => { setTargetStr(t); setBandStr(b); }, true);
            }}
          />
        </label>
        <label className={tg.field}>
          <span className={tg.lbl}>{pick(T_BAND)}</span>
          <input
            className={tg.input}
            inputMode="decimal"
            value={bandStr}
            aria-label={fillLabel(T_ARIA_BAND, ticker, lang)}
            onChange={(event) => {
              const next = event.target.value;
              setBandStr(next);
              setFlash(null);
              schedule(targetStr, next, (t, b) => { setTargetStr(t); setBandStr(b); }, true);
            }}
          />
        </label>
        <div className={tg.field}>
          <span className={tg.lbl}>{pick(T_DRIFT)}</span>
          <p className={tg.value}>{driftText}</p>
        </div>
      </div>
      <p className={tg.status} data-kind={bandFit}>{bandFitLabel}</p>
      {/* On an unweighable row the status label IS T_UNWEIGHABLE (spec 2.6 names that sentence as
          the status), so rendering the note as well printed the same sentence twice on one card.
          The state produced no fixture and no crop in round 1, which is why nobody saw it. */}
      {unweighableNote && unweighableNote !== bandFitLabel
        ? <p className={tg.unweighable}>{unweighableNote}</p>
        : null}
      <div className={tg.actions}>
        <button
          type="button"
          className={tg.clear}
          disabled={clearing}
          onClick={async () => {
            // R3: a save queued inside the debounce window would otherwise fire after this clear
            // and put the target straight back.
            cancel(); setClearing(true);
            try {
              await onClearTarget(ticker);
              setFlash("cleared");
            } catch {
              setFlash("error");
            } finally { setClearing(false); }
          }}
        >
          {pick(T_CLEAR)}
        </button>
        {(pending || clearing) && <span className={tg.saved} role="status">{portfolioCopy(lang)(clearing ? "clearingTarget" : "savingTarget")}</span>}
        {(flash === "saved" || showSaved) && draftMatches && !pending && !clearing && <span className={tg.saved}>{pick(T_SAVED)}</span>}
        {flash === "cleared" && <span className={tg.saved}>{pick(T_CLEARED)}</span>}
        {flash === "error" && <span className={tg.error}>{errorText || pick(T_SAVE_FAIL)}</span>}
      </div>
    </article>
  );
}

function UntargetedRow({
  ticker, hint, lang, onSetTarget, showSaved, showCleared,
}: {
  ticker: string;
  hint: string;
  lang: Lang;
  onSetTarget: (ticker: string, targetWeightPct: number, bandPct?: number) => Promise<void>;
  showSaved: boolean;
  showCleared: boolean;
}) {
  const [targetStr, setTargetStr] = useState("");
  const [bandStr, setBandStr] = useState(String(DEFAULT_BAND_PCT));
  const { flash, errorText, schedule, rollbackRef, setFlash, pending } = useDebouncedSave(ticker, lang, onSetTarget, true);
  const pick = (b: { en: string; zh: string }) => (lang === "zh" ? b.zh : b.en);

  useEffect(() => {
    rollbackRef.current = { target: "", band: String(DEFAULT_BAND_PCT) };
  }, [rollbackRef]);

  return (
    <div className={tg.untargetedRow} data-ticker={ticker} data-status="untargeted">
      <p className={tg.hint}>{hint}</p>
      <label className={tg.field}>
        <span className={tg.lbl}>{pick(T_TARGET)}</span>
        <input
          className={tg.input}
          disabled={pending}
          inputMode="decimal"
          value={targetStr}
          aria-label={fillLabel(T_ARIA_TARGET, ticker, lang)}
          onChange={(event) => {
            const next = event.target.value;
            setTargetStr(next);
            setFlash(null);
            schedule(next, bandStr, (t, b) => { setTargetStr(t); setBandStr(b); }, true);
          }}
        />
      </label>
      <label className={tg.field}>
        <span className={tg.lbl}>{pick(T_BAND)}</span>
        <input
          className={tg.input}
          disabled={pending}
          inputMode="decimal"
          value={bandStr}
          aria-label={fillLabel(T_ARIA_BAND, ticker, lang)}
          onChange={(event) => {
            const next = event.target.value;
            setBandStr(next);
            setFlash(null);
            schedule(targetStr, next, (t, b) => { setTargetStr(t); setBandStr(b); }, true);
          }}
        />
      </label>
      {pending && <span className={tg.saved} role="status">{portfolioCopy(lang)("savingTarget")}</span>}
      {(flash === "saved" || showSaved) && !pending && <span className={tg.saved}>{pick(T_SAVED)}</span>}
      {(flash === "cleared" || showCleared) && !pending && targetStr === "" && <span className={tg.saved}>{pick(T_CLEARED)}</span>}
      {flash === "error" && <span className={tg.error}>{errorText || pick(T_SAVE_FAIL)}</span>}
    </div>
  );
}

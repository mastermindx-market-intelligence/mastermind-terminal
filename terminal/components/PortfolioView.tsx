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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT, useLang } from "@/lib/i18n";
import { getJSON } from "@/lib/dataCache";
import PortfolioBriefPanel from "@/components/PortfolioBriefPanel";
import PositionModal, { type PositionDraft } from "@/components/PositionModal";
import {
  bookTotals,
  quoteSymbols,
  resolveLast,
  marketValue,
  sinceEntryPct,
  sinceEntryValue,
  type Position,
} from "@/lib/portfolio";

type Quote = { last?: number; chg?: number } | null | undefined;
type ManifestRow = { name?: string; zh?: string; col?: string; last?: number; chg?: number };

const fmt = (n: number | null | undefined, d = 2) =>
  (n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (n: number | null | undefined) =>
  (n == null || !isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const signed = (n: number | null | undefined) =>
  (n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${money(n)}`);
const signedPct = (n: number | null | undefined) =>
  (n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

type MutationReceipt = { ok?: boolean; position?: Position; deletedId?: string; error?: string };

/** A mutation is complete only when the authoritative re-read proves the exact receipt the write
 * returned. This is intentionally stricter than `response.ok`: a 2xx followed by an unreadable or
 * contradictory GET is an unconfirmed mutation, not a saved one. */
function mutationPostcondition(
  body: Record<string, unknown>,
  receipt: MutationReceipt,
  positions: readonly Position[],
): boolean {
  const action = body.action;
  if (action === "delete") {
    const intendedId = typeof body.id === "string" ? body.id : "";
    return !!intendedId
      && receipt.deletedId === intendedId
      && !positions.some((position) => position.id === intendedId);
  }

  const written = receipt.position;
  if (!written?.id) return false;
  if (action !== "create" && written.id !== body.id) return false;
  if (action === "close" && written.status !== "closed") return false;
  if (action === "reopen" && written.status !== "open") return false;

  const reread = positions.find((position) => position.id === written.id);
  if (!reread) return false;
  return reread.ticker === written.ticker
    && reread.shares === written.shares
    && reread.entryPrice === written.entryPrice
    && reread.entryDate === written.entryDate
    && reread.notes === written.notes
    && reread.status === written.status
    && reread.createdAt === written.createdAt;
}

export default function PortfolioView(
  { positions: seed, unreadable = false }: { positions: Position[]; email: string; unreadable?: boolean },
) {
  const t = useT();
  const { lang } = useLang();
  const [positions, setPositions] = useState<Position[]>(seed);
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
  }

  const open = useMemo(() => positions.filter((p) => p.status === "open"), [positions]);
  const closed = useMemo(() => positions.filter((p) => p.status === "closed"), [positions]);

  // The re-read every mutation and the retry share. A NON-OK response (503 = the store did not
  // answer) leaves `positions` untouched and raises the unreadable flag: it must never overwrite
  // a book the user can see, and it must never be reported as a successful empty read.
  const reload = useCallback(async (): Promise<Position[] | null> => {
    try {
      const response = await fetch("/api/portfolio", { headers: { Accept: "application/json" } });
      if (!response.ok) { setUnread(true); return null; }
      const payload = await response.json();
      if (!Array.isArray(payload?.positions)) { setUnread(true); return null; }
      const authoritative = payload.positions as Position[];
      setPositions(authoritative);
      setUnread(false);
      return authoritative;
    } catch { setUnread(true); return null; }
  }, []);

  const retryRead = useCallback(async () => {
    setRetrying(true);
    await reload();
    setRetrying(false);
  }, [reload]);

  /** One serialized write + re-read. Serialization matters for the same reason the rail's watchlist
   *  chain is serialized: two mutations in flight can land out of order, and the second re-read
   *  then paints pre-first-write state over a change the user already saw. */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const mutate = useCallback((body: Record<string, unknown>, id?: string) => {
    setFailure(null);
    if (id) setBusyId(id);
    const request = chainRef.current.then(async () => {
      try {
        const response = await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const detail = await response.json().catch(() => null) as MutationReceipt | null;
        if (!response.ok) {
          // The route names the field it refused; surface that rather than a generic failure, so a
          // mistyped share count reads as a mistyped share count.
          setFailure(typeof detail?.error === "string" ? detail.error : t("positionSaveFailed"));
          return false;
        }
        const authoritative = await reload();
        if (!detail || !authoritative || !mutationPostcondition(body, detail, authoritative)) {
          setFailure(t("positionSaveFailed"));
          return false;
        }
        return true;
      } catch {
        setFailure(t("positionSaveFailed"));
        return false;
      } finally {
        if (id) setBusyId(null);
      }
    });
    chainRef.current = request;
    return request;
  }, [reload, t]);

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

  const symbolKey = useMemo(() => quoteSymbols(positions).sort().join(","), [positions]);
  useEffect(() => {
    // Nothing to price. The quote map is deliberately NOT cleared here: `resolveLast` is only ever
    // called for a position that is currently in the book, so an entry for a removed ticker is
    // unreachable, and clearing it would be a synchronous setState in an effect body — a second
    // render pass for state nobody can read.
    if (!symbolKey) return;
    let alive = true;
    const poll = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetch(`/api/quote?syms=${encodeURIComponent(symbolKey)}`)
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
              if (prev[symbol]?.last !== quote.last || prev[symbol]?.chg !== quote.chg) {
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
    const ok = await mutate(
      editing?.mode === "edit" && editing.position
        ? { action: "update", id: editing.position.id, ...draft }
        : { action: "create", ...draft },
    );
    if (ok) setEditing(null);
    return ok;
  }, [editing, mutate]);

  const nameFor = (ticker: string) => {
    const row = man[ticker];
    if (!row) return "";
    return (lang === "zh" && row.zh) ? row.zh : (row.name || "");
  };

  const rowProps = (position: Position) => ({
    position,
    last: resolveLast(position.ticker, quotes, man),
    name: nameFor(position.ticker),
    colour: man[position.ticker]?.col,
    busy: busyId === position.id,
    confirming: confirmDelete === position.id,
    t,
    onEdit: () => setEditing({ mode: "edit", position }),
    onToggleStatus: () => {
      void mutate({ action: position.status === "closed" ? "reopen" : "close", id: position.id }, position.id);
    },
    onDeleteRequest: () => setConfirmDelete(position.id),
    onDeleteCancel: () => setConfirmDelete(null),
    onDeleteConfirm: () => {
      setConfirmDelete(null);
      void mutate({ action: "delete", id: position.id }, position.id);
    },
  });

  const columns = (
    <thead>
      <tr>
        <th>{t("symbol")}</th>
        <th>{t("shares")}</th>
        <th>{t("entryPrice")}</th>
        <th>{t("entryDate")}</th>
        <th>{t("colLast")}</th>
        <th>{t("marketValue")}</th>
        <th>{t("sinceEntry")}</th>
        <th><span className="sr-only">{t("positionActions")}</span></th>
      </tr>
    </thead>
  );

  return (
    <main
      className="main2"
      data-portfolio="w5-positions"
      data-portfolio-state={unread ? "unreadable" : open.length ? "book" : "empty"}
      {...(unread ? {} : { "data-position-count": open.length })}
    >
      <div className="pg">
        {/* Every count, total and coverage line below is a CLAIM about what the user holds.
            None of them may be rendered from a read that did not land — including "0". */}
        {!unread && <PortfolioBriefPanel population={{ kind: "positions", count: open.length }} />}

        <div className="pg-head pf-head">
          <h2>{t("pagePortfolio")}</h2>
          <span className="sub">{t("portfolioSub")}</span>
          <button type="button" className="pf-add-btn" onClick={() => setEditing({ mode: "add", position: null })}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {t("addPosition")}
          </button>
        </div>

        {failure && <div className="pf-failure" role="alert">{failure}</div>}

        {unread && (
          <div className="panel pf-unreadable" data-testid="portfolio-unreadable">
            <div className="pf-empty">
              <b>{t("portfolioUnreadableTitle")}</b>
              <span>{t("portfolioUnreadableBody")}</span>
              <button type="button" className="pf-add-btn" onClick={retryRead} disabled={retrying}>
                {retrying ? t("portfolioUnreadableRetrying") : t("portfolioUnreadableRetry")}
              </button>
            </div>
          </div>
        )}

        {!unread && <>
        <div className="kpis">
          <div className="kpi">
            <small>{t("bookValue")}</small>
            <b className="num">{money(totals.marketValue)}</b>
          </div>
          <div className="kpi">
            <small>{t("dayPnl")}</small>
            <b className={`num${totals.dayChange == null ? "" : totals.dayChange >= 0 ? " up" : " down"}`}>
              {signed(totals.dayChange)}
            </b>
          </div>
          <div className="kpi">
            <small>{t("sinceEntry")}</small>
            <b className={`num${totals.sinceEntry == null ? "" : totals.sinceEntry >= 0 ? " up" : " down"}`}>
              {signed(totals.sinceEntry)}
              {totals.sinceEntryPct != null && <span className="kpi-sub">{signedPct(totals.sinceEntryPct)}</span>}
            </b>
          </div>
          <div className="kpi">
            <small>{t("positionsHeld")}</small>
            <b className="num">{totals.openCount}</b>
          </div>
        </div>

        {/* Coverage honesty, stated WHERE the totals are — never a silent exclusion.
            Two DIFFERENT silences, so two lines: a name with no price is missing from "what it is
            worth", and a name with no entry price is missing from "what it has made". They are not
            interchangeable, and one line covering both would be true of neither. */}
        {!!open.length && (totals.valued < totals.openCount || !!totals.noBasis.length) && (
          <div className="pf-coverage" data-testid="portfolio-coverage">
            {totals.valued < totals.openCount && (
              <p>
                {totals.unpriced.length
                  ? t("bookCoverageUnpriced")
                    .replace("{valued}", String(totals.valued))
                    .replace("{total}", String(totals.openCount))
                    .replace("{names}", totals.unpriced.join(", "))
                  : t("bookCoverageUnsized")
                    .replace("{valued}", String(totals.valued))
                    .replace("{total}", String(totals.openCount))}
              </p>
            )}
            {!!totals.noBasis.length && (
              <p data-testid="portfolio-coverage-nobasis">
                {t("bookCoverageNoBasis")
                  .replace("{based}", String(totals.based))
                  .replace("{valued}", String(totals.valued))
                  .replace("{names}", totals.noBasis.join(", "))}
              </p>
            )}
          </div>
        )}

        <div className="panel" data-testid="portfolio-open">
          <div className="ph">
            {t("openPositions")}
            <span className="sub">{t("portfolioTableSub")}</span>
          </div>
          <div className="tbl-scroll">
            <table className="ptable pf-table">
              {columns}
              <tbody>
                {!open.length && (
                  <tr className="empty-row">
                    <td colSpan={8}>
                      <div className="pf-empty">
                        <b>{t("emptyPortfolioTitle")}</b>
                        <span>{t("emptyPortfolioBody")}</span>
                        <button type="button" className="pf-add-btn" onClick={() => setEditing({ mode: "add", position: null })}>
                          {t("addFirstPosition")}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {open.map((position) => <PositionRow key={position.id} {...rowProps(position)} />)}
              </tbody>
            </table>
          </div>
        </div>

        {/* Closed positions are KEPT — closing is not deleting — and folded out of the way. */}
        {!!closed.length && (
          <details className="pf-closed" data-testid="portfolio-closed">
            <summary>
              <span className="pf-closed-label">{t("closedPositions")}</span>
              <span className="pf-closed-count">{closed.length}</span>
            </summary>
            <div className="panel">
              <div className="tbl-scroll">
                <table className="ptable pf-table">
                  {columns}
                  <tbody>
                    {closed.map((position) => <PositionRow key={position.id} {...rowProps(position)} />)}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        )}
        </>}
      </div>

      {editing && (
        <PositionModal
          mode={editing.mode}
          position={editing.position}
          onCancel={() => setEditing(null)}
          onSubmit={submit}
        />
      )}
    </main>
  );
}

function PositionRow({
  position, last, name, colour, busy, confirming, t,
  onEdit, onToggleStatus, onDeleteRequest, onDeleteCancel, onDeleteConfirm,
}: {
  position: Position;
  last: number | null;
  name: string;
  colour?: string;
  busy: boolean;
  confirming: boolean;
  t: (k: string, f?: string) => string;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const value = marketValue(position, last);
  const pct = sinceEntryPct(position, last);
  const delta = sinceEntryValue(position, last);
  const isClosed = position.status === "closed";

  return (
    <tr data-ticker={position.ticker} data-status={position.status} className={`pf-row${busy ? " busy" : ""}`}>
      <td>
        <div className="sym-cell">
          <span className="ic" style={{ background: colour || "var(--line-2)" }}>{position.ticker[0]}</span>
          <div>
            <Link className="tk pf-tk" href={`/terminal?sym=${encodeURIComponent(position.ticker)}`}>
              {position.ticker}
            </Link>
            <div className="nm">
              {name}
              {/* An unsized position is deliberate, so it says so rather than leaving the user to
                  interpret three empty cells. */}
              {position.shares == null && <span className="pf-unsized">{t("unsized")}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="num">{position.shares == null ? "—" : fmt(position.shares, position.shares % 1 === 0 ? 0 : 4)}</td>
      <td className="num">{position.entryPrice == null ? "—" : fmt(position.entryPrice, position.entryPrice < 10 ? 4 : 2)}</td>
      <td className="num">{position.entryDate || "—"}</td>
      <td className="num">{last == null ? "—" : fmt(last, last < 10 ? 4 : 2)}</td>
      <td className="num">{value == null ? "—" : money(value)}</td>
      <td className={`num${pct == null ? "" : pct >= 0 ? " up" : " down"}`}>
        {pct == null ? "—" : (
          <>
            {signedPct(pct)}
            {delta != null && <span className="pf-delta">{signed(delta)}</span>}
          </>
        )}
      </td>
      <td className="pf-acts">
        {confirming ? (
          <span className="pf-confirm" role="group" aria-label={t("deletePositionConfirm")}>
            <span className="pf-confirm-q">{t("deletePositionConfirm")}</span>
            <button type="button" className="pf-act danger" onClick={onDeleteConfirm}>{t("deletePositionYes")}</button>
            <button type="button" className="pf-act" onClick={onDeleteCancel}>{t("cancel")}</button>
          </span>
        ) : (
          <>
            <button type="button" className="pf-act" disabled={busy} onClick={onEdit}
              aria-label={`${t("editPosition")} ${position.ticker}`}>{t("editPosition")}</button>
            <button type="button" className="pf-act" disabled={busy} onClick={onToggleStatus}
              aria-label={`${isClosed ? t("reopenPosition") : t("closePosition")} ${position.ticker}`}>
              {isClosed ? t("reopenPosition") : t("closePosition")}
            </button>
            <button type="button" className="pf-act danger" disabled={busy} onClick={onDeleteRequest}
              aria-label={`${t("deletePosition")} ${position.ticker}`}>{t("deletePosition")}</button>
          </>
        )}
      </td>
    </tr>
  );
}

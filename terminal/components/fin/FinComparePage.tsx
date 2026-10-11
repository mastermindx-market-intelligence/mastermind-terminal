"use client";

/**
 * Financials · Compare — pin a few statement metrics across the pane's company and its peers.
 *
 * Every decision about WHETHER two numbers may sit in one column lives in `lib/finCompare`
 * (statement family, currency, period kind, flow basis, generation, calendar placement); this
 * page only renders what that gate returns and never re-derives a value. A refused cell says
 * why; a missing or failed peer is a row state with a Retry; nothing is drawn as zero or ranked
 * against a gap. Opening a cell embeds the existing Statements view for that company, opened on
 * that exact basis, statement, period column and row.
 *
 * Peer data is read through the shared dataCache (`getJSONResult`, three-way outcome, with
 * `onRevalidate` and the stale-serve receipt) — no second financial cache. Only the user's
 * choices (peer tickers, metrics, basis, alignment) are remembered, per anchor, for this tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { Fund } from "../../lib/fund";
import { getJSONResult, invalidate } from "../../lib/dataCache";
import { normalizeAnalysisSymbol } from "../../lib/analysisSymbol";
import { fmtNum, fmtPct, statementCurrencyCode } from "../../lib/finFormat";
import {
  incomeTopLineLabel,
  resolveStatementBasis,
  statementBasisAvailable,
  statementCadenceLabel,
  type StatementBasis,
} from "../../lib/finStatementMath";
import {
  COMPARE_METRICS,
  DEFAULT_COMPARE_METRICS,
  MAX_COMPARE_METRICS,
  MAX_COMPARE_PEERS,
  admitPeer,
  buildComparison,
  markPeerRefreshFailed,
  peerLoadFromOutcome,
  removePeer,
  requestPeer,
  resolvePeer,
  type AddPeerResult,
  type CellReason,
  type CellSource,
  type CompareAlignment,
  type CompareCell,
  type CompareColumn,
  type CompareFrame,
  type CompareMetric,
  type CompareMetricId,
  type CompareRow,
  type FamilyClass,
  type FrameKind,
  type PeerSlot,
  type PeerStale,
} from "../../lib/finCompare";
import { useFinCompareT, type FinCompareKey } from "../../lib/finCompareLex";
import { useLang } from "../../lib/i18n";
import type { StatementPeriodKind } from "../../lib/fund";
import StatementsPage, { resolveStatementsFocus } from "./StatementsPage";
import styles from "./FinComparePage.module.css";

interface FinComparePageProps {
  sym: string;
  fund: Fund | null;
  fundLoading?: boolean;
  /** The pane's transcript drawer. It belongs to `sym`, so only the anchor's source view gets it. */
  onOpenTx?: (txId: string) => void;
}

// ── per-anchor choices, remembered for this tab (choices only — never statement data) ──────────
// In memory only (gone on reload), never persisted, never sent anywhere, and holding nothing but
// public tickers and toggle states — so it is deliberately not keyed to the signed-in owner (the
// account-identity law covers owner-scoped stores of account data; this is not one). Subscribing
// this page to auth changes just to forget a peer list would pull the auth client into a guest view.

interface CompareChoices {
  peers: string[];
  metrics: CompareMetricId[];
  basis: StatementBasis;
  alignment: CompareAlignment;
}
const CHOICES = new Map<string, CompareChoices>();
const MAX_REMEMBERED_ANCHORS = 24;
function rememberChoices(anchor: string, choices: CompareChoices): void {
  CHOICES.delete(anchor);
  CHOICES.set(anchor, choices);
  while (CHOICES.size > MAX_REMEMBERED_ANCHORS) {
    const oldest = CHOICES.keys().next().value;
    if (oldest === undefined) break;
    CHOICES.delete(oldest);
  }
}

const fundUrl = (sym: string) => "/data/" + encodeURIComponent(sym) + ".fund.json";

type T = ReturnType<typeof useFinCompareT>;

const KIND_WORD: Record<FrameKind, FinCompareKey> = { full_year: "fcKindYear", half_year: "fcKindHalf", quarter: "fcKindQuarter" };
const COL_KIND: Record<FrameKind, FinCompareKey> = { full_year: "fcColKindYear", half_year: "fcColKindHalf", quarter: "fcColKindQuarter" };
const UNIT_WORD: Record<FrameKind, FinCompareKey> = { full_year: "fcUnitYear", half_year: "fcUnitHalf", quarter: "fcUnitQuarter" };
const FAMILY_WORD: Record<FamilyClass, FinCompareKey> = {
  industrial: "fcFamIndustrial",
  bank: "fcFamBank",
  insurer: "fcFamInsurer",
  financial_services: "fcFamFinancialServices",
  ambiguous: "fcFamAmbiguous",
};
const PERIOD_KIND_WORD: Record<StatementPeriodKind, FinCompareKey> = {
  full_year: "fcPkFullYear",
  half_year: "fcPkHalfYear",
  quarter: "fcPkQuarter",
  year_to_date: "fcPkYtd",
};
const STATEMENT_WORD: Record<CellSource["block"], FinCompareKey> = {
  income: "fcStmtIncome",
  balance: "fcStmtBalance",
  cashflow: "fcStmtCashflow",
};
const SHORT_REASON: Record<CellReason, FinCompareKey> = {
  no_period: "fcR_no_period",
  no_value: "fcR_no_value",
  family_mismatch: "fcR_family_mismatch",
  family_ambiguous: "fcR_family_ambiguous",
  currency_mismatch: "fcR_currency_mismatch",
  currency_unknown: "fcR_currency_unknown",
  cumulative_flow: "fcR_cumulative_flow",
  missing_base: "fcR_missing_base",
  flow_basis_unknown: "fcR_flow_basis_unknown",
  margin_undefined: "fcR_margin_undefined",
  calendar_collision: "fcR_calendar_collision",
  calendar_straddle: "fcR_calendar_straddle",
};
const LONG_REASON: Record<CellReason, FinCompareKey> = {
  no_period: "fcRT_no_period",
  no_value: "fcRT_no_value",
  family_mismatch: "fcRT_family_mismatch",
  family_ambiguous: "fcRT_family_ambiguous",
  currency_mismatch: "fcRT_currency_mismatch",
  currency_unknown: "fcRT_currency_unknown",
  cumulative_flow: "fcRT_cumulative_flow",
  missing_base: "fcRT_missing_base",
  flow_basis_unknown: "fcRT_flow_basis_unknown",
  margin_undefined: "fcRT_margin_undefined",
  calendar_collision: "fcRT_calendar_collision",
  calendar_straddle: "fcRT_calendar_straddle",
};

function metricLabel(t: T, metric: CompareMetric, frame: CompareFrame | null, zh: boolean): string {
  // The top line is named for the FRAME's statement format, exactly as Statements names it.
  if (metric.id === "revenue") return incomeTopLineLabel(frame?.family ?? "industrial", zh);
  return t(`fcM_${metric.id}` as FinCompareKey);
}

function formatValue(metric: CompareMetric, value: number): string {
  if (metric.unit === "percent") return fmtPct(value, { decimals: 1, alreadyPct: true });
  // Same formatter (and decimals) the Statements table prints, so the two cells read alike.
  return fmtNum(value, { decimals: 2 });
}

function columnLabel(t: T, column: CompareColumn): string {
  if (column.type === "fiscal") {
    const kind = t(COL_KIND[column.kind]);
    return column.offset === 0 ? t("fcColLatest", { kind }) : t("fcColBack", { kind, n: column.offset });
  }
  const { bucket } = column;
  if (bucket.part == null) return t("fcColCalYear", { year: bucket.year });
  return t(bucket.kind === "quarter" ? "fcColCalQuarter" : "fcColCalHalf", { year: bucket.year, part: bucket.part });
}

function currencyWord(t: T, currency: string | null): string {
  return currency ?? t("fcCurrencyUnknown");
}

function reasonText(t: T, cell: CompareCell, frame: CompareFrame, row: CompareRow): { short: string; long: string } {
  const reason = cell.reason as CellReason;
  const vars = {
    kind: t(KIND_WORD[frame.kind]),
    family: t(FAMILY_WORD[cell.source?.family ?? row.family ?? "ambiguous"]),
    frameFamily: t(FAMILY_WORD[frame.family]),
    currency: currencyWord(t, cell.source?.currency ?? row.currency),
    frameCurrency: currencyWord(t, frame.currency),
  };
  return { short: t(SHORT_REASON[reason], vars), long: t(LONG_REASON[reason], vars) };
}

function admitMessage(t: T, result: Exclude<AddPeerResult, { ok: true }>, sym: string | null): string {
  switch (result.reason) {
    case "invalid":
      return t("fcPeerInvalid");
    case "anchor":
      return t("fcPeerAnchor", { sym: sym ?? "" });
    case "duplicate":
      return t("fcPeerDuplicate", { sym: sym ?? "" });
    case "limit":
      return t("fcPeerLimit", { n: MAX_COMPARE_PEERS });
  }
}

interface OpenSource {
  metric: CompareMetricId;
  cell: CompareCell;
  source: CellSource;
  /** The comparison button that opened it — focus returns there on close. */
  opener: string;
}

export default function FinComparePage({ sym, fund, fundLoading = false, onOpenTx }: FinComparePageProps) {
  const t = useFinCompareT();
  const { lang } = useLang();
  const zh = lang === "zh";

  const remembered = CHOICES.get(sym);
  const [peers, setPeers] = useState<PeerSlot[]>(() =>
    (remembered?.peers ?? []).map((p) => ({ sym: p, gen: 0, load: { status: "loading" } })),
  );
  const [metrics, setMetrics] = useState<CompareMetricId[]>(() => remembered?.metrics ?? [...DEFAULT_COMPARE_METRICS]);
  const [requestedBasis, setBasis] = useState<StatementBasis>(() => remembered?.basis ?? "annual");
  const [alignment, setAlignment] = useState<CompareAlignment>(() => remembered?.alignment ?? "fiscal");
  const [draft, setDraft] = useState("");
  const [peerMessage, setPeerMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenSource | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const annualAvailable = statementBasisAvailable(fund?.statements?.annual);
  const interimAvailable = statementBasisAvailable(fund?.statements?.quarterly);
  const basis = resolveStatementBasis(requestedBasis, annualAvailable, interimAvailable);

  // ── peer reads ────────────────────────────────────────────────────────────────────────────
  const alive = useRef(true);
  const nextGen = useRef(0);
  /** Generations already corrected by a revalidation: their earlier stale answer is not applied. */
  const fresh = useRef(new Set<number>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const readPeer = useCallback((peer: string) => {
    const gen = ++nextGen.current;
    setPeers((ps) => requestPeer(ps, peer, gen));
    getJSONResult(fundUrl(peer), {
      onRevalidate: (data) => {
        if (!alive.current) return;
        fresh.current.add(gen);
        setPeers((ps) => resolvePeer(ps, peer, gen, peerLoadFromOutcome({ status: "data", data })));
      },
    })
      .then((outcome) => {
        if (!alive.current || fresh.current.has(gen)) return;
        setPeers((ps) => resolvePeer(ps, peer, gen, peerLoadFromOutcome(outcome)));
        if (outcome.status === "data" && outcome.stale) {
          outcome.stale.revalidation.then((r) => {
            if (alive.current && r === "failed") setPeers((ps) => markPeerRefreshFailed(ps, peer, gen));
          });
        }
      })
      .catch(() => {
        if (alive.current) setPeers((ps) => resolvePeer(ps, peer, gen, { status: "unavailable", reason: "network" }));
      });
  }, []);

  // Re-read the remembered peers once per mount (the shared cache answers repeat reads).
  const initialPeers = useRef(remembered?.peers ?? []);
  useEffect(() => {
    for (const p of initialPeers.current) readPeer(p);
  }, [readPeer]);

  const peerSyms = peers.map((p) => p.sym).join(",");
  useEffect(() => {
    rememberChoices(sym, { peers: peerSyms ? peerSyms.split(",") : [], metrics, basis: requestedBasis, alignment });
  }, [sym, peerSyms, metrics, requestedBasis, alignment]);

  const addPeer = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeAnalysisSymbol(draft);
    const result = admitPeer(peers, sym, normalized);
    if (!result.ok) {
      setPeerMessage(admitMessage(t, result, normalized));
      return;
    }
    setPeerMessage(null);
    setDraft("");
    readPeer(result.sym);
  };

  const dropPeer = (peer: string) => {
    setPeers((ps) => removePeer(ps, peer));
    setPeerMessage(null);
    setOpen((o) => (o && o.source.sym === peer ? null : o));
  };

  const retryPeer = (peer: string) => {
    invalidate(fundUrl(peer));
    readPeer(peer);
  };

  const toggleMetric = (id: CompareMetricId) => {
    setMetrics((ms) => {
      if (ms.includes(id)) return ms.length > 1 ? ms.filter((m) => m !== id) : ms;
      return ms.length >= MAX_COMPARE_METRICS ? ms : [...ms, id];
    });
  };

  // ── the comparison ────────────────────────────────────────────────────────────────────────
  const orderedMetrics = useMemo(
    () => COMPARE_METRICS.filter((m) => metrics.includes(m.id)).map((m) => m.id),
    [metrics],
  );
  const result = useMemo(
    () => buildComparison({ anchor: { sym, fund }, peers, basis, alignment, metrics: orderedMetrics }),
    [sym, fund, peers, basis, alignment, orderedMetrics],
  );
  const { frame, frameIssue, columns, tables } = result;

  // ── source drilldown ──────────────────────────────────────────────────────────────────────
  const sourceFund: Fund | null = open
    ? open.source.sym === sym
      ? fund
      : (() => {
          const p = peers.find((x) => x.sym === open.source.sym);
          return p && p.load.status === "data" ? p.load.fund : null;
        })()
    : null;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.scrollIntoView({ block: "start", inline: "nearest" });
    const raf = requestAnimationFrame(() => {
      const cell = panel.querySelector<HTMLElement>('[data-focus-cell="true"]');
      if (!cell) return;
      // Bring the column into view inside its OWN table scroller first. A bare
      // `scrollIntoView({ inline })` also scrolls every overflow-hidden ancestor sideways — on a
      // phone that slid the whole research pane off-screen to the left.
      const scroller = cell.closest<HTMLElement>(".fin-table-scroll");
      if (scroller) {
        const s = scroller.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        scroller.scrollLeft += c.left - s.left - (s.width - c.width) / 2;
      }
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const closeSource = () => {
    const opener = open?.opener;
    setOpen(null);
    if (opener) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-fc-cell="${CSS.escape(opener)}"]`)?.focus();
      });
    }
  };

  // ── render ────────────────────────────────────────────────────────────────────────────────
  if (!fund) {
    return (
      <div className={styles.root} data-fc-state={fundLoading ? "loading" : "anchor-absent"}>
        {fundLoading ? (
          <div className="fin-empty fin-empty-lg" role="status">
            <div className="fin-empty-title">{t("fcAnchorLoading", { sym })}</div>
          </div>
        ) : (
          <div className="fin-empty fin-empty-lg" role="status">
            <div className="fin-empty-title">{t("fcAnchorAbsentTitle")}</div>
            <div className="fin-empty-why">{t("fcAnchorAbsent", { sym })}</div>
          </div>
        )}
      </div>
    );
  }

  const basisWord = (b: StatementBasis) => t(b === "annual" ? "fcBasisAnnualWord" : "fcBasisInterimWord");
  const kindWord = frame ? t(KIND_WORD[frame.kind]) : "";
  const topLine = incomeTopLineLabel(frame?.family ?? "industrial", zh);

  return (
    <div className={styles.root} data-fc-state={frameIssue ?? "ready"} data-fc-alignment={alignment} data-fc-basis={basis}>
      <section className="fin-sec">
        <div className="fin-eyebrow">{t("fcEyebrow")}</div>
        <h2 className="fin-sec-h fin-rail fin-rule" style={{ "--rail": "var(--brand)" } as CSSProperties}>
          {t("fcTitle")}
        </h2>
        <p className={styles.intro}>{t("fcIntro", { anchor: sym })}</p>

        <div className={styles.controls}>
          <div className={styles.ctrl}>
            <span className={styles.ctrlLabel} id="fc-basis-label">{t("fcBasisLabel")}</span>
            <div className="fin-toggle" role="group" aria-labelledby="fc-basis-label">
              <button
                type="button"
                className={basis === "annual" ? "on" : ""}
                aria-pressed={basis === "annual"}
                disabled={!annualAvailable}
                onClick={() => setBasis("annual")}
                data-fc-basis-option="annual"
              >
                {t("fcAnnual")}
              </button>
              <button
                type="button"
                className={basis === "quarterly" ? "on" : ""}
                aria-pressed={basis === "quarterly"}
                disabled={!interimAvailable}
                onClick={() => setBasis("quarterly")}
                data-fc-basis-option="quarterly"
              >
                {statementCadenceLabel(fund.statements?.quarterly, "quarterly", zh)}
              </button>
            </div>
          </div>
          <div className={styles.ctrl}>
            <span className={styles.ctrlLabel} id="fc-align-label">{t("fcAlignLabel")}</span>
            <div className="fin-toggle" role="group" aria-labelledby="fc-align-label">
              <button
                type="button"
                className={alignment === "fiscal" ? "on" : ""}
                aria-pressed={alignment === "fiscal"}
                onClick={() => setAlignment("fiscal")}
                data-fc-align-option="fiscal"
              >
                {t("fcAlignFiscal")}
              </button>
              <button
                type="button"
                className={alignment === "calendar" ? "on" : ""}
                aria-pressed={alignment === "calendar"}
                onClick={() => setAlignment("calendar")}
                data-fc-align-option="calendar"
              >
                {t("fcAlignCalendar")}
              </button>
            </div>
          </div>
        </div>

        {frame && (
          <p className={styles.frameLine} data-fc-frame>
            {t("fcFrame", {
              anchor: sym,
              kind: kindWord,
              currency: currencyWord(t, frame.currency),
              family: t(FAMILY_WORD[frame.family]),
            })}
          </p>
        )}
        <p className={styles.note} data-fc-alignment-note>
          {alignment === "fiscal"
            ? t("fcAlignFiscalNote")
            : t("fcAlignCalendarNote", { unit: t(UNIT_WORD[frame?.kind ?? "full_year"]) })}
        </p>

        <div className={styles.peerBlock}>
          <span className={styles.ctrlLabel} id="fc-peers-label">{t("fcPeersLabel")}</span>
          <ul className={styles.chips} aria-labelledby="fc-peers-label">
            <li className={`${styles.chip} ${styles.chipAnchor}`} data-fc-chip={sym}>
              <span className={styles.chipSym}>{sym}</span>
              <span className={styles.chipTag}>{t("fcAnchorBadge")}</span>
            </li>
            {peers.map((p) => (
              <li key={p.sym} className={styles.chip} data-fc-chip={p.sym}>
                <span className={styles.chipSym}>{p.sym}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={t("fcRemovePeer", { sym: p.sym })}
                  onClick={() => dropPeer(p.sym)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form className={styles.addForm} onSubmit={addPeer}>
            <label className={styles.srOnly} htmlFor="fc-add-peer">{t("fcAddPeerLabel")}</label>
            <input
              id="fc-add-peer"
              className={styles.addInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("fcAddPeerPlaceholder")}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={24}
              enterKeyHint="done"
            />
            <button type="submit" className={styles.addBtn} disabled={!draft.trim()}>
              {t("fcAddPeer")}
            </button>
          </form>
          <p className={styles.msg} role="status" aria-live="polite" data-fc-peer-message>
            {peerMessage ?? (peers.length === 0 ? t("fcNoPeers", { anchor: sym }) : "")}
          </p>
        </div>

        <div className={styles.metricBlock}>
          <span className={styles.ctrlLabel} id="fc-metrics-label">{t("fcMetricsLabel")}</span>
          <div className={styles.metricChips} role="group" aria-labelledby="fc-metrics-label">
            {COMPARE_METRICS.map((m) => {
              const on = metrics.includes(m.id);
              const blocked = !on && metrics.length >= MAX_COMPARE_METRICS;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={styles.metricChip}
                  aria-pressed={on}
                  disabled={blocked || (on && metrics.length === 1)}
                  onClick={() => toggleMetric(m.id)}
                  data-fc-metric-option={m.id}
                >
                  {metricLabel(t, m, frame, zh)}
                </button>
              );
            })}
          </div>
          {metrics.length >= MAX_COMPARE_METRICS && (
            <p className={styles.msg}>{t("fcMetricLimit", { n: MAX_COMPARE_METRICS })}</p>
          )}
        </div>
      </section>

      {frameIssue && (
        <div className="fin-empty fin-empty-lg" role="status" data-fc-frame-issue={frameIssue}>
          <div className="fin-empty-title">{t("fcAnchorAbsentTitle")}</div>
          <div className="fin-empty-why">
            {frameIssue === "anchor_absent"
              ? t("fcAnchorAbsent", { sym })
              : frameIssue === "anchor_basis_absent"
                ? t("fcAnchorBasisAbsent", { sym, basis: basisWord(basis) })
                : t("fcAnchorKindUnknown", { sym, basis: basisWord(basis) })}
          </div>
        </div>
      )}

      {frame && columns.length === 0 && (
        <div className="fin-empty" role="status" data-fc-calendar-empty>
          {t("fcCalendarEmpty", { kind: kindWord })}
        </div>
      )}

      {frame &&
        columns.length > 0 &&
        tables.map((table) => {
          const metric = table.metric;
          const label = metricLabel(t, metric, frame, zh);
          const meta = metricMeta(t, metric, frame, topLine);
          return (
            <section key={metric.id} className="fin-sec" data-fc-table={metric.id}>
              <h3 className="fin-sec-h fin-rail fin-rule" style={{ "--rail": "var(--brand)" } as CSSProperties}>
                {label}
              </h3>
              <p className={styles.meta} data-fc-meta>
                {meta}
              </p>
              {table.applicability !== "applicable" ? (
                <div className="fin-empty" role="status" data-fc-applicability={table.applicability}>
                  {table.applicability === "industrial_only"
                    ? t("fcIndustrialOnlyTable", { metric: label, anchor: sym, family: t(FAMILY_WORD[frame.family]) })
                    : t("fcAmbiguousTable", { metric: label, anchor: sym })}
                </div>
              ) : (
                <div className="fin-card">
                  <div className={`fin-table-scroll ${styles.scroll}`}>
                    <table className={`fin-table ${styles.table}`}>
                      <caption className={styles.srOnly}>
                        {`${label} · ${t(alignment === "fiscal" ? "fcAlignFiscal" : "fcAlignCalendar")} · ${meta}`}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col" className="fin-cell fin-cell-sticky fin-cell-corner fin-cell-head">
                            {t("fcCompanyCol")}
                          </th>
                          {columns.map((c) => (
                            <th key={c.key} scope="col" className="fin-cell fin-cell-head" data-fc-col={c.key}>
                              {columnLabel(t, c)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row) => (
                          <tr
                            key={row.sym}
                            className="fin-row"
                            data-fc-row={row.sym}
                            data-fc-row-state={row.state.status} // plain-language-ok: data attribute for tests, never rendered text
                          >
                            <th scope="row" className={`fin-cell fin-cell-sticky ${styles.rowHead}`}>
                              <span className={styles.rowSym}>{row.sym}</span>
                              <RowSub t={t} row={row} />
                            </th>
                            {row.state.status === "ready" ? (
                              row.cells.map((cell) => (
                                <CellView
                                  key={cell.column}
                                  t={t}
                                  cell={cell}
                                  row={row}
                                  frame={frame}
                                  metric={metric}
                                  label={label}
                                  onOpen={(opener) =>
                                    cell.source && setOpen({ metric: metric.id, cell, source: cell.source, opener })
                                  }
                                />
                              ))
                            ) : (
                              <td colSpan={columns.length} className={`fin-cell ${styles.rowMsg}`}>
                                <RowMessage
                                  t={t}
                                  row={row}
                                  frame={frame}
                                  basisWord={basisWord(basis)}
                                  onRetry={() => retryPeer(row.sym)}
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          );
        })}

      {open && sourceFund && (
        <SourcePanel
          t={t}
          zh={zh}
          open={open}
          fund={sourceFund}
          frame={frame}
          panelRef={panelRef}
          onClose={closeSource}
          onOpenTx={open.source.sym === sym ? onOpenTx : undefined}
        />
      )}
    </div>
  );
}

function metricMeta(t: T, metric: CompareMetric, frame: CompareFrame, topLine: string): string {
  const kind =
    metric.kind === "flow"
      ? t("fcMetaFlow")
      : metric.kind === "stock"
        ? t("fcMetaStock")
        : metric.kind === "per_share"
          ? t("fcMetaPerShare")
          : t("fcMetaRatio", { topLine });
  const unit =
    metric.unit === "percent"
      ? t("fcMetaUnitPercent")
      : metric.unit === "currency_per_share"
        ? t("fcMetaUnitPerShare", { currency: currencyWord(t, frame.currency) })
        : currencyWord(t, frame.currency);
  const rule =
    metric.family === "any_family" ? t("fcRuleAny") : metric.family === "same_family" ? t("fcRuleSame") : t("fcRuleIndustrial");
  return `${kind} · ${unit} · ${rule}`;
}

const STALE_KEY: Record<Exclude<PeerStale, null>, [FinCompareKey, FinCompareKey]> = {
  revalidating: ["fcStaleRevalidating", "fcStaleRevalidatingTitle"],
  refresh_failed: ["fcStaleFailed", "fcStaleFailedTitle"],
};

function RowSub({ t, row }: { t: T; row: CompareRow }) {
  const parts: string[] = [];
  if (row.state.status !== "loading" && row.state.status !== "absent" && row.state.status !== "unavailable") {
    parts.push(currencyWord(t, row.currency));
    if (row.family) parts.push(t(FAMILY_WORD[row.family]));
  }
  return (
    <span className={styles.rowSub}>
      {row.isAnchor && <span className={styles.rowTag}>{t("fcAnchorBadge")}</span>}
      {row.stale && (
        <span className={`${styles.rowTag} ${styles.rowTagWarn}`} title={t(STALE_KEY[row.stale][1])} data-fc-stale={row.stale}>
          {t(STALE_KEY[row.stale][0])}
        </span>
      )}
      {parts.length > 0 && <span className={styles.rowMeta}>{parts.join(" · ")}</span>}
    </span>
  );
}

function RowMessage({
  t,
  row,
  frame,
  basisWord,
  onRetry,
}: {
  t: T;
  row: CompareRow;
  frame: CompareFrame;
  basisWord: string;
  onRetry: () => void;
}) {
  const state = row.state;
  switch (state.status) {
    case "loading":
      return <span className={styles.rowMsgText} role="status">{t("fcLoading")}</span>;
    case "absent":
      return <span className={styles.rowMsgText}>{t("fcAbsent", { sym: row.sym })}</span>;
    case "unavailable": {
      const reason = t(state.reason === "network" ? "fcReasonNetwork" : state.reason === "server" ? "fcReasonServer" : "fcReasonMalformed");
      return (
        <span className={styles.rowMsgText}>
          {t("fcUnavailable", { sym: row.sym, reason })}{" "}
          <button type="button" className={styles.retry} onClick={onRetry} data-fc-retry={row.sym}>
            {t("fcRetry")}
          </button>
        </span>
      );
    }
    case "basis_absent":
      return <span className={styles.rowMsgText}>{t("fcBasisAbsent", { sym: row.sym, basis: basisWord })}</span>;
    case "kind_mismatch":
      return (
        <span className={styles.rowMsgText}>
          {t("fcKindMismatch", {
            sym: row.sym,
            kinds: state.kinds.map((k) => t(PERIOD_KIND_WORD[k])).join(" / "),
            kind: t(KIND_WORD[frame.kind]),
          })}
        </span>
      );
    case "kind_unknown":
      return <span className={styles.rowMsgText}>{t("fcKindUnknown", { sym: row.sym })}</span>;
    case "generation_gap":
      return (
        <span className={styles.rowMsgText}>
          {t("fcGenerationGap", { sym: row.sym, latest: t.date(state.latestEnd), frame: t.date(state.frameEnd) })}
        </span>
      );
    case "ready":
      return null;
  }
}

function CellView({
  t,
  cell,
  row,
  frame,
  metric,
  label,
  onOpen,
}: {
  t: T;
  cell: CompareCell;
  row: CompareRow;
  frame: CompareFrame;
  metric: CompareMetric;
  label: string;
  onOpen: (opener: string) => void;
}) {
  const source = cell.source;
  const opener = `${metric.id}:${row.sym}:${cell.column}`;
  const period = source ? (
    <span className={styles.period}>
      <span className={styles.periodLabel}>{source.label}</span>
      <span className={styles.periodEnd}>{t("fcCellEnded", { date: t.date(source.end) })}</span>
    </span>
  ) : null;
  const openLabel = source
    ? t("fcOpenSource", { sym: row.sym, metric: label, label: source.label, date: t.date(source.end) })
    : undefined;

  if (cell.status === "ok" && cell.value != null && source) {
    const restatedTitle = source.restated
      ? t("fcRestatedTitle", { filed: source.filed ? t("fcFiledOn", { date: t.date(source.filed) }) : t("fcFiledUnknown") })
      : undefined;
    return (
      <td className={`fin-cell fin-cell-num ${styles.cell}`} data-fc-col={cell.column} data-fc-status="ok">
        <button type="button" className={styles.cellBtn} data-fc-cell={opener} aria-label={openLabel} onClick={() => onOpen(opener)}>
          <span className={styles.valueLine}>
            <span className={`fin-cell-v ${styles.value}`} data-fc-value>
              {formatValue(metric, cell.value)}
            </span>
            {cell.rank != null && cell.rankOf != null && (
              <span className={styles.rank} data-fc-rank={`${cell.rank}/${cell.rankOf}`}>
                {t("fcRank", { rank: cell.rank, of: cell.rankOf })}
              </span>
            )}
          </span>
          {period}
          {(source.restated || source.derivation === "differenced_ytd") && (
            <span className={styles.badges}>
              {source.restated && (
                <span className={styles.badge} title={restatedTitle} data-fc-restated>
                  {t("fcRestated")}
                </span>
              )}
              {source.derivation === "differenced_ytd" && (
                <span className={styles.badge} title={t("fcDifferencedTitle")} data-fc-differenced>
                  {t("fcDifferenced")}
                </span>
              )}
            </span>
          )}
        </button>
      </td>
    );
  }

  const { short, long } = reasonText(t, cell, frame, row);
  const statusWord = t(cell.status === "noncomparable" ? "fcStatusNoncomparable" : "fcStatusUnavailable");
  const body = (
    <>
      <span className={styles.refused}>
        <span className={styles.srOnly}>{`${statusWord}: `}</span>
        <span className={styles.refusedReason}>{short}</span>
      </span>
      {period}
      <span className={styles.srOnly}>{long}</span>
    </>
  );
  return (
    <td
      className={`fin-cell fin-cell-num ${styles.cell} ${cell.status === "noncomparable" ? styles.cellNoncomparable : styles.cellUnavailable}`}
      data-fc-col={cell.column}
      data-fc-status={cell.status}
      data-fc-reason={cell.reason ?? undefined}
      title={long}
    >
      {source ? (
        <button type="button" className={styles.cellBtn} data-fc-cell={opener} aria-label={`${statusWord} — ${long} ${openLabel ?? ""}`} onClick={() => onOpen(opener)}>
          {body}
        </button>
      ) : (
        body
      )}
    </td>
  );
}

function SourcePanel({
  t,
  zh,
  open,
  fund,
  frame,
  panelRef,
  onClose,
  onOpenTx,
}: {
  t: T;
  zh: boolean;
  open: OpenSource;
  fund: Fund;
  frame: CompareFrame | null;
  panelRef: React.MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenTx?: (txId: string) => void;
}) {
  const { source, cell } = open;
  const metric = COMPARE_METRICS.find((m) => m.id === open.metric)!;
  const label = metricLabel(t, metric, frame, zh);
  const set = source.basis === "annual" ? fund.statements?.annual : fund.statements?.quarterly;
  const focus = {
    stmt: source.block,
    basis: source.basis,
    index: source.index,
    periodEnd: source.end,
    rowId: source.rowId,
  } as const;
  const present = resolveStatementsFocus(focus, set, source.block, source.basis) != null;
  const basisLabel =
    source.basis === "annual" ? t("fcAnnual") : statementCadenceLabel(fund.statements?.quarterly, "quarterly", zh);
  const sourceCurrency = statementCurrencyCode(fund.stmt_currency);
  const refusal =
    cell.status !== "ok" && cell.reason && frame
      ? {
          word: t(cell.status === "noncomparable" ? "fcStatusNoncomparable" : "fcStatusUnavailable"),
          long: t(LONG_REASON[cell.reason], {
            kind: t(KIND_WORD[frame.kind]),
            family: t(FAMILY_WORD[source.family]),
            frameFamily: t(FAMILY_WORD[frame.family]),
            currency: currencyWord(t, source.currency),
            frameCurrency: currencyWord(t, frame.currency),
          }),
        }
      : null;
  const topLine = incomeTopLineLabel(source.family, zh);

  return (
    <section
      className={`fin-sec ${styles.source}`}
      ref={panelRef}
      aria-labelledby="fc-source-title"
      data-fc-source={`${source.sym}:${source.basis}:${source.block}:${source.index}`}
      data-fc-source-end={source.end}
    >
      <div className={styles.sourceHead}>
        <h3 id="fc-source-title" className="fin-sec-h fin-rail" style={{ "--rail": "var(--brand-2)" } as CSSProperties}>
          {t("fcSourceTitle")}
        </h3>
        <button type="button" className={styles.close} onClick={onClose} data-fc-close-source>
          {t("fcCloseSource")}
        </button>
      </div>
      <p className={styles.sourceFor} data-fc-source-for>
        {t("fcSourceFor", { sym: source.sym, metric: label, label: source.label, date: t.date(source.end) })}
      </p>
      <p className={styles.sourceMeta}>
        {t("fcSourceBasis", {
          basis: basisLabel,
          statement: t(STATEMENT_WORD[source.block]),
          currency: currencyWord(t, sourceCurrency),
          family: t(FAMILY_WORD[source.family]),
        })}
        {source.filed ? ` · ${t("fcFiledOn", { date: t.date(source.filed) })}` : ""}
      </p>
      {refusal && (
        <p className={styles.sourceRefusal} data-fc-source-refusal={cell.reason ?? undefined}>
          <strong>{refusal.word}</strong> — {refusal.long}
        </p>
      )}
      {source.restated && (
        <p className={styles.sourceNote} data-fc-source-restated>
          {t("fcRestatedTitle", { filed: source.filed ? t("fcFiledOn", { date: t.date(source.filed) }) : t("fcFiledUnknown") })}
        </p>
      )}
      {source.derivation === "differenced_ytd" && <p className={styles.sourceNote}>{t("fcDifferencedTitle")}</p>}
      {source.startEstimated && frame?.alignment === "calendar" && (
        <p className={styles.sourceNote}>{t("fcSourceStartEstimated")}</p>
      )}
      <p className={styles.sourceNote}>
        {metric.id === "net_margin" ? t("fcSourceMarginHint", { topLine }) : t("fcSourceHint", { sym: source.sym })}
      </p>
      {present ? (
        <StatementsPage
          key={`${source.sym}:${source.basis}:${source.block}:${source.index}:${source.rowId}`}
          sym={source.sym}
          fund={fund}
          focus={focus}
          onOpenTx={onOpenTx}
        />
      ) : (
        <div className="fin-empty" role="status" data-fc-source-missing>
          {t("fcSourceMissing", { sym: source.sym })}
        </div>
      )}
    </section>
  );
}

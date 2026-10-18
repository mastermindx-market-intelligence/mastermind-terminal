"use client";
/**
 * E18 — manage several alerts at once: filter by what the store records (state · type · symbol),
 * tick an explicit set, review it, then pause or resume it. Every alert reports its own answer.
 *
 * Contract (all rules live in lib/alertBulk.ts and are unit-tested there):
 *  · The action targets the CAPTURED selection, frozen when the review opens — never whatever the
 *    filters show at confirm time. Selection is locked while a review is open.
 *  · Every write goes through the one existing owner, PATCH /api/alerts, one id per request, at most
 *    three in flight, each id sent once. The owner authenticates, owner-scopes and tier-checks it.
 *  · A reply that does not acknowledge the write is shown as "not confirmed" with whatever a later
 *    read observed, never counted as paused/resumed and never sent again by this panel.
 *  · A refresh keeps still-present selected rows and names deleted or changed ones. Any change to a
 *    reviewed row makes the review unconfirmable until it is reviewed again.
 *  · The selection belongs to one account: the panel is keyed by owner, so an account switch drops
 *    it, and a run still going when the panel unmounts sends nothing further.
 *
 * Expiry and groups are not offered: the alerts table has no field for either (see bkUnsupported).
 * Nothing here changes how alerts fire or are delivered: a paused alert is simply an inactive row.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { ALERTS_CHANGED_EVENT, conditionText } from "@/lib/alertsView";
import { optAlertPreview } from "@/lib/optionsAlerts";
import { suiteAlertPreview, suiteSequencePreview, type SuiteAlertCondition, type SuiteSequenceCondition } from "@/lib/suiteAlerts";
import { useAlertBulkT } from "@/lib/alertBulkLex";
import {
  NO_FILTER,
  addAll,
  alertState,
  capturePlan,
  emptySelection,
  hasReport,
  matchesFilter,
  mergeReport,
  observeUnknown,
  planStillMatches,
  reconcileSelection,
  runPlan,
  summarize,
  toBulkAlerts,
  toggle,
  willWrite,
  type AlertState,
  type Applicability,
  type BulkAction,
  type BulkAlert,
  type BulkFilter,
  type BulkPlan,
  type Observation,
  type RefreshReport,
  type Reply,
  type RowOutcome,
  type Selection,
  type SummaryKind,
  type TypeGroup,
} from "@/lib/alertBulk";
import s from "./alertBulk.module.css";

const CONCURRENCY = 3;
const EMPTY_REPORT: RefreshReport = { deleted: [], changed: [] };

const STATE_KEY: Record<AlertState, string> = { armed: "bkStateArmed", paused: "bkStatePaused", fired: "bkStateFired" };
const STATES: AlertState[] = ["armed", "paused", "fired"];
const TYPE_KEY: Record<TypeGroup, string> = {
  signal: "bkTypeSignal", price: "bkTypePrice", rsi: "bkTypeRsi", regime: "bkTypeRegime",
  options: "bkTypeOptions", suite: "bkTypeSuite", other: "bkTypeOther",
};
const TYPES: TypeGroup[] = ["signal", "price", "rsi", "regime", "options", "suite", "other"];
const APPLIES_KEY: Record<Applicability, Record<BulkAction, string>> = {
  apply: { pause: "bkWillPause", resume: "bkWillResume" },
  rearm: { pause: "bkWillRearm", resume: "bkWillRearm" },
  "skip-paused": { pause: "bkSkipPaused", resume: "bkSkipPaused" },
  "skip-fired": { pause: "bkSkipFired", resume: "bkSkipFired" },
  "skip-armed": { pause: "bkSkipArmed", resume: "bkSkipArmed" },
};
const SUMMARY_KEY: Record<Exclude<SummaryKind, "done">, string> = {
  triggeredFirst: "bkCountFiredFirst", refused: "bkCountRefused", unknown: "bkCountUnknown",
  notSent: "bkCountNotSent", skipped: "bkCountSkipped", pending: "bkCountPending",
};
const APPLIES_ORDER: Applicability[] = ["apply", "rearm", "skip-paused", "skip-fired", "skip-armed"];

type Inventory =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "ready"; rows: BulkAlert[]; stale: boolean };

type Run = {
  plan: BulkPlan;
  sending: Record<string, true>;
  outcomes: Record<string, RowOutcome>;
  /** what the latest read showed for each not-confirmed row; null until a read has answered */
  observed: Record<string, Observation> | null;
  checking: boolean;
  done: boolean;
};

/** One PATCH through the existing owner. The reply is classified by the caller, never here. */
async function sendLifecycle(id: string, action: BulkAction): Promise<Reply> {
  try {
    const r = await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } catch {
    return "transport-failed";
  }
}

type Read = { kind: "ok"; rows: BulkAlert[] } | { kind: "signed-out" } | { kind: "failed" };

async function readInventory(): Promise<Read> {
  try {
    const r = await fetch("/api/alerts", { cache: "no-store" });
    if (r.status === 401) return { kind: "signed-out" };
    if (!r.ok) return { kind: "failed" };
    const body = (await r.json().catch(() => null)) as { alerts?: unknown } | null;
    const rows = toBulkAlerts(body && typeof body === "object" ? body.alerts : undefined);
    return rows ? { kind: "ok", rows } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export default function AlertBulkManager({ email }: { email: string }) {
  const identity = useShellIdentity();
  const owner = `${identityOwnerKey(identity)}|${email}`;
  // Keyed by owner: an account switch remounts the panel, so no selection, review or result can
  // carry across accounts.
  return <Manager key={owner} owner={owner} />;
}

function Manager({ owner }: { owner: string }) {
  const t = useAlertBulkT();
  const { lang } = useLang();
  const L = lang === "zh" ? "zh" : "en";

  const [open, setOpen] = useState(false);
  const [inv, setInv] = useState<Inventory>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<BulkFilter>(NO_FILTER);
  const [sel, setSel] = useState<Selection>(() => emptySelection(owner));
  const [report, setReport] = useState<RefreshReport>(EMPTY_REPORT);
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [planStale, setPlanStale] = useState(false);
  const [run, setRun] = useState<Run | null>(null);

  const alive = useRef(true);
  const readSeq = useRef(0);
  const selRef = useRef(sel);
  const planRef = useRef<BulkPlan | null>(null);
  const suppressSelf = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const commitSelection = useCallback((next: Selection) => { selRef.current = next; setSel(next); }, []);
  const commitPlan = useCallback((next: BulkPlan | null) => { planRef.current = next; setPlan(next); }, []);

  /** Read the inventory once. Returns the rows this read saw (null when it saw none). */
  const load = useCallback(async (): Promise<BulkAlert[] | null> => {
    const seq = ++readSeq.current;
    setRefreshing(true);
    const read = await readInventory();
    const rows = read.kind === "ok" ? read.rows : null;
    if (!alive.current || seq !== readSeq.current) return rows;
    setRefreshing(false);
    if (read.kind === "signed-out") {
      commitSelection(emptySelection(owner));
      commitPlan(null);
      setReport(EMPTY_REPORT);
      setInv({ kind: "signed-out" });
      return null;
    }
    if (read.kind === "failed") {
      setInv((prev) => (prev.kind === "ready" ? { ...prev, stale: true } : { kind: "unavailable" }));
      return null;
    }
    const { selection, report: delta } = reconcileSelection(selRef.current, read.rows);
    commitSelection(selection);
    if (hasReport(delta)) setReport((prev) => mergeReport(prev, delta));
    if (planRef.current && !planStillMatches(planRef.current, read.rows)) setPlanStale(true);
    setInv({ kind: "ready", rows: read.rows, stale: false });
    return read.rows;
  }, [commitPlan, commitSelection, owner]);

  // Another alerts surface on this page wrote something: read again so the selection is checked
  // against the store, not against what this panel last saw.
  useEffect(() => {
    if (!open) return;
    const onChanged = () => { if (!suppressSelf.current) void load(); };
    window.addEventListener(ALERTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ALERTS_CHANGED_EVENT, onChanged);
  }, [open, load]);

  const announceChanged = useCallback(() => {
    suppressSelf.current = true;
    try { window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT)); } finally { suppressSelf.current = false; }
  }, []);

  const describe = useCallback((c: Record<string, unknown>): string => {
    const type = c.type;
    try {
      if (type === "signal") return c.target === "BUY" ? t("condSignalBuy") : t("condSignalSell");
      if (type === "regime") return t("condRegimeUp");
      if (type === "rsi") return `${t("condRsiBelow")} ${String(c.value ?? "")}`.trim();
      if (typeof type === "string" && type.startsWith("opt_")) return optAlertPreview(c, L);
      if (type === "suite_event") return suiteAlertPreview(c as unknown as SuiteAlertCondition, L);
      if (type === "suite_sequence") return suiteSequencePreview(c as unknown as SuiteSequenceCondition, L);
    } catch {
      /* a malformed stored condition falls through to the generic sentence */
    }
    return conditionText(c as { type?: string }, undefined, L);
  }, [t, L]);

  const rowLabel = useCallback((a: BulkAlert) => `${a.symbol} · ${describe(a.condition)}`, [describe]);
  const stateText = useCallback((st: AlertState) => t(STATE_KEY[st]), [t]);

  const running = !!run && !run.done;
  const reviewing = !!plan;
  const shown = useMemo(() => (inv.kind === "ready" ? inv.rows.filter((a) => matchesFilter(a, filter)) : []), [inv, filter]);
  const shownIds = useMemo(() => new Set(shown.map((a) => a.id)), [shown]);
  const selectedCount = sel.order.length;
  const hiddenCount = sel.order.filter((id) => !shownIds.has(id)).length;
  const allShownSelected = shown.length > 0 && shown.every((a) => !!sel.rows[a.id]);
  const filtered = filter.state !== "all" || filter.type !== "all" || filter.symbol.trim() !== "";

  const openPanel = () => { setOpen(true); void load(); };
  const closePanel = () => { if (!running) { setOpen(false); commitPlan(null); setPlanStale(false); } };

  const review = (action: BulkAction) => {
    if (running || selRef.current.order.length === 0) return;
    commitPlan(capturePlan(selRef.current, action));
    setPlanStale(false);
    void load(); // check the captured rows against the store while the user reads the preview
  };
  const reviewAgain = () => {
    if (!planRef.current) return;
    commitPlan(capturePlan(selRef.current, planRef.current.action));
    setPlanStale(false);
  };
  const cancelReview = () => { commitPlan(null); setPlanStale(false); };

  const confirm = useCallback(async () => {
    const p = planRef.current;
    if (!p || planStale) return;
    // Fence: the review is consumed before the first send, so a second click finds no plan.
    commitPlan(null);
    commitSelection(emptySelection(owner));
    setReport(EMPTY_REPORT);
    setRun({ plan: p, sending: {}, outcomes: {}, observed: null, checking: false, done: false });
    const mine = (r: Run | null) => !!r && r.plan === p;
    const outcomes = await runPlan(p, {
      concurrency: CONCURRENCY,
      currentOwner: () => (alive.current ? owner : ""),
      send: sendLifecycle,
      onSending: (id) => {
        if (alive.current) setRun((r) => (mine(r) ? { ...r!, sending: { ...r!.sending, [id]: true } } : r));
      },
      onOutcome: (id, o) => {
        if (alive.current) setRun((r) => (mine(r) ? { ...r!, outcomes: { ...r!.outcomes, [id]: o } } : r));
      },
    });
    if (!alive.current) return;
    const list = Object.values(outcomes);
    const maybeWrote = list.some((o) => o.kind === "acknowledged" || o.kind === "unknown");
    if (maybeWrote) {
      if (list.some((o) => o.kind === "unknown")) setRun((r) => (mine(r) ? { ...r!, checking: true } : r));
      const after = await load();
      if (!alive.current) return;
      setRun((r) => (mine(r) ? { ...r!, checking: false, observed: observeUnknown(outcomes, after) } : r));
      announceChanged();
    }
    setRun((r) => (mine(r) ? { ...r!, done: true } : r));
  }, [announceChanged, commitPlan, commitSelection, load, owner, planStale]);

  /** GET-only: look at the store again for the rows whose write was not confirmed. Never re-sends. */
  const recheck = async () => {
    if (!run) return;
    const p = run.plan;
    const outcomes = run.outcomes;
    setRun((r) => (r && r.plan === p ? { ...r, checking: true } : r));
    const after = await load();
    if (!alive.current) return;
    setRun((r) => (r && r.plan === p ? { ...r, checking: false, observed: observeUnknown(outcomes, after) } : r));
  };

  // ── results ──────────────────────────────────────────────────────────────
  const resultView = (r: Run) => {
    const sum = summarize(r.plan, r.outcomes);
    const unknownCount = sum.parts.find((x) => x.kind === "unknown")?.n ?? 0;
    const parts = sum.parts.map(({ kind, n }) =>
      t(kind === "done" ? (r.plan.action === "pause" ? "bkCountPaused" : "bkCountResumed") : SUMMARY_KEY[kind], { n }));
    const summary = `${parts.join(" · ")} ${t("bkOfSelected", { n: sum.total })}`;

    const rowResult = (row: BulkAlert, applies: Applicability): { kind: string; text: string; tone: string } => {
      if (!willWrite(applies)) return { kind: "skipped", text: t(APPLIES_KEY[applies][r.plan.action]), tone: s.toneMuted };
      const o = r.outcomes[row.id];
      if (!o) return r.sending[row.id]
        ? { kind: "sending", text: t("bkSending"), tone: s.toneMuted }
        : { kind: "waiting", text: t("bkWaiting"), tone: s.toneMuted };
      if (o.kind === "acknowledged") {
        if (r.plan.action === "pause") {
          return alertState(o.row) === "fired"
            ? { kind: "acknowledged", text: t("bkResultFiredFirst"), tone: s.toneSignal }
            : { kind: "acknowledged", text: t("bkResultPaused"), tone: s.toneDone };
        }
        return { kind: "acknowledged", text: t(applies === "rearm" ? "bkResultRearmed" : "bkResultResumed"), tone: s.toneDone };
      }
      if (o.kind === "refused") {
        const key = o.reason === "signed-out" ? "bkRefusedSignedOut" : o.reason === "not-found" ? "bkRefusedNotFound" : "bkRefusedNotAllowed";
        return { kind: "refused", text: t(key), tone: s.toneDanger };
      }
      if (o.kind === "unknown") {
        const seen = r.observed?.[row.id];
        let text: string;
        if (r.checking || !seen) text = t("bkUnknownChecking");
        else if (seen.kind === "state") text = t("bkUnknownObserved", { state: stateText(seen.state) });
        else if (seen.kind === "missing") text = t("bkUnknownMissing");
        else text = t("bkUnknownUnreadable");
        return { kind: "unknown", text, tone: s.toneWarn };
      }
      return { kind: "not-sent", text: t(o.reason === "signed-out" ? "bkNotSentSignedOut" : "bkNotSentAccount"), tone: s.toneMuted };
    };

    return (
      <div className={s.results} data-bulk-results={r.plan.action} data-bulk-done={r.done ? "1" : "0"}>
        <h3 className={s.subhead}>{t(r.plan.action === "pause" ? "bkResultsPause" : "bkResultsResume")}</h3>
        <p className={s.summary} role="status" aria-live="polite" data-bulk-summary>{summary}</p>
        <ul className={s.list}>
          {r.plan.rows.map(({ row, applies }) => {
            const res = rowResult(row, applies);
            return (
              <li
                key={row.id}
                className={s.resultRow}
                data-bulk-result-row={row.id}
                data-bulk-outcome={res.kind} // plain-language-ok: data attribute, not rendered text
              >
                <span className={s.sym}>{row.symbol}</span>
                <span className={s.cond}>{describe(row.condition)}</span>
                <span className={`${s.chip} ${res.tone}`}>{res.text}</span>
              </li>
            );
          })}
        </ul>
        {unknownCount > 0 ? (
          <div className={s.unknownNote}>
            <p className={s.note}>{t("bkUnknownNote")}</p>
            <button type="button" className="btn btn-ghost" onClick={() => void recheck()} disabled={r.checking} data-bulk-recheck>
              {t("bkCheckStatus")}
            </button>
          </div>
        ) : null}
        {r.done ? (
          <div className={s.actions}>
            <button type="button" className="btn btn-ghost" onClick={() => setRun(null)} data-bulk-results-done>{t("bkDone")}</button>
          </div>
        ) : null}
      </div>
    );
  };

  // ── review ───────────────────────────────────────────────────────────────
  const reviewView = (p: BulkPlan) => {
    const writable = p.rows.filter((x) => willWrite(x.applies)).length;
    return (
      <div className={s.review} data-bulk-review={p.action} data-bulk-review-stale={planStale ? "1" : "0"}>
        <h3 className={s.subhead}>{t(p.action === "pause" ? "bkReviewPause" : "bkReviewResume", { n: p.rows.length })}</h3>
        {p.action === "pause" ? <p className={s.note}>{t("bkPauseNote")}</p> : null}
        {APPLIES_ORDER.map((ap) => {
          const group = p.rows.filter((x) => x.applies === ap);
          if (!group.length) return null;
          return (
            <div key={ap} className={s.reviewGroup} data-bulk-review-group={ap}>
              <p className={s.groupHead}>{t(APPLIES_KEY[ap][p.action])} <span className={s.count}>{group.length}</span></p>
              <ul className={s.list}>
                {group.map(({ row }) => (
                  <li key={row.id} className={s.resultRow} data-bulk-review-row={row.id}>
                    <span className={s.sym}>{row.symbol}</span>
                    <span className={s.cond}>{describe(row.condition)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {writable === 0 ? <p className={s.note}>{t("bkNothingToDo")}</p> : null}
        {planStale ? (
          <div className={s.alertBox} role="alert">
            <p>{t("bkReviewStale")}</p>
            <button type="button" className="btn btn-ghost" onClick={reviewAgain} data-bulk-review-again>{t("bkReviewAgain")}</button>
          </div>
        ) : null}
        <div className={s.actions}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void confirm()}
            disabled={planStale || writable === 0}
            data-bulk-confirm
          >
            {t(p.action === "pause" ? "bkConfirmPause" : "bkConfirmResume", { n: writable })}
          </button>
          <button type="button" className="btn btn-ghost" onClick={cancelReview} data-bulk-cancel>{t("bkCancel")}</button>
        </div>
      </div>
    );
  };

  // ── inventory ────────────────────────────────────────────────────────────
  const inventoryView = () => {
    if (inv.kind === "loading") return <p className={s.note} role="status" data-bulk-inventory="loading">{t("bkLoading")}</p>;
    if (inv.kind === "signed-out") return <p className={s.note} data-bulk-inventory="signed-out">{t("bkSignedOut")}</p>;
    if (inv.kind === "unavailable") {
      return (
        <div className={s.alertBox} role="alert" data-bulk-inventory="unavailable">
          <p>{t("bkUnavailable")}</p>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={refreshing}>{t("bkRetry")}</button>
        </div>
      );
    }
    return (
      <>
        {inv.stale ? (
          <div className={s.alertBox} role="alert" data-bulk-inventory="stale">
            <p>{t("bkStale")}</p>
            <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={refreshing}>{t("bkRetry")}</button>
          </div>
        ) : null}

        {hasReport(report) ? (
          <div className={s.notice} role="status" data-bulk-report>
            <p className={s.groupHead}>{t("bkSinceSelected")}</p>
            <ul className={s.noticeList}>
              {report.deleted.map((a) => (
                <li key={`d-${a.id}`} data-bulk-deleted={a.id}>{t("bkDeletedRow", { row: rowLabel(a) })}</li>
              ))}
              {report.changed.map(({ before, after }) => (
                <li key={`c-${after.id}`} data-bulk-changed={after.id}>
                  {alertState(before) !== alertState(after)
                    ? t("bkChangedState", { row: rowLabel(after), from: stateText(alertState(before)), to: stateText(alertState(after)) })
                    : t("bkChangedOther", { row: rowLabel(after) })}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-ghost" onClick={() => setReport(EMPTY_REPORT)}>{t("bkDismiss")}</button>
          </div>
        ) : null}

        {inv.rows.length === 0 ? (
          <p className={s.note} data-bulk-inventory="empty">{t("bkNoAlerts")}</p>
        ) : (
          <>
            <div className={s.filters}>
              <label className={s.field}>
                <span className={s.fieldLabel}>{t("bkFilterState")}</span>
                <select
                  className={s.input}
                  value={filter.state} // plain-language-ok: controlled select value, not rendered text (options render t() labels)
                  onChange={(e) => setFilter((f) => ({ ...f, state: e.target.value as BulkFilter["state"] }))}
                  data-bulk-filter="state"
                >
                  <option value="all">{t("bkAllStates")}</option>
                  {STATES.map((st) => <option key={st} value={st}>{stateText(st)}</option>)}
                </select>
              </label>
              <label className={s.field}>
                <span className={s.fieldLabel}>{t("bkFilterType")}</span>
                <select
                  className={s.input}
                  value={filter.type} // plain-language-ok: controlled select value, not rendered text (options render t() labels)
                  onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value as BulkFilter["type"] }))}
                  data-bulk-filter="type"
                >
                  <option value="all">{t("bkAllTypes")}</option>
                  {TYPES.map((ty) => <option key={ty} value={ty}>{t(TYPE_KEY[ty])}</option>)}
                </select>
              </label>
              <label className={s.field}>
                <span className={s.fieldLabel}>{t("bkFilterSymbol")}</span>
                <input
                  className={s.input}
                  type="search"
                  value={filter.symbol}
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(e) => setFilter((f) => ({ ...f, symbol: e.target.value }))}
                  data-bulk-filter="symbol"
                />
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => setFilter(NO_FILTER)} disabled={!filtered}>
                {t("bkClearFilters")}
              </button>
            </div>

            <div className={s.selbar} data-bulk-selected={selectedCount}>
              <span className={s.selCount}>{t("bkSelected", { n: selectedCount })}</span>
              {hiddenCount > 0 ? <span className={s.selHidden}>{t("bkHidden", { n: hiddenCount })}</span> : null}
              <span className={s.selShown}>{t("bkShown", { n: shown.length })}</span>
              <div className={s.selActions}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => commitSelection(addAll(selRef.current, shown))}
                  disabled={reviewing || allShownSelected || shown.length === 0}
                  data-bulk-select-shown
                >
                  {t("bkSelectShown")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => commitSelection(emptySelection(owner))}
                  disabled={reviewing || selectedCount === 0}
                >
                  {t("bkClearSelection")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => review("pause")}
                  disabled={reviewing || running || selectedCount === 0}
                  data-bulk-review-open="pause"
                >
                  {t("bkPauseSelected")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => review("resume")}
                  disabled={reviewing || running || selectedCount === 0}
                  data-bulk-review-open="resume"
                >
                  {t("bkResumeSelected")}
                </button>
              </div>
            </div>

            {plan ? reviewView(plan) : null}

            {shown.length === 0 ? (
              <p className={s.note} data-bulk-inventory="no-matches">{t("bkNoMatches")}</p>
            ) : (
              <ul className={s.list} data-bulk-list>
                {shown.map((a) => {
                  const st = alertState(a);
                  return (
                    <li key={a.id}>
                      <label className={s.row} data-bulk-row={a.id} data-state={st}>
                        <input
                          type="checkbox"
                          className={s.check}
                          checked={!!sel.rows[a.id]}
                          disabled={reviewing}
                          onChange={() => commitSelection(toggle(selRef.current, a))}
                        />
                        <span className={s.sym}>{a.symbol}</span>
                        <span className={s.cond}>{describe(a.condition)}</span>
                        <span className={`${s.chip} ${st === "armed" ? s.toneUp : st === "fired" ? s.toneSignal : s.toneMuted}`}>{stateText(st)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </>
    );
  };

  return (
    // Closed, the panel is one row (title + "Select alerts"): it sits under the alerts list inside
    // the cockpit's 100vh scroll box, so it must not push the existing modules below the fold.
    <section
      className={open ? s.panel : `${s.panel} ${s.panelClosed}`}
      data-bulk-manager={open ? "open" : "closed"}
      aria-labelledby="alerts-bulk-title"
    >
      <div className={s.head}>
        <h2 id="alerts-bulk-title" className={s.title}>{t("bkTitle")}</h2>
        {open ? (
          <div className={s.headActions}>
            <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={refreshing} data-bulk-refresh>
              {t("bkRefresh")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={closePanel} disabled={running}>{t("bkClose")}</button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" onClick={openPanel} data-bulk-open>{t("bkOpen")}</button>
        )}
      </div>
      {open ? (
        <div className={s.body}>
          <p className={s.intro}>{t("bkIntro")}</p>
          <p className={s.note} data-bulk-unsupported>{t("bkUnsupported")}</p>
          {run ? resultView(run) : null}
          {inventoryView()}
        </div>
      ) : null}
    </section>
  );
}

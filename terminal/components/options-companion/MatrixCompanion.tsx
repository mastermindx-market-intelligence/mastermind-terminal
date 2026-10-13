"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StrikeExpiryMatrix, buildMatrixGrid, matrixExactScopeStats, matrixScopeStructure, matrixSelectedNodeContext, matrixCellValue, fmtMatrixCell, isSignedMetric, matrixAxisDomain,
  type MatrixCellSelection, type MatrixDisplayMetric, type MatrixNorm } from "@/components/shared/StrikeExpiryMatrix";
import { readCompanionMatrix, matrixForExpiry, readMatrixReceipts, matrixSnapshotKey, type CompanionIssue, type OptionsChartLevel } from "@/lib/optionsCompanion";
import { useOptionsSnapshot } from "./useOptionsSnapshot";
import { type OptionsT, type OptionsWord } from "./optionsStrings";
import { GexMarketMemory } from "./GexMarketMemory";
import { useOptionsHost } from "./optionsHost";
import { parseScopeBounds, type BoundsIssue } from "@/lib/optionsScopeBounds";
import { EXACT_WINDOW_PCT, matrixForExactScope } from "@/lib/optionsScopeExact";
import { dteRaw } from "@/lib/dte";
import styles from "./OptionsCompanion.module.css";

export interface MatrixPreferences { expiries: "3" | "6" | "12" | "0dte"; window: 3 | 6 | 12 | 25; norm: MatrixNorm }
export interface PinProps { pinned: OptionsChartLevel | null; onPin: (level: OptionsChartLevel | null) => void; replayActive: boolean }
const samePrefs = (a: MatrixPreferences, b: MatrixPreferences) =>
  a.expiries === b.expiries && a.window === b.window && a.norm === b.norm;

type ScopeMode = "preset" | "exact";
interface ExactDraft { from: string; to: string; dteMin: string; dteMax: string }
const blankExact = (): ExactDraft => ({ from: "", to: "", dteMin: "", dteMax: "" });
const trimExact = (e: ExactDraft): ExactDraft => ({
  from: e.from.trim(), to: e.to.trim(), dteMin: e.dteMin.trim(), dteMax: e.dteMax.trim(),
});
const sameExact = (a: ExactDraft, b: ExactDraft) =>
  a.from.trim() === b.from.trim() && a.to.trim() === b.to.trim()
    && a.dteMin.trim() === b.dteMin.trim() && a.dteMax.trim() === b.dteMax.trim();

const ISSUE_KEY: Record<BoundsIssue, OptionsWord> = {
  from_missing: "scopeIssueFromMissing",
  to_missing: "scopeIssueToMissing",
  from_not_number: "scopeIssueFromNotNumber",
  to_not_number: "scopeIssueToNotNumber",
  not_positive: "scopeIssueNotPositive",
  inverted: "scopeIssueInverted",
  dte_not_whole: "scopeIssueDteNotWhole",
  dte_negative: "scopeIssueDteNegative",
  dte_inverted: "scopeIssueDteInverted",
  session_invalid: "scopeIssueSessionInvalid",
  no_strikes: "scopeIssueNoStrikes",
  no_expiries: "scopeIssueNoExpiries",
};

export function SnapshotStamp({ session, t, refresh, loading, children }: { session: string; t: OptionsT; refresh: () => void; loading: boolean; children?: React.ReactNode }) {
  return <div className={styles.receipt} data-options-session={session}>
    <strong>{t("eod")}</strong><time dateTime={session}>{session}</time>
    <button type="button" onClick={refresh} disabled={loading} aria-label={t("refresh")} title={t("refresh")}>↻</button>
    {children}
  </div>;
}
export function SnapshotEmpty({ issue = "unavailable", fetchStatus, t, loading, refresh }: {
  issue?: CompanionIssue; fetchStatus?: "loading" | "data" | "absent" | "unavailable";
  t: OptionsT; loading: boolean; refresh: () => void;
}) {
  const copy = loading ? "loading"
    : fetchStatus === "absent" ? "snapshotAbsent"
    : fetchStatus === "unavailable" ? "snapshotUnreadable"
    : issue === "unavailable" ? "unavailableBody"
    : issue;
  const title = loading ? "loading"
    : fetchStatus === "absent" ? "snapshotAbsent"
    : fetchStatus === "unavailable" ? "snapshotUnreadable"
    : "unavailable";
  return <div className={styles.empty} role="status">
    <span aria-hidden="true" className={styles.emptyGlyph}>▦</span>
    <strong>{t(title)}</strong>
    {!loading && <><p>{t(copy)}</p><button type="button" className={styles.action} onClick={refresh}>{t("refresh")}</button></>}
  </div>;
}
export function PinButton({ root, strike, session, label, pinned, onPin, replayActive, t }: PinProps & {
  root: string; strike: number; session: string; label: string; t: OptionsT;
}) {
  const host = useOptionsHost();
  const isPinned = pinned?.root === root && pinned.price === strike && pinned.session === session;
  // The desk page has no chart beside it, so there is nothing to pin a level to.
  if (host === "page") return null;
  return <button type="button" className={styles.action} disabled={replayActive}
    aria-pressed={isPinned} onClick={() => onPin(isPinned ? null : { root, price: strike, session, label })}>
    {t(isPinned ? "unpin" : "pin")}
  </button>;
}

export function MatrixCompanion({ root, metric, prefs, onPrefs, t, ...pin }: PinProps & {
  root: string; metric: MatrixDisplayMetric; prefs: MatrixPreferences; onPrefs: (prefs: MatrixPreferences) => void; t: OptionsT;
}) {
  const host = useOptionsHost();
  const [selection, setSelection] = useState<(MatrixCellSelection & { session: string }) | null>(null);
  const holdKey = useCallback((raw: unknown) => matrixSnapshotKey(raw, root), [root]);
  const snapshot = useOptionsSnapshot(`matrix:${root}`, { active: selection != null, key: holdKey });
  const receipt = useMemo(() => readCompanionMatrix(snapshot.data, root), [snapshot.data, root]);
  const fetchStatus = snapshot.status;
  const data = receipt.ok ? receipt.value : null;
  const [reveal, setReveal] = useState<{ id: number; session: string; cell: MatrixCellSelection } | null>(null);

  // Applied scope: preset prefs + (in exact mode) the four trimmed raw strings.
  const [appliedMode, setAppliedMode] = useState<ScopeMode>("preset");
  const [appliedExact, setAppliedExact] = useState<ExactDraft | null>(null);
  // Draft scope inside the editor: mirror the applied state on open/cancel.
  const [draftPrefs, setDraftPrefs] = useState<MatrixPreferences>(prefs);
  const [draftMode, setDraftMode] = useState<ScopeMode>(appliedMode);
  const [draftExact, setDraftExact] = useState<ExactDraft>(appliedExact ?? blankExact());

  // Re-qualify the applied exact scope against the current data session. The cells
  // that satisfy the bounds can shift when a newer snapshot moves the session by a
  // day; if the bounds no longer match anything we render options-scope-empty.
  const parseApplied = useMemo(() => {
    if (!data || appliedMode !== "exact" || !appliedExact) return null;
    const domain = matrixAxisDomain(data.doc);
    return parseScopeBounds(appliedExact, {
      session: data.session, strikes: domain.strikes, expiries: domain.expiries,
    });
  }, [data, appliedMode, appliedExact]);

  // The scope the editor renders and the scope the map summarises.
  //   - preset: the all-or-0DTE cut of the doc, with maxCols = prefs.expiries
  //   - exact: a thin S × E cut with maxCols = result.expiries.length and a
  //     windowPct that excludes no strike (EXACT_WINDOW_PCT), so matrixExactScopeStats
  //     keeps every chosen strike instead of cropping by ±window%.
  const scopedDoc = useMemo(() => {
    if (!data) return null;
    if (appliedMode === "exact" && parseApplied?.ok) {
      return matrixForExactScope(data.doc, parseApplied.strikes, parseApplied.expiries);
    }
    return matrixForExpiry(data, prefs.expiries === "0dte" ? "0dte" : "all");
  }, [data, appliedMode, parseApplied, prefs.expiries]);
  const maxCols = appliedMode === "exact" && parseApplied?.ok
    ? parseApplied.expiries.length
    : prefs.expiries === "0dte" ? 1 : Number(prefs.expiries);
  const windowPct = appliedMode === "exact" && parseApplied?.ok
    ? EXACT_WINDOW_PCT
    : prefs.window;
  const grid = useMemo(() => scopedDoc ? buildMatrixGrid({ matrix: scopedDoc, metric, maxCols, windowPct,
    maxRows: 101, exactStrikes: true, normalization: prefs.norm, scope: "all", withSigma: true,
    displayCenterStrike: reveal?.session === data?.session ? reveal?.cell.strike : null,
    scaleOver: "selected-scope" }) : null,
  [scopedDoc, metric, maxCols, windowPct, prefs.norm, reveal, data?.session]);
  const scopeGrid = useMemo(() => scopedDoc ? buildMatrixGrid({ matrix: scopedDoc, metric, maxCols, windowPct,
    maxRows: 10_000, exactStrikes: true, normalization: prefs.norm, scope: "all" }) : null,
  [scopedDoc, metric, maxCols, windowPct, prefs.norm]);
  const [scopeOpen, setScopeOpen] = useState(false);

  const selectionCurrent = selection && selection.session === data?.session ? selection : null;
  const selectedVisible = grid && selectionCurrent
    && grid.strikes.includes(selectionCurrent.strike) && grid.exps.includes(selectionCurrent.expiry) ? selectionCurrent : null;
  const { onPin } = pin;
  useEffect(() => { onPin(null); return () => onPin(null); }, [root, data?.session, onPin]);
  function select(cell: MatrixCellSelection | null) {
    setSelection(cell && data ? { ...cell, session: data.session } : null);
    onPin(null);
  }
  const receipts = useMemo(() => data ? readMatrixReceipts(data) : null, [data]);
  const pendingReceipt = useMemo(() => {
    if (!snapshot.pending) return null;
    const r = readCompanionMatrix(snapshot.pending.data, root);
    if (!r.ok) return null;
    return readMatrixReceipts(r.value);
  }, [snapshot.pending, root]);
  const scopeToggleRef = useRef<HTMLButtonElement>(null);
  const inspectorHeadingRef = useRef<HTMLDivElement>(null);
  function focusInspector() {
    const heading = inspectorHeadingRef.current;
    if (!heading) return;
    heading.focus();
    heading.scrollIntoView({ block: "nearest" });
  }
  // Prefill the exact-mode fields from the APPLIED scope (preset or exact).
  function prefillExactFromApplied(): ExactDraft {
    if (appliedMode === "exact" && appliedExact) return { ...appliedExact };
    if (!data || !scopeGrid) return blankExact();
    const session = data.session;
    const last = scopeGrid.strikes[scopeGrid.strikes.length - 1];
    const first = scopeGrid.strikes[0];
    const firstExp = scopeGrid.exps[0];
    const lastExp = scopeGrid.exps[scopeGrid.exps.length - 1];
    return {
      from: last != null ? String(last) : "",
      to: first != null ? String(first) : "",
      dteMin: firstExp ? String(dteRaw(firstExp, session)) : "",
      dteMax: lastExp ? String(dteRaw(lastExp, session)) : "",
    };
  }
  function openScope() {
    setDraftPrefs(prefs);
    setDraftMode(appliedMode);
    setDraftExact(prefillExactFromApplied());
    setScopeOpen(true);
  }
  function cancelScope() {
    setDraftPrefs(prefs);
    setDraftMode(appliedMode);
    setDraftExact(appliedExact ?? blankExact());
    setScopeOpen(false);
    scopeToggleRef.current?.focus({ preventScroll: true });
  }
  function applyScope() {
    if (draftMode === "preset") {
      if (!samePrefs(draftPrefs, prefs)) onPrefs(draftPrefs);
      setAppliedMode("preset");
      setAppliedExact(null);
    } else if (data) {
      const fields = trimExact(draftExact);
      const domain = matrixAxisDomain(data.doc);
      const result = parseScopeBounds(fields, {
        session: data.session, strikes: domain.strikes, expiries: domain.expiries,
      });
      if (result.ok) {
        setAppliedMode("exact");
        setAppliedExact(fields);
      }
    }
    setScopeOpen(false);
    scopeToggleRef.current?.focus({ preventScroll: true });
  }
  function pickMode(next: ScopeMode) {
    setDraftMode(next);
    if (next === "exact") setDraftExact(prefillExactFromApplied());
  }
  function setExactField<K extends keyof ExactDraft>(key: K, value: string) {
    setDraftExact((previous) => ({ ...previous, [key]: value }));
  }
  const stats = useMemo(() => scopedDoc ? matrixExactScopeStats(scopedDoc, metric, windowPct, maxCols)
    : { total: null, knownTotal: null, missing: false, known: 0, expected: 0, domainBasis: "derived-grid" as const }, [scopedDoc, metric, windowPct, maxCols]);
  const units = t(metric === "gex" ? "unitsGex" : "contracts");
  const selectedCell = selectionCurrent ? data?.doc.cells?.find((cell) => cell.strike === selectionCurrent.strike && cell.expiry === selectionCurrent.expiry) : null;
  const selectedValue = selectedCell ? matrixCellValue(selectedCell, metric) : null;
  const selectedInScope = scopeGrid && selectionCurrent && scopeGrid.strikes.includes(selectionCurrent.strike)
    && scopeGrid.exps.includes(selectionCurrent.expiry) ? selectionCurrent : null;
  const selectionOutside = !!selectionCurrent && !selectedInScope;
  const selectionOffscreen = !!selectedInScope && !selectedVisible;
  const nodeContext = useMemo(() => selectedInScope && scopeGrid ? matrixSelectedNodeContext(scopeGrid, metric, selectedInScope) : null,
    [selectedInScope, scopeGrid, metric]);
  const structure = useMemo(() => scopeGrid ? matrixScopeStructure(scopeGrid, metric) : null, [scopeGrid, metric]);
  const signedMetric = metric === "gex" || metric === "doi";
  const memoryStrike = selectedInScope?.strike ?? structure?.dominant?.strike ?? null;
  const headline = metric === "gex" ? "scopeGex" : metric === "oi" ? "scopeOi" : metric === "doi" ? "scopeDoi" : "scopeVolume";
  const note = t(metric === "gex" ? "estimate" : metric === "vol" ? "volumeNote" : "oiNote");
  const scopeMeta = useMemo(() => {
    if (appliedMode === "exact" && parseApplied?.ok && data) {
      const expiries = parseApplied.expiries;
      const min = dteRaw(expiries[0], data.session);
      const max = dteRaw(expiries[expiries.length - 1], data.session);
      return `${parseApplied.value.from}–${parseApplied.value.to} · ${min}–${max} ${t("daysToExpiry")} · ${t(prefs.norm === "global" ? "global" : "column")}`;
    }
    return `${prefs.expiries === "0dte" ? "0DTE" : `${prefs.expiries} ${t("expiry")}`} · ±${prefs.window}% · ${t(prefs.norm === "global" ? "global" : "column")}`;
  }, [appliedMode, parseApplied, prefs.expiries, prefs.window, prefs.norm, data, t]);

  // Draft parse (drives the issue list and the Apply gate). Recomputed on every keystroke
  // while the editor is open in exact mode; not used at all in preset mode.
  const parseDraft = useMemo(() => {
    if (!scopeOpen || draftMode !== "exact" || !data) return null;
    const domain = matrixAxisDomain(data.doc);
    return parseScopeBounds(trimExact(draftExact), {
      session: data.session, strikes: domain.strikes, expiries: domain.expiries,
    });
  }, [scopeOpen, draftMode, data, draftExact]);

  const draftChanged = draftMode !== appliedMode
    || (draftMode === "preset" && !samePrefs(draftPrefs, prefs))
    || (draftMode === "exact" && (!appliedExact || !sameExact(appliedExact, draftExact)));
  const applyValid = draftMode === "exact" ? (parseDraft?.ok ?? false) : true;
  const applyDisabled = !draftChanged || !applyValid;

  // Map each BoundsIssue code to the input(s) it must mark invalid.
  const issueByField = useMemo(() => {
    const out = { from: false, to: false, min: false, max: false };
    if (!parseDraft || parseDraft.ok) return out;
    for (const code of parseDraft.issues) {
      if (code === "from_missing" || code === "from_not_number") out.from = true;
      else if (code === "to_missing" || code === "to_not_number") out.to = true;
      else if (code === "not_positive" || code === "inverted") { out.from = true; out.to = true; }
      else if (code === "dte_not_whole" || code === "dte_negative" || code === "dte_inverted") { out.min = true; out.max = true; }
      // session_invalid / no_strikes / no_expiries mark no input.
    }
    return out;
  }, [parseDraft]);
  const issueSentences = parseDraft && !parseDraft.ok
    ? parseDraft.issues.map((c) => t(ISSUE_KEY[c])).join(" ")
    : "";
  const previewText = parseDraft?.ok && data
    ? t("scopePreview")
        .replace("{strikes}", String(parseDraft.strikes.length))
        .replace("{expiries}", String(parseDraft.expiries.length))
        .replace("{min}", String(dteRaw(parseDraft.expiries[0], data.session)))
        .replace("{max}", String(dteRaw(parseDraft.expiries[parseDraft.expiries.length - 1], data.session)))
    : "";

  const scaleBasis = `${t("normalization")}: ${t(isSignedMetric(metric) ? "scaleRangeSigned" : "scaleRangeUnsigned")} · ${t(prefs.norm === "global" ? "scaleExtentGlobal" : "scaleExtentColumn")} · ${t("scaleCurve")}`;
  const coverageText = grid && scopeGrid
    ? t("coverage").replace("{shownStrikes}", String(grid.strikes.length)).replace("{scopeStrikes}", String(scopeGrid.strikes.length))
      .replace("{shownExpiries}", String(grid.exps.length)).replace("{scopeExpiries}", String(scopeGrid.nExpAll))
    : "";
  const unavailableText = t("receiptUnavailable");
  const renderReceipts = (r: typeof receipts) => {
    if (!r) return null;
    const row = (label: string, value: React.ReactNode, key: string) => (
      <div className={styles.receiptsRow} key={key}><dt>{label}</dt><dd>{value ?? unavailableText}</dd></div>
    );
    const buildTime = r.build ? <time dateTime={r.build}>{r.build}</time> : null;
    return <details className={styles.receipts} data-testid="options-receipts">
      <summary>{r.mixed && <span aria-hidden="true">⚠</span>}{t("receipts")}{r.mixed && <span className={styles.receiptsVisuallyHidden}>{t("receiptsMixedHidden")}</span>}</summary>
      <dl className={styles.receiptsList}>
        {row(t("receiptBuild"), buildTime, "build")}
        {row(t("receiptEod"), r.eod, "eod")}
        {row(t("receiptGreeks"), r.greeks, "greeks")}
        {row(t("receiptOiPublication"), r.oiPublication, "oi")}
        {r.previousOiPublication && row(t("receiptPreviousOiPublication"), r.previousOiPublication, "previousOi")}
        {r.latestOiPublication && row(t("receiptLatestOiPublication"), r.latestOiPublication, "latestOi")}
        {row(t("receiptSpotClock"), null, "spot")}
      </dl>
      {r.mixed && <p className={styles.receiptsMixed} data-testid="options-receipts-mixed">{t("receiptsMixed")}</p>}
    </details>;
  };
  const applyNewer = () => {
    snapshot.applyPending();
    select(null);
    setReveal(null);
  };

  // The exact scope failed to qualify against the current snapshot (typically because
  // a newer snapshot moved the session past every chosen expiry). Render a small
  // empty-state with an Edit-scope button; no total, no grid, never a zero.
  const exactScopeFailed = data != null && appliedMode === "exact" && parseApplied != null && !parseApplied.ok;
  const scopeEmptyIssues = exactScopeFailed && parseApplied && !parseApplied.ok
    ? parseApplied.issues.map((c) => <p key={c}>{t(ISSUE_KEY[c])}</p>)
    : null;

  return <>
    {data ? <SnapshotStamp session={data.session} t={t} refresh={snapshot.refresh} loading={snapshot.loading}>
      {renderReceipts(receipts)}
    </SnapshotStamp>
      : <SnapshotEmpty issue={receipt.ok ? "unavailable" : receipt.reason} fetchStatus={fetchStatus} t={t} loading={snapshot.loading} refresh={snapshot.refresh} />}
    {snapshot.pending && <div className={styles.newerSnapshot} data-testid="options-newer-snapshot" role="status">
      <span>{t("newerSnapshot")
        .replace("{session}", pendingReceipt?.session || unavailableText)
        .replace("{build}", pendingReceipt?.build ?? unavailableText)}</span>
      <button type="button" className={styles.action} data-testid="options-apply-newer" onClick={applyNewer}>{t("applyNewer")}</button>
    </div>}
    {snapshot.failed && data && <p className={styles.warning} role="status">{t("failed")}</p>}
    <div className={styles.scopeBar} data-options-scope={scopeOpen ? "editing" : "applied"} data-options-scope-mode={appliedMode}>
      <button ref={scopeToggleRef} type="button" className={styles.scopeButton} data-testid="options-scope-toggle" aria-expanded={scopeOpen} aria-controls="options-scope-editor"
        onClick={() => scopeOpen ? cancelScope() : openScope()}>{t("scope")}<span aria-hidden="true">{scopeOpen ? "×" : "⌄"}</span></button>
      <span className={styles.scopeMeta} data-testid="options-scope-meta">{scopeMeta}</span>
    </div>
    {scopeOpen && <form id="options-scope-editor" className={styles.scopeEditor} data-testid="options-scope-editor"
      onSubmit={(event) => { event.preventDefault(); applyScope(); }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelScope(); }
      }}>
      <fieldset className={styles.modeGroup}>
        <legend className={styles.modeLegend}>{t("modeLegend")}</legend>
        <div className={styles.modeOptions}>
          <label><input type="radio" name="options-scope-mode" data-testid="options-scope-mode-preset" checked={draftMode === "preset"} onChange={() => pickMode("preset")} />{t("presetScope")}</label>
          <label><input type="radio" name="options-scope-mode" data-testid="options-scope-mode-exact" checked={draftMode === "exact"} onChange={() => pickMode("exact")} />{t("exactScope")}</label>
        </div>
      </fieldset>
      <div className={styles.controls}>
        {draftMode === "preset" ? <>
          <label><span>{t("expiry")}</span><select data-testid="options-scope-expiries" aria-label={t("expiry")} value={draftPrefs.expiries} onChange={(e) => setDraftPrefs({ ...draftPrefs, expiries: e.target.value as MatrixPreferences["expiries"] })}>
            {["3", "6", "12"].map((n) => <option value={n} key={n}>{t("nearest")} {n}</option>)}<option value="0dte">{t("snapshot0dte")}</option>
          </select></label>
          <label><span>{t("strikes")}</span><select data-testid="options-scope-window" aria-label={t("strikes")} value={draftPrefs.window} onChange={(e) => setDraftPrefs({ ...draftPrefs, window: Number(e.target.value) as MatrixPreferences["window"] })}>
            {[3, 6, 12, 25].map((n) => <option value={n} key={n}>±{n}%</option>)}
          </select></label>
          <label><span>{t("normalization")}</span><select data-testid="options-scope-norm" aria-label={t("normalization")} value={draftPrefs.norm} onChange={(e) => setDraftPrefs({ ...draftPrefs, norm: e.target.value as MatrixNorm })}>
            <option value="global">{t("global")}</option><option value="column">{t("column")}</option>
          </select></label>
        </> : <div className={styles.exactGrid}>
          <label><span>{t("fromStrike")}</span><input type="text" inputMode="decimal" data-testid="options-scope-from" aria-label={t("fromStrike")} aria-invalid={issueByField.from ? "true" : "false"} aria-describedby={parseDraft && !parseDraft.ok ? "options-scope-issues" : undefined} value={draftExact.from} onChange={(e) => setExactField("from", e.target.value)} /></label>
          <label><span>{t("toStrike")}</span><input type="text" inputMode="decimal" data-testid="options-scope-to" aria-label={t("toStrike")} aria-invalid={issueByField.to ? "true" : "false"} aria-describedby={parseDraft && !parseDraft.ok ? "options-scope-issues" : undefined} value={draftExact.to} onChange={(e) => setExactField("to", e.target.value)} /></label>
          <label><span>{t("dteMinScope")}</span><input type="text" inputMode="numeric" data-testid="options-scope-dte-min" aria-label={t("dteMinScope")} aria-invalid={issueByField.min ? "true" : "false"} aria-describedby={parseDraft && !parseDraft.ok ? "options-scope-issues" : undefined} value={draftExact.dteMin} onChange={(e) => setExactField("dteMin", e.target.value)} /></label>
          <label><span>{t("dteMaxScope")}</span><input type="text" inputMode="numeric" data-testid="options-scope-dte-max" aria-label={t("dteMaxScope")} aria-invalid={issueByField.max ? "true" : "false"} aria-describedby={parseDraft && !parseDraft.ok ? "options-scope-issues" : undefined} value={draftExact.dteMax} onChange={(e) => setExactField("dteMax", e.target.value)} /></label>
        </div>}
      </div>
      {draftMode === "exact" && (parseDraft?.ok
        ? <p className={styles.scopeHint} data-testid="options-scope-preview">{previewText}</p>
        : <p className={styles.warning} data-testid="options-scope-issues" aria-live="polite" role="status">{issueSentences}</p>)}
      <p className={styles.scopeHint}>{t("pending")}</p>
      <div className={styles.scopeActions}>
        <button type="button" className={styles.link} data-testid="options-scope-cancel" onClick={cancelScope}>{t("cancel")}</button>
        <button type="submit" className={`${styles.action} ${styles.primaryAction}`} data-testid="options-scope-apply" disabled={applyDisabled}>{t("apply")}</button>
      </div>
    </form>}
    {exactScopeFailed && data ? (
      <div className={styles.empty} data-testid="options-scope-empty" role="status">
        <span aria-hidden="true" className={styles.emptyGlyph}>▦</span>
        <strong>{t("scopeEmptyTitle")}</strong>
        <p>{t("scopeEmptyBody")}</p>
        {scopeEmptyIssues}
        <button type="button" className={styles.action} onClick={openScope} data-testid="options-scope-edit">{t("editScope")}</button>
      </div>
    ) : data && grid && grid.strikes.length > 0 && grid.exps.length > 0 ? <>
      <div className={styles.summary}>
        <div><span>{t(headline)}</span><strong data-options-total className={metric === "gex" && stats.total != null ? (stats.total < 0 ? styles.negative : stats.total > 0 ? styles.positive : undefined) : undefined}>
          {stats.total == null ? "—" : fmtMatrixCell(stats.total, metric)}</strong><small title={stats.missing ? t("partial") : undefined}>{stats.expected ? `${stats.known}/${stats.expected} · ` : ""}{units}{stats.missing ? ` · ${t("publishedOnly")}` : ""}</small></div>
        <div className={styles.reference}><span>{t("reference")}</span><b>{grid.spotRef?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "—"}</b><small>{t("notIntraday")}</small></div>
      </div>
      {prefs.norm === "column" && <p className={styles.warning}>{t("columnNote")}</p>}
      <div className={styles.mapHost}><div className={styles.mapLayout} data-testid="options-map-layout">
        <div className={styles.mapColumn}>
          <div data-testid="options-map-grid">
            <StrikeExpiryMatrix grid={grid} metric={metric} variant="rail" rail={{ selected: selectedVisible, onSelect: select,
              reveal: reveal?.session === data.session ? reveal : null,
              name: `${root} ${t(headline)}`, strikeLabel: t("strike"), missingLabel: t("missing"), spotLabel: t("reference"), units }} />
          </div>
          <div className={styles.selectedSummary} data-testid="options-selected-summary">
            {selectionCurrent ? <>
              <strong>{selectionCurrent.strike} · {selectionCurrent.expiry} · {selectedValue == null ? t("missing") : fmtMatrixCell(selectedValue, metric)}</strong>
              <PinButton {...pin} root={root} strike={selectionCurrent.strike} session={data.session} label={`${t("strike")} ${selectionCurrent.strike} · EOD`} t={t} />
              <button type="button" className={styles.action} data-testid="options-inspect-node" onClick={focusInspector}>{t("inspectNode")}</button>
            </> : <strong>{t("select")}</strong>}
          </div>
          <div className={styles.legend}>
            <span className={metric === "gex" ? styles.positive : styles.neutral}>● {t(metric === "gex" ? "positiveGamma" : metric === "doi" ? "build" : "more")}</span>
            {(metric === "gex" || metric === "doi") && <span className={metric === "gex" ? styles.negative : styles.unwind}>● {t(metric === "gex" ? "negativeGamma" : "unwind")}</span>}
            <span>{t("magnitude")}</span>
            <span className={styles.missingKey} data-testid="options-missing-key"><i className={styles.missingSwatch} aria-hidden="true" />{t("missing")}<b>0</b>{t("measuredZero")}</span>
            <span data-testid="options-scale-basis">{scaleBasis}</span>
          </div>
          <p className={styles.coverage} data-testid="options-coverage">{coverageText}</p>
        </div>
        <div className={styles.inspector} data-options-inspector>
          {selectionCurrent ? <>
            <div className={styles.inspectorTitle} ref={inspectorHeadingRef} tabIndex={-1}><strong>{selectionCurrent.strike} · {selectionCurrent.expiry}</strong><b>{selectedValue == null ? "—" : fmtMatrixCell(selectedValue, metric)}</b></div>
            <p>{units} · {data.session}</p><p>{selectedValue == null ? t("missing") : note}</p>
            {selectionOutside && <><p className={styles.warning} data-testid="options-selection-outside">{t("outsideView")}</p><p>{t("contextUnavailable")}</p></>}
            {selectionOffscreen && selectedInScope && <div className={styles.warning} data-testid="options-selection-offscreen" role="status">
              <p>{t("outsideDisplayedRows")}</p><button type="button" className={styles.action} data-testid="options-reveal-selection"
                onClick={() => setReveal(previous => ({ id: (previous?.id ?? 0) + 1, session: data.session, cell: selectedInScope }))}>{t("revealSelection")}</button>
            </div>}
            {nodeContext && <section className={styles.nodeContext} aria-label={t("nodeContext")} data-testid="options-node-context">
              <span className={styles.nodeContextTitle}>{t("nodeContext")}</span>
              <div className={styles.nodeStats}>
                <div><span>{t("strikeTotal")}</span><b>{nodeContext.strikeTotal == null ? "—" : fmtMatrixCell(nodeContext.strikeTotal, metric)}</b></div>
                <div><span>{t("ex0dte")}</span><b>{nodeContext.ex0dteTotal == null ? "—" : fmtMatrixCell(nodeContext.ex0dteTotal, metric)}</b></div>
                <div><span>{t("scopeRank")}</span><b>{nodeContext.rank == null ? "—" : `#${nodeContext.rank} / ${nodeContext.scopeKnown}`}</b></div>
                <div><span>{t("strikeShare")}</span><b>{nodeContext.strikeSharePct == null ? "—" : `${nodeContext.strikeSharePct.toFixed(1)}%`}</b></div>
              </div>
              {nodeContext.strikeTotal == null && nodeContext.knownStrikeTotal != null && <p className={styles.warning} data-testid="options-node-partial">
                {t("strikeTotal")}: {t("knownSubtotal")} {fmtMatrixCell(nodeContext.knownStrikeTotal, metric)} · {nodeContext.strikeKnown}/{nodeContext.strikeExpected} {t("gridPositions")}. {t("totalIncomplete")}
              </p>}
              {nodeContext.ex0dteTotal == null && nodeContext.knownEx0dteTotal != null && <p className={styles.warning} data-testid="options-node-ex0dte-partial">
                {t("ex0dte")}: {t("knownSubtotal")} {fmtMatrixCell(nodeContext.knownEx0dteTotal, metric)} · {nodeContext.ex0dteKnown}/{nodeContext.ex0dteExpected} {t("gridPositions")}. {t("totalIncomplete")}
              </p>}
              <div className={styles.expiryMix}><span>{t("expiryMix")}</span>
                {nodeContext.expiryRows.map((row) => {
                  const width = row.value == null || nodeContext.maxStrikeAbs <= 0 ? 0 : Math.abs(row.value) / nodeContext.maxStrikeAbs * 50;
                  const barStyle = row.value == null ? undefined : row.value >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` };
                  return <div className={styles.expiryRow} key={row.expiry}>
                    <time dateTime={row.expiry}>{row.expiry.slice(5)}</time><span className={styles.expiryTrack} aria-hidden="true">
                      {row.value != null && row.value !== 0 && <i className={row.value > 0 ? styles.nodeBarPositive : styles.nodeBarNegative} style={barStyle} />}
                    </span><b>{row.value == null ? "—" : fmtMatrixCell(row.value, metric)}</b>
                  </div>;
                })}
              </div>
            </section>}
            <div className={styles.actions}><button type="button" onClick={() => select(null)} className={styles.link}>{t("clear")}</button></div>
          </> : <><strong>{t("select")}</strong><p>{t("keyboard")}</p></>}
        </div>
      </div></div>
      {stats.missing && stats.knownTotal != null && <p className={styles.warning} data-testid="options-scope-partial" role="status">
        {t("knownSubtotal")} {fmtMatrixCell(stats.knownTotal, metric)} · {stats.known}/{stats.expected} {t("gridPositions")}. {t("totalIncomplete")}
      </p>}
      <p className={styles.scopeHint} data-testid="options-domain-basis">{t(stats.domainBasis === "declared-grid" ? "declaredGrid" : "derivedGrid")} · {t("sourceCoverageUnknown")}</p>
      {structure?.dominant && <section className={styles.scopeBrief} aria-label={t("structureBrief")} data-testid="options-scope-structure">
        <span className={styles.scopeBriefTitle}>{t("structureBrief")}</span>
        <div className={styles.scopeBriefGrid}>
          <button type="button" data-testid="options-dominant-node" data-strike={structure.dominant.strike} data-expiry={structure.dominant.expiry}
            aria-pressed={selectionCurrent?.strike === structure.dominant.strike && selectionCurrent?.expiry === structure.dominant.expiry}
            aria-label={`${t("inspectNode")} ${structure.dominant.strike} ${structure.dominant.expiry}`}
            onClick={() => select({ strike: structure.dominant!.strike, expiry: structure.dominant!.expiry })}>
            <span>{t("dominantNode")}</span><b>{structure.dominant.strike} · {structure.dominant.expiry.slice(5)}</b>
            <small className={structure.dominant.value < 0 ? styles.negative : styles.positive}>{fmtMatrixCell(structure.dominant.value, metric)}</small>
            {structure.dominant.distancePct != null && <em>{structure.dominant.distancePct >= 0 ? "+" : ""}{structure.dominant.distancePct.toFixed(1)}% {t("vsSpot")}</em>}
          </button>
          {signedMetric ? structure.opposing ? <button type="button" data-testid="options-opposing-node" data-strike={structure.opposing.strike} data-expiry={structure.opposing.expiry}
            aria-pressed={selectionCurrent?.strike === structure.opposing.strike && selectionCurrent?.expiry === structure.opposing.expiry}
            aria-label={`${t("inspectNode")} ${structure.opposing.strike} ${structure.opposing.expiry}`}
            onClick={() => select({ strike: structure.opposing!.strike, expiry: structure.opposing!.expiry })}>
            <span>{t("opposingNode")}</span><b>{structure.opposing.strike} · {structure.opposing.expiry.slice(5)}</b>
            <small className={structure.opposing.value < 0 ? styles.negative : styles.positive}>{fmtMatrixCell(structure.opposing.value, metric)}</small>
            {structure.opposing.distancePct != null && <em>{structure.opposing.distancePct >= 0 ? "+" : ""}{structure.opposing.distancePct.toFixed(1)}% {t("vsSpot")}</em>}
          </button> : <div className={styles.scopeBriefCard}><span>{t("opposingNode")}</span><b>—</b></div>
            : <div className={styles.scopeBriefCard}><span>{t("scopeCells")}</span><b>{stats.known} / {stats.expected}</b><small>{units}</small></div>}
          <div className={styles.scopeBriefCard}><span>{t("expiryLead")}</span><b>{structure.leadingExpiry?.expiry.slice(5) ?? "—"}</b>
            <small>{structure.leadingExpiry ? `${structure.leadingExpiry.sharePct.toFixed(1)}% ${t("cellShare")}` : "—"}</small></div>
        </div>
      </section>}
      {metric === "gex" && <GexMarketMemory root={root} matrixSession={data.session} strike={memoryStrike} t={t} />}
      <details className={styles.method}><summary>{t("basis")}</summary>
        <p>{note}</p>{metric === "gex" && <p>{t("model")}</p>}<p>{t("scaleNote")}</p>
        {stats.missing && <p className={styles.warning}>{t("partial")}</p>}
        <p>{grid.exps.length} / {grid.nExpAll} {t("visible")} · {grid.strikes.length} / {grid.nAll} {t("strike")}</p>
      </details>
    </> : data && <p className={styles.empty}>{t(prefs.expiries === "0dte" ? "noExpiry" : "unavailableBody")}</p>}
    {host === "rail" && <a className={styles.deskLink} href="/options?tab=prism">{t("expand")} ↗</a>}
  </>;
}
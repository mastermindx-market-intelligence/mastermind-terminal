"use client";
import { useEffect, useMemo, useState } from "react";
import { StrikeExpiryMatrix, buildMatrixGrid, matrixExactScopeStats, matrixCellValue, fmtMatrixCell,
  type MatrixCellSelection, type MatrixDisplayMetric, type MatrixNorm } from "@/components/shared/StrikeExpiryMatrix";
import { readCompanionMatrix, matrixForExpiry, type CompanionIssue, type OptionsChartLevel } from "@/lib/optionsCompanion";
import { useOptionsSnapshot } from "./useOptionsSnapshot";
import { type OptionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

export interface MatrixPreferences { expiries: "3" | "6" | "12" | "0dte"; window: 3 | 6 | 12 | 25; norm: MatrixNorm }
export interface PinProps { pinned: OptionsChartLevel | null; onPin: (level: OptionsChartLevel | null) => void; replayActive: boolean }
const samePrefs = (a: MatrixPreferences, b: MatrixPreferences) =>
  a.expiries === b.expiries && a.window === b.window && a.norm === b.norm;

export function SnapshotStamp({ session, t, refresh, loading }: { session: string; t: OptionsT; refresh: () => void; loading: boolean }) {
  return <div className={styles.receipt} data-options-session={session}>
    <strong>{t("eod")}</strong><time dateTime={session}>{session}</time>
    <button type="button" onClick={refresh} disabled={loading} aria-label={t("refresh")} title={t("refresh")}>↻</button>
  </div>;
}
export function SnapshotEmpty({ issue = "unavailable", t, loading, refresh }: {
  issue?: CompanionIssue; t: OptionsT; loading: boolean; refresh: () => void;
}) {
  return <div className={styles.empty} role="status">
    <span aria-hidden="true" className={styles.emptyGlyph}>▦</span>
    <strong>{t(loading ? "loading" : "unavailable")}</strong>
    {!loading && <><p>{t(issue === "unavailable" ? "unavailableBody" : issue)}</p><button type="button" className={styles.action} onClick={refresh}>{t("refresh")}</button></>}
  </div>;
}
export function PinButton({ root, strike, session, label, pinned, onPin, replayActive, t }: PinProps & {
  root: string; strike: number; session: string; label: string; t: OptionsT;
}) {
  const isPinned = pinned?.root === root && pinned.price === strike && pinned.session === session;
  return <button type="button" className={styles.action} disabled={replayActive}
    aria-pressed={isPinned} onClick={() => onPin(isPinned ? null : { root, price: strike, session, label })}>
    {t(isPinned ? "unpin" : "pin")}
  </button>;
}

export function MatrixCompanion({ root, metric, prefs, onPrefs, t, ...pin }: PinProps & {
  root: string; metric: MatrixDisplayMetric; prefs: MatrixPreferences; onPrefs: (prefs: MatrixPreferences) => void; t: OptionsT;
}) {
  const snapshot = useOptionsSnapshot(`matrix:${root}`);
  const receipt = useMemo(() => readCompanionMatrix(snapshot.data, root), [snapshot.data, root]);
  const data = receipt.ok ? receipt.value : null;
  const grid = useMemo(() => data ? buildMatrixGrid({ matrix: matrixForExpiry(data, prefs.expiries === "0dte" ? "0dte" : "all"),
    metric, maxCols: prefs.expiries === "0dte" ? 1 : Number(prefs.expiries), windowPct: prefs.window,
    maxRows: 101, exactStrikes: true, normalization: prefs.norm, scope: "all", withSigma: true }) : null,
  [data, metric, prefs.expiries, prefs.norm, prefs.window]);
  const [selection, setSelection] = useState<(MatrixCellSelection & { session: string }) | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<MatrixPreferences>(prefs);
  const selectionCurrent = selection && selection.session === data?.session ? selection : null;
  const selectedVisible = grid && selectionCurrent
    && grid.strikes.includes(selectionCurrent.strike) && grid.exps.includes(selectionCurrent.expiry) ? selectionCurrent : null;
  const selectionOutside = !!selectionCurrent && !selectedVisible;
  const { onPin } = pin;
  useEffect(() => { onPin(null); return () => onPin(null); }, [root, data?.session, onPin]);
  function select(cell: MatrixCellSelection | null) {
    setSelection(cell && data ? { ...cell, session: data.session } : null);
    onPin(null);
  }
  function openScope() { setDraftPrefs(prefs); setScopeOpen(true); }
  function cancelScope() { setDraftPrefs(prefs); setScopeOpen(false); }
  function applyScope() { if (!samePrefs(draftPrefs, prefs)) onPrefs(draftPrefs); setScopeOpen(false); }
  const stats = useMemo(() => data ? matrixExactScopeStats(
    matrixForExpiry(data, prefs.expiries === "0dte" ? "0dte" : "all"), metric, prefs.window,
    prefs.expiries === "0dte" ? 1 : Number(prefs.expiries),
  ) : { total: null, missing: false, known: 0, expected: 0 }, [data, metric, prefs]);
  const units = t(metric === "gex" ? "unitsGex" : "contracts");
  const selectedCell = selectionCurrent ? data?.doc.cells?.find((cell) => cell.strike === selectionCurrent.strike && cell.expiry === selectionCurrent.expiry) : null;
  const selectedValue = selectedCell ? matrixCellValue(selectedCell, metric) : null;
  const headline = metric === "gex" ? "scopeGex" : metric === "oi" ? "scopeOi" : metric === "doi" ? "scopeDoi" : "scopeVolume";
  const note = t(metric === "gex" ? "estimate" : metric === "vol" ? "volumeNote" : "oiNote");
  const scopeMeta = `${prefs.expiries === "0dte" ? "0DTE" : `${prefs.expiries} ${t("expiry")}`} · ±${prefs.window}% · ${t(prefs.norm === "global" ? "global" : "column")}`;
  const draftChanged = !samePrefs(draftPrefs, prefs);

  return <>
    {data ? <SnapshotStamp session={data.session} t={t} refresh={snapshot.refresh} loading={snapshot.loading} />
      : <SnapshotEmpty issue={receipt.ok ? "unavailable" : receipt.reason} t={t} loading={snapshot.loading} refresh={snapshot.refresh} />}
    {snapshot.failed && data && <p className={styles.warning} role="status">{t("failed")}</p>}
    <div className={styles.scopeBar} data-options-scope={scopeOpen ? "editing" : "applied"}>
      <button type="button" className={styles.scopeButton} data-testid="options-scope-toggle" aria-expanded={scopeOpen} aria-controls="options-scope-editor"
        onClick={() => scopeOpen ? cancelScope() : openScope()}>{t("scope")}<span aria-hidden="true">{scopeOpen ? "×" : "⌄"}</span></button>
      <span className={styles.scopeMeta}>{scopeMeta}</span>
    </div>
    {scopeOpen && <form id="options-scope-editor" className={styles.scopeEditor} data-testid="options-scope-editor"
      onSubmit={(event) => { event.preventDefault(); applyScope(); }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelScope(); }
      }}>
      <div className={styles.controls}>
        <label><span>{t("expiry")}</span><select data-testid="options-scope-expiries" aria-label={t("expiry")} value={draftPrefs.expiries} onChange={(e) => setDraftPrefs({ ...draftPrefs, expiries: e.target.value as MatrixPreferences["expiries"] })}>
          {["3", "6", "12"].map((n) => <option value={n} key={n}>{t("nearest")} {n}</option>)}<option value="0dte">{t("snapshot0dte")}</option>
        </select></label>
        <label><span>{t("strikes")}</span><select data-testid="options-scope-window" aria-label={t("strikes")} value={draftPrefs.window} onChange={(e) => setDraftPrefs({ ...draftPrefs, window: Number(e.target.value) as MatrixPreferences["window"] })}>
          {[3, 6, 12, 25].map((n) => <option value={n} key={n}>±{n}%</option>)}
        </select></label>
        <label><span>{t("normalization")}</span><select data-testid="options-scope-norm" aria-label={t("normalization")} value={draftPrefs.norm} onChange={(e) => setDraftPrefs({ ...draftPrefs, norm: e.target.value as MatrixNorm })}>
          <option value="global">{t("global")}</option><option value="column">{t("column")}</option>
        </select></label>
      </div>
      <p className={styles.scopeHint}>{t("pending")}</p>
      <div className={styles.scopeActions}>
        <button type="button" className={styles.link} data-testid="options-scope-cancel" onClick={cancelScope}>{t("cancel")}</button>
        <button type="submit" className={`${styles.action} ${styles.primaryAction}`} data-testid="options-scope-apply" disabled={!draftChanged}>{t("apply")}</button>
      </div>
    </form>}
    {data && grid && grid.strikes.length > 0 && grid.exps.length > 0 ? <>
      <div className={styles.summary}>
        <div><span>{t(headline)}</span><strong data-options-total className={metric === "gex" ? (Number(stats.total) < 0 ? styles.negative : styles.positive) : undefined}>
          {stats.total == null ? "—" : fmtMatrixCell(stats.total, metric)}</strong><small title={stats.missing ? t("partial") : undefined}>{stats.expected ? `${stats.known}/${stats.expected} · ` : ""}{units}{stats.missing ? ` · ${t("publishedOnly")}` : ""}</small></div>
        <div className={styles.reference}><span>{t("reference")}</span><b>{grid.spotRef?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "—"}</b><small>{t("notIntraday")}</small></div>
      </div>
      <div className={styles.legend}>
        <span className={metric === "gex" ? styles.positive : styles.neutral}>● {t(metric === "gex" ? "positive" : metric === "doi" ? "build" : "more")}</span>
        {(metric === "gex" || metric === "doi") && <span className={metric === "gex" ? styles.negative : styles.unwind}>● {t(metric === "gex" ? "negative" : "unwind")}</span>}
        <span>{t("magnitude")}</span>
      </div>
      {prefs.norm === "column" && <p className={styles.warning}>{t("columnNote")}</p>}
      <StrikeExpiryMatrix grid={grid} metric={metric} variant="rail" rail={{ selected: selectedVisible, onSelect: select,
        name: `${root} ${t(headline)}`, strikeLabel: t("strike"), missingLabel: t("missing"), spotLabel: t("reference"), units }} />
      <div className={styles.inspector} data-options-inspector>
        {selectionCurrent ? <>
          <div className={styles.inspectorTitle}><strong>{selectionCurrent.strike} · {selectionCurrent.expiry}</strong><b>{selectedValue == null ? "—" : fmtMatrixCell(selectedValue, metric)}</b></div>
          <p>{units} · {data.session}</p><p>{selectedValue == null ? t("missing") : note}</p>
          {selectionOutside && <p className={styles.warning} data-testid="options-selection-outside">{t("outsideView")}</p>}
          <div className={styles.actions}><PinButton {...pin} root={root} strike={selectionCurrent.strike} session={data.session} label={`${t("strike")} ${selectionCurrent.strike} · EOD`} t={t} />
            <button type="button" onClick={() => select(null)} className={styles.link}>{t("clear")}</button></div>
        </> : <><strong>{t("select")}</strong><p>{t("keyboard")}</p></>}
      </div>
      <details className={styles.method}><summary>{t("basis")}</summary>
        <p>{note}</p>{metric === "gex" && <p>{t("model")}</p>}<p>{t("scaleNote")}</p>
        {stats.missing && <p className={styles.warning}>{t("partial")}</p>}
        <p>{grid.exps.length} / {grid.nExpAll} {t("visible")} · {grid.strikes.length} / {grid.nAll} {t("strike")}</p>
      </details>
    </> : data && <p className={styles.empty}>{t(prefs.expiries === "0dte" ? "noExpiry" : "unavailableBody")}</p>}
    <a className={styles.deskLink} href="/options?tab=prism">{t("expand")} ↗</a>
  </>;
}

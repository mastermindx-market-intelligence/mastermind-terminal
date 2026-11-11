"use client";

import { useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, Ref } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import {
  cellFocusSelector,
  cellIntensity,
  FLOW_WINDOW_LABEL,
  phoneModel,
  tableModel,
  windowHeaderOf,
  type FlowCell,
  type FlowWindow,
  type FlowsData,
} from "@/lib/sectorDepthFlows";
import { DepthUnavailable } from "./DepthUnavailable";
import styles from "./SectorFlowMatrix.module.css";

/** Heat tint ceiling: the strongest cell in a window mixes at most this much
 * of its direction token into the panel — present without drowning the text. */
const MAX_HEAT_PCT = 46;

type DepthT = ReturnType<typeof useSectorDepthT>;

/** The ETF cell the reader has selected (F03): null until a cell is clicked or
 * arrowed onto. Only ETF rows participate — the net row is a total, not a fund. */
interface CellSel {
  ticker: string;
  window: FlowWindow;
}

/** Column header for one window. A window is partial when the collected
 * history is still shorter than its full length OR the carried block's owner
 * states full_window:false — either way the header shows the effective day
 * count visibly (siFlowsWindowDays {n}) so a partial window can never
 * masquerade as a full one. Uses windowHeaderOf — the same law the cells
 * use — so headers and cells can never disagree. */
function windowHead(w: FlowWindow, flows: FlowsData, t: DepthT): {
  id: string;
  cappedSuffix: string | null;
  aria: string;
} {
  const { days, full, capped } = windowHeaderOf(w, flows);
  const label = FLOW_WINDOW_LABEL[w];
  const fullLabel = t("siFlowsWindowDays", { n: full });
  const effLabel = t("siFlowsWindowDays", { n: days });
  return {
    id: label,
    cappedSuffix: capped ? effLabel : null,
    aria: capped ? `${label}, ${effLabel}` : `${label}, ${fullLabel}`,
  };
}

/** Sector-ETF fund-flow matrix — display-only depth surface. The heat view and
 * the exact-value table are two projections of one tableModel, so they cannot
 * disagree; on phones (≤760px) the matrix gives way to a picker plus the
 * selected ETF's five exact window values. Null is a missing reading and 0 is
 * a measured number — both surfaces keep them visibly distinct. */
export function SectorFlowMatrix({
  flows,
  captureRef,
}: {
  /** Flow payload from the Macro sector generation; null means this reading
   * does not carry the capability and nothing is invented in its place. */
  flows: FlowsData | null;
  /** No outbound navigation exists on this surface. The prop is typed `never`
   * so an accidental wiring fails to compile instead of dead-ending silently. */
  onNavigate?: never;
  /** Passed through to the root section for evidence capture. */
  captureRef?: Ref<HTMLElement>;
}) {
  const t = useSectorDepthT();
  const { lang } = useLang();
  const [view, setView] = useState<"heat" | "table">("heat");
  const [picked, setPicked] = useState<string | null>(null);
  const [sel, setSel] = useState<CellSel | null>(null);

  if (flows === null) {
    return (
      <DepthUnavailable
        field="etf_flows"
        owner="macro_sector_generation"
        title={t("siFlowsTitle")}
      />
    );
  }

  const model = tableModel(flows);
  const phone = phoneModel(flows, picked ?? undefined);
  const nWindows = model.windows.length;

  const nameOf = (name: string, nameZh?: string): string =>
    lang === "zh" && nameZh ? nameZh : name;

  const coverageHeader = t("siFlowsColCoverage");

  /* ── F03 selected cell: roving focus over the 11 × 5 ETF grid ─────────────
   * Arrow keys move between data cells; the selected cell keeps a visible ring
   * and drives the readout line under the matrix. The net row never
   * participates — it is a total, not a fund. */
  const tickers = model.rows.map((r) => r.ticker);
  const selCell =
    sel === null
      ? null
      : (model.rows
          .find((r) => r.ticker === sel.ticker)
          ?.cells.find((c) => c.window === sel.window) ?? null);

  /** N7: the cell selector is built by cellFocusSelector (lib), which escapes
   * the ticker for a quoted attribute value — or a ticker containing `"`
   * throws inside the rAF callback. The window id is a closed enum. */
  const focusCell = (next: CellSel): void => {
    setSel(next);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLTableCellElement>(cellFocusSelector(next.ticker, next.window))
        ?.focus();
    });
  };

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!tickers.length) return;
    const curTicker = sel?.ticker ?? tickers[0];
    const curWindow = sel?.window ?? model.windows[0];
    const r = Math.max(0, tickers.indexOf(curTicker));
    const c = Math.max(0, model.windows.indexOf(curWindow));
    let nr = r;
    let nc = c;
    if (event.key === "ArrowUp") nr = r - 1;
    else if (event.key === "ArrowDown") nr = r + 1;
    else if (event.key === "ArrowLeft") nc = c - 1;
    else if (event.key === "ArrowRight") nc = c + 1;
    else if (event.key === "Home") nc = 0;
    else if (event.key === "End") nc = model.windows.length - 1;
    else return;
    event.preventDefault();
    nr = Math.min(tickers.length - 1, Math.max(0, nr));
    nc = Math.min(model.windows.length - 1, Math.max(0, nc));
    focusCell({ ticker: tickers[nr], window: model.windows[nc] });
  };

  const selReadout = (): ReactNode => {
    if (!sel || !selCell) return null;
    const row = model.rows.find((r) => r.ticker === sel.ticker);
    return (
      <p className={styles.readout} data-readout="true" aria-live="polite">
        {t("siFlowsReadout", {
          etf: `${sel.ticker} ${nameOf(row?.name ?? "", row?.nameZh)}`.trim(),
          window: FLOW_WINDOW_LABEL[sel.window],
          days: selCell.days,
          asof: flows.asof,
          value: selCell.text,
          // A missing reading names its state, never a direction word.
          dir: selCell.missing
            ? t("siFlowsCellMissing")
            : t(selCell.sign === "down" ? "siFlowsDirOut" : "siFlowsDirIn"),
        })}
      </p>
    );
  };

  /** One cell's body: the exact formatted value, with the zero/missing
   * distinction spoken alongside the visible glyph. */
  const cellBody = (cell: FlowCell): ReactNode => (
    <>
      <span className={styles.val}>{cell.text}</span>
      {cell.missing ? (
        <span className={styles.srOnly}>, {t("siFlowsCellMissing")}</span>
      ) : null}
      {cell.zero ? (
        <span className={styles.srOnly}>, {t("siFlowsCellZero")}</span>
      ) : null}
    </>
  );

  /** Heat tint: hue is owned by data-sign in CSS on the direction tokens
   * (var(--up)/var(--down) — the east red-up flip is token-level); only the
   * intensity arrives here, as an inline --heat percentage derived from the
   * per-window ETF-only scale. The net row is never tinted. */
  const heatStyle = (cell: FlowCell, scale: number): CSSProperties | undefined => {
    if (cell.sign === null) return undefined;
    const intensity = cellIntensity(cell.value, scale);
    return { "--heat": `${Math.round(intensity * MAX_HEAT_PCT)}%` } as CSSProperties;
  };

  const renderCells = (
    cells: FlowCell[],
    opts: { heat: boolean; net: boolean; ticker?: string },
  ): ReactNode =>
    cells.map((cell) => {
      const isSel =
        opts.ticker !== undefined &&
        sel !== null &&
        sel.ticker === opts.ticker &&
        sel.window === cell.window;
      // Roving tabindex: exactly one ETF cell sits in the tab order — the
      // selected one, or the first data cell before anything is selected.
      const isTabStop =
        isSel ||
        (sel === null &&
          opts.ticker === tickers[0] &&
          cell.window === model.windows[0]);
      return (
        <td
          key={cell.window}
          className={styles.cell}
          data-sign={cell.sign ?? undefined}
          data-missing={cell.missing || undefined}
          data-zero={cell.zero || undefined}
          data-sel={isSel || undefined}
          data-cell-ticker={opts.ticker}
          data-cell-window={opts.ticker !== undefined ? cell.window : undefined}
          tabIndex={opts.ticker !== undefined ? (isTabStop ? 0 : -1) : undefined}
          onClick={
            opts.ticker !== undefined
              ? () => setSel({ ticker: opts.ticker as string, window: cell.window })
              : undefined
          }
          style={
            opts.heat && !opts.net
              ? heatStyle(cell, model.scale[cell.window])
              : undefined
          }
        >
          {cellBody(cell)}
        </td>
      );
    });

  const renderHead = (withCoverage: boolean): ReactNode => (
    <thead>
      <tr>
        <th scope="col" className={`${styles.colHead} ${styles.colEtf}`} />
        {model.windows.map((w) => {
          const h = windowHead(w, flows, t);
          return (
            <th key={w} scope="col" className={styles.colHead} aria-label={h.aria}>
              <span className={styles.windowId}>{h.id}</span>
              {h.cappedSuffix ? (
                <span className={styles.cappedDays}>· {h.cappedSuffix}</span>
              ) : null}
            </th>
          );
        })}
        {withCoverage ? (
          <th
            scope="col"
            className={`${styles.colHead} ${styles.colCoverage}`}
          >
            {coverageHeader}
          </th>
        ) : null}
      </tr>
    </thead>
  );

  const renderRows = (heat: boolean, withCoverage: boolean): ReactNode => (
    <>
      {model.rows.map((row) => (
        <tr key={row.ticker}>
          <th scope="row" className={styles.rowHead}>
            <span className={styles.ticker}>{row.ticker}</span>
            {/* The v1.1 carried block provides tickers only; the name line is
                rendered when a source carries one and never invented. */}
            {row.name ? (
              <span className={styles.rowName}>{nameOf(row.name, row.nameZh)}</span>
            ) : null}
          </th>
          {renderCells(row.cells, { heat, net: false, ticker: row.ticker })}
          {withCoverage ? (
            <td className={styles.coverageCell}>
              {t("siFlowsRowCoverage", {
                measured: row.coverage,
                windows: nWindows,
              })}
            </td>
          ) : null}
        </tr>
      ))}
      <tr className={styles.netRow}>
        <th scope="row" className={styles.rowHead}>
          <span className={styles.netLabel}>{t("siFlowsNetRow")}</span>
        </th>
        {renderCells(model.net.cells, { heat, net: true })}
        {withCoverage ? (
          <td className={styles.coverageCell}>
            {t("siFlowsRowCoverage", {
              measured: model.net.coverage,
              windows: nWindows,
            })}
          </td>
        ) : null}
      </tr>
    </>
  );

  const renderTable = (heat: boolean): ReactNode => (
    <div
      className={styles.scrollX}
      role="region"
      aria-label={t("siFlowsTitle")}
      tabIndex={0}
      onKeyDown={onGridKeyDown}
    >
      <table className={styles.grid} data-view={heat ? "heat" : "exact"}>
        <caption className={styles.srOnly}>
          {`${t("siFlowsTitle")} — ${
            heat ? t("siFlowsChart") : t("siFlowsTable")
          }`}
        </caption>
        {renderHead(!heat)}
        <tbody>{renderRows(heat, !heat)}</tbody>
      </table>
    </div>
  );

  return (
    <section className={styles.root} aria-label={t("siFlowsTitle")} ref={captureRef}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h3 className={styles.title}>{t("siFlowsTitle")}</h3>
          <p className={styles.sub}>{t("siFlowsSub")}</p>
        </div>
        <div className={styles.headMeta}>
          <span className={styles.badge}>{t("siDepthDisplayOnly")}</span>
          <p className={styles.clock}>
            {t("siFlowsSourceClock", { asof: flows.asof, depth: flows.depth })}
          </p>
        </div>
      </header>

      <p className={styles.note}>{t("siFlowsNote", { depth: flows.depth })}</p>

      <div className={styles.controls}>
        <div className={styles.toggle}>
          <button
            type="button"
            className={styles.toggleBtn}
            aria-pressed={view === "heat"}
            onClick={() => setView("heat")}
          >
            {t("siFlowsChart")}
          </button>
          <button
            type="button"
            className={styles.toggleBtn}
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            {t("siFlowsTable")}
          </button>
        </div>
        {/* Unit legend stays visible beside the values on every layout. */}
        <span className={styles.unitLegend}>{t("siFlowsUnitsMn")}</span>
      </div>

      <div className={styles.matrixArea}>
        {view === "heat" ? renderTable(true) : renderTable(false)}
      </div>

      {/* F03: the selected cell's readout, then the standing hint. The hint
          doubles as the tint disclosure — tint is relative WITHIN each window. */}
      {selReadout()}
      <p className={styles.matrixHint}>{t("siFlowsMatrixHint")}</p>

      <div className={styles.phone}>
        {phone ? (
          <>
            <div className={styles.picker}>
              {phone.pickers.map((p) => (
                <button
                  type="button"
                  key={p.ticker}
                  className={styles.chip}
                  aria-pressed={p.ticker === phone.selectedTicker}
                  onClick={() => setPicked(p.ticker)}
                >
                  {p.ticker}
                </button>
              ))}
            </div>
            <h4 className={styles.selected}>
              {phone.selectedName && phone.selectedName !== phone.selectedTicker ? (
                t("siFlowsSelectedEtf", {
                  ticker: phone.selectedTicker,
                  name: nameOf(phone.selectedName, phone.selectedNameZh),
                })
              ) : (
                phone.selectedTicker
              )}
            </h4>
            <ul className={styles.windowList}>
              {phone.windows.map((w) => (
                <li
                  key={w.window}
                  className={styles.windowItem}
                  data-window-value={w.window}
                  data-sign={w.sign ?? undefined}
                  data-missing={w.missing || undefined}
                  data-zero={w.zero || undefined}
                >
                  <span className={styles.windowLabel}>
                    {FLOW_WINDOW_LABEL[w.window]}
                    {w.capped
                      ? ` · ${t("siFlowsWindowDays", { n: w.days })}`
                      : ""}
                  </span>
                  <span className={styles.phoneVal}>
                    {w.text} <span className={styles.unit}>{t(w.unitsKey)}</span>
                  </span>
                  {w.missing ? (
                    <span className={styles.stateLine}>
                      {t("siFlowsCellMissing")}
                    </span>
                  ) : null}
                  {w.zero ? (
                    <span className={styles.stateLine}>
                      {t("siFlowsCellZero")}
                    </span>
                  ) : null}
                  {w.participationPct !== undefined ? (
                    <span className={styles.partLine}>
                      {t("siFlowsParticipation", {
                        pct: w.participationPct,
                        window: FLOW_WINDOW_LABEL[w.window],
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className={styles.coverageLine}>
              {t("siFlowsRowCoverage", {
                measured: phone.coverage,
                windows: phone.windows.length,
              })}
            </p>
          </>
        ) : (
          <p className={styles.stateLine}>{t("siFlowsCellMissing")}</p>
        )}
      </div>
    </section>
  );
}

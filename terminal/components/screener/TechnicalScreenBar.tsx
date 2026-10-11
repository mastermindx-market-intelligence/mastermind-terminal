"use client";
// ── Screener technical screen (E01) ─────────────────────────────────────────────
// Controls + coverage disclosure for the timeframe-specific technical screen. Presentation only:
// the predicates come from lib/technicalScreenControls (the one controls → TechnicalScreen map),
// the populations from lib/technicalScan's classifier, the read from lib/useTechnicalScan. This
// component never classifies, infers or ranks — it renders what those modules decided.
//
// Four read states stay distinct (failure-state-truth law): loading, absent (no generation was
// ever published), error (could not read it), and a ready scan — which itself may be incomplete,
// held over a newer incomplete one, or a copy whose refresh failed, and says so.

import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import { COVERAGE_STATUSES, type CoverageAccount, type CoverageStatus } from "@/lib/screenerScan";
import { TF_CANONICAL_ORDER, DAILY_FUNCTIONAL_TIMEFRAMES } from "@/lib/startTf";
import { technicalReasonLabel, technicalSignalLabel, useTechnicalT } from "@/lib/technicalScanLex";
import {
  TECH_BARS_MAX,
  TECH_CHIPS,
  TECH_CHIP_IDS,
  TECH_DEFAULT_CONTROLS,
  TECH_SIGNAL_PICKS,
  techControlsActive,
  toggleTechChip,
  type TechControls,
  type TechSignalPick,
} from "@/lib/technicalScreenControls";
import type { TechnicalClassification } from "@/lib/technicalScan";
import type { TechnicalScanState } from "@/lib/useTechnicalScan";
import styles from "./TechnicalScreenBar.module.css";

const STATUS_KEY: Record<CoverageStatus, string> = {
  evaluated: "tsEvaluated",
  stale: "tsStale",
  unsupported: "tsUnsupported",
  unavailable: "tsUnavailable",
};

const WARN = { "--c": "var(--warn)" } as React.CSSProperties;
const INFO = { "--c": "var(--brand-2)" } as React.CSSProperties;

/** "{n} requested" with the numeral in a <b> (tabular nums), as the Screener's result line. */
function withNumber(tpl: string, n: number) {
  const i = tpl.indexOf("{n}");
  const s = n.toLocaleString();
  if (i < 0) return <>{tpl}</>;
  return <>{tpl.slice(0, i)}<b>{s}</b>{tpl.slice(i + 3)}</>;
}

export type TechnicalScreenBarProps = {
  open: boolean;
  onToggle: () => void;
  scan: TechnicalScanState & { retry: () => void };
  controls: TechControls;
  onControls: (next: TechControls) => void;
  /** Coverage over the REQUESTED universe (rows admitted by every other filter); null until a
   *  ready scan is held. */
  summary: { account: CoverageAccount; forming: number } | null;
  /** Names hidden because they were not evaluated at the timeframe (never silently dropped). */
  hiddenUnknown: number;
};

export default function TechnicalScreenBar({ open, onToggle, scan, controls, onControls, summary, hiddenUnknown }: TechnicalScreenBarProps) {
  const tt = useTechnicalT();
  const { lang } = useLang();
  const source = scan.phase === "settled" ? scan.source : null;
  const ready = source?.kind === "ready" ? source : null;
  const produced = ready ? ready.scan.timeframes : null;

  // The chart's daily timeframes are always offered (so an unproduced one can be CHOSEN and shown
  // as unsupported — the falsifier path), plus anything the scan produced, in canonical order.
  const tfOptions = useMemo(
    () => TF_CANONICAL_ORDER.filter((tf) => DAILY_FUNCTIONAL_TIMEFRAMES.has(tf) || (produced != null && tf in produced)),
    [produced],
  );
  const tfProduced = produced != null && controls.tf in produced;
  // Same rule as technicalChartHandover: a link can only carry a timeframe every market's chart
  // opens (the shell's daily set). Anything else opens the symbol alone, disclosed here.
  const handoverExact = DAILY_FUNCTIONAL_TIMEFRAMES.has(controls.tf);
  const disabled = !ready;
  const active = techControlsActive(controls);
  const set = (p: Partial<TechControls>) => onControls({ ...controls, ...p });

  return (
    <div className={styles.wrap} data-tech-bar={open ? "open" : "closed"}>
      <div className="scr2-row">
        <button
          type="button"
          className={`chip${open ? " on" : ""}`}
          aria-expanded={open}
          data-tech-toggle
          onClick={onToggle}
        >{tt("tsToggle")}</button>

        {open && (
          <>
            <select
              className="scr2-select"
              aria-label={tt("tsTimeframe")}
              title={tt("tsTimeframe")}
              data-tech-tf
              disabled={disabled}
              value={controls.tf}
              onChange={(e) => set({ tf: e.target.value })}
            >
              {tfOptions.map((tf) => (
                <option key={tf} value={tf}>
                  {produced == null || tf in produced ? tf : `${tf} · ${tt("tsNotScanned")}`}
                </option>
              ))}
            </select>

            <select
              className="scr2-select"
              aria-label={tt("tsPosition")}
              title={tt("tsPosition")}
              data-tech-position
              disabled={disabled}
              value={controls.position}
              onChange={(e) => set({ position: e.target.value as TechControls["position"] })}
            >
              <option value="any">{`${tt("tsPosition")} · ${tt("tsAny")}`}</option>
              <option value="long">{tt("tsLong")}</option>
              <option value="flat">{tt("tsFlat")}</option>
            </select>

            <select
              className="scr2-select"
              aria-label={tt("tsLastSignal")}
              title={tt("tsLastSignal")}
              data-tech-signal
              disabled={disabled}
              value={controls.signal}
              onChange={(e) => set({ signal: e.target.value as TechSignalPick })}
            >
              {TECH_SIGNAL_PICKS.map((p) => (
                <option key={p} value={p}>
                  {p === "any" ? `${tt("tsLastSignal")} · ${tt("tsAny")}` : p === "buyside" ? tt("tsBuySide") : technicalSignalLabel(p, lang)}
                </option>
              ))}
            </select>

            <select
              className="scr2-select"
              aria-label={tt("tsBarsSince")}
              title={tt("tsBarsSince")}
              data-tech-bars
              disabled={disabled}
              value={String(controls.barsMax)}
              onChange={(e) => set({ barsMax: Number(e.target.value) as TechControls["barsMax"] })}
            >
              <option value="0">{`${tt("tsBarsSince")} · ${tt("tsAny")}`}</option>
              {TECH_BARS_MAX.map((n) => <option key={n} value={String(n)}>{tt("tsBarsMax", { n })}</option>)}
            </select>

            {TECH_CHIP_IDS.map((id) => {
              const on = controls.chips.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  data-tech-chip={id}
                  disabled={disabled}
                  onClick={() => set({ chips: toggleTechChip(controls.chips, id) })}
                >{tt(TECH_CHIPS[id].key)}</button>
              );
            })}

            <button
              type="button"
              className={`chip${controls.includeUnknown ? " on" : ""}`}
              aria-pressed={controls.includeUnknown}
              data-tech-include-unknown
              disabled={disabled}
              onClick={() => set({ includeUnknown: !controls.includeUnknown })}
            >{tt("tsIncludeUnknown")}</button>

            {(active || controls.includeUnknown) && (
              <button type="button" className="scr2-clear" data-tech-clear onClick={() => onControls({ ...TECH_DEFAULT_CONTROLS, tf: controls.tf })}>
                {tt("tsClear")}
              </button>
            )}
          </>
        )}
      </div>

      {open && scan.phase !== "settled" && (
        <div className={styles.line} role="status" data-tech-state="loading">{tt("tsLoading")}</div>
      )}

      {open && source && source.kind !== "ready" && (
        <div className={styles.fault} role="alert" data-tech-fault={source.kind}>
          <span>{tt(source.kind === "absent" ? "tsAbsent" : "tsError")}</span>
          <button type="button" className="chip" onClick={scan.retry}>{tt("tsRetry")}</button>
        </div>
      )}

      {open && ready && summary && (
        <div className={styles.line} data-tech-coverage data-tech-coverage-tf={controls.tf}>
          <span className={styles.lead}>{tt("tsCoverage", { tf: controls.tf })}</span>
          <span data-tech-count="requested">{withNumber(tt("tsRequested"), summary.account.total)}</span>
          {COVERAGE_STATUSES.map((st) => (
            <span key={st} data-tech-count={st} className={st === "evaluated" ? undefined : styles.dim}>
              <b>{summary.account[st].toLocaleString()}</b> {tt(STATUS_KEY[st])}
            </span>
          ))}
          <details className={styles.reasons}>
            <summary>{tt("tsReasons")}</summary>
            {summary.account.evaluated === summary.account.total ? (
              <div>{tt("tsNoReasons")}</div>
            ) : (
              <ul>
                {COVERAGE_STATUSES.filter((st) => st !== "evaluated").flatMap((st) =>
                  Object.entries(summary.account.byReason[st])
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, n]) => (
                      <li key={`${st}:${reason}`} data-tech-reason={`${st}:${reason}`}>
                        <b>{n.toLocaleString()}</b> {tt(STATUS_KEY[st])} · {technicalReasonLabel(reason, lang)}
                      </li>
                    )),
                )}
              </ul>
            )}
          </details>
        </div>
      )}

      {open && ready && (
        <div className={styles.line} data-tech-generation={ready.scan.generation}>
          <span>{tt("tsGeneration", { d: ready.scan.generated_at.slice(0, 10) })}</span>
          <span className="fin-tag" style={ready.scan.complete ? INFO : WARN} data-tech-complete={ready.scan.complete ? "true" : "false"}>
            {tt(ready.scan.complete ? "tsComplete" : "tsIncomplete")}
          </span>
          {scan.phase === "settled" && scan.decision?.reason === "incomplete_over_complete" && (
            <span className={`fin-tag ${styles.longTag}`} style={WARN} data-tech-held-complete>{tt("tsHeldComplete")}</span>
          )}
          {ready.refreshFailed && <span className={`fin-tag ${styles.longTag}`} style={WARN} data-tech-refresh-failed>{tt("tsRefreshFailed")}</span>}
          {!tfProduced && (
            <span className={`fin-tag ${styles.longTag}`} style={WARN} data-tech-tf-not-produced={controls.tf}>{tt("tsTfNotProduced", { tf: controls.tf })}</span>
          )}
          {summary && summary.forming > 0 && <span data-tech-forming>{tt("tsForming", { n: summary.forming.toLocaleString() })}</span>}
          {hiddenUnknown > 0 && (
            <span data-tech-hidden-unknown>{tt("tsHiddenUnknown", { n: hiddenUnknown.toLocaleString(), tf: controls.tf })}</span>
          )}
          <span data-tech-handover={handoverExact ? "exact" : "unsupported_timeframe"}>
            {tt(handoverExact ? "tsHandoverExact" : "tsHandoverUnsupported", { tf: controls.tf })}
          </span>
          <span className={styles.dim}>{tt("tsPresetNote")}</span>
        </div>
      )}
    </div>
  );
}

/** Module classes the Screener table needs (phone column set, non-sortable header). */
export const TECH_ON_CLASS = styles.techOn;
export const TECH_TH_CLASS = styles.techTh;
export const TECH_CELL_CLASS = styles.techCell;

const BUYISH = new Set(["BUY", "REBUY", "RECLAIM"]);

/**
 * One row's technical cell at the screen's timeframe. Evaluated rows show the source state
 * verbatim (position, last signal, bars since it, forming-bar marker); a stale row shows its
 * value dimmed and labelled stale with its bar date; unsupported/unavailable rows show only the
 * status word and reason — never a value, never a "no signal" that could read as negative.
 */
export function TechnicalCell({ c }: { c: TechnicalClassification }) {
  const tt = useTechnicalT();
  const { lang } = useLang();
  const { status, reason } = c.coverage;
  const o = c.observation;
  const common = { className: styles.techCell, "data-tech-status": status, "data-tech-reason": reason };

  if ((status === "evaluated" || status === "stale") && o) {
    const sig = o.state.last_signal;
    const pos = o.state.position_hint;
    const bars = o.state.bars_since_signal;
    const value = (
      <>
        {pos && <span className={styles.techPos}>{tt(pos === "long" ? "tsLong" : "tsFlat")}</span>}
        {sig
          ? <span className={`pill${BUYISH.has(sig) ? " buy" : sig === "SELL" ? " sell" : ""}${status === "stale" ? " stale" : ""}`}>{technicalSignalLabel(sig, lang)}</span>
          : <span>—</span>}
        {bars != null && <span className={styles.techBars}>{tt("tsBars", { n: bars })}</span>}
      </>
    );
    if (status === "stale") {
      return (
        <td {...common} title={tt("tsStaleTitle", { reason: technicalReasonLabel(reason, lang), d: o.cutoff.bar_open })}>
          <span className={styles.techInner}>
            <span className={styles.techStatus} data-st="stale">{tt("tsStale")}</span>
            <span className={`${styles.techInner} ${styles.techStaleVal}`}>{value}</span>
          </span>
        </td>
      );
    }
    return (
      <td {...common} title={tt("tsBarTitle", { d: o.cutoff.bar_open })}>
        <span className={styles.techInner}>
          {value}
          {o.cutoff.bar_closed === false && <span className={styles.techForming}>{tt("tsFormingCell")}</span>}
        </span>
      </td>
    );
  }
  return (
    <td {...common} title={technicalReasonLabel(reason, lang)}>
      <span className={styles.techStatus} data-st={status}>{tt(STATUS_KEY[status])}</span>
    </td>
  );
}

"use client";
// E08 — the comparison anchor readout and control. It renders ONLY the receipt ChartPanel's
// compare adapter produced (lib/compareAnchor.buildCompareStudy), so what it says is exactly what
// the lines on the chart were built from. It owns no time state: a pin is written into the leg's
// CmpCfg (the existing compare configuration the layout already saves), never derived from the
// chart's visible range after the moment the user asked for it.

import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { IChartApi } from "lightweight-charts";
import { defaultCmpCfg, type CmpAnchorSrc, type CmpCfg } from "@/lib/compare";
import { anchorSpecOf, isAnchorDate, legComparabilityMark, visibleStartDate, withAnchor, type CmpLegReceipt, type CompareStudy } from "@/lib/compareAnchor";
import { useCompareT } from "@/lib/compareAnchorLex";
import { isIntradayTf } from "@/lib/intradaySources";
import styles from "./CompareAnchorStrip.module.css";

export interface CompareAnchorLeg { cs: string; ci: number }

/** The legs ChartPanel's compare adapter builds from `compare` — same order, cap, and dedupe. */
export function compareLegsOf(compare: string[], host: string): CompareAnchorLeg[] {
  const legs: CompareAnchorLeg[] = [];
  for (let ci = 0; ci < compare.length && ci < 4; ci++) {
    const cs = compare[ci];
    if (!cs || cs === host || legs.some((l) => l.cs === cs)) continue;
    legs.push({ cs, ci });
  }
  return legs;
}

/** The receipt describes the configuration currently on screen — not a build that is superseded. */
export function receiptIsCurrent(study: CompareStudy | null, host: string, timeframe: string, legs: CompareAnchorLeg[], cfgOf: (l: CompareAnchorLeg) => CmpCfg): study is CompareStudy {
  if (!study || study.host.symbol !== host || study.timeframe !== timeframe || study.legs.length !== legs.length) return false;
  return legs.every((l, i) => {
    const r = study.legs[i];
    const cfg = cfgOf(l);
    const spec = anchorSpecOf(cfg);
    return r.symbol === l.cs && r.mode === cfg.mode && r.policy === spec.policy && r.requested === spec.requested;
  });
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const pp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

export default function CompareAnchorStrip({ host, timeframe, legs, compareCfg, study, chartApi, percentAxis, onCompareCfgChange }: {
  host: string;
  timeframe: string;
  legs: CompareAnchorLeg[];
  compareCfg?: Record<string, CmpCfg>;
  study: CompareStudy | null;
  chartApi: IChartApi | null;
  /** The price axis is in Percentage / Indexed-to-100 mode — it counts from the first visible bar. */
  percentAxis: boolean;
  onCompareCfgChange?: Dispatch<SetStateAction<Record<string, CmpCfg>>>;
}) {
  const t = useCompareT();
  const uid = useId();
  const panelId = `${uid}-panel`;
  const dateId = `${uid}-date`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  const cfgOf = (l: CompareAnchorLeg) => compareCfg?.[l.cs] || defaultCmpCfg(l.ci);
  const specs = legs.map((l) => anchorSpecOf(cfgOf(l)));
  const policyKey = specs.every((s) => s.policy === "auto")
    ? "auto"
    : specs.every((s) => s.policy === specs[0].policy && s.requested === specs[0].requested)
      ? `${specs[0].policy}:${specs[0].requested}`
      : "mixed";
  const intraday = isIntradayTf(timeframe);
  const current = receiptIsCurrent(study, host, timeframe, legs, cfgOf) ? study : null;
  const state = intraday ? "daily-only" : current ? "ready" : "computing";

  // The date field starts at the active pin, or at the anchor the auto rule resolved to.
  const firstPinned = specs.find((s) => s.requested)?.requested ?? null;
  const autoAnchor = current?.legs.find((l) => l.status === "drawn" && l.anchor)?.anchor?.effective ?? "";
  useEffect(() => { setDraft(firstPinned ?? autoAnchor); setNote(null); }, [policyKey, autoAnchor]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Pin all" target when the drawn lines do not share one rebasing date: the existing pin, else the
  // latest auto anchor — the first session from which every drawn leg has its own observation.
  const pinAllDate = useMemo(() => {
    if (firstPinned) return firstPinned;
    const eff = (current?.legs ?? []).filter((l) => l.status === "drawn" && l.anchor).map((l) => l.anchor!.effective).sort();
    return eff.length ? eff[eff.length - 1] : null;
  }, [firstPinned, current]);
  const mixed = policyKey === "mixed" || current?.mixedAnchors === true;

  const pin = (date: string | null, src: CmpAnchorSrc = "date") => {
    if (!onCompareCfgChange) return;
    onCompareCfgChange((prev) => {
      const next = { ...prev };
      for (const l of legs) next[l.cs] = withAnchor(prev[l.cs] || defaultCmpCfg(l.ci), date, src);
      return next;
    });
  };
  const pinDraft = () => {
    if (!isAnchorDate(draft)) { setNote(t("cmpaInvalidDate")); return; }
    setNote(null); pin(draft, "date");
  };
  const pinWindow = () => {
    let from: unknown = null;
    try { from = chartApi?.timeScale().getVisibleRange()?.from ?? null; } catch { from = null; }
    const date = visibleStartDate(from);
    if (!date) { setNote(t("cmpaNoWindow")); return; }
    setNote(null); setDraft(date); pin(date, "window");
  };

  const close = () => { setOpen(false); requestAnimationFrame(() => toggleRef.current?.focus()); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); }
  };

  const summary = policyKey === "auto"
    ? t("cmpaAutoSummary", { host })
    : policyKey === "mixed"
      ? t("cmpaMixedSummary")
      : specs[0].policy === "window"
        ? t("cmpaPinnedWindowSummary", { date: specs[0].requested! })
        : t("cmpaPinnedSummary", { date: specs[0].requested! });

  const receiptFor = (cs: string): CmpLegReceipt | null => current?.legs.find((l) => l.symbol === cs) ?? null;

  // AC-E08-03: the chips scroll sideways, so a marked chip can sit out of view. One flag outside the
  // scroller names the leg(s) that are not like-for-like (else the caveat legs) at every width.
  const marked = intraday ? [] : legs.flatMap((l) => {
    const mark = legComparabilityMark(receiptFor(l.cs));
    return mark ? [{ cs: l.cs, state: mark.state }] : [];
  });
  const flagState = marked.some((m) => m.state === "incomparable") ? "incomparable" : marked.length ? "caveat" : null;
  const flagged = marked.filter((m) => m.state === flagState).map((m) => m.cs);

  return (
    <div
      className={styles.strip}
      role="region"
      aria-label={t("cmpaRegion")}
      data-cmp-study={state}
      data-cmp-digest={current?.digest ?? ""}
      data-cmp-policy={policyKey}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className={styles.bar}>
        <span className={styles.title}>{t("cmpaTitle")}</span>
        <ul className={styles.chips} aria-label={summary}>
          {legs.map((l) => {
            const cfg = cfgOf(l);
            const r = receiptFor(l.cs);
            const body = intraday || !r
              ? null
              : r.status === "drawn"
                ? (cfg.mode === "price" || !r.anchor ? t("cmpaChipRaw") : `${r.anchor.effective} · ${t(`cmpaBasisShort_${r.basis}`)}`)
                : t("cmpaChipNotDrawn");
            // AC-E08-03: a rebased line that is not like-for-like is marked here, in the layer that
            // is always visible, not only inside the details panel.
            const mark = intraday ? null : legComparabilityMark(r);
            return (
              <li
                key={l.cs}
                className={styles.chip}
                data-cmp-leg={l.cs}
                data-cmp-status={r?.status ?? "pending"}
                data-cmp-anchor={r?.anchor?.effective ?? ""}
                data-cmp-basis={r?.basis ?? ""}
                data-cmp-comparability={!intraday && r?.stat ? r.stat.comparability : ""}
                data-cmp-comparability-reason={mark?.reason ?? ""}
              >
                <i className={styles.dot} style={{ background: cfg.color }} aria-hidden="true" />
                <b>{l.cs}</b>
                {body && <span className={r?.status === "drawn" ? undefined : styles.warnText}>{body}</span>}
                {mark && (
                  <span
                    className={mark.state === "incomparable" ? styles.markIncomparable : styles.markCaveat}
                    // plain-language-ok: data attribute, not rendered text
                    data-cmp-mark={mark.state}
                  >
                    <span aria-hidden="true">{mark.state === "incomparable" ? "≠" : "≈"}</span>
                    {t(`cmpaMark_${mark.reason}`, { ccy: mark.currency ?? "?" })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {flagState && (
          <span
            className={`${styles.flag} ${flagState === "incomparable" ? styles.markIncomparable : styles.markCaveat}`}
            // plain-language-ok: data attribute, not rendered text
            data-cmp-flag={flagState}
          >
            <span aria-hidden="true">{flagState === "incomparable" ? "≠" : "≈"}</span>
            <b>{flagged.length > 1 ? `${flagged[0]} +${flagged.length - 1}` : flagged[0]}</b>
            <span className={styles.flagWords}>{t(`cmpaFlag_${flagState}`)}</span>
          </span>
        )}
        <button
          ref={toggleRef}
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          data-cmp-toggle
          onClick={() => setOpen((o) => !o)}
        >
          {open ? t("cmpaHide") : t("cmpaDetails")}
        </button>
      </div>

      {open && (
        <div id={panelId} className={styles.panel} data-cmp-panel>
          {intraday ? (
            <p className={styles.note} role="note">{t("cmpaDailyOnly")}</p>
          ) : (
            <>
              <div className={styles.policy} role="group" aria-label={t("cmpaPolicyGroup")}>
                <button type="button" className={styles.btn} aria-pressed={policyKey === "auto"} data-cmp-auto onClick={() => { setNote(null); pin(null); }}>
                  {t("cmpaAuto")}
                </button>
                <label className={styles.dateLabel} htmlFor={dateId}>{t("cmpaDateLabel")}</label>
                <input
                  id={dateId}
                  type="date"
                  className={styles.date}
                  value={draft}
                  data-cmp-date
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); pinDraft(); } }}
                  aria-invalid={note === t("cmpaInvalidDate") || undefined}
                />
                <button type="button" className={styles.btn} aria-pressed={policyKey.startsWith("date:")} data-cmp-pin onClick={pinDraft}>{t("cmpaPin")}</button>
                <button type="button" className={styles.btn} aria-pressed={policyKey.startsWith("window:")} data-cmp-pin-window onClick={pinWindow} title={t("cmpaPinWindowHint")}>{t("cmpaPinWindow")}</button>
              </div>
              <p className={styles.summary} data-cmp-summary>{summary}</p>
              <p className={styles.hint}>{t("cmpaPinWindowHint")}</p>
              <p className={styles.noteLine} role="status" aria-live="polite">{note ?? ""}</p>
              {mixed && pinAllDate && (
                <button type="button" className={`${styles.btn} ${styles.pinAll}`} data-cmp-pin-all onClick={() => pin(pinAllDate, "date")}>
                  {t("cmpaPinAll", { date: pinAllDate })}
                </button>
              )}
              {!current ? (
                <p className={styles.note} role="status">{t("cmpaComputing")}</p>
              ) : (
                <ul className={styles.legs}>
                  <li className={styles.legRow} data-cmp-host>
                    <span className={styles.legHead}><b>{t("cmpaHost", { host })}</b></span>
                    <span>{t(`cmpaBasis_${current.host.basis}`)} · {current.host.src ?? t("cmpaSrcUnknown")} · {current.host.currency ?? t("cmpaCcyUnknown")}</span>
                    {current.host.lastTime && <span className={styles.dim}>{t("cmpaInputRev", { n: current.host.bars, date: current.host.lastTime })}</span>}
                  </li>
                  {legs.map((l) => <LegDetail key={l.cs} leg={l} cfg={cfgOf(l)} r={receiptFor(l.cs)} host={host} hostCcy={current.host.currency} t={t} />)}
                </ul>
              )}
              {percentAxis && <p className={styles.note} role="note">{t("cmpaPercentAxis")}</p>}
              <p className={styles.foot}>{t("cmpaFootnote", { host })}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LegDetail({ leg, cfg, r, host, hostCcy, t }: { leg: CompareAnchorLeg; cfg: CmpCfg; r: CmpLegReceipt | null; host: string; hostCcy: string | null; t: ReturnType<typeof useCompareT> }) {
  if (!r) return null;
  const head = (
    <span className={styles.legHead}>
      <i className={styles.dot} style={{ background: cfg.color }} aria-hidden="true" />
      <b>{leg.cs}</b>
      <span className={styles.dim}>{cfg.mode === "price" ? t("cmpaModePrice") : t("cmpaModePercent")}</span>
    </span>
  );
  if (r.status === "absent" || r.status === "unavailable") {
    return <li className={styles.legRow} data-cmp-leg-detail={leg.cs}>{head}<span className={styles.warnText}>{t(r.status === "absent" ? "cmpaAbsent" : "cmpaUnavailable")}</span></li>;
  }
  const basisLine = `${t(`cmpaBasis_${r.basis}`)} · ${r.src ?? t("cmpaSrcUnknown")} · ${r.currency ?? t("cmpaCcyUnknown")}`;
  if (r.status === "withheld") {
    return (
      <li className={styles.legRow} data-cmp-leg-detail={leg.cs}>
        {head}
        <span className={styles.warnText}>{t(`cmpaW_${r.reason}`, { host, date: r.firstTime ?? "" })}</span>
        <span>{basisLine}</span>
        {r.lastTime && <span className={styles.dim}>{t("cmpaInputRev", { n: r.bars, date: r.lastTime })}</span>}
      </li>
    );
  }
  const a = r.anchor;
  const rule = !a ? null
    : a.hostRule === "first_common" ? t("cmpaRuleFirstCommon")
      : a.hostRule === "next_session" ? t("cmpaRuleNext", { date: r.requested ?? "" })
        : t("cmpaRuleExact");
  const s = r.stat;
  return (
    <li className={styles.legRow} data-cmp-leg-detail={leg.cs}>
      {head}
      {a ? <span>{t("cmpaAnchorAt", { date: a.effective })} · {rule}</span> : <span>{t("cmpaRawScale")}</span>}
      {a && a.legRule === "prior_session" && <span className={styles.dim}>{t("cmpaLegPrior", { date: a.legTime })}</span>}
      <span>{basisLine}</span>
      {s && (
        <span data-cmp-stat>
          {leg.cs} {pct(s.legRet)} · {host} {pct(s.hostRet)} · {t("cmpaSince", { date: a!.effective })} · {t("cmpaThrough", { date: s.end })}
        </span>
      )}
      {s && s.comparability !== "comparable" && (
        <span className={styles.dim} data-cmp-look={s.comparability}>
          {t(s.comparability === "incomparable" ? "cmpaLook_incomparable" : "cmpaLook_caveat", { host })}
        </span>
      )}
      {s && (s.spreadPp == null
        ? <span className={styles.warnText} data-cmp-spread="withheld">{t(`cmpaNoSpread_${s.reason}`, { a: r.currency ?? "?", b: hostCcy ?? "?" })}</span>
        : s.comparability === "comparable"
          ? <span data-cmp-spread="comparable" className={s.spreadPp >= 0 ? styles.up : styles.down}>{t("cmpaSpread", { v: pp(s.spreadPp) })}</span>
          : <span data-cmp-spread="caveat">{t("cmpaSpreadCaveat", { v: pp(s.spreadPp) })}</span>)}
      {r.unmatched > 0 && <span className={styles.dim}>{t("cmpaUnmatched", { n: r.unmatched })}</span>}
      {r.lastTime && <span className={styles.dim}>{t("cmpaInputRev", { n: r.bars, date: r.lastTime })}</span>}
    </li>
  );
}

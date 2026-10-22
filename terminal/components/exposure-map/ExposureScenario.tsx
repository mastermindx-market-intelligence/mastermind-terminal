"use client";
// Exposure scenario panel — the Scenario slice of the Exposure map (board "07 Scenarios").
// Evaluates the admitted summary through lib/exposureScenario (owner: marketStructure.scenarioGrid).
// No fetch, no timers: the parent passes the admitted basis; this panel only edits local inputs.
import { useMemo, useRef, useState } from "react";
import { useChartWidth, niceTicks, fmtTick, thinLabels, padDomain, MIN_CHART_H } from "../charts/svgChart";
import { exposureScenarioT } from "./exposureScenarioStrings";
import { SCENARIO_CURVE, SCENARIO_LIMITS, SCENARIO_STEPS, WORKED_EXAMPLE, defaultScenarioInputs,
  fmtMovePct, fmtScenarioMn, localScenarioValue, scenarioCurve,
  type ScenarioBasis, type ScenarioGreek, type ScenarioInputs } from "../../lib/exposureScenario";
import styles from "./ExposureScenario.module.css";

const CHART_H = Math.max(260, MIN_CHART_H.axis);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
type Status = "ready" | "not-admitted" | "summary-unavailable" | "out-of-range" | "invalid";

/** "2026-10-16" → "OCT 16" (data formatting, not copy). */
const fmtSessionShort = (session: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(session);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : session.toUpperCase();
};
const fmtSigmaPts = (v: number) => (v === 0 ? "0" : `${v < 0 ? "−" : "+"}${Math.abs(v)}`);
const fmtSpot = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const trimNum = (v: number) => v.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** $mn axis label: B at |v| ≥ 1000, M below (U+2212). */
const axisMn = (v: number, step: number) => {
  const dec = step >= 1 ? 0 : 1;
  const a = Math.abs(v);
  const body = a >= 1000 ? `${(a / 1000).toFixed(dec)}B` : `${a.toFixed(dec)}M`;
  return v < 0 ? `−${body}` : body;
};
const signOf = (v: number | null | undefined) =>
  v == null ? undefined : v > 0 ? "positive" as const : v < 0 ? "negative" as const : undefined;

export default function ExposureScenario(p: {
  basis: ScenarioBasis | null;
  lang: "en" | "zh";
  initialInputs?: ScenarioInputs;
  onInputsChange?: (inputs: ScenarioInputs) => void;
  onOpenMap?: () => void;
}) {
  const t = exposureScenarioT(p.lang);
  const basis = p.basis;
  const basisKey = `${basis?.root ?? ""}|${basis?.session ?? ""}`;
  const [inputs, setInputs] = useState<ScenarioInputs>(() =>
    basis ? p.initialInputs ?? defaultScenarioInputs(basis) : { targetSpot: 0, deltaSigmaPts: 0, days: 0 });
  const apply = (next: ScenarioInputs) => {
    setInputs(next);
    p.onInputsChange?.(next);
  };
  // Reseed when the basis identity (root | session) changes — never on a parent re-render
  // (React's adjust-state-on-prop-change pattern: the seeded key lives in state, no refs).
  const [seededKey, setSeededKey] = useState(basisKey);
  if (seededKey !== basisKey) {
    setSeededKey(basisKey);
    if (basis) setInputs(p.initialInputs ?? defaultScenarioInputs(basis));
  }

  const value = useMemo(() => (basis ? localScenarioValue(basis, inputs) : null), [basis, inputs]);
  const status: Status = !basis || basis.qualification !== "qualified" ? "not-admitted"
    : value && !value.ok ? (value.refusal === "summary_unavailable" ? "summary-unavailable"
      : value.refusal === "out_of_local_range" ? "out-of-range" : "invalid")
    : "ready";
  const curve = useMemo(() => (basis ? scenarioCurve(basis, inputs) : []), [basis, inputs]);
  const selectedSigma = SCENARIO_CURVE.sigmas.reduce((best, s) =>
    Math.abs(s - inputs.deltaSigmaPts) < Math.abs(best - inputs.deltaSigmaPts) ? s : best);
  const refOk = basis != null && Number.isFinite(basis.referenceSpot) && basis.referenceSpot > 0;
  const ref = refOk ? basis!.referenceSpot : NaN;
  const refTxt = refOk ? basis!.referenceSpot.toFixed(2) : "—";
  const moveFraction = refOk ? (inputs.targetSpot - ref) / ref : NaN;
  const movePctTxt = refOk ? fmtMovePct(moveFraction) : "—";
  const emOk = basis?.emPct != null && Number.isFinite(basis.emPct) && basis.emPct > 0;

  const stepSpot = (dir: 1 | -1) => {
    if (!refOk) return;
    const next = inputs.targetSpot + dir * ref * (SCENARIO_STEPS.spotPct / 100);
    apply({ ...inputs, targetSpot: Math.round(next * 100) / 100 }); // cents for the INPUT only
  };
  const stepVol = (dir: 1 | -1) => apply({ ...inputs,
    deltaSigmaPts: clamp(inputs.deltaSigmaPts + dir * SCENARIO_STEPS.volPts, -SCENARIO_LIMITS.volPts, SCENARIO_LIMITS.volPts) });
  const stepDays = (dir: 1 | -1) => apply({ ...inputs,
    days: clamp(inputs.days + dir * SCENARIO_STEPS.days, 0, SCENARIO_LIMITS.days) });
  const resetSpot = () => { if (refOk) apply({ ...inputs, targetSpot: ref }); };
  const resetAll = () => { if (basis) apply(defaultScenarioInputs(basis)); };
  const termText = (v: number | null, greek: ScenarioGreek): string => {
    if (value?.ok) return fmtScenarioMn(v, 3);
    if (value && !value.ok && value.refusal === "summary_unavailable" && value.missing.includes(greek)) return t("unavailable");
    return "—";
  };

  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartW = useChartWidth(chartRef, 640);
  const [tab, setTab] = useState<"scenario" | "worked">("scenario");
  // The WORKED tab re-evaluates the engine-contract golden LIVE; a drift beyond 1e-4 is
  // shown as a failure, never silently.
  const worked = useMemo(() => {
    const live = localScenarioValue(WORKED_EXAMPLE.basis, WORKED_EXAMPLE.inputs);
    return live.ok && Math.abs(live.totalMn - WORKED_EXAMPLE.expectedTotalMn) <= 1e-4 ? live : null;
  }, []);

  // Chart geometry (svgChart R1–R7): measured width → 1:1 pixel viewBox, domains over finite
  // values only, ticks via niceTicks + fmtTick, labels thinned by pixel gap.
  const width = Math.max(240, chartW);
  const pad = { l: 56, r: 16, t: 24, b: 30 };
  const pw = Math.max(10, width - pad.l - pad.r);
  const ph = Math.max(10, CHART_H - pad.t - pad.b);
  const [xDomLo, xDomHi] = padDomain(SCENARIO_CURVE.spotPct[0], SCENARIO_CURVE.spotPct[1], { padFrac: 0.05 });
  const finiteY: number[] = [];
  for (const s of curve) for (const pt of s.points) if (pt.valueMn != null && Number.isFinite(pt.valueMn)) finiteY.push(pt.valueMn);
  const [yLo, yHi] = padDomain(finiteY.length ? Math.min(...finiteY) : 0, finiteY.length ? Math.max(...finiteY) : 0, { includeZero: true });
  const xOf = (v: number) => pad.l + ((v - xDomLo) / (xDomHi - xDomLo)) * pw;
  const yOf = (v: number) => pad.t + ((yHi - v) / (yHi - yLo)) * ph;
  const xStep = niceTicks(xDomLo, xDomHi, 5);
  const xLabels = thinLabels(xStep.values.map((v) => ({ v, x: xOf(v) })), (d) => d.x, 34);
  const yStep = niceTicks(yLo, yHi, 4);
  const em = emOk && basis ? basis.emPct : null;
  // A null valueMn is a gap: each series splits into runs of consecutive finite points.
  const seriesPaths = curve.map((s) => {
    const runs: string[] = [];
    let cur: string[] = [];
    for (const pt of s.points) {
      if (pt.valueMn == null || !Number.isFinite(pt.valueMn)) {
        if (cur.length > 1) runs.push(cur.join(" "));
        cur = [];
        continue;
      }
      cur.push(`${xOf(pt.spotPct).toFixed(2)},${yOf(pt.valueMn).toFixed(2)}`);
    }
    if (cur.length > 1) runs.push(cur.join(" "));
    return { sigma: s.deltaSigmaPts, runs };
  });
  const dot = value?.ok ? { x: xOf(value.movePct), y: yOf(value.totalMn),
    label: `${fmtSpot(value.inputs.targetSpot)} · ${fmtMovePct(value.moveFraction)} · ${fmtScenarioMn(value.totalMn, 3)}` } : null;
  const lw = dot ? dot.label.length * 6.2 + 14 : 0;
  const lx = dot ? clamp(dot.x - lw / 2, pad.l, Math.max(pad.l, pad.l + pw - lw)) : 0;
  const ly = dot && dot.y - pad.t > 44 ? dot.y - 34 : (dot?.y ?? 0) + 14;
  const note = status === "summary-unavailable"
    ? (value && !value.ok && value.missing.includes("vex") ? t("needVex") : t("needCex"))
    : status === "out-of-range" ? t("outOfRange") : status === "invalid" ? t("invalid") : null;

  return (
    <div className={styles.root} data-scenario-status={status} data-scenario-sigma={selectedSigma}>
      <div className={styles.toolbar}>
        <span className={styles.chipOn}>{t("localLinear")}</span>
        <span className={styles.chipOff} title={t("repricedTitle")}>{t("repricedHeld")}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={resetSpot} disabled={!refOk}>{t("resetToSpot")}</button>
      </div>
      <div className={styles.body}>
        <aside className={styles.controls}>
          <div className={styles.card} role="group" aria-label={t("spotMove")}>
            <span className={styles.eyebrow}>{t("spotMove")}</span>
            <span className={styles.valueLine}>{refTxt} → {fmtSpot(inputs.targetSpot)}</span>
            <span className={styles.subLine}>{movePctTxt}</span>
            <div className={styles.stepperRow}>
              <button type="button" className={styles.stepBtn} aria-label="−" onClick={() => stepSpot(-1)}>−</button>
              <input className={styles.numInput} type="number" inputMode="decimal" step={0.01}
                value={Number.isFinite(inputs.targetSpot) ? inputs.targetSpot : ""}
                onChange={(e) => apply({ ...inputs, targetSpot: Number(e.target.value) })} />
              <button type="button" className={styles.stepBtn} aria-label="+" onClick={() => stepSpot(1)}>+</button>
            </div>
          </div>
          <div className={styles.card} role="group" aria-label={t("volShift")}>
            <span className={styles.eyebrow}>{t("volShift")}</span>
            <div className={styles.stepperRow}>
              <button type="button" className={styles.stepBtn} aria-label="−" onClick={() => stepVol(-1)}>−</button>
              <input className={styles.numInput} type="number" inputMode="decimal" step={0.25} min={-SCENARIO_LIMITS.volPts} max={SCENARIO_LIMITS.volPts}
                value={Number.isFinite(inputs.deltaSigmaPts) ? inputs.deltaSigmaPts : ""}
                onChange={(e) => apply({ ...inputs, deltaSigmaPts: Number(e.target.value) })} />
              <button type="button" className={styles.stepBtn} aria-label="+" onClick={() => stepVol(1)}>+</button>
            </div>
          </div>
          <div className={styles.card} role="group" aria-label={t("timeDays")}>
            <span className={styles.eyebrow}>{t("timeDays")}</span>
            <div className={styles.stepperRow}>
              <button type="button" className={styles.stepBtn} aria-label="−" onClick={() => stepDays(-1)}>−</button>
              <input className={styles.numInput} type="number" inputMode="decimal" step={0.25} min={0} max={SCENARIO_LIMITS.days}
                value={Number.isFinite(inputs.days) ? inputs.days : ""}
                onChange={(e) => apply({ ...inputs, days: Number(e.target.value) })} />
              <button type="button" className={styles.stepBtn} aria-label="+" onClick={() => stepDays(1)}>+</button>
            </div>
          </div>
          <div className={styles.summary}>
            <span className={styles.eyebrow}>{t("admittedSummary", { session: basis ? fmtSessionShort(basis.session) : "—" })}</span>
            <div className={styles.summaryRow}><span>GEX</span>
              <span className={styles.mono} data-sign={signOf(basis?.gexMn)}>{basis?.gexMn != null ? fmtScenarioMn(basis.gexMn, 3) : t("unavailable")}</span></div>
            <div className={styles.summaryRow}><span>VEX</span>
              <span className={styles.mono} data-sign={signOf(basis?.vexMn)}>{basis?.vexMn != null ? fmtScenarioMn(basis.vexMn, 3) : t("unavailable")}</span></div>
            <div className={styles.summaryRow}><span>CEX</span>
              <span className={styles.mono} data-sign={signOf(basis?.cexMn)}>{basis?.cexMn != null ? fmtScenarioMn(basis.cexMn, 3) : t("unavailable")}</span></div>
            {basis != null && (basis.vexMn == null || basis.cexMn == null) && (
              <div className={styles.summaryRow}><span>{t("vannaCharmUnavailable")}</span>
                <span className={styles.monoMuted}>{t("unavailable")}</span></div>)}
          </div>
        </aside>
        <section className={styles.main}>
          <div className={styles.headlineRow}>
            <span className={styles.headline} data-testid="scenario-headline">{value?.ok ? fmtScenarioMn(value.totalMn, 3) : "—"}</span>
            <span className={styles.caption}>{t("localValueCaption")}</span>
          </div>
          {note != null && <p className={styles.stateNote}>{note}</p>}
          <div className={styles.terms}>
            <div className={styles.term}><span className={styles.eyebrow}>{t("spotTerm")}</span>
              <span className={styles.termValue} data-sign={signOf(value?.ok ? value.terms.spotMn : null)}>{termText(value?.ok ? value.terms.spotMn : null, "gex")}</span></div>
            <div className={styles.term}><span className={styles.eyebrow}>{t("volTerm")}</span>
              <span className={styles.termValue} data-sign={signOf(value?.ok ? value.terms.volMn : null)}>{termText(value?.ok ? value.terms.volMn : null, "vex")}</span></div>
            <div className={styles.term}><span className={styles.eyebrow}>{t("timeTerm")}</span>
              <span className={styles.termValue} data-sign={signOf(value?.ok ? value.terms.timeMn : null)}>{termText(value?.ok ? value.terms.timeMn : null, "cex")}</span></div>
            <div className={styles.term}><span className={styles.eyebrow}>{t("joint")}</span>
              <span className={styles.termMuted}>{t("jointNotAdmitted")}</span></div>
          </div>
          <div className={styles.chartArea}>
            <span className={styles.eyebrow}>{t("chartEyebrow", { ref: refTxt, days: trimNum(inputs.days) })}</span>
            <div className={styles.chartWrap} ref={chartRef}>
              {status === "not-admitted" ? (
                <div className={styles.empty}><strong>{t("notAdmittedTitle")}</strong><span>{t("notAdmittedBody")}</span></div>
              ) : (
                <svg width={width} height={CHART_H} viewBox={`0 0 ${width} ${CHART_H}`} className={styles.svg} role="img">
                  {em != null && <>
                    <rect x={Math.min(xOf(-em), xOf(em))} y={pad.t} width={Math.abs(xOf(em) - xOf(-em))} height={ph} fill="rgba(255,255,255,.04)" />
                    <line x1={xOf(-em)} x2={xOf(-em)} y1={pad.t} y2={pad.t + ph} stroke="var(--line-3)" strokeDasharray="3 3" />
                    <line x1={xOf(em)} x2={xOf(em)} y1={pad.t} y2={pad.t + ph} stroke="var(--line-3)" strokeDasharray="3 3" />
                    <text x={xOf(0)} y={pad.t + 11} textAnchor="middle" className={styles.svgMuted}>{t("emBand", { pct: em.toFixed(2) })}</text>
                  </>}
                  {yLo <= 0 && yHi >= 0 && <line x1={pad.l} x2={pad.l + pw} y1={yOf(0)} y2={yOf(0)} stroke="var(--line-2)" />}
                  {seriesPaths.map((s) => s.runs.map((run, i) => (
                    <polyline key={`${s.sigma}:${i}`} points={run} fill="none"
                      stroke={s.sigma === selectedSigma ? "var(--ex-gold)" : "var(--text-dim)"}
                      strokeWidth={s.sigma === selectedSigma ? 1.75 : 1.25} />
                  )))}
                  {dot && <>
                    <circle cx={dot.x} cy={dot.y} r={4} fill="var(--ex-gold)" />
                    <rect x={lx} y={ly} width={lw} height={18} rx={3} fill="var(--panel)" stroke="var(--line)" />
                    <text x={lx + 7} y={ly + 12.5} className={styles.svgMono}>{dot.label}</text>
                  </>}
                  {xLabels.map(({ v, x }) => (
                    <text key={`x${v}`} x={x} y={CHART_H - 9} textAnchor="middle" className={styles.svgMuted}>
                      {fmtTick(v, xStep.step).replace("-", "−")}%
                    </text>
                  ))}
                  {yStep.values.map((v) => (
                    <text key={`y${v}`} x={pad.l - 8} y={yOf(v) + 3.5} textAnchor="end" className={styles.svgMuted}>{axisMn(v, yStep.step)}</text>
                  ))}
                  <line x1={pad.l} x2={pad.l + pw} y1={pad.t + ph} y2={pad.t + ph} stroke="var(--line)" />
                </svg>
              )}
              <div className={styles.legend}>
                {[...SCENARIO_CURVE.sigmas].reverse().map((s) => (
                  <span key={s} className={s === selectedSigma ? styles.legendOn : styles.legendOff}>
                    {s === 0 ? t("sigmaZero") : t("sigmaChip", { pts: fmtSigmaPts(s) })}
                    {s === selectedSigma ? ` · ${t("selected")}` : ""}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
        <aside className={styles.inspector}>
          <div className={styles.tabs} role="tablist">
            <button type="button" role="tab" aria-selected={tab === "scenario"} className={styles.tab}
              onClick={() => setTab("scenario")}>{t("tabScenario")}</button>
            <button type="button" role="tab" aria-selected={tab === "worked"} className={styles.tab}
              onClick={() => setTab("worked")}>{t("tabWorked")}</button>
          </div>
          {tab === "scenario" ? (
            <div className={styles.tabPanel}>
              <span className={styles.bigValue}>{value?.ok ? fmtScenarioMn(value.totalMn, 2) : "—"}</span>
              <span className={styles.subCaption}>{t("localValue")}</span>
              <div className={styles.routeRow}><span className={styles.mono}>{fmtSpot(inputs.targetSpot)}</span>
                <span className={styles.subCaption}>{refOk ? t("fromRef", { ref: refTxt, pct: movePctTxt }) : ""}</span></div>
              <dl className={styles.dl}>
                <dt>{t("spotTerm")}</dt>
                <dd><span className={styles.mono} data-sign={signOf(value?.ok ? value.terms.spotMn : null)}>{termText(value?.ok ? value.terms.spotMn : null, "gex")}</span></dd>
                <dt>{t("volTerm")}</dt>
                <dd><span className={styles.mono} data-sign={signOf(value?.ok ? value.terms.volMn : null)}>{termText(value?.ok ? value.terms.volMn : null, "vex")}</span>
                  <span className={styles.dlNote}> · {inputs.deltaSigmaPts === 0 ? t("sigmaZero") : t("sigmaChip", { pts: fmtSigmaPts(inputs.deltaSigmaPts) })}</span></dd>
                <dt>{t("timeTerm")}</dt>
                <dd><span className={styles.mono} data-sign={signOf(value?.ok ? value.terms.timeMn : null)}>{termText(value?.ok ? value.terms.timeMn : null, "cex")}</span>
                  <span className={styles.dlNote}> · {trimNum(inputs.days)} {t("day")}</span></dd>
              </dl>
              <span className={styles.dlWide}>{t("inputsIndependent")}</span>
              {basis != null && (basis.vexMn == null || basis.cexMn == null) && (
                <span className={styles.dlWide}>{t("vannaCharmUnavailable")}</span>)}
              <span className={styles.eyebrow}>{t("basis")}</span>
              <span className={styles.mono}>{basis?.session ?? "—"}</span>
              <span className={styles.subCaption}>{basis ? t("admittedLine", {
                gex: basis.gexMn != null ? fmtScenarioMn(basis.gexMn, 3) : t("unavailable"),
                vex: basis.vexMn != null ? fmtScenarioMn(basis.vexMn, 3) : t("unavailable"),
                cex: basis.cexMn != null ? fmtScenarioMn(basis.cexMn, 3) : t("unavailable") }) : ""}</span>
              <p className={styles.caveat}>{t("caveat")}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.ghost} onClick={resetAll} disabled={!basis}>{t("resetInputs")}</button>
                {p.onOpenMap && <button type="button" className={styles.ghost} onClick={p.onOpenMap}>{t("openInExposure")}</button>}
              </div>
            </div>
          ) : (
            <div className={styles.tabPanel}>
              {worked ? <>
                <span className={styles.subCaption}>
                  {t("sigmaChip", { pts: fmtSigmaPts(WORKED_EXAMPLE.inputs.deltaSigmaPts) })} · {trimNum(WORKED_EXAMPLE.inputs.days)} {t("day")}
                </span>
                <dl className={styles.dl}>
                  <dt>{t("spotTerm")}</dt><dd><span className={styles.mono} data-sign={signOf(worked.terms.spotMn)}>{fmtScenarioMn(worked.terms.spotMn, 3)}</span></dd>
                  <dt>{t("volTerm")}</dt><dd><span className={styles.mono} data-sign={signOf(worked.terms.volMn)}>{fmtScenarioMn(worked.terms.volMn, 3)}</span></dd>
                  <dt>{t("timeTerm")}</dt><dd><span className={styles.mono} data-sign={signOf(worked.terms.timeMn)}>{fmtScenarioMn(worked.terms.timeMn, 3)}</span></dd>
                </dl>
                <span className={styles.bigValue}>{fmtScenarioMn(worked.totalMn, 3)}</span>
                <span className={styles.subCaption}>{t("workedRounded", { v: `${WORKED_EXAMPLE.roundedWouldGiveMn.toFixed(2)}M` })}</span>
                <span className={styles.oracle}>{t("oracleTag")}</span>
              </> : <span className={styles.selfFail}>{t("selfCheckFailed")}</span>}
            </div>
          )}
        </aside>
      </div>
      <footer className={styles.footer}>
        <span>{t("footerFormula")}</span>
        <span className={styles.oracle}>{t("oracleTag")}</span>
      </footer>
    </div>
  );
}
